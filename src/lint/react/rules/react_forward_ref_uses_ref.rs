use bun_lint_oxlint::ast_util::callee_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::estree_compat::estree_span;

/// Require all forwardRef components include a ref parameter.
pub struct ForwardRefUsesRef;

const MISSING_REF_PARAMETER: Message =
    Message::new("missingRefParameter", "forwardRef is used with this component but no ref parameter is set");
const ADD_REF_PARAMETER: Message = Message::new("addRefParameter", "Add a ref parameter");
const REMOVE_FORWARD_REF: Message = Message::new("removeForwardRef", "Remove forwardRef wrapper");
const OXLINT_FORWARD_REF_USES_REF: Message =
    Message::new("", "Components wrapped with `forwardRef` must have a `ref` parameter");
const OXLINT_REMOVE_FORWARD_REF_WRAPPER: Message = Message::new("", "remove `forwardRef` wrapper");
const OXLINT_ADD_REF_PARAMETER: Message = Message::new("", "add `ref` parameter");

impl Rule for ForwardRefUsesRef {
    const META: Meta = Meta::plugin(Plugin::React, "forward-ref-uses-ref", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ForwardRefUsesRef
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("forwardRef").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call() else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        // oxlint takes `a["forwardRef"]` too, and no name in parentheses.
        let is_forward_ref_call = match is_oxlint {
            true => callee_name(call).is_some_and(|name| name.is("forwardRef")),
            false => is_forward_ref(call.callee()),
        };
        if !is_forward_ref_call {
            return;
        }
        // oxlint looks at the first argument only, and not into parentheses.
        let checked = if is_oxlint { 1 } else { usize::MAX };
        for exp in call.args().iter().take(checked).filter(|it| !is_oxlint || !it.is_parenthesized()) {
            let Some(func) = exp.as_fn() else {
                continue;
            };
            // oxlint does not count `this`, and leaves a rest parameter alone.
            let this_param = if is_oxlint { None } else { func.this_param() };
            let mut params = this_param.into_iter().chain(func.params());
            let (Some(param), None) = (params.next(), params.next()) else {
                continue;
            };
            if !is_oxlint {
                cx.report(exp, MISSING_REF_PARAMETER)
                    .suggest(ADD_REF_PARAMETER, |fixer| {
                        let at = estree_span(Node::Param(param));
                        match func.is_arrow() && !ast_utils::is_parenthesised(Node::Param(param)) {
                            true => vec![fixer.insert_before(at, "("), fixer.insert_after(at, ", ref)")],
                            false => vec![fixer.insert_after(at, ", ref")],
                        }
                    })
                    .suggest(REMOVE_FORWARD_REF, |fixer| fixer.replace(e, exp.text()));
                continue;
            }
            if param.is_rest() {
                continue;
            }
            // A statement cannot start with `function (`.
            let can_remove_forward_ref = func.is_arrow()
                || func.name().is_some()
                || e.is_chain_root()
                || !matches!(e.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Expr);
            let mut report = cx.report(exp, OXLINT_FORWARD_REF_USES_REF);
            if can_remove_forward_ref {
                report = report.suggest(OXLINT_REMOVE_FORWARD_REF_WRAPPER, |fixer| fixer.replace(e, exp.text()));
            }
            report.suggest(OXLINT_ADD_REF_PARAMETER, |fixer| {
                let span = func.params_span()?;
                let written = fixer.file().slice(span);
                let written = written.strip_suffix(b")").unwrap_or(written).trim_ascii_end();
                let written = written.strip_suffix(b",").unwrap_or(written);
                let open = if written.starts_with(b"(") { "" } else { "(" };
                Some(fixer.replace(span, [open.as_bytes(), written, b", ref)"].concat()))
            });
        }
    }
}

/// upstream's `isForwardRefCall`, for the callee: `forwardRef`, `a.forwardRef`, `a[forwardRef]`.
fn is_forward_ref(callee: Expr<'_>) -> bool {
    match callee.kind() {
        ExprKind::Ident(name) => name.is("forwardRef"),
        ExprKind::Dot { name, .. } => name.name().is("forwardRef") && !callee.is_chain_root(),
        ExprKind::Index { index, .. } => index.is_ident("forwardRef") && !callee.is_chain_root(),
        _ => false,
    }
}
