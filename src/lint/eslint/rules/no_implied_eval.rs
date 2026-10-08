use bun_lint::prelude::*;

/// Disallow the use of `eval()`-like methods.
pub struct NoImpliedEval;

const IMPLIED_EVAL: Message = Message::new(
    "impliedEval",
    "Implied eval. Consider passing a function instead of a string.",
);
const EXEC_SCRIPT: Message = Message::new("execScript", "Implied eval. Do not use execScript().");

const GLOBAL_CANDIDATES: [&str; 4] = ["global", "window", "globalThis", "self"];

/// ESLint's `EVAL_LIKE_FUNC_PATTERN`.
fn is_eval_like(name: &[u8]) -> bool {
    matches!(name, b"setInterval" | b"setTimeout" | b"execScript")
}

/// ESLint's `isEvaluatedString`.
fn is_evaluated_string(e: Expr<'_>) -> bool {
    match e.kind() {
        ExprKind::String(_) | ExprKind::Template(_) => true,
        ExprKind::Binary { op: BinOp::Add, left, right } => is_evaluated_string(left) || is_evaluated_string(right),
        _ => false,
    }
}

/// Whether `object` is a global object: `window`, `window.window`, `window["window"].window`, ..
fn is_global_object(object: Expr<'_>) -> bool {
    let mut root = object;
    while let Some(inner) = ast_utils::member_object(root) {
        root = inner;
    }
    let Some(name) = GLOBAL_CANDIDATES.into_iter().find(|name| root.is_ident(name)) else {
        return false;
    };
    let mut at = object;
    while let Some(inner) = ast_utils::member_object(at) {
        if !ast_utils::is_specific_member_access(at, None, Some(name)) {
            return false;
        }
        at = inner;
    }
    ast_utils::is_global_reference(root)
}

impl NoImpliedEval {
    fn check<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Call(call) = e.kind() else {
            return;
        };
        let callee = call.callee();
        let is_exec_script = match callee.kind() {
            ExprKind::Ident(name) if is_eval_like(name.bytes()) => {
                if !ast_utils::is_global_reference(callee) {
                    return;
                }
                name.is("execScript")
            }
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                match ast_utils::get_static_property_name(callee) {
                    Some(name) if is_eval_like(&name) && is_global_object(obj) => *name == *b"execScript",
                    _ => return,
                }
            }
            _ => return,
        };
        let Some(first) = call.args().first() else {
            return;
        };
        let is_string = is_evaluated_string(first)
            || matches!(
                eslint_utils::get_static_value(first, Some(cx.file().scope())),
                Some(eslint_utils::StaticValue::String(_))
            );
        if is_string {
            cx.report(e, if is_exec_script { EXEC_SCRIPT } else { IMPLIED_EVAL });
        }
    }
}

impl Rule for NoImpliedEval {
    const META: Meta = Meta::eslint("no-implied-eval", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoImpliedEval
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions_any(&["setInterval", "setTimeout", "execScript"]) {
            return;
        }
        on.exprs([ExprTag::Call], Self::check);
    }
}
