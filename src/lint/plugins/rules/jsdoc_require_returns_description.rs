use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings, JSDocTag, is_function_declaration_or_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires that the `@returns` tag has a description value.
pub struct RequireReturnsDescription;

const MISSING_DESCRIPTION: Message = Message::new("", "Missing JSDoc `@returns` description.");

impl Rule for RequireReturnsDescription {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-returns-description", Kind::Suggestion);
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        RequireReturnsDescription
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.funcs(|_, func, cx| {
                if !is_function_declaration_or_expression(func) {
                    return;
                }
                let Some(node) = cx.state.get_function_nearest_jsdoc_node(func) else {
                    return;
                };
                let settings = JSDocPluginSettings::new(cx.file());
                let resolved_tag_name = settings.resolve_tag_name("returns");
                for tag in cx.state.get_checked_by_node(node, &settings).flat_map(JSDoc::tags) {
                    if tag.kind.parsed() == resolved_tag_name && is_description_missing(tag) {
                        cx.report(tag.kind.span, MISSING_DESCRIPTION);
                    }
                }
            });
        }
        finder
    }
}

fn is_description_missing(tag: JSDocTag) -> bool {
    let (type_part, comment_part) = tag.type_comment();
    let returns_nothing = |it: &[u8]| matches!(it, b"void" | b"undefined" | b"Promise<void>" | b"Promise<undefined>");
    !type_part.is_some_and(|it| returns_nothing(it.parsed())) && comment_part.is_empty()
}
