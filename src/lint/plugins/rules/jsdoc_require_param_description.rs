use crate::oxlint::jsdoc::{JSDocFinder, JSDocPluginSettings, is_function_with_body, param_tags};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires that each `@param` tag has a description value.
pub struct RequireParamDescription {
    set_default_destructured_root_description: bool,
}

const MISSING_DESCRIPTION: Message = Message::new("", "Missing JSDoc `@param` description.");
const MISSING_ROOT_DESCRIPTION: Message = Message::new("", "Missing root description for @param.");

impl Rule for RequireParamDescription {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-param-description", Kind::Suggestion);
    type State<'a> = JSDocFinder<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        RequireParamDescription {
            set_default_destructured_root_description: options.bool_or("setDefaultDestructuredRootDescription", false),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> JSDocFinder<'a> {
        let finder = JSDocFinder::new(file);
        if !finder.is_empty() {
            on.funcs(|rule, func, cx| {
                if !is_function_with_body(func) {
                    return;
                }
                let Some(node) = cx.state.get_function_nearest_jsdoc_node(func) else {
                    return;
                };
                let settings = JSDocPluginSettings::new(cx.file());
                let jsdocs = cx.state.get_checked_by_node(node, &settings);
                for tag in param_tags(jsdocs, func, settings.resolve_tag_name("param")) {
                    if settings.exempt_destructured_roots_from_checks && tag.is_about_nested_param || !tag.comment_part.is_empty() {
                        continue;
                    }
                    let is_destructured_root = tag.is_current_root_tag && tag.is_about_nested_param;
                    let is_root = rule.set_default_destructured_root_description && is_destructured_root;
                    cx.report(tag.kind.span, if is_root { MISSING_ROOT_DESCRIPTION } else { MISSING_DESCRIPTION });
                }
            });
        }
        finder
    }
}
