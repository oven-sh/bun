//! The half of oxlint's `utils/react.rs` that is about accessibility, and the tables of its `globals.rs` for HTML and ARIA, on the
//! handles. Each function has the name that it has there. See [`jsx`](crate::jsx) for what stands for the nodes of oxc.
//!
//! A table is sorted by bytes: [`contains`] searches it.

use crate::jsx::{
    AttributeValue, Child, children, get_element_type, get_prop_value,
    get_string_literal_prop_value, has_jsx_prop, has_jsx_prop_ignore_case, is_undefined,
    to_boolean,
};
use bun_lint::prelude::*;
use bun_lint_oxlint::text::contains_name;
use std::borrow::Cow;

/// `cow_to_ascii_lowercase`
pub(crate) fn cow_to_ascii_lowercase(text: &[u8]) -> Cow<'_, [u8]> {
    match text.iter().any(u8::is_ascii_uppercase) {
        true => Cow::Owned(text.to_ascii_lowercase()),
        false => Cow::Borrowed(text),
    }
}

/// The elements that cannot have ARIA roles, states and properties.
pub(crate) static RESERVED_HTML_TAG: [&str; 16] = [
    "base", "col", "colgroup", "head", "html", "link", "meta", "noembed", "noscript", "param",
    "picture", "script", "source", "style", "title", "track",
];

pub(crate) static HTML_TAG: [&str; 149] = [
    "a",
    "abbr",
    "acronym",
    "address",
    "applet",
    "area",
    "article",
    "aside",
    "audio",
    "b",
    "base",
    "basefont",
    "bdi",
    "bdo",
    "bgsound",
    "big",
    "blink",
    "blockquote",
    "body",
    "br",
    "button",
    "canvas",
    "caption",
    "center",
    "cite",
    "code",
    "col",
    "colgroup",
    "command",
    "content",
    "data",
    "datalist",
    "dd",
    "del",
    "details",
    "dfn",
    "dialog",
    "dir",
    "div",
    "dl",
    "dt",
    "element",
    "em",
    "embed",
    "fieldset",
    "figcaption",
    "figure",
    "font",
    "footer",
    "form",
    "frame",
    "frameset",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "header",
    "hgroup",
    "hr",
    "html",
    "i",
    "iframe",
    "image",
    "img",
    "input",
    "ins",
    "isindex",
    "kbd",
    "keygen",
    "label",
    "legend",
    "li",
    "link",
    "listing",
    "main",
    "map",
    "mark",
    "marquee",
    "math",
    "menu",
    "menuitem",
    "meta",
    "meter",
    "multicol",
    "nav",
    "nextid",
    "nobr",
    "noembed",
    "noframes",
    "noscript",
    "object",
    "ol",
    "optgroup",
    "option",
    "output",
    "p",
    "param",
    "picture",
    "plaintext",
    "pre",
    "progress",
    "q",
    "rb",
    "rbc",
    "rp",
    "rt",
    "rtc",
    "ruby",
    "s",
    "samp",
    "script",
    "search",
    "section",
    "select",
    "shadow",
    "slot",
    "small",
    "source",
    "spacer",
    "span",
    "strike",
    "strong",
    "style",
    "sub",
    "summary",
    "sup",
    "svg",
    "table",
    "tbody",
    "td",
    "template",
    "textarea",
    "tfoot",
    "th",
    "thead",
    "time",
    "title",
    "tr",
    "track",
    "tt",
    "u",
    "ul",
    "var",
    "video",
    "wbr",
    "xmp",
];

/// What is after the `aria-` of each ARIA state and property.
const ARIA_PROPERTIES: [&str; 51] = [
    "activedescendant",
    "atomic",
    "autocomplete",
    "braillelabel",
    "brailleroledescription",
    "busy",
    "checked",
    "colcount",
    "colindex",
    "colspan",
    "controls",
    "current",
    "describedby",
    "description",
    "details",
    "disabled",
    "dropeffect",
    "errormessage",
    "expanded",
    "flowto",
    "grabbed",
    "haspopup",
    "hidden",
    "invalid",
    "keyshortcuts",
    "label",
    "labelledby",
    "level",
    "live",
    "modal",
    "multiline",
    "multiselectable",
    "orientation",
    "owns",
    "placeholder",
    "posinset",
    "pressed",
    "readonly",
    "relevant",
    "required",
    "roledescription",
    "rowcount",
    "rowindex",
    "rowspan",
    "selected",
    "setsize",
    "sort",
    "valuemax",
    "valuemin",
    "valuenow",
    "valuetext",
];

/// `AriaProperty::try_from`: the index in [`ARIA_PROPERTIES`] of the state or property `name`, which starts with `aria-` in lower case.
fn aria_property(name: &[u8]) -> Option<usize> {
    let name = name.strip_prefix(b"aria-")?;
    ARIA_PROPERTIES
        .binary_search_by(|it| it.as_bytes().cmp(name))
        .ok()
}

pub(crate) fn is_valid_aria_property(name: &[u8]) -> bool {
    aria_property(name).is_some()
}

/// The set of the states and properties `names`, which a blank separates: the bit `1 << i` is for `ARIA_PROPERTIES[i]`.
const fn props(names: &str) -> u64 {
    let names = names.as_bytes();
    let (mut set, mut start) = (0, 0);
    while start < names.len() {
        let mut end = start;
        while end < names.len() && names[end] != b' ' {
            end += 1;
        }
        // It does not compile with a name that there is not.
        let mut index = 0;
        while !is_at(names, start, end, ARIA_PROPERTIES[index].as_bytes()) {
            index += 1;
        }
        set |= 1 << index;
        start = end + 1;
    }
    set
}

const fn is_at(text: &[u8], start: usize, end: usize, name: &[u8]) -> bool {
    let mut i = 0;
    while i < name.len() && start + i < end && text[start + i] == name[i] {
        i += 1;
    }
    i == name.len() && start + i == end
}

const GLOBAL: u64 = props(
    "atomic busy controls current describedby details dropeffect flowto grabbed hidden keyshortcuts live owns relevant roledescription",
);
const NAMED: u64 = GLOBAL | props("label labelledby");
const GLOBAL_IN_ARIA_1_1: u64 = NAMED | props("disabled errormessage expanded haspopup invalid");
/// `INTERACTIVE_ROLES`, `NON_INTERACTIVE_ROLES`: bits that no property has.
const INTERACTIVE: u64 = 1 << 62;
const NON_INTERACTIVE: u64 = 1 << 63;

/// `VALID_ARIA_ROLES`: each role that is not abstract, with the states and properties that it supports, and whether it is
/// interactive.
static ARIA_ROLES: [(&str, u64); 125] = [
    ("alert", NON_INTERACTIVE | NAMED),
    ("alertdialog", NON_INTERACTIVE | NAMED | props("modal")),
    (
        "application",
        NON_INTERACTIVE | GLOBAL_IN_ARIA_1_1 | props("activedescendant"),
    ),
    (
        "article",
        NON_INTERACTIVE | NAMED | props("posinset setsize"),
    ),
    ("banner", NON_INTERACTIVE | NAMED),
    ("blockquote", NON_INTERACTIVE | NAMED),
    (
        "button",
        INTERACTIVE | NAMED | props("disabled expanded haspopup pressed"),
    ),
    ("caption", NON_INTERACTIVE | GLOBAL),
    (
        "cell",
        NON_INTERACTIVE | NAMED | props("colindex colspan rowindex rowspan"),
    ),
    (
        "checkbox",
        INTERACTIVE
            | NAMED
            | props("checked disabled errormessage expanded invalid readonly required"),
    ),
    ("code", GLOBAL),
    (
        "columnheader",
        INTERACTIVE
            | GLOBAL_IN_ARIA_1_1
            | props("colindex colspan readonly required rowindex rowspan selected sort"),
    ),
    (
        "combobox",
        INTERACTIVE | GLOBAL_IN_ARIA_1_1 | props("activedescendant autocomplete readonly required"),
    ),
    ("complementary", NON_INTERACTIVE | NAMED),
    ("contentinfo", NON_INTERACTIVE | NAMED),
    ("definition", NON_INTERACTIVE | NAMED),
    ("deletion", NON_INTERACTIVE | GLOBAL),
    ("dialog", NON_INTERACTIVE | NAMED | props("modal")),
    ("directory", NON_INTERACTIVE | NAMED),
    ("doc-abstract", GLOBAL_IN_ARIA_1_1),
    ("doc-acknowledgments", GLOBAL_IN_ARIA_1_1),
    ("doc-afterword", GLOBAL_IN_ARIA_1_1),
    ("doc-appendix", GLOBAL_IN_ARIA_1_1),
    ("doc-backlink", GLOBAL_IN_ARIA_1_1),
    (
        "doc-biblioentry",
        GLOBAL_IN_ARIA_1_1 | props("level posinset setsize"),
    ),
    ("doc-bibliography", GLOBAL_IN_ARIA_1_1),
    ("doc-biblioref", GLOBAL_IN_ARIA_1_1),
    ("doc-chapter", GLOBAL_IN_ARIA_1_1),
    ("doc-colophon", GLOBAL_IN_ARIA_1_1),
    ("doc-conclusion", GLOBAL_IN_ARIA_1_1),
    ("doc-cover", GLOBAL_IN_ARIA_1_1),
    ("doc-credit", GLOBAL_IN_ARIA_1_1),
    ("doc-credits", GLOBAL_IN_ARIA_1_1),
    ("doc-dedication", GLOBAL_IN_ARIA_1_1),
    (
        "doc-endnote",
        GLOBAL_IN_ARIA_1_1 | props("level posinset setsize"),
    ),
    ("doc-endnotes", GLOBAL_IN_ARIA_1_1),
    ("doc-epigraph", GLOBAL_IN_ARIA_1_1),
    ("doc-epilogue", GLOBAL_IN_ARIA_1_1),
    ("doc-errata", GLOBAL_IN_ARIA_1_1),
    ("doc-example", GLOBAL_IN_ARIA_1_1),
    ("doc-footnote", GLOBAL_IN_ARIA_1_1),
    ("doc-foreword", GLOBAL_IN_ARIA_1_1),
    ("doc-glossary", GLOBAL_IN_ARIA_1_1),
    ("doc-glossref", GLOBAL_IN_ARIA_1_1),
    ("doc-index", GLOBAL_IN_ARIA_1_1),
    ("doc-introduction", GLOBAL_IN_ARIA_1_1),
    ("doc-noteref", GLOBAL_IN_ARIA_1_1),
    ("doc-notice", GLOBAL_IN_ARIA_1_1),
    ("doc-pagebreak", GLOBAL_IN_ARIA_1_1 | props("orientation")),
    ("doc-pagelist", GLOBAL_IN_ARIA_1_1),
    ("doc-part", GLOBAL_IN_ARIA_1_1),
    ("doc-preface", GLOBAL_IN_ARIA_1_1),
    ("doc-prologue", GLOBAL_IN_ARIA_1_1),
    ("doc-pullquote", 0),
    ("doc-qna", GLOBAL_IN_ARIA_1_1),
    ("doc-subtitle", GLOBAL_IN_ARIA_1_1),
    ("doc-tip", GLOBAL_IN_ARIA_1_1),
    ("doc-toc", GLOBAL_IN_ARIA_1_1),
    ("document", NON_INTERACTIVE | NAMED),
    ("emphasis", GLOBAL),
    ("feed", NON_INTERACTIVE | NAMED),
    ("figure", NON_INTERACTIVE | NAMED),
    ("form", NON_INTERACTIVE | NAMED),
    ("generic", GLOBAL),
    ("graphics-document", GLOBAL_IN_ARIA_1_1),
    (
        "graphics-object",
        GLOBAL_IN_ARIA_1_1 | props("activedescendant"),
    ),
    ("graphics-symbol", GLOBAL_IN_ARIA_1_1),
    (
        "grid",
        INTERACTIVE
            | NAMED
            | props("activedescendant colcount disabled multiselectable readonly rowcount"),
    ),
    (
        "gridcell",
        INTERACTIVE
            | GLOBAL_IN_ARIA_1_1
            | props("colindex colspan required rowindex rowspan selected"),
    ),
    (
        "group",
        NON_INTERACTIVE | NAMED | props("activedescendant disabled"),
    ),
    ("heading", NON_INTERACTIVE | NAMED | props("level")),
    ("img", NON_INTERACTIVE | NAMED),
    ("insertion", NON_INTERACTIVE | GLOBAL),
    (
        "link",
        INTERACTIVE | NAMED | props("disabled expanded haspopup"),
    ),
    ("list", NON_INTERACTIVE | NAMED),
    (
        "listbox",
        INTERACTIVE
            | NAMED
            | props("activedescendant disabled errormessage expanded invalid")
            | props("multiselectable orientation readonly required"),
    ),
    (
        "listitem",
        NON_INTERACTIVE | NAMED | props("level posinset setsize"),
    ),
    ("log", NON_INTERACTIVE | NAMED),
    ("main", NON_INTERACTIVE | NAMED),
    (
        "mark",
        NAMED | props("braillelabel brailleroledescription description"),
    ),
    ("marquee", NON_INTERACTIVE | NAMED),
    ("math", NON_INTERACTIVE | NAMED),
    (
        "menu",
        INTERACTIVE | NAMED | props("activedescendant disabled orientation"),
    ),
    (
        "menubar",
        INTERACTIVE | NAMED | props("activedescendant disabled orientation"),
    ),
    (
        "menuitem",
        INTERACTIVE | NAMED | props("disabled expanded haspopup posinset setsize"),
    ),
    (
        "menuitemcheckbox",
        INTERACTIVE | GLOBAL_IN_ARIA_1_1 | props("checked posinset readonly required setsize"),
    ),
    (
        "menuitemradio",
        INTERACTIVE | GLOBAL_IN_ARIA_1_1 | props("checked posinset readonly required setsize"),
    ),
    (
        "meter",
        NAMED | props("valuemax valuemin valuenow valuetext"),
    ),
    ("navigation", NON_INTERACTIVE | NAMED),
    ("none", 0),
    ("note", NON_INTERACTIVE | NAMED),
    (
        "option",
        INTERACTIVE | NAMED | props("checked disabled posinset selected setsize"),
    ),
    ("paragraph", NON_INTERACTIVE | GLOBAL),
    ("presentation", GLOBAL),
    (
        "progressbar",
        NON_INTERACTIVE | NAMED | props("valuemax valuemin valuenow valuetext"),
    ),
    (
        "radio",
        INTERACTIVE | NAMED | props("checked disabled posinset setsize"),
    ),
    (
        "radiogroup",
        INTERACTIVE
            | NAMED
            | props("activedescendant disabled errormessage invalid orientation readonly required"),
    ),
    ("region", NON_INTERACTIVE | NAMED),
    (
        "row",
        INTERACTIVE
            | NON_INTERACTIVE
            | NAMED
            | props("activedescendant colindex disabled expanded level")
            | props("posinset rowindex selected setsize"),
    ),
    ("rowgroup", NON_INTERACTIVE | NAMED),
    (
        "rowheader",
        INTERACTIVE
            | GLOBAL_IN_ARIA_1_1
            | props("colindex colspan readonly required rowindex rowspan selected sort"),
    ),
    (
        "scrollbar",
        INTERACTIVE | NAMED | props("disabled orientation valuemax valuemin valuenow valuetext"),
    ),
    ("search", NON_INTERACTIVE | NAMED),
    (
        "searchbox",
        INTERACTIVE
            | NAMED
            | props("activedescendant autocomplete disabled errormessage haspopup")
            | props("invalid multiline placeholder readonly required"),
    ),
    (
        "separator",
        INTERACTIVE | NAMED | props("disabled orientation valuemax valuemin valuenow valuetext"),
    ),
    (
        "slider",
        INTERACTIVE
            | NAMED
            | props("disabled errormessage haspopup invalid orientation")
            | props("readonly valuemax valuemin valuenow valuetext"),
    ),
    (
        "spinbutton",
        INTERACTIVE
            | NAMED
            | props("activedescendant disabled errormessage invalid readonly")
            | props("required valuemax valuemin valuenow valuetext"),
    ),
    ("status", NON_INTERACTIVE | NAMED),
    ("strong", GLOBAL),
    ("subscript", GLOBAL),
    ("superscript", GLOBAL),
    (
        "switch",
        INTERACTIVE
            | NAMED
            | props("checked disabled errormessage expanded invalid readonly required"),
    ),
    (
        "tab",
        INTERACTIVE | NAMED | props("disabled expanded haspopup posinset selected setsize"),
    ),
    (
        "table",
        NON_INTERACTIVE | NAMED | props("colcount rowcount"),
    ),
    (
        "tablist",
        INTERACTIVE | NAMED | props("activedescendant disabled level multiselectable orientation"),
    ),
    ("tabpanel", NON_INTERACTIVE | NAMED),
    ("term", NON_INTERACTIVE | NAMED),
    (
        "textbox",
        INTERACTIVE
            | NAMED
            | props("activedescendant autocomplete disabled errormessage haspopup")
            | props("invalid multiline placeholder readonly required"),
    ),
    ("time", NON_INTERACTIVE | NAMED),
    ("timer", NON_INTERACTIVE | NAMED),
    (
        "toolbar",
        INTERACTIVE | NAMED | props("activedescendant disabled orientation"),
    ),
    ("tooltip", NON_INTERACTIVE | NAMED),
    (
        "tree",
        INTERACTIVE
            | NAMED
            | props("activedescendant disabled errormessage invalid")
            | props("multiselectable orientation required"),
    ),
    (
        "treegrid",
        INTERACTIVE
            | NAMED
            | props("activedescendant colcount disabled invalid multiselectable")
            | props("orientation readonly required rowcount"),
    ),
    (
        "treeitem",
        INTERACTIVE
            | NAMED
            | props("checked disabled expanded haspopup level posinset selected setsize"),
    ),
];

/// What [`ARIA_ROLES`] has for `role`.
fn aria_role(role: &[u8]) -> Option<u64> {
    let index = ARIA_ROLES
        .binary_search_by(|it| it.0.as_bytes().cmp(role))
        .ok()?;
    ARIA_ROLES.get(index).map(|it| it.1)
}

/// `VALID_ARIA_ROLES.contains(role)`
pub(crate) fn is_valid_aria_role(role: &[u8]) -> bool {
    aria_role(role).is_some()
}

/// Whether the role `role_value` supports the state or property `name`, which starts with `aria-` in lower case. `false` if there
/// is no such role or no such property.
pub(crate) fn is_valid_aria_property_for_role(role_value: &[u8], name: &[u8]) -> bool {
    matches!((aria_role(role_value), aria_property(name)), (Some(set), Some(index)) if set >> index & 1 != 0)
}

/// `<input type="hidden">`, `aria-hidden`, `aria-hidden="true"`, `aria-hidden={true}` or another literal that is truthy.
pub(crate) fn is_hidden_from_screen_reader<'a>(file: &'a File<'a>, node: Jsx<'a>) -> bool {
    if get_element_type(file, node).eq_ignore_ascii_case(b"input")
        && let Some(item) = has_jsx_prop_ignore_case(node, "type")
        && get_string_literal_prop_value(item).is_some_and(|it| it.eq_ignore_ascii_case(b"hidden"))
    {
        return true;
    }
    has_jsx_prop_ignore_case(node, "aria-hidden").is_some_and(|it| match get_prop_value(it) {
        None => true,
        Some(AttributeValue::StringLiteral(literal)) => literal.value == b"true",
        Some(value) => value.as_expression().and_then(to_boolean).unwrap_or(false),
    })
}

/// Whether a child can be read by a screen reader: text, also blank, an element that is not
/// [hidden](is_hidden_from_screen_reader), `{e}` other than `{null}` and `{undefined}`; or there is a `dangerouslySetInnerHTML` or a
/// `children` attribute.
pub(crate) fn object_has_accessible_child<'a>(file: &'a File<'a>, node: Jsx<'a>) -> bool {
    children(file, node).any(|child| match child {
        Child::Text(_) => true,
        Child::Element(element) => !is_hidden_from_screen_reader(file, element),
        Child::ExpressionContainer(e) => !is_null_literal(e) && !is_undefined(e),
        Child::Fragment(_) | Child::Spread => false,
    }) || has_jsx_prop_ignore_case(node, "dangerouslySetInnerHTML").is_some()
        || has_jsx_prop_ignore_case(node, "children").is_some()
}

/// `JSXExpression::NullLiteral`, `Expression::NullLiteral`: not in parentheses.
pub(crate) fn is_null_literal(e: Expr) -> bool {
    e.tag() == ExprTag::Null && !e.is_parenthesized()
}

/// `element_type`: from [`get_element_type`].
pub(crate) fn is_interactive_element(element_type: &[u8], jsx_opening_el: Jsx) -> bool {
    match element_type {
        b"audio" | b"button" | b"canvas" | b"datalist" | b"embed" | b"menuitem" | b"option"
        | b"select" | b"summary" | b"td" | b"th" | b"tr" | b"textarea" | b"video" => true,
        b"input" => !has_jsx_prop(jsx_opening_el, "type")
            .and_then(get_string_literal_prop_value)
            .is_some_and(|it| it.eq_ignore_ascii_case(b"hidden")),
        b"a" | b"area" => has_jsx_prop(jsx_opening_el, "href").is_some(),
        b"img" => has_jsx_prop(jsx_opening_el, "usemap").is_some(),
        _ => false,
    }
}

/// `role="presentation"`, `role="none"`
pub(crate) fn is_presentation_role(jsx_opening_el: Jsx) -> bool {
    matches!(
        has_jsx_prop(jsx_opening_el, "role").and_then(get_string_literal_prop_value),
        Some(b"presentation" | b"none")
    )
}

/// `{null}`, `{undefined}`
pub(crate) fn is_nullish_value(value: AttributeValue) -> bool {
    matches!(value, AttributeValue::ExpressionContainer(e) if is_null_literal(e) || is_undefined(e))
}

pub(crate) fn is_interactive_role(role: &[u8]) -> bool {
    aria_role(role).is_some_and(|it| it & INTERACTIVE != 0)
}

/// `row` is also [interactive](is_interactive_role).
pub(crate) fn is_non_interactive_role(role: &[u8]) -> bool {
    aria_role(role).is_some_and(|it| it & NON_INTERACTIVE != 0)
}

pub(crate) fn is_abstract_role_name(role: &[u8]) -> bool {
    matches!(
        role,
        b"command"
            | b"composite"
            | b"input"
            | b"landmark"
            | b"range"
            | b"roletype"
            | b"section"
            | b"sectionhead"
            | b"select"
            | b"structure"
            | b"widget"
            | b"window"
    )
}

/// An element of HTML whose `role="…"` is an abstract role.
pub(crate) fn is_abstract_role<'a>(file: &'a File<'a>, jsx_opening_el: Jsx<'a>) -> bool {
    contains_name(&HTML_TAG, &get_element_type(file, jsx_opening_el))
        && has_jsx_prop(jsx_opening_el, "role")
            .and_then(get_string_literal_prop_value)
            .is_some_and(is_abstract_role_name)
}

/// `disabled`, with whatever value, `aria-disabled="true"`, `aria-disabled={true}`
pub(crate) fn is_disabled_element(jsx_el: Jsx) -> bool {
    has_jsx_prop(jsx_el, "disabled").is_some()
        || match has_jsx_prop(jsx_el, "aria-disabled").and_then(get_prop_value) {
            Some(AttributeValue::StringLiteral(literal)) => literal.value == b"true",
            Some(AttributeValue::ExpressionContainer(e)) => {
                e.tag() == ExprTag::True && !e.is_parenthesized()
            }
            _ => false,
        }
}

static NON_INTERACTIVE_ELEMENT_TYPES: [&str; 58] = [
    "abbr",
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "caption",
    "code",
    "dd",
    "del",
    "details",
    "dfn",
    "dialog",
    "dir",
    "dl",
    "dt",
    "em",
    "fieldset",
    "figcaption",
    "figure",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "html",
    "iframe",
    "img",
    "ins",
    "label",
    "legend",
    "li",
    "main",
    "mark",
    "marquee",
    "menu",
    "meter",
    "nav",
    "ol",
    "optgroup",
    "output",
    "p",
    "pre",
    "progress",
    "ruby",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "tfoot",
    "thead",
    "time",
    "ul",
];

/// `element_type`: from [`get_element_type`]. A `section` is one if it has a name.
pub(crate) fn is_non_interactive_element(element_type: &[u8], jsx_opening_el: Jsx) -> bool {
    match element_type {
        b"section" => {
            has_jsx_prop_ignore_case(jsx_opening_el, "aria-label").is_some()
                || has_jsx_prop_ignore_case(jsx_opening_el, "aria-labelledby").is_some()
        }
        _ => contains_name(&NON_INTERACTIVE_ELEMENT_TYPES, element_type),
    }
}

/// `MOUSE_EVENT_HANDLERS`, `KEYBOARD_EVENT_HANDLERS`
pub(crate) static MOUSE_AND_KEYBOARD_EVENT_HANDLERS: [&str; 22] = [
    "onClick",
    "onContextMenu",
    "onDblClick",
    "onDoubleClick",
    "onDrag",
    "onDragEnd",
    "onDragEnter",
    "onDragExit",
    "onDragLeave",
    "onDragOver",
    "onDragStart",
    "onDrop",
    "onMouseDown",
    "onMouseEnter",
    "onMouseLeave",
    "onMouseMove",
    "onMouseOut",
    "onMouseOver",
    "onMouseUp",
    "onKeyDown",
    "onKeyPress",
    "onKeyUp",
];

/// An option that has names for the names of some elements: `{ "tr": ["none", "presentation"] }`.
pub(crate) struct NamesByElement(Vec<(String, Vec<String>)>);

impl NamesByElement {
    pub(crate) fn new(entries: &[(&str, &[&str])]) -> Self {
        let names = |it: &[&str]| it.iter().map(|name| (*name).to_owned()).collect();
        NamesByElement(
            entries
                .iter()
                .map(|it| (it.0.to_owned(), names(it.1)))
                .collect(),
        )
    }

    /// All of `config` but what it has for the key `except`.
    pub(crate) fn of_option(config: Object, except: &str) -> Self {
        let keys = config
            .entries()
            .iter()
            .filter_map(|it| std::str::from_utf8(&it.0).ok())
            .filter(|key| *key != except);
        NamesByElement(
            keys.map(|key| {
                (
                    key.to_owned(),
                    config.strings(key).into_iter().map(String::from).collect(),
                )
            })
            .collect(),
        )
    }

    /// `None` if the option does not name `element`.
    pub(crate) fn has_if_named(&self, element: &[u8], name: &[u8]) -> Option<bool> {
        let names = self.0.iter().find(|it| it.0.as_bytes() == element)?;
        Some(names.1.iter().any(|it| it.as_bytes() == name))
    }

    pub(crate) fn has(&self, element: &[u8], name: &[u8]) -> bool {
        self.has_if_named(element, name) == Some(true)
    }
}

/// `a="b"`, `a={"b"}`: the `b`.
pub(crate) fn get_static_string_prop_value(item: Prop<'_>) -> Option<&[u8]> {
    match get_prop_value(item)? {
        AttributeValue::StringLiteral(literal) => Some(literal.value),
        AttributeValue::ExpressionContainer(e) if !e.is_parenthesized() => {
            e.as_string().map(Name::bytes)
        }
        _ => None,
    }
}

/// The elements of HTML and the roles that they have without a `role`. Which of several it is depends on attributes.
static ELEMENT_ROLE_MAP: [(&str, &str); 72] = [
    ("a", "link"),
    ("address", "group"),
    ("area", "link"),
    ("article", "article"),
    ("aside", "complementary"),
    ("blockquote", "blockquote"),
    ("button", "button"),
    ("caption", "caption"),
    ("code", "code"),
    ("datalist", "listbox"),
    ("del", "deletion"),
    ("details", "group"),
    ("dfn", "term"),
    ("dialog", "dialog"),
    ("em", "emphasis"),
    ("fieldset", "group"),
    ("figure", "figure"),
    ("footer", "contentinfo"),
    ("form", "form"),
    ("h1", "heading"),
    ("h2", "heading"),
    ("h3", "heading"),
    ("h4", "heading"),
    ("h5", "heading"),
    ("h6", "heading"),
    ("header", "banner"),
    ("hgroup", "group"),
    ("hr", "separator"),
    ("img", "img"),
    ("img", "image"),
    ("input", "checkbox"),
    ("input", "combobox"),
    ("input", "radio"),
    ("input", "searchbox"),
    ("input", "slider"),
    ("input", "spinbutton"),
    ("input", "textbox"),
    ("ins", "insertion"),
    ("li", "listitem"),
    ("main", "main"),
    ("math", "math"),
    ("menu", "list"),
    ("meter", "meter"),
    ("nav", "navigation"),
    ("ol", "list"),
    ("optgroup", "group"),
    ("option", "option"),
    ("output", "status"),
    ("p", "paragraph"),
    ("progress", "progressbar"),
    ("s", "deletion"),
    ("search", "search"),
    ("section", "region"),
    ("select", "combobox"),
    ("select", "listbox"),
    ("strong", "strong"),
    ("sub", "subscript"),
    ("sup", "superscript"),
    ("svg", "graphics-document"),
    ("table", "table"),
    ("tbody", "rowgroup"),
    ("td", "cell"),
    ("td", "gridcell"),
    ("textarea", "textbox"),
    ("tfoot", "rowgroup"),
    ("th", "columnheader"),
    ("th", "rowheader"),
    ("th", "gridcell"),
    ("thead", "rowgroup"),
    ("time", "time"),
    ("tr", "row"),
    ("ul", "list"),
];

pub(crate) fn get_element_implicit_roles(tag: &[u8]) -> impl Iterator<Item = &'static str> {
    ELEMENT_ROLE_MAP
        .iter()
        .filter(move |it| it.0.as_bytes() == tag)
        .map(|it| it.1)
}

/// How [`search_for_accessible_label`] tells a label.
pub(crate) struct LabelSearch<'s> {
    /// How many levels of children are looked at.
    pub(crate) depth: u8,
    pub(crate) has_labelling_prop: &'s dyn Fn(Jsx) -> bool,
    /// By what [`get_element_type`] says.
    pub(crate) is_control_component: &'s dyn Fn(&[u8]) -> bool,
}

/// Whether `node`, which is at the level `depth` below a label or a control, may be text for it: text that is not blank, `{e}`, an
/// element with an attribute that labels, a component without children that is not a control, or something in it that is.
pub(crate) fn search_for_accessible_label<'a>(
    file: &'a File<'a>,
    node: Child<'a>,
    depth: u8,
    search: &LabelSearch,
) -> bool {
    if depth > search.depth {
        return false;
    }
    let parent = match node {
        Child::ExpressionContainer(_) => return true,
        Child::Text(text) => {
            return bun_core::strings::split_unicode_whitespace(text)
                .next()
                .is_some();
        }
        Child::Spread => return false,
        Child::Fragment(fragment) => fragment,
        Child::Element(element) => {
            if (search.has_labelling_prop)(element) {
                return true;
            }
            if children(file, element).next().is_none() {
                let name = get_element_type(file, element);
                if name.first().is_some_and(u8::is_ascii_uppercase)
                    && !(search.is_control_component)(&name)
                {
                    return true;
                }
            }
            element
        }
    };
    children(file, parent).any(|child| search_for_accessible_label(file, child, depth + 1, search))
}

/// The elements that have the role `role` without a `role`.
pub(crate) fn get_tags_for_role(role: &[u8]) -> impl Iterator<Item = &'static str> {
    ELEMENT_ROLE_MAP
        .iter()
        .filter(move |it| it.1.as_bytes() == role)
        .map(|it| it.0)
}
