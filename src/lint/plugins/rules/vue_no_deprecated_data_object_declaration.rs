use crate::oxlint::vue::{
    as_inner_object_expression, is_specific_static_name, is_vue_component_options_object,
    is_vue_component_options_object_excluding_instance, is_vue_file, may_have_component_options, object_of,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow object declarations for `data` (in Vue.js 3.0.0+). `SHARED`: enforce that the `data` property of a Vue component
/// definition is a function.
pub struct NoDataObject<const SHARED: bool = false>;

impl<const SHARED: bool> Rule for NoDataObject<SHARED> {
    const META: Meta = Meta::oxlint(
        Plugin::Vue,
        if SHARED { "no-shared-component-data" } else { "no-deprecated-data-object-declaration" },
        Kind::Problem,
    );
    const ON: On = On::new().props();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        Self
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        ((SHARED || is_vue_file(file)) && file.mentions("data") && may_have_component_options(file)).then_some(())
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        let is_options_object =
            if SHARED { is_vue_component_options_object_excluding_instance } else { is_vue_component_options_object };
        if prop.kind() != PropKind::Spread
            && is_specific_static_name(prop, "data")
            && prop.value().and_then(as_inner_object_expression).is_some()
            && object_of(prop).is_some_and(is_options_object)
        {
            let message = match SHARED {
                true => Message::new("", "`data` property in component must be a function."),
                false => Message::new("", "Object declaration on `data` property is deprecated."),
            };
            cx.report(prop, message);
        }
    }
}
