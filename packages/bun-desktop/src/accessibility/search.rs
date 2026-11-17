//! What the rotor of VoiceOver looks for.

use super::forest::{Forest, Id, Node};
use crate::abi::accessibility::{self as abi, Number, Role, Text};

pub struct Search<'a> {
    pub keys: Vec<&'a str>,
    pub start: Option<Id>,
    pub is_backwards: bool,
    pub limit: usize,
    pub text: &'a str,
    pub only_visible: bool,
    pub only_children: bool,
}

pub fn is_landmark(node: &Node) -> bool {
    use Role::*;
    matches!(
        node.role,
        Application | Banner | Complementary | ContentInfo | Main | Navigation | Region | Search
    ) || node.role == Form && !node.name().is_empty()
}

fn is_control(node: &Node) -> bool {
    use Role::*;
    node.has(abi::TEXT_FIELD)
        || matches!(
            node.role,
            Button
                | Checkbox
                | ColorWell
                | Combobox
                | Date
                | DateTime
                | DisclosureTriangle
                | InputTime
                | Listbox
                | Menu
                | Menubar
                | MenuItem
                | MenuItemCheckbox
                | MenuItemRadio
                | Radio
                | Scrollbar
                | Slider
                | SpinButton
                | Switch
                | Tab
                | Tree
                | TreeGrid
        )
}

fn takes_focus(node: &Node) -> bool {
    node.has(abi::FOCUSABLE) && !node.has(abi::DISABLED)
}

fn only_holds(node: &Node) -> bool {
    !node.has(abi::CLICKABLE | abi::TEXT_FIELD)
        || matches!(node.role, Role::Date | Role::DateTime | Role::InputTime)
}

pub fn is_link(node: &Node) -> bool {
    matches!(
        node.role,
        Role::Link | Role::DocBacklink | Role::DocBiblioRef | Role::DocGlossRef | Role::DocNoteRef
    )
}

impl Forest {
    pub fn depth_in(&self, id: Id, counts: impl Fn(&Node) -> bool) -> usize {
        std::iter::once(id)
            .chain(self.ancestors(id))
            .filter(|it| self.get(*it).is_some_and(&counts))
            .count()
    }

    fn matches(&self, id: Id, node: &Node, key: &str, start: Option<Id>) -> bool {
        const STYLES: u64 = abi::BOLD | abi::ITALIC | abi::UNDERLINED | abi::STRUCK;
        let from = start.and_then(|it| self.get(it));
        let is_quote = |it: &Node| it.role == Role::Blockquote;
        let is_text = node.role == Role::StaticText;
        let differs = |key| is_text && from.is_some_and(|it| it.number(key) != node.number(key));
        let has_other_font = || {
            differs(Number::FontSize)
                || is_text
                    && from
                        .is_some_and(|it| it.text(Text::FontFamily) != node.text(Text::FontFamily))
        };
        match key
            .strip_prefix("AX")
            .and_then(|it| it.strip_suffix("SearchKey"))
            .unwrap_or_default()
        {
            "AnyType" => true,
            "Article" => node.role == Role::Article,
            "Blockquote" => is_quote(node),
            "BlockquoteSameLevel" => {
                is_quote(node)
                    && start.is_some_and(|it| {
                        self.depth_in(it, is_quote) == self.depth_in(id, is_quote)
                    })
            }
            "BoldFont" => node.has(abi::BOLD),
            "Button" => node.role == Role::Button,
            "CheckBox" | "Checkbox" => matches!(
                node.role,
                Role::Checkbox | Role::MenuItemCheckbox | Role::Switch
            ),
            "Control" => {
                is_control(node) || node.role == Role::Separator && node.has(abi::FOCUSABLE)
            }
            "DifferentType" => from.is_some_and(|it| it.role != node.role),
            "FontChange" => has_other_font(),
            "FontColorChange" => differs(Number::Color),
            "Frame" => node.role == Role::WebArea,
            "Graphic" => matches!(
                node.role,
                Role::Image
                    | Role::Canvas
                    | Role::GraphicsDocument
                    | Role::GraphicsSymbol
                    | Role::DocCover
            ),
            "Heading" => node.role == Role::Heading,
            "HeadingSameLevel" => {
                let heading =
                    start.and_then(|it| self.get(self.closest(it, |it| it.role == Role::Heading)?));
                node.role == Role::Heading
                    && heading
                        .is_some_and(|it| it.number(Number::Level) == node.number(Number::Level))
            }
            "Highlighted" => node.role == Role::Mark,
            "ItalicFont" => node.has(abi::ITALIC),
            "KeyboardFocusable" => {
                takes_focus(node)
                    && !(only_holds(node)
                        && self
                            .descendants(id)
                            .any(|it| self.get(it).is_some_and(takes_focus)))
            }
            "Landmark" => is_landmark(node) || node.role == Role::Article,
            "Link" | "UnvisitedLink" => is_link(node),
            "List" => matches!(
                node.role,
                Role::List | Role::Listbox | Role::DescriptionList
            ),
            "LiveRegion" => node.is_live(),
            "MisspelledWord" => !node.misspelled.is_empty(),
            "Outline" => node.role == Role::Tree,
            "PlainText" => is_text && !node.has(STYLES),
            "RadioGroup" => node.role == Role::RadioGroup,
            "SameType" => from.is_some_and(|it| it.role == node.role),
            "StaticText" => is_text,
            "StyleChange" => {
                has_other_font()
                    || differs(Number::Color)
                    || is_text && from.is_some_and(|it| (it.states ^ node.states) & STYLES != 0)
            }
            "Table" => node.is_table(),
            "TableSameLevel" => {
                node.is_table()
                    && start.is_some_and(|it| {
                        self.depth_in(it, Node::is_table).max(1)
                            == self.depth_in(id, Node::is_table)
                    })
            }
            "TextField" => node.has(abi::TEXT_FIELD),
            "Underline" => node.has(abi::UNDERLINED),
            key => {
                let level = key
                    .strip_prefix("HeadingLevel")
                    .and_then(|it| it.parse().ok());
                level.is_some() && node.role == Role::Heading && node.number(Number::Level) == level
            }
        }
    }

    pub fn search(&self, within: Id, search: &Search) -> Vec<Id> {
        let mut all = Vec::new();
        let mut pending: Vec<Id> = self.exposed_children(within).into_iter().rev().collect();
        while let Some(id) = pending.pop() {
            all.push(id);
            if !search.only_children {
                pending.extend(self.exposed_children(id).into_iter().rev());
            }
        }
        let around = search
            .start
            .into_iter()
            .flat_map(|it| std::iter::once(it).chain(self.ancestors(it)));
        let candidates = match (
            around
                .into_iter()
                .find_map(|it| all.iter().position(|other| *other == it)),
            search.is_backwards,
        ) {
            (Some(index), false) => &all[index + 1..],
            (Some(index), true) => &all[..index],
            (None, _) => &all[..],
        };
        let wanted = search.text.to_lowercase();
        let matches = |id: &Id| {
            let Some(node) = self.get(*id) else {
                return false;
            };
            let has_text = || {
                [Text::Name, Text::Description, Text::Value]
                    .iter()
                    .any(|it| {
                        node.text(*it)
                            .is_some_and(|it| it.to_lowercase().contains(&wanted))
                    })
            };
            (search.keys.is_empty()
                || search
                    .keys
                    .iter()
                    .any(|it| self.matches(*id, node, it, search.start)))
                && (wanted.is_empty() || has_text())
                && !(search.only_visible && self.is_offscreen(*id))
        };
        match search.is_backwards {
            true => candidates
                .iter()
                .rev()
                .copied()
                .filter(matches)
                .take(search.limit)
                .collect(),
            false => candidates
                .iter()
                .copied()
                .filter(matches)
                .take(search.limit)
                .collect(),
        }
    }
}
