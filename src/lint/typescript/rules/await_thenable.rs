use bun_lint::prelude::*;
use bun_lint::types::Type;
use bun_lint::types::tsutils::{
    get_well_known_symbol_property_of_type, is_type_reference, union_constituents,
};
use bun_lint::types::utils::{
    Awaitable, get_constrained_type_at_location, is_promise_aggregator_method, is_type_any_type,
    needs_to_be_awaited,
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

/// Removes the first `await` in `node`, and what is before the next token or comment.
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

/// Whether one of upstream's `getValueTypesOfArrayLike(type)` contains a type that is not awaitable.
fn has_non_awaitable_value_type<'a>(ty: Type<'a>, node: Expr<'a>) -> bool {
    if ty.is_tuple_type() {
        return ty.get_type_arguments().iter().any(|it| contains_non_awaitable_type(it, node));
    }
    if ty.is_array_like_type() {
        return ty.get_number_index_type().is_some_and(|it| contains_non_awaitable_type(it, node));
    }
    // `Iterable<...>`
    is_type_reference(ty)
        && ty.get_type_arguments().first().is_some_and(|it| contains_non_awaitable_type(it, node))
}

fn is_invalid_promise_aggregator_input<'a>(node: Expr<'a>, ty: Type<'a>) -> bool {
    // What is not an array, a tuple or an iterable is a type error already.
    is_iterable(ty) && union_constituents(ty).iter().any(|part| has_non_awaitable_value_type(part, node))
}

impl AwaitThenable {
    fn check_await<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Await(argument) = node.kind() else {
            return;
        };
        if needs_to_be_awaited(argument, argument.ty()) != Awaitable::Never {
            return;
        }
        // oxlint points at what is awaited.
        let place = if cx.language().is_oxlint { argument.outer_span() } else { node.span() };
        let keyword = Span::new(node.span().start, node.span().start + "await".len() as u32);
        cx.report(place, AWAIT).comments_apply_at(keyword).suggest(REMOVE_AWAIT, |fixer| {
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
        if let ExprKind::Array(elements) = argument.kind() {
            for element in elements.iter().filter(|element| !element.is_missing()) {
                if is_always_non_awaitable_type(get_constrained_type_at_location(element), element) {
                    cx.report(element, INVALID_PROMISE_AGGREGATOR_INPUT);
                }
            }
            return;
        }
        if is_invalid_promise_aggregator_input(argument, get_constrained_type_at_location(argument)) {
            cx.report(argument, INVALID_PROMISE_AGGREGATOR_INPUT);
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
        // The suggestion breaks the code for a sync iterable of promises: the variable of the loop
        // is not awaited.
        // oxlint points at what is iterated over.
        let head = get_for_statement_head_loc(node);
        cx.report(if cx.language().is_oxlint { right.outer_span() } else { head }, FOR_AWAIT_OF_NON_ASYNC_ITERABLE)
            .comments_apply_at(head)
            .suggest(CONVERT_TO_ORDINARY_FOR, |fixer| remove_await_token(fixer, node.span()));
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
                continue;
            }
            // With several declarators it is left to the user.
            let fix_or_suggest = match declarations.len() {
                1 => FixOrSuggest::Suggest,
                _ => FixOrSuggest::None,
            };
            get_fix_or_suggest(
                cx.report(init, AWAIT_USING_OF_NON_ASYNC_DISPOSABLE),
                fix_or_suggest,
                REMOVE_AWAIT,
                |fixer| remove_await_token(fixer, node.span()),
            );
        }
    }
}

impl Rule for AwaitThenable {
    const META: Meta = Meta::typescript("await-thenable", Kind::Problem)
        .has_suggestions()
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        AwaitThenable
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Await], Self::check_await);
        on.exprs([ExprTag::Call], Self::check_call);
        on.stmts([StmtTag::ForOf], Self::check_for_of);
        on.stmts([StmtTag::Var], Self::check_variable_declaration);
    }
}
