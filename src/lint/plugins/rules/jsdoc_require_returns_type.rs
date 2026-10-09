use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings, is_function_declaration_or_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires that the `@returns` tag has a type value (in curly brackets).
pub struct RequireReturnsType;

const MISSING_TYPE: Message = Message::new("", "Missing JSDoc `@returns` type.");

impl Rule for RequireReturnsType {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-returns-type", Kind::Suggestion);
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        RequireReturnsType
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
                    if tag.kind.parsed() == resolved_tag_name && tag.type_comment().0.is_none() {
                        cx.report(tag.kind.span, MISSING_TYPE);
                    }
                }
            });
        }
        finder
    }
}
