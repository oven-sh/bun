use crate::jsx::has_jsx_prop;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent the use of synchronous `<script>` tags in Next.js applications.
pub struct NoSyncScripts;

const NO_SYNC_SCRIPTS: Message = Message::new("", "Prevent synchronous scripts.");

impl Rule for NoSyncScripts {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-sync-scripts", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoSyncScripts
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("script").then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let ExprKind::Jsx(jsx) = e.kind()
            && let Some(name) = jsx.tag().filter(|it| it.is_ident("script"))
            && has_jsx_prop(jsx, "src").is_some()
            && has_jsx_prop(jsx, "async").is_none()
            && has_jsx_prop(jsx, "defer").is_none()
        {
            cx.report(name, NO_SYNC_SCRIPTS);
        }
    }
}
