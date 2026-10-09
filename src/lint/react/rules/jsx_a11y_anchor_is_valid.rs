use crate::a11y::is_null_literal;
use crate::jsx::{
    AttributeValue, as_jsx_element, get_attribute_names_of_settings, get_element_type, get_prop_value, has_jsx_prop_ignore_case,
    is_identifier_ignore_case, is_undefined,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that anchors have a valid `href` and are not used in place of buttons for attaching click logic.
pub struct AnchorIsValid {
    /// Besides `a`.
    components: Vec<String>,
    /// Besides `href`.
    special_link: Vec<String>,
    no_href: bool,
    invalid_href: bool,
    prefer_button: bool,
}

const MISSING_HREF_ATTRIBUTE: Message = Message::new("", "Missing `href` attribute for the `a` element.");
const INCORRECT_HREF: Message = Message::new("", "Use of incorrect `href` for the 'a' element.");
const CANT_BE_ANCHOR: Message = Message::new("", "The `a` element has `href` and `onClick`.");

#[derive(Copy, Clone, PartialEq, Eq)]
enum HrefValueKind {
    Nullish,
    Invalid,
    Valid,
}

impl Rule for AnchorIsValid {
    const META: Meta = Meta::oxlint(Plugin::JsxA11y, "anchor-is-valid", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let config = options.object(0);
        let strings = |key: &str| config.strings(key).into_iter().map(String::from).collect();
        let aspects = config.get("aspects").and_then(Json::as_array);
        let has_aspect = |name: &[u8]| aspects.is_none_or(|all| all.iter().any(|it| it.as_str() == Some(name)));
        AnchorIsValid {
            components: strings("components"),
            special_link: strings("specialLink"),
            no_href: has_aspect(b"noHref"),
            invalid_href: has_aspect(b"invalidHref"),
            prefer_button: has_aspect(b"preferButton"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Jsx], |rule, e, cx| {
            let Some(jsx_el) = as_jsx_element(e) else {
                return;
            };
            let name = get_element_type(cx.file(), jsx_el);
            if *name != *b"a" && !rule.components.iter().any(|it| *it.as_bytes() == *name) {
                return;
            }
            let Some(span) = jsx_el.tag().map(Expr::span) else {
                return;
            };
            let names_of_settings = get_attribute_names_of_settings(cx.file(), "href");
            let is_href = |attr: Prop| {
                let is_it = |href_name: &[u8]| is_identifier_ignore_case(attr, href_name);
                let is_known = match names_of_settings {
                    Some(names) => names.iter().filter_map(Json::as_str).any(is_it),
                    None => is_it(b"href"),
                };
                is_known || rule.special_link.iter().any(|it| is_it(it.as_bytes()))
            };
            let (mut has_href, mut has_invalid_href, mut has_spread_attr) = (false, false, false);
            for attr in jsx_el.attrs() {
                if attr.kind() == PropKind::Spread {
                    has_spread_attr = true;
                    continue;
                }
                if !is_href(attr) {
                    continue;
                }
                let kind = get_prop_value(attr).map_or(HrefValueKind::Nullish, check_value);
                has_href |= kind != HrefValueKind::Nullish;
                has_invalid_href |= kind == HrefValueKind::Invalid;
            }
            let has_on_click = has_jsx_prop_ignore_case(jsx_el, "onclick").is_some();
            let prefers_button = has_on_click && rule.prefer_button;
            if !has_href {
                if !has_spread_attr && rule.no_href && !prefers_button {
                    cx.report(span, MISSING_HREF_ATTRIBUTE);
                }
                if !has_spread_attr && prefers_button {
                    cx.report(span, CANT_BE_ANCHOR);
                }
            } else if has_invalid_href {
                if prefers_button {
                    cx.report(span, CANT_BE_ANCHOR);
                } else if rule.invalid_href {
                    cx.report(span, INCORRECT_HREF);
                }
            }
        });
    }
}

fn check_value(value: AttributeValue) -> HrefValueKind {
    match value {
        AttributeValue::Element(_) => HrefValueKind::Valid,
        AttributeValue::Fragment(_) => HrefValueKind::Nullish,
        AttributeValue::StringLiteral(literal) => href_value_kind_from_string(literal.value),
        AttributeValue::ExpressionContainer(e) if is_undefined(e) || is_null_literal(e) => HrefValueKind::Nullish,
        AttributeValue::ExpressionContainer(e) if e.is_parenthesized() => HrefValueKind::Valid,
        AttributeValue::ExpressionContainer(e) => match e.kind() {
            ExprKind::String(value) => href_value_kind_from_string(value.bytes()),
            ExprKind::Template(template) => {
                template.as_static().map_or(HrefValueKind::Valid, |quasi| href_value_kind_from_string(quasi.bytes()))
            }
            _ => HrefValueKind::Valid,
        },
    }
}

fn href_value_kind_from_string(href: &[u8]) -> HrefValueKind {
    let is_word = |b: &u8| b.is_ascii_alphanumeric() || *b == b'_';
    let leading_non_word = href.iter().take_while(|b| !is_word(b)).count();
    let is_invalid =
        href.is_empty() || href == b"#" || href.get(leading_non_word..).is_some_and(|it| it.starts_with(b"javascript:"));
    if is_invalid { HrefValueKind::Invalid } else { HrefValueKind::Valid }
}
