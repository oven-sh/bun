//! https://w3c.github.io/html-aam/ and https://w3c.github.io/accname/

use core::cell::{Cell, OnceCell, RefCell};
use core::hash::BuildHasher;

use smallvec::SmallVec;

use super::Facts;
use super::changes::Source;
use crate::abi::accessibility::Role;
use crate::boxes::Kind;
use crate::document::Document;
use crate::name::{Map, Name, Set, is_name, name};
use crate::selector::{Pseudo, filter, key};
use crate::tree::{DOCUMENT, Data, Element, Flags, Namespace, NodeId, State};
use crate::types::*;
use crate::values::text;

pub(super) type Nodes = SmallVec<[NodeId; 2]>;

#[derive(Clone, Copy, PartialEq)]
pub(super) enum NameFrom {
    Nothing,
    Attribute,
    EmptyAttribute,
    Relation,
    Content,
    Title,
    Placeholder,
    Value,
}

const DEEPEST_OWNER: usize = 256;
const MOST_RADIOS: usize = 256;

/// Reads a document that does not change meanwhile.
pub(super) struct Reader<'a> {
    pub(super) document: &'a Document,
    facts: &'a Map<NodeId, Facts>,
    ids: RefCell<Map<NodeId, Map<Name, NodeId>>>,
    labels: RefCell<Map<NodeId, Map<NodeId, Nodes>>>,
    /// In each scope, by the form and the name.
    radios: RefCell<Map<NodeId, Map<(NodeId, Name), Nodes>>>,
    last_row: Cell<(NodeId, bool)>,
    owners: OnceCell<Map<NodeId, NodeId>>,
    searches: Cell<u32>,
    /// What has been looked up.
    pub(super) sources: RefCell<Vec<Source>>,
}

struct Walk {
    root: NodeId,
    seen: Set<NodeId>,
}

#[derive(Clone, Copy)]
struct Step {
    is_referenced: bool,
    shows_hidden: bool,
    is_label: bool,
}

pub(super) fn has_text(it: &str) -> bool {
    !it.trim_ascii().is_empty()
}

pub(super) fn collapsed(it: &str) -> String {
    let mut out = String::with_capacity(it.len());
    for word in it.split_ascii_whitespace() {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    out
}

fn integer(it: &str) -> Option<i32> {
    let it = it.trim_ascii_start();
    let is_part = |(index, byte): &(usize, u8)| {
        byte.is_ascii_digit() || *index == 0 && matches!(byte, b'-' | b'+')
    };
    it[..it.bytes().enumerate().take_while(is_part).count()]
        .parse()
        .ok()
}

fn is_global(name: Name) -> bool {
    is_name!(
        name,
        "aria-atomic"
            | "aria-braillelabel"
            | "aria-brailleroledescription"
            | "aria-busy"
            | "aria-controls"
            | "aria-current"
            | "aria-describedby"
            | "aria-description"
            | "aria-details"
            | "aria-dropeffect"
            | "aria-flowto"
            | "aria-grabbed"
            | "aria-keyshortcuts"
            | "aria-label"
            | "aria-labelledby"
            | "aria-labeledby"
            | "aria-live"
            | "aria-owns"
            | "aria-relevant"
            | "aria-roledescription"
    )
}

pub(super) fn is_range(role: Role) -> bool {
    matches!(
        role,
        Role::Meter | Role::ProgressBar | Role::Scrollbar | Role::Slider | Role::SpinButton
    )
}

pub(super) fn is_cell(role: Role) -> bool {
    matches!(
        role,
        Role::Cell | Role::GridCell | Role::ColumnHeader | Role::RowHeader
    )
}

fn is_named_by_content(role: Role) -> bool {
    use Role::*;
    is_cell(role)
        || matches!(
            role,
            Button
                | Checkbox
                | Comment
                | DocBacklink
                | DocBiblioRef
                | DocGlossRef
                | DocNoteRef
                | DocSubtitle
                | Heading
                | Link
                | MenuItem
                | MenuItemCheckbox
                | MenuItemRadio
                | Option
                | Radio
                | Switch
                | Tab
                | Term
                | Tooltip
                | TreeItem
                | DisclosureTriangle
                | Math
        )
}

fn prohibits_name(role: Role) -> bool {
    use Role::*;
    matches!(
        role,
        Caption
            | Code
            | Definition
            | Deletion
            | Emphasis
            | Generic
            | Insertion
            | Mark
            | None
            | Paragraph
            | Strong
            | Subscript
            | Suggestion
            | Superscript
            | Time
    )
}

impl<'a> Reader<'a> {
    pub(super) fn new(document: &'a Document, facts: &'a Map<NodeId, Facts>) -> Self {
        let (ids, labels, radios, last_row, owners, searches, sources) = Default::default();
        Reader {
            document,
            facts,
            ids,
            labels,
            radios,
            last_row,
            owners,
            searches,
            sources,
        }
    }

    pub(super) fn element(&self, id: NodeId) -> Option<&'a Element> {
        self.document.tree.element(id)
    }

    pub(super) fn facts(&self, id: NodeId) -> Option<&'a Facts> {
        self.facts.get(&id)
    }

    pub(super) fn tag(&self, id: NodeId) -> Name {
        self.document.tree.html_tag(id)
    }

    pub(super) fn attribute(&self, id: NodeId, name: Name) -> Option<&'a str> {
        self.element(id)?.attribute(name)
    }

    /// The attribute, or what `ElementInternals` has instead.
    pub(super) fn aria(&self, id: NodeId, name: Name) -> Option<&'a str> {
        let default = || {
            self.facts(id)?
                .defaults
                .iter()
                .find(|it| it.0 == name)
                .map(|it| &*it.1)
        };
        self.attribute(id, name).or_else(default)
    }

    pub(super) fn aria_text(&self, id: NodeId, name: Name) -> Option<&'a str> {
        self.aria(id, name).filter(|it| has_text(it))
    }

    pub(super) fn aria_is(&self, id: NodeId, name: Name, value: &str) -> bool {
        self.aria(id, name)
            .is_some_and(|it| it.trim_ascii().eq_ignore_ascii_case(value))
    }

    /// `None` if it is missing, empty or "undefined".
    pub(super) fn aria_bool(&self, id: NodeId, name: Name) -> Option<bool> {
        let value = self.aria_text(id, name)?.trim_ascii();
        (!value.eq_ignore_ascii_case("undefined")).then(|| !value.eq_ignore_ascii_case("false"))
    }

    pub(super) fn aria_number(&self, id: NodeId, name: Name) -> Option<f64> {
        self.aria(id, name)?
            .trim_ascii()
            .parse()
            .ok()
            .filter(|it: &f64| it.is_finite())
    }

    pub(super) fn has_global_state(&self, id: NodeId) -> bool {
        self.element(id).is_some_and(|it| {
            it.attributes
                .iter()
                .any(|it| is_global(it.name) && has_text(&it.value))
        }) || self.facts(id).is_some_and(|it| {
            it.defaults.iter().any(|it| is_global(it.0)) || !it.references.is_empty()
        })
    }

    fn having(&self, scope: NodeId, key: Name) -> impl Iterator<Item = (NodeId, &'a Element)> + 'a {
        let tree = &self.document.tree;
        tree.descendants_with(scope, filter([key].into_iter()))
            .filter_map(|it| Some((it, tree.element(it)?)))
    }

    pub(super) fn by_id(&self, scope: NodeId, id: &str) -> Option<NodeId> {
        let id = Name::new(id.as_bytes());
        let found = self.find_by_id(scope, id);
        self.sources.borrow_mut().extend(
            [Source::Id(scope, id)]
                .into_iter()
                .chain(found.map(Source::Node)),
        );
        found
    }

    fn find_by_id(&self, scope: NodeId, id: Name) -> Option<NodeId> {
        if self.searches.replace(self.searches.get() + 1) < 8 {
            return self
                .having(scope, key::id(id))
                .find(|it| it.1.id == id)
                .map(|it| it.0);
        }
        let mut ids = self.ids.borrow_mut();
        let of_scope = ids.entry(scope).or_insert_with(|| {
            let mut all = Map::default();
            for (node, element) in self
                .having(scope, key::attribute(name!("id")))
                .filter(|it| it.1.id != Name::NONE)
            {
                all.entry(element.id).or_insert(node);
            }
            all
        });
        of_scope.get(&id).copied()
    }

    pub(super) fn referenced(&self, id: NodeId, name: Name) -> Nodes {
        let explicit = || {
            self.facts(id)
                .and_then(|it| it.references.iter().find(|it| it.0 == name))
        };
        match (self.attribute(id, name), explicit()) {
            (None | Some(""), Some(explicit)) => self.looked_up(
                explicit
                    .1
                    .iter()
                    .copied()
                    .filter(|it| self.element(*it).is_some())
                    .collect(),
            ),
            (Some(ids), _) => {
                let scope = self.document.tree[id].scope;
                ids.split_ascii_whitespace()
                    .filter_map(|it| self.reference_target(self.by_id(scope, it)?))
                    .collect()
            }
            _ => Nodes::new(),
        }
    }

    fn looked_up(&self, nodes: Nodes) -> Nodes {
        self.sources
            .borrow_mut()
            .extend(nodes.iter().copied().map(Source::Node));
        nodes
    }

    fn reference_target(&self, id: NodeId) -> Option<NodeId> {
        match self
            .facts(id)
            .and_then(|it| it.references.iter().find(|it| it.0 == name!("target")))
        {
            Some(target) => self
                .looked_up(target.1.iter().copied().collect())
                .first()
                .copied(),
            None => Some(id),
        }
    }

    pub(super) fn labelled_by(&self, id: NodeId) -> Nodes {
        let found = self.referenced(id, name!("aria-labelledby"));
        if found.is_empty() {
            self.referenced(id, name!("aria-labeledby"))
        } else {
            found
        }
    }

    fn owners(&self) -> &Map<NodeId, NodeId> {
        self.owners.get_or_init(|| {
            let (tree, mut owners) = (&self.document.tree, Map::<NodeId, NodeId>::default());
            let mut candidates: Vec<NodeId> = (self.facts.iter())
                .filter(|it| it.1.references.iter().any(|it| it.0 == name!("aria-owns")))
                .map(|it| *it.0)
                .collect();
            if self
                .document
                .attribute_keys
                .at_most(key::attribute(name!("aria-owns")))
                > 0
            {
                tree.visit_subtree(DOCUMENT, |it| {
                    candidates.extend(self.attribute(it, name!("aria-owns")).map(|_| it))
                });
            }
            let is_aria_hidden = |it| {
                core::iter::once(it)
                    .chain(tree.flat_ancestors(it))
                    .any(|it| self.is_aria_hidden(it))
            };
            for owner in candidates {
                if is_name!(
                    self.tag(owner),
                    "input" | "textarea" | "img" | "br" | "hr" | "iframe"
                ) || self.is_hidden_by_style_above(owner)
                    || is_aria_hidden(owner)
                {
                    continue;
                }
                for owned in self.referenced(owner, name!("aria-owns")) {
                    let above = |it: &NodeId| {
                        Some(
                            owners
                                .get(it)
                                .copied()
                                .unwrap_or_else(|| tree.flat_parent(*it)),
                        )
                        .filter(|it| *it != 0)
                    };
                    if !owners.contains_key(&owned)
                        && !core::iter::successors(Some(owner), above)
                            .enumerate()
                            .any(|it| it.1 == owned || it.0 > DEEPEST_OWNER)
                    {
                        owners.insert(owned, owner);
                    }
                }
            }
            owners
        })
    }

    pub(super) fn hash_of_owners(&self) -> u64 {
        self.owners().iter().fold(0, |all, it| {
            all.wrapping_add(self.owners().hasher().hash_one(it))
        })
    }

    pub(super) fn is_owned(&self, id: NodeId) -> bool {
        self.owners().contains_key(&id)
    }

    /// Whether it may have children that are elsewhere in the document.
    pub(super) fn shows_others(&self, id: NodeId) -> bool {
        self.attribute(id, name!("usemap")).is_some()
            || !self.owners().is_empty() && !self.referenced(id, name!("aria-owns")).is_empty()
    }

    pub(super) fn parent(&self, id: NodeId) -> NodeId {
        self.owners()
            .get(&id)
            .copied()
            .unwrap_or_else(|| self.document.tree.flat_parent(id))
    }

    pub(super) fn ancestors(&self, id: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        core::iter::successors(Some(self.parent(id)), |it| Some(self.parent(*it)))
            .take_while(|it| self.element(*it).is_some())
    }

    /// With the generated ones.
    pub(super) fn children(&self, id: NodeId) -> SmallVec<[NodeId; 8]> {
        let (owners, own) = (self.owners(), self.document.rendered_children(id));
        if owners.is_empty() {
            return own.collect();
        }
        let owned = self
            .referenced(id, name!("aria-owns"))
            .into_iter()
            .filter(|it| owners.get(it) == Some(&id));
        own.filter(|it| !owners.contains_key(it))
            .chain(owned)
            .collect()
    }

    fn is_labelable(&self, id: NodeId) -> bool {
        self.element(id).is_some_and(|it| match it.html_tag() {
            tag if tag == name!("input") => it.input_type() != name!("hidden"),
            tag => {
                is_name!(
                    tag,
                    "button" | "meter" | "output" | "progress" | "select" | "textarea"
                ) || it.state.contains(State::FORM_ASSOCIATED)
            }
        })
    }

    pub(super) fn labelled_control(&self, label: NodeId) -> Option<NodeId> {
        let tree = &self.document.tree;
        match self.attribute(label, name!("for")) {
            Some(id) => self
                .by_id(tree[label].scope, id)
                .filter(|it| self.is_labelable(*it)),
            None => tree.descendants(label).find(|it| self.is_labelable(*it)),
        }
    }

    pub(super) fn labels_of(&self, id: NodeId) -> Nodes {
        if let Some(labels) = self
            .facts(id)
            .and_then(|it| it.references.iter().find(|it| it.0 == name!("labels")))
        {
            return self.looked_up(labels.1.iter().copied().collect());
        }
        if !self.is_labelable(id) {
            return Nodes::new();
        }
        let scope = self.document.tree[id].scope;
        self.sources.borrow_mut().extend(
            self.element(id)
                .filter(|it| it.id != Name::NONE)
                .map(|it| Source::Id(scope, it.id)),
        );
        let mut labels = self.labels.borrow_mut();
        let of_scope = labels.entry(scope).or_insert_with(|| {
            let (mut all, sources) = (Map::<NodeId, Nodes>::default(), self.sources.borrow().len());
            for (label, _) in self
                .having(scope, key::tag(name!("label")))
                .filter(|it| it.1.html_tag() == name!("label"))
            {
                if let Some(control) = self.labelled_control(label) {
                    all.entry(control).or_default().push(label);
                }
            }
            self.sources.borrow_mut().truncate(sources);
            all
        });
        self.looked_up(of_scope.get(&id).cloned().unwrap_or_default())
    }

    pub(super) fn radio_group(&self, id: NodeId) -> Nodes {
        let group_of = |id| {
            let radio = self
                .element(id)
                .filter(|it| it.html_tag() == name!("input") && it.input_type() == name!("radio"));
            let name = radio?
                .attribute(name!("name"))
                .filter(|it| !it.is_empty())?;
            Some((
                self.ancestors(id)
                    .find(|it| self.tag(*it) == name!("form"))
                    .unwrap_or(0),
                Name::new(name.as_bytes()),
            ))
        };
        let (Some(group), scope, mut radios) = (
            group_of(id),
            self.document.tree[id].scope,
            self.radios.borrow_mut(),
        ) else {
            return Nodes::new();
        };
        let of_scope = radios.entry(scope).or_insert_with(|| {
            let mut all = Map::<_, Nodes>::default();
            for (input, group) in self
                .having(scope, key::tag(name!("input")))
                .filter_map(|it| Some((it.0, group_of(it.0)?)))
            {
                all.entry(group).or_default().push(input);
            }
            all
        });
        self.looked_up(
            of_scope
                .get(&group)
                .filter(|it| it.len() <= MOST_RADIOS)
                .cloned()
                .unwrap_or_default(),
        )
    }

    // ───────────────────────────── what elements are ─────────────────────────────

    pub(super) fn is_part(&self, id: NodeId, part: Name) -> bool {
        self.element(id)
            .is_some_and(|it| it.pseudo == Pseudo::Part(part))
    }

    pub(super) fn find_part(&self, host: NodeId, part: Name) -> Option<NodeId> {
        let root = self.element(host)?.shadow_root;
        self.document
            .tree
            .descendants(root)
            .find(|it| self.is_part(*it, part))
    }

    pub(super) fn is_summary(&self, id: NodeId) -> bool {
        let tree = &self.document.tree;
        let parent = tree[id].parent;
        self.is_part(id, name!("-internal-default-summary"))
            || self.tag(id) == name!("summary")
                && self.tag(parent) == name!("details")
                && tree
                    .element_children(parent)
                    .find(|it| self.tag(*it) == name!("summary"))
                    == Some(id)
    }

    pub(super) fn is_editing_host(&self, id: NodeId) -> bool {
        let tree = &self.document.tree;
        let is_editable = |it| tree.style(it).is_some_and(|it| it.is_editable());
        (self.attribute(id, name!("contenteditable")).is_some() || tree.is_root(id))
            && is_editable(id)
            && !is_editable(tree[id].parent)
    }

    pub(super) fn is_drop_down(&self, select: NodeId) -> bool {
        let size = self.attribute(select, name!("size")).and_then(integer);
        if self.attribute(select, name!("multiple")).is_some() {
            size == Some(1)
        } else {
            size.is_none_or(|it| it <= 1)
        }
    }

    pub(super) fn is_text_control(&self, id: NodeId) -> bool {
        self.element(id).is_some_and(|it| match it.html_tag() {
            tag if tag == name!("input") => {
                it.is_text_field()
                    && !is_name!(
                        it.input_type(),
                        "date" | "datetime-local" | "month" | "time" | "week"
                    )
            }
            tag => tag == name!("textarea"),
        })
    }

    pub(super) fn scrolls(&self, id: NodeId) -> bool {
        let document = self.document;
        document
            .own_box(id)
            .filter(|it| document.boxes[*it].scrolls())
            .is_some_and(|it| {
                let range = document.scroll_range(it);
                (0..2).any(|axis| {
                    matches!(
                        document.boxes[it].overflow[axis],
                        Overflow::Auto | Overflow::Scroll
                    ) && range[axis] != [0.0; 2]
                })
            })
    }

    pub(super) fn supports_focus(&self, id: NodeId) -> bool {
        let Some(element) = self
            .element(id)
            .filter(|it| !it.state.contains(State::DISABLED))
        else {
            return false;
        };
        if element
            .attribute(name!("tabindex"))
            .and_then(integer)
            .is_some()
            || element.state.contains(State::LINK)
        {
            return true;
        }
        match element.html_tag() {
            tag if tag == name!("input") => element.input_type() != name!("hidden"),
            tag if is_name!(tag, "audio" | "video") => element.has(name!("controls")),
            tag if is_name!(
                tag,
                "button" | "select" | "textarea" | "iframe" | "frame" | "option"
            ) =>
            {
                true
            }
            _ if matches!(element.pseudo, Pseudo::Part(_))
                && self.aria(id, name!("role")).is_some() =>
            {
                !self.aria_is(id, name!("aria-disabled"), "true")
            }
            _ => self.is_summary(id) || self.is_editing_host(id),
        }
    }

    pub(super) fn options(&self, select: NodeId) -> impl Iterator<Item = NodeId> + '_ {
        self.document
            .tree
            .descendants(select)
            .filter(|it| self.tag(*it) == name!("option"))
    }

    pub(super) fn text_content(&self, id: NodeId) -> String {
        let tree = &self.document.tree;
        tree.descendants(id)
            .filter_map(|it| tree[it].text())
            .map(text)
            .collect()
    }

    fn only_says(&self, id: NodeId, words: &str) -> bool {
        const FEW: usize = 8;
        self.document.tree.descendants(id).nth(FEW).is_none()
            && collapsed(&self.text_content(id)) == words
    }

    pub(super) fn option_label(&self, option: NodeId) -> String {
        let label = self
            .attribute(option, name!("label"))
            .filter(|it| !it.is_empty());
        label.map_or_else(|| collapsed(&self.text_content(option)), str::to_owned)
    }

    pub(super) fn selected_labels(&self, select: NodeId, separator: &str) -> String {
        let selected = self.options(select).filter(|it| {
            self.element(*it)
                .is_some_and(|it| it.state.contains(State::CHECKED))
        });
        selected
            .map(|it| self.option_label(it))
            .collect::<Vec<_>>()
            .join(separator)
    }

    // ───────────────────────────── roles ─────────────────────────────

    fn has_author_name(&self, id: NodeId) -> bool {
        self.aria_text(id, name!("aria-label")).is_some()
            || self.attribute(id, name!("title")).is_some_and(has_text)
            || !self.labelled_by(id).is_empty()
    }

    fn is_in_section(&self, id: NodeId, or_main: bool) -> bool {
        self.ancestors(id).any(|it| match self.explicit_role(it) {
            Some(role) => {
                matches!(
                    role,
                    Role::Article | Role::Complementary | Role::Navigation | Role::Region
                ) || or_main && role == Role::Main
            }
            None => {
                is_name!(self.tag(it), "article" | "aside" | "nav" | "section")
                    || or_main && self.tag(it) == name!("main")
            }
        })
    }

    pub(super) fn meaningful_parent(&self, id: NodeId) -> Option<(NodeId, Role)> {
        self.ancestors(id)
            .map(|it| (it, self.role(it)))
            .find(|it| !matches!(it.1, Role::Generic | Role::None))
    }

    pub(super) fn explicit_role(&self, id: NodeId) -> Option<Role> {
        for token in self.aria(id, name!("role"))?.split_ascii_whitespace() {
            let role = match &*token.to_ascii_lowercase() {
                "directory" => Role::List,
                "img" => Role::Image,
                "presentation" => Role::None,
                token => match Role::named(token) {
                    Some(role) => role,
                    None => continue,
                },
            };
            match role {
                Role::Region | Role::Form
                    if self.attribute(id, name!("role")).is_some() && !self.has_author_name(id) => {
                }
                Role::None if self.has_global_state(id) || self.supports_focus(id) => return None,
                role => return Some(role),
            }
        }
        None
    }

    fn has_data_cells(&self, row: NodeId) -> bool {
        if self.last_row.get().0 != row {
            self.last_row.set((
                row,
                self.document
                    .tree
                    .element_children(row)
                    .any(|it| self.tag(it) == name!("td")),
            ));
        }
        self.last_row.get().1
    }

    fn header_role(&self, id: NodeId) -> Role {
        let tree = &self.document.tree;
        let (scope, row) = (
            self.attribute(id, name!("scope"))
                .unwrap_or_default()
                .to_ascii_lowercase(),
            tree[id].parent,
        );
        if scope.starts_with("row") {
            Role::RowHeader
        } else if scope.starts_with("col") || self.tag(tree[row].parent) == name!("thead") {
            Role::ColumnHeader
        } else if self.has_data_cells(row) {
            Role::RowHeader
        } else {
            Role::ColumnHeader
        }
    }

    fn svg_child_text(&self, id: NodeId, tag: Name) -> Option<String> {
        let is_it = |it: &NodeId| {
            self.element(*it)
                .is_some_and(|it| it.namespace == Namespace::Svg && it.tag == tag)
        };
        self.document
            .tree
            .element_children(id)
            .find(is_it)
            .map(|it| self.text_content(it))
    }

    fn input_role(&self, id: NodeId, element: &Element) -> Role {
        let kind = element.input_type();
        let has_list = || {
            let list = element
                .attribute(name!("list"))
                .and_then(|it| self.by_id(self.document.tree[id].scope, it));
            list.is_some_and(|it| self.tag(it) == name!("datalist"))
        };
        match kind {
            _ if is_name!(kind, "button" | "file" | "image" | "reset" | "submit") => Role::Button,
            _ if kind == name!("checkbox") => {
                if element.has(name!("switch")) {
                    Role::Switch
                } else {
                    Role::Checkbox
                }
            }
            _ if kind == name!("radio") => Role::Radio,
            _ if kind == name!("range") => Role::Slider,
            _ if kind == name!("color") => Role::ColorWell,
            _ if kind == name!("date") => Role::Date,
            _ if kind == name!("time") => Role::InputTime,
            _ if is_name!(kind, "datetime-local" | "month" | "week") => Role::DateTime,
            _ if kind == name!("number") => Role::SpinButton,
            _ if kind != name!("password") && has_list() => Role::Combobox,
            _ if kind == name!("search") => Role::Searchbox,
            _ => Role::Textbox,
        }
    }

    fn table_part_role(&self, id: NodeId, tag: Name) -> Role {
        let tree = &self.document.tree;
        let mut above = core::iter::successors(Some(tree[id].parent), |it| Some(tree[*it].parent))
            .take_while(|it| *it != 0);
        match above
            .find(|it| self.tag(*it) == name!("table"))
            .map_or(Role::Table, |it| self.role(it))
        {
            Role::None => Role::None,
            table @ (Role::Table | Role::Grid | Role::TreeGrid) => match tag {
                _ if tag == name!("th") => self.header_role(id),
                _ if tag == name!("td") => {
                    if table == Role::Table {
                        Role::Cell
                    } else {
                        Role::GridCell
                    }
                }
                _ if tag == name!("tr") => Role::Row,
                _ => Role::RowGroup,
            },
            _ => Role::Generic,
        }
    }

    fn implicit_role(&self, id: NodeId) -> Role {
        let Some(element) = self.element(id) else {
            return Role::Generic;
        };
        let tag = element.tag;
        match element.namespace {
            Namespace::Html => {}
            Namespace::MathMl if tag == name!("math") => return Role::Math,
            Namespace::Svg if tag == name!("svg") => return Role::GraphicsDocument,
            Namespace::Svg if element.state.contains(State::LINK) => return Role::Link,
            Namespace::Svg => {
                let is_described = || {
                    [name!("title"), name!("desc")]
                        .into_iter()
                        .any(|it| self.svg_child_text(id, it).is_some())
                };
                return match tag {
                    _ if !self.has_author_name(id)
                        && !is_described()
                        && !self.supports_focus(id)
                        && !self.has_global_state(id) =>
                    {
                        Role::None
                    }
                    _ if tag == name!("image") => Role::Image,
                    _ if is_name!(
                        tag,
                        "g" | "a" | "foreignObject" | "text" | "textPath" | "tspan"
                    ) =>
                    {
                        Role::Group
                    }
                    _ if tag == name!("use") => Role::GraphicsObject,
                    _ => Role::GraphicsSymbol,
                };
            }
            _ => return Role::Generic,
        }
        macro_rules! by_tag {
            ($($($tag:literal)|+ => $role:expr,)*) => {
                $(if is_name!(tag, $($tag)|+) { return $role; })*
            };
        }
        by_tag! {
            "div" | "span" => match element.pseudo {
                Pseudo::Part(part) if part == name!("picker(select)") => Role::MenuListPopup,
                _ if self.is_editing_host(id) => Role::Textbox,
                _ => Role::Generic,
            },
            "" => if element.pseudo == Pseudo::Marker { Role::ListMarker } else { Role::Generic },
            "a" | "area" => if element.state.contains(State::LINK) { Role::Link } else { Role::Generic },
            "p" => Role::Paragraph,
            "button" => Role::Button,
            "li" => if self.explicit_role(self.document.tree[id].parent) == Some(Role::None) { Role::None } else { Role::ListItem },
            "td" | "th" | "tr" | "tbody" | "thead" | "tfoot" => self.table_part_role(id, tag),
            "code" => Role::Code,
            "br" => Role::LineBreak,
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => Role::Heading,
            "img" => match element.attribute(name!("alt")) {
                Some("") if !self.has_author_name(id) && !self.supports_focus(id) => Role::None,
                _ => Role::Image,
            },
            "input" => self.input_role(id, element),
            "strong" => Role::Strong,
            "em" => Role::Emphasis,
            "ul" | "ol" | "menu" | "dir" => Role::List,
            "label" => Role::Label,
            "section" => if self.has_author_name(id) { Role::Region } else { Role::Generic },
            "aside" => if !self.is_in_section(id, false) || self.has_author_name(id) { Role::Complementary } else { Role::Generic },
            "footer" => if self.is_in_section(id, true) { Role::SectionFooter } else { Role::ContentInfo },
            "header" => if self.is_in_section(id, true) { Role::SectionHeader } else { Role::Banner },
            "select" => if self.is_drop_down(id) { Role::Combobox } else { Role::Listbox },
            "summary" => if self.is_summary(id) { Role::DisclosureTriangle } else { Role::Generic },
            "address" | "details" | "fieldset" | "hgroup" | "optgroup" => Role::Group,
            "abbr" => Role::Abbreviation,
            "article" => Role::Article,
            "audio" => Role::Audio,
            "blockquote" => Role::Blockquote,
            "canvas" => Role::Canvas,
            "caption" => Role::Caption,
            "datalist" => Role::Listbox,
            "dd" => Role::Definition,
            "del" | "s" => Role::Deletion,
            "dfn" | "dt" => Role::Term,
            "dialog" => Role::Dialog,
            "dl" => Role::DescriptionList,
            "embed" | "object" => Role::EmbeddedObject,
            "figcaption" => Role::Figcaption,
            "figure" => Role::Figure,
            "form" => Role::Form,
            "hr" => Role::Separator,
            "iframe" | "frame" => Role::Iframe,
            "ins" => Role::Insertion,
            "legend" => Role::Legend,
            "main" => Role::Main,
            "mark" => Role::Mark,
            "meter" => Role::Meter,
            "nav" => Role::Navigation,
            "option" => Role::Option,
            "output" => Role::Status,
            "progress" => Role::ProgressBar,
            "ruby" => Role::Ruby,
            "search" => Role::Search,
            "sub" => Role::Subscript,
            "sup" => Role::Superscript,
            "table" => Role::Table,
            "textarea" => Role::Textbox,
            "time" => Role::Time,
            "video" => Role::Video,
        }
        if self.is_editing_host(id) {
            Role::Textbox
        } else {
            Role::Generic
        }
    }

    pub(super) fn role(&self, id: NodeId) -> Role {
        let Some(role) = self.explicit_role(id) else {
            let own = self.implicit_role(id);
            let needs_more = || {
                let has = |name| self.attribute(id, name).is_some();
                has(name!("popover")) || has(name!("autofocus")) || has(name!("draggable"))
            };
            return if own == Role::Generic && needs_more() {
                Role::Group
            } else {
                own
            };
        };
        let context: &[Role] = match role {
            Role::ListItem => &[Role::List, Role::Group],
            Role::Option => &[
                Role::Listbox,
                Role::Group,
                Role::Combobox,
                Role::MenuListPopup,
            ],
            Role::TreeItem => &[Role::Tree, Role::Group, Role::TreeItem],
            _ => return role,
        };
        match self.meaningful_parent(id) {
            Some((_, parent)) if context.contains(&parent) => role,
            _ => self.implicit_role(id),
        }
    }

    // ───────────────────────────── what is hidden ─────────────────────────────

    pub(super) fn is_aria_hidden(&self, id: NodeId) -> bool {
        self.aria_is(id, name!("aria-hidden"), "true") && !is_name!(self.tag(id), "html" | "body")
    }

    /// Fallback content, and the options of a `select` that is closed.
    pub(super) fn counts_without_box(&self, id: NodeId) -> bool {
        let tree = &self.document.tree;
        self.element(id).is_some_and(|it| {
            it.namespace == Namespace::Svg || is_name!(it.html_tag(), "option" | "optgroup")
        }) || self.document.is_in_skipped_contents(id)
            || tree
                .flat_ancestors(id)
                .any(|it| is_name!(self.tag(it), "canvas" | "option" | "audio" | "video"))
    }

    pub(super) fn hides_contents(&self, id: NodeId) -> bool {
        self.document.tree[id].has(Flags::SKIPPED) && !self.document.auto_visible.contains_key(&id)
    }

    pub(super) fn areas(&self, image: NodeId) -> Nodes {
        let tree = &self.document.tree;
        let Some(wanted) = self
            .attribute(image, name!("usemap"))
            .and_then(|it| it.strip_prefix('#'))
        else {
            return Nodes::new();
        };
        let is_it = |it: &NodeId| {
            [name!("name"), name!("id")]
                .into_iter()
                .any(|name| self.attribute(*it, name) == Some(wanted))
        };
        let map = self
            .having(tree[image].scope, key::tag(name!("map")))
            .map(|it| it.0)
            .find(is_it);
        map.into_iter()
            .flat_map(|it| tree.descendants(it))
            .filter(|it| self.tag(*it) == name!("area"))
            .collect()
    }

    /// The element whose style counts for one that is only shown by way of it.
    fn shown_by(&self, id: NodeId) -> NodeId {
        let tree = &self.document.tree;
        let found = match self.tag(id) {
            tag if tag == name!("area") => self
                .having(tree[id].scope, key::tag(name!("img")))
                .map(|it| it.0)
                .find(|it| self.areas(*it).contains(&id)),
            tag if is_name!(tag, "option" | "optgroup") && tree.style(id).is_none() => tree
                .flat_ancestors(id)
                .find(|it| self.tag(*it) == name!("select")),
            _ => None,
        };
        found.unwrap_or(id)
    }

    fn is_rendered(&self, id: NodeId) -> bool {
        let (tree, id) = (&self.document.tree, self.shown_by(id));
        tree.style(id).is_some_and(|it| match it.display() {
            Display::None => false,
            Display::Contents => true,
            _ => tree[id].layout_box != 0 || self.counts_without_box(id),
        })
    }

    fn is_visible(&self, id: NodeId) -> bool {
        self.document
            .tree
            .style(self.shown_by(id))
            .is_some_and(|it| it.is_visible())
    }

    fn is_hidden_by_style_above(&self, id: NodeId) -> bool {
        !self.is_rendered(id)
            || self
                .document
                .tree
                .flat_ancestors(id)
                .any(|it| self.hides_contents(it))
    }

    pub(super) fn is_hidden_above(&self, id: NodeId) -> bool {
        !self.is_visible(id)
            || self.is_hidden_by_style_above(id)
            || core::iter::once(id)
                .chain(self.ancestors(id))
                .any(|it| self.is_aria_hidden(it))
    }

    // ───────────────────────────── names ─────────────────────────────

    pub(super) fn marker_text(&self, marker: NodeId) -> String {
        let document = self.document;
        match document.own_box(marker).map(|it| &document.boxes[it]) {
            Some(it) if it.kind == Kind::Bullet => match &it.style.text.list_type {
                ListStyleType::Named(name) if &**name == "circle" => "◦ ",
                ListStyleType::Named(name) if &**name == "square" => "■ ",
                ListStyleType::Named(name) if name.starts_with("disclosure") => "",
                _ => "• ",
            }
            .to_owned(),
            _ => self.text_content(marker),
        }
    }

    pub(super) fn alternative_text(&self, generated: NodeId) -> Option<&'a str> {
        match self.document.tree.style(generated)?.rare.content {
            Content::Items(_, Some(_)) => {
                self.document.counter_users.get(&generated).map(|it| &**it)
            }
            _ => None,
        }
    }

    fn push_text(&self, id: NodeId, data: &[u8], out: &mut String) {
        let transform = self
            .document
            .tree
            .style(self.document.tree.flat_parent(id))
            .map(|it| (it.text.transform, it.text.security));
        match transform {
            None | Some((TextTransform::None, TextSecurity::None)) => out.push_str(text(data)),
            _ => match super::build::rendered_text(self.document, id) {
                Some(rendered) => out.push_str(&rendered),
                None => out.push_str(text(data)),
            },
        }
    }

    fn content(&self, id: NodeId, walk: &mut Walk, step: Step, out: &mut String) {
        let tree = &self.document.tree;
        if !bun_core::StackCheck::init().is_safe_to_recurse()
            || !step.shows_hidden && self.hides_contents(id)
        {
            return;
        }
        let step = Step {
            is_label: false,
            ..step
        };
        for child in self.children(id) {
            match &tree[child].data {
                Data::Text(data) if step.shows_hidden || self.is_visible(id) => {
                    self.push_text(child, data.as_bytes(), out)
                }
                Data::Element(element) if element.html_tag() == name!("br") => out.push('\n'),
                Data::Element(element) if element.pseudo == Pseudo::Marker => {
                    if element
                        .style
                        .as_ref()
                        .is_some_and(|it| it.rare.content != Content::Normal)
                    {
                        match self.alternative_text(child) {
                            Some(text) => out.push_str(text),
                            None => out.push_str(&self.text_content(child)),
                        }
                    }
                }
                Data::Element(element) => {
                    let display = element
                        .style
                        .as_ref()
                        .map_or(Display::Inline, |it| it.display());
                    let alternative = self.alternative_text(child);
                    let is_apart = alternative.is_some()
                        || !matches!(display, Display::Inline | Display::Contents | Display::Ruby);
                    let start = out.len();
                    if is_apart {
                        out.push(' ');
                    }
                    match alternative {
                        Some(alternative) if self.is_visible(child) => out.push_str(alternative),
                        Some(_) => {}
                        None => _ = self.compute(child, walk, step, out),
                    }
                    if is_apart && out.len() == start + 1 && display.is_inline_level() {
                        out.truncate(start);
                    } else if is_apart {
                        out.push(' ');
                    }
                }
                _ => {}
            }
        }
    }

    fn join(&self, nodes: &[NodeId], walk: &mut Walk, step: Step, are_referenced: bool) -> String {
        let mut out = String::new();
        for node in nodes {
            if are_referenced {
                walk.seen.remove(node);
            }
            if !out.is_empty() {
                out.push(' ');
            }
            let shows_hidden = step.shows_hidden || self.is_hidden_above(*node);
            self.compute(
                *node,
                walk,
                Step {
                    is_referenced: are_referenced || step.is_referenced,
                    shows_hidden,
                    is_label: true,
                },
                &mut out,
            );
        }
        out
    }

    pub(super) fn control_text(&self, control: NodeId) -> String {
        let (tree, mut out) = (&self.document.tree, String::new());
        match self.find_part(control, name!("-internal-editor")) {
            Some(editor) => tree
                .children(editor)
                .filter_map(|it| tree[it].text())
                .for_each(|it| out.push_str(text(it))),
            None => self
                .element(control)
                .into_iter()
                .for_each(|it| out.push_str(&it.text_to_show())),
        }
        match self
            .element(control)
            .is_some_and(|it| it.input_type() == name!("password"))
        {
            true => "•".repeat(out.chars().count()),
            false => out,
        }
    }

    pub(super) fn range_text(&self, id: NodeId) -> Option<String> {
        let native = || self.facts(id)?.numbers[0].map(|it| it.to_string());
        let explicit = self
            .aria_text(id, name!("aria-valuetext"))
            .or_else(|| self.aria_text(id, name!("aria-valuenow")));
        explicit.map(str::to_owned).or_else(native)
    }

    fn embedded_value(
        &self,
        id: NodeId,
        role: Role,
        walk: &mut Walk,
        step: Step,
        out: &mut String,
    ) -> bool {
        if is_range(role) {
            let typed = || self.is_text_control(id).then(|| self.control_text(id));
            out.push_str(&self.range_text(id).or_else(typed).unwrap_or_default());
        } else if self.is_text_control(id) {
            out.push_str(&self.control_text(id));
        } else if self.tag(id) == name!("select") {
            out.push_str(&self.selected_labels(id, " "));
        } else if matches!(role, Role::Textbox | Role::Searchbox) {
            self.content(id, walk, step, out);
        } else if matches!(role, Role::Combobox | Role::Listbox) {
            let is_selected = |it: &NodeId| {
                self.aria_is(*it, name!("aria-selected"), "true") && self.role(*it) == Role::Option
            };
            let selected: Nodes = self
                .document
                .tree
                .descendants(id)
                .filter(is_selected)
                .collect();
            match selected.is_empty() && role == Role::Combobox {
                true => self.content(id, walk, step, out),
                false => out.push_str(&self.join(&selected, walk, step, false)),
            }
        } else {
            return false;
        }
        true
    }

    fn native_name(
        &self,
        id: NodeId,
        element: &Element,
        walk: &mut Walk,
        step: Step,
    ) -> Option<(String, NameFrom)> {
        let attribute = |name| {
            element
                .attribute(name)
                .map(|it| (it.to_owned(), NameFrom::Attribute))
        };
        if element.namespace == Namespace::Svg {
            let title = self
                .svg_child_text(id, name!("title"))
                .map(|it| (it, NameFrom::Relation));
            return title.or_else(|| attribute(name!("title http://www.w3.org/1999/xlink")));
        }
        let labels = self.labels_of(id);
        if !labels.is_empty() {
            let label = self.join(&labels, walk, step, false);
            if has_text(&label) {
                return Some((label, NameFrom::Relation));
            }
        }
        let tag = element.html_tag();
        let mut caption = |tag| {
            let found = self
                .document
                .tree
                .element_children(id)
                .find(|it| self.tag(*it) == tag)?;
            Some((self.join(&[found], walk, step, false), NameFrom::Relation))
        };
        match tag {
            _ if tag == name!("fieldset") => caption(name!("legend")),
            _ if tag == name!("table") => {
                caption(name!("caption")).or_else(|| attribute(name!("summary")))
            }
            _ if is_name!(tag, "img" | "area") => attribute(name!("alt")),
            _ if tag == name!("optgroup") => attribute(name!("label")),
            _ if tag == name!("option") && element.style.is_none() => {
                Some((self.option_label(id), NameFrom::Content))
            }
            _ if tag == name!("option") => attribute(name!("label")),
            _ if tag == name!("input") => {
                let (kind, value) = (element.input_type(), || {
                    element
                        .attribute(name!("value"))
                        .map(|it| (it.to_owned(), NameFrom::Value))
                });
                let or = |it: &str| Some((it.to_owned(), NameFrom::Value));
                match kind {
                    _ if kind == name!("image") => attribute(name!("alt"))
                        .or_else(value)
                        .or_else(|| attribute(name!("title")))
                        .or_else(|| or("Submit")),
                    _ if kind == name!("button") => value(),
                    _ if kind == name!("submit") => value().or_else(|| or("Submit")),
                    _ if kind == name!("reset") => value().or_else(|| or("Reset")),
                    _ if kind == name!("file") && id == walk.root => or("Choose File"),
                    _ => None,
                }
            }
            _ => None,
        }
    }

    fn compute(&self, id: NodeId, walk: &mut Walk, step: Step, out: &mut String) -> NameFrom {
        let Some(element) = self.element(id).filter(|_| walk.seen.insert(id)) else {
            return NameFrom::Nothing;
        };
        let is_root = id == walk.root && !step.is_label;
        if is_name!(
            element.tag,
            "script" | "style" | "template" | "noscript" | "title" | "desc" | "rp"
        ) && !step.is_label
        {
            return NameFrom::Nothing;
        }
        if !step.shows_hidden {
            if self.is_aria_hidden(id) || !self.is_rendered(id) {
                return NameFrom::Nothing;
            }
            if !self.is_visible(id) {
                if !is_root {
                    self.content(id, walk, step, out);
                }
                return NameFrom::Nothing;
            }
        }
        if !step.is_referenced {
            let name = self.join(&self.labelled_by(id), walk, step, true);
            if has_text(&name) {
                out.push_str(&name);
                return NameFrom::Relation;
            }
        }
        let role = self.role(id);
        if id != walk.root && self.embedded_value(id, role, walk, step, out) {
            return NameFrom::Value;
        }
        if let Some(label) = self
            .aria_text(id, name!("aria-label"))
            .filter(|_| element.html_tag() != name!("slot"))
        {
            out.push_str(label);
            return NameFrom::Attribute;
        }
        let native = if role == Role::None {
            None
        } else {
            self.native_name(id, element, walk, step)
        };
        let is_empty_on_purpose = native
            .as_ref()
            .is_some_and(|it| it.0.is_empty() && it.1 == NameFrom::Attribute);
        if let Some((name, from)) = native.filter(|it| has_text(&it.0)) {
            out.push_str(&name);
            return from;
        }
        let is_interactive_row = || {
            role == Role::Row
                && self
                    .ancestors(id)
                    .any(|it| matches!(self.role(it), Role::Grid | Role::TreeGrid))
        };
        let title = element.attribute(name!("title"));
        if !is_root
            || is_named_by_content(role) && element.namespace != Namespace::MathMl
            || is_interactive_row()
        {
            let start = out.len();
            self.content(id, walk, step, out);
            if has_text(&out[start..]) || !is_root && title.is_none() {
                return NameFrom::Content;
            }
            out.truncate(start);
        }
        if let Some(title) = title.filter(|it| {
            has_text(it) && !(is_empty_on_purpose && element.html_tag() == name!("img"))
        }) {
            out.push_str(title);
            return NameFrom::Title;
        }
        let placeholder = element
            .attribute(name!("placeholder"))
            .or_else(|| self.aria(id, name!("aria-placeholder")));
        if let Some(placeholder) = placeholder.filter(|it| is_root && has_text(it)) {
            out.push_str(placeholder);
            return NameFrom::Placeholder;
        }
        if is_empty_on_purpose {
            NameFrom::EmptyAttribute
        } else {
            NameFrom::Nothing
        }
    }

    pub(super) fn name(&self, id: NodeId) -> (String, NameFrom) {
        let (mut walk, mut out) = (
            Walk {
                root: id,
                seen: Set::default(),
            },
            String::new(),
        );
        let from = self.compute(
            id,
            &mut walk,
            Step {
                is_referenced: false,
                shows_hidden: false,
                is_label: false,
            },
            &mut out,
        );
        (collapsed(&out), from)
    }

    /// With what is said after the name of a file picker, and of a part of a date.
    pub(super) fn spoken_name(
        &self,
        id: NodeId,
        element: &Element,
        role: Role,
    ) -> (String, NameFrom) {
        let (mut name, from) = self.name(id);
        if from == NameFrom::Title && prohibits_name(role) && !self.supports_focus(id) {
            return (String::new(), NameFrom::Nothing);
        }
        if element.html_tag() == name!("input") && element.input_type() == name!("file") {
            self.document
                .rendered_children(id)
                .last()
                .into_iter()
                .for_each(|it| name = format!("{name}: {}", self.text_content(it)));
        } else if matches!(element.pseudo, Pseudo::Part(_))
            && (role == Role::SpinButton || self.aria(id, name!("aria-haspopup")).is_some())
        {
            let input = self.looked_up(
                self.document
                    .tree
                    .flat_ancestors(id)
                    .find(|it| self.tag(*it) == name!("input"))
                    .into_iter()
                    .collect(),
            );
            input
                .iter()
                .map(|it| self.name(*it).0)
                .filter(|it| !it.is_empty())
                .for_each(|it| name = format!("{name} {it}"));
        }
        (name, from)
    }

    pub(super) fn contents(&self, id: NodeId) -> String {
        let (mut walk, mut out) = (
            Walk {
                root: id,
                seen: Set::default(),
            },
            String::new(),
        );
        self.content(
            id,
            &mut walk,
            Step {
                is_referenced: false,
                shows_hidden: false,
                is_label: false,
            },
            &mut out,
        );
        collapsed(&out)
    }

    /// False if `name` is certainly empty.
    pub(super) fn may_have_name(&self, id: NodeId, role: Role, element: &Element) -> bool {
        is_named_by_content(role)
            || role == Role::Row
            || self.facts(id).is_some()
            || element.namespace == Namespace::Svg
            || self.is_labelable(id)
            || is_name!(
                element.tag,
                "fieldset" | "table" | "img" | "area" | "optgroup"
            )
            || (element.attributes.iter()).any(|it| {
                is_name!(
                    it.name,
                    "aria-label"
                        | "aria-labelledby"
                        | "aria-labeledby"
                        | "title"
                        | "aria-placeholder"
                )
            })
    }

    pub(super) fn description(&self, id: NodeId, name: &str, from: NameFrom) -> String {
        let step = Step {
            is_referenced: true,
            shows_hidden: false,
            is_label: false,
        };
        let describers = self.referenced(id, name!("aria-describedby"));
        if !describers.is_empty() {
            return collapsed(&self.join(
                &describers,
                &mut Walk {
                    root: id,
                    seen: Set::default(),
                },
                step,
                true,
            ));
        }
        if let Some(description) = self.aria_text(id, name!("aria-description")) {
            return collapsed(description);
        }
        let Some(element) = self.element(id) else {
            return String::new();
        };
        let native = match element.html_tag() {
            _ if element.namespace == Namespace::Svg => self
                .svg_child_text(id, name!("desc"))
                .or_else(|| self.svg_child_text(id, name!("title"))),
            tag if tag == name!("input")
                && is_name!(element.input_type(), "button" | "submit" | "reset") =>
            {
                element.attribute(name!("value")).map(str::to_owned)
            }
            tag if tag == name!("table") => {
                let caption = self
                    .document
                    .tree
                    .element_children(id)
                    .find(|it| self.tag(*it) == name!("caption"));
                caption
                    .map(|it| self.text_content(it))
                    .or_else(|| element.attribute(name!("summary")).map(str::to_owned))
            }
            _ => None,
        };
        let title = || {
            element
                .attribute(name!("title"))
                .filter(|_| from != NameFrom::Title)
                .map(collapsed)
                .filter(|it| !self.only_says(id, it))
        };
        let is_news = |it: &String| !it.is_empty() && it != name;
        native
            .map(|it| collapsed(&it))
            .filter(is_news)
            .or_else(|| title().filter(is_news))
            .unwrap_or_default()
    }
}
