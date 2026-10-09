use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires a type on the `@throws` tag.
pub struct RequireThrowsType;

const REQUIRE_THROWS_TYPE: Message = Message::new("", "Missing JSDoc `@throws` type.");

impl Rule for RequireThrowsType {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-throws-type", Kind::Suggestion);
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        RequireThrowsType
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|_, cx| {
                let settings = JSDocPluginSettings::new(cx.file());
                for tag in cx.state.iter_checked(&settings).flat_map(JSDoc::tags) {
                    if matches!(tag.kind.parsed(), b"throws" | b"exception") && tag.type_comment().0.is_none() {
                        cx.report(tag.kind.span, REQUIRE_THROWS_TYPE);
                    }
                }
            });
        }
        finder
    }
}
