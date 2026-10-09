use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings, is_function_declaration_or_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Reports defaults being used on `@param` or `@default` tags.
pub struct NoDefaults {
    no_optional_param_names: bool,
}

const NO_DEFAULTS: Message = Message::new("", "Defaults are not permitted.");

impl Rule for NoDefaults {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "no-defaults", Kind::Problem);
    type State<'a> = JSDocFinder<'a>;

    fn new(options: &Options) -> Self {
        NoDefaults { no_optional_param_names: options.object(0).bool_or("noOptionalParamNames", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.funcs(|rule, func, cx| {
                if !is_function_declaration_or_expression(func) {
                    return;
                }
                let Some(node) = cx.state.get_function_nearest_jsdoc_node(func) else {
                    return;
                };
                let settings = JSDocPluginSettings::new(cx.file());
                let resolved_param_tag_name = settings.resolve_tag_name("param");
                for tag in cx.state.get_checked_by_node(node, &settings).flat_map(JSDoc::tags) {
                    if tag.kind.parsed() == resolved_param_tag_name
                        && let Some(name_part) = tag.type_name_comment().1
                        && name_part.optional
                        && (rule.no_optional_param_names || name_part.default)
                    {
                        let what = if rule.no_optional_param_names { "Optional param names" } else { "Defaults" };
                        cx.report(name_part.span, NO_DEFAULTS).data("what", what).data("tag_name", resolved_param_tag_name);
                    }
                }
            });
        }
        finder
    }
}
