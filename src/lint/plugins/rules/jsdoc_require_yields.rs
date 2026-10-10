use crate::oxlint::jsdoc::{
    Attached, FunctionType, JSDoc, JSDocFinder, JSDocPluginSettings, function_type, is_duplicated_special_tag,
    is_missing_special_tag, should_ignore_as_avoid, should_ignore_as_custom_skip, should_ignore_as_internal,
    should_ignore_as_private,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Requires that yields are documented with `@yields`.
pub struct RequireYields {
    exempted_by: Vec<Box<[u8]>>,
    force_require_yields: bool,
    with_generator_tag: bool,
}

const MISSING_YIELDS: Message = Message::new("", "Missing JSDoc `@yields` declaration for generator function.");
const DUPLICATE_YIELDS: Message = Message::new("", "Duplicate `@yields` tags.");
const MISSING_YIELDS_WITH_GENERATOR: Message = Message::new("", "`@yields` tag is required when using `@generator` tag.");

impl Rule for RequireYields {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "require-yields", Kind::Problem);
    const ON: On = On::new().funcs();
    type State<'a> = JSDocFinder<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let exempted_by = if options.has("exemptedBy") { options.strings("exemptedBy") } else { vec!["inheritdoc"] };
        RequireYields {
            exempted_by: exempted_by.iter().map(|it| it.as_bytes().into()).collect(),
            force_require_yields: options.bool_or("forceRequireYields", false),
            with_generator_tag: options.bool_or("withGeneratorTag", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<JSDocFinder<'a>> {
        let finder = JSDocFinder::new(file);
        (!finder.is_empty()).then_some(finder)
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        self.check(func, cx);
    }
}

impl RequireYields {
    /// All the comments can be ignored.
    fn is_ignored(&self, finder: &JSDocFinder, node: Attached, settings: &JSDocPluginSettings) -> bool {
        finder.get_all_by_node(node).all(|jsdoc| {
            should_ignore_as_custom_skip(jsdoc)
                || should_ignore_as_avoid(jsdoc, settings, &self.exempted_by)
                || should_ignore_as_private(jsdoc, settings)
                || should_ignore_as_internal(jsdoc, settings)
        })
    }

    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !func.is_generator() || function_type(func).is_none_or(|it| it == FunctionType::ArrowFunctionExpression) {
            return;
        }
        let Some(node) = cx.state.get_function_nearest_jsdoc_node(func) else {
            return;
        };
        let settings = JSDocPluginSettings::new(cx.file());
        if self.is_ignored(&cx.state, node, &settings) {
            return;
        }
        let jsdoc_tags = cx.state.get_all_by_node(node).flat_map(JSDoc::tags);
        let resolved_yields_tag_name = settings.resolve_tag_name("yields");
        let is_missing = is_missing_special_tag(jsdoc_tags.clone(), resolved_yields_tag_name);
        if !self.force_require_yields && is_missing {
            // Once for each `yield` with a value.
            for _ in func.yields().filter(|it| matches!(it.kind(), ExprKind::Yield { value: Some(_), .. })) {
                cx.report(func.estree_span(), MISSING_YIELDS);
            }
        }
        if self.force_require_yields && is_missing {
            cx.report(func.estree_span(), MISSING_YIELDS);
        } else if let Some(span) = is_duplicated_special_tag(jsdoc_tags.clone(), resolved_yields_tag_name) {
            cx.report(span, DUPLICATE_YIELDS);
        } else if self.with_generator_tag && is_missing {
            let resolved_generator_tag_name = settings.resolve_tag_name("generator");
            if let Some(tag) = jsdoc_tags.filter(|tag| tag.kind.parsed() == resolved_generator_tag_name).last() {
                cx.report(tag.kind.span, MISSING_YIELDS_WITH_GENERATOR);
            }
        }
    }
}
