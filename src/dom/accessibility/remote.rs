//! The tree of a page that another engine shows, from what the DevTools protocol says about it.

use super::build::{Output, has_presentational_children, is_activatable, span};
use crate::abi::Rect;
use crate::abi::accessibility::{
    self as abi, Number, Placement, Relation, RelationEntry, Role, Run, TREE_OF_IMAGE, Text,
};

#[derive(Default)]
pub(crate) struct Tree(Output);

pub(crate) struct Node<'a> {
    pub(crate) id: u32,
    pub(crate) container: u32,
    pub(crate) role: &'a str,
    /// The properties of the `AXNode`, and with an `@` the attributes of the element.
    pub(crate) properties: Vec<(&'a str, &'a str)>,
    pub(crate) relations: Vec<(&'a str, &'a [u32])>,
    pub(crate) children: &'a [u32],
    /// And how far it is scrolled.
    pub(crate) rect: [f64; 6],
    /// For each a length in UTF-16 code units and a rectangle.
    pub(crate) lines: &'a [[f64; 5]],
}

fn role_named(name: &str) -> Role {
    match name {
        "DisclosureTriangleGrouped" => Role::DisclosureTriangle,
        "IframePresentational" => Role::Iframe,
        "MathMLMath" => Role::Math,
        "MenuListOption" => Role::Option,
        "PluginObject" => Role::EmbeddedObject,
        "SvgRoot" => Role::Image,
        "none" => Role::Generic,
        _ => Role::named(name).unwrap_or_default(),
    }
}

fn states(name: &str, value: &str) -> u64 {
    let if_true = |state| if value == "true" { state } else { 0 };
    match (name, value) {
        ("atomic", _) => if_true(abi::LIVE_ATOMIC),
        ("busy", "1" | "true") => abi::BUSY,
        ("checked" | "pressed", "mixed") => abi::CHECKABLE | abi::MIXED,
        ("checked" | "pressed", _) => abi::CHECKABLE | if_true(abi::CHECKED),
        ("disabled", _) => if_true(abi::DISABLED),
        ("editable", "richtext") => abi::EDITABLE | abi::RICHLY_EDITABLE,
        ("editable", _) => abi::EDITABLE,
        ("expanded", "true") => abi::EXPANDED,
        ("expanded", _) => abi::COLLAPSED,
        ("focusable", _) => if_true(abi::FOCUSABLE),
        ("isBlock", _) => if_true(abi::BLOCK),
        ("isClickable", _) => if_true(abi::CLICKABLE),
        ("live", "assertive") => abi::LIVE_ASSERTIVE,
        ("live", "polite") => abi::LIVE_POLITE,
        ("live", _) => abi::LIVE_OFF,
        ("modal", _) => if_true(abi::MODAL),
        ("multiline", _) => if_true(abi::MULTILINE),
        ("multiselectable", _) => if_true(abi::MULTISELECTABLE),
        ("nameFrom", "contents") => abi::NAMED_BY_CONTENT,
        ("nameFrom", "relatedElement") => abi::NAMED_BY_RELATION,
        ("orientation", "horizontal") => abi::HORIZONTAL,
        ("orientation", "vertical") => abi::VERTICAL,
        ("readonly", _) => if_true(abi::READ_ONLY),
        ("required", _) => if_true(abi::REQUIRED),
        ("selected", _) => abi::SELECTABLE | if_true(abi::SELECTED),
        ("startsParagraph", _) => if_true(abi::STARTS_PARAGRAPH),
        ("@aria-describedby" | "@aria-description", _) => abi::DESCRIBED_BY_ARIA,
        _ => 0,
    }
}

fn text_named(name: &str) -> Option<Text> {
    Some(match name {
        "autocomplete" => Text::Autocomplete,
        "description" => Text::Description,
        "hasPopup" => Text::HasPopup,
        "invalid" => Text::Invalid,
        "keyshortcuts" => Text::KeyShortcuts,
        "name" => Text::Name,
        "relevant" => Text::LiveRelevant,
        "roledescription" => Text::RoleDescription,
        "url" => Text::Url,
        "valuetext" => Text::Value,
        "@accesskey" => Text::AccessKey,
        "@aria-colindex" => Text::ColumnIndex,
        "@aria-current" => Text::Current,
        "@aria-placeholder" | "@placeholder" => Text::Placeholder,
        "@aria-rowindex" => Text::RowIndex,
        "@aria-sort" => Text::Sort,
        "@class" => Text::DomClass,
        "@id" => Text::DomId,
        "@lang" => Text::Language,
        _ => return None,
    })
}

fn number_named(name: &str) -> Option<Number> {
    Some(match name {
        "level" => Number::Level,
        "valuemax" => Number::Max,
        "valuemin" => Number::Min,
        "@aria-colcount" => Number::ColumnCount,
        "@aria-colspan" | "@colspan" => Number::ColumnSpan,
        "@aria-posinset" => Number::PositionInSet,
        "@aria-rowcount" => Number::RowCount,
        "@aria-rowspan" | "@rowspan" => Number::RowSpan,
        "@aria-setsize" => Number::SetSize,
        _ => return None,
    })
}

fn relation_named(name: &str) -> Option<Relation> {
    Some(match name {
        "activedescendant" => Relation::ActiveDescendant,
        "controls" => Relation::Controls,
        "describedby" => Relation::DescribedBy,
        "details" => Relation::Details,
        "errormessage" => Relation::ErrorMessage,
        "flowto" => Relation::FlowTo,
        "labelledby" => Relation::LabelledBy,
        "owns" => Relation::Owns,
        _ => return None,
    })
}

fn from_utf16(text: &str, offset: u32) -> u32 {
    let mut units = 0;
    let is_before = |it: &char| {
        units += it.len_utf16() as u32;
        units <= offset
    };
    text.chars()
        .take_while(is_before)
        .map(|it| it.len_utf8() as u32)
        .sum()
}

impl Tree {
    /// The protocol does not say how wide characters are.
    fn lines(&mut self, name: &str, node: &Node) {
        let (mut start, mut last_top) = (0, None);
        for &[length, x, y, width, height] in node.lines {
            let piece = &name[start..][..from_utf16(&name[start..], length as u32) as usize];
            let rect =
                Rect::new([x - node.rect[0], y - node.rect[1], width, height].map(|it| it as f32));
            let starts_line =
                last_top.replace(y).is_some_and(|it| it != y) && !name[..start].ends_with('\n');
            self.0.runs.push(Run {
                start: start as u32,
                rect,
                is_rtl: false,
                is_vertical: false,
                starts_line,
            });
            let count = piece.chars().count();
            self.0
                .advances
                .extend(core::iter::repeat_n(rect.width / count as f32, count));
            start += piece.len();
        }
    }

    pub(crate) fn add(&mut self, node: &Node) {
        let (role, lengths) = (role_named(node.role), self.0.lengths());
        let property = |name| {
            node.properties
                .iter()
                .find(|it| it.0 == name)
                .map(|it| it.1)
        };
        let (tag, mut all) = (property("nodeName").unwrap_or_default(), 0);
        for &(name, value) in &node.properties {
            all |= states(name, value);
            if let Some(key) = text_named(name).filter(|it| {
                value != "false" || matches!(it, Text::Name | Text::Description | Text::DomId)
            }) {
                self.0.text(key, value);
            } else if let Some(key) = number_named(name) {
                self.0.number(key, value.parse().ok());
            }
        }
        let is_atomic = matches!(tag, "INPUT" | "TEXTAREA") && all & abi::EDITABLE != 0;
        let is_field = is_atomic
            || matches!(role, Role::Textbox | Role::Searchbox)
            || all & abi::EDITABLE != 0 && all & abi::FOCUSABLE != 0 && role != Role::Link;
        let flags = [
            (property("@role").is_none(), abi::IMPLICIT_ROLE),
            (is_atomic, abi::ATOMIC_FIELD),
            (is_field, abi::TEXT_FIELD),
            (is_field && role == Role::Generic, abi::MULTILINE),
            (
                is_atomic
                    && property("@type").is_some_and(|it| it.eq_ignore_ascii_case("password")),
                abi::PROTECTED,
            ),
            (is_activatable(role), abi::CLICKABLE),
            (
                has_presentational_children(role),
                abi::PRESENTATIONAL_CHILDREN,
            ),
            (tag == "SELECT" && role == Role::Combobox, abi::MENU_LIST),
            (role == Role::WebArea, abi::SCROLLS | abi::CLIPS),
        ];
        all |= flags
            .iter()
            .fold(0, |all, it| all | if it.0 { it.1 } else { 0 });
        match property("value").filter(|_| !is_field) {
            Some(value) if super::aria::is_range(role) => {
                self.0.number(Number::Now, value.parse().ok())
            }
            value => self.0.text(Text::Value, value.unwrap_or_default()),
        }
        self.0.text(Text::Tag, &tag.to_ascii_lowercase());
        if tag == "INPUT" {
            self.0
                .text(Text::InputType, property("@type").unwrap_or_default());
        }
        for (key, nodes) in node
            .relations
            .iter()
            .filter_map(|it| Some((relation_named(it.0)?, it.1)))
        {
            self.0
                .relations
                .extend(nodes.iter().map(|it| RelationEntry { key, node: *it }));
        }
        let starts = [
            self.0.children.len(),
            self.0.runs.len(),
            self.0.advances.len(),
        ];
        self.0.children.extend(node.children);
        self.lines(property("name").unwrap_or_default(), node);
        let out = &mut self.0;
        out.nodes.push(abi::Node {
            children: span(starts[0], out.children.len()),
            runs: span(starts[1], out.runs.len()),
            advances: span(starts[2], out.advances.len()),
            ..out.node(node.id, role, all, lengths)
        });
        let [x, y, width, height, left, top] = node.rect.map(|it| it as f32);
        out.placements.push(Placement {
            id: node.id,
            container: node.container,
            rect: Rect::new([x, y, width, height]),
            scroll: [left, top],
        });
    }

    /// The offsets of the points are in UTF-16 code units of `texts`.
    pub(crate) fn submit(
        &mut self,
        image: u32,
        zoom: f32,
        root: u32,
        focus: u32,
        points: [abi::Point; 2],
        texts: [&str; 2],
    ) {
        let [anchor, end] = [0, 1].map(|it| abi::Point {
            offset: from_utf16(texts[it], points[it].offset),
            ..points[it]
        });
        let selection = abi::Selection {
            anchor,
            focus: end,
            is_upstream: false,
        };
        let out = core::mem::take(&mut self.0);
        let update = abi::Update {
            is_complete: true,
            ..out.as_update(zoom, root, focus, selection)
        };
        if let Some(renderer) = crate::platform::renderer() {
            // SAFETY: `out` has what the slices point to.
            unsafe { (renderer.update_accessibility)(image | TREE_OF_IMAGE, &raw const update) };
        }
    }
}
