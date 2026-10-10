use crate::a11y::HTML_TAG;
use crate::util_ast::name_of_key;
use crate::util_is_create_element::is_member_called;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::text::contains_name;

/// Disallow usage of invalid attributes
pub struct NoInvalidHtmlAttribute {
    /// The schema admits no other attribute.
    checks_rel: bool,
}

const EMPTY_IS_MEANINGLESS: Message =
    Message::new("emptyIsMeaningless", "An empty “{{attributeName}}” attribute is meaningless.");
const NEVER_VALID: Message =
    Message::new("neverValid", "“{{reportingValue}}” is never a valid “{{attributeName}}” attribute value.");
const NO_EMPTY: Message = Message::new("noEmpty", "An empty “{{attributeName}}” attribute is meaningless.");
const NO_METHOD: Message = Message::new("noMethod", "The ”{{attributeName}}“ attribute cannot be a method.");
const NOT_ALONE: Message =
    Message::new("notAlone", "“{{reportingValue}}” must be directly followed by “{{missingValue}}”.");
const NOT_PAIRED: Message = Message::new(
    "notPaired",
    "“{{reportingValue}}” can not be directly followed by “{{secondValue}}” without “{{missingValue}}”.",
);
const NOT_VALID_FOR: Message = Message::new(
    "notValidFor",
    "“{{reportingValue}}” is not a valid “{{attributeName}}” attribute value for <{{elementName}}>.",
);
const ONLY_MEANINGFUL_FOR: Message =
    Message::new("onlyMeaningfulFor", "The ”{{attributeName}}“ attribute only has meaning on the tags: {{tagNames}}");
const ONLY_STRINGS: Message = Message::new("onlyStrings", "“{{attributeName}}” attribute only supports strings.");
const SPACE_DELIMITED: Message =
    Message::new("spaceDelimited", "”{{attributeName}}“ attribute values should be space delimited.");
const SUGGEST_REMOVE_DEFAULT: Message = Message::new("suggestRemoveDefault", "\"remove {{attributeName}}\"");
const SUGGEST_REMOVE_EMPTY: Message =
    Message::new("suggestRemoveEmpty", "\"remove empty attribute {{attributeName}}\"");
const SUGGEST_REMOVE_INVALID: Message =
    Message::new("suggestRemoveInvalid", "“remove invalid attribute {{reportingValue}}”");
const SUGGEST_REMOVE_WHITESPACES: Message =
    Message::new("suggestRemoveWhitespaces", "remove whitespaces in “{{attributeName}}”");
const SUGGEST_REMOVE_NON_STRING: Message =
    Message::new("suggestRemoveNonString", "remove non-string value in “{{attributeName}}”");

const REL: &[u8] = b"rel";
const ATTRIBUTE_NAME: [(&str, &[u8]); 1] = [("attributeName", REL)];
const TAG_NAMES: &str = "\"<link>\", \"<a>\", \"<area>\", \"<form>\"";

const LINK: u8 = 1;
const AREA: u8 = 2;
const A: u8 = 4;
const FORM: u8 = 8;

/// upstream's `rel`: each value with the elements that it is valid on.
const VALID_VALUES: [(&[u8], u8); 30] = [
    (b"alternate", LINK | AREA | A),
    (b"apple-touch-icon", LINK),
    (b"apple-touch-startup-image", LINK),
    (b"author", LINK | AREA | A),
    (b"bookmark", AREA | A),
    (b"canonical", LINK),
    (b"dns-prefetch", LINK),
    (b"external", AREA | A | FORM),
    (b"help", LINK | AREA | A | FORM),
    (b"icon", LINK),
    (b"license", LINK | AREA | A | FORM),
    (b"manifest", LINK),
    (b"mask-icon", LINK),
    (b"modulepreload", LINK),
    (b"next", LINK | AREA | A | FORM),
    (b"nofollow", AREA | A | FORM),
    (b"noopener", AREA | A | FORM),
    (b"noreferrer", AREA | A | FORM),
    (b"opener", AREA | A | FORM),
    (b"pingback", LINK),
    (b"preconnect", LINK),
    (b"prefetch", LINK),
    (b"preload", LINK),
    (b"prerender", LINK),
    (b"prev", LINK | AREA | A | FORM),
    (b"search", LINK | AREA | A | FORM),
    (b"shortcut", LINK),
    (b"shortcut icon", LINK),
    (b"stylesheet", LINK),
    (b"tag", AREA | A),
];

/// `VALID_VALUES.get("rel").get(value)`
fn allowed_tags(value: &[u8]) -> Option<u8> {
    VALID_VALUES.iter().find(|it| it.0 == value).map(|it| it.1)
}

/// upstream's `HTML_ELEMENTS`: it has `portal`, and lacks eight of the list that jsx-a11y goes by.
fn is_html_element(name: &[u8]) -> bool {
    const ONLY_THERE: [&[u8]; 8] =
        [b"command", b"element", b"isindex", b"listing", b"multicol", b"nextid", b"rbc", b"search"];
    name == b"portal" || (contains_name(&HTML_TAG, name) && !ONLY_THERE.contains(&name))
}

/// An element of upstream's `COMPONENT_ATTRIBUTE_MAP.get("rel")`.
#[derive(Copy, Clone)]
struct Element<'a> {
    name: &'a [u8],
    /// What it is in `VALID_VALUES`.
    bit: u8,
}

impl<'a> Element<'a> {
    fn new(name: &'a [u8]) -> Option<Element<'a>> {
        let bit = match name {
            b"link" => LINK,
            b"a" => A,
            b"area" => AREA,
            b"form" => FORM,
            _ => return None,
        };
        Some(Element { name, bit })
    }
}

/// A match of `/\s+/g` or of `/\S+/g` in the value of a string.
#[derive(Copy, Clone)]
struct Part<'a> {
    value: &'a [u8],
    /// Where in the value of the string it starts.
    start: usize,
    is_space: bool,
}

/// upstream's `splitIntoRangedParts`, for both expressions at once.
fn split_into_parts(value: &[u8]) -> impl Iterator<Item = Part<'_>> {
    let mut at = 0;
    std::iter::from_fn(move || {
        let start = at;
        let is_space = strings::js_whitespace_len(value.get(start..).filter(|it| !it.is_empty())?) > 0;
        while let Some(rest) = value.get(at..).filter(|it| !it.is_empty()) {
            let len = strings::js_whitespace_len(rest);
            if (len > 0) != is_space {
                break;
            }
            at += len.max(1);
        }
        Some(Part { value: value.get(start..at)?, start, is_space })
    })
}

/// Where upstream takes a part of the value of a string to be in the file: as far behind the opening quote as it is
/// in the VALUE, in UTF-16. Behind a `\n` or an `&amp;` that is too far to the left.
struct Ranges<'a> {
    value: &'a [u8],
    /// The file from behind the opening quote.
    written: &'a [u8],
    written_start: u32,
    /// What was asked for last, and where that is in `written`.
    value_at: usize,
    written_at: usize,
}

impl<'a> Ranges<'a> {
    fn new(node: Expr<'a>, value: &'a [u8]) -> Ranges<'a> {
        let written = node.text().get(1..).unwrap_or_default();
        Ranges { value, written, written_start: node.span().start + 1, value_at: 0, written_at: 0 }
    }

    /// `at`: in the value, and not before what was asked for last.
    fn offset(&mut self, at: usize) -> u32 {
        let units = strings::wtf8_len_utf16(self.value.get(self.value_at..at).unwrap_or_default());
        let rest = self.written.get(self.written_at..).unwrap_or_default();
        self.written_at += strings::wtf8_offset_of_utf16_index(rest, units);
        self.value_at = at;
        self.written_start + self.written_at as u32
    }

    fn of(&mut self, part: Part<'_>) -> Span {
        let start = self.offset(part.start);
        Span::new(start, self.offset(part.start + part.value.len()))
    }
}

impl Rule for NoInvalidHtmlAttribute {
    const META: Meta = Meta::plugin(Plugin::React, "no-invalid-html-attribute", Kind::Suggestion).has_suggestions();
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Call]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let attributes = options.get(0).and_then(Json::as_array);
        NoInvalidHtmlAttribute { checks_rel: attributes.is_none_or(|all| !all.is_empty()) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Jsx]);
        // `React.#createElement()` is a call of it too.
        let mentions_create_element = file.mentions("createElement") || file.mentions("#createElement");
        if file.mentions("React") && mentions_create_element { on.exprs(&[ExprTag::Call]) } else { on }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (self.checks_rel && file.mentions("rel")).then_some(())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.kind() {
            ExprKind::Jsx(jsx) => {
                for node in jsx.attrs().iter().filter(|it| it.key().is_some_and(|key| key.is("rel"))) {
                    if let Some(name) = jsx.tag().and_then(Expr::as_ident)
                        && is_html_element(name.bytes())
                    {
                        check_attribute(node, name.bytes(), cx);
                    }
                }
            }
            ExprKind::Call(call) => check_call(call, cx),
            _ => {}
        }
    }
}

/// upstream's `checkAttribute`
fn check_attribute<'a>(node: Prop<'a>, parent_node_name: &'a [u8], cx: &Cx<'a, NoInvalidHtmlAttribute>) {
    let Some(name) = node.key().map(|it| it.span(cx.file())) else {
        return;
    };
    let Some(element) = Element::new(parent_node_name) else {
        cx.report(name, ONLY_MEANINGFUL_FOR)
            .data("attributeName", REL)
            .data("tagNames", TAG_NAMES)
            .suggest_with(SUGGEST_REMOVE_DEFAULT, &ATTRIBUTE_NAME, |fixer| fixer.remove(node));
        return;
    };
    let Some(value) = node.value() else {
        cx.report(name, EMPTY_IS_MEANINGLESS)
            .data("attributeName", REL)
            .suggest_with(SUGGEST_REMOVE_EMPTY, &ATTRIBUTE_NAME, |fixer| fixer.remove(node));
        return;
    };
    if ast_utils::is_literal(value) {
        check_literal_value_node(value, node, element, cx);
        return;
    }
    // With an element as the value upstream throws.
    if let Some(container) = value.jsx_container_span()
        && (value.tag() == ExprTag::Object || value.is_ident("undefined"))
    {
        cx.report(container, ONLY_STRINGS)
            .data("attributeName", REL)
            .suggest_with(SUGGEST_REMOVE_DEFAULT, &ATTRIBUTE_NAME, |fixer| fixer.remove(node));
    }
}

/// upstream's `checkLiteralValueNode`. `parent_node`: the attribute.
fn check_literal_value_node<'a>(
    node: Expr<'a>,
    parent_node: Prop<'a>,
    element: Element<'a>,
    cx: &Cx<'a, NoInvalidHtmlAttribute>,
) {
    let Some(value) = node.as_string().map(Name::bytes) else {
        cx.report(node, ONLY_STRINGS)
            .data("attributeName", REL)
            .suggest_with(SUGGEST_REMOVE_NON_STRING, &ATTRIBUTE_NAME, |fixer| fixer.remove(parent_node));
        return;
    };
    if strings::is_all_js_whitespace(value) {
        // `node.parent`: of `{""}` the braces.
        cx.report(node, NO_EMPTY).data("attributeName", REL).suggest_with(
            SUGGEST_REMOVE_EMPTY,
            &ATTRIBUTE_NAME,
            |fixer| fixer.remove(node.jsx_container_span().unwrap_or_else(|| parent_node.span())),
        );
        return;
    }

    let mut ranges = Ranges::new(node, value);
    for single_part in split_into_parts(value).filter(|it| !it.is_space) {
        let reporting_value = single_part.value;
        let report = match allowed_tags(reporting_value) {
            None => cx.report(node, NEVER_VALID),
            Some(allowed_tags) if allowed_tags & element.bit == 0 => {
                cx.report(node, NOT_VALID_FOR).data("elementName", element.name)
            }
            Some(_) => continue,
        };
        report.data("attributeName", REL).data("reportingValue", reporting_value).suggest_with(
            SUGGEST_REMOVE_INVALID,
            &[("attributeName", REL), ("reportingValue", reporting_value)],
            |fixer| fixer.remove(ranges.of(single_part)),
        );
    }

    // Only at the end of a part is what `/(?=(\b\S+\s*\S+))/g` captures `shortcut`, or starts with that and a blank.
    for part in split_into_parts(value).filter(|it| !it.is_space) {
        let Some(before) = part.value.strip_suffix(b"shortcut") else {
            continue;
        };
        if before.last().is_some_and(|it| it.is_ascii_alphanumeric() || *it == b'_') {
            continue;
        }
        // The white space and the part behind it. White space at the end is not captured.
        let rest = value.get(part.start + part.value.len()..).unwrap_or_default();
        let next = split_into_parts(rest).nth(1).map_or(0, |it| it.start + it.value.len());
        let mut attributes = strings::split(rest.get(..next).unwrap_or_default(), b" ");
        if attributes.next().is_some_and(|it| !it.is_empty()) {
            continue;
        }
        let second_value = attributes.next();
        if attributes.last().or(second_value).is_some_and(|it| it == b"icon") {
            continue;
        }
        let second_value = second_value.filter(|it| !it.is_empty());
        let report = cx
            .report(node, if second_value.is_some() { NOT_PAIRED } else { NOT_ALONE })
            .data("reportingValue", "shortcut")
            .data("missingValue", "icon");
        if let Some(second_value) = second_value {
            report.data("secondValue", second_value);
        }
    }

    let mut ranges = Ranges::new(node, value);
    for whitespace_part in split_into_parts(value).filter(|it| it.is_space) {
        // A value with a `\n` or an `&amp;` is shorter than what is written: nothing in it is at the closing quote.
        let end = whitespace_part.start + whitespace_part.value.len();
        let is_at_a_quote = whitespace_part.start == 0 || end + 2 == node.span().len() as usize;
        if !is_at_a_quote && whitespace_part.value == b" " {
            continue;
        }
        cx.report(node, SPACE_DELIMITED).data("attributeName", REL).suggest_with(
            SUGGEST_REMOVE_WHITESPACES,
            &ATTRIBUTE_NAME,
            |fixer| fixer.replace(ranges.of(whitespace_part), if is_at_a_quote { "" } else { " " }),
        );
    }
}

/// upstream's `isValidCreateElement`, its listener for calls and `checkCreateProps`
fn check_call<'a>(node: Call<'a>, cx: &Cx<'a, NoInvalidHtmlAttribute>) {
    let callee = node.callee();
    if !is_member_called(callee, "createElement") || !callee.object().is_some_and(|it| it.is_ident("React")) {
        return;
    }
    let Some(elem_name_arg) = node.args().first().filter(|it| ast_utils::is_literal(*it)) else {
        return;
    };
    // A literal that is no string is looked at as an element that is none of the four.
    let element_name = elem_name_arg.as_string().map(Name::bytes);
    if element_name.is_some_and(|it| !is_html_element(it)) {
        return;
    }
    let Some(ExprKind::Object(properties)) = node.args().get(1).map(Expr::kind) else {
        return;
    };
    for prop in properties.iter() {
        let Some(key) = prop.key().filter(|it| name_of_key(*it).is_some_and(|name| name == REL)) else {
            continue;
        };
        let Some(element) = element_name.and_then(Element::new) else {
            cx.report(key.inner_span(cx.file()), ONLY_MEANINGFUL_FOR)
                .data("attributeName", REL)
                .data("tagNames", TAG_NAMES);
            continue;
        };
        match (prop.kind(), prop.value().map(|it| (it, it.kind()))) {
            (PropKind::Method, _) => drop(cx.report(prop, NO_METHOD).data("attributeName", REL)),
            _ if key.is_computed() => {}
            // At a hole upstream throws.
            (PropKind::Init, Some((_, ExprKind::Array(elements)))) => {
                for value in elements.iter() {
                    check_prop_valid_value(value, element, cx);
                }
            }
            (PropKind::Init, Some((value, _))) => check_prop_valid_value(value, element, cx),
            _ => {}
        }
    }
}

/// upstream's `checkPropValidValue`
fn check_prop_valid_value<'a>(value: Expr<'a>, element: Element<'a>, cx: &Cx<'a, NoInvalidHtmlAttribute>) {
    if !ast_utils::is_literal(value) {
        return;
    }
    match value.as_string().and_then(|it| allowed_tags(it.bytes())) {
        None => report_never_valid(value, cx),
        Some(valid_tag_set) if valid_tag_set & element.bit == 0 => drop(
            cx.report(value, NOT_VALID_FOR)
                .data("attributeName", REL)
                .data("reportingValue", value.text())
                .data("elementName", element.name),
        ),
        Some(_) => {}
    }
}

#[cold]
#[inline(never)]
fn report_never_valid<'a>(value: Expr<'a>, cx: &Cx<'a, NoInvalidHtmlAttribute>) {
    // `String(value.value)`
    let Some(value_value) = ast_utils::get_static_string_value(value) else {
        return;
    };
    let reporting_value: &[u8] = &value_value;
    cx.report(value, NEVER_VALID)
        .data("attributeName", REL)
        .data("reportingValue", value_value.clone())
        .suggest_with(
            SUGGEST_REMOVE_INVALID,
            &[("attributeName", REL), ("reportingValue", reporting_value)],
            // `value.raw.replace(value.value, "")`
            |fixer| {
                let raw = value.text();
                let replaced = match (value.kind(), strings::index_of(raw, reporting_value)) {
                    (ExprKind::Regex(it), _) => {
                        Regex::from_bytes(it.pattern(), it.flags()).ok()?.replace(raw, b"").into_owned()
                    }
                    (_, Some(at)) => [raw.get(..at)?, raw.get(at + reporting_value.len()..)?].concat(),
                    (_, None) => raw.to_vec(),
                };
                Some(fixer.replace(value, replaced))
            },
        );
}
