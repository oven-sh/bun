use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires that each `@property` tag has a type value (within curly brackets).
pub struct RequirePropertyType;

const REQUIRE_PROPERTY_TYPE: Message = Message::new("", "Missing type in `@property` tag.");

impl Rule for RequirePropertyType {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-property-type", Kind::Problem);
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        RequirePropertyType
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|_, cx| {
                let settings = JSDocPluginSettings::new(cx.file());
                let resolved_property_tag_name = settings.resolve_tag_name("property");
                for tag in cx.state.iter_checked(&settings).flat_map(JSDoc::tags) {
                    if tag.kind.parsed() == resolved_property_tag_name && tag.type_name_comment().0.is_none() {
                        cx.report(tag.kind.span, REQUIRE_PROPERTY_TYPE);
                    }
                }
            });
        }
        finder
    }
}
