use bun_core::strings;
use crate::a11y::{LabelSearch, search_for_accessible_label};
use crate::jsx::{
    AttributeValue, Child, as_jsx_element, children, get_attribute_names_of_settings, get_element_type, get_jsx_attribute_name,
    get_prop_value, has_jsx_prop, is_zero_bigint,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::eslint_utils::js_number::to_int32;
use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint_oxlint::text::glob_match;
use smallvec::SmallVec;

/// Enforce that a label tag has a text label and an associated control.
pub struct LabelHasAssociatedControl {
    depth: u8,
    assert: Assert,
    label_components: Vec<String>,
    label_attributes: Vec<String>,
    /// Globs. Besides `input`, `meter`, `output`, `progress`, `select` and `textarea`.
    control_components: Vec<String>,
}

#[derive(Copy, Clone)]
enum Assert {
    HtmlFor,
    Nesting,
    Both,
    Either,
}

const LABEL_HAS_ASSOCIATED_CONTROL: Message = Message::new("", "A form label must be associated with a control.");
const LABEL_HAS_ASSOCIATED_CONTROL_NO_LABEL: Message = Message::new("", "A form label must have accessible text.");

impl Rule for LabelHasAssociatedControl {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "label-has-associated-control", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        // What is configured is added, unless something in it is not a string.
        let with = |key: &str, fixed: &[&str]| -> Vec<String> {
            let added = Some(config.strings(key)).filter(|it| it.len() == config.array(key).len()).unwrap_or_default();
            fixed.iter().chain(&added).map(|it| (*it).to_owned()).collect()
        };
        LabelHasAssociatedControl {
            depth: config.number("depth").filter(|it| *it >= 0.0 && it.fract() == 0.0).map_or(2, |it| it.min(25.0) as u8),
            assert: match config.str("assert") {
                Some("htmlFor") => Assert::HtmlFor,
                Some("nesting") => Assert::Nesting,
                Some("both") => Assert::Both,
                _ => Assert::Either,
            },
            label_components: with("labelComponents", &["label"]),
            label_attributes: with("labelAttributes", &["alt", "aria-label", "aria-labelledby"]),
            control_components: config.strings("controlComponents").into_iter().map(String::from).collect(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(element) = as_jsx_element(e) else {
                return;
            };
            let element_type = get_element_type(cx.file(), element);
            if !rule.label_components.iter().any(|it| *it.as_bytes() == *element_type) {
                return;
            }
            if !rule.has_accessible_label(cx.file(), element) {
                cx.report(element.opening_span(), LABEL_HAS_ASSOCIATED_CONTROL_NO_LABEL);
                return;
            }
            // The first of the names that the element has decides.
            let has_html_for = || {
                let html_for_attribute = match get_attribute_names_of_settings(cx.file(), "for") {
                    Some(attributes) => (attributes.iter().filter_map(|it| std::str::from_utf8(it.as_str()?).ok()))
                        .find_map(|attr| has_jsx_prop(element, attr)),
                    None => has_jsx_prop(element, "htmlFor"),
                };
                html_for_attribute.is_some_and(|it| has_attribute_value(it, false))
            };
            let has_control = || children(cx.file(), element).any(|child| rule.search_for_nested_control(cx.file(), child, 1));
            let is_associated = match rule.assert {
                Assert::HtmlFor => has_html_for(),
                Assert::Nesting => has_control(),
                Assert::Both => has_html_for() && has_control(),
                Assert::Either => has_html_for() || has_control(),
            };
            if !is_associated {
                cx.report(element.opening_span(), LABEL_HAS_ASSOCIATED_CONTROL);
            }
        });
    }
}

impl LabelHasAssociatedControl {
    fn is_match_control_components(&self, name: &[u8]) -> bool {
        matches!(name, b"input" | b"meter" | b"output" | b"progress" | b"select" | b"textarea")
            || self.control_components.iter().any(|component| glob_match(component.as_bytes(), name))
    }

    fn is_label_attribute(&self, name: &[u8]) -> bool {
        self.label_attributes.iter().any(|it| it.as_bytes() == name)
    }

    fn has_labelling_prop(&self, element: Jsx) -> bool {
        element.attrs().iter().any(|attribute| match get_jsx_attribute_name(attribute) {
            Some(name) => self.is_label_attribute(name) && has_attribute_value(attribute, true),
            // A spread may have one.
            None => true,
        })
    }

    fn has_accessible_label<'a>(&self, file: &'a File<'a>, root: Jsx<'a>) -> bool {
        if self.has_labelling_prop(root) {
            return true;
        }
        let search = LabelSearch {
            depth: self.depth,
            has_labelling_prop: &|element| self.has_labelling_prop(element),
            is_control_component: &|name| self.is_match_control_components(name),
        };
        children(file, root).any(|child| search_for_accessible_label(file, child, 1, &search))
    }

    fn search_for_nested_control<'a>(&self, file: &'a File<'a>, node: Child<'a>, depth: u8) -> bool {
        if depth > self.depth {
            return false;
        }
        let parent = match node {
            Child::ExpressionContainer(_) => return true,
            Child::Text(_) | Child::Spread => return false,
            Child::Element(element) if self.is_match_control_components(&get_element_type(file, element)) => return true,
            Child::Element(parent) | Child::Fragment(parent) => parent,
        };
        children(file, parent).any(|child| self.search_for_nested_control(file, child, depth + 1))
    }
}

/// Whether the value of an attribute may be something: it is not known to be falsy, as `jsx-ast-utils` reads it. An attribute
/// without a value may be. `trim_strings`: whitespace is nothing.
fn has_attribute_value(attribute: Prop, trim_strings: bool) -> bool {
    match get_prop_value(attribute) {
        Some(AttributeValue::StringLiteral(literal)) => Value::from_literal(literal.value).has_value(trim_strings),
        Some(value @ AttributeValue::ExpressionContainer(_)) => {
            value.as_expression().and_then(get_attribute_expression_value).is_none_or(|it| it.has_value(trim_strings))
        }
        _ => true,
    }
}

/// A primitive value, as `jsx-ast-utils` extracts it.
#[derive(Copy, Clone)]
enum Value<'a> {
    String(&'a [u8]),
    Number(f64),
    /// Whether it is not zero.
    BigInt(bool),
}

impl<'a> Value<'a> {
    fn from_literal(text: &'a [u8]) -> Self {
        if text.eq_ignore_ascii_case(b"false") {
            Value::Number(0.0)
        } else if text.eq_ignore_ascii_case(b"true") {
            Value::Number(1.0)
        } else {
            Value::String(text)
        }
    }

    fn has_value(self, trim_strings: bool) -> bool {
        match self {
            Value::String(text) if trim_strings => !strings::is_all_js_whitespace(text),
            Value::String(text) => !text.is_empty(),
            Value::Number(value) => value != 0.0 && !value.is_nan(),
            Value::BigInt(nonzero) => nonzero,
        }
    }

    fn to_number(self) -> Option<f64> {
        match self {
            Value::String(text) => Some(text::string_to_number(text)),
            Value::Number(value) => Some(value),
            Value::BigInt(_) => None,
        }
    }
}

fn get_attribute_expression_value(expression: Expr<'_>) -> Option<Value<'_>> {
    // The `-`, `+`, `!` and `~` before it, from the outside.
    let mut operators = SmallVec::<[UnOp; 4]>::new();
    let mut at = get_inner_expression(expression);
    while let ExprKind::Unary { op: op @ (UnOp::Minus | UnOp::Plus | UnOp::Not | UnOp::BitNot), operand } = at.kind() {
        operators.push(op);
        at = get_inner_expression(operand);
    }
    let mut value = match at.kind() {
        ExprKind::String(literal) => Value::from_literal(literal.bytes()),
        // As it is written, with its escapes.
        ExprKind::Template(template) if template.exprs().is_empty() => Value::String(template.raw(0)),
        ExprKind::Null | ExprKind::False => Value::Number(0.0),
        ExprKind::True => Value::Number(1.0),
        ExprKind::Number(literal) => Value::Number(literal),
        ExprKind::BigInt(_) => Value::BigInt(!is_zero_bigint(at.text())),
        ExprKind::Ident(name) => match name.bytes() {
            b"undefined" => Value::Number(f64::NAN),
            b"Infinity" => Value::Number(f64::INFINITY),
            // What is not known stands for its name.
            name => Value::String(name),
        },
        ExprKind::Unary { op: UnOp::Void | UnOp::Typeof, .. } => Value::Number(f64::NAN),
        ExprKind::Unary { op: UnOp::Delete, .. } => Value::Number(1.0),
        _ => return None,
    };
    for op in operators.iter().rev() {
        value = match (op, value) {
            (UnOp::Minus, Value::BigInt(_)) => value,
            (UnOp::Minus, _) => Value::Number(-value.to_number()?),
            (UnOp::Plus, _) => Value::Number(value.to_number()?),
            (UnOp::Not, _) => Value::Number(f64::from(!value.has_value(false))),
            _ => Value::Number(f64::from(!to_int32(value.to_number()?))),
        };
    }
    Some(value)
}
