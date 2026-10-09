//! What the rules of `jest` and of `vitest` about where and how `expect` is called do. Each module is a file of oxlint's
//! `rules/shared/jest_vitest`. See [`jest`](crate::jest).

use crate::jest::{
    AstKind, Ctx, EnclosingFunctions, ExpectError, JestFnKind, JestGeneralFnKind,
    KnownMemberExpressionParentKind, PossibleJestNode, Scopes, convert_pattern, enclosing_function,
    get_node_name, get_node_name_vec, is_type_of_jest_fn_call, is_vitest, is_vitest_import_source,
    iter_possible_jest_call_node, parse_expect_jest_fn_call, parse_general_jest_fn_call,
    possible_jest_node_of,
};
use bun_core::strings;
use bun_lint::ast::walk::{Visitor, walk_node};
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{
    get_declaration_of_variable, get_inner_expression, static_property_name,
};
use bun_lint_oxlint::import::{ImportImportName, import_entries};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// The `Dot` or the `Index` that is called, with the name of the property: `call_expr.callee.as_member_expression()` and its
/// `static_property_name()`.
fn callee_member(call_expr: Call<'_>) -> Option<(Expr<'_>, Option<Name<'_>>)> {
    let callee = call_expr.callee();
    (matches!(callee.tag(), ExprTag::Dot | ExprTag::Index) && !callee.is_parenthesized())
        .then(|| (callee, static_property_name(callee)))
}

/// `Promise.all(..)`, `Promise["x"](..)`
fn is_method_of_promise(call_expr: Call) -> bool {
    (callee_member(call_expr).and_then(|it| it.0.object()))
        .is_some_and(|it| it.is_ident("Promise") && !it.is_parenthesized())
}

pub(crate) mod valid_expect {
    use super::*;

    const MATCHER_NOT_FOUND: Message =
        Message::new("", "Expect must have a corresponding matcher call.");
    const MATCHER_NOT_CALLED: Message = Message::new("", "Matchers must be called to assert.");
    const MODIFIER_UNKNOWN: Message = Message::new("", "Expect has an unknown modifier.");
    const ASYNC_MUST_BE_AWAITED: Message = Message::new("", "Async assertions must be awaited.");
    const PROMISES_WITH_ASYNC_ASSERTIONS_MUST_BE_AWAITED: Message = Message::new(
        "",
        "Promises which return async assertions must be awaited.",
    );
    const TOO_MANY_ARGUMENTS: Message =
        Message::new("", "Expect takes at most {{count}} argument{{s}} ");
    const NOT_ENOUGH_ARGUMENTS: Message =
        Message::new("", "Expect requires at least {{count}} argument{{s}} ");
    const ADD_AWAIT: Message = Message::new("", "Add `await`.");
    const ADD_AWAIT_AND_ASYNC: Message =
        Message::new("", "Add `await` and make the enclosing function `async`.");

    pub(crate) struct ValidExpectConfig {
        async_matchers: Vec<String>,
        min_args: u32,
        max_args: u32,
        /// A second argument that is a string or a template is a message.
        allow_string_message_arg: bool,
        always_await: bool,
    }

    impl ValidExpectConfig {
        pub(crate) fn new(options: &Options, allow_string_message_arg: bool) -> Self {
            let config = options.object(0);
            let count = |key: &str| {
                let count = config
                    .number(key)
                    .filter(|it| *it >= 0.0 && it.fract() == 0.0);
                count.map_or(1, |it| {
                    if it <= f64::from(u32::MAX) {
                        it as u32
                    } else {
                        1
                    }
                })
            };
            ValidExpectConfig {
                async_matchers: match config.get("asyncMatchers").and_then(Json::as_array) {
                    Some(_) => config
                        .strings("asyncMatchers")
                        .into_iter()
                        .map(String::from)
                        .collect(),
                    None => vec!["toResolve".to_owned(), "toReject".to_owned()],
                },
                min_args: count("minArgs"),
                max_args: count("maxArgs"),
                allow_string_message_arg,
                always_await: config.bool_or("alwaysAwait", false),
            }
        }

        pub(crate) fn run_once<'a>(&self, ctx: &Ctx<'a, '_>) {
            // The functions that a fix has made `async`.
            let mut fixed_function_expression = FxHashSet::default();
            for jest_node in iter_possible_jest_call_node(ctx.file) {
                self.run(jest_node, &mut fixed_function_expression, ctx);
            }
        }

        fn run<'a>(
            &self,
            possible_jest_node: PossibleJestNode<'a>,
            fixed_function_expression: &mut FxHashSet<Func<'a>>,
            ctx: &Ctx<'a, '_>,
        ) {
            let node = possible_jest_node.node;
            let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node) else {
                return;
            };
            if let Some(expect_error) = jest_fn_call.expect_error {
                let reporting_span = find_top_most_member_expression(node).unwrap_or(node).span();
                ctx.report(
                    reporting_span,
                    match expect_error {
                        ExpectError::MatcherNotFound => MATCHER_NOT_FOUND,
                        ExpectError::MatcherNotCalled => MATCHER_NOT_CALLED,
                        ExpectError::ModifierUnknown => MODIFIER_UNKNOWN,
                    },
                );
                return;
            }
            let Some(expect) = jest_fn_call
                .head
                .parent
                .filter(|it| it.tag() == ExprTag::Call)
            else {
                return;
            };
            let Some(arguments) = jest_fn_call.expect_arguments else {
                return;
            };
            let argument_count = arguments.len() as u32;
            let is_message = |it: Expr| {
                matches!(it.tag(), ExprTag::String | ExprTag::Template) && !it.is_parenthesized()
            };
            let allow_message_arg = self.allow_string_message_arg
                && argument_count == 2
                && arguments.get(1).is_some_and(is_message);
            let plural = |count: u32| if count > 1 { "s" } else { "" };
            if argument_count > self.max_args && !allow_message_arg {
                ctx.report(expect, TOO_MANY_ARGUMENTS)
                    .data("count", self.max_args)
                    .data("s", plural(self.max_args));
                return;
            }
            if argument_count < self.min_args {
                ctx.report(expect, NOT_ENOUGH_ARGUMENTS)
                    .data("count", self.min_args)
                    .data("s", plural(self.min_args));
                return;
            }

            let Some(matcher_name) = jest_fn_call.matcher().and_then(|it| it.name()) else {
                return;
            };
            let should_be_awaited = jest_fn_call
                .modifiers()
                .any(|modifier| modifier.is_name_unequal("not"))
                || self
                    .async_matchers
                    .iter()
                    .any(|it| it.as_bytes() == matcher_name);
            if !should_be_awaited {
                return;
            }

            // With the `then` and `catch` that follow.
            let target_node = get_parent_if_thenable(node);
            let Some(final_node) = find_promise_call_expression_node(node, target_node) else {
                return;
            };
            let parent = AstKind::Expr(final_node).parent();
            if is_acceptable_return_node(parent, !self.always_await) {
                return;
            }
            let message = match target_node == final_node {
                true => ASYNC_MUST_BE_AWAITED,
                false => PROMISES_WITH_ASYNC_ASSERTIONS_MUST_BE_AWAITED,
            };
            let report = ctx.report(final_node, message);
            let Some((function_scope_node, func)) = AstKind::Expr(node)
                .ancestors()
                .find_map(|it| it.as_function().map(|func| (it, func)))
            else {
                return;
            };
            let needs_async = !func.is_async() && fixed_function_expression.insert(func);
            report.suggest(
                if needs_async {
                    ADD_AWAIT_AND_ASYNC
                } else {
                    ADD_AWAIT
                },
                |fixer| {
                    let mut fixes = Vec::with_capacity(2);
                    if needs_async {
                        // Before the name of a method of an object.
                        let span_to_insert_before =
                            match (function_scope_node, function_scope_node.parent()) {
                                (_, AstKind::Other(Node::Prop(property)))
                                    if !property.is_jsx_attribute() =>
                                {
                                    property.span()
                                }
                                (AstKind::Stmt(declaration), _) => {
                                    declaration.span_without_export()
                                }
                                _ => function_scope_node.span(),
                            };
                        fixes.push(fixer.insert_before(span_to_insert_before, "async "));
                    }
                    match parent {
                        AstKind::Stmt(statement)
                            if self.always_await && statement.tag() == StmtTag::Return =>
                        {
                            fixes.push(fixer.replace(
                                statement,
                                replace_all(statement.text(), b"return", b"await"),
                            ));
                        }
                        _ => fixes.push(fixer.insert_before(final_node, "await ")),
                    }
                    fixes
                },
            );
        }
    }

    fn replace_all(text: &[u8], from: &[u8], to: &[u8]) -> Vec<u8> {
        let (mut out, mut rest) = (Vec::with_capacity(text.len()), text);
        while let Some(at) = strings::index_of(rest, from) {
            let (before, after) = rest.split_at(at);
            out.extend_from_slice(before);
            out.extend_from_slice(to);
            rest = after.get(from.len()..).unwrap_or_default();
        }
        out.extend_from_slice(rest);
        out
    }

    /// The last member of `node.a.b().c`.
    fn find_top_most_member_expression(node: Expr<'_>) -> Option<Expr<'_>> {
        let mut top_most_member_expression = None;
        let mut at = AstKind::Expr(node);
        loop {
            let parent = at.parent();
            if at.is_member_expression_kind() {
                top_most_member_expression = at.as_expr();
            } else if !parent.is_member_expression_kind() {
                return top_most_member_expression;
            }
            at = parent;
        }
    }

    fn is_acceptable_return_node(node: AstKind, allow_return: bool) -> bool {
        let mut at = node;
        loop {
            match at {
                AstKind::Stmt(statement) if statement.tag() == StmtTag::Return => {
                    return allow_return;
                }
                AstKind::Stmt(statement) if statement.tag() != StmtTag::Expr => return false,
                AstKind::Stmt(_) | AstKind::FunctionBody(_) => {}
                AstKind::Expr(e) => match e.kind() {
                    ExprKind::Cond { .. } => {}
                    ExprKind::Fn(func) => {
                        return func.is_arrow() && matches!(func.body(), FnBody::Expr(_));
                    }
                    ExprKind::Await(_) => return true,
                    _ => return false,
                },
                _ => return false,
            }
            at = at.parent();
        }
    }

    /// Whether `node` is an argument of `parent`, which is not a method of `Promise`.
    fn should_skip_parent_node(node: AstKind, parent: AstKind) -> bool {
        let Some(parent) = parent.as_expr() else {
            return false;
        };
        match parent.kind() {
            ExprKind::Call(call) if is_method_of_promise(call) => false,
            ExprKind::Call(call) | ExprKind::New(call) => call
                .args()
                .iter()
                .any(|arg| arg.outer_span() == node.span()),
            _ => false,
        }
    }

    /// What `node` is in, but for the calls that it is an argument of, and whether it is the first element if that is an array.
    fn get_parent_with_ignore(node: AstKind<'_>) -> (AstKind<'_>, bool) {
        let mut at = node;
        loop {
            let parent = at.parent();
            if !should_skip_parent_node(at, parent) {
                // `Promise.all([a, b])` is reported once.
                let is_first_item = match parent.as_expr().map(Expr::kind) {
                    Some(ExprKind::Array(elements)) => elements
                        .first()
                        .is_some_and(|it| it.outer_span() == at.span()),
                    _ => true,
                };
                return (parent, is_first_item);
            }
            at = parent;
        }
    }

    /// `None`: it is reported with another.
    fn find_promise_call_expression_node<'a>(
        node: Expr<'a>,
        default_node: Expr<'a>,
    ) -> Option<Expr<'a>> {
        let (parent, is_first_array_item) = get_parent_with_ignore(AstKind::Expr(node));
        let Some(mut promise_call) = parent
            .as_expr()
            .filter(|it| matches!(it.tag(), ExprTag::Call | ExprTag::Array))
        else {
            return Some(default_node);
        };
        if promise_call.tag() == ExprTag::Array
            && let Some(grandparent) = get_parent_with_ignore(parent).0.as_expr()
            && grandparent.tag() == ExprTag::Call
        {
            promise_call = grandparent;
        }
        match promise_call.as_call().is_some_and(is_method_of_promise) {
            true => is_first_array_item.then_some(promise_call),
            false => Some(default_node),
        }
    }

    fn get_parent_if_thenable(node: Expr<'_>) -> Expr<'_> {
        let mut at = node;
        while let Some(grandparent) = AstKind::Expr(at).parent().parent().as_expr()
            && let Some(call_expr) = grandparent.as_call()
            && let Some((_, Some(name))) = callee_member(call_expr)
            && name.is_any(&["then", "catch"])
        {
            at = grandparent;
        }
        at
    }
}

pub(crate) mod valid_expect_in_promise {
    use super::*;

    const EXPECT_IN_UNHANDLED_PROMISE: Message =
        Message::new("", "Expect in a promise chain must be awaited or returned");
    const EXPECT_IN_PROMISE_AFTER_RETURN: Message = Message::new(
        "",
        "Expect in a promise chain is unreachable after a `return` statement",
    );

    /// The variables that hold a promise in which something is expected, with what is reported for each.
    type PendingPromises<'a> = FxHashMap<Name<'a>, Span>;

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(callback) = possible_jest_node
            .node
            .as_call()
            .and_then(|it| it.args().get(1))
        else {
            return;
        };
        let Some(parsed_jest_fn) = parse_general_jest_fn_call(ctx.file, possible_jest_node) else {
            return;
        };
        if parsed_jest_fn.kind != JestFnKind::General(JestGeneralFnKind::Test) {
            return;
        }
        // A function whose body is a block, without parameters: `done` is another way to wait. A rest parameter does not count.
        let is_checkable =
            |it: &Func| !callback.is_parenthesized() && it.params().iter().all(Param::is_rest);
        let Some(statements) = callback
            .as_fn()
            .filter(is_checkable)
            .and_then(Func::body_statements)
        else {
            return;
        };
        let (mut pending_promises, mut return_found) = (PendingPromises::default(), false);
        process_statements(statements, &mut pending_promises, &mut return_found, ctx);
        for span in pending_promises.values() {
            ctx.report(*span, EXPECT_IN_UNHANDLED_PROMISE);
        }
    }

    fn process_statements<'a>(
        statements: List<'a, Stmt<'a>>,
        pending_promises: &mut PendingPromises<'a>,
        return_found: &mut bool,
        ctx: &Ctx<'a, '_>,
    ) {
        for statement in statements {
            if *return_found {
                if PromiseExpectScanner::scan(Node::Stmt(statement)).found_expect_in_promise {
                    ctx.report(statement, EXPECT_IN_PROMISE_AFTER_RETURN);
                }
                continue;
            }
            // What is in a block is scanned statement by statement.
            if let StmtKind::Block(body) = statement.kind() {
                process_statements(body, pending_promises, return_found, ctx);
                continue;
            }
            let scanner = PromiseExpectScanner::scan(Node::Stmt(statement));
            let assignment = match statement.kind() {
                StmtKind::Expr(e) if !e.is_parenthesized() => match e.kind() {
                    ExprKind::Assign { target, value, .. } => Some((target, value)),
                    _ => None,
                },
                _ => None,
            };
            // An assignment can make a promise unreachable, or go on with it.
            if assignment.is_none() {
                for name in &scanner.resolved_names {
                    pending_promises.remove(name);
                }
            }
            if let Some((target, value)) = assignment {
                match get_identifier_name(target) {
                    Some(name) => {
                        if !expression_contains_identifier(value, name)
                            && let Some(old_span) = pending_promises.remove(&name)
                        {
                            ctx.report(old_span, EXPECT_IN_UNHANDLED_PROMISE);
                        }
                        if scanner.found_expect_in_promise {
                            pending_promises.insert(name, statement.span());
                        }
                    }
                    None if scanner.found_expect_in_promise => {
                        ctx.report(statement, EXPECT_IN_UNHANDLED_PROMISE);
                    }
                    None => {}
                }
                continue;
            }
            match statement.kind() {
                StmtKind::Var(declarations) => {
                    for declarator in declarations {
                        if let (Some(init), Some(name)) =
                            (declarator.init(), declarator.pat().as_ident())
                            && PromiseExpectScanner::scan(Node::Expr(init)).found_expect_in_promise
                        {
                            pending_promises.insert(name, declarator.span());
                        }
                    }
                }
                // A chain that is deep in something else cannot be followed.
                StmtKind::Expr(e) => {
                    if scanner.found_expect_in_promise
                        && !e.is_parenthesized()
                        && !e.is_chain_root()
                        && e.as_call().is_some_and(is_promise_call_expression)
                    {
                        ctx.report(statement, EXPECT_IN_UNHANDLED_PROMISE);
                    }
                }
                StmtKind::Return(argument) => {
                    if let Some(name) = argument.and_then(ident_name_of) {
                        pending_promises.remove(&name);
                    }
                    *return_found = true;
                }
                _ => {}
            }
        }
    }

    fn ident_name_of(expr: Expr<'_>) -> Option<Name<'_>> {
        expr.as_ident().filter(|_| !expr.is_parenthesized())
    }

    /// `SimpleAssignmentTarget::get_identifier_name`: the `a` of `a = ..`, the `b` of `a.b = ..`.
    fn get_identifier_name(target: Expr<'_>) -> Option<Name<'_>> {
        target.as_ident().or_else(|| static_property_name(target))
    }

    fn expression_contains_identifier<'a>(expr: Expr<'a>, name: Name<'a>) -> bool {
        struct IdentifierFinder<'a> {
            name: Name<'a>,
            found: bool,
        }
        impl<'a> Visitor<'a> for IdentifierFinder<'a> {
            fn enter(&mut self, node: Node<'a>) {
                self.found |= matches!(node, Node::Expr(e) if e.as_ident() == Some(self.name));
            }
            fn exit(&mut self, _: Node<'a>) {}
        }
        let mut finder = IdentifierFinder { name, found: false };
        walk_node(Node::Expr(expr), &mut finder);
        finder.found
    }

    /// `.then(..)`, `.catch(..)`, `.finally(..)`
    fn is_promise_call_expression(call_expr: Call) -> bool {
        matches!(callee_member(call_expr), Some((_, Some(name))) if name.is_any(&["then", "catch", "finally"]))
    }

    /// The first argument of the `expect(..)` that the chain `call_expr` starts with.
    fn find_expect_arg(call_expr: Expr<'_>) -> Option<Expr<'_>> {
        let mut at = call_expr;
        loop {
            if at.is_parenthesized() {
                return None;
            }
            at = match at.kind() {
                ExprKind::Call(call)
                    if call.callee().is_ident("expect") && !call.callee().is_parenthesized() =>
                {
                    return call.args().first().filter(|it| it.tag() != ExprTag::Spread);
                }
                ExprKind::Call(call) => call.callee(),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                _ => return None,
            };
        }
    }

    #[derive(Default)]
    struct PromiseExpectScanner<'a> {
        /// In a callback of a promise chain.
        in_promise_chain: bool,
        in_await: bool,
        /// There is an `expect()` in a callback of a promise chain that is not awaited.
        found_expect_in_promise: bool,
        /// What is awaited, or expected to resolve.
        resolved_names: SmallVec<[Name<'a>; 4]>,
        /// What `in_promise_chain` or `in_await` was before each of these expressions.
        saved: Vec<(Expr<'a>, bool)>,
        /// Nothing in it is looked at.
        skipped: Option<Expr<'a>>,
    }

    impl<'a> PromiseExpectScanner<'a> {
        fn scan(node: Node<'a>) -> Self {
            let mut scanner = PromiseExpectScanner::default();
            walk_node(node, &mut scanner);
            scanner
        }

        fn resolve_ident(&mut self, expr: Expr<'a>) {
            self.resolved_names.extend(ident_name_of(expr));
        }

        /// `Promise.all([a, b])`, `Promise.resolve(a)`
        fn collect_resolved_from_promise_wrapper(&mut self, call_expr: Call<'a>) {
            if !is_method_of_promise(call_expr) {
                return;
            }
            let first_arg = call_expr
                .args()
                .first()
                .filter(|it| it.tag() != ExprTag::Spread);
            let (Some((_, Some(name))), Some(first_arg)) = (callee_member(call_expr), first_arg)
            else {
                return;
            };
            if name.is_any(&["resolve", "reject"]) {
                self.resolve_ident(first_arg);
            } else if name.is_any(&["all", "allSettled", "race", "any"])
                && !first_arg.is_parenthesized()
                && let ExprKind::Array(elements) = first_arg.kind()
            {
                elements.iter().for_each(|it| self.resolve_ident(it));
            }
        }

        fn visit_call_expression(&mut self, e: Expr<'a>, call_expr: Call<'a>) {
            let callee_name = get_node_name_vec(call_expr.callee());
            let is_expect_node = callee_name.first().is_some_and(|it| *it == b"expect");
            if is_expect_node
                && callee_name
                    .iter()
                    .any(|it| *it == b"resolves" || *it == b"rejects")
                && let Some(expr) = find_expect_arg(e)
            {
                self.resolve_ident(expr);
            }
            self.collect_resolved_from_promise_wrapper(call_expr);
            if is_promise_call_expression(call_expr) {
                self.saved.push((e, self.in_promise_chain));
                self.in_promise_chain = !self.in_await;
            } else if self.in_promise_chain && is_expect_node {
                self.found_expect_in_promise = true;
                self.skipped = Some(e);
            }
        }
    }

    impl<'a> Visitor<'a> for PromiseExpectScanner<'a> {
        fn enter(&mut self, node: Node<'a>) {
            let Node::Expr(e) = node else {
                return;
            };
            if self.skipped.is_some() {
                return;
            }
            // Of `.then(..)` the first two arguments count.
            if let Some((promise_call, _)) = self.saved.last()
                && let Some(third) = promise_call.as_call().and_then(|it| it.args().get(2))
                && e.span().start >= third.span().start
                && e.parent() == Node::Expr(*promise_call)
            {
                self.skipped = Some(e);
                return;
            }
            match e.kind() {
                ExprKind::Call(call_expr) => self.visit_call_expression(e, call_expr),
                ExprKind::Await(argument) => {
                    self.resolve_ident(argument);
                    self.saved.push((e, self.in_await));
                    self.in_await = true;
                }
                _ => {}
            }
        }

        fn exit(&mut self, node: Node<'a>) {
            let Node::Expr(e) = node else {
                return;
            };
            if self.skipped.is_some() {
                self.skipped = self.skipped.filter(|it| *it != e);
            } else if let Some((_, before)) = self.saved.pop_if(|it| it.0 == e) {
                match e.tag() {
                    ExprTag::Await => self.in_await = before,
                    _ => self.in_promise_chain = before,
                }
            }
        }
    }
}

pub(crate) mod expect_expect {
    use super::*;

    const EXPECT_EXPECT: Message = Message::new("", "Test has no assertions");

    enum AssertFunctionMatcher {
        Exact(String),
        Pattern(Box<Regex>),
    }

    impl AssertFunctionMatcher {
        /// `None` for a pattern that is not valid.
        fn new(name: &str) -> Option<Self> {
            match name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.'))
            {
                true => Some(AssertFunctionMatcher::Exact(name.to_owned())),
                false => {
                    convert_pattern(name).map(|it| AssertFunctionMatcher::Pattern(Box::new(it)))
                }
            }
        }

        /// `name`: the names of a chain, with dots. It can go on after what is expected.
        fn is_match(&self, name: &[u8]) -> bool {
            match self {
                AssertFunctionMatcher::Pattern(pattern) => pattern.test(name),
                AssertFunctionMatcher::Exact(expected) => {
                    matches!(name.get(expected.len()), None | Some(b'.'))
                        && name
                            .get(..expected.len())
                            .is_some_and(|it| it.eq_ignore_ascii_case(expected.as_bytes()))
                }
            }
        }
    }

    pub(crate) struct ExpectExpectConfig {
        assert_function_matchers_jest: Vec<AssertFunctionMatcher>,
        assert_function_matchers_vitest: Vec<AssertFunctionMatcher>,
        additional_test_block_functions: Vec<String>,
    }

    impl ExpectExpectConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let config = options.object(0);
            let configured = config
                .get("assertFunctionNames")
                .and_then(Json::as_array)
                .map(|_| config.strings("assertFunctionNames"));
            let compile = |default: &[&str]| {
                configured
                    .as_deref()
                    .unwrap_or(default)
                    .iter()
                    .filter_map(|it| AssertFunctionMatcher::new(it))
                    .collect()
            };
            ExpectExpectConfig {
                assert_function_matchers_jest: compile(&["expect"]),
                assert_function_matchers_vitest: compile(&[
                    "expect",
                    "expectTypeOf",
                    "assert",
                    "assertType",
                ]),
                additional_test_block_functions: (config
                    .strings("additionalTestBlockFunctions")
                    .into_iter())
                .map(String::from)
                .collect(),
            }
        }

        /// `is_for_vitest`: the rule is that of `vitest`. The rule of `jest` goes by what the file imports.
        pub(crate) fn run_once<'a>(&self, ctx: &Ctx<'a, '_>, is_for_vitest: bool) {
            let use_vitest_assertions = is_for_vitest || is_vitest(ctx.file);
            let mut visitor = AssertionVisitor::new(match use_vitest_assertions {
                true => &self.assert_function_matchers_vitest,
                false => &self.assert_function_matchers_jest,
            });
            for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
                self.run(possible_jest_node, ctx, use_vitest_assertions, &mut visitor);
            }
        }

        fn run<'a>(
            &self,
            possible_jest_node: PossibleJestNode<'a>,
            ctx: &Ctx<'a, '_>,
            use_vitest_assertions: bool,
            visitor: &mut AssertionVisitor<'a, '_>,
        ) {
            let Some(call_expr) = possible_jest_node.node.as_call() else {
                return;
            };
            let callee = call_expr.callee();
            let is_additional = || {
                let name = get_node_name(callee);
                self.additional_test_block_functions
                    .iter()
                    .any(|it| it.as_bytes() == name)
            };
            let test = [JestFnKind::General(JestGeneralFnKind::Test)];
            if !is_type_of_jest_fn_call(ctx.file, possible_jest_node, &test)
                && (self.additional_test_block_functions.is_empty() || !is_additional())
            {
                return;
            }
            if let Some((_, property_name)) = callee_member(call_expr)
                && property_name
                    .is_none_or(|it| it.is("todo") || it.is("skip") && use_vitest_assertions)
            {
                return;
            }
            if !visitor.finds_assertion(call_expr.args().iter().map(Task::Check)) {
                ctx.report(callee, EXPECT_EXPECT);
            }
        }
    }

    enum Task<'a> {
        /// `check_expression`: a function expression is entered, and the function that an identifier is the name of.
        Check(Expr<'a>),
        /// As oxlint's visitor comes to it.
        Visit(Node<'a>),
        /// `visit_function_body`
        Body(Func<'a>),
        /// All that the last of `open` leads to has been looked at.
        Close,
    }

    /// What there is more than one way to: an expression that is checked (`true`), a call that is visited, a function whose body is.
    type Place<'a> = (bool, Node<'a>);

    /// oxlint's visitor stops at the first assertion. Which that is does not matter, so that the order does not either: here
    /// what is to be visited waits in a list.
    ///
    /// One is for all the tests of a file: tests can be in each other, and many can call the same functions. So it keeps for
    /// each place whether an assertion is found from it, and comes to no place twice. Functions can call each other: that
    /// nothing is found from a place is known only when all is looked at that leads back to a place that is still open, which
    /// is how the strongly connected components of a graph are found.
    struct AssertionVisitor<'a, 'm> {
        assert_function_matchers: &'m [AssertFunctionMatcher],
        pending: Vec<Task<'a>>,
        /// Whether an assertion is found from it.
        known: FxHashMap<Place<'a>, bool>,
        /// The places of which that is not known yet, in the order in which it came to them.
        unknown: Vec<Place<'a>>,
        /// Where each is in `unknown`.
        positions: FxHashMap<Place<'a>, u32>,
        /// Those that are being looked at, each in the one before: the position, and the least position that is led back to.
        open: Vec<(u32, u32)>,
    }

    impl<'a, 'm> AssertionVisitor<'a, 'm> {
        fn new(assert_function_matchers: &'m [AssertFunctionMatcher]) -> Self {
            AssertionVisitor {
                assert_function_matchers,
                pending: Vec::new(),
                known: FxHashMap::default(),
                unknown: Vec::new(),
                positions: FxHashMap::default(),
                open: Vec::new(),
            }
        }

        fn finds_assertion(&mut self, tasks: impl Iterator<Item = Task<'a>>) -> bool {
            self.pending.extend(tasks);
            let mut is_found = false;
            while !is_found && let Some(task) = self.pending.pop() {
                is_found = match task {
                    Task::Check(e) => self.check_expression(e),
                    Task::Visit(node) => self.visit(node),
                    Task::Body(func) => self.visit_function_body(func),
                    Task::Close => {
                        self.close();
                        false
                    }
                };
            }
            // Each of these is open or leads back to one that is, and the open ones lead to the assertion.
            self.known
                .extend(self.unknown.drain(..).map(|it| (it, is_found)));
            self.pending.clear();
            self.positions.clear();
            self.open.clear();
            is_found
        }

        /// Whether an assertion is found from `place`, as far as that is known. `None`: it is to be looked at now.
        fn enter(&mut self, place: Place<'a>) -> Option<bool> {
            if let Some(&known) = self.known.get(&place) {
                return Some(known);
            }
            if let Some(&position) = self.positions.get(&place) {
                if let Some((_, least)) = self.open.last_mut() {
                    *least = position.min(*least);
                }
                return Some(false);
            }
            let position = self.unknown.len() as u32;
            self.unknown.push(place);
            self.positions.insert(place, position);
            self.open.push((position, position));
            self.pending.push(Task::Close);
            None
        }

        fn close(&mut self) {
            let Some((position, least)) = self.open.pop() else {
                return;
            };
            if least < position {
                if let Some((_, least_of_outer)) = self.open.last_mut() {
                    *least_of_outer = least.min(*least_of_outer);
                }
                return;
            }
            // Nothing after it leads further back than to it.
            for place in self
                .unknown
                .drain((position as usize).min(self.unknown.len())..)
            {
                self.positions.remove(&place);
                self.known.insert(place, false);
            }
        }

        fn visit_children(&mut self, node: Node<'a>) {
            node.for_each_child(|child| self.pending.push(Task::Visit(child)));
        }

        fn visit_function_body(&mut self, func: Func<'a>) -> bool {
            if let Some(known) = self.enter((false, Node::Func(func))) {
                return known;
            }
            match func.body() {
                FnBody::Block(statements) => self
                    .pending
                    .extend(statements.iter().map(|it| Task::Visit(Node::Stmt(it)))),
                FnBody::Expr(e) => self.pending.push(Task::Visit(Node::Expr(e))),
                FnBody::None => {}
            }
            false
        }

        fn check_expression(&mut self, e: Expr<'a>) -> bool {
            if e.is_parenthesized() || e.is_chain_root() {
                return false;
            }
            let function = match e.kind() {
                ExprKind::Fn(func) => Some(func),
                ExprKind::Ident(_) => match get_declaration_of_variable(e) {
                    Some(Declaration::Fn(function)) => Some(function),
                    _ => return false,
                },
                ExprKind::Call(_) | ExprKind::Await(_) | ExprKind::Array(_) => None,
                _ => return false,
            };
            if let Some(known) = self.enter((true, Node::Expr(e))) {
                return known;
            }
            self.pending.extend(function.map(Task::Body));
            match e.kind() {
                ExprKind::Call(_) => self.pending.push(Task::Visit(Node::Expr(e))),
                ExprKind::Await(argument) => self.pending.push(Task::Check(argument)),
                ExprKind::Array(elements) => self.pending.extend(elements.iter().map(Task::Check)),
                _ => {}
            }
            false
        }

        /// Whether an assertion is known to be found from it.
        fn visit(&mut self, node: Node<'a>) -> bool {
            match node {
                Node::Expr(e) => match e.kind() {
                    ExprKind::Call(call_expr) => {
                        if let Some(known) = self.enter((false, node)) {
                            return known;
                        }
                        let name = get_node_name(call_expr.callee());
                        if self
                            .assert_function_matchers
                            .iter()
                            .any(|matcher| matcher.is_match(&name))
                        {
                            return true;
                        }
                        self.pending
                            .extend(call_expr.args().iter().map(Task::Check));
                        self.visit_children(node);
                    }
                    // A function expression and a method are entered only where they are checked.
                    ExprKind::Fn(func) if func.is_arrow() => self.pending.push(Task::Body(func)),
                    ExprKind::Fn(_) => {}
                    _ => self.visit_children(node),
                },
                Node::Stmt(statement) => match statement.kind() {
                    StmtKind::Expr(e) => self
                        .pending
                        .extend([Task::Check(e), Task::Visit(Node::Expr(e))]),
                    // Not the test, and what follows it only if it is a block.
                    StmtKind::If { yes, no, .. } => {
                        let visited = Some(yes)
                            .filter(|it| it.tag() == StmtTag::Block)
                            .into_iter()
                            .chain(no);
                        self.pending
                            .extend(visited.map(|it| Task::Visit(Node::Stmt(it))));
                    }
                    StmtKind::Fn(func) => self.pending.push(Task::Body(func)),
                    _ => self.visit_children(node),
                },
                Node::Func(func) if func.kind() == FnKind::StaticBlock => {
                    self.pending.push(Task::Body(func))
                }
                Node::Func(_) | Node::Param(_) | Node::Type(_) | Node::TypeParam(_) => {}
                _ => self.visit_children(node),
            }
            false
        }
    }
}

pub(crate) mod no_standalone_expect {
    use super::*;

    const NO_STANDALONE_EXPECT: Message =
        Message::new("", "`expect` must be inside of a test block.");

    pub(crate) struct NoStandaloneExpectConfig {
        additional_test_block_functions: Vec<String>,
    }

    /// What has been found out on long ways up, for the next that comes the same way.
    #[derive(Default)]
    struct Places<'a> {
        functions: EnclosingFunctions<'a>,
        /// Whether a function is in a place for `expect`.
        functions_in_place: FxHashMap<Func<'a>, bool>,
        /// `is_var_declarator_or_test_block` of an array, an object or a call.
        blocks: FxHashMap<Expr<'a>, bool>,
    }

    impl NoStandaloneExpectConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let names = options.object(0).strings("additionalTestBlockFunctions");
            NoStandaloneExpectConfig {
                additional_test_block_functions: names.into_iter().map(String::from).collect(),
            }
        }

        pub(crate) fn run_once<'a>(&self, ctx: &Ctx<'a, '_>) {
            let mut places = Places::default();
            for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
                let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node)
                else {
                    continue;
                };
                // Of the members of `expect` itself only `expect.hasAssertions` and `expect.assertions` count.
                if let [member] = jest_fn_call.members.as_slice()
                    && member.is_name_unequal("assertions")
                    && member.is_name_unequal("hasAssertions")
                    && jest_fn_call.head.parent_kind
                        == Some(KnownMemberExpressionParentKind::Member)
                {
                    continue;
                }
                if !self.is_correct_place_to_call_expect(possible_jest_node.node, &mut places, ctx)
                {
                    ctx.report(jest_fn_call.head.span, NO_STANDALONE_EXPECT);
                }
            }
        }

        fn is_correct_place_to_call_expect<'a>(
            &self,
            node: Expr<'a>,
            places: &mut Places<'a>,
            ctx: &Ctx<'a, '_>,
        ) -> bool {
            let (mut at, mut enclosing) = (node.span(), places.functions.of(Node::Expr(node)));
            // The functions that it goes out of. What is found further up holds for each of them.
            let mut passed = SmallVec::<[Func<'a>; 8]>::new();
            let mut is_correct = false;
            while let Some(func) = enclosing {
                let function = match func.owner() {
                    Node::Stmt(statement) => AstKind::Stmt(statement),
                    Node::Expr(e) => AstKind::Expr(e),
                    _ => AstKind::Function(func),
                };
                // The parameters of a function that is no arrow function are not in it.
                if func.is_arrow() || func.body_span().is_some_and(|body| body.contains(at)) {
                    // `function foo() { expect(1).toBe(1); }`, `test('foo', function () { expect(1).toBe(1) })`,
                    // `const foo = () => expect(1).toBe(1)`
                    is_correct = function.as_stmt().is_some()
                        || self.is_var_declarator_or_test_block(function.parent(), places, ctx);
                    if is_correct {
                        break;
                    }
                }
                if let Some(&known) = places.functions_in_place.get(&func) {
                    is_correct = known;
                    break;
                }
                passed.push(func);
                at = function.span();
                enclosing = enclosing_function(func);
            }
            if passed.spilled() {
                places
                    .functions_in_place
                    .extend(passed.iter().map(|it| (*it, is_correct)));
            }
            is_correct
        }

        fn is_var_declarator_or_test_block<'a>(
            &self,
            node: AstKind<'a>,
            places: &mut Places<'a>,
            ctx: &Ctx<'a, '_>,
        ) -> bool {
            // The arrays, objects and calls that it goes out of. The answer is the same for each of them.
            let mut passed = SmallVec::<[Expr<'a>; 8]>::new();
            let answer = self.is_var_declarator_or_test_block_unless_known(
                node,
                &places.blocks,
                &mut passed,
                ctx,
            );
            if passed.spilled() {
                places.blocks.extend(passed.iter().map(|it| (*it, answer)));
            }
            answer
        }

        fn is_var_declarator_or_test_block_unless_known<'a>(
            &self,
            node: AstKind<'a>,
            known: &FxHashMap<Expr<'a>, bool>,
            passed: &mut SmallVec<[Expr<'a>; 8]>,
            ctx: &Ctx<'a, '_>,
        ) -> bool {
            let is_in_literal = |it: AstKind| match it {
                AstKind::Expr(e) => matches!(e.tag(), ExprTag::Array | ExprTag::Object),
                AstKind::Other(Node::Prop(property)) => !property.is_jsx_attribute(),
                _ => false,
            };
            let mut at = node;
            // What a function is an element or a property of, however deep, stands for it.
            while is_in_literal(at) {
                if let AstKind::Expr(e) = at {
                    if let Some(&answer) = known.get(&e) {
                        return answer;
                    }
                    passed.push(e);
                }
                at = at.parent();
            }
            if matches!(at, AstKind::Other(Node::VarDecl(_))) {
                return true;
            }
            // `it.each(..)(..)`: the call of what a call returns is asked next.
            while let Some(e) = at.as_expr()
                && let Some(call_expr) = e.as_call()
            {
                if let Some(&answer) = known.get(&e) {
                    return answer;
                }
                passed.push(e);
                if !self.additional_test_block_functions.is_empty() {
                    let node_name = get_node_name(call_expr.callee());
                    if self
                        .additional_test_block_functions
                        .iter()
                        .any(|it| it.as_bytes() == node_name)
                    {
                        return true;
                    }
                }
                if let Some(jest_node) = possible_jest_node_of(ctx.file, e)
                    && let Some(jest_fn_call) = parse_general_jest_fn_call(ctx.file, jest_node)
                {
                    return jest_fn_call.kind == JestFnKind::General(JestGeneralFnKind::Test);
                }
                at = at.parent();
            }
            false
        }
    }
}

pub(crate) mod no_conditional_expect {
    use super::*;

    const NO_CONDITIONAL_EXPECT: Message = Message::new("", "Unexpected conditional expect");

    /// What the way up from an `expect` stops at.
    #[derive(Copy, Clone)]
    enum Stop<'a> {
        /// An `if`, a `switch`, a `catch`, `a ? b : c`, `a && b`, `.catch(..)`
        Conditional,
        /// A call of `it` or `test`.
        Test,
        /// A function that is no arrow function.
        Function(Func<'a>),
    }

    fn is_test<'a>(file: &'a File<'a>, node: Node<'a>) -> bool {
        node.as_expr()
            .filter(|it| it.tag() == ExprTag::Call)
            .is_some_and(|it| {
                is_type_of_jest_fn_call(
                    file,
                    PossibleJestNode::new(it),
                    &[JestFnKind::General(JestGeneralFnKind::Test)],
                )
            })
    }

    /// Where the way ends.
    fn end<'a>(file: &'a File<'a>, parent: Node<'a>) -> Option<Stop<'a>> {
        match parent {
            Node::Func(func) => (!func.is_arrow() && func.kind() != FnKind::StaticBlock)
                .then_some(Stop::Function(func)),
            _ => is_test(file, parent).then_some(Stop::Test),
        }
    }

    fn is_conditional<'a>(child: Node<'a>, parent: Node<'a>) -> bool {
        match parent {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::If { .. } | StmtKind::Switch { .. } => true,
                StmtKind::Try { param, handler, .. } => match child {
                    Node::VarDecl(it) => Some(it) == param,
                    _ => child.as_stmt() == handler,
                },
                _ => false,
            },
            Node::Expr(e) => match e.kind() {
                ExprKind::Cond { .. }
                | ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                } => true,
                ExprKind::Call(call_expr) => {
                    matches!(callee_member(call_expr), Some((_, Some(name))) if name.is("catch"))
                }
                _ => false,
            },
            _ => false,
        }
    }

    pub(crate) fn run<'a>(ctx: &Ctx<'a, '_>) {
        let file = ctx.file;
        // The first of all stops, the end of the way, and whether something is in a test.
        let (mut stops, mut ends, mut tests) = (
            AncestorMemo::default(),
            AncestorMemo::default(),
            AncestorMemo::default(),
        );
        for possible_jest_node in iter_possible_jest_call_node(file) {
            let Some(jest_fn_call) = parse_expect_jest_fn_call(file, possible_jest_node) else {
                continue;
            };
            let node = Node::Expr(possible_jest_node.node);
            let first = stops.find(node, |child, parent| {
                end(file, parent)
                    .or_else(|| is_conditional(child, parent).then_some(Stop::Conditional))
            });
            if !matches!(first, Some(Stop::Conditional)) {
                continue;
            }
            let is_in_test = match ends.find(node, |_, parent| end(file, parent)) {
                Some(Stop::Function(function)) => function
                    .name()
                    .and_then(|_| function.symbol())
                    .is_some_and(|symbol| {
                        (symbol.references().filter_map(Reference::expr)).any(|it| {
                            tests
                                .find(Node::Expr(it), |_, parent| {
                                    is_test(file, parent).then_some(())
                                })
                                .is_some()
                        })
                    }),
                Some(_) => true,
                None => false,
            };
            if is_in_test {
                ctx.report(jest_fn_call.head.span, NO_CONDITIONAL_EXPECT);
            }
        }
    }
}

pub(crate) mod max_expects {
    use super::*;

    const EXCEEDED_MAX_ASSERTION: Message = Message::new(
        "",
        "Enforces a maximum number assertion calls in a test body.",
    );

    pub(crate) fn run_once<'a>(max: u32, ctx: &Ctx<'a, '_>) {
        let mut scopes = Scopes::default();
        // How many there are in each scope. A block is one.
        let mut count_map: FxHashMap<Option<Node<'a>>, u32> = FxHashMap::default();
        for jest_node in iter_possible_jest_call_node(ctx.file) {
            let Some(ident) = jest_node
                .node
                .callee()
                .filter(|it| it.is_ident("expect") && !it.is_parenthesized())
            else {
                continue;
            };
            let count = count_map
                .entry(scopes.of(Node::Expr(jest_node.node)))
                .or_insert(0);
            *count += 1;
            // The first is never too many.
            if *count > max.max(1) {
                ctx.report(ident, EXCEEDED_MAX_ASSERTION);
            }
        }
    }
}

pub(crate) mod prefer_expect_assertions {
    use super::*;
    use std::borrow::Cow;

    const HAVE_EXPECT_ASSERTIONS_JEST: Message = Message::new(
        "",
        "Every test should have either `{{prefix}}.assertions(<number of assertions>)` or `{{prefix}}.hasAssertions()` as its first expression.",
    );
    const HAVE_EXPECT_ASSERTIONS_VITEST: Message = Message::new(
        "",
        "This test should have either `{{prefix}}.assertions(<number of assertions>)` or `{{prefix}}.hasAssertions()` as its first expression.",
    );
    const EXPECT_SHADOWED_BY_PARAMETER: Message = Message::new(
        "",
        "`expect` is shadowed by a callback parameter and cannot be used for assertions.",
    );
    const HAS_ASSERTIONS_TAKES_NO_ARGUMENTS: Message =
        Message::new("", "`{{prefix}}.hasAssertions` expects no arguments.");
    const ASSERTIONS_REQUIRES_ONE_ARGUMENT: Message = Message::new(
        "",
        "`{{prefix}}.assertions` expects a single argument of type number.",
    );
    const ASSERTIONS_REQUIRES_NUMBER_ARGUMENT: Message =
        Message::new("", "This argument should be a number.");
    const REMOVE_EXTRA_ARGUMENTS: Message = Message::new("", "Remove extra arguments");
    const ADD_HAS_ASSERTIONS: Message = Message::new("", "Add `{{prefix}}.hasAssertions()`");
    const ADD_ASSERTIONS: Message =
        Message::new("", "Add `{{prefix}}.assertions(<number of assertions>)");

    pub(crate) struct PreferExpectAssertionsConfig {
        only_functions_with_async_keyword: bool,
        only_functions_with_expect_in_callback: bool,
        only_functions_with_expect_in_loop: bool,
    }

    /// The names of what is called are `prefix`, or start with it and a dot.
    fn is_expect_call(call_expr: Call, prefix: &[u8]) -> bool {
        get_node_name(call_expr.callee())
            .strip_prefix(prefix)
            .is_some_and(|rest| matches!(rest.first(), None | Some(b'.')))
    }

    /// What the body of `callback` consists of.
    fn body_nodes(callback: Func<'_>) -> impl Iterator<Item = Node<'_>> {
        let expression = match callback.body() {
            FnBody::Expr(e) => Some(Node::Expr(e)),
            _ => None,
        };
        callback
            .body_statements()
            .into_iter()
            .flatten()
            .map(Node::Stmt)
            .chain(expression)
    }

    /// Calls `visit` with every call in `nodes`, until it returns `true`.
    fn any_call<'a>(
        nodes: impl Iterator<Item = Node<'a>>,
        visit: &mut dyn FnMut(Expr<'a>, Call<'a>) -> bool,
    ) -> bool {
        struct Calls<'a, 'v> {
            visit: &'v mut dyn FnMut(Expr<'a>, Call<'a>) -> bool,
            found: bool,
        }
        impl<'a> Visitor<'a> for Calls<'a, '_> {
            fn enter(&mut self, node: Node<'a>) {
                if !self.found
                    && let Node::Expr(e) = node
                    && let Some(call_expr) = e.as_call()
                {
                    self.found = (self.visit)(e, call_expr);
                }
            }
            fn exit(&mut self, _: Node<'a>) {}
        }
        let mut calls = Calls {
            visit,
            found: false,
        };
        nodes.for_each(|it| walk_node(it, &mut calls));
        calls.found
    }

    /// `arguments_span()`, and what a fix removes: up to the `)`.
    fn arguments_spans(call: Expr, call_expr: Call) -> Option<(Span, Span)> {
        let (first, last) = (
            call_expr.args().first()?.outer_span(),
            call_expr.args().last()?.outer_span(),
        );
        Some((
            first.to(last),
            Span::new(first.start, call.span().end.saturating_sub(1)),
        ))
    }

    fn is_describe_call(node: Node) -> bool {
        let Some(callee) = node
            .as_expr()
            .and_then(Expr::as_call)
            .map(Call::callee)
            .filter(|it| !it.is_parenthesized())
        else {
            return false;
        };
        fn object_name(member: Expr<'_>) -> Option<&[u8]> {
            match member.kind() {
                ExprKind::Dot { obj, .. }
                    if !member.is_private_member() && !member.is_parenthesized() =>
                {
                    get_inner_expression(obj).as_ident().map(Name::bytes)
                }
                _ => None,
            }
        }
        let callee_name = match callee.kind() {
            ExprKind::Ident(name) => Some(name.bytes()),
            ExprKind::TaggedTemplate(tagged) => object_name(tagged.callee()),
            _ => object_name(callee),
        };
        callee_name.is_some_and(|it| {
            JestFnKind::from(it) == JestFnKind::General(JestGeneralFnKind::Describe)
        })
    }

    /// The last argument that is a function.
    fn find_test_callback(call_expr: Call<'_>) -> Option<(Expr<'_>, Func<'_>)> {
        call_expr
            .args()
            .iter()
            .rev()
            .find_map(|it| Some((it, it.as_fn().filter(|_| !it.is_parenthesized())?)))
    }

    /// `ctx.expect` for the parameter `ctx`, `e` for `{ expect: e }`.
    fn resolve_expect_parameter_prefix_from_pattern(pattern: Pat<'_>) -> Option<Cow<'_, [u8]>> {
        match pattern.kind() {
            PatKind::Ident(name) => {
                Some(Cow::Owned([name.bytes(), b".expect".as_slice()].concat()))
            }
            PatKind::Object(properties) => {
                let prop = properties
                    .iter()
                    .find(|p| p.key().is_some_and(|it| it.is("expect")))?;
                let local_name = prop.value().as_ident().filter(|_| prop.default().is_none());
                Some(Cow::Borrowed(
                    local_name.map_or(b"expect".as_slice(), Name::bytes),
                ))
            }
            _ => None,
        }
    }

    /// Without a rest parameter.
    fn parameters(callback: Func<'_>) -> SmallVec<[Param<'_>; 4]> {
        callback
            .params()
            .iter()
            .filter(|it| !it.is_rest())
            .collect()
    }

    /// Which parameter of the callback of `it.each(rows)(..)` or `it.for(rows)(..)` is the context of the test.
    fn parameterized_context_parameter_index(call_expr: Call) -> Option<usize> {
        let parameterized_call = Some(call_expr.callee())
            .filter(|it| !it.is_parenthesized())?
            .as_call()?;
        let method = callee_member(parameterized_call)?.1?;
        if method.is("for") {
            return Some(1);
        }
        let first = parameterized_call
            .args()
            .first()
            .filter(|it| method.is("each") && it.tag() != ExprTag::Spread)?;
        let ExprKind::Array(rows) = get_inner_expression(first).kind() else {
            return None;
        };
        let each_row_argument_count = |row: Expr| match get_inner_expression(row).kind() {
            _ if row.tag() == ExprTag::Spread || row.is_missing() => None,
            ExprKind::Array(arguments) => arguments
                .iter()
                .all(|it| it.tag() != ExprTag::Spread)
                .then_some(arguments.len()),
            _ => Some(1),
        };
        let mut argument_counts = rows.iter().map(each_row_argument_count);
        let argument_count = argument_counts.next()??;
        argument_counts
            .all(|count| count == Some(argument_count))
            .then_some(argument_count)
    }

    impl PreferExpectAssertionsConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let config = options.object(0);
            PreferExpectAssertionsConfig {
                only_functions_with_async_keyword: config
                    .bool_or("onlyFunctionsWithAsyncKeyword", false),
                only_functions_with_expect_in_callback: config
                    .bool_or("onlyFunctionsWithExpectInCallback", false),
                only_functions_with_expect_in_loop: config
                    .bool_or("onlyFunctionsWithExpectInLoop", false),
            }
        }

        pub(crate) fn run_once<'a>(&self, ctx: &Ctx<'a, '_>, is_for_vitest: bool) {
            // What `expect` is imported as.
            let file_expect_prefix = (import_entries(ctx.file).filter(|it| !it.is_type()))
                .filter(|it| match it.declaration.spec().bytes() {
                    b"@jest/globals" => !is_for_vitest,
                    source => is_for_vitest && is_vitest_import_source(source),
                })
                .find(|it| matches!(it.import_name, ImportImportName::Name(it) if it.imported().bytes() == b"expect"))
                .map_or(b"expect".as_slice(), |it| it.local_name().bytes());
            // The calls of `describe` with a hook that calls `expect.hasAssertions()` before or after each test. `None` is the file.
            let mut covered_describe_ids: Vec<Option<Node<'a>>> = Vec::new();
            for jest_node in iter_possible_jest_call_node(ctx.file) {
                let Some(call_expr) = jest_node.node.as_call() else {
                    continue;
                };
                let Some(general) = parse_general_jest_fn_call(ctx.file, jest_node) else {
                    continue;
                };
                match general.kind {
                    JestFnKind::General(JestGeneralFnKind::Hook)
                        if general.name.ends_with(b"Each") =>
                    {
                        check_each_hook(
                            jest_node.node,
                            call_expr,
                            file_expect_prefix,
                            &mut covered_describe_ids,
                            ctx,
                        );
                    }
                    JestFnKind::General(JestGeneralFnKind::Test) => {
                        let is_parameterized = general.members.iter().any(|member| {
                            member.is_name_equal("each") || member.is_name_equal("for")
                        });
                        let is_covered = covered_describe_ids.contains(&None)
                            || !covered_describe_ids.is_empty()
                                && (Node::Expr(jest_node.node).ancestors()).any(|it| {
                                    is_describe_call(it) && covered_describe_ids.contains(&Some(it))
                                });
                        if !is_covered {
                            self.check_test(
                                jest_node.node,
                                call_expr,
                                is_parameterized,
                                file_expect_prefix,
                                is_for_vitest,
                                ctx,
                            );
                        }
                    }
                    _ => {}
                }
            }
        }

        fn check_test<'a>(
            &self,
            node: Expr<'a>,
            call_expr: Call<'a>,
            is_parameterized: bool,
            file_expect_prefix: &'a [u8],
            is_for_vitest: bool,
            ctx: &Ctx<'a, '_>,
        ) {
            let Some((callback, func)) = find_test_callback(call_expr)
                .filter(|it| call_expr.args().len() >= 2 && it.1.has_body())
            else {
                return;
            };
            let parameters = parameters(func);
            let parameter_prefix = |index: usize| {
                resolve_expect_parameter_prefix_from_pattern(parameters.get(index)?.pat())
            };
            let prefix = if !is_for_vitest {
                if func.scope().is_some_and(|it| it.get("expect").is_some()) {
                    ctx.report(call_expr.callee(), EXPECT_SHADOWED_BY_PARAMETER);
                    return;
                }
                None
            } else if is_parameterized {
                parameterized_context_parameter_index(call_expr)
                    .and_then(parameter_prefix)
                    .or_else(|| {
                        // The last parameter that `expect` is taken from.
                        parameters
                            .iter()
                            .enumerate()
                            .rev()
                            .find_map(|(index, param)| {
                                let prefix = Some(param.pat())
                                    .filter(|it| index != 0 || it.tag() == PatTag::Object);
                                prefix
                                    .and_then(resolve_expect_parameter_prefix_from_pattern)
                                    .filter(|prefix| {
                                        any_call(
                                            std::iter::once(Node::Expr(callback)),
                                            &mut |_, call_expr| is_expect_call(call_expr, prefix),
                                        )
                                    })
                            })
                    })
            } else {
                parameter_prefix(0)
            };
            let prefix = prefix.unwrap_or(Cow::Borrowed(file_expect_prefix));
            let has_options = self.only_functions_with_async_keyword
                || self.only_functions_with_expect_in_callback
                || self.only_functions_with_expect_in_loop;
            if has_options
                && !self.should_check(func, &prefix)
                && !(is_for_vitest
                    && *prefix != *file_expect_prefix
                    && self.should_check(func, file_expect_prefix))
            {
                return;
            }
            if check_first_statement(func, &prefix, ctx) {
                return;
            }
            let message = if is_for_vitest {
                HAVE_EXPECT_ASSERTIONS_VITEST
            } else {
                HAVE_EXPECT_ASSERTIONS_JEST
            };
            let mut report = ctx.report(node, message).data("prefix", prefix.to_vec());
            for (message, method) in [
                (ADD_HAS_ASSERTIONS, ".hasAssertions();"),
                (ADD_ASSERTIONS, ".assertions();"),
            ] {
                let call = [&*prefix, method.as_bytes()].concat();
                report = report.suggest_with(message, &[("prefix", &*prefix)], |fixer| match func
                    .body()
                {
                    FnBody::Expr(expression) => {
                        let source = fixer.file().slice(expression.outer_span());
                        let code = [
                            b"{".as_slice(),
                            &call,
                            b"return ".as_slice(),
                            source,
                            b";}".as_slice(),
                        ]
                        .concat();
                        Some(fixer.replace(expression.outer_span(), code))
                    }
                    _ => Some(fixer.insert_before(Span::empty(func.body_span()?.start + 1), call)),
                });
            }
        }

        fn should_check(&self, callback: Func, prefix: &[u8]) -> bool {
            if self.only_functions_with_async_keyword && callback.is_async() {
                return true;
            }
            if !self.only_functions_with_expect_in_callback
                && !self.only_functions_with_expect_in_loop
            {
                return false;
            }
            let mut scanner = BodyScanner {
                prefix,
                expression_depth: 0,
                loop_depth: 0,
                in_callback: false,
                in_loop: false,
            };
            body_nodes(callback).for_each(|it| walk_node(it, &mut scanner));
            self.only_functions_with_expect_in_callback && scanner.in_callback
                || self.only_functions_with_expect_in_loop && scanner.in_loop
        }
    }

    fn check_each_hook<'a>(
        hook: Expr<'a>,
        call_expr: Call<'a>,
        file_expect_prefix: &'a [u8],
        covered_describe_ids: &mut Vec<Option<Node<'a>>>,
        ctx: &Ctx<'a, '_>,
    ) {
        let Some((_, func)) = find_test_callback(call_expr) else {
            return;
        };
        let expected_name = [file_expect_prefix, b".hasAssertions".as_slice()].concat();
        let (mut has_expect_has_assertions, mut invalid_args) = (false, None);
        any_call(body_nodes(func), &mut |call, call_expr| {
            if get_node_name(call_expr.callee()) == expected_name {
                has_expect_has_assertions = true;
                invalid_args = arguments_spans(call, call_expr).or(invalid_args);
            }
            false
        });
        if !has_expect_has_assertions {
            return;
        }
        if let Some((args_span, delete_span)) = invalid_args {
            (ctx.report(args_span, HAS_ASSERTIONS_TAKES_NO_ARGUMENTS)
                .data("prefix", file_expect_prefix))
            .suggest(REMOVE_EXTRA_ARGUMENTS, |fixer| fixer.remove(delete_span));
        }
        let parent_describe_id = Node::Expr(hook)
            .ancestors()
            .find(|it| is_describe_call(*it));
        if !covered_describe_ids.contains(&parent_describe_id) {
            covered_describe_ids.push(parent_describe_id);
        }
    }

    /// Whether the test starts with `expect.hasAssertions()` or `expect.assertions(1)`. The arguments are checked.
    fn check_first_statement<'a>(callback: Func<'a>, prefix: &[u8], ctx: &Ctx<'a, '_>) -> bool {
        let first_expression = match callback.body() {
            FnBody::Expr(e) => Some(e),
            _ => match callback
                .body_statements()
                .and_then(|it| it.iter().find(|it| it.directive().is_none()))
                .map(Stmt::kind)
            {
                Some(StmtKind::Expr(e)) => Some(e),
                _ => None,
            },
        };
        let Some(first) =
            first_expression.filter(|it| !it.is_parenthesized() && !it.is_chain_root())
        else {
            return false;
        };
        let Some(first_call) = first.as_call() else {
            return false;
        };
        let (name, arguments) = (get_node_name(first_call.callee()), first_call.args());
        if name.ends_with(b"hasAssertions") {
            if let Some((args_span, delete_span)) = arguments_spans(first, first_call) {
                (ctx.report(args_span, HAS_ASSERTIONS_TAKES_NO_ARGUMENTS)
                    .data("prefix", prefix.to_vec()))
                .suggest(REMOVE_EXTRA_ARGUMENTS, |fixer| fixer.remove(delete_span));
            }
            return true;
        }
        if !name.ends_with(b"assertions") {
            return false;
        }
        match (arguments.first(), arguments.len()) {
            (None, _) => {
                ctx.report(
                    first_call.callee().outer_span(),
                    ASSERTIONS_REQUIRES_ONE_ARGUMENT,
                )
                .data("prefix", prefix.to_vec());
            }
            (Some(arg), 1) => {
                if arg.tag() != ExprTag::Number || arg.is_parenthesized() {
                    ctx.report(arg.outer_span(), ASSERTIONS_REQUIRES_NUMBER_ARGUMENT);
                }
            }
            (Some(arg), _) => {
                let extra_span = Span::after(arg.outer_span(), first.span().end.saturating_sub(1));
                (ctx.report(extra_span, ASSERTIONS_REQUIRES_ONE_ARGUMENT)
                    .data("prefix", prefix.to_vec()))
                .suggest(REMOVE_EXTRA_ARGUMENTS, |fixer| fixer.remove(extra_span));
            }
        }
        true
    }

    struct BodyScanner<'p> {
        prefix: &'p [u8],
        /// In how many functions it is.
        expression_depth: u32,
        loop_depth: u32,
        in_callback: bool,
        in_loop: bool,
    }

    /// Whether `node` adds to `expression_depth`.
    fn is_function_with_body(node: Node) -> bool {
        matches!(node, Node::Func(func) if func.has_body() && func.kind() != FnKind::StaticBlock)
    }

    /// Whether `node` adds to `loop_depth`.
    fn is_loop(node: Node) -> bool {
        matches!(node, Node::Stmt(statement) if statement.is_loop())
    }

    impl<'a> Visitor<'a> for BodyScanner<'_> {
        fn enter(&mut self, node: Node<'a>) {
            self.expression_depth += u32::from(is_function_with_body(node));
            self.loop_depth += u32::from(is_loop(node));
            if let Node::Expr(e) = node
                && let Some(call_expr) = e.as_call()
                && (self.expression_depth > 0 && !self.in_callback
                    || self.loop_depth > 0 && !self.in_loop)
                && is_expect_call(call_expr, self.prefix)
            {
                self.in_callback |= self.expression_depth > 0;
                self.in_loop |= self.loop_depth > 0;
            }
        }

        fn exit(&mut self, node: Node<'a>) {
            self.expression_depth -= u32::from(is_function_with_body(node));
            self.loop_depth -= u32::from(is_loop(node));
        }
    }
}
