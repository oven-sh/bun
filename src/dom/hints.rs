//! What attributes mean for styles: presentational hints, and the states that pseudo-classes match.

use crate::api::core::{Known, Meaning};
use crate::document::Document;
use crate::name::{Name, is_name, name};
use crate::selector::key;
use crate::transform::Transforms;
use crate::tree::{Attribute, Data, Element, Fact, Flags, Namespace, NodeId, State};
use crate::values::Out;

const SVG_PRESENTATION: &str = " alignment-baseline baseline-shift buffered-rendering clip clip-path clip-rule color \
    color-interpolation color-interpolation-filters color-rendering cursor direction display dominant-baseline fill \
    fill-opacity fill-rule filter flood-color flood-opacity font-family font-size font-size-adjust font-stretch \
    font-style font-variant font-weight image-rendering letter-spacing lighting-color marker-end marker-mid marker-start \
    mask mask-type opacity overflow paint-order pointer-events shape-rendering stop-color stop-opacity stroke \
    stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width \
    text-anchor text-decoration text-overflow text-rendering transform-origin unicode-bidi vector-effect visibility \
    white-space word-spacing writing-mode ";

static PRESENTATION_ATTRIBUTES: std::sync::LazyLock<crate::name::Set<Name>> =
    std::sync::LazyLock::new(|| {
        SVG_PRESENTATION
            .split_ascii_whitespace()
            .map(|it| Name::new(it.as_bytes()))
            .collect()
    });

pub(crate) fn is_presentation_attribute(element: &Element, name: Name) -> bool {
    match () {
        () if is_name!(name, "d" | "id" | "style" | "class") => false,
        () if is_name!(name, "x" | "y" | "width" | "height") => is_name!(
            element.tag,
            "svg" | "rect" | "image" | "foreignObject" | "use" | "symbol"
        ),
        () if is_name!(name, "cx" | "cy") => is_name!(element.tag, "circle" | "ellipse"),
        () if is_name!(name, "rx" | "ry") => is_name!(element.tag, "rect" | "ellipse"),
        () if name == name!("r") => element.tag == name!("circle"),
        () if name == name!("fill")
            && is_name!(
                element.tag,
                "animate" | "set" | "animateMotion" | "animateTransform"
            ) =>
        {
            false
        }
        () => PRESENTATION_ATTRIBUTES.contains(&name),
    }
}

impl Element {
    pub(crate) fn input_type(&self) -> Name {
        match self.attribute(name!("type")) {
            None | Some("text") => name!("text"),
            Some("checkbox") => name!("checkbox"),
            Some(other) => Name::lowercase(other.as_bytes()),
        }
    }

    pub(crate) fn is_text_field(&self) -> bool {
        !is_name!(
            self.input_type(),
            "checkbox"
                | "radio"
                | "button"
                | "submit"
                | "reset"
                | "image"
                | "file"
                | "range"
                | "color"
                | "hidden"
                | "date"
                | "time"
                | "datetime-local"
                | "month"
                | "week"
        )
    }

    fn direction(&self) -> Option<Direction> {
        let value = &*self
            .attributes_besides_class()
            .find(|it| it.name == name!("dir"))
            .filter(|_| self.namespace == Namespace::Html)?
            .value;
        let keywords = [
            ("ltr", Direction::Ltr),
            ("rtl", Direction::Rtl),
            ("auto", Direction::Auto),
        ];
        keywords
            .into_iter()
            .find(|it| value.eq_ignore_ascii_case(it.0))
            .map(|it| it.1)
    }

    fn has_auto_direction(&self) -> bool {
        self.direction().map_or_else(
            || self.html_tag() == name!("bdi"),
            |it| it == Direction::Auto,
        )
    }

    /// False for most of those whose name means nothing to `Document::prepare` and `Document::derive_state`.
    #[inline(always)]
    pub(crate) fn may_be_special(&self) -> bool {
        const BITS: [u64; 2] = {
            let (mut bits, mut index) = ([0; 2], 0);
            let all = [
                name!("a"),
                name!("area"),
                name!("details"),
                name!("dialog"),
                name!("bdi"),
                name!("button"),
                name!("input"),
                name!("select"),
                name!("textarea"),
                name!("fieldset"),
                name!("optgroup"),
                name!("option"),
                name!("svg"),
                name!("td"),
                name!("th"),
                name!("colgroup"),
                name!("thead"),
                name!("tbody"),
                name!("tfoot"),
            ];
            while index < all.len() {
                bits[(all[index].bits() >> 63) as usize] |= 1 << (all[index].bits() >> 24 & 63);
                index += 1;
            }
            bits
        };
        BITS[(self.tag.bits() >> 63) as usize] >> (self.tag.bits() >> 24 & 63) & 1 != 0
    }

    /// What it adds to the state that it inherits, if that is all there is to preparing it while no table styles its cells.
    #[inline(always)]
    pub(crate) fn own_state(&self) -> Option<State> {
        if self.namespace != Namespace::Html
            || self.is_unprepared
            || self.has_rare()
            || self
                .attributes_besides_class()
                .any(|it| is_name!(it.name, "dir" | "contenteditable"))
        {
            return None;
        }
        if self.may_be_special() {
            self.own_state_by_name()
        } else {
            Some(State::empty())
        }
    }

    /// It has none, and its attributes give it none.
    pub(crate) fn lacks_hints(&self) -> bool {
        let is_hint = |it: &Attribute| match it.local.known() {
            Known::Other => can_be_hint_in_html(it.name),
            known => it.space.is_some() || known.meaning().contains(Meaning::HINT),
        };
        self.namespace == Namespace::Html
            && !self.has_rare()
            && !self.attributes.iter().any(is_hint)
    }

    /// There is nothing to prepare, unless it inherits a state.
    #[inline(always)]
    pub(crate) fn is_ready(&self) -> bool {
        self.namespace == Namespace::Html
            && !self.is_unprepared
            && self.state.is_empty()
            && !self.may_be_special()
            && !self.has_rare()
            && self.has_only_classes()
    }

    fn own_state_by_name(&self) -> Option<State> {
        let is_special = is_name!(
            self.tag,
            "details"
                | "dialog"
                | "bdi"
                | "button"
                | "input"
                | "select"
                | "textarea"
                | "fieldset"
                | "optgroup"
                | "option"
                | "svg"
        );
        (!is_special).then(|| {
            if is_name!(self.tag, "a" | "area") && self.has(name!("href")) {
                State::LINK
            } else {
                State::empty()
            }
        })
    }

    /// Its text does not count for the direction of an ancestor.
    fn isolates_direction(&self) -> bool {
        is_name!(self.html_tag(), "bdi" | "script" | "style" | "textarea")
            || self.direction().is_some()
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Direction {
    Ltr,
    Rtl,
    Auto,
}

fn leading_number(value: &str) -> (&str, &str) {
    value.split_at(value.bytes().take_while(u8::is_ascii_digit).count())
}

pub(crate) fn non_negative_integer(value: &str) -> Option<u32> {
    let value = value.trim_ascii_start();
    let digits = leading_number(
        value
            .strip_prefix('+')
            .or_else(|| value.strip_prefix("-0").map(|_| "0"))
            .unwrap_or(value),
    )
    .0;
    (!digits.is_empty())
        .then(|| digits.parse().ok())
        .flatten()
        .filter(|it| *it <= i32::MAX as u32)
}

/// The number and its unit.
fn dimension(value: &str) -> Option<(f64, &'static str)> {
    let value = value.trim_ascii_start();
    let (whole, mut rest) = leading_number(value);
    if let Some(fraction) = rest.strip_prefix('.') {
        rest = leading_number(fraction).1;
    }
    let number = value[..value.len() - rest.len()]
        .trim_end_matches('.')
        .parse()
        .ok()
        .filter(|_| !whole.is_empty())?;
    Some((number, if rest.starts_with('%') { "%" } else { "px" }))
}

fn legacy_color(value: &str) -> Option<String> {
    let value = value.trim_ascii();
    if value.eq_ignore_ascii_case("transparent") {
        return None;
    }
    let is_short = value.len() == 4
        && value.starts_with('#')
        && value.bytes().skip(1).all(|it| it.is_ascii_hexdigit());
    if is_short || bun_css::css_parser::color::parse_named_color(value.as_bytes()).is_some() {
        return Some(value.into());
    }
    let units = value
        .chars()
        .flat_map(|it| {
            core::iter::repeat_n(if it.len_utf16() > 1 { '0' } else { it }, it.len_utf16())
        })
        .take(128);
    let mut digits: Vec<_> = units
        .skip(usize::from(value.starts_with('#')))
        .map(|it| if it.is_ascii_hexdigit() { it } else { '0' })
        .collect();
    digits.resize(digits.len().max(1).next_multiple_of(3), '0');
    let len = digits.len() / 3;
    let mut from = len.saturating_sub(8);
    while len - from > 2 && digits.chunks(len).all(|it| it[from] == '0') {
        from += 1;
    }
    let parts = digits.chunks(len).map(|it| {
        format!(
            "{:0>2}",
            it[from..len.min(from + 2)].iter().collect::<String>()
        )
    });
    Some(core::iter::once("#".into()).chain(parts).collect())
}

fn legacy_font_size(value: &str) -> Option<&'static str> {
    let value = value.trim_ascii_start();
    let digits = leading_number(value.strip_prefix(['+', '-']).unwrap_or(value)).0;
    let number = (!digits.is_empty()).then(|| digits.parse().unwrap_or(i32::MAX).min(9))?;
    let size = match value.as_bytes()[0] {
        b'+' => 3 + number,
        b'-' => 3 - number,
        _ => number,
    };
    Some(
        [
            "x-small",
            "small",
            "medium",
            "large",
            "x-large",
            "xx-large",
            "xxx-large",
        ][size.clamp(1, 7) as usize - 1],
    )
}

fn table_border(table: &Element) -> Option<u32> {
    table
        .attribute(name!("border"))
        .map(|it| non_negative_integer(it).unwrap_or(1))
}

fn keyword<'a>(element: &Element, name: Name, known: &[&'a str]) -> Option<&'a str> {
    let value = element.attribute(name)?;
    known
        .iter()
        .copied()
        .find(|it| value.eq_ignore_ascii_case(it))
}

fn table_rules(table: &Element) -> Option<&'static str> {
    keyword(
        table,
        name!("rules"),
        &["none", "groups", "rows", "cols", "all"],
    )
}

/// <https://html.spec.whatwg.org/#convert-a-list-of-dimensions-to-a-list-of-pixel-values>
fn frame_tracks(list: Option<&str>, gap: u32) -> String {
    let list = list
        .map(|it| it.trim_end_matches(','))
        .filter(|it| !it.is_empty())
        .unwrap_or("*");
    let tracks: Vec<(f64, u8)> = (bun_core::strings::split(list.as_bytes(), b",")
        .take(4096)
        .map(crate::values::text))
    .map(|it| {
        match (
            dimension(it).map(|it| it.0.min(i32::MAX.into())),
            bun_core::strings::index_of_any(it.as_bytes(), b"%*").map(|at| it.as_bytes()[at]),
        ) {
            (number, Some(b'*')) => (number.unwrap_or(1.0).floor().max(1.0), b'*'),
            (None, None) => (1.0, b'*'),
            (number, unit) => (number.unwrap_or(0.0), unit.unwrap_or(b'p')),
        }
    })
    .collect();
    let [fixed, percent, relative] = b"p%*".map(|unit| {
        tracks
            .iter()
            .filter(|it| it.1 == unit)
            .map(|it| it.0)
            .sum::<f64>()
    });
    let all = format!("(100% - {}px)", gap as usize * (tracks.len() - 1));
    let after_fixed = format!("max(0px, {all} - {fixed}px)");
    let track = |&(number, unit): &(f64, u8)| match unit {
        b'p' if percent + relative > 0.0 => {
            format!("min({number}px, {all} * {}) ", number / fixed.max(1.0))
        }
        b'p' => format!("calc({all} * {}) ", number / fixed.max(1.0)),
        b'%' if relative > 0.0 => format!(
            "min({all} * {}, {after_fixed} * {}) ",
            number / 100.0,
            number / percent.max(1.0)
        ),
        b'%' => format!("calc({after_fixed} * {}) ", number / percent.max(1.0)),
        _ => format!("minmax(1px, {}fr) ", number / relative * 1000.0),
    };
    tracks.iter().map(track).collect()
}

fn html_hints(element: &Element, table: Option<&Element>, declare: &mut dyn FnMut(&str, &str)) {
    let tag = element.html_tag();
    let is_image = is_name!(tag, "img" | "object")
        || tag == name!("input") && element.input_type() == name!("image");
    let is_embedded = is_image || is_name!(tag, "embed" | "iframe");
    let is_table_part = is_name!(tag, "thead" | "tbody" | "tfoot" | "tr" | "td" | "th");
    let integer = |name| element.attribute(name).and_then(non_negative_integer);
    if let Some(table) = table {
        let color = if table
            .attribute(name!("bordercolor"))
            .is_some_and(|it| !it.is_empty())
        {
            "solid"
        } else {
            "inset"
        };
        match (table_rules(table), table_border(table)) {
            (Some("groups"), _) if tag == name!("colgroup") => {
                declare("border-inline", "1px solid")
            }
            (Some("groups"), _) if is_name!(tag, "thead" | "tbody" | "tfoot") => {
                declare("border-block", "1px solid")
            }
            _ if !is_name!(tag, "td" | "th") => {}
            (Some(rules @ ("rows" | "cols" | "all")), _) => {
                declare(
                    if rules == "rows" {
                        "border-block"
                    } else if rules == "cols" {
                        "border-inline"
                    } else {
                        "border"
                    },
                    "1px solid",
                );
                declare("border-color", "inherit");
            }
            (None, Some(1..)) => {
                declare("border", &format!("1px {color}"));
                declare("border-color", "inherit");
            }
            _ => {}
        }
        if let Some(padding) = table
            .attribute(name!("cellpadding"))
            .and_then(non_negative_integer)
            .filter(|_| is_name!(tag, "td" | "th"))
        {
            declare("padding", &format!("{padding}px"));
        }
    }
    for attribute in &element.attributes {
        let value = &*attribute.value;
        let is = |known: &str| value.eq_ignore_ascii_case(known);
        let mut length = |properties: &[&str], allows_zero: bool| {
            if let Some((number, unit)) = dimension(value).filter(|it| allows_zero || it.0 != 0.0) {
                properties
                    .iter()
                    .for_each(|it| declare(it, &format!("{number}{unit}")));
            }
        };
        match &*attribute.qualified() {
            name @ ("width" | "height") if is_embedded || is_name!(tag, "video" | "marquee") => {
                length(&[name], true)
            }
            name @ ("width" | "height") if is_name!(tag, "td" | "th") => length(&[name], false),
            "width" if tag == name!("table") => length(&["width"], false),
            "width" if is_name!(tag, "col" | "colgroup" | "hr") => length(&["width"], true),
            "height" if is_name!(tag, "table" | "tr" | "thead" | "tbody" | "tfoot") => {
                length(&["height"], true)
            }
            "hspace" if is_image || is_name!(tag, "embed" | "marquee") => {
                length(&["margin-left", "margin-right"], true)
            }
            "vspace" if is_image || is_name!(tag, "embed" | "marquee") => {
                length(&["margin-top", "margin-bottom"], true)
            }
            "border" if is_image => declare(
                "border",
                &format!("{}px solid", non_negative_integer(value).unwrap_or(0)),
            ),
            "frameborder"
                if tag == name!("iframe")
                    && non_negative_integer(value.trim_ascii_start().trim_start_matches('-'))
                        .unwrap_or(0)
                        == 0 =>
            {
                declare("border-width", "0")
            }
            name @ ("marginheight" | "marginwidth" | "topmargin" | "leftmargin")
                if tag == name!("body") =>
            {
                let sides = if matches!(name, "marginheight" | "topmargin") {
                    ["margin-top", "margin-bottom"]
                } else {
                    ["margin-left", "margin-right"]
                };
                non_negative_integer(value).into_iter().for_each(|it| {
                    sides
                        .iter()
                        .for_each(|side| declare(side, &format!("{it}px")))
                });
            }
            name @ ("bgcolor" | "text" | "color" | "bordercolor") if !value.is_empty() => {
                let properties: &[&str] = match name {
                    "bgcolor"
                        if is_table_part
                            || is_name!(tag, "body" | "table" | "marquee" | "col" | "colgroup") =>
                    {
                        &["background-color"]
                    }
                    "text" if tag == name!("body") => &["color"],
                    "color" if tag == name!("font") => &["color"],
                    "color" if tag == name!("hr") => &["border-color", "background-color"],
                    "bordercolor" if tag == name!("table") => &["border-color"],
                    _ => &[],
                };
                legacy_color(value)
                    .iter()
                    .for_each(|color| properties.iter().for_each(|it| declare(it, color)));
            }
            "background"
                if (is_table_part || is_name!(tag, "body" | "table"))
                    && !value.trim_ascii().is_empty() =>
            {
                let mut url = Out::new();
                crate::values::write_string(value.trim_ascii().as_bytes(), &mut url);
                declare(
                    "background-image",
                    &format!("url({})", crate::values::text(&url)),
                );
            }
            "face" if tag == name!("font") => declare("font-family", value),
            "size" if tag == name!("font") => legacy_font_size(value)
                .into_iter()
                .for_each(|it| declare("font-size", it)),
            "size" if tag == name!("hr") => match non_negative_integer(value).unwrap_or(0) {
                ..=1 => declare("border-bottom-width", "0"),
                size => declare("height", &format!("{}px", size - 2)),
            },
            "clear" if tag == name!("br") && (is("all") || is("both")) => declare("clear", "both"),
            "clear" if tag == name!("br") && (is("left") || is("right")) => declare("clear", value),
            "wrap" if tag == name!("textarea") && is("off") => {
                declare("white-space", "pre");
                declare("overflow-wrap", "normal");
            }
            "valign" if is_table_part || is_name!(tag, "col" | "colgroup") => {
                declare("vertical-align", value)
            }
            "cellspacing" if tag == name!("table") => integer(name!("cellspacing"))
                .into_iter()
                .for_each(|it| declare("border-spacing", &format!("{it}px"))),
            "type" if is_name!(tag, "ol" | "ul" | "li") => {
                let ordered = [
                    ("1", "decimal"),
                    ("a", "lower-alpha"),
                    ("A", "upper-alpha"),
                    ("i", "lower-roman"),
                    ("I", "upper-roman"),
                ];
                let ordered = ordered
                    .into_iter()
                    .find(|it| it.0 == value && tag != name!("ul"))
                    .map(|it| it.1);
                let unordered = keyword(
                    element,
                    name!("type"),
                    &["none", "disc", "circle", "square"],
                )
                .filter(|_| tag != name!("ol"));
                ordered
                    .or(unordered)
                    .into_iter()
                    .for_each(|it| declare("list-style-type", it));
            }
            "align" if is_embedded => {
                let known = [
                    ("top", "top"),
                    ("left", "top"),
                    ("right", "top"),
                    ("middle", "-webkit-baseline-middle"),
                    ("center", "-webkit-baseline-middle"),
                    ("bottom", "baseline"),
                    ("texttop", "text-top"),
                    ("absmiddle", "middle"),
                    ("abscenter", "middle"),
                    ("absbottom", "bottom"),
                    ("baseline", "baseline"),
                ];
                known
                    .into_iter()
                    .filter(|it| is(it.0))
                    .for_each(|it| declare("vertical-align", it.1));
                if is("left") || is("right") {
                    declare("float", value);
                }
            }
            "align" if tag == name!("table") && is("center") => declare("margin-inline", "auto"),
            "align" if tag == name!("table") => declare("float", value),
            "align" if tag == name!("hr") => {
                declare("margin-left", if is("left") { "0" } else { "auto" });
                declare("margin-right", if is("right") { "0" } else { "auto" });
            }
            "align" if tag == name!("legend") && (is("left") || is("right") || is("center")) => {
                declare("justify-self", value)
            }
            "align" if tag == name!("caption") && (is("top") || is("bottom")) => {
                declare("caption-side", value)
            }
            "align" if is_table_part || is_name!(tag, "div" | "p" | "col" | "colgroup") => {
                match () {
                    () if is("absmiddle") && is_table_part => declare("text-align", "center"),
                    () if is("middle") || is("center") => declare("text-align", "-webkit-center"),
                    () if is("left") || is("right") => {
                        declare("text-align", &format!("-webkit-{value}"))
                    }
                    () => declare("text-align", value),
                }
            }
            "align" if is_name!(tag, "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "caption") => {
                declare("text-align", if is("middle") { "center" } else { value })
            }
            _ => {}
        }
    }
    if is_image && tag != name!("object") || is_name!(tag, "video" | "canvas") {
        let [width, height] =
            [name!("width"), name!("height")].map(|name| match tag == name!("canvas") {
                true => integer(name).map(f64::from),
                false => element
                    .attribute(name)
                    .and_then(dimension)
                    .filter(|it| it.1 == "px")
                    .map(|it| it.0),
            });
        width
            .zip(height)
            .into_iter()
            .for_each(|(width, height)| declare("aspect-ratio", &format!("auto {width}/{height}")));
    }
    let of_source =
        [name!("width source"), name!("height source")].map(|name| element.attribute(name));
    if tag == name!("img") && of_source != [None; 2] {
        let sizes = of_source.map(|it| it.and_then(dimension));
        for ((name, size), value) in ["width", "height"].into_iter().zip(sizes).zip(of_source) {
            match size {
                Some((number, unit)) => declare(name, &format!("{number}{unit}")),
                None if value.is_none() => declare(name, "auto"),
                None => {}
            }
        }
        match sizes {
            [Some((width, "px")), Some((height, "px"))] => {
                declare("aspect-ratio", &format!("auto {width}/{height}"))
            }
            [Some(_), _] | [_, Some(_)] => declare("aspect-ratio", "auto"),
            _ => {}
        }
    }
    if tag == name!("frameset") {
        let has_border = !element
            .attribute(name!("frameborder"))
            .is_some_and(|it| it == "0" || it.eq_ignore_ascii_case("no"));
        let gap = if has_border {
            integer(name!("border")).unwrap_or(6)
        } else {
            0
        };
        declare("gap", &format!("{gap}px"));
        declare(
            "grid-template-columns",
            &frame_tracks(element.attribute(name!("cols")), gap),
        );
        declare(
            "grid-template-rows",
            &frame_tracks(element.attribute(name!("rows")), gap),
        );
    }
    if tag == name!("hr") && (element.has(name!("color")) || element.has(name!("noshade"))) {
        declare("border-style", "solid");
        if !element.has(name!("color")) {
            declare("border-color", "gray");
            declare("background-color", "gray");
        }
    }
    if tag == name!("table") {
        let frames = [
            ("void", "hidden"),
            ("above", "solid hidden hidden"),
            ("below", "hidden hidden solid"),
            ("hsides", "solid hidden"),
            ("lhs", "hidden hidden hidden solid"),
            ("rhs", "hidden solid hidden hidden"),
            ("vsides", "hidden solid"),
            ("box", "solid"),
            ("border", "solid"),
        ];
        let frame = element.attribute(name!("frame")).and_then(|value| {
            frames
                .into_iter()
                .find(|it| value.eq_ignore_ascii_case(it.0))
        });
        let has_color = element
            .attribute(name!("bordercolor"))
            .is_some_and(|it| !it.is_empty());
        let (border, rules) = (table_border(element), table_rules(element));
        border
            .or_else(|| frame.map(|_| 1))
            .into_iter()
            .for_each(|it| declare("border-width", &format!("{it}px")));
        match (frame, border) {
            (Some((_, styles)), _) => declare("border-style", styles),
            (_, Some(1..)) => declare("border-style", if has_color { "solid" } else { "outset" }),
            _ if rules.is_some() => declare("border-style", "hidden"),
            _ => {}
        }
        if rules.is_some() {
            declare("border-collapse", "collapse");
        }
    }
}

fn hints(element: &Element, table: Option<&Element>, is_outer_svg: bool) -> Out {
    let mut out = Out::new();
    let mut declare = |property: &str, value: &str| {
        let start = out.len();
        out.reserve(96);
        [property, ":", value, ";"]
            .into_iter()
            .for_each(|it| out.extend_from_slice(it.as_bytes()));
        if !crate::scan::is_one_declaration(&out[start..]) {
            out.truncate(start);
        }
    };
    if let Some(language) = element
        .attribute(name!("lang"))
        .or_else(|| element.attribute(name!("lang http://www.w3.org/XML/1998/namespace")))
    {
        let is_tag = language
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
        declare(
            "-webkit-locale",
            &format!("\"{}\"", if is_tag { language } else { "" }),
        );
    }
    if element.namespace == Namespace::Svg {
        for attribute in element
            .attributes
            .iter()
            .filter(|it| is_presentation_attribute(element, it.name))
        {
            let unit = |it: &str| {
                [
                    it,
                    if it.parse::<f32>().is_ok_and(f32::is_finite) {
                        "px "
                    } else {
                        " "
                    },
                ]
                .concat()
            };
            match &*attribute.qualified() {
                "width" | "height"
                    if !is_outer_svg && is_name!(element.tag, "svg" | "symbol" | "use") => {}
                name @ ("font-size" | "letter-spacing" | "word-spacing" | "transform-origin"
                | "x" | "y" | "width" | "height" | "cx" | "cy" | "r" | "rx" | "ry") => {
                    declare(
                        name,
                        &attribute
                            .value
                            .split_ascii_whitespace()
                            .map(unit)
                            .collect::<String>(),
                    );
                }
                name @ "clip-path"
                    if [
                        "inset(", "circle(", "ellipse(", "polygon(", "rect(", "xywh(",
                    ]
                    .iter()
                    .any(|it| attribute.value.trim_ascii_start().starts_with(it)) =>
                {
                    let separates = |it: &u8| matches!(it, b' ' | b',' | b'(' | b')');
                    let parts = attribute
                        .value
                        .as_bytes()
                        .chunk_by(|a, b| separates(a) == separates(b))
                        .map(crate::values::text);
                    declare(
                        name,
                        &parts
                            .map(|it| unit(it).strip_suffix(' ').unwrap_or_default().to_owned())
                            .collect::<String>(),
                    );
                }
                name => declare(name, &attribute.value),
            }
        }
        if let Some(matrix) =
            crate::svg::transform_attribute(element).filter(|it| it.iter().all(|it| it.is_finite()))
        {
            let hint = Transforms::hint(&matrix);
            declare(
                "transform",
                if element.has_moved {
                    Transforms::ATTRIBUTE
                } else {
                    crate::values::text(&hint)
                },
            );
        }
        match element.attribute(name!("space http://www.w3.org/XML/1998/namespace")) {
            Some("preserve") => declare("white-space-collapse", "preserve-spaces"),
            Some("default") => declare("white-space-collapse", "collapse"),
            _ => {}
        }
    }
    match element.namespace {
        Namespace::Html => html_hints(element, table, &mut declare),
        Namespace::MathMl => crate::math::hints(element, &mut declare),
        _ => {}
    }
    out
}

pub(crate) const fn can_be_hint_in_html(name: Name) -> bool {
    is_name!(
        name,
        "lang"
            | "lang http://www.w3.org/XML/1998/namespace"
            | "width"
            | "height"
            | "bgcolor"
            | "align"
            | "valign"
            | "cellspacing"
            | "cellpadding"
            | "border"
            | "color"
            | "face"
            | "type"
            | "hspace"
            | "vspace"
            | "frameborder"
            | "marginheight"
            | "marginwidth"
            | "topmargin"
            | "leftmargin"
            | "text"
            | "bordercolor"
            | "background"
            | "size"
            | "clear"
            | "wrap"
            | "noshade"
            | "frame"
            | "rules"
            | "cols"
            | "rows"
            | "width source"
            | "height source"
    )
}

/// By anything but selectors, `attr()` and accessibility.
pub(crate) const fn is_read_in_html(name: Name) -> bool {
    can_be_hint_in_html(name)
        || can_change_state(name)
        || is_name!(
            name,
            "id" | "style"
                | "value"
                | "part"
                | "start"
                | "reversed"
                | "colspan"
                | "rowspan"
                | "span"
                | "multiple"
                | "viewBox"
                | "requiredExtensions"
                | "systemLanguage"
        )
}

pub(crate) fn can_be_hint(element: &Element, name: Name) -> bool {
    can_be_hint_in_html(name)
        || element.namespace == Namespace::MathMl
        || element.namespace == Namespace::Svg
            && (is_presentation_attribute(element, name)
                || is_name!(
                    name,
                    "transform"
                        | "gradientTransform"
                        | "patternTransform"
                        | "space http://www.w3.org/XML/1998/namespace"
                ))
}

pub(crate) const fn can_change_state(name: Name) -> bool {
    is_name!(
        name,
        "href"
            | "href http://www.w3.org/1999/xlink"
            | "disabled"
            | "required"
            | "readonly"
            | "contenteditable"
            | "open"
            | "dir"
            | "type"
    )
}

/// `Some(true)` for a strong right-to-left character.
fn strong_direction(character: char) -> Option<bool> {
    match character {
        '\u{590}'..='\u{8ff}'
        | '\u{fb1d}'..='\u{fdff}'
        | '\u{fe70}'..='\u{fefc}'
        | '\u{10800}'..='\u{10fff}'
        | '\u{1e800}'..='\u{1efff}' => character.is_alphabetic().then_some(true),
        '\u{200f}' => Some(true),
        '\u{200e}' => Some(false),
        _ => character.is_alphabetic().then_some(false),
    }
}

fn text_direction(text: &str) -> Option<bool> {
    text.chars().find_map(strong_direction)
}

const DERIVED: State = State::from_bits_retain(0xff << 24);

impl Document {
    pub(crate) fn update_hints(&mut self, id: NodeId) {
        let Some(element) = self.tree.element(id) else {
            return;
        };
        let table = (is_name!(
            element.html_tag(),
            "td" | "th" | "colgroup" | "thead" | "tbody" | "tfoot"
        )
        .then(|| self.tree.flat_ancestors(id)))
        .and_then(|mut ancestors| ancestors.find(|it| self.tree.html_tag(*it) == name!("table")))
        .and_then(|table| self.tree.element(table));
        let parent = self.tree.element(self.tree[id].parent);
        let is_outer_svg =
            element.tag == name!("svg") && !parent.is_some_and(crate::svg::has_svg_children);
        let source = hints(element, table, is_outer_svg);
        let block = self
            .styles
            .block(&source, crate::sheet::Within::Hints, &self.base_url);
        if let Some(element) = self.tree.element_mut(id)
            && element.hints.as_ref().map(std::rc::Rc::as_ptr)
                != block.as_ref().map(std::rc::Rc::as_ptr)
        {
            element.rare_mut().hints = block;
            self.tree.mark_style(id, Flags::REMATCH);
        }
    }

    /// https://html.spec.whatwg.org/#contained-text-auto-directionality
    fn contained_direction(&self, root: NodeId) -> Option<bool> {
        let mut at = self.tree[root].first_child;
        while at != 0 {
            let mut next = match &self.tree[at].data {
                Data::Text(text) if let Some(found) = text_direction(text) => return Some(found),
                Data::Element(it) if it.isolates_direction() => 0,
                Data::Element(it)
                    if it.pseudo == crate::selector::Pseudo::Part(name!("placeholder")) =>
                {
                    0
                }
                Data::Element(it)
                    if it.html_tag() == name!("slot")
                        && let Some(host) =
                            self.tree.element(self.tree.host_of(self.tree[at].scope)) =>
                {
                    return Some(host.state.contains(State::RTL));
                }
                _ => self.tree[at].first_child,
            };
            while next == 0 && at != root {
                (next, at) = (self.tree[at].next, self.tree[at].parent);
            }
            at = next;
        }
        None
    }

    /// https://html.spec.whatwg.org/#auto-directionality
    fn auto_direction(&self, id: NodeId, element: &Element) -> Option<bool> {
        let tag = element.html_tag();
        if tag == name!("input")
            && is_name!(
                element.input_type(),
                "hidden" | "submit" | "reset" | "button"
            )
        {
            return text_direction(element.attribute(name!("value"))?);
        }
        if tag == name!("textarea")
            || tag == name!("input")
                && element.is_text_field()
                && element.input_type() != name!("number")
        {
            return self.contained_direction(element.shadow_root);
        }
        if element.assigned.is_empty() {
            return self.contained_direction(id);
        }
        element
            .assigned
            .iter()
            .find_map(|it| match &self.tree[*it].data {
                Data::Text(text) => text_direction(text),
                Data::Element(child) if !child.isolates_direction() => {
                    self.contained_direction(*it)
                }
                _ => None,
            })
    }

    fn is_in_disabled_list(&self, id: NodeId) -> bool {
        let (mut at, mut has_group) = (
            self.tree[id].parent,
            self.tree.html_tag(id) == name!("optgroup"),
        );
        while let Some(ancestor) = self.tree.element(at) {
            match ancestor.html_tag() {
                tag if tag == name!("select") => return ancestor.state.contains(State::DISABLED),
                tag if tag == name!("optgroup") && core::mem::replace(&mut has_group, true) => {
                    return false;
                }
                tag if tag == name!("optgroup") && ancestor.has(name!("disabled")) => return true,
                tag if is_name!(tag, "option" | "hr" | "datalist") => return false,
                _ => at = self.tree[at].parent,
            }
        }
        false
    }

    fn is_in_disabled_fieldset(&self, id: NodeId) -> bool {
        let (mut child, mut at) = (id, self.tree[id].parent);
        while let Some(ancestor) = self.tree.element(at) {
            if ancestor.html_tag() == name!("fieldset") && ancestor.has(name!("disabled")) {
                let is_legend = |it: &NodeId| self.tree.html_tag(*it) == name!("legend");
                if !is_legend(&child)
                    || self.tree.element_children(at).find(is_legend) != Some(child)
                {
                    return true;
                }
            }
            (child, at) = (at, self.tree[at].parent);
        }
        false
    }

    fn derived_state(&self, id: NodeId, element: &Element) -> State {
        let (tag, mut state) = (element.html_tag(), State::empty());
        let parent = self.tree.element(self.tree.parent_or_host(id));
        let of_document = if self.is_in_design_mode {
            State::READ_WRITE
        } else {
            State::empty()
        };
        let inherited = parent.map_or(of_document, |it| it.state);
        if !is_name!(
            element.tag,
            "a" | "area"
                | "details"
                | "dialog"
                | "bdi"
                | "button"
                | "input"
                | "select"
                | "textarea"
                | "fieldset"
                | "optgroup"
                | "option"
        ) && !element
            .state
            .intersects(State::PICKER_OPEN | State::FORM_ASSOCIATED)
            && !element
                .attributes_besides_class()
                .any(|it| is_name!(it.name, "dir" | "contenteditable"))
        {
            return inherited & (State::READ_WRITE | State::RTL);
        }
        state.set(
            State::LINK,
            is_name!(element.tag, "a" | "area")
                && (element.has(name!("href"))
                    || element.namespace == Namespace::Svg && crate::svg::href(element).is_some()),
        );
        state.set(
            State::OPEN,
            is_name!(tag, "details" | "dialog") && element.has(name!("open"))
                || element.state.contains(State::PICKER_OPEN),
        );
        if is_name!(
            tag,
            "button" | "input" | "select" | "textarea" | "fieldset" | "optgroup" | "option"
        ) || element.state.contains(State::FORM_ASSOCIATED)
        {
            let is_disabled = element.has(name!("disabled"))
                || match is_name!(tag, "optgroup" | "option") {
                    true => self.is_in_disabled_list(id),
                    false => self.is_in_disabled_fieldset(id),
                };
            state |= if is_disabled {
                State::DISABLED
            } else {
                State::ENABLED
            };
        }
        let ignores_required = || {
            is_name!(
                element.input_type(),
                "hidden" | "range" | "color" | "submit" | "image" | "reset" | "button"
            )
        };
        if tag == name!("input") && ignores_required() {
            state |= State::OPTIONAL;
        } else if is_name!(tag, "input" | "select" | "textarea") {
            state |= if element.has(name!("required")) {
                State::REQUIRED
            } else {
                State::OPTIONAL
            };
        }
        let is_writable = match element.attribute(name!("contenteditable")) {
            _ if is_name!(tag, "input" | "textarea") => {
                !element.has(name!("readonly"))
                    && !state.contains(State::DISABLED)
                    && (tag == name!("textarea") || element.is_text_field())
            }
            Some(value) if value.eq_ignore_ascii_case("false") => false,
            Some(value)
                if ["", "true", "plaintext-only"]
                    .iter()
                    .any(|it| value.eq_ignore_ascii_case(it)) =>
            {
                true
            }
            _ => inherited.contains(State::READ_WRITE),
        };
        state.set(State::READ_WRITE, is_writable);
        let is_rtl = match element.direction() {
            _ if element.has_auto_direction() => self.auto_direction(id, element).unwrap_or(false),
            Some(direction) => direction == Direction::Rtl,
            None if tag == name!("input") && element.input_type() == name!("tel") => false,
            None => inherited.contains(State::RTL),
        };
        state.set(State::RTL, is_rtl);
        state
    }

    /// Of `id`, and of its descendants if they can be affected.
    pub(crate) fn update_derived_state(&mut self, id: NodeId, whole_subtree: bool) {
        let (mut pending, mut next) = (Vec::new(), Some(id));
        while let Some(id) = next {
            if self
                .derive_state(id, false)
                .intersects(State::READ_WRITE | State::RTL)
                || whole_subtree
            {
                let shadow_root = self.tree.element(id).map_or(0, |it| it.shadow_root);
                pending.extend(
                    self.tree
                        .element_children(id)
                        .chain(self.tree.element_children(shadow_root)),
                );
            }
            next = pending.pop();
        }
    }

    /// Returns what has changed. `is_new`: it has just been inserted, which `children_changed` is going to be told.
    pub(crate) fn derive_state(&mut self, id: NodeId, is_new: bool) -> State {
        let Some(element) = self.tree.element(id) else {
            return State::empty();
        };
        let toggled = (element.state & DERIVED) ^ self.derived_state(id, element);
        if element.has_auto_direction() {
            if !is_new && !self.tree[id].has(Flags::AUTO_DIRECTION) {
                self.tree.ancestry.forget_all();
            }
            self.tree[id].set(Flags::AUTO_DIRECTION);
            self.has_auto_direction = true;
        } else {
            self.tree[id].unset(Flags::AUTO_DIRECTION);
        }
        let shadow_root = element.shadow_root;
        match is_new && self.accessibility.is_none() {
            true => self
                .tree
                .element_mut(id)
                .into_iter()
                .for_each(|it| it.state ^= toggled),
            false => self.change_state(id, toggled),
        }
        if self.has_auto_direction && shadow_root != 0 && toggled.contains(State::RTL) {
            let slots: Vec<_> = self
                .tree
                .descendants(shadow_root)
                .filter(|it| self.tree.html_tag(*it) == name!("slot"))
                .collect();
            for parent in slots
                .into_iter()
                .map(|it| self.tree[it].parent)
                .filter(|it| *it != shadow_root)
                .collect::<Vec<_>>()
            {
                self.text_changed_in(parent);
            }
        }
        toggled
    }

    pub(crate) fn change_state(&mut self, id: NodeId, toggled: State) {
        if let Some(accessibility) = &mut self.accessibility {
            accessibility.state_changed(id, toggled);
        }
        if let Some(element) = (!toggled.is_empty())
            .then(|| self.tree.element_mut(id))
            .flatten()
        {
            element.state ^= toggled;
            if element.pseudo != crate::selector::Pseudo::None {
                self.tree.mark_style(id, Flags::REMATCH);
            }
        }
        if self.tree.style(id).is_some_and(|it| it.look.is_painted()) {
            self.repaint_subtree(id);
        }
        toggled
            .iter()
            .for_each(|bit| self.feature_changed(id, key::state(bit)));
    }

    pub(crate) fn text_changed_in(&mut self, parent: NodeId) {
        if let Some(accessibility) = &mut self.accessibility {
            accessibility.contents_changed(parent);
        }
        if self.has_auto_direction && !self.tree.ancestry.has(parent, Fact::Undirecting) {
            self.directions_may_change(parent);
        }
    }

    fn directions_may_change(&mut self, parent: NodeId) {
        let (mut at, mut path, mut directs) =
            (parent, smallvec::SmallVec::<[NodeId; 64]>::new(), false);
        while at != 0 && !self.tree.ancestry.has(at, Fact::Undirecting) {
            path.push(at);
            directs |= [at, self.tree[at].slot]
                .into_iter()
                .any(|it| self.tree[it].has(Flags::AUTO_DIRECTION));
            if self.tree[at].has(Flags::AUTO_DIRECTION) {
                self.stale_directions.insert(at);
            }
            if self
                .tree
                .element(at)
                .is_some_and(Element::isolates_direction)
            {
                break;
            }
            self.slot_changed(self.tree[at].slot);
            let host = self.tree.host_of(at);
            at = if is_name!(self.tree.html_tag(host), "input" | "textarea") {
                host
            } else {
                self.tree[at].parent
            };
        }
        if !directs && self.tree.is_rendered(parent) {
            self.tree.ancestry.note(&path, Fact::Undirecting);
        }
    }

    pub(crate) fn slot_changed(&mut self, slot: NodeId) {
        if slot != 0 && self.tree[slot].has(Flags::AUTO_DIRECTION) {
            self.stale_directions.insert(slot);
        }
    }

    pub(crate) fn update_directions(&mut self) {
        while !self.stale_directions.is_empty() {
            for id in core::mem::take(&mut self.stale_directions) {
                self.update_derived_state(id, false);
            }
        }
    }
}
