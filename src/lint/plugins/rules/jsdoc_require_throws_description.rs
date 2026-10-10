use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires a description for `@throws` tags.
pub struct RequireThrowsDescription;

const REQUIRE_THROWS_DESCRIPTION: Message = Message::new("", "Missing JSDoc `@throws` description.");

impl Rule for RequireThrowsDescription {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-throws-description", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        RequireThrowsDescription
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<JSDocFinder<'a>> {
        let finder = JSDocFinder::new(file);
        (!finder.is_empty()).then_some(finder)
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let settings = JSDocPluginSettings::new(cx.file());
        for tag in cx.state.iter_checked(&settings).flat_map(JSDoc::tags) {
            if matches!(tag.kind.parsed(), b"throws" | b"exception") && tag.type_comment().1.is_empty() {
                cx.report(tag.kind.span, REQUIRE_THROWS_DESCRIPTION);
            }
        }
    }
}
