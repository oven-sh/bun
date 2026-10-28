use bun_lint::prelude::*;
use bun_lint::types::{NameOf, Type};
use bun_lint::types::tsutils::{
    get_well_known_symbol_property_of_type, is_type_reference, union_constituents,
};
use bun_lint::types::utils::{
    Awaitable, get_constrained_type_at_location, is_declared_in_ambient_module, is_promise_aggregator_method,
    is_type_any_type, needs_to_be_awaited,
};
use bun_lint::utils::ts_utils::{
    FixOrSuggest, get_await_token_removal_range, get_fix_or_suggest, get_for_statement_head_loc,
    is_await_keyword, is_start_of_arrow_function_body_needing_parentheses,
    is_start_of_expression_statement_needing_parentheses,
};

/// Disallow awaiting a value that is not a Thenable.
pub struct AwaitThenable;

const AWAIT: Message =
    Message::new("await", "Unexpected `await` of a non-Promise (non-\"Thenable\") value.");
const AWAIT_USING_OF_NON_ASYNC_DISPOSABLE: Message = Message::new(
    "awaitUsingOfNonAsyncDisposable",
    "Unexpected `await using` of a value that is not async disposable.",
);
const CONVERT_TO_ORDINARY_FOR: Message =
    Message::new("convertToOrdinaryFor", "Convert to an ordinary `for...of` loop.");
const FOR_AWAIT_OF_NON_ASYNC_ITERABLE: Message = Message::new(
    "forAwaitOfNonAsyncIterable",
    "Unexpected `for await...of` of a value that is not async iterable.",
);
const INVALID_PROMISE_AGGREGATOR_INPUT: Message = Message::new(
    "invalidPromiseAggregatorInput",
    "Unexpected iterable of non-Promise (non-\"Thenable\") values passed to promise aggregator.",
);
const REMOVE_AWAIT: Message = Message::new("removeAwait", "Remove unnecessary `await`.");

/// Removes the first `await` in `node`, plus the whitespace before the next token or comment.
fn remove_await_token(fixer: Fixer, node: Span) -> Option<Fix> {
    let file = fixer.file();
    let await_token = file.tokens_in(node).find(is_await_keyword)?;
    Some(fixer.remove(get_await_token_removal_range(file, await_token)))
}

fn some_part_has_well_known_symbol(ty: Type, name: &str) -> bool {
    union_constituents(ty)
        .iter()
        .any(|type_part| get_well_known_symbol_property_of_type(type_part, name).is_some())
}

fn is_iterable(ty: Type) -> bool {
    union_constituents(ty)
        .iter()
        .all(|part| get_well_known_symbol_property_of_type(part, "iterator").is_some())
}

fn is_always_non_awaitable_type<'a>(ty: Type<'a>, node: Expr<'a>) -> bool {
    union_constituents(ty).iter().all(|part| needs_to_be_awaited(node, part) == Awaitable::Never)
}

fn contains_non_awaitable_type<'a>(ty: Type<'a>, node: Expr<'a>) -> bool {
    union_constituents(ty).iter().any(|part| needs_to_be_awaited(node, part) == Awaitable::Never)
}

/// True if one of upstream's `getValueTypesOfArrayLike(type)` contains a non-awaitable type.
fn has_non_awaitable_value_type<'a>(ty: Type<'a>, node: Expr<'a>) -> bool {
    if ty.is_tuple_type() {
        return ty.get_type_arguments().iter().any(|it| contains_non_awaitable_type(it, node));
    }
    // tsgolint uses any type's number index type, and falls back to the type argument only if there isn't one.
    if node.file().language().is_oxlint {
        if let Some(number_index_type) = ty.get_number_index_type() {
            return contains_non_awaitable_type(number_index_type, node);
        }
    } else if ty.is_array_like_type() {
        return ty.get_number_index_type().is_some_and(|it| contains_non_awaitable_type(it, node));
    }
    // `Iterable<...>`
    is_type_reference(ty)
        && ty.get_type_arguments().first().is_some_and(|it| contains_non_awaitable_type(it, node))
}

fn is_invalid_promise_aggregator_input<'a>(node: Expr<'a>, ty: Type<'a>) -> bool {
    // Anything that isn't an array, a tuple or an iterable is already a type error.
    is_iterable(ty) && union_constituents(ty).iter().any(|part| has_non_awaitable_value_type(part, node))
}

/// True for `expect(promise).resolves.toBe(1)` and `expect(promise).rejects.not.toThrow()` from `bun:test`. In
/// bun-types these matchers return `void`, like the matchers for a plain value, but tests are conventionally written
/// with `await`.
fn is_bun_test_promise_matcher(node: Expr) -> bool {
    let Some(call) = node.as_call() else {
        return false;
    };
    let mut member = call.callee();
    while let ExprKind::Dot { obj, name, .. } = member.kind() {
        if matches!(name.bytes(), b"resolves" | b"rejects")
            && NameOf(member).ts_symbol().is_some_and(|it| is_declared_in_ambient_module(it, b"bun:test"))
        {
            return true;
        }
        member = obj;
    }
    false
}

impl AwaitThenable {
    fn check_await<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // `check_variable_declaration` handles that case. Both can report at the same location, the declaration first.
        let is_disposed = matches!(node.parent(), Node::VarDecl(it) if it.var_kind() == VarKind::AwaitUsing);
        if !is_disposed {
            self.check_await_expression(node, cx);
        }
    }

    fn check_await_expression<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Await(argument) = node.kind() else {
            return;
        };
        if needs_to_be_awaited(argument, argument.ty()) != Awaitable::Never
            || is_bun_test_promise_matcher(argument)
        {
            return;
        }
        // oxlint points at the awaited expression.
        let report_span = if cx.language().is_oxlint { argument.outer_span() } else { node.span() };
        let keyword = Span::new(node.span().start, node.span().start + "await".len() as u32);
        let labels = |labels: &mut Details| {
            labels.first("This expression is not Promise-like");
            labels.push(keyword, "");
        };
        cx.report(report_span, AWAIT).comments_apply_at(keyword).labels_with(labels).suggest_behavior_change(REMOVE_AWAIT, &[], |fixer| {
            let file = fixer.file();
            let await_keyword = file.tokens_in(node).find(is_await_keyword)?;
            let await_removal_fix = fixer.remove(get_await_token_removal_range(file, await_keyword));
            let first_operand_token = file.token_after(await_keyword)?;
            if is_start_of_arrow_function_body_needing_parentheses(node, &first_operand_token)
                || is_start_of_expression_statement_needing_parentheses(node, &first_operand_token)
            {
                return Some(vec![
                    await_removal_fix,
                    fixer.insert_before(argument, "("),
                    fixer.insert_after(argument, ")"),
                ]);
            }
            Some(vec![await_removal_fix])
        });
    }

    fn check_call<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = node.kind() else {
            return;
        };
        let Some(argument) = call.args().first() else {
            return;
        };
        if !is_promise_aggregator_method(node) {
            return;
        }
        // In tsgolint a range includes the parentheses.
        let is_oxlint = cx.language().is_oxlint;
        if let ExprKind::Array(elements) = argument.kind() {
            for element in elements.iter().filter(|element| !element.is_missing()) {
                if is_always_non_awaitable_type(get_constrained_type_at_location(element), element) {
                    let report_span = if is_oxlint { element.outer_span() } else { element.span() };
                    cx.report(report_span, INVALID_PROMISE_AGGREGATOR_INPUT).labels_with(|labels| {
                        labels.first("This expression is not Promise-like");
                        labels.push(argument.outer_span(), "Promise aggregator input");
                        labels.push(report_span, "");
                    });
                }
            }
            return;
        }
        if is_invalid_promise_aggregator_input(argument, get_constrained_type_at_location(argument)) {
            let report_span = if is_oxlint { argument.outer_span() } else { argument.span() };
            cx.report(report_span, INVALID_PROMISE_AGGREGATOR_INPUT).labels_with(|labels| {
                labels.first("This expression is not Promise-like");
                labels.push(report_span, "");
            });
        }
    }

    fn check_for_of<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::ForOf { expr: right, is_await: true, .. } = node.kind() else {
            return;
        };
        let ty = right.ty();
        if is_type_any_type(ty) || ty.is_unresolved() || some_part_has_well_known_symbol(ty, "asyncIterator") {
            return;
        }
        // The suggestion breaks the code for a sync iterable of promises, because the loop variable isn't awaited.
        // oxlint points at the iterated expression.
        let head = get_for_statement_head_loc(node);
        cx.report(if cx.language().is_oxlint { right.outer_span() } else { head }, FOR_AWAIT_OF_NON_ASYNC_ITERABLE)
            .comments_apply_at(head)
            .labels_with(|labels| {
                labels.first("This value is not async iterable");
                labels.push(head, "");
            })
            .suggest_behavior_change(CONVERT_TO_ORDINARY_FOR, &[], |fixer| remove_await_token(fixer, node.span()));
    }

    fn check_variable_declaration<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Var(declarations) = node.kind() else {
            return;
        };
        if declarations.first().is_none_or(|first| first.var_kind() != VarKind::AwaitUsing) {
            return;
        }
        for declarator in declarations {
            let Some(init) = declarator.init() else {
                continue;
            };
            let ty = init.ty();
            if is_type_any_type(ty) || ty.is_unresolved() || some_part_has_well_known_symbol(ty, "asyncDispose") {
                self.check_await_expression(init, cx);
                continue;
            }
            // With several declarators, the user has to fix it by hand.
            let fix_or_suggest = match declarations.len() {
                1 => FixOrSuggest::Suggest,
                _ => FixOrSuggest::None,
            };
            get_fix_or_suggest(
                cx.report(init, AWAIT_USING_OF_NON_ASYNC_DISPOSABLE).labels_with(|labels| {
                    labels.first("This value is not async disposable");
                    labels.push(init, "");
                }),
                fix_or_suggest,
                REMOVE_AWAIT,
                |fixer| remove_await_token(fixer, node.span()),
            );
            self.check_await_expression(init, cx);
        }
    }
}

impl Rule for AwaitThenable {
    const META: Meta = Meta::typescript("await-thenable", Kind::Problem)
        .has_suggestions()
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    const ON: On = On::new()
        .exprs(&[ExprTag::Await, ExprTag::Call])
        .stmts(&[StmtTag::ForOf, StmtTag::Var]);
    no_state!();

    fn new(_: &Options) -> Self {
        AwaitThenable
    }

    fn expr<'a>(&self, expr: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match expr.tag() {
            ExprTag::Await => self.check_await(expr, cx),
            ExprTag::Call => self.check_call(expr, cx),
            _ => {}
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::ForOf => self.check_for_of(stmt, cx),
            StmtTag::Var => self.check_variable_declaration(stmt, cx),
            _ => {}
        }
    }
}
