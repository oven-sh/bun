use crate::a11y::{is_null_literal, object_has_accessible_child};
use crate::jsx::{
    AttributeValue, as_jsx_element, get_element_type, get_prop_value, get_string_literal_prop_value, has_jsx_prop_ignore_case,
    is_undefined,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that all elements that require alternative text have meaningful information to relay back to the end user.
pub struct AltText {
    /// For each kind of element the components that are checked like it. `None`: the kind is not checked.
    img: Option<Vec<String>>,
    object: Option<Vec<String>>,
    area: Option<Vec<String>>,
    input_type_image: Option<Vec<String>>,
}

const MISSING_ALT_PROP: Message = Message::new("", "Missing `alt` attribute.");
const MISSING_ALT_VALUE: Message = Message::new("", "Invalid `alt` value.");
const ARIA_LABEL_VALUE: Message = Message::new("", "Missing value for `aria-label` attribute.");
const ARIA_LABELLED_BY_VALUE: Message = Message::new("", "Missing value for `aria-labelledby` attribute.");
const PREFER_ALT: Message = Message::new("", "ARIA used where native HTML could suffice.");
/// For `object`, `area` and `input[type="image"]`.
const MISSING_ALTERNATIVE_TEXT: Message = Message::new("", "Missing alternative text.");
const OBJECT_HELP: &str =
    "Embedded <object> elements must have a text alternative through the `alt`, `aria-label`, or `aria-labelledby` prop.";
const AREA_HELP: &str =
    "Each area of an image map must have a text alternative through the `alt`, `aria-label`, or `aria-labelledby` prop.";
const INPUT_TYPE_IMAGE_HELP: &str = "<input> elements with type=\"image\" must have a text alternative through the `alt`, `aria-label`, or `aria-labelledby` prop.";

impl Rule for AltText {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "alt-text", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Jsx]);
    no_state!();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let elements = config.get("elements").and_then(Json::as_array);
        let tags = |field: &str| -> Option<Vec<String>> {
            elements
                .is_none_or(|all| all.iter().any(|it| it.as_str() == Some(field.as_bytes())))
                .then(|| config.strings(field).into_iter().map(String::from).collect())
        };
        AltText {
            img: tags("img"),
            object: tags("object"),
            area: tags("area"),
            input_type_image: tags("input[type=\"image\"]"),
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(jsx_el) = as_jsx_element(e) else {
            return;
        };
        let name = get_element_type(cx.file(), jsx_el);
        let is_custom = |custom_tags: &[String]| custom_tags.iter().any(|it| *it.as_bytes() == *name);
        let is = |tag: &[u8], custom_tags: &Option<Vec<String>>| {
            custom_tags.as_ref().is_some_and(|custom_tags| *name == *tag || is_custom(custom_tags))
        };
        let is_input = |custom_tags: &Vec<String>| is_input_with_type_image(&name, jsx_el) || is_custom(custom_tags);
        // The three with one message are told apart by the help.
        let (message, help) = if is(b"img", &self.img) {
            (img_rule(jsx_el), "")
        } else if is(b"object", &self.object) {
            (object_rule(cx.file(), jsx_el), OBJECT_HELP)
        } else if is(b"area", &self.area) {
            (area_rule(jsx_el), AREA_HELP)
        } else if self.input_type_image.as_ref().is_some_and(is_input) {
            (area_rule(jsx_el), INPUT_TYPE_IMAGE_HELP)
        } else {
            (None, "")
        };
        if let Some(message) = message {
            let report = cx.report(jsx_el.opening_span(), message);
            if !help.is_empty() {
                report.help(help);
            }
        }
    }
}

fn is_input_with_type_image(name: &[u8], jsx_el: Jsx) -> bool {
    name.eq_ignore_ascii_case(b"input")
        && has_jsx_prop_ignore_case(jsx_el, "type").and_then(get_string_literal_prop_value).is_some_and(|it| it == b"image")
}

fn is_valid_alt_prop(item: Prop) -> bool {
    match get_prop_value(item) {
        None => false,
        Some(AttributeValue::ExpressionContainer(e)) => {
            !is_null_literal(e) && !is_undefined(e) && (e.unary_op() != Some(UnOp::Void) || e.is_parenthesized())
        }
        _ => true,
    }
}

fn is_presentation_role(item: Prop) -> bool {
    matches!(get_string_literal_prop_value(item), Some(b"presentation" | b"none"))
}

fn aria_label_has_value(item: Prop) -> bool {
    match get_prop_value(item) {
        None => false,
        Some(AttributeValue::StringLiteral(literal)) => !literal.value.is_empty(),
        Some(AttributeValue::ExpressionContainer(e)) => !is_undefined(e),
        _ => true,
    }
}

fn has_label(node: Jsx) -> bool {
    has_jsx_prop_ignore_case(node, "aria-label").is_some_and(aria_label_has_value)
        || has_jsx_prop_ignore_case(node, "aria-labelledby").is_some_and(aria_label_has_value)
}

fn img_rule(node: Jsx) -> Option<Message> {
    if let Some(alt_prop) = has_jsx_prop_ignore_case(node, "alt") {
        return (!is_valid_alt_prop(alt_prop)).then_some(MISSING_ALT_VALUE);
    }
    if has_jsx_prop_ignore_case(node, "role").is_some_and(is_presentation_role) {
        return Some(PREFER_ALT);
    }
    if let Some(aria_label_prop) = has_jsx_prop_ignore_case(node, "aria-label") {
        return (!aria_label_has_value(aria_label_prop)).then_some(ARIA_LABEL_VALUE);
    }
    if let Some(aria_labelledby_prop) = has_jsx_prop_ignore_case(node, "aria-labelledby") {
        return (!aria_label_has_value(aria_labelledby_prop)).then_some(ARIA_LABELLED_BY_VALUE);
    }
    Some(MISSING_ALT_PROP)
}

fn object_rule<'a>(file: &'a File<'a>, node: Jsx<'a>) -> Option<Message> {
    let title = has_jsx_prop_ignore_case(node, "title").and_then(get_string_literal_prop_value);
    let is_fine = has_label(node) || title.is_some_and(|it| !it.is_empty()) || object_has_accessible_child(file, node);
    (!is_fine).then_some(MISSING_ALTERNATIVE_TEXT)
}

/// Also for `input[type="image"]`.
fn area_rule(node: Jsx) -> Option<Message> {
    let is_fine = has_label(node) || has_jsx_prop_ignore_case(node, "alt").is_some_and(is_valid_alt_prop);
    (!is_fine).then_some(MISSING_ALTERNATIVE_TEXT)
}
