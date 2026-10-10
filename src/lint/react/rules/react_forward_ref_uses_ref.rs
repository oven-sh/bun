use bun_lint_oxlint::ast_util::callee_name;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Require all `forwardRef` components include a `ref` parameter.
pub struct ForwardRefUsesRef;

const FORWARD_REF_USES_REF: Message =
    Message::new("", "Components wrapped with `forwardRef` must have a `ref` parameter");
const REMOVE_FORWARD_REF_WRAPPER: Message = Message::new("", "remove `forwardRef` wrapper");
const ADD_REF_PARAMETER: Message = Message::new("", "add `ref` parameter");

impl Rule for ForwardRefUsesRef {
    const META: Meta = Meta::oxlint(Plugin::React, "forward-ref-uses-ref", Kind::Problem).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ForwardRefUsesRef
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("forwardRef").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(call) = e.as_call().filter(|call| callee_name(*call).is_some_and(|name| name.is("forwardRef"))) else {
            return;
        };
        let Some(exp) = call.args().first().filter(|it| !it.is_parenthesized()) else {
            return;
        };
        let Some(func) = exp.as_fn() else {
            return;
        };
        let params = func.params();
        if params.len() != 1 || params.first().is_some_and(Param::is_rest) {
            return;
        }
        // A statement cannot start with `function (`.
        let can_remove_forward_ref = func.is_arrow()
            || func.name().is_some()
            || e.is_chain_root()
            || !matches!(e.parent(), Node::Stmt(statement) if statement.tag() == StmtTag::Expr);
        let mut report = cx.report(exp, FORWARD_REF_USES_REF);
        if can_remove_forward_ref {
            report = report.suggest(REMOVE_FORWARD_REF_WRAPPER, |fixer| fixer.replace(e, exp.text()));
        }
        report.suggest(ADD_REF_PARAMETER, |fixer| {
            let span = func.params_span()?;
            let written = fixer.file().slice(span);
            let written = written.strip_suffix(b")").unwrap_or(written).trim_ascii_end();
            let written = written.strip_suffix(b",").unwrap_or(written);
            let open = if written.starts_with(b"(") { "" } else { "(" };
            Some(fixer.replace(span, [open.as_bytes(), written, b", ref)"].concat()))
        });
    }
}
