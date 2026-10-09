use crate::oxlint::vue::{
    definitely_returns_in_all_codepaths, is_specific_static_name, is_vue_component_options_object, key_span, object_of,
    property_of_function,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that a `render` function always returns a value.
pub struct RequireRenderReturn;

const REQUIRE_RENDER_RETURN: Message = Message::new("", "Expected to return a value in render function.");

impl Rule for RequireRenderReturn {
    const META: Meta = Meta::oxlint(Plugin::Vue, "require-render-return", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireRenderReturn
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("render") {
            return;
        }
        on.funcs(|_, func, cx| {
            if let Some(prop) = property_of_function(func)
                && is_specific_static_name(prop, "render")
                && object_of(prop).is_some_and(is_vue_component_options_object)
                && !definitely_returns_in_all_codepaths(func, true)
            {
                cx.report(key_span(prop), REQUIRE_RENDER_RETURN);
            }
        });
    }
}
