use crate::stores::store_calls;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// disallow using async/await inside svelte stores because it causes issues with the auto-unsubscribing features
pub struct NoStoreAsync;

const UNEXPECTED: Message = Message::new("unexpected", "Do not pass async functions to svelte stores.");

impl Rule for NoStoreAsync {
    const META: Meta = Meta::plugin(Plugin::Svelte, "no-store-async", Kind::Problem).recommended();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoStoreAsync
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("svelte/store").then_some(())
    }

    /// Upstream's `Program` listener.
    fn finish<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        for call in store_calls(file).into_iter().filter_map(Expr::as_call_or_new) {
            let Some(e) = call.args().get(1) else {
                continue;
            };
            let Some(func) = e.as_fn().filter(|it| it.is_async()) else {
                continue;
            };
            if !matches!(func.kind(), FnKind::Arrow | FnKind::Expr) {
                continue;
            }
            // Five columns: `async`.
            let start = e.span().start;
            cx.report(Span::new(start, start + 5), UNEXPECTED).listened_by(Node::File(file), false);
        }
    }
}
