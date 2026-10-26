use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// svelte/internal will be removed in Svelte 6.
pub struct NoSvelteInternal;

const UNEXPECTED: Message = Message::new(
    "unexpected",
    "Using svelte/internal is prohibited. This will be removed in Svelte 6.",
);

fn is_svelte_internal(name: Name<'_>) -> bool {
    let value = name.bytes();
    value == b"svelte/internal" || value.starts_with(b"svelte/internal/")
}

impl Rule for NoSvelteInternal {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-svelte-internal", Kind::Problem).recommended();
    const ON: On = On::new()
        .exprs(&[ExprTag::ImportCall])
        .stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoSvelteInternal
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::ImportCall { args } = e.kind()
            && let Some(ExprKind::String(source)) = args.iter().next().map(Expr::kind)
            && is_svelte_internal(source)
        {
            cx.report(e, UNEXPECTED);
        }
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let source = match stmt.kind() {
            StmtKind::Import(import) => Some(import.spec()),
            StmtKind::ExportNamed(export) => export.spec(),
            StmtKind::ExportStar { spec, .. } => spec,
            _ => None,
        };
        if source.is_some_and(is_svelte_internal) {
            cx.report(stmt, UNEXPECTED);
        }
    }
}
