use crate::util_components::Components;
use crate::util_components_list::{DeclaredPropTypes, DefaultProps};
use crate::util_default_props::defaults;
use crate::util_prop_types::{declared, is_in_object_prototype};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use std::borrow::Cow;

/// Enforce all defaultProps have a corresponding non-required PropType.
pub struct DefaultPropsMatchPropTypes {
    allow_required_defaults: bool,
}

const REQUIRED_HAS_DEFAULT: Message =
    Message::new("requiredHasDefault", "defaultProp \"{{name}}\" defined for isRequired propType.");
const DEFAULT_HAS_NO_TYPE: Message =
    Message::new("defaultHasNoType", "defaultProp \"{{name}}\" has no corresponding propTypes declaration.");

impl Rule for DefaultPropsMatchPropTypes {
    const META: Meta =
        Meta::plugin(Plugin::React, "default-props-match-prop-types", Kind::Suggestion).reports_at_the_end();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let allow_required_defaults = options.object(0).bool_or("allowRequiredDefaults", false);
        DefaultPropsMatchPropTypes { allow_required_defaults }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // The `name` of a `PrivateIdentifier` is without the `#`.
        let names = ["defaultProps", "getDefaultProps", "#defaultProps", "#getDefaultProps"];
        (file.mentions_any(&names) && Components::may_have_any(file)).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut components = Components::new(cx.file()).with(declared(&[])).with(defaults());
        components.finish();
        for id in components.list() {
            let component = components.component(id);
            if let Some(DefaultProps::Known(default_props)) = &component.default_props
                && let Some(prop_types) = &component.declared_prop_types
            {
                self.report_invalid_default_props(prop_types, default_props, cx);
            }
        }
    }
}

impl DefaultPropsMatchPropTypes {
    /// upstream's `reportInvalidDefaultProps`
    fn report_invalid_default_props<'a>(
        &self,
        prop_types: &DeclaredPropTypes<'a>,
        default_props: &[(Cow<'a, [u8]>, Node<'a>)],
        cx: &Cx<'a, Self>,
    ) {
        if prop_types.is_empty() {
            return;
        }
        for (default_prop_name, node) in default_props {
            let message = match prop_types.get(default_prop_name) {
                Some(prop) if self.allow_required_defaults || prop.is_required != Some(true) => continue,
                Some(_) => REQUIRED_HAS_DEFAULT,
                // `propTypes[name]` is a function of `Object.prototype`.
                None if is_in_object_prototype(default_prop_name) => continue,
                None => DEFAULT_HAS_NO_TYPE,
            };
            cx.report(*node, message).data("name", default_prop_name.clone());
        }
    }
}
