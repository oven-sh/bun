use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires that all `@property` tags have descriptions.
pub struct RequirePropertyDescription;

const REQUIRE_PROPERTY_DESCRIPTION: Message = Message::new("", "Missing description in `@property` tag.");

impl Rule for RequirePropertyDescription {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-property-description", Kind::Problem);
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        RequirePropertyDescription
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|_, cx| {
                let settings = JSDocPluginSettings::new(cx.file());
                let resolved_property_tag_name = settings.resolve_tag_name("property");
                for tag in cx.state.iter_checked(&settings).flat_map(JSDoc::tags) {
                    if tag.kind.parsed() == resolved_property_tag_name && tag.type_name_comment().2.is_empty() {
                        cx.report(tag.kind.span, REQUIRE_PROPERTY_DESCRIPTION);
                    }
                }
            });
        }
        finder
    }
}
