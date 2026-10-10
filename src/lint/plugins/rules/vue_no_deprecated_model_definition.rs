use bun_lint_oxlint::ast_util::{get_inner_expression, static_string};
use crate::oxlint::vue::{
    as_inner_object_expression, find_property, is_specific_static_name, is_vue_component_options_object, is_vue_file, object_of,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallow deprecated `model` definition (in Vue.js 3.0.0+).
pub struct NoDeprecatedModelDefinition {
    allow_vue3_compat: bool,
}

const DEPRECATED_MODEL: Message = Message::new("", "`model` definition is deprecated.");
const VUE3_COMPAT: Message = Message::new(
    "",
    "`model` definition is deprecated. You may use the Vue 3-compatible `modelValue`/`update:modelValue` though.",
);

impl Rule for NoDeprecatedModelDefinition {
    const META: Meta = Meta::oxlint(Plugin::Vue, "no-deprecated-model-definition", Kind::Problem);
    const ON: On = On::new().props();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoDeprecatedModelDefinition { allow_vue3_compat: options.object(0).bool_or("allowVue3Compat", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_file(file) || !file.mentions("model") {
            return None;
        }
        Some(())
    }

    fn prop<'a>(&self, prop: Prop<'a>, cx: &mut Cx<'a, Self>) {
        if prop.kind() == PropKind::Spread || !is_specific_static_name(prop, "model") {
            return;
        }
        let Some(model_value) = prop.value().and_then(as_inner_object_expression) else {
            return;
        };
        if !object_of(prop).is_some_and(is_vue_component_options_object) {
            return;
        }
        if !self.allow_vue3_compat {
            cx.report(prop, DEPRECATED_MODEL);
            return;
        }
        let names = (find_string_property_value(model_value, "prop"), find_string_property_value(model_value, "event"));
        let is_vue3_compat = matches!(
            (names.0.map(Name::bytes), names.1.map(Name::bytes)),
            (Some(b"modelValue"), Some(b"update:modelValue")) | (Some(b"model-value"), Some(b"update:model-value"))
        );
        if !is_vue3_compat {
            cx.report(prop, VUE3_COMPAT);
        }
    }
}

fn find_string_property_value<'a>(properties: List<'a, Prop<'a>>, key: &str) -> Option<Name<'a>> {
    static_string(get_inner_expression(find_property(properties, key)?.value()?))
}
