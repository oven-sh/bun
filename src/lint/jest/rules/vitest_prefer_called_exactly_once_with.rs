use bun_lint_oxlint::ast_util::{as_member_expression, callee_name};
use crate::jest::{self, ParsedExpectFnCall, ParsedJestFnCall, PossibleJestNode};
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashMap;

/// It checks when a target is asserted with both `toHaveBeenCalledOnce` and `toHaveBeenCalledWith` instead of
/// `toHaveBeenCalledExactlyOnceWith`.
pub struct PreferCalledExactlyOnceWith;

const PREFER_CALLED_EXACTLY_ONCE_WITH: Message = Message::new(
    "",
    "Prefer `toHaveBeenCalledExactlyOnceWith` over `toHaveBeenCalledOnce` and `toHaveBeenCalledWith` on the same target.",
);

impl Rule for PreferCalledExactlyOnceWith {
    const META: Meta =
        Meta::oxlint(Plugin::Vitest, "prefer-called-exactly-once-with", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferCalledExactlyOnceWith
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("toHaveBeenCalledOnce") || !file.mentions("toHaveBeenCalledWith") {
            return;
        }
        // The bodies of the callbacks of tests are reached from the statements that call the tests.
        on.finish(|_, cx| check_block_body(cx.file().body(), cx));
        on.stmts([StmtTag::Block], |_, block_statement, cx| {
            if let StmtKind::Block(body) = block_statement.kind() {
                check_block_body(body, cx);
            }
        });
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum MatcherKind {
    ToHaveBeenCalledOnce,
    ToHaveBeenCalledWith,
}

/// An `expect(a).toHaveBeenCalledOnce()` or an `expect(a).toHaveBeenCalledWith(..)`, and the other if it has been found.
struct TrackingExpectPair<'a> {
    first: MatcherKind,
    span_to_substitute: Span,
    /// The lines of the other.
    span_to_remove: Option<Span>,
    /// The `expect(a).toHaveBeenCalledWith(..)`.
    called_with: Option<Call<'a>>,
}

/// The arguments as they are written, with `, ` between.
fn text_of_arguments<'a>(arguments: List<'a, Expr<'a>>) -> Vec<u8> {
    let mut text = Vec::new();
    for (i, argument) in arguments.iter().enumerate() {
        text.extend_from_slice(if i > 0 { ", " } else { "" }.as_bytes());
        text.extend_from_slice(argument.file().slice(argument.outer_span()));
    }
    text
}

fn check_block_body<'a>(statements: List<'a, Stmt<'a>>, cx: &Cx<'a, PreferCalledExactlyOnceWith>) {
    // With the bodies of the callbacks of tests and suites, however deep.
    let mut pending = vec![statements];
    while let Some(statements) = pending.pop() {
        check_statements(statements, &mut pending, cx);
    }
}

fn check_statements<'a>(
    statements: List<'a, Stmt<'a>>,
    pending: &mut Vec<List<'a, Stmt<'a>>>,
    cx: &Cx<'a, PreferCalledExactlyOnceWith>,
) {
    let file = cx.file();
    // By what is expected, as it is written.
    let mut variables_expected: FxHashMap<Vec<u8>, TrackingExpectPair<'a>> = FxHashMap::default();
    for statement in statements {
        let StmtKind::Expr(expression) = statement.kind() else {
            continue;
        };
        let Some(call_expr) = expression.as_call().filter(|_| !expression.is_parenthesized() && !expression.is_chain_root()) else {
            continue;
        };
        if callee_name(call_expr).is_some_and(|it| it.is_any(&["mockClear", "mockReset", "mockRestore"])) {
            if let Some(identify) = as_member_expression(call_expr.callee()).and_then(Expr::object)
                && let Some(name) = identify.as_ident().filter(|_| !identify.is_parenthesized())
            {
                variables_expected.remove(name.bytes());
            }
            continue;
        }
        let expect_call = match jest::parse_jest_fn_call(file, PossibleJestNode::new(expression)) {
            Some(ParsedJestFnCall::GeneralJest(_)) => {
                let callback = call_expr.args().iter().rev().find_map(|it| it.as_fn().filter(|_| !it.is_parenthesized()));
                pending.extend(callback.and_then(Func::body_statements));
                continue;
            }
            Some(ParsedJestFnCall::Expect(expect_call)) => expect_call,
            _ => continue,
        };
        let Some((variable_expected_name, matcher)) = get_identifier_and_matcher_to_be_expected(&expect_call) else {
            continue;
        };
        let called_with = (matcher == MatcherKind::ToHaveBeenCalledWith).then_some(call_expr);
        let Some(expects) = variables_expected.get_mut(&variable_expected_name) else {
            let span_to_substitute = expression.span();
            let expects = TrackingExpectPair { first: matcher, span_to_substitute, span_to_remove: None, called_with };
            variables_expected.insert(variable_expected_name, expects);
            continue;
        };
        if expects.span_to_remove.is_none() && expects.first != matcher {
            expects.span_to_remove = Some(get_source_code_line_span(statement.span(), file));
            expects.called_with = expects.called_with.or(called_with);
        } else {
            // The same again, or a third.
            variables_expected.remove(&variable_expected_name);
        }
    }
    for (identifier, expects) in &variables_expected {
        let (Some(span_to_remove), Some(called_with)) = (expects.span_to_remove, expects.called_with) else {
            continue;
        };
        let report = cx
            .report(expects.span_to_substitute, PREFER_CALLED_EXACTLY_ONCE_WITH)
            .first_label("Replace with `toHaveBeenCalledExactlyOnceWith`")
            .label(span_to_remove, "Remove this expect");
        report.fix_dangerously(|fixer| {
            let arguments = text_of_arguments(called_with.args());
            let substitute = [
                b"expect(".as_slice(),
                identifier.as_slice(),
                b").toHaveBeenCalledExactlyOnceWith".as_slice(),
                file.slice(called_with.type_args().angle_brackets_span().unwrap_or_default()),
                b"(".as_slice(),
                arguments.as_slice(),
                b")".as_slice(),
            ];
            [fixer.replace(expects.span_to_substitute, substitute.concat()), fixer.remove(span_to_remove)]
        });
    }
}

fn get_identifier_and_matcher_to_be_expected(expect_call: &ParsedExpectFnCall) -> Option<(Vec<u8>, MatcherKind)> {
    let matcher = match expect_call.matcher()?.name()? {
        b"toHaveBeenCalledOnce" => MatcherKind::ToHaveBeenCalledOnce,
        b"toHaveBeenCalledWith" => MatcherKind::ToHaveBeenCalledWith,
        _ => return None,
    };
    if expect_call.members.iter().any(|member| member.is_name_equal("not")) {
        return None;
    }
    Some((text_of_arguments(expect_call.expect_arguments?), matcher))
}

/// From the start of the line to the character after the statement, which is taken to be the line break.
fn get_source_code_line_span(statement_span: Span, file: &File) -> Span {
    let before = file.text().get(..statement_span.start as usize).unwrap_or_default();
    let column_0 = strings::last_index_of_char(before, b'\n').map_or(statement_span.start, |index| index as u32 + 1);
    Span::new(column_0, (statement_span.end + 1).min(file.text().len() as u32))
}
