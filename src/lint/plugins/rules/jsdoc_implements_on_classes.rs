use crate::oxlint::jsdoc::{JSDoc, JSDocFinder, JSDocPluginSettings, is_function_declaration_or_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Reports an issue with any non-constructor function using `@implements`.
pub struct ImplementsOnClasses;

const IMPLEMENTS_ON_CLASSES: Message = Message::new("", "`@implements` used on a non-constructor function");

/// It is a method of a class, or the value of a property of a class.
fn is_function_inside_of_class(func: Func) -> bool {
    match func.owner() {
        Node::Member(_) => true,
        Node::Expr(e) => matches!(e.parent(), Node::Member(member) if !member.flags().contains(Flags::ACCESSOR)),
        _ => false,
    }
}

impl Rule for ImplementsOnClasses {
    const META: Meta = Meta::oxlint(Plugin::Jsdoc, "implements-on-classes", Kind::Problem);
    const ON: On = On::new().funcs();
    type State<'a> = JSDocFinder<'a>;

    fn new(_: &Options) -> Self {
        ImplementsOnClasses
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<JSDocFinder<'a>> {
        let finder = JSDocFinder::new(file);
        (!finder.is_empty()).then_some(finder)
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !is_function_declaration_or_expression(func) || is_function_inside_of_class(func) {
            return;
        }
        let Some(node) = cx.state.get_function_nearest_jsdoc_node(func) else {
            return;
        };
        let settings = JSDocPluginSettings::new(cx.file());
        let resolved_implements_tag_name = settings.resolve_tag_name("implements");
        let resolved_class_tag_name = settings.resolve_tag_name("class");
        let resolved_constructor_tag_name = settings.resolve_tag_name("constructor");
        let (mut implements_found, mut class_or_ctor_found) = (None, false);
        for tag in cx.state.get_checked_by_node(node, &settings).flat_map(JSDoc::tags) {
            let tag_name = tag.kind.parsed();
            if tag_name == resolved_implements_tag_name {
                implements_found = Some(tag.kind.span);
            }
            class_or_ctor_found |= tag_name == resolved_class_tag_name || tag_name == resolved_constructor_tag_name;
        }
        if let Some(span) = implements_found.filter(|_| !class_or_ctor_found) {
            cx.report(span, IMPLEMENTS_ON_CLASSES);
        }
    }
}
