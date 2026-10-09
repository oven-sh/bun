use crate::oxlint::jsdoc::{JSDocFinder, JSDocPluginSettings, is_function_with_body, param_tags};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires that each `@param` tag has a type value (within curly brackets).
pub struct RequireParamType {
    default_destructured_root_type: Box<str>,
    set_default_destructured_root_type: bool,
}

const MISSING_TYPE: Message = Message::new("", "Missing JSDoc `@param` type.");
const MISSING_ROOT_TYPE: Message = Message::new("", "Missing root type for @param.");

impl Rule for RequireParamType {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-param-type", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = JSDocFinder<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        RequireParamType {
            default_destructured_root_type: options.str("defaultDestructuredRootType").unwrap_or("object").into(),
            set_default_destructured_root_type: options.bool_or("setDefaultDestructuredRootType", false),
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
                    if settings.exempt_destructured_roots_from_checks && tag.is_about_nested_param || tag.type_part.is_some() {
                        continue;
                    }
                    let is_destructured_root = tag.is_current_root_tag && tag.is_about_nested_param;
                    match tag.name_part.filter(|_| rule.set_default_destructured_root_type && is_destructured_root) {
                        Some(name_part) => cx.report(tag.kind.span, MISSING_ROOT_TYPE).fix(|fixer| {
                            fixer.insert_before(name_part.span, format!("{{{}}} ", rule.default_destructured_root_type))
                        }),
                        None => cx.report(tag.kind.span, MISSING_TYPE),
                    };
                }
            });
        }
        finder
    }
}
