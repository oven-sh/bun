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

fn get_callee_name(node: Expr<'_>, is_oxlint: bool) -> Option<Name<'_>> {
    match node.kind() {
        ExprKind::Ident(name) => Some(name),
        // A `ChainExpression` for ESLint.
        _ if node.is_chain_root() => None,
        ExprKind::Dot { obj, name, .. } if is_global_candidate(obj) && !name.bytes().starts_with(b"#") => {
            Some(name.name())
        }
        ExprKind::Index { obj, index, .. } if is_global_candidate(obj) => match index.kind() {
            ExprKind::String(name) => Some(name),
            // tsgolint names a computed member only by a string literal.
            ExprKind::Ident(name) if !is_oxlint => Some(name),
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

// tsgolint has no `ChainExpression` and looks at an identifier or the name of a `PropertyAccessExpression` only.
fn is_bind(node: Expr, is_oxlint: bool) -> bool {
    match node.kind() {
        ExprKind::Ident(name) => name.is("bind"),
        ExprKind::Dot { name, .. } if !node.is_chain_root() || (is_oxlint && !node.is_parenthesized()) => {
            name.name().is("bind")
        }
        ExprKind::Index { index, .. } if !is_oxlint && !node.is_chain_root() => is_bind(index, is_oxlint),
        _ => false,
    }
}

fn is_function(node: Expr, is_oxlint: bool) -> bool {
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
        ExprKind::Call(call) if is_oxlint || !node.is_chain_root() => {
            is_bind(call.callee(), is_oxlint) || is_function_type(node)
        }
        _ => is_function_type(node),
    }
}

impl Rule for NoImpliedEval {
    const META: Meta = Meta::typescript("no-implied-eval", Kind::Suggestion)
        .presets(Presets::RECOMMENDED_TYPE_CHECKED)
        .requires_types()
        .extends_base_rule("no-implied-eval");
    const ON: On = On::new().enter(NodeTags::new().exprs(&[ExprTag::Call, ExprTag::New]));
    type State<'a> = GlobalFunctions<'a>;

    fn new(_: &Options) -> Self {
        NoImpliedEval
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<GlobalFunctions<'a>> {
        Some(GlobalFunctions::default())
    }

    // The outer one first, as upstream: `Function()` as an argument of `setTimeout` is reported twice at one place.
    fn enter<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Node::Expr(node) = node else {
            return;
        };
        let (ExprKind::Call(call) | ExprKind::New(call)) = node.kind() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let Some(callee_name) = get_callee_name(call.callee(), is_oxlint) else {
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
        if !callee_name.is_any(&EVAL_LIKE_FUNCTIONS) || is_function(handler, is_oxlint) {
            return;
        }
        if is_oxlint {
            // tsgolint asks the checker for the symbol of the callee: one declared in this file is not the global.
            let is_declared_in_file = call
                .callee()
                .ts_symbol()
                .is_some_and(|symbol| symbol.declarations().any(|declaration| declaration.is_in_linted_file()));
            if !is_declared_in_file {
                match handler.is_parenthesized() {
                    true => cx.report(handler.outer_span(), NO_IMPLIED_EVAL_ERROR),
                    false => cx.report(handler, NO_IMPLIED_EVAL_ERROR),
                };
            }
            return;
        }
        if *cx
            .state
            .entry((Node::Expr(node).scope(), callee_name))
            .or_insert_with(|| is_reference_to_global_function(callee_name, node))
        {
            cx.report(handler, NO_IMPLIED_EVAL_ERROR);
        }
    }
}
