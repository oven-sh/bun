use crate::oxlint::vue::{
    as_inner_object_expression, is_specific_static_name, is_vue_component_options_object, is_vue_file, object_of,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow object declarations for `data` (in Vue.js 3.0.0+).
pub struct NoDeprecatedDataObjectDeclaration;

const NO_DEPRECATED_DATA_OBJECT_DECLARATION: Message = Message::new("", "Object declaration on `data` property is deprecated.");

impl Rule for NoDeprecatedDataObjectDeclaration {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-deprecated-data-object-declaration", Kind::Problem);
    const ON: On = On::new().props();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDeprecatedDataObjectDeclaration
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (is_vue_file(file) && file.mentions("data")).then_some(())
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if prop.kind() != PropKind::Spread
            && is_specific_static_name(prop, "data")
            && prop.value().and_then(as_inner_object_expression).is_some()
            && object_of(prop).is_some_and(is_vue_component_options_object)
        {
            cx.report(prop, NO_DEPRECATED_DATA_OBJECT_DECLARATION);
        }
    }
}
