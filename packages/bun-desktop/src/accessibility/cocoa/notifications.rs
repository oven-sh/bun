use super::{Extra, Value, is_row};
use crate::abi::accessibility::{self as abi, Relation, Role, Text};
use crate::accessibility::forest::{Event, Forest, Granularity, Id, Node};

pub struct Notification {
    pub name: &'static str,
    pub target: Value,
    pub info: Option<Value>,
    /// VoiceOver misses it if it comes together with others, or the focus may be on its way to another page.
    pub is_delayed: bool,
}

const FOCUS: &str = "AXFocusedUIElementChanged";

struct Poster<'a> {
    forest: &'a Forest,
    all: Vec<Notification>,
    focus_has_moved: bool,
}

impl Poster<'_> {
    fn post(&mut self, name: &'static str, id: Id) {
        let is_same = |it: &Notification| {
            it.name == name && matches!(it.target, Value::Element(other) if other == id)
        };
        if name == "AXUIElementDestroyed" || !self.all.iter().any(is_same) {
            let is_passing = name == FOCUS
                && self
                    .forest
                    .get(id)
                    .is_some_and(|it| it.role == Role::WebArea);
            self.all.push(Notification {
                name,
                target: Value::Element(id),
                info: None,
                is_delayed: is_passing || name == "AXLiveRegionChanged",
            });
        }
    }

    fn post_with(&mut self, name: &'static str, target: Value, info: Vec<(&'static str, Value)>) {
        self.all.push(Notification {
            name,
            target,
            info: Some(Value::Dictionary(info)),
            is_delayed: false,
        });
    }

    /// To the page as well.
    fn post_twice(
        &mut self,
        name: &'static str,
        id: Id,
        info: impl Fn() -> Vec<(&'static str, Value)>,
    ) {
        for target in std::iter::once(id).chain(self.forest.root_of(id.tree).filter(|it| *it != id))
        {
            self.post_with(name, Value::Element(target), info());
        }
    }

    fn selected_changed(&mut self, id: Id) {
        let forest = self.forest;
        let Some(container) = forest.selection_container(id) else {
            return;
        };
        let has_rows = forest
            .get(container)
            .is_some_and(|it| it.is_table() || it.role == Role::Tree);
        if !has_rows
            && !self.focus_has_moved
            && forest.is_focused(id)
            && forest
                .get(container)
                .is_some_and(|it| it.has(abi::MULTISELECTABLE))
        {
            // VoiceOver only reads out what is new to it.
            self.post("AXUIElementDestroyed", id);
            return self.post(FOCUS, id);
        }
        let is_used = || {
            let focus = forest
                .place_of(id.tree)
                .and_then(|it| forest.real_focus(it.0));
            focus.is_some_and(|it| {
                forest.contains(container, it)
                    || forest
                        .related(it, Relation::Controls)
                        .any(|it| it == container)
            })
        };
        if !has_rows
            && forest
                .members(container, |it| it.has(abi::SELECTED))
                .is_empty()
            && !is_used()
        {
            return;
        }
        self.post(
            if has_rows {
                "AXSelectedRowsChanged"
            } else {
                "AXSelectedChildrenChanged"
            },
            container,
        );
        if forest.get(id).is_some_and(|it| it.role == Role::Tab) {
            self.post("AXValueChanged", id);
        }
    }

    fn states_changed(&mut self, id: Id, node: &Node, changed: u64) {
        if changed & (abi::CHECKED | abi::MIXED) != 0 {
            self.post("AXValueChanged", id);
        }
        if changed & abi::EXPANDED != 0 {
            let of_row = if node.has(abi::EXPANDED) {
                "AXRowExpanded"
            } else {
                "AXRowCollapsed"
            };
            self.post(
                if is_row(node) {
                    of_row
                } else {
                    "AXExpandedChanged"
                },
                id,
            );
        }
        if changed & abi::SELECTED != 0 {
            self.selected_changed(id);
        }
        if changed & abi::BUSY != 0 {
            self.post_with(
                "AXElementBusyChanged",
                Value::Element(id),
                vec![("AXElementBusy", Value::Bool(node.has(abi::BUSY)))],
            );
        }
        if changed & abi::LOADING != 0 && !node.has(abi::LOADING) {
            self.loaded(id);
        }
    }

    fn loaded(&mut self, id: Id) {
        if self.forest.parent(id).is_some() {
            self.post("AXLayoutComplete", id);
        } else if self
            .forest
            .place_of(id.tree)
            .is_some_and(|it| self.forest.is_window_active(it.0))
        {
            self.post("AXLoadComplete", id);
        }
    }

    /// `kind`: an `AXTextStateChangeType`
    fn selection_changed(
        &mut self,
        within: Id,
        kind: u8,
        direction: u8,
        granularity: Granularity,
        follows_focus: bool,
    ) {
        let Some(range) = self.forest.selection(within.tree) else {
            return;
        };
        self.post_twice("AXSelectedTextChanged", within, || {
            let mut info = vec![
                ("AXTextStateChangeType", Value::Number(kind.into())),
                ("AXTextSelectionDirection", Value::Number(direction.into())),
                (
                    "AXTextSelectionGranularity",
                    Value::Number((granularity as u8).into()),
                ),
                ("AXTextSelectionChangedFocus", Value::Bool(follows_focus)),
                ("AXTextChangeElement", Value::Element(within)),
                ("AXSelectedTextMarkerRange", Value::MarkerRange(range)),
            ];
            info.extend(
                (granularity == Granularity::Unknown)
                    .then_some(("AXTextStateSync", Value::Bool(true))),
            );
            info
        });
    }

    fn edited(&mut self, field: Id, at: usize, deleted: &str, inserted: &str) {
        let block = self.forest.field_text(field);
        let is_at_end = || {
            self.forest.selection(field.tree).is_some_and(|it| {
                it.iter()
                    .all(|it| block.offset_of(self.forest, *it) == Some(block.text.len()))
            })
        };
        let was_completed = self
            .forest
            .get(field)
            .is_some_and(|it| it.role == Role::Combobox)
            && [deleted, inserted].iter().any(|it| it.chars().count() > 1)
            && is_at_end();
        let (at, deleted, inserted) = if was_completed {
            (0, "", &*block.text)
        } else {
            (at, deleted, inserted)
        };
        let start = block.position(at, false);
        let change = |kind: u8, text: &str| {
            let mut change = vec![
                ("AXTextEditType", Value::Number(kind.into())),
                ("AXTextChangeValue", Value::Text(text.to_owned())),
                (
                    "AXTextChangeValueLength",
                    Value::Number(text.encode_utf16().count() as f64),
                ),
            ];
            change.extend(start.map(|it| ("AXTextChangeValueStartMarker", Value::Marker(it))));
            (!text.is_empty()).then_some(Value::Dictionary(change))
        };
        let (delete, insert) = (1, if inserted.chars().count() > 1 { 2 } else { 3 });
        self.post_twice("AXValueChanged", field, || {
            vec![
                ("AXTextStateChangeType", Value::Number(1.)),
                (
                    "AXTextChangeValues",
                    Value::List(
                        change(delete, deleted)
                            .into_iter()
                            .chain(change(insert, inserted))
                            .collect(),
                    ),
                ),
                ("AXTextChangeElement", Value::Element(field)),
            ]
        });
    }

    fn take(&mut self, event: &Event) -> Option<()> {
        let forest = self.forest;
        match event {
            Event::Destroyed(id, role) => {
                if matches!(role, Role::Menu | Role::MenuListPopup)
                    && let Some(root) = forest.root_of(id.tree)
                {
                    self.post("AXMenuClosed", root);
                }
                self.post("AXUIElementDestroyed", *id);
            }
            Event::Created(id) => match forest.get(*id)?.role {
                Role::Menu | Role::MenuListPopup => self.post("AXMenuOpened", *id),
                _ => {}
            },
            Event::RootsChanged(window) => self.all.push(Notification {
                name: "AXLayoutChanged",
                target: Value::View(*window),
                info: None,
                is_delayed: false,
            }),
            Event::ChildrenChanged {
                parent,
                added,
                removed,
            } => {
                let holds_rows = matches!(
                    forest.get(*parent)?.role,
                    Role::RowGroup | Role::Tree | Role::TreeItem | Role::Group
                ) || forest.get(*parent)?.is_table();
                if holds_rows && added.len() != removed.len() {
                    self.post(
                        "AXRowCountChanged",
                        forest.closest(*parent, |it| it.is_table() || it.role == Role::Tree)?,
                    );
                }
            }
            Event::Loaded(id) => self.loaded(*id),
            Event::Focused { window, to } if forest.is_window_active(*window) => {
                self.post(FOCUS, forest.exposed((*to)?))
            }
            Event::ActiveDescendantChanged(id) => match forest.get(*id)? {
                node if node.role == Role::Tree => self.post("AXSelectedRowsChanged", *id),
                node if node.has(abi::MENU_LIST) => self.post(
                    "AXMenuItemSelected",
                    forest.related(*id, Relation::ActiveDescendant).next()?,
                ),
                node if node.role == Role::Combobox => self.post("AXSelectedChildrenChanged", *id),
                _ => {}
            },
            Event::NameChanged(id)
                if forest.exposed(*id) == *id && !forest.get(*id)?.has(abi::EDITABLE)
                    || forest.get(*id)?.has(abi::TEXT_FIELD) =>
            {
                self.post(
                    if forest.get(*id)?.is_text() {
                        "AXValueChanged"
                    } else {
                        "AXTitleChanged"
                    },
                    *id,
                );
            }
            // VoiceOver would name the color instead of what is adjusted in the pop-up.
            Event::ValueChanged(id)
                if forest.get(*id)?.role == Role::ColorWell && !forest.is_focused(*id) => {}
            Event::ValueChanged(id) => self.post("AXValueChanged", *id),
            Event::StatesChanged(id, changed) => {
                self.states_changed(*id, forest.get(*id)?, *changed)
            }
            Event::TextChanged(id, Text::Invalid) => self.post("AXInvalidStatusChanged", *id),
            Event::TextChanged(id, Text::Current) => self.post("AXCurrentStateChanged", *id),
            Event::TextChanged(id, _) => self.post("AXSortDirectionChanged", *id),
            Event::Edited {
                field,
                at,
                deleted,
                inserted,
            } => self.edited(*field, *at, deleted, inserted),
            Event::SelectionChanged {
                within,
                follows_edit: true,
                ..
            } => self.selection_changed(*within, 1, 0, Granularity::Unknown, true),
            Event::SelectionChanged {
                within,
                extends,
                direction,
                granularity,
                follows_focus,
                ..
            } => {
                self.selection_changed(
                    *within,
                    if *extends { 3 } else { 2 },
                    *direction as u8,
                    *granularity,
                    *follows_focus,
                );
            }
            Event::LiveRegionCreated(id) => {
                self.post("AXLiveRegionCreated", *id);
                if forest.get(*id)?.role == Role::Alert {
                    self.post("AXLiveRegionChanged", *id);
                }
            }
            Event::LiveRegionChanged(region) => self.post("AXLiveRegionChanged", *region),
            Event::Announced {
                tree,
                text,
                is_urgent,
            } => {
                let info = vec![
                    ("AXAnnouncementKey", Value::Text(text.clone())),
                    (
                        "AXPriorityKey",
                        Value::Number(if *is_urgent { 90. } else { 50. }),
                    ),
                ];
                self.post_with(
                    "AXAnnouncementRequested",
                    Value::Window(forest.place_of(*tree)?.0),
                    info,
                );
            }
            _ => {}
        }
        Some(())
    }
}

pub fn notifications(forest: &Forest, events: &[Event]) -> Vec<Notification> {
    let mut poster = Poster {
        forest,
        all: Vec::new(),
        focus_has_moved: events.iter().any(|it| matches!(it, Event::Focused { .. })),
    };
    let (first, rest): (Vec<_>, Vec<_>) = events.iter().partition(|it| {
        matches!(
            it,
            Event::Focused { .. }
                | Event::SelectionChanged {
                    follows_edit: true,
                    ..
                }
        )
    });
    first
        .into_iter()
        .chain(rest)
        .for_each(|it| _ = poster.take(it));
    // What is around the focus bears on what is said about it.
    if let Some(&Notification {
        name: FOCUS,
        target: Value::Element(focus),
        ..
    }) = poster
        .all
        .iter()
        .find(|it| it.name == FOCUS)
        .filter(|_| poster.focus_has_moved)
    {
        let is_around = |it: &Notification| matches!(it.target, Value::Element(it) if it != focus && forest.contains(it, focus));
        poster
            .all
            .sort_by_key(|it| !(it.name == "AXSelectedTextChanged" || is_around(it)));
    }
    if events.iter().any(|it| matches!(it, Event::Destroyed(..))) {
        Extra::remove_orphans(forest)
            .into_iter()
            .for_each(|it| poster.post("AXUIElementDestroyed", it));
    }
    poster.all
}
