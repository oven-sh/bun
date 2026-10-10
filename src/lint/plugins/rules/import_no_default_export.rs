use bun_lint_oxlint::import::export_default;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow modules from having default exports.
pub struct NoDefaultExport;

const NO_DEFAULT_EXPORT: Message = Message::new("", "Prefer named exports");

impl Rule for NoDefaultExport {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-default-export", Kind::Suggestion);
    const ON: On = On::new().finish();
    no_state!();

    fn new(_: &Options) -> Self {
        NoDefaultExport
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if let Some(span) = export_default(cx.file()) {
            cx.report(span, NO_DEFAULT_EXPORT);
        }
    }
}
