use crate::a11y::{
    HTML_TAG, LabelSearch, is_hidden_from_screen_reader, is_interactive_element, is_interactive_role,
    search_for_accessible_label,
};
use crate::jsx::{
    AttributeValue, as_jsx_element, children, get_element_type, get_jsx_attribute_name, get_prop_value,
    get_string_literal_prop_value, has_jsx_prop,
};
use bun_lint_oxlint::text::{contains_name, split_whitespace};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that a control (an interactive element) has a text label.
pub struct ControlHasAssociatedLabel {
    depth: u8,
    /// Besides `alt`, `aria-label` and `aria-labelledby`.
    label_attributes: Vec<String>,
    control_components: Vec<String>,
    /// Besides `link`.
    ignore_elements: Vec<String>,
    ignore_roles: Vec<String>,
}

const CONTROL_HAS_ASSOCIATED_LABEL: Message = Message::new("", "A control must be associated with a text label.");

impl Rule for ControlHasAssociatedLabel {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "control-has-associated-label", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let strings = |key: &str, default: &[&str]| -> Vec<String> {
            match config.has(key) {
                true => config.strings(key).into_iter().map(String::from).collect(),
                false => default.iter().map(|it| (*it).to_owned()).collect(),
            }
        };
        ControlHasAssociatedLabel {
            depth: config.number("depth").filter(|it| (0.0..=25.0).contains(it) && it.fract() == 0.0).map_or(2, |it| it as u8),
            label_attributes: strings("labelAttributes", &[]),
            control_components: strings("controlComponents", &[]),
            ignore_elements: strings("ignoreElements", &["audio", "canvas", "embed", "input", "textarea", "tr", "video"]),
            ignore_roles: strings(
                "ignoreRoles",
                &["grid", "listbox", "menu", "menubar", "radiogroup", "row", "tablist", "toolbar", "tree", "treegrid"],
            ),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(element) = as_jsx_element(e) else {
                return;
            };
            let has = |names: &[String], name: &[u8]| names.iter().any(|it| it.as_bytes() == name);
            let element_type = get_element_type(cx.file(), element);
            let role = has_jsx_prop(element, "role").and_then(get_string_literal_prop_value);
            let is_control = is_interactive_element(&element_type, element)
                || role.is_some_and(is_interactive_role) && contains_name(&HTML_TAG, &element_type)
                || has(&rule.control_components, &element_type);
            if !is_control
                || *element_type == *b"link"
                || has(&rule.ignore_elements, &element_type)
                || role.is_some_and(|role| has(&rule.ignore_roles, role))
                || is_hidden_from_screen_reader(cx.file(), element)
            {
                return;
            }
            let search = LabelSearch {
                depth: rule.depth,
                has_labelling_prop: &|element| rule.has_labelling_prop(element),
                is_control_component: &|name| has(&rule.control_components, name),
            };
            if !rule.has_labelling_prop(element)
                && !children(cx.file(), element).any(|child| search_for_accessible_label(cx.file(), child, 1, &search))
            {
                cx.report(element.opening_span(), CONTROL_HAS_ASSOCIATED_LABEL);
            }
        });
    }
}

impl ControlHasAssociatedLabel {
    fn has_labelling_prop(&self, element: Jsx) -> bool {
        element.attrs().iter().any(|attribute| {
            let Some(attr_name) = get_jsx_attribute_name(attribute) else {
                return true;
            };
            let is_labelling = matches!(attr_name, b"alt" | b"aria-label" | b"aria-labelledby")
                || self.label_attributes.iter().any(|it| it.as_bytes() == attr_name);
            is_labelling
                && match get_prop_value(attribute) {
                    None => false,
                    Some(AttributeValue::StringLiteral(literal)) => split_whitespace(literal.value).next().is_some(),
                    Some(_) => true,
                }
        })
    }
}
