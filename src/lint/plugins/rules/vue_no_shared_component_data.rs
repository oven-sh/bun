use crate::oxlint::vue::{
    as_inner_object_expression, is_specific_static_name, is_vue_component_options_object_excluding_instance, object_of,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that the `data` property of a Vue component definition is a function.
pub struct NoSharedComponentData;

const NO_SHARED_COMPONENT_DATA: Message = Message::new("", "`data` property in component must be a function.");

impl Rule for NoSharedComponentData {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-shared-component-data", Kind::Problem);
    const ON: On = On::new().props();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoSharedComponentData
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.mentions("data").then_some(())
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if prop.kind() != PropKind::Spread
            && is_specific_static_name(prop, "data")
            && prop.value().and_then(as_inner_object_expression).is_some()
            && object_of(prop).is_some_and(is_vue_component_options_object_excluding_instance)
        {
            cx.report(prop, NO_SHARED_COMPONENT_DATA);
        }
    }
}
