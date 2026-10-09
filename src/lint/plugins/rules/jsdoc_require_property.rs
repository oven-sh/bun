use crate::oxlint::jsdoc::{JSDocFinder, JSDocPluginSettings};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires that all `@typedef` and `@namespace` tags have `@property` tags when their type is a plain object.
pub struct RequireProperty;

const REQUIRE_PROPERTY: Message =
    Message::new("", "The `@typedef` and `@namespace` tags must include a `@property` tag with the type Object.");

impl Rule for RequireProperty {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-property", Kind::Problem);
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        RequireProperty
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.finish(|_, cx| {
                let settings = JSDocPluginSettings::new(cx.file());
                let resolved_property_tag_name = settings.resolve_tag_name("property");
                let resolved_typedef_tag_name = settings.resolve_tag_name("typedef");
                let resolved_namespace_tag_name = settings.resolve_tag_name("namespace");
                for jsdoc in cx.state.iter_checked(&settings) {
                    // The last `@typedef {Object}` or `@namespace {Object}`, if no `@property` came after it.
                    let mut should_report: Option<Span> = None;
                    for tag in jsdoc.tags() {
                        let tag_name = tag.kind.parsed();
                        if tag_name == resolved_typedef_tag_name || tag_name == resolved_namespace_tag_name {
                            if let Some(span) = should_report {
                                cx.report(span, REQUIRE_PROPERTY);
                            }
                            let Some(type_part) = tag.type_name_comment().0 else {
                                continue;
                            };
                            if matches!(type_part.parsed(), b"Object" | b"object" | b"PlainObject") {
                                should_report = Some(tag.kind.span.to(type_part.span));
                            }
                        }
                        if tag_name == resolved_property_tag_name {
                            should_report = None;
                        }
                    }
                    if let Some(span) = should_report {
                        cx.report(span, REQUIRE_PROPERTY);
                    }
                }
            });
        }
        finder
    }
}
