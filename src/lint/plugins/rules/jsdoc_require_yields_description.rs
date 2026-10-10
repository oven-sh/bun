use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires a description for `@yields` tags.
pub struct RequireYieldsDescription;

const REQUIRE_YIELDS_DESCRIPTION: Message = Message::new("", "Missing JSDoc `@yields` description.");

impl Rule for RequireYieldsDescription {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-yields-description", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        RequireYieldsDescription
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<JSDocFinder<'a>> {
        let finder = JSDocFinder::new(file);
        (!finder.is_empty()).then_some(finder)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let settings = JSDocPluginSettings::new(cx.file());
        for tag in cx.state.iter_checked(&settings).flat_map(JSDoc::tags) {
            if matches!(tag.kind.parsed(), b"yield" | b"yields") && tag.type_comment().1.is_empty() {
                cx.report(tag.kind.span, REQUIRE_YIELDS_DESCRIPTION);
            }
        }
    }
}
