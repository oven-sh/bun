use crate::rules::no_wrapper_object_types::GlobalFunctions;
use bun_lint::prelude::*;
use bun_lint::types::SymbolFlags;
use bun_lint::types::utils::is_builtin_symbol_like;
use bun_lint::utils::ts_scope::is_reference_to_global_function;

/// Disallow the use of `eval()`-like functions.
pub struct NoImpliedEval;

const NO_FUNCTION_CONSTRUCTOR: Message = Message::new(
    "noFunctionConstructor",
    "Implied eval. Do not use the Function constructor to create functions.",
);
const NO_IMPLIED_EVAL_ERROR: Message =
    Message::new("noImpliedEvalError", "Implied eval. Consider passing a function.");

const FUNCTION_CONSTRUCTOR: &str = "Function";
const GLOBAL_CANDIDATES: [&str; 3] = ["global", "globalThis", "window"];
const EVAL_LIKE_FUNCTIONS: [&str; 4] = ["execScript", "setImmediate", "setInterval", "setTimeout"];

fn is_global_candidate(object: Expr) -> bool {
    object.as_ident().is_some_and(|name| name.is_any(&GLOBAL_CANDIDATES))
}

fn get_callee_name(node: Expr<'_>) -> Option<Name<'_>> {
    match node.kind() {
        ExprKind::Ident(name) => Some(name),
        // A `ChainExpression` for ESLint.
        _ if node.is_chain_root() => None,
        ExprKind::Dot { obj, name, .. } if is_global_candidate(obj) && !name.bytes().starts_with(b"#") => {
            Some(name.name())
        }
        ExprKind::Index { obj, index, .. } if is_global_candidate(obj) => match index.kind() {
            ExprKind::Ident(name) | ExprKind::String(name) => Some(name),
            _ => None,
        },
        _ => None,
    }
}

fn is_function_type(node: Expr) -> bool {
    let ty = node.ty();
    ty.is_unresolved()
        || ty.get_symbol().is_some_and(|symbol| symbol.has_flags(SymbolFlags::FUNCTION | SymbolFlags::METHOD))
        || is_builtin_symbol_like(ty, FUNCTION_CONSTRUCTOR)
        || !ty.get_call_signatures().is_empty()
}

fn is_bind(node: Expr) -> bool {
    match node.kind() {
        ExprKind::Ident(name) => name.is("bind"),
        _ if node.is_chain_root() => false,
        ExprKind::Dot { name, .. } => name.name().is("bind"),
        ExprKind::Index { index, .. } => is_bind(index),
        _ => false,
    }
}

fn is_function(node: Expr) -> bool {
    match node.kind() {
        ExprKind::Fn(_) => true,
        ExprKind::String(_)
        | ExprKind::Number(_)
        | ExprKind::BigInt(_)
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Null
        | ExprKind::Regex(_)
        | ExprKind::Template(_) => false,
        ExprKind::Call(call) if !node.is_chain_root() => is_bind(call.callee()) || is_function_type(node),
        _ => is_function_type(node),
    }
}

impl NoImpliedEval {
    fn check_implied_eval<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let (ExprKind::Call(call) | ExprKind::New(call)) = node.kind() else {
            return;
        };
        let Some(callee_name) = get_callee_name(call.callee()) else {
            return;
        };
        if callee_name.is(FUNCTION_CONSTRUCTOR) {
            let ty = call.callee().ty();
            if !ty.is_unresolved()
                && (ty.get_symbol().is_none() || is_builtin_symbol_like(ty, "FunctionConstructor"))
            {
                cx.report(node, NO_FUNCTION_CONSTRUCTOR);
            }
            return;
        }
        let Some(handler) = call.args().first() else {
            return;
        };
        if callee_name.is_any(&EVAL_LIKE_FUNCTIONS)
            && !is_function(handler)
            && *cx
                .state
                .entry((Node::Expr(node).scope(), callee_name))
                .or_insert_with(|| is_reference_to_global_function(callee_name, node))
        {
            cx.report(handler, NO_IMPLIED_EVAL_ERROR);
        }
    }
}

impl Rule for NoImpliedEval {
    const META: Meta = Meta::typescript("no-implied-eval", Kind::Suggestion)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types()
        .extends_base_rule("no-implied-eval");
    type State<'a> = GlobalFunctions<'a>;

    fn new(_: &Options) -> Self {
        NoImpliedEval
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> GlobalFunctions<'a> {
        on.exprs([ExprTag::Call, ExprTag::New], Self::check_implied_eval);
        GlobalFunctions::default()
    }
}
