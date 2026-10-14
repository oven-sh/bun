use bun_lint::prelude::*;
use bun_lint::types::tsutils::{get_well_known_symbol_property_of_type, is_thenable_type};
use bun_lint::types::{Locate, Type};
use bun_lint::utils::eslint_utils::get_function_name_with_kind;
use bun_lint::utils::oxlint::tsgolint_function_head_loc;
use bun_lint::utils::ts_utils::{
    get_function_head_loc, is_start_of_expression_statement, needs_preceding_semicolon,
    upper_case_first,
};
use bun_lint_eslint::rules::require_await::{
    MISSING_AWAIT, REMOVE_ASYNC, State, mark_function_around, node_with_async_keyword,
};

/// Disallow async functions which do not return promises and have no `await` expression.
pub struct RequireAwait;

fn is_thenable<'a>(node: impl Locate<'a>, ty: Type<'a>) -> bool {
    ty.is_unresolved() || is_thenable_type(node, ty)
}

fn is_thenable_expression(node: Expr) -> bool {
    is_thenable(node, node.ty())
}

fn is_thenable_return(statement: Stmt) -> bool {
    matches!(statement.kind(), StmtKind::Return(Some(argument)) if is_thenable_expression(argument))
}

/// Whether `func` returns something thenable.
fn returns_thenable(func: Func, is_oxlint: bool) -> bool {
    if func.is_arrow() {
        // typescript-eslint looks at every child of the arrow function that is neither a block nor an
        // `await`, which the parameters are too. tsgolint looks at the body only.
        let has_thenable_parameter = !is_oxlint
            && func.params().iter().any(|param| {
                match param.default().is_none() && !param.is_rest() {
                    true => is_thenable(param.pat(), param.pat().ty()),
                    false => is_thenable(param, param.type_at_location()),
                }
            });
        if has_thenable_parameter {
            return true;
        }
        if let FnBody::Expr(body) = func.body()
            && is_thenable_expression(body)
        {
            return true;
        }
    }
    func.returns().any(is_thenable_return)
}

fn has_async_iterator(ty: Type) -> bool {
    if ty.is_union_or_intersection() {
        return ty.types().iter().any(has_async_iterator);
    }
    ty.is_unresolved() || get_well_known_symbol_property_of_type(ty, "asyncIterator").is_some()
}

/// Whether the generator `func` delegates to an async generator or yields something thenable.
fn is_async_yield(func: Func, is_oxlint: bool) -> bool {
    func.yields().any(|node| {
        let Some((Some(argument), star)) = node.as_yield() else {
            return false;
        };
        match argument.kind() {
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_) => false,
            // typescript-eslint skips a `Literal`, tsgolint an `ast.IsLiteralExpression`.
            ExprKind::True | ExprKind::False | ExprKind::Null if !is_oxlint => false,
            ExprKind::Template(template) if is_oxlint && template.exprs().is_empty() => false,
            _ if star => has_async_iterator(argument.ty()),
            _ => is_thenable_expression(argument),
        }
    })
}

fn remove_async<'a>(fixer: Fixer<'a>, func: Func<'a>) -> Option<Vec<Fix>> {
    let file = fixer.file();
    let node = node_with_async_keyword(func);
    let async_token = file.tokens_in(node).find(|token| token.value() == b"async")?;
    let after = file.tokens_after(async_token).with_comments().next()?;
    let next_token = file.token_after(async_token)?;
    // Without the `async`, what follows could continue the line before.
    let add_semi_colon = (next_token.is_punctuator("[") || next_token.is_punctuator("("))
        && (matches!(node, Node::Member(_)) || is_start_of_expression_statement(node))
        && needs_preceding_semicolon(node);
    let mut changes = vec![fixer.replace(
        Span::new(async_token.start(), after.start()),
        if add_semi_colon { ";" } else { "" },
    )];

    // `Promise<T>` becomes `T`, and `AsyncGenerator<T>` becomes `Generator<T>`.
    if let Some(return_type) = func.return_type()
        && let TypeKind::Ref { name, args } = return_type.kind()
        && let Some(type_name) = name.as_ident()
    {
        if func.is_generator() {
            if type_name.name().is("AsyncGenerator") {
                changes.push(fixer.replace(type_name, "Generator"));
            }
        } else if type_name.name().is("Promise")
            && let Some(angles) = args.angle_brackets_span()
        {
            changes.push(fixer.remove(Span::new(angles.end - 1, angles.end)));
            changes.push(fixer.remove(Span::new(type_name.start(), angles.start + 1)));
        }
    }
    Some(changes)
}

impl Rule for RequireAwait {
    const META: Meta = Meta::typescript("require-await", Kind::Suggestion)
        .has_suggestions()
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types()
        .extends_base_rule("require-await")
        .reports_on_exit();
    const ON: On = On::new()
        .exprs(&[ExprTag::Await])
        .stmts(&[StmtTag::ForOf])
        .var_decls()
        .finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        RequireAwait
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        State::new(file, true)
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        mark_function_around(node.into(), cx);
    }

    fn stmt<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if node.as_for_of().is_some_and(|(.., is_await)| is_await) {
            mark_function_around(node.into(), cx);
        }
    }

    #[inline]
    fn var_decl<'a>(&self, node: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if node.var_kind() == VarKind::AwaitUsing {
            mark_function_around(node.into(), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let has_await = std::mem::take(&mut cx.state.has_await);
        for (func, has_await) in std::mem::take(&mut cx.state.candidates).into_iter().zip(has_await) {
            if has_await
                || returns_thenable(func, is_oxlint)
                || func.is_generator() && is_async_yield(func, is_oxlint)
            {
                continue;
            }
            let name = get_function_name_with_kind(func, false);
            let place = match cx.language().is_oxlint {
                true => tsgolint_function_head_loc(func),
                false => get_function_head_loc(func),
            };
            cx.report(place, MISSING_AWAIT)
                .data("name", upper_case_first(&name).into_owned())
                .suggest_change_of_behavior(REMOVE_ASYNC, &[], |fixer| remove_async(fixer, func));
        }
    }
}
