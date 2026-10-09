//! What the rules of `jest` and of `vitest` about matchers do: the `toBe` of `expect(a).toBe(b)`. Each module is a file of oxlint's
//! `rules/shared/jest_vitest`. See [`jest`](crate::jest).

use crate::jest::{
    Ctx, EnclosingFunctions, JestFnKind, JestGeneralFnKind, KnownMemberExpressionProperty,
    ParsedExpectFnCall, PossibleJestNode, enclosing_function, is_equality_matcher,
    iter_possible_jest_call_node, parent_expression, parse_expect_and_typeof_vitest_fn_call,
    parse_expect_jest_fn_call, print_expression,
};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::{
    as_member_expression, callee_name, get_inner_expression, static_property_name,
};
use bun_lint_oxlint::regex_flags::rust_regex;
use bun_lint_oxlint::text::find_next_token_within;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

pub(crate) mod require_to_throw_message {
    use super::*;

    const REQUIRE_TO_THROW_MESSAGE: Message =
        Message::new("", "Require a message for \"{{matcher_name}}\".");

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node) else {
            return;
        };
        if let Some(matcher) = jest_fn_call.matcher()
            && let Some(matcher_name @ (b"toThrow" | b"toThrowError")) = matcher.name()
            && jest_fn_call.args.is_empty()
            && !jest_fn_call
                .modifiers()
                .any(|modifier| modifier.is_name_equal("not"))
        {
            ctx.report(matcher.span, REQUIRE_TO_THROW_MESSAGE)
                .data("matcher_name", matcher_name);
        }
    }
}

pub(crate) mod prefer_snapshot_hint {
    use super::*;

    const MISSING_HINT: Message = Message::new("", "Snapshot is missing a hint.");
    const HINT_MUST_BE_STRING: Message =
        Message::new("", "Snapshot hint must be a string literal.");
    const TOO_MANY_ARGUMENTS: Message =
        Message::new("", "`toMatchSnapshot` takes at most two arguments.");

    pub(crate) const SNAPSHOT_MATCHERS: [&str; 2] =
        ["toMatchSnapshot", "toThrowErrorMatchingSnapshot"];

    #[derive(Copy, Clone, PartialEq, Eq)]
    pub(crate) enum SnapshotHintMode {
        Always,
        Multi,
    }

    impl SnapshotHintMode {
        pub(crate) fn new(options: &Options) -> Self {
            match options.str(0) {
                Some("always") => SnapshotHintMode::Always,
                _ => SnapshotHintMode::Multi,
            }
        }

        pub(crate) fn run_once<'a>(self, ctx: &Ctx<'a, '_>) {
            let mut functions = EnclosingFunctions::default();
            // By the test, or the outermost function, that they are in.
            let mut scoped_expects: FxHashMap<Option<Func<'a>>, SmallVec<[Expr<'a>; 2]>> =
                FxHashMap::default();
            for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
                if let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node)
                    && jest_fn_call
                        .members
                        .iter()
                        .any(|member| SNAPSHOT_MATCHERS.iter().any(|it| member.is_name_equal(it)))
                {
                    let node = possible_jest_node.node;
                    scoped_expects
                        .entry(get_scope_owner(node, &mut functions))
                        .or_default()
                        .push(node);
                }
            }
            for expects in scoped_expects.values() {
                if self == SnapshotHintMode::Always || expects.len() > 1 {
                    expects.iter().for_each(|it| check_expect(*it, ctx));
                }
            }
        }
    }

    fn check_expect<'a>(expect: Expr<'a>, ctx: &Ctx<'a, '_>) {
        let Some(expect_call_expr) = expect.as_call() else {
            return;
        };
        let (arguments, Some(callee_name)) =
            (expect_call_expr.args(), callee_name(expect_call_expr))
        else {
            return;
        };
        match arguments.len() {
            0 => ctx.report(expect, MISSING_HINT),
            2 => return,
            3.. if callee_name.is("toMatchSnapshot") => ctx.report(expect, TOO_MANY_ARGUMENTS),
            _ if arguments.first().is_some_and(is_string_literal) => return,
            _ => ctx.report(expect, HINT_MUST_BE_STRING),
        };
    }

    fn get_scope_owner<'a>(
        node: Expr<'a>,
        functions: &mut EnclosingFunctions<'a>,
    ) -> Option<Func<'a>> {
        let is_test_callback = |func: Func<'a>| {
            (func
                .owner()
                .as_expr()
                .and_then(parent_expression)
                .and_then(Expr::as_call)
                .and_then(callee_name))
            .is_some_and(|it| {
                JestFnKind::from(it.bytes()) == JestFnKind::General(JestGeneralFnKind::Test)
            })
        };
        let (mut last_function, mut at) = (None, functions.of(Node::Expr(node)));
        while let Some(func) = at {
            last_function = at;
            if is_test_callback(func) {
                break;
            }
            at = enclosing_function(func);
        }
        last_function
    }
}

/// `a.b` or `a[b]`, not in parentheses, with the name of the property.
fn member_with_name(e: Expr<'_>) -> Option<(Expr<'_>, Option<Name<'_>>)> {
    as_member_expression(e).map(|it| (it, static_property_name(it)))
}

/// The `true` or the `false` that `e` is, whatever the type that it is said to have.
fn as_boolean_literal(e: Expr<'_>) -> Option<(Expr<'_>, bool)> {
    let inner = get_inner_expression(e);
    match inner.tag() {
        ExprTag::True => Some((inner, true)),
        ExprTag::False => Some((inner, false)),
        _ => None,
    }
}

fn is_string_literal(e: Expr) -> bool {
    matches!(e.tag(), ExprTag::String | ExprTag::Template) && !e.is_parenthesized()
}

/// An argument that is not `...a`.
fn first_expression<'a>(arguments: List<'a, Expr<'a>>) -> Option<Expr<'a>> {
    arguments.first().filter(|it| it.tag() != ExprTag::Spread)
}

fn has_not_modifier(jest_fn_call: &ParsedExpectFnCall) -> bool {
    jest_fn_call
        .modifiers()
        .any(|modifier| modifier.is_name_equal("not"))
}

/// The `expect(..)` of `expect(..).toBe(..)`, with its arguments.
fn expect_call<'a>(jest_fn_call: &ParsedExpectFnCall<'a>) -> Option<(Expr<'a>, Call<'a>)> {
    let parent = jest_fn_call.head.parent?;
    Some((parent, parent.as_call()?))
}

/// With the parentheses around it.
fn outer_text(e: Expr<'_>) -> &[u8] {
    e.file().slice(e.outer_span())
}

pub(crate) mod no_alias_methods {
    use super::*;

    const NO_ALIAS_METHODS: Message = Message::new("", "Unexpected alias \"{{name}}\"");

    pub(crate) const ALIASES: [&str; 11] = [
        "toBeCalled",
        "toBeCalledTimes",
        "toBeCalledWith",
        "lastCalledWith",
        "nthCalledWith",
        "toReturn",
        "toReturnTimes",
        "toReturnWith",
        "lastReturnedWith",
        "nthReturnedWith",
        "toThrowError",
    ];
    const CANONICAL_NAMES: [&str; 11] = [
        "toHaveBeenCalled",
        "toHaveBeenCalledTimes",
        "toHaveBeenCalledWith",
        "toHaveBeenLastCalledWith",
        "toHaveBeenNthCalledWith",
        "toHaveReturned",
        "toHaveReturnedTimes",
        "toHaveReturnedWith",
        "toHaveLastReturnedWith",
        "toHaveNthReturnedWith",
        "toThrow",
    ];

    pub(crate) fn run<'a>(jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, jest_node) else {
            return;
        };
        if let Some(matcher) = jest_fn_call.matcher()
            && let Some(alias) = matcher.name()
            && let Some(i) = ALIASES.iter().position(|it| it.as_bytes() == alias)
            && let Some(canonical_name) = CANONICAL_NAMES.get(i)
        {
            // What is between the quotes.
            let quotes = u32::from(matcher.element.is_string_literal());
            (ctx.report(matcher.span, NO_ALIAS_METHODS)
                .data("name", alias))
            .fix(|fixer| fixer.replace(matcher.span.shrink(quotes, quotes), *canonical_name));
        }
    }
}

pub(crate) mod no_restricted_matchers {
    use super::*;

    const RESTRICTED_CHAIN: Message = Message::new("", "Use of `{{chain_call}}` is disallowed");

    pub(crate) struct NoRestrictedMatchersConfig {
        restricted_matchers: Vec<Vec<u8>>,
    }

    impl NoRestrictedMatchersConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let restricted_matchers = options
                .object(0)
                .entries()
                .iter()
                .map(|it| it.0.clone())
                .collect();
            NoRestrictedMatchersConfig {
                restricted_matchers,
            }
        }

        pub(crate) fn is_empty(&self) -> bool {
            self.restricted_matchers.is_empty()
        }

        pub(crate) fn run<'a>(&self, possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
            let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node) else {
                return;
            };
            let (Some(first), Some(last)) =
                (jest_fn_call.members.first(), jest_fn_call.members.last())
            else {
                return;
            };
            let names: SmallVec<[&[u8]; 4]> = jest_fn_call
                .members
                .iter()
                .filter_map(|it| it.name())
                .collect();
            let chain_call = names.join(b".".as_slice());
            let span = Span::new(first.span.start, last.span.end);
            for restriction in &self.restricted_matchers {
                if check_restriction(&chain_call, restriction) {
                    ctx.report(span, RESTRICTED_CHAIN)
                        .data("chain_call", chain_call.clone());
                }
            }
        }
    }

    /// A modifier, and what ends in `.not`, is for everything that starts with it.
    fn check_restriction(chain_call: &[u8], restriction: &[u8]) -> bool {
        let file_name =
            strings::last_index_of_char(restriction, b'/').and_then(|at| restriction.get(at + 1..));
        let extension = strings::rsplit_once_char(file_name.unwrap_or(restriction), b'.')
            .filter(|it| !it.0.is_empty());
        if matches!(restriction, b"not" | b"rejects" | b"resolves")
            || extension.is_some_and(|it| it.1.eq_ignore_ascii_case(b"not"))
        {
            chain_call.starts_with(restriction)
        } else {
            chain_call == restriction
        }
    }
}

pub(crate) mod prefer_called_with {
    use super::*;

    const USE_CALLED_WITH: Message = Message::new(
        "",
        "Suggest using `toBeCalledWith()` or `toHaveBeenCalledWith()`.",
    );

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node) else {
            return;
        };
        let Some(matcher_property) = jest_fn_call
            .matcher()
            .filter(|_| !has_not_modifier(&jest_fn_call))
        else {
            return;
        };
        let replacement = match matcher_property.name() {
            Some(b"toBeCalled") => "toBeCalledWith",
            Some(b"toHaveBeenCalled") => "toHaveBeenCalledWith",
            _ => return,
        };
        ctx.report(matcher_property.span, USE_CALLED_WITH)
            .fix(|fixer| fixer.replace(matcher_property.span, replacement));
    }
}

pub(crate) mod prefer_strict_equal {
    use super::*;

    const USE_TO_STRICT_EQUAL: Message = Message::new("", "Suggest using `toStrictEqual()`.");

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node) else {
            return;
        };
        if let Some(matcher) = jest_fn_call
            .matcher()
            .filter(|it| it.is_name_equal("toEqual"))
        {
            ctx.report(matcher.span, USE_TO_STRICT_EQUAL)
                .suggest(USE_TO_STRICT_EQUAL, |fixer| {
                    let replacement = match fixer.file().slice(matcher.span).first() {
                        Some(b'\'') => "'toStrictEqual'",
                        Some(b'"') => "\"toStrictEqual\"",
                        Some(b'`') => "`toStrictEqual`",
                        _ => "toStrictEqual",
                    };
                    fixer.replace(matcher.span, replacement)
                });
        }
    }
}

pub(crate) mod prefer_to_have_been_called_times {
    use super::*;

    const PREFER_TO_HAVE_BEEN_CALLED_TIMES: Message = Message::new(
        "",
        "Prefer `toHaveBeenCalledTimes()` over `toHaveLength()` when asserting mock call counts",
    );

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(parsed_expect_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node)
        else {
            return;
        };
        // `expect(a.mock.calls).toHaveLength(1)`
        if parsed_expect_call
            .matcher()
            .is_some_and(|it| it.is_name_equal("toHaveLength"))
            && let Some(matcher_argument) =
                parsed_expect_call.matcher_arguments.and_then(List::first)
            && let Some(expect_argument) = parsed_expect_call.expect_arguments.and_then(List::first)
            && let Some((calls, Some(name))) = member_with_name(expect_argument)
            && name.is("calls")
            && let Some((mock, Some(name))) = calls.object().and_then(member_with_name)
            && name.is("mock")
            && let Some(mocked) = mock.object()
        {
            ctx.report(possible_jest_node.node, PREFER_TO_HAVE_BEEN_CALLED_TIMES)
                .fix(|fixer| {
                    let mut code =
                        [b"expect(".as_slice(), outer_text(mocked), b")".as_slice()].concat();
                    for modifier in parsed_expect_call.modifiers() {
                        code.push(b'.');
                        code.extend_from_slice(fixer.file().slice(modifier.span));
                    }
                    code.extend_from_slice(b".toHaveBeenCalledTimes(");
                    code.extend_from_slice(outer_text(matcher_argument));
                    code.push(b')');
                    fixer.replace(possible_jest_node.node, code)
                });
        }
    }
}

pub(crate) mod prefer_to_have_length {
    use super::*;

    const USE_TO_HAVE_LENGTH: Message = Message::new("", "Suggest using `toHaveLength()`.");

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let node = possible_jest_node.node;
        let Some(parsed_expect_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node)
        else {
            return;
        };
        let Some(object) = node
            .callee()
            .and_then(as_member_expression)
            .and_then(Expr::object)
        else {
            return;
        };
        // The `.not` of `expect(a.length).not.toBe(1)`: there can be one modifier.
        let (super_mem_expr, expr_call_expr) = match as_member_expression(object) {
            Some(mem_expr) if mem_expr.is_private_member() => return,
            Some(mem_expr) => (Some(mem_expr), mem_expr.object()),
            None => (None, Some(object)),
        };
        let Some(expr_call_expr) = expr_call_expr.filter(|it| !it.is_parenthesized()) else {
            return;
        };
        if let Some(argument) = expr_call_expr.as_call().and_then(|it| it.args().first())
            && let Some((static_mem_expr, Some(expect_property_name))) = member_with_name(argument)
            && let Some(matcher) = parsed_expect_call.matcher()
            && expect_property_name.is("length")
            && is_equality_matcher(matcher)
            && let Some(measured) = static_mem_expr.object()
        {
            ctx.report(matcher.span, USE_TO_HAVE_LENGTH).fix(|fixer| {
                let file = fixer.file();
                let open_paren =
                    find_next_token_within(file, matcher.span.end, node.span().end, b"(")?;
                // Everything up to the `(` is replaced.
                if file
                    .comments_in(Span::new(matcher.span.end, open_paren))
                    .next()
                    .is_some()
                {
                    return None;
                }
                let modifier =
                    super_mem_expr.map(|it| Span::new(expr_call_expr.span().end, it.span().end));
                let code = [
                    b"expect(".as_slice(),
                    file.slice(Span::new(
                        static_mem_expr.span().start,
                        measured.outer_span().end,
                    )),
                    b")".as_slice(),
                    file.slice(modifier.unwrap_or_default()),
                    b".toHaveLength".as_slice(),
                ];
                Some(fixer.replace(Span::new(node.span().start, open_paren), code.concat()))
            });
        }
    }
}

pub(crate) mod prefer_expect_resolves {
    use super::*;

    const EXPECT_RESOLVES: Message = Message::new(
        "",
        "Prefer `await expect(...).resolves` over `expect(await ...)` syntax.",
    );

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(jest_expect_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node)
        else {
            return;
        };
        if let Some((expect, call_expr)) = expect_call(&jest_expect_fn_call)
            && let Some(await_expr) = call_expr.args().first().filter(|it| !it.is_parenthesized())
            && let ExprKind::Await(argument) = await_expr.kind()
        {
            ctx.report(await_expr, EXPECT_RESOLVES).fix(|fixer| {
                let (local, argument) = (jest_expect_fn_call.local, outer_text(argument));
                fixer.replace(
                    expect,
                    [
                        b"await ".as_slice(),
                        local,
                        b"(".as_slice(),
                        argument,
                        b").resolves".as_slice(),
                    ]
                    .concat(),
                )
            });
        }
    }
}

pub(crate) mod no_interpolation_in_snapshots {
    use super::*;

    const NO_INTERPOLATION_IN_SNAPSHOTS: Message =
        Message::new("", "Do not use string interpolation inside of snapshots");

    pub(crate) const INLINE_SNAPSHOT_MATCHERS: [&str; 2] = [
        "toMatchInlineSnapshot",
        "toThrowErrorMatchingInlineSnapshot",
    ];

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node) else {
            return;
        };
        let is_inline_snapshot = |matcher: &KnownMemberExpressionProperty| {
            INLINE_SNAPSHOT_MATCHERS
                .iter()
                .any(|it| matcher.is_name_equal(it))
        };
        if !jest_fn_call.matcher().is_some_and(is_inline_snapshot) {
            return;
        }
        // The snapshot can come after the matchers of properties.
        for arg in jest_fn_call.args {
            if let ExprKind::Template(template_lit) = arg.kind()
                && !template_lit.exprs().is_empty()
                && !arg.is_parenthesized()
            {
                ctx.report(arg, NO_INTERPOLATION_IN_SNAPSHOTS);
            }
        }
    }
}

pub(crate) mod prefer_to_be {
    use super::*;

    const USE_TO_BE: Message = Message::new("", "Use `toBe` when expecting primitive literals.");
    const USE_TO_BE_UNDEFINED: Message = Message::new("", "Use `toBeUndefined` instead.");
    const USE_TO_BE_DEFINED: Message = Message::new("", "Use `toBeDefined` instead.");
    const USE_TO_BE_NULL: Message = Message::new("", "Use `toBeNull` instead.");
    const USE_TO_BE_NAN: Message = Message::new("", "Use `toBeNaN` instead.");

    #[derive(Copy, Clone)]
    enum PreferToBeKind {
        Defined,
        NaN,
        Null,
        ToBe,
        Undefined,
    }

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(jest_expect_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node)
        else {
            return;
        };
        let Some(matcher) = jest_expect_fn_call.matcher() else {
            return;
        };
        let has_not_modifier = has_not_modifier(&jest_expect_fn_call);
        let kind = if has_not_modifier && matcher.is_name_equal("toBeUndefined") {
            PreferToBeKind::Defined
        } else if has_not_modifier && matcher.is_name_equal("toBeDefined") {
            PreferToBeKind::Undefined
        } else if is_equality_matcher(matcher)
            && let Some(first_matcher_arg) =
                first_expression(jest_expect_fn_call.args).map(get_inner_expression)
        {
            if first_matcher_arg.is_ident("undefined") {
                if has_not_modifier {
                    PreferToBeKind::Defined
                } else {
                    PreferToBeKind::Undefined
                }
            } else if first_matcher_arg.is_ident("NaN") {
                PreferToBeKind::NaN
            } else if first_matcher_arg.tag() == ExprTag::Null {
                PreferToBeKind::Null
            } else if should_use_tobe(first_matcher_arg) && !matcher.is_name_equal("toBe") {
                PreferToBeKind::ToBe
            } else {
                return;
            }
        } else {
            return;
        };
        check_and_fix(
            kind,
            possible_jest_node.node,
            matcher,
            &jest_expect_fn_call,
            ctx,
        );
    }

    /// A literal that is no regular expression, or the negative of one. Not a number that is written with a `.`.
    fn should_use_tobe(first_matcher_arg: Expr) -> bool {
        let expr = match first_matcher_arg.kind() {
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } if operand.is_parenthesized() => return false,
            ExprKind::Unary {
                op: UnOp::Minus,
                operand,
            } => operand,
            ExprKind::Number(_) if strings::contains_char(first_matcher_arg.text(), b'.') => {
                return false;
            }
            _ => first_matcher_arg,
        };
        matches!(
            expr.tag(),
            ExprTag::BigInt
                | ExprTag::True
                | ExprTag::False
                | ExprTag::Number
                | ExprTag::Null
                | ExprTag::Template
                | ExprTag::String
        )
    }

    /// From where it is replaced, and by what.
    fn build_suggestion_with_not_modifier(
        matcher_name: &str,
        not_modifier: Option<&KnownMemberExpressionProperty>,
        is_cmp_mem_expr: bool,
        span_start: u32,
    ) -> (u32, String) {
        let matcher = if is_cmp_mem_expr {
            format!("[\"{matcher_name}\"]()")
        } else {
            format!("{matcher_name}()")
        };
        let dot = if is_cmp_mem_expr { "" } else { "." };
        match not_modifier {
            // `["not"]["toBe"](value)`, from the `[`.
            Some(not_modifier)
                if not_modifier
                    .parent
                    .is_some_and(|it| it.tag() == ExprTag::Index) =>
            {
                (
                    not_modifier.span.start.saturating_sub(1),
                    format!("[\"not\"]{dot}{matcher}"),
                )
            }
            Some(not_modifier) => (not_modifier.span.start, format!("not{dot}{matcher}")),
            None => (
                span_start.saturating_sub(u32::from(is_cmp_mem_expr)),
                matcher,
            ),
        }
    }

    fn check_and_fix<'a>(
        kind: PreferToBeKind,
        call_expr: Expr<'a>,
        matcher: &KnownMemberExpressionProperty<'a>,
        jest_expect_fn_call: &ParsedExpectFnCall<'a>,
        ctx: &Ctx<'a, '_>,
    ) {
        let (span, end) = (matcher.span, call_expr.span().end);
        let Some(is_cmp_mem_expr) = matcher.parent.map(|it| it.tag() == ExprTag::Index) else {
            return;
        };
        let maybe_not_modifier = jest_expect_fn_call
            .modifiers()
            .find(|modifier| modifier.is_name_equal("not"));
        let (message, start, new_matcher) = match kind {
            PreferToBeKind::Undefined => {
                let new_matcher = if is_cmp_mem_expr {
                    "[\"toBeUndefined\"]()"
                } else {
                    "toBeUndefined()"
                };
                (
                    USE_TO_BE_UNDEFINED,
                    maybe_not_modifier.map_or(span.start, |it| it.span.start),
                    new_matcher.to_owned(),
                )
            }
            PreferToBeKind::Defined => {
                let start = match is_cmp_mem_expr {
                    true => jest_expect_fn_call.modifiers().next().map(|it| it.span.end),
                    false => maybe_not_modifier.map(|it| it.span.start),
                };
                let new_matcher = if is_cmp_mem_expr {
                    "[\"toBeDefined\"]()"
                } else {
                    "toBeDefined()"
                };
                (
                    USE_TO_BE_DEFINED,
                    start.unwrap_or(span.start),
                    new_matcher.to_owned(),
                )
            }
            PreferToBeKind::Null | PreferToBeKind::NaN => {
                let (message, name) = match kind {
                    PreferToBeKind::Null => (USE_TO_BE_NULL, "toBeNull"),
                    _ => (USE_TO_BE_NAN, "toBeNaN"),
                };
                let (start, suggestion) = build_suggestion_with_not_modifier(
                    name,
                    maybe_not_modifier,
                    is_cmp_mem_expr,
                    span.start,
                );
                (message, start, suggestion)
            }
            PreferToBeKind::ToBe => {
                let new_matcher = if is_cmp_mem_expr { "\"toBe\"" } else { "toBe" };
                ctx.report(span, USE_TO_BE)
                    .fix(|fixer| fixer.replace(span, new_matcher));
                return;
            }
        };
        let replacement_span = Span::new(start, end);
        ctx.report(replacement_span, message)
            .fix(|fixer| fixer.replace(replacement_span, new_matcher));
    }
}

pub(crate) mod prefer_to_contain {
    use super::*;

    const USE_TO_CONTAIN: Message = Message::new("", "Suggest using `toContain()`.");

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(jest_expect_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node)
        else {
            return;
        };
        // `expect(a.includes(b)).toBe(true)`
        if let Some((_, expect_call_expr)) = expect_call(&jest_expect_fn_call)
            && let Some(matcher) = jest_expect_fn_call.matcher()
            && let Some((_, boolean_value)) =
                first_expression(jest_expect_fn_call.args).and_then(as_boolean_literal)
            && let Some(first_argument) = expect_call_expr.args().first()
            && !first_argument.is_parenthesized()
            && !first_argument.is_chain_root()
            && let Some(includes_call_expr) = first_argument.as_call()
            && is_equality_matcher(matcher)
            && let Some((mem_expr, Some(name))) = member_with_name(includes_call_expr.callee())
            && name.is("includes")
            && includes_call_expr.args().len() == 1
            && let Some(argument) = first_expression(includes_call_expr.args())
            && let Some(object) = mem_expr.object()
        {
            ctx.report(matcher.span, USE_TO_CONTAIN).fix(|fixer| {
                let negation = if boolean_value == has_not_modifier(&jest_expect_fn_call) {
                    ".not"
                } else {
                    ""
                };
                let mut code = Vec::new();
                print_expression(&mut code, expect_call_expr.callee());
                code.push(b'(');
                print_expression(&mut code, object);
                code.push(b')');
                code.extend_from_slice(negation.as_bytes());
                code.extend_from_slice(b".toContain(");
                print_expression(&mut code, argument);
                code.push(b')');
                fixer.replace(possible_jest_node.node, code)
            });
        }
    }
}

/// `expect(a < b).toBe(true)`: what [`prefer_comparison_matcher`] and [`prefer_equality_matcher`] look at.
struct ComparisonInExpect<'a> {
    jest_fn_call: ParsedExpectFnCall<'a>,
    matcher_span: Span,
    /// The `expect(a < b)`.
    expect: Expr<'a>,
    /// The `a < b`.
    binary_expr: Expr<'a>,
    operator: BinOp,
    left: Expr<'a>,
    right: Expr<'a>,
    /// The `true`.
    matcher_arg: Expr<'a>,
    matcher_arg_value: bool,
    has_not_modifier: bool,
}

impl<'a> ComparisonInExpect<'a> {
    fn parse(file: &'a File<'a>, possible_jest_node: PossibleJestNode<'a>) -> Option<Self> {
        let jest_fn_call = parse_expect_jest_fn_call(file, possible_jest_node)?;
        let matcher = jest_fn_call
            .matcher()
            .filter(|it| is_equality_matcher(it))?;
        let (expect, expect_call_expr) = expect_call(&jest_fn_call)?;
        let binary_expr = expect_call_expr
            .args()
            .first()
            .filter(|it| !it.is_parenthesized())?;
        let ExprKind::Binary {
            op: operator,
            left,
            right,
        } = binary_expr.kind()
        else {
            return None;
        };
        let (matcher_arg, matcher_arg_value) =
            first_expression(jest_fn_call.args).and_then(as_boolean_literal)?;
        let (matcher_span, has_not_modifier) = (matcher.span, has_not_modifier(&jest_fn_call));
        Some(ComparisonInExpect {
            jest_fn_call,
            matcher_span,
            expect,
            binary_expr,
            operator,
            left,
            right,
            matcher_arg,
            matcher_arg_value,
            has_not_modifier,
        })
    }

    /// `expect(a,).toBeLessThan(b,)` for `expect(a < b,).toBe(true,)`: what is after the arguments stays.
    fn build_code(
        &self,
        call_expr: Expr<'a>,
        add_not_modifier: bool,
        matcher_name: &str,
    ) -> Vec<u8> {
        let file = call_expr.file();
        let mut content = [self.jest_fn_call.local, b"(".as_slice()].concat();
        print_expression(&mut content, self.left);
        content.extend_from_slice(file.slice(Span::new(
            self.binary_expr.span().end,
            self.expect.span().end,
        )));
        content.push(b'.');
        for modifier_name in self
            .jest_fn_call
            .modifiers()
            .filter_map(|it| it.name())
            .filter(|it| *it != b"not")
        {
            content.extend_from_slice(modifier_name);
            content.push(b'.');
        }
        content.extend_from_slice(if add_not_modifier { "not." } else { "" }.as_bytes());
        content.extend_from_slice(matcher_name.as_bytes());
        content.push(b'(');
        print_expression(&mut content, self.right);
        content.extend_from_slice(
            file.slice(Span::new(self.matcher_arg.span().end, call_expr.span().end)),
        );
        content
    }
}

pub(crate) mod prefer_comparison_matcher {
    use super::*;

    const USE_TO_BE_COMPARISON: Message =
        Message::new("", "Suggest using the built-in comparison matchers");

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(comparison) = ComparisonInExpect::parse(ctx.file, possible_jest_node) else {
            return;
        };
        if is_string_literal(comparison.left) || is_string_literal(comparison.right) {
            return;
        }
        let negated = comparison.matcher_arg_value == comparison.has_not_modifier;
        let prefer_matcher_name = match (comparison.operator, negated) {
            (BinOp::Gt, false) | (BinOp::Le, true) => "toBeGreaterThan",
            (BinOp::Ge, false) | (BinOp::Lt, true) => "toBeGreaterThanOrEqual",
            (BinOp::Lt, false) | (BinOp::Ge, true) => "toBeLessThan",
            (BinOp::Le, false) | (BinOp::Gt, true) => "toBeLessThanOrEqual",
            _ => return,
        };
        let call_expr = possible_jest_node.node;
        ctx.report(comparison.matcher_span, USE_TO_BE_COMPARISON)
            .fix(|fixer| {
                fixer.replace(
                    call_expr,
                    comparison.build_code(call_expr, false, prefer_matcher_name),
                )
            });
    }
}

pub(crate) mod prefer_equality_matcher {
    use super::*;

    const USE_EQUALITY_MATCHER: Message =
        Message::new("", "Suggest using the built-in equality matchers.");
    const USE: Message = Message::new("", "Use `{{eq_matcher}}`");

    pub(crate) fn run<'a>(possible_jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(comparison) = ComparisonInExpect::parse(ctx.file, possible_jest_node) else {
            return;
        };
        let expects_equal = match comparison.operator {
            BinOp::EqEqEq => comparison.matcher_arg_value,
            BinOp::NotEqEq => !comparison.matcher_arg_value,
            _ => return,
        };
        let (call_expr, add_not_modifier) = (
            possible_jest_node.node,
            expects_equal == comparison.has_not_modifier,
        );
        let mut report = ctx.report(comparison.matcher_span, USE_EQUALITY_MATCHER);
        for eq_matcher in ["toBe", "toEqual", "toStrictEqual"] {
            report = report.suggest_with(USE, &[("eq_matcher", eq_matcher.as_bytes())], |fixer| {
                fixer.replace(
                    call_expr,
                    comparison.build_code(call_expr, add_not_modifier, eq_matcher),
                )
            });
        }
    }
}

pub(crate) mod no_unneeded_async_expect_function {
    use super::*;

    const NO_UNNEEDED_ASYNC_EXPECT_FUNCTION: Message =
        Message::new("", "Unnecessary async function wrapper");

    pub(crate) fn run<'a>(jest_node: PossibleJestNode<'a>, ctx: &Ctx<'a, '_>) {
        let Some(parsed_expect_call) = parse_expect_jest_fn_call(ctx.file, jest_node) else {
            return;
        };
        // `expect(async () => { await a(); })`
        if parsed_expect_call.matcher().is_some()
            && let Some((_, expect_call_expr)) = expect_call(&parsed_expect_call)
            && let Some(first_arg) = expect_call_expr
                .args()
                .first()
                .filter(|it| !it.is_parenthesized())
            && let Some(func) = first_arg.as_fn().filter(|it| it.is_async())
            && let Some(awaited) = match func.body() {
                FnBody::Expr(e) => Some(e),
                FnBody::Block(statements) if statements.len() == 1 => {
                    match statements.first().map(Stmt::kind) {
                        Some(StmtKind::Expr(e)) => Some(e),
                        _ => None,
                    }
                }
                _ => None,
            }
            && !awaited.is_parenthesized()
            && let ExprKind::Await(inner_call) = awaited.kind()
            && inner_call.tag() == ExprTag::Call
            && !inner_call.is_parenthesized()
            && !inner_call.is_chain_root()
        {
            ctx.report(first_arg, NO_UNNEEDED_ASYNC_EXPECT_FUNCTION)
                .fix(|fixer| fixer.replace(first_arg, inner_call.text()));
        }
    }
}

pub(crate) mod no_large_snapshots {
    use super::no_interpolation_in_snapshots::INLINE_SNAPSHOT_MATCHERS;
    use super::*;

    const TOO_LONG_SNAPSHOT: Message = Message::new("", "Snapshot is too long.");

    enum AllowedSnapshotMatcher {
        Pattern(Box<Regex>),
        Exact(String),
    }

    pub(crate) struct NoLargeSnapshotsConfig {
        max_size: u32,
        inline_max_size: u32,
        /// By the path of the file.
        allowed_snapshots: Vec<(Vec<u8>, Vec<AllowedSnapshotMatcher>)>,
    }

    impl NoLargeSnapshotsConfig {
        pub(crate) fn new(options: &Options) -> Self {
            let config = options.object(0);
            let max_size = config.number("maxSize").map_or(50, |it| it as u32);
            let matchers_of = |patterns: &Json| {
                let patterns = patterns
                    .as_array()
                    .unwrap_or_default()
                    .iter()
                    .filter_map(Json::as_str);
                (patterns.filter_map(|it| std::str::from_utf8(it).ok()))
                    .map(|it| match rust_regex(it, false) {
                        Some(pattern) => AllowedSnapshotMatcher::Pattern(Box::new(pattern)),
                        None => AllowedSnapshotMatcher::Exact(it.to_owned()),
                    })
                    .collect()
            };
            NoLargeSnapshotsConfig {
                max_size,
                inline_max_size: config
                    .number("inlineMaxSize")
                    .map_or(max_size, |it| it as u32),
                allowed_snapshots: (config.object("allowedSnapshots").entries().iter())
                    .map(|(path, patterns)| (path.clone(), matchers_of(patterns)))
                    .collect(),
            }
        }

        pub(crate) fn run_once<'a>(&self, ctx: &Ctx<'a, '_>) {
            if is_snapshot_file(ctx.file) {
                ctx.file
                    .stmts_of_kind(StmtTag::Expr)
                    .for_each(|it| self.report_in_expr_stmt(it, ctx));
                return;
            }
            for possible_jest_node in iter_possible_jest_call_node(ctx.file) {
                if let Some(jest_fn_call) = parse_expect_jest_fn_call(ctx.file, possible_jest_node)
                    && let Some(first_arg_expr) = first_expression(jest_fn_call.args)
                    && let Some(snapshot_matcher) = (jest_fn_call.members.iter()).find(|member| {
                        INLINE_SNAPSHOT_MATCHERS
                            .iter()
                            .any(|it| member.is_name_equal(it))
                    })
                    && get_line_count(first_arg_expr.outer_span(), ctx.file) > self.inline_max_size
                {
                    ctx.report(snapshot_matcher.span, TOO_LONG_SNAPSHOT);
                }
            }
        }

        /// ``exports[`name`] = `snapshot`;``
        fn report_in_expr_stmt<'a>(&self, expr_stmt: Stmt<'a>, ctx: &Ctx<'a, '_>) {
            let StmtKind::Expr(expression) = expr_stmt.kind() else {
                return;
            };
            let left = match expression.kind() {
                _ if expression.is_parenthesized() || expr_stmt.is_wrapper() => None,
                ExprKind::Assign { target, .. } => Some(target),
                ExprKind::Binary { op, left, .. } if op != BinOp::Comma => Some(left),
                _ => None,
            };
            let allowed = match left {
                Some(left) => match as_member_expression(left) {
                    Some(member_expr) => self.check_allowed_in_snapshots(member_expr, ctx.file),
                    None => return,
                },
                None => false,
            };
            if !allowed && get_line_count(expr_stmt.span(), ctx.file) > self.max_size {
                ctx.report(expr_stmt, TOO_LONG_SNAPSHOT);
            }
        }

        fn check_allowed_in_snapshots(&self, member_expr: Expr, file: &File) -> bool {
            let Some(snapshot_name) = static_property_name(member_expr) else {
                return false;
            };
            let allowed_snapshots_in_file =
                self.allowed_snapshots.iter().find(|it| it.0 == file.path());
            allowed_snapshots_in_file.is_some_and(|it| {
                it.1.iter().any(|matcher| match matcher {
                    AllowedSnapshotMatcher::Pattern(pattern) => pattern.test(snapshot_name.bytes()),
                    AllowedSnapshotMatcher::Exact(name) => snapshot_name.is(name),
                })
            })
        }
    }

    fn is_snapshot_file(file: &File) -> bool {
        strings::rsplit_once_char(file.path(), b'.')
            .is_some_and(|it| it.1.eq_ignore_ascii_case(b"snap"))
    }

    pub(crate) fn may_have_snapshot(file: &File) -> bool {
        file.mentions_any(&INLINE_SNAPSHOT_MATCHERS) || is_snapshot_file(file)
    }

    /// The line breaks in it, and in the character after it.
    fn get_line_count(span: Span, file: &File) -> u32 {
        let text = file.text().get(span.start as usize..).unwrap_or_default();
        let text = text.get(..=span.len() as usize).unwrap_or(text);
        (strings::count_char(text, b'\n') as u32).saturating_sub(u32::from(text.ends_with(b"\n")))
    }
}

/// What `vitest/prefer-to-be-truthy` and `vitest/prefer-to-be-falsy` do.
pub(crate) mod prefer_to_be_simply_bool {
    use super::*;

    const USE_INSTEAD: Message = Message::new("", "Use `{{call_name}}` instead.");

    pub(crate) fn run<'a>(
        possible_vitest_node: PossibleJestNode<'a>,
        ctx: &Ctx<'a, '_>,
        value: bool,
    ) {
        let Some(vitest_expect_fn_call) =
            parse_expect_and_typeof_vitest_fn_call(ctx.file, possible_vitest_node)
        else {
            return;
        };
        if let Some(matcher) = vitest_expect_fn_call.matcher()
            && is_equality_matcher(matcher)
            && first_expression(vitest_expect_fn_call.args)
                .and_then(as_boolean_literal)
                .is_some_and(|it| it.1 == value)
            && let Some(parent) = matcher.parent
        {
            let span = Span::new(matcher.span.start, possible_vitest_node.node.span().end);
            let call_name = if value { "toBeTruthy" } else { "toBeFalsy" };
            ctx.report(span, USE_INSTEAD)
                .data("call_name", call_name)
                .suggest_with(
                    USE_INSTEAD,
                    &[("call_name", call_name.as_bytes())],
                    |fixer| match parent.tag() {
                        ExprTag::Index => fixer.replace(span, format!("[\"{call_name}\"]()")),
                        _ => fixer.replace(span, format!("{call_name}()")),
                    },
                );
        }
    }
}
