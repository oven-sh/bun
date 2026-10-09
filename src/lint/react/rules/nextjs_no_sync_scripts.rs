use crate::jsx::has_jsx_prop;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prevent the use of synchronous `<script>` tags in Next.js applications.
pub struct NoSyncScripts;

const NO_SYNC_SCRIPTS: Message = Message::new("", "Prevent synchronous scripts.");

impl Rule for NoSyncScripts {
    const META: Meta = Meta::oxlint(Plugin::Nextjs, "no-sync-scripts", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoSyncScripts
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("script") {
            return;
        }
        on.exprs([ExprTag::Jsx], |_, e, cx| {
            if let ExprKind::Jsx(jsx) = e.kind()
                && let Some(name) = jsx.tag().filter(|it| it.is_ident("script"))
                && has_jsx_prop(jsx, "src").is_some()
                && has_jsx_prop(jsx, "async").is_none()
                && has_jsx_prop(jsx, "defer").is_none()
            {
                cx.report(name, NO_SYNC_SCRIPTS);
            }
        });
    }
}
