use crate::bun::{RunsLater, runs_while_module_is_evaluated};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::static_string;

/// Disallow loading a native addon while the module is evaluated.
pub struct NoEagerNativeAddon;

const EAGER_ADDON: Message = Message::new(
    "eagerAddon",
    "The native addon `{{specifier}}` is loaded as soon as the module is evaluated. Load it in the function that first needs it.",
);

fn is_native_addon(specifier: Name) -> bool {
    specifier.bytes().ends_with(b".node")
}

/// `e` is `require(specifier)` or `import(specifier)`.
fn check_call<'a>(e: Expr<'a>, specifier: Option<Expr<'a>>, cx: &mut Cx<'a, NoEagerNativeAddon>) {
    if let Some(specifier) = specifier.and_then(static_string).filter(|it| is_native_addon(*it))
        && runs_while_module_is_evaluated(Node::Expr(e), &mut cx.state)
    {
        cx.report(e, EAGER_ADDON).data("specifier", specifier.bytes());
    }
}

impl Rule for NoEagerNativeAddon {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-eager-native-addon", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::ImportCall, ExprTag::Call]).stmts(&[
        StmtTag::Import,
        StmtTag::ExportNamed,
        StmtTag::ExportStar,
    ]);
    type State<'a> = RunsLater<'a>;

    fn new(_: &Options) -> Self {
        NoEagerNativeAddon
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<RunsLater<'a>> {
        Some(RunsLater::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let specifier = match statement.kind() {
            StmtKind::Import(import) if !import.is_type_only() => Some(import.spec()),
            StmtKind::ExportNamed(export) if !export.is_type_only() => export.spec(),
            StmtKind::ExportStar { spec, type_only: false, .. } => spec,
            _ => None,
        };
        if let Some(specifier) = specifier.filter(|it| is_native_addon(*it))
            && let Some(span) = statement.module_specifier_span()
        {
            cx.report(span, EAGER_ADDON).data("specifier", specifier.bytes());
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::ImportCall => {
                if let ExprKind::ImportCall { args } = e.kind() {
                    check_call(e, args.first(), cx);
                }
            }
            ExprTag::Call if cx.file().mentions("require") => {
                if let Some(call) = e.as_call().filter(|it| it.callee().is_ident("require")) {
                    check_call(e, call.args().first(), cx);
                }
            }
            _ => {}
        }
    }
}
