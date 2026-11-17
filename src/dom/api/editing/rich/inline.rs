//! https://w3c.github.io/editing/docs/execCommand/#inline-formatting-commands

use bun_core::strings;

use super::looks::{host_of, is_editable, share_host};
use super::tags::{is_allowed_in_tag, is_break, is_formatting, is_modifiable_tag, is_replaced};
use super::*;
use crate::types::Display;

type Value = Option<String>;
pub(super) type Formats = Vec<(Format, Override)>;

const SIZES: [(&str, u32); 7] = [
    ("x-small", 10),
    ("small", 13),
    ("medium", 16),
    ("large", 18),
    ("x-large", 24),
    ("xx-large", 32),
    ("xxx-large", 48),
];
const TOGGLES: [Format; 6] = [
    Format::Bold,
    Format::Italic,
    Format::Strikethrough,
    Format::Subscript,
    Format::Superscript,
    Format::Underline,
];
const VALUED: [Format; 4] = [
    Format::FontName,
    Format::FontSize,
    Format::Color,
    Format::Background,
];
const RECORDED: [Format; 9] = [
    Format::Subscript,
    Format::Bold,
    Format::FontName,
    Format::FontSize,
    Format::Color,
    Format::Background,
    Format::Italic,
    Format::Strikethrough,
    Format::Underline,
];

/// 0xRRGGBBAA
fn parse_color(text: &str) -> Option<u32> {
    if text.eq_ignore_ascii_case("currentcolor") {
        None
    } else {
        crate::bindings::parse_rgba(text.as_bytes(), 0xff)
    }
}

fn simple_color(text: &str) -> Value {
    parse_color(text)
        .filter(|it| it & 255 == 255)
        .map(|it| format!("#{:06x}", it >> 8))
}

fn color_argument(value: &str) -> Value {
    if matches!(value.len(), 3 | 6) && value.bytes().all(|it| it.is_ascii_hexdigit()) {
        return Some(format!("#{value}"));
    }
    let is_function = ["rgb(", "rgba(", "hsl(", "hsla("]
        .iter()
        .any(|it| value.starts_with(it))
        && value.ends_with(')');
    (is_function || parse_color(value).is_some()).then(|| value.into())
}

fn leading_digits(text: &str) -> (i64, &str) {
    let count = text.bytes().take_while(u8::is_ascii_digit).count();
    (
        text[..count].bytes().fold(0, |all: i64, it| {
            all.saturating_mul(10).saturating_add((it - b'0').into())
        }),
        &text[count..],
    )
}

fn size_with_number(number: i64) -> &'static str {
    SIZES[number.clamp(1, 7) as usize - 1].0
}

fn size_keyword(value: &str) -> Option<&'static str> {
    let value = value.trim();
    let digits = value.strip_prefix(['+', '-']).unwrap_or(value);
    let (number, rest) = leading_digits(digits);
    (rest.len() < digits.len()).then(|| {
        size_with_number(match value.as_bytes()[0] {
            b'+' => number.saturating_add(3),
            b'-' => 3 - number,
            _ => number,
        })
    })
}

fn index_of_size(keyword: &str) -> Option<usize> {
    SIZES.iter().position(|it| it.0 == keyword)
}

fn legacy_size(size: &str) -> String {
    let nearest = || {
        let pixels = leading_digits(size).0;
        SIZES
            .array_windows()
            .take_while(|[a, b]| pixels * 2 >= (a.1 + b.1).into())
            .count()
    };
    (index_of_size(
        size_keyword(size)
            .filter(|_| !size.ends_with("px"))
            .unwrap_or(size),
    )
    .unwrap_or_else(nearest)
        + 1)
    .to_string()
}

fn includes(text: &str, part: &str) -> bool {
    strings::contains(text.as_bytes(), part.as_bytes())
}

pub(super) fn is_anchor(node: &Node) -> bool {
    node.is_html(atom!("a")) && has_attr(node, atom!("href"))
}

fn attr(node: &Node, name: Known) -> Value {
    node.as_element()?.with_attr(name, str::to_owned)
}

pub(super) fn is_modifiable(node: &Node) -> bool {
    is_modifiable_tag(node)
        && has_only_attributes(node, |name| match (node.html_tag(), name) {
            (_, atom!("style")) | (atom!("a"), atom!("href")) => true,
            (tag, name) => {
                tag == atom!("font")
                    && matches!(name, atom!("color") | atom!("face") | atom!("size"))
            }
        })
}

impl Format {
    fn property(self) -> Option<&'static str> {
        Some(match self {
            Format::Bold => "font-weight",
            Format::Italic => "font-style",
            Format::Background => "background-color",
            Format::Color => "color",
            Format::FontName => "font-family",
            Format::FontSize => "font-size",
            _ => return None,
        })
    }

    /// The values with which it is on.
    fn active_values(self) -> &'static [&'static str] {
        match self {
            Format::Bold => &["bold", "600", "700", "800", "900"],
            Format::Italic => &["italic", "oblique"],
            Format::Strikethrough => &["line-through"],
            Format::Underline => &["underline"],
            Format::Subscript => &["subscript"],
            Format::Superscript => &["superscript"],
            _ => &[],
        }
    }

    fn is_on(self, value: Option<&str>) -> bool {
        value.is_some_and(|it| self.active_values().contains(&it))
    }

    /// The value of `text-decoration-line`.
    fn line(self) -> Option<&'static str> {
        matches!(self, Format::Strikethrough | Format::Underline).then(|| self.active_values()[0])
    }

    fn is_script(self) -> bool {
        matches!(self, Format::Subscript | Format::Superscript)
    }

    fn font_attribute(self) -> Option<Known> {
        Some(match self {
            Format::Color => atom!("color"),
            Format::FontName => atom!("face"),
            Format::FontSize => atom!("size"),
            _ => return None,
        })
    }

    fn are_equivalent(self, a: Option<&str>, b: Option<&str>) -> bool {
        let weight = |it| match it {
            "bold" => "700",
            "normal" => "400",
            _ => it,
        };
        a == b
            || a.zip(b).is_some_and(|(a, b)| match self {
                Format::Bold => weight(a) == weight(b),
                Format::Background | Format::Color => parse_color(a) == parse_color(b),
                _ => false,
            })
    }

    fn are_loosely_equivalent(self, a: Option<&str>, b: Option<&str>) -> bool {
        let is_in_pixels = |pixels: &str, keyword| {
            index_of_size(keyword).is_some_and(|it| pixels == format!("{}px", SIZES[it].1))
        };
        self.are_equivalent(a, b)
            || self == Format::FontSize
                && a.zip(b)
                    .is_some_and(|(a, b)| is_in_pixels(a, b) || is_in_pixels(b, a))
    }
}

impl<'a> Editor<'_, 'a> {
    fn overrides(&self) -> core::cell::RefMut<'a, Formats> {
        let (start, end, settings) = (self.start(), self.end(), self.settings());
        let mut all = settings.overrides.borrow_mut();
        let offsets = [start.offset, end.offset];
        if settings.offsets.replace(offsets) != offsets
            || self.ui.overrides_start() != Some(start.node)
            || self.ui.overrides_end() != Some(end.node)
        {
            all.clear();
            self.ui.set_overrides_start(Some(start.node));
            self.ui.set_overrides_end(Some(end.node));
        }
        all
    }

    fn override_of(&self, format: Format) -> Option<Override> {
        self.overrides()
            .iter()
            .find(|it| it.0 == format)
            .map(|it| it.1.clone())
    }

    fn set_override(&self, format: Format, value: Option<Override>) {
        let mut all = self.overrides();
        all.retain(|it| it.0 != format);
        all.extend(value.map(|it| (format, it)));
    }

    fn decoration_of(&self, node: &'a Node) -> String {
        Some(self.inline_style(node, "text-decoration"))
            .filter(|it| !it.is_empty())
            .unwrap_or_else(|| self.inline_style(node, "text-decoration-line"))
    }

    fn is_simply_modifiable(&self, node: &'a Node) -> bool {
        if !is_modifiable(node) || attribute_count(node) > 1 {
            return false;
        }
        let properties = self.styled_properties(node);
        let [property] = &properties[..] else {
            return properties.is_empty();
        };
        match (node.html_tag(), &**property) {
            (tag, "text-decoration") => {
                matches!(
                    tag,
                    atom!("a")
                        | atom!("font")
                        | atom!("s")
                        | atom!("span")
                        | atom!("strike")
                        | atom!("u")
                ) && matches!(
                    &*self.decoration_of(node),
                    "line-through" | "underline" | "overline" | "none"
                )
            }
            (atom!("b") | atom!("strong"), property) => property == "font-weight",
            (atom!("i") | atom!("em"), property) => property == "font-style",
            (tag, _) => matches!(tag, atom!("a") | atom!("font") | atom!("span")),
        }
    }

    pub(super) fn is_formattable(&self, node: &'a Node) -> bool {
        (node.is_text() || is_break(node) || node.is_html(atom!("img")))
            && is_editable(node)
            && self.is_visible(node)
            && !node.ancestors().any(is_replaced)
    }

    pub(super) fn formattable(&self) -> Nodes<'a> {
        self.selected(&|it| self.is_formattable(it))
    }

    fn effective_value(&self, node: &'a Node, format: Format) -> Value {
        let element = element_at(node)?;
        let mut above = element.inclusive_ancestors().map_while(Node::as_element);
        match format {
            Format::Link => attr(above.find(|it| is_anchor(it))?, atom!("href")),
            Format::Background => {
                const TRANSPARENT: &str = "rgba(0, 0, 0, 0)";
                Some(
                    above
                        .map(|it| self.computed(it, "background-color"))
                        .find(|it| it != TRANSPARENT)
                        .unwrap_or_else(|| TRANSPARENT.into()),
                )
            }
            Format::Subscript | Format::Superscript => {
                let has = |tag| {
                    above
                        .clone()
                        .take_while(|it| self.is_inline(it))
                        .any(|it| it.is_html(tag))
                };
                match (has(atom!("sub")), has(atom!("sup"))) {
                    (true, true) => Some("mixed".into()),
                    (true, false) => Some("subscript".into()),
                    (false, true) => Some("superscript".into()),
                    (false, false) => None,
                }
            }
            _ => match format.line() {
                Some(line) => above
                    .any(|it| includes(&self.computed(it, "text-decoration-line"), line))
                    .then(|| line.into()),
                None => Some(self.computed(element, format.property()?)),
            },
        }
    }

    fn specified_value(&self, element: &'a Node, format: Format) -> Value {
        let tag = element.html_tag();
        match format {
            Format::Background if self.display(element) != Some(Display::Inline) => return None,
            Format::Link => return attr(element, atom!("href")).filter(|_| tag == atom!("a")),
            Format::Subscript | Format::Superscript => {
                return match tag {
                    atom!("sup") => Some("superscript".into()),
                    atom!("sub") => Some("subscript".into()),
                    _ => None,
                };
            }
            _ => {}
        }
        if let Some(line) = format.line() {
            let declared = self.decoration_of(element);
            let has_it = match () {
                () if !declared.is_empty() => includes(&declared, line),
                () if format == Format::Underline => tag == atom!("u"),
                () => matches!(tag, atom!("s") | atom!("strike")),
            };
            return has_it.then(|| line.into());
        }
        let declared = self.inline_style(element, format.property()?);
        if !declared.is_empty() {
            return Some(declared);
        }
        match (format, tag) {
            (Format::FontSize, atom!("font")) => element
                .integer(atom!("size"))
                .map(|it| size_with_number(it.into()).into()),
            (_, atom!("font")) => attr(element, format.font_attribute()?),
            (Format::Bold, atom!("b") | atom!("strong")) => Some("bold".into()),
            (Format::Italic, atom!("i") | atom!("em")) => Some("italic".into()),
            _ => None,
        }
    }

    fn nearest_specified_value(&self, node: &'a Node, format: Format) -> Value {
        element_at(node)?
            .inclusive_ancestors()
            .take_while(|it| it.is_element())
            .find_map(|it| self.specified_value(it, format))
    }

    fn sets_only(&self, node: &'a Node, format: Format, value: Option<&str>) -> bool {
        self.is_simply_modifiable(node)
            && format.are_equivalent(self.specified_value(node, format).as_deref(), value)
    }

    fn has(&self, node: &'a Node, format: Format, value: Option<&str>) -> bool {
        format.are_loosely_equivalent(self.effective_value(node, format).as_deref(), value)
            || format == Format::FontSize
                && value.is_some()
                && element_at(node)
                    .and_then(|it| self.specified_value(it, format))
                    .as_deref()
                    == value
    }

    fn overrides_value(&self, node: &'a Node, format: Format, value: Option<&str>) -> bool {
        node.is_element()
            && self
                .specified_value(node, format)
                .is_some_and(|it| !format.are_equivalent(value, Some(&it)))
    }

    fn reorder_modifiable_descendants(
        &self,
        node: Maybe<'a>,
        format: Format,
        value: Option<&str>,
    ) -> Step {
        let Some(outer) = node.filter(|it| !(is_anchor(it) && has_attr(it, atom!("style")))) else {
            return Ok(());
        };
        let mut candidate = outer;
        while let Some(only) = candidate
            .first_child()
            .filter(|it| is_only_child(it) && is_modifiable(it))
            && is_modifiable(candidate)
            && !self.sets_only(candidate, format, value)
        {
            candidate = only;
        }
        if candidate == outer
            || !self.sets_only(candidate, format, value)
            || !self.has(candidate, format, value)
        {
            return Ok(());
        }
        self.move_children_out(candidate)?;
        self.insert_after(candidate, outer)?;
        self.move_to_end(outer, candidate)
    }

    /// `nodes` look the same after `change` has moved them.
    pub(super) fn keeping_values(&self, nodes: &[&'a Node], change: impl FnOnce() -> Step) -> Step {
        self.keeping_own_values(nodes, true, change)
    }

    /// `rejects_new`: they do not take on what is set where they go either.
    pub(super) fn keeping_own_values(
        &self,
        nodes: &[&'a Node],
        rejects_new: bool,
        change: impl FnOnce() -> Step,
    ) -> Step {
        let values: Vec<_> = nodes
            .iter()
            .map(|node| RECORDED.map(|it| self.nearest_specified_value(node, it)))
            .collect();
        change()?;
        for (node, values) in nodes.iter().zip(values) {
            for (format, value) in RECORDED.into_iter().zip(values) {
                let now = self.nearest_specified_value(node, format);
                if value.is_none() && now.is_some() {
                    if rejects_new {
                        self.push_down_values(node, format, None)?;
                    }
                } else if !format.are_equivalent(now.as_deref(), value.as_deref()) {
                    self.force_value(node, format, value.as_deref(), None)?;
                }
            }
        }
        Ok(())
    }

    fn clear_value(&self, element: &'a Node, format: Format) -> Step {
        if !is_editable(element) || self.specified_value(element, format).is_none() {
            return Ok(());
        }
        if self.is_simply_modifiable(element) {
            return self.unwrap(element);
        }
        if let Some(line) = format.line()
            && let declared = self.decoration_of(element)
            && let Some(index) = strings::index_of(declared.as_bytes(), line.as_bytes())
        {
            let property = if self.inline_style(element, "text-decoration").is_empty() {
                "text-decoration-line"
            } else {
                "text-decoration"
            };
            self.set_style(
                element,
                property,
                [&declared[..index], &declared[index + line.len()..]]
                    .concat()
                    .trim(),
            )?;
        }
        if let Some(property) = format.property() {
            self.set_style(element, property, "")?;
        }
        match (element.html_tag(), format.font_attribute()) {
            (atom!("font"), Some(name)) => self.set_attribute(element, name, None)?,
            (atom!("a"), _) if format == Format::Link => {
                self.set_attribute(element, atom!("href"), None)?
            }
            _ => {}
        }
        if self.specified_value(element, format).is_some() {
            self.rename(element, atom!("span"))?;
        }
        Ok(())
    }

    fn push_down_values(&self, node: &'a Node, format: Format, value: Option<&str>) -> Step {
        let is_by_attribute = |it: &'a Node| {
            format == Format::Color
                && value.is_some()
                && self.settings().uses_css.get()
                && has_attr(it, atom!("color"))
                && it.is_html(atom!("font"))
        };
        if let Some(font) = node.parent().filter(|it| {
            is_by_attribute(it)
                && is_editable(it)
                && attribute_count(it) == 1
                && !self.is_effectively_contained(it)
        }) {
            return self.split_parent(&[node]).map(|_| ()).and_then(|()| {
                if font.first_child().is_none() {
                    self.remove(font)
                } else {
                    Ok(())
                }
            });
        }
        if node.parent_element().is_none() || self.has(node, format, value) {
            return Ok(());
        }
        let mut path = self.keep(
            node.ancestors()
                .take_while(|it| is_editable(it) && !self.has(it, format, value)),
        );
        let Some(&top) = path.last() else {
            return Ok(());
        };
        let (mut propagated, mut model) = (self.specified_value(top, format), None);
        if value.is_some() && (propagated.is_none() || !self.has(parent(top)?, format, value)) {
            return Ok(());
        }
        while let Some(ancestor) = path.pop() {
            if let Some(own) = self.specified_value(ancestor, format) {
                (propagated, model) = (
                    Some(own),
                    (attribute_count(ancestor) == 0).then_some(ancestor),
                );
            }
            let inside = self.children(ancestor);
            self.clear_value(ancestor, format)?;
            for it in inside
                .into_iter()
                .filter(|it| *it != node && Some(it) != path.last())
            {
                if !self.overrides_value(it, format, propagated.as_deref()) {
                    self.force_value(it, format, propagated.as_deref(), model)?;
                }
            }
        }
        Ok(())
    }

    fn force_on_children(&self, node: &'a Node, format: Format, value: Option<&str>) -> Step {
        self.keep(
            self.inside(node)
                .filter(|it| !self.overrides_value(it, format, value)),
        )
        .into_iter()
        .try_for_each(|it| self.force_value(it, format, value, None))
    }

    /// The tag, and the value of the attribute that goes with `format`.
    fn markup_for(&self, format: Format, value: &str) -> (Known, Value) {
        match format {
            Format::Link => (atom!("a"), Some(value.into())),
            Format::Subscript | Format::Superscript if value == "subscript" => (atom!("sub"), None),
            Format::Subscript | Format::Superscript if value == "superscript" => {
                (atom!("sup"), None)
            }
            _ if self.settings().uses_css.get() => (atom!("span"), None),
            Format::FontSize if let Some(index) = index_of_size(value) => {
                (atom!("font"), Some((index + 1).to_string()))
            }
            Format::Bold if format.are_equivalent(Some(value), Some("bold")) => (atom!("b"), None),
            Format::Italic if value == "italic" => (atom!("i"), None),
            Format::Strikethrough => (atom!("strike"), None),
            Format::Underline => (atom!("u"), None),
            Format::Color if let Some(color) = simple_color(value) => (atom!("font"), Some(color)),
            Format::FontName => (atom!("font"), Some(value.into())),
            _ => (atom!("span"), None),
        }
    }

    /// `model` is an element that has the value.
    fn force_value(
        &self,
        node: &'a Node,
        format: Format,
        value: Option<&str>,
        model: Maybe<'a>,
    ) -> Step {
        let Some(text) = value.filter(|_| node.parent().is_some()) else {
            return Ok(());
        };
        let (tag, attribute) =
            model.map_or_else(|| self.markup_for(format, text), |it| (it.html_tag(), None));
        if is_allowed_in_tag(node, atom!("span")) {
            self.reorder_modifiable_descendants(node.previous_sibling(), format, value)?;
            self.reorder_modifiable_descendants(node.next_sibling(), format, value)?;
            self.wrap(
                vec![node],
                &|it| {
                    it.is_html(tag)
                        && self.sets_only(it, format, value)
                        && self.has(it, format, value)
                },
                &|| Ok(None),
            )?;
        }
        if !self.is_visible(node) || self.has(node, format, value) {
            return Ok(());
        }
        if !is_allowed_in_tag(node, atom!("span")) {
            return self.force_on_children(node, format, value);
        }
        if format == Format::Link {
            for link in self.keep(node.ancestors().filter(|it| it.is_html(atom!("a")))) {
                self.rename(link, atom!("span"))?;
            }
        }
        let wrapper = match (model, attribute) {
            (Some(model), _) => self.copy(model)?,
            (None, Some(it)) => {
                self.create_with(tag, format.font_attribute().unwrap_or(atom!("href")), &it)?
            }
            (None, None) => self.create(tag),
        };
        self.insert(wrapper, parent(node)?, Some(node))?;
        if let Some(property) = format
            .line()
            .map(|_| "text-decoration-line")
            .or_else(|| format.property())
            && !self.has(wrapper, format, value)
        {
            self.set_style(wrapper, property, text)?;
        }
        self.move_to_end(node, wrapper)?;
        if node.is_element()
            && !format.are_equivalent(self.effective_value(node, format).as_deref(), value)
        {
            self.unwrap(wrapper)?;
            self.force_on_children(node, format, value)?;
        }
        Ok(())
    }

    fn split_text_at_ends(&self) -> Step {
        let is_inside = |it: Point<'a>| {
            it.node.is_text() && it.offset > 0 && !is_at_end(it) && is_editable(it.node)
        };
        if is_inside(self.start()) {
            let rest = self.split_text(self.start())?;
            self.select(at(rest, 0), self.end());
        }
        if is_inside(self.end()) {
            self.split_text(self.end())?;
        }
        Ok(())
    }

    /// The property in the `style` attribute that says something about the same thing.
    fn rival_property(&self, element: &'a Node, format: Format) -> Option<&'static str> {
        let property = match format {
            Format::Color | Format::FontName | Format::FontSize => format.property()?,
            Format::Subscript | Format::Superscript => "vertical-align",
            Format::Strikethrough | Format::Underline => {
                return (!self.decoration_of(element).is_empty()).then_some("text-decoration");
            }
            _ => return None,
        };
        (!self.inline_style(element, property).is_empty()).then_some(property)
    }

    /// So that what is selected of it is an element of its own.
    fn split_rivals(&self, format: Format, value: Option<&str>) -> Step {
        let has_attribute = |it: &'a Node| {
            it.is_html(atom!("font"))
                && format
                    .font_attribute()
                    .is_some_and(|name| has_attr(it, name))
        };
        let is_other = |it: &'a Node| {
            (self.rival_property(it, format).is_some() || has_attribute(it))
                && (format.is_toggle() || !self.has(it, format, value))
        };
        let rival = |text: &'a Node| {
            text.parent().filter(|it| {
                text.is_text() && is_editable(it) && self.is_inline(it) && is_other(it)
            })
        };
        let (start, end) = (self.start(), self.end());
        let firsts = [
            Some(start.node).filter(|it| start.offset == 0 && it.previous_sibling().is_some()),
            end.node.next_sibling().filter(|_| is_at_end(end)),
        ];
        for (text, first) in [start.node, end.node].into_iter().zip(firsts) {
            let Some((rival, first)) = rival(text).zip(first) else {
                continue;
            };
            let copy = self.copy(rival)?;
            self.set_attribute(rival, atom!("id"), None)?;
            self.insert(copy, parent(rival)?, Some(rival))?;
            while first.previous_sibling().is_some() {
                self.move_to_end(rival.first_child().ok_or(Stuck)?, copy)?;
            }
        }
        Ok(())
    }

    /// The lines of a selected element that has them in its `style` attribute are drawn anew.
    fn redecorate(&self, element: &'a Node, format: Format, value: Option<&str>) -> Step<bool> {
        let (declared, Some(line)) = (self.decoration_of(element), format.line()) else {
            return Ok(false);
        };
        if declared.is_empty()
            || !matches!(
                element.html_tag(),
                atom!("s") | atom!("span") | atom!("strike") | atom!("u")
            )
            || !self.is_simply_styled(element)
        {
            return Ok(false);
        }
        let has = |it: &&str| {
            if *it == line {
                value.is_some()
            } else {
                includes(&declared, it)
            }
        };
        let (lines, inside): (Vec<_>, _) = (
            ["underline", "overline", "line-through"]
                .into_iter()
                .filter(has)
                .collect(),
            self.children(element),
        );
        let by_style: Vec<_> = lines
            .iter()
            .copied()
            .filter(|it| self.settings().uses_css.get() || *it == "overline")
            .collect();
        let mut innermost = self.rename(element, atom!("span"))?;
        self.set_style(innermost, "text-decoration", "")?;
        self.set_style(innermost, "text-decoration-line", &by_style.join(" "))?;
        let span = innermost;
        for tag in lines.iter().filter(|it| !by_style.contains(it)).map(|it| {
            if *it == "underline" {
                atom!("u")
            } else {
                atom!("strike")
            }
        }) {
            let made = self.create(tag);
            self.insert(made, innermost, None)?;
            inside
                .iter()
                .try_for_each(|it| self.move_to_end(it, made))?;
            innermost = made;
        }
        if attribute_count(span) == 0 {
            self.unwrap(span)?;
        }
        Ok(true)
    }

    fn is_simply_styled(&self, element: &'a Node) -> bool {
        attribute_count(element) == 1 && self.styled_properties(element).len() == 1
    }

    /// If that takes no other kind of element.
    fn set_own_value(&self, element: &'a Node, format: Format, value: &str) -> Step {
        match (self.markup_for(format, value), element.html_tag()) {
            ((atom!("font"), attribute), atom!("font")) => self.set_attribute(
                element,
                format.font_attribute().ok_or(Stuck)?,
                attribute.as_deref(),
            ),
            ((atom!("span"), _), _) if let Some(property) = format.property() => {
                self.set_style(element, property, value)
            }
            ((atom!("span"), _), atom!("span")) if format.line().is_some() => self.set_style(
                element,
                "text-decoration-line",
                &format!("{} {value}", self.decoration_of(element)),
            ),
            _ => Ok(()),
        }
    }

    fn set_selection_value(&self, format: Format, value: Option<&str>) -> Step {
        if self.formattable().is_empty() {
            if format.is_script() {
                self.set_override(
                    if format == Format::Subscript {
                        Format::Superscript
                    } else {
                        Format::Subscript
                    },
                    None,
                );
            }
            let wanted = if format.is_toggle() {
                Some(Override::State(format.is_on(value)))
            } else {
                value.map(|it| Override::Value(it.into()))
            };
            self.set_override(format, wanted);
            return Ok(());
        }
        self.split_text_at_ends()?;
        self.split_rivals(format, value)?;
        for element in self.selected(&|it| it.is_element() && is_editable(it)) {
            if format.is_script()
                && self.rival_property(element, format).is_some()
                && self.is_inline(element)
            {
                self.set_style(element, "vertical-align", "")?;
                if element.is_html(atom!("span")) && attribute_count(element) == 0 {
                    self.unwrap(element)?;
                }
            } else if !self.redecorate(element, format, value)? {
                self.clear_value(element, format)?;
            }
        }
        let nodes = self.selected(&is_editable);
        let is_selected = |it: Maybe<'a>| {
            it.is_some_and(|it| is_editable(it) && self.is_effectively_contained(it))
        };
        let alone: Vec<_> = nodes
            .iter()
            .map(|it| {
                it.first_child().is_some()
                    && !is_selected(it.previous_sibling())
                    && !is_selected(it.next_sibling())
            })
            .collect();
        for (node, is_alone) in nodes.into_iter().zip(alone) {
            self.push_down_values(node, format, value)?;
            match value {
                _ if !is_allowed_in_tag(node, atom!("span")) => {}
                _ if !is_alone => self.force_value(node, format, value, None)?,
                Some(text) if !self.has(node, format, value) => {
                    self.set_own_value(node, format, text)?
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn first_value(&self, format: Format) -> Value {
        self.effective_value(
            self.formattable()
                .first()
                .copied()
                .unwrap_or_else(|| self.start().node),
            format,
        )
    }

    pub(super) fn state_of(&self, format: Format) -> bool {
        if let Some(Override::State(is_on)) = self.override_of(format) {
            return is_on;
        }
        let nodes = self.formattable();
        let is_on = |it| format.is_on(self.effective_value(it, format).as_deref());
        if nodes.is_empty() {
            is_on(self.start().node)
        } else {
            nodes.into_iter().all(is_on)
        }
    }

    fn selected_value(&self, format: Format) -> String {
        let value = self.first_value(format);
        if format == Format::FontSize {
            legacy_size(value.as_deref().unwrap_or("medium"))
        } else {
            value.unwrap_or_default()
        }
    }

    pub(super) fn value_of(&self, format: Format) -> String {
        match self.override_of(format) {
            Some(Override::Value(value)) if format == Format::FontSize => legacy_size(&value),
            Some(Override::Value(value)) => value,
            _ => self.selected_value(format),
        }
    }

    pub(super) fn is_indeterminate(&self, format: Format) -> bool {
        let values: Vec<_> = self
            .formattable()
            .into_iter()
            .map(|it| self.effective_value(it, format))
            .collect();
        match format {
            _ if !format.is_toggle() => false,
            _ => {
                differ(values.iter().map(|it| format.is_on(it.as_deref())))
                    || values.iter().any(|it| it.as_deref() == Some("mixed"))
            }
        }
    }

    fn toggle(&self, format: Format, was_on: bool) -> Step {
        if was_on || format.is_script() {
            self.set_selection_value(format, format.property().map(|_| "normal"))?;
        }
        if was_on {
            Ok(())
        } else {
            self.set_selection_value(format, Some(format.active_values()[0]))
        }
    }

    pub(super) fn apply(&self, format: Format, value: &str) -> Step<bool> {
        let parsed = match format {
            Format::Background | Format::Color => color_argument(value),
            Format::FontSize => size_keyword(value).map(str::to_owned),
            Format::FontName => Some(value.into()),
            Format::Link if value.is_empty() => None,
            Format::Link => {
                for node in self.selected(&|_| true) {
                    node.ancestors()
                        .filter(|it| is_anchor(it) && is_editable(it))
                        .try_for_each(|it| self.set_attribute(it, atom!("href"), Some(value)))?;
                }
                Some(value.into())
            }
            _ => {
                let first = self
                    .formattable()
                    .first()
                    .copied()
                    .filter(|_| format == Format::Strikethrough);
                let was_on = first.map_or_else(
                    || self.state_of(format),
                    |it| format.is_on(self.effective_value(it, format).as_deref()),
                );
                return self.toggle(format, was_on).map(|()| true);
            }
        };
        match parsed {
            Some(value) => self
                .set_selection_value(format, Some(&value))
                .map(|()| true),
            None => Ok(matches!(format, Format::Background | Format::Color)),
        }
    }

    pub(super) fn unlink(&self) -> Step {
        let (start, end) = (self.start(), self.end());
        let is_link = |it: &'a Node| is_anchor(it) && is_editable(it);
        let mut links = self.keep(start.node.inclusive_ancestors().filter(|it| is_link(it)));
        links.reverse();
        let is_reached = |it: &'a Node| {
            it != start.node
                && is_link(it)
                && (is_contained(it, start, end) || it.contains(end.node))
        };
        links.extend(self.collect(
            Some(start.node),
            end.node.following_skip(None),
            &is_reached,
            false,
        ));
        links
            .into_iter()
            .try_for_each(|link| self.keeping_values(&self.children(link), || self.unwrap(link)))
    }

    pub(super) fn remove_format(&self) -> Step {
        let is_candidate = |it: &'a Node| is_formatting(it) && is_editable(it);
        self.selected(&is_candidate)
            .into_iter()
            .try_for_each(|it| self.unwrap(it))?;
        self.split_text_at_ends()?;
        for node in self.selected(&is_editable) {
            while node
                .parent()
                .is_some_and(|it| is_candidate(it) && share_host(it, node))
                && self.split_parent(&[node])?
            {}
        }
        RECORDED
            .into_iter()
            .try_for_each(|it| self.set_selection_value(it, None))?;
        let is_inner_host = |it: &'a Node| it.parent().is_some_and(|it| host_of(it).is_some());
        for element in self.selected(&|it| has_attr(it, atom!("style")) && is_inner_host(it)) {
            let properties = ["background-color", "color", "text-align"];
            properties
                .into_iter()
                .try_for_each(|it| self.set_style(element, it, ""))?;
            if !has_attr(element, atom!("style")) {
                self.set_attribute(element, atom!("style"), Some(""))?;
            }
        }
        Ok(())
    }

    /// What is on at `node` because of what is between it and `outer`.
    pub(super) fn toggles_inside(&self, outer: &'a Node, node: &'a Node) -> Formats {
        let is_on = |format: &Format| {
            node.ancestors()
                .take_while(|it| *it != outer)
                .any(|it| format.is_on(self.specified_value(it, *format).as_deref()))
        };
        TOGGLES
            .into_iter()
            .filter(is_on)
            .map(|it| (it, Override::State(true)))
            .collect()
    }

    pub(super) fn selected_formats(&self) -> Formats {
        let Some(&node) = self
            .formattable()
            .first()
            .filter(|it| !it.is_html(atom!("img")))
        else {
            return Vec::new();
        };
        let is_in_link = self.effective_value(node, Format::Link).is_some();
        let is_of_link = |it| {
            is_in_link
                && matches!(it, Format::Underline | Format::Color)
                && self.nearest_specified_value(node, it).is_none()
        };
        let states = TOGGLES.map(|it| {
            (
                it,
                Override::State(it.is_on(self.effective_value(node, it).as_deref())),
            )
        });
        let values = VALUED.map(|it| (it, Override::Value(self.selected_value(it))));
        let size = self
            .effective_value(node, Format::FontSize)
            .map(|it| (Format::FontSize, Override::Value(it)));
        let is_script = self.effective_value(node, Format::Subscript).is_some();
        states
            .into_iter()
            .chain(values)
            .chain(size)
            .filter(|it| !is_of_link(it.0) && !(is_script && it.0 == Format::FontSize))
            .collect()
    }

    pub(super) fn current_overrides(&self) -> Formats {
        if self.overrides().is_empty() {
            return Vec::new();
        }
        [Format::Link]
            .into_iter()
            .chain(TOGGLES)
            .chain(VALUED)
            .filter_map(|it| Some((it, self.override_of(it)?)))
            .collect()
    }

    pub(super) fn restore_formats(&self, formats: Formats) -> Step {
        if formats.is_empty() {
            return Ok(());
        }
        let Some(mut node) = self.formattable().first().copied() else {
            formats
                .into_iter()
                .for_each(|(format, value)| self.set_override(format, Some(value)));
            return Ok(());
        };
        for (format, value) in formats {
            match &value {
                Override::State(is_on) if self.state_of(format) != *is_on => {
                    self.toggle(format, !is_on)?
                }
                Override::State(_) => {}
                Override::Value(text) if matches!(format, Format::Link | Format::FontSize) => {
                    if self
                        .override_of(format)
                        .map_or_else(|| self.has(node, format, Some(text)), |it| it == value)
                    {
                        continue;
                    }
                    self.apply(
                        format,
                        &if format == Format::FontSize {
                            legacy_size(text)
                        } else {
                            text.clone()
                        },
                    )?;
                }
                Override::Value(text)
                    if !format.are_equivalent(Some(&self.value_of(format)), Some(text)) =>
                {
                    _ = self.apply(format, text)?
                }
                Override::Value(_) => {}
            }
            node = self.formattable().first().copied().unwrap_or(node);
        }
        Ok(())
    }
}
