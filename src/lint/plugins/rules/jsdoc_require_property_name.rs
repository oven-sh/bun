use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires that all `@property` tags have names.
pub struct RequirePropertyName;

const REQUIRE_PROPERTY_NAME: Message = Message::new("", "Missing name in `@property` tag.");

impl Rule for RequirePropertyName {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-property-name", Kind::Problem);
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        RequirePropertyName
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|_, cx| {
                let settings = JSDocPluginSettings::new(cx.file());
                let resolved_property_tag_name = settings.resolve_tag_name("property");
                for tag in cx.state.iter_checked(&settings).flat_map(JSDoc::tags) {
                    if tag.kind.parsed() == resolved_property_tag_name && tag.type_name_comment().1.is_none() {
                        cx.report(tag.kind.span, REQUIRE_PROPERTY_NAME);
                    }
                }
            });
        }
        finder
    }
}
