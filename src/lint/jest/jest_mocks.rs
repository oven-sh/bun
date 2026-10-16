//! What the rules of `jest` and of `vitest` about mocks do: `jest.fn()`, `vi.mock(..)`, `.mockReturnValue(..)`. Each module is a file
//! of oxlint's `rules/shared/jest_vitest`. See [`jest`](crate::jest).

use crate::jest::{
    Ctx, JestFnKind, JestGeneralFnKind, ParsedJestFnCall, PossibleJestNode, Runner, get_node_name,
    is_type_of_jest_fn_call, mention_bits, mentions_any, parent_expression, parse_jest_fn_call_in,
    print_expression,
};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::IdMap;
use bun_lint_oxlint::ast_util::{as_member_expression, static_property_info};
use bun_lint_oxlint::import::{ImportImportName, import_entries, import_entries_of};
use smallvec::SmallVec;

/// Not in parentheses, and not the whole of an optional chain.
fn is_plain(e: Expr) -> bool {
    !e.is_parenthesized() && !e.is_chain_root()
}

/// The statements of a body without the directives.
fn statements_of(func: Func<'_>) -> Option<impl Iterator<Item = Stmt<'_>>> {
    func.body_statements()
        .map(|it| it.iter().filter(|it| it.directive().is_none()))
}

/// Those of `names` that the file has.
fn find_names<'a>(file: &'a File<'a>, names: &[&str]) -> SmallVec<[Name<'a>; 4]> {
    names.iter().filter_map(|it| file.find_name(it)).collect()
}

/// `a.mockImplementation(..)`: where the name of the method is written, the name, which is one of `names`, and the first argument,
/// which is no `...a`.
fn method_call_with_argument<'a>(
    node: Expr<'a>,
    names: &[Name<'a>],
) -> Option<(Span, Name<'a>, Expr<'a>)> {
    let call_expr = node.as_call()?;
    let callee = call_expr.callee();
    if callee
        .member_name()
        .is_some_and(|it| !names.contains(&it.name()))
    {
        return None;
    }
    let (property_span, property_name) =
        static_property_info(as_member_expression(callee)?).filter(|it| names.contains(&it.1))?;
    Some((
        property_span,
        property_name,
        call_expr
            .args()
            .first()
            .filter(|it| it.tag() != ExprTag::Spread)?,
    ))
}

pub(crate) mod no_mocks_import {
    use super::*;

    const NO_MOCKS_IMPORT: Message = Message::new(
        "",
        "Mocks should not be manually imported from a `__mocks__` directory.",
    );

    pub(crate) fn run_once(ctx: &Ctx) {
        for declaration in ctx.file.body().iter().filter_map(Stmt::as_import) {
            if contains_mocks_dir(declaration.spec().bytes())
                && let Some(span) = declaration.spec_span()
            {
                // Once for each name that is imported.
                for _ in import_entries_of(declaration) {
                    ctx.report(span, NO_MOCKS_IMPORT);
                }
            }
        }
        if !ctx.file.mentions("require") {
            return;
        }
        // It stops at the first `require` that is not called with a string.
        for reference in ctx.file.unresolved_references_to(b"require") {
            let call_expr = reference
                .expr()
                .and_then(parent_expression)
                .and_then(Expr::as_call);
            let argument = call_expr.and_then(|it| it.args().first());
            let Some((argument, ExprKind::String(value))) = argument
                .filter(|it| !it.is_parenthesized())
                .map(|it| (it, it.kind()))
            else {
                return;
            };
            if contains_mocks_dir(value.bytes()) {
                ctx.report(argument, NO_MOCKS_IMPORT);
            }
        }
    }

    fn contains_mocks_dir(value: &[u8]) -> bool {
        strings::contains_char(value, b'_')
            && strings::contains(value, b"__mocks__")
            && strings::split(value, b"/").any(|it| it == b"__mocks__")
    }
}

pub(crate) mod no_restricted_jest_methods {
    use super::*;

    const RESTRICTED_JEST_METHOD: Message =
        Message::new("", "Use of `{{method_name}}` is not allowed");
    const RESTRICTED_JEST_METHOD_WITH_MESSAGE: Message = Message::new("", "{{message}}");

    pub(crate) struct NoRestrictedTestMethodsConfig {
        /// Each with the message, if there is one.
        restricted_methods: Vec<(Vec<u8>, Option<Vec<u8>>)>,
    }

    impl NoRestrictedTestMethodsConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let restricted_methods = options.object(0).entries().iter();
            NoRestrictedTestMethodsConfig {
                restricted_methods: restricted_methods
                    .map(|it| (it.0.clone(), it.1.as_str().map(<[u8]>::to_vec)))
                    .collect(),
            }
        }

        pub(crate) fn is_empty(&self) -> bool {
            self.restricted_methods.is_empty()
        }

        pub(crate) fn run<'a>(&self, possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
            let kinds = [
                JestFnKind::General(JestGeneralFnKind::Jest),
                JestFnKind::General(JestGeneralFnKind::Vitest),
            ];
            if let Some(mem_expr) = possible_jest_node
                .node
                .callee()
                .and_then(as_member_expression)
                && let Some((span, property_name)) = static_property_info(mem_expr)
                && let Some((_, message)) = self
                    .restricted_methods
                    .iter()
                    .find(|it| it.0 == property_name.bytes())
                && is_type_of_jest_fn_call(ctx.file, possible_jest_node, &kinds)
            {
                match message {
                    Some(message) => ctx
                        .report(span, RESTRICTED_JEST_METHOD_WITH_MESSAGE)
                        .data("message", message.clone()),
                    None => ctx
                        .report(span, RESTRICTED_JEST_METHOD)
                        .data("method_name", property_name),
                };
            }
        }
    }
}

pub(crate) mod prefer_mock_promise_shorthand {
    use super::*;

    const USE_MOCK_SHORTHAND: Message =
        Message::new("", "Prefer mock resolved/rejected shorthands for promises.");

    const METHODS: [&str; 4] = [
        "mockReturnValue",
        "mockReturnValueOnce",
        "mockImplementation",
        "mockImplementationOnce",
    ];

    pub(crate) fn should_run(file: &File) -> bool {
        file.mentions("Promise") && mentions_any(file, &const { mention_bits(METHODS) })
    }

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        let methods = find_names(ctx.file, &METHODS);
        for node in (ctx.file.exprs_of_kind(ExprTag::Call)).take_while(|_| !methods.is_empty()) {
            let Some((property_span, property_name, expr)) =
                method_call_with_argument(node, &methods)
            else {
                continue;
            };
            let (is_once, is_implementation) = match property_name.bytes() {
                b"mockReturnValue" => (false, false),
                b"mockReturnValueOnce" => (true, false),
                b"mockImplementation" => (false, true),
                b"mockImplementationOnce" => (true, true),
                _ => continue,
            };
            // What the function returns, which has no parameters. A rest parameter does not count.
            let arg_expr = match expr.as_fn().filter(|_| is_implementation) {
                _ if !is_implementation => Some(expr),
                Some(func)
                    if !expr.is_parenthesized() && func.params().iter().all(Param::is_rest) =>
                {
                    match func.body() {
                        FnBody::Expr(e) => Some(e),
                        _ => match statements_of(func)
                            .and_then(|mut it| it.next())
                            .map(Stmt::kind)
                        {
                            Some(StmtKind::Return(argument)) => argument,
                            _ => None,
                        },
                    }
                }
                _ => None,
            };
            if let Some(arg_expr) = arg_expr {
                report(
                    is_once,
                    property_span,
                    is_implementation.then(|| expr.span()),
                    arg_expr,
                    ctx,
                );
            }
        }
    }

    fn report<'a>(
        is_once: bool,
        property_span: Span,
        arg_span: Option<Span>,
        arg_expr: Expr<'a>,
        ctx: &Ctx<'a, '_>,
    ) {
        let Some(call_expr) = arg_expr.as_call().filter(|_| is_plain(arg_expr)) else {
            return;
        };
        let prefer_name = match (get_node_name(arg_expr).as_slice(), is_once) {
            (b"Promise.resolve", false) => "mockResolvedValue",
            (b"Promise.resolve", true) => "mockResolvedValueOnce",
            (b"Promise.reject", false) => "mockRejectedValue",
            (b"Promise.reject", true) => "mockRejectedValueOnce",
            _ => return,
        };
        let report = ctx
            .report(property_span, USE_MOCK_SHORTHAND)
            .data("preferred_name", prefer_name);
        if call_expr.args().len() <= 1 {
            report.fix(|fixer| {
                let mut content = [prefer_name.as_bytes(), b"(".as_slice()].concat();
                match call_expr.args().first() {
                    None => content.extend_from_slice(b"undefined"),
                    Some(argument) if argument.tag() == ExprTag::Spread => {}
                    Some(argument) => print_expression(&mut content, argument),
                }
                fixer.replace(
                    Span::new(
                        property_span.start,
                        arg_span.unwrap_or_else(|| arg_expr.span()).end,
                    ),
                    content,
                )
            });
        }
    }
}

pub(crate) mod prefer_mock_return_shorthand {
    use super::*;

    const PREFER_MOCK_RETURN_SHORTHAND: Message = Message::new(
        "",
        "Mock functions that return simple values should use `mockReturnValue/mockReturnValueOnce`.",
    );

    const METHODS: [&str; 2] = ["mockImplementation", "mockImplementationOnce"];

    pub(crate) fn should_run(file: &File) -> bool {
        mentions_any(file, &const { mention_bits(METHODS) })
    }

    /// `a.mockImplementation(() => 1)`
    struct Mock<'a> {
        property_span: Span,
        new_property_name: &'static str,
        /// The function, as the argument.
        expr: Expr<'a>,
        func: Func<'a>,
        return_expression: Expr<'a>,
    }

    fn as_mock<'a>(node: Expr<'a>, methods: &[Name<'a>], runner: Runner) -> Option<Mock<'a>> {
        let (property_span, property_name, expr) = method_call_with_argument(node, methods)?;
        let new_property_name = match property_name.bytes() {
            b"mockImplementation" => "mockReturnValue",
            b"mockImplementationOnce" => "mockReturnValueOnce",
            _ => return None,
        };
        let (func, return_expression) = get_mock_return(expr, runner)?;
        let is_update = matches!(
            return_expression.unary_op(),
            Some(UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec)
        );
        (!is_update || return_expression.is_parenthesized()).then_some(Mock {
            property_span,
            new_property_name,
            expr,
            func,
            return_expression,
        })
    }

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        let methods = find_names(ctx.file, &METHODS);
        let mut mocks: Vec<Mock<'a>> = ctx
            .file
            .exprs_of_kind(ExprTag::Call)
            .take_while(|_| !methods.is_empty())
            .filter_map(|it| as_mock(it, &methods, ctx.runner))
            .collect();
        // What is returned by one can have others in it. These come first, and are not looked at again.
        utils::sort::sort_unstable_by_key(&mut mocks, |it| {
            std::cmp::Reverse(it.return_expression.span().start)
        });
        let mut visitor = ReturnedExpressionVisitor::default();
        for Mock {
            property_span,
            new_property_name,
            expr,
            func,
            return_expression,
        } in mocks
        {
            let found = visitor.visit(return_expression);
            if !func.is_arrow() && found.has_this_expression || found.has_mutable_reference {
                continue;
            }
            // `mockReturnValue(create())` would call `create` once instead of on every call.
            if ctx.runner == Runner::Bun && found.contains_call_like_expression {
                continue;
            }
            let report = ctx
                .report(property_span, PREFER_MOCK_RETURN_SHORTHAND)
                .data("current_property", ctx.file.slice(property_span))
                .data("replacement", new_property_name);
            if !found.contains_call_like_expression {
                report.fix(|fixer| {
                    [
                        fixer.replace(property_span, new_property_name),
                        fixer.replace(expr, return_expression.text()),
                    ]
                });
            }
        }
    }

    fn is_mutable(symbol: Symbol) -> bool {
        symbol.has_modifying_references()
            || matches!(
                symbol.declarations().next(),
                Some(Declaration::Var(pat)) if Node::Pat(pat).ancestors().find_map(|it| match it {
                    // Not the parameter of a `catch`.
                    Node::VarDecl(declarator) => Some(
                        declarator.var_kind() != VarKind::Const && it.parent().as_stmt().is_some_and(|it| it.tag() == StmtTag::Var),
                    ),
                    Node::Pat(_) | Node::PatProp(_) | Node::PatElem(_) => None,
                    _ => Some(false),
                }) == Some(true)
            )
    }

    /// The function `argument_expression`, which is not `async` and has no parameters, and what it returns, if it does nothing else.
    fn get_mock_return(
        argument_expression: Expr<'_>,
        runner: Runner,
    ) -> Option<(Func<'_>, Expr<'_>)> {
        let func = argument_expression
            .as_fn()
            .filter(|it| !argument_expression.is_parenthesized() && !it.is_async())?;
        if !func.params().is_empty() {
            return None;
        }
        if let FnBody::Expr(expression) = func.body() {
            return Some((func, expression));
        }
        let mut statements = statements_of(func)?;
        match (statements.next()?.kind(), statements.next()) {
            (StmtKind::Return(Some(arg_expr)), None) => Some((func, arg_expr)),
            // oxlint treats `function () { a; }` as if it returned `a`.
            (StmtKind::Expr(expression), None) if !func.is_arrow() && runner != Runner::Bun => {
                Some((func, expression))
            }
            _ => None,
        }
    }

    /// What there is in an expression that is returned.
    #[derive(Copy, Clone, Default)]
    struct Returned {
        /// A call, a `new`, a tagged template or an `import()`.
        contains_call_like_expression: bool,
        has_mutable_reference: bool,
        /// A `this` that is that of the function.
        has_this_expression: bool,
    }

    #[derive(Default)]
    struct ReturnedExpressionVisitor<'a> {
        /// Of the expressions that have been visited.
        known: IdMap<Expr<'a>, Returned>,
        /// [`is_mutable`]
        mutable: IdMap<Symbol<'a>, bool>,
        /// Each with its `this_binding_depth`: in how many functions, values of properties of classes and static blocks it is.
        pending: Vec<(Node<'a>, i32)>,
    }

    /// What `node` adds to `this_binding_depth`.
    fn this_binding(node: Node) -> i32 {
        let binds_this = |node: Node| matches!(node, Node::Func(func) if !func.is_arrow());
        match node {
            Node::Expr(e) => match e.parent() {
                Node::Member(member) => i32::from(member.init() == Some(e)),
                // The decorator of a parameter is not in the function.
                parent @ Node::Param(param) => {
                    -i32::from(binds_this(parent.parent()) && param.decorators().any(|it| it == e))
                }
                _ => 0,
            },
            _ => i32::from(binds_this(node)),
        }
    }

    impl<'a> ReturnedExpressionVisitor<'a> {
        fn visit(&mut self, return_expression: Expr<'a>) -> Returned {
            let mut found = Returned::default();
            self.pending.push((
                Node::Expr(return_expression),
                this_binding(Node::Expr(return_expression)),
            ));
            while let Some((node, this_binding_depth)) = self.pending.pop() {
                if let Node::Expr(e) = node {
                    if let Some(known) = self.known.get(e) {
                        found.contains_call_like_expression |= known.contains_call_like_expression;
                        found.has_mutable_reference |= known.has_mutable_reference;
                        found.has_this_expression |=
                            known.has_this_expression && this_binding_depth == 0;
                        continue;
                    }
                    match e.tag() {
                        ExprTag::Call
                        | ExprTag::New
                        | ExprTag::TaggedTemplate
                        | ExprTag::ImportCall => {
                            found.contains_call_like_expression = true;
                        }
                        ExprTag::This => found.has_this_expression |= this_binding_depth == 0,
                        ExprTag::Ident => {
                            if let Some(symbol) = e.symbol() {
                                found.has_mutable_reference |= *self
                                    .mutable
                                    .get_or_insert_with(symbol, || is_mutable(symbol));
                            }
                        }
                        _ => {}
                    }
                }
                node.for_each_child(|child| {
                    self.pending
                        .push((child, this_binding_depth + this_binding(child)))
                });
            }
            self.known.insert(return_expression, found);
            found
        }
    }
}

pub(crate) mod prefer_spy_on {
    use super::*;

    const USE_JEST_SPY_ON: Message =
        Message::new("", "Suggest using `jest.spyOn()` or `vi.spyOn()`.");

    const USE_SPY_ON: Message = Message::new("", "Suggest using `spyOn()`.");

    pub(crate) fn should_run(file: &File, runner: Runner) -> bool {
        (file.mentions("fn") || runner == Runner::Bun && file.mentions("mock"))
            && file.has_exprs([ExprTag::Assign])
    }

    /// Returns the callee of `mock(..)` if it's the `mock` imported from `bun:test`.
    fn mock_of_bun(value: Expr<'_>) -> Option<Expr<'_>> {
        let callee = value.as_call().filter(|_| is_plain(value))?.callee();
        let (file, local) = (value.file(), callee.as_ident()?);
        let is_mock = import_entries(file).any(|it| {
            it.declaration.spec().bytes() == b"bun:test"
                && matches!(
                    it.import_name,
                    ImportImportName::Name(specifier)
                        if specifier.imported().bytes() == b"mock" && specifier.local().name() == local
                )
        });
        (is_mock && callee.symbol() == file.top_level_scope().get_name(local)).then_some(callee)
    }

    /// Prints `a.b` as `a, 'b'`.
    fn print_object_and_property(content: &mut Vec<u8>, left_assign: Expr) {
        match left_assign.kind() {
            ExprKind::Index { obj, index, .. } => {
                print_expression(content, obj);
                content.extend_from_slice(b", ");
                print_expression(content, index);
            }
            ExprKind::Dot { obj, name, .. } if !left_assign.is_private_member() => {
                print_expression(content, obj);
                content.extend_from_slice(b", '");
                content.extend_from_slice(name.bytes());
                content.push(b'\'');
            }
            _ => {}
        }
    }

    /// Reports `a.b = mock(c)`.
    fn check_mock_of_bun<'a>(
        assign_expr: Expr<'a>,
        (callee, call_expr): (Expr<'a>, Expr<'a>),
        left_assign: Expr<'a>,
        ctx: &Ctx<'a, '_>,
    ) {
        let report = ctx.report(callee, USE_SPY_ON);
        if !ctx.can_write(b"spyOn") || left_assign.is_private_member() {
            return;
        }
        report.suggest(USE_SPY_ON, |fixer| {
            let mut content = b"spyOn(".to_vec();
            print_object_and_property(&mut content, left_assign);
            content.extend_from_slice(b").mockImplementation(");
            let arguments = call_expr.as_call().map(Call::args);
            if let Some(argument) = arguments.and_then(|it| it.first()) {
                content.extend_from_slice(ctx.file.slice(argument.outer_span()));
            }
            content.push(b')');
            fixer.replace(assign_expr, content)
        });
    }

    pub(crate) fn run_once<'a>(ctx: &Ctx<'a, '_>) {
        for node in ctx.file.exprs_of_kind(ExprTag::Assign) {
            let ExprKind::Assign { target, value, .. } = node.kind() else {
                continue;
            };
            // Not the default in `[a.b = jest.fn()] = c`.
            if !matches!(target.tag(), ExprTag::Dot | ExprTag::Index) || node.is_assignment_target()
            {
                continue;
            }
            if ctx.runner == Runner::Bun
                && let Some(callee) = mock_of_bun(value)
            {
                check_mock_of_bun(node, (callee, value), target, ctx);
                continue;
            }
            // `jest.fn()`, or a member of what a call returns: `jest.fn().a`
            let call_expr = match as_member_expression(value) {
                Some(mem_expr) => mem_expr.object(),
                None => Some(value),
            };
            if let Some(call_expr) =
                call_expr.filter(|it| it.tag() == ExprTag::Call && is_plain(*it))
            {
                check_and_fix(node, call_expr, target, ctx);
            }
        }
    }

    fn check_and_fix<'a>(
        assign_expr: Expr<'a>,
        call_expr: Expr<'a>,
        left_assign: Expr<'a>,
        ctx: &Ctx<'a, '_>,
    ) {
        let Some(ParsedJestFnCall::GeneralJest(jest_fn_call)) = parse_jest_fn_call_in(
            ctx.file,
            call_expr,
            PossibleJestNode::new(assign_expr, ctx.runner),
        ) else {
            return;
        };
        let Some(first_fn_member) = jest_fn_call
            .members
            .first()
            .filter(|it| it.is_name_equal("fn"))
        else {
            return;
        };
        let span = Span::new(call_expr.span().start, first_fn_member.span.end);
        ctx.report(span, USE_JEST_SPY_ON)
            .suggest(USE_JEST_SPY_ON, |fixer| {
                let (end, has_mock_implementation) = match jest_fn_call.members.get(1) {
                    Some(second) => (
                        second.span.start.saturating_sub(1),
                        jest_fn_call
                            .members
                            .iter()
                            .any(|modifier| modifier.is_name_equal("mockImplementation")),
                    ),
                    None => (call_expr.span().end, false),
                };
                let (framework_spy, argument) = get_test_fn_call(call_expr);
                let mut content = framework_spy.as_bytes().to_vec();
                print_object_and_property(&mut content, left_assign);
                content.push(b')');
                if !has_mock_implementation {
                    content.extend_from_slice(b".mockImplementation(");
                    if let Some(argument) = argument {
                        print_expression(&mut content, argument);
                    }
                    content.push(b')');
                }
                fixer.replace(Span::new(assign_expr.span().start, end), content)
            });
    }

    /// The `jest.fn(a)` that the chain `call_expr` starts with: how the replacement starts, and the `a`.
    fn get_test_fn_call(call_expr: Expr<'_>) -> (&'static str, Option<Expr<'_>>) {
        let mut at = call_expr;
        loop {
            if at.is_parenthesized() {
                return ("", None);
            }
            at = match at.kind() {
                ExprKind::Call(call) => {
                    let framework_spy = match get_node_name(call.callee()).as_slice() {
                        b"vi.fn" => "vi.spyOn(",
                        b"jest.fn" => "jest.spyOn(",
                        _ => "",
                    };
                    if !framework_spy.is_empty() {
                        return (
                            framework_spy,
                            call.args().first().filter(|it| it.tag() != ExprTag::Spread),
                        );
                    }
                    call.callee()
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                _ => return ("", None),
            };
        }
    }
}
