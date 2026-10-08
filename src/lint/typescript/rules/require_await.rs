use bun_lint::prelude::*;
use bun_lint::types::tsutils::{get_well_known_symbol_property_of_type, is_thenable_type};
use bun_lint::types::{Locate, Type};
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::eslint_utils::get_function_name_with_kind;
use bun_lint::utils::ts_utils::{
    get_function_head_loc, is_start_of_expression_statement, needs_preceding_semicolon,
    upper_case_first,
};
use rustc_hash::FxHashSet;

/// Disallow async functions which do not return promises and have no `await` expression.
pub struct RequireAwait;

const MISSING_AWAIT: Message = Message::new("missingAwait", "{{name}} has no 'await' expression.");
const REMOVE_ASYNC: Message = Message::new("removeAsync", "Remove 'async'.");

#[derive(Default)]
pub struct State<'a> {
    /// The async functions that are not empty.
    candidates: Vec<Func<'a>>,
    with_await: FxHashSet<Func<'a>>,
    /// The function that something is directly in.
    functions: AncestorMemo<'a, Func<'a>>,
}

/// `node` awaits something: so does the function that it is directly in.
fn mark_as_has_await<'a>(node: Node<'a>, cx: &mut Cx<'a, RequireAwait>) {
    let as_function = |_, parent: Node<'a>| parent.as_func().filter(|func| func.kind() != FnKind::StaticBlock);
    if let Some(func) = cx.state.functions.find(node, as_function)
        && func.is_async()
    {
        cx.state.with_await.insert(func);
    }
}

fn is_thenable<'a>(node: impl Locate<'a>, ty: Type<'a>) -> bool {
    ty.is_unresolved() || is_thenable_type(node, ty)
}

fn is_thenable_expression(node: Expr) -> bool {
    is_thenable(node, node.ty())
}

/// Whether `func` returns something thenable.
fn returns_thenable(func: Func) -> bool {
    if func.is_arrow() {
        // Upstream looks at every child of the arrow function that is neither a block nor an
        // `await`, which the parameters are too.
        let has_thenable_parameter = func.params().iter().any(|param| {
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
    func.returns().any(|statement| {
        matches!(statement.kind(), StmtKind::Return(Some(argument)) if is_thenable_expression(argument))
    })
}

fn has_async_iterator(ty: Type) -> bool {
    if ty.is_union_or_intersection() {
        return ty.types().iter().any(has_async_iterator);
    }
    ty.is_unresolved() || get_well_known_symbol_property_of_type(ty, "asyncIterator").is_some()
}

/// Whether the generator `func` delegates to an async generator or yields something thenable.
fn is_async_yield(func: Func) -> bool {
    func.yields().any(|node| {
        let ExprKind::Yield { value: Some(argument), star } = node.kind() else {
            return false;
        };
        match argument.kind() {
            ExprKind::String(_)
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Null => false,
            _ if star => has_async_iterator(argument.ty()),
            _ => is_thenable_expression(argument),
        }
    })
}

/// The method that `func` is the value of, which is where its `async` is, or else the function.
fn node_with_async_keyword(func: Func<'_>) -> Node<'_> {
    match func.owner() {
        Node::Expr(e) => match e.parent() {
            Node::Prop(prop) if prop.kind() == PropKind::Method && prop.value() == Some(e) => {
                Node::Prop(prop)
            }
            _ => Node::Expr(e),
        },
        owner => owner,
    }
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
        .extends_base_rule("require-await");
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        RequireAwait
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        let is_candidate = |func: &Func| {
            func.is_async()
                && ast_utils::is_function_with_body(*func)
                && !ast_utils::is_empty_function(*func)
        };
        let candidates: Vec<Func<'a>> = file.funcs().filter(is_candidate).collect();
        if candidates.is_empty() {
            return State::default();
        }
        on.exprs([ExprTag::Await], |_, node, cx| mark_as_has_await(node.into(), cx));
        on.stmts([StmtTag::ForOf], |_, node, cx| {
            if matches!(node.kind(), StmtKind::ForOf { is_await: true, .. }) {
                mark_as_has_await(node.into(), cx);
            }
        });
        on.var_decls(|_, node, cx| {
            if node.var_kind() == VarKind::AwaitUsing {
                mark_as_has_await(node.into(), cx);
            }
        });
        on.finish(|_, cx| {
            for func in std::mem::take(&mut cx.state.candidates) {
                if cx.state.with_await.contains(&func)
                    || returns_thenable(func)
                    || func.is_generator() && is_async_yield(func)
                {
                    continue;
                }
                let name = get_function_name_with_kind(func, false);
                cx.report(get_function_head_loc(func), MISSING_AWAIT)
                    .data("name", upper_case_first(&name).into_owned())
                    .suggest(REMOVE_ASYNC, |fixer| remove_async(fixer, func));
            }
        });
        State {
            candidates,
            with_await: FxHashSet::default(),
            functions: AncestorMemo::default(),
        }
    }
}
