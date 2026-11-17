use super::roles::simple_states;
use super::{Connection, Object, Value};
use crate::abi::accessibility::{self as abi, Number, Relation, Role, Text};
use crate::accessibility::forest::{Event, Forest, Id};

struct Emitter<'a> {
    connection: &'a Connection,
    forest: &'a Forest,
}

impl Emitter<'_> {
    fn emit(
        &self,
        object: Object,
        class: &str,
        member: &str,
        detail: &str,
        numbers: [usize; 2],
        data: Value,
    ) {
        let body = vec![
            detail.into(),
            Value::I32(numbers[0] as i32),
            Value::I32(numbers[1] as i32),
            data.variant(),
            Value::options([]),
        ];
        self.connection.bus.emit(
            &object.path(),
            &format!("org.a11y.atspi.Event.{class}"),
            member,
            body,
        );
    }

    fn state(&self, object: Object, name: &str, is_on: bool) {
        self.emit(
            object,
            "Object",
            "StateChanged",
            name,
            [is_on.into(), 0],
            Value::I32(0),
        );
    }

    fn plain(&self, id: Id, member: &str) {
        self.emit(
            Object::Node(id),
            "Object",
            member,
            "",
            [0; 2],
            Value::I32(0),
        );
    }

    fn child(&self, parent: Object, detail: &str, index: usize, child: Object) {
        self.emit(
            parent,
            "Object",
            "ChildrenChanged",
            detail,
            [index, 0],
            self.connection.reference(Some(child)),
        );
    }

    fn text_changed(&self, id: Id, detail: &str, at: usize, text: &str) {
        if !text.is_empty() {
            self.emit(
                Object::Node(id),
                "Object",
                "TextChanged",
                detail,
                [at, text.chars().count()],
                text.into(),
            );
        }
    }

    fn windows(&self) {
        let now: Vec<_> = self.forest.windows().collect();
        let before = self.connection.windows.replace(now.clone());
        for (detail, member, these, others) in [
            ("remove", "Destroy", &before, &now),
            ("add", "Create", &now, &before),
        ] {
            for (index, window) in these.iter().enumerate().filter(|it| !others.contains(it.1)) {
                self.child(Object::Application, detail, index, Object::Window(*window));
                self.emit(
                    Object::Window(*window),
                    "Window",
                    member,
                    "",
                    [0; 2],
                    "".into(),
                );
            }
        }
        let active = now.into_iter().find(|it| self.forest.is_window_active(*it));
        let was_active = self.connection.active.replace(active);
        for (window, member) in [(was_active, "Deactivate"), (active, "Activate")]
            .into_iter()
            .filter(|_| was_active != active)
        {
            if let Some(window) = window.map(Object::Window) {
                self.emit(window, "Window", member, "", [0; 2], "".into());
                self.state(window, "active", member == "Activate");
            }
        }
    }

    fn focus(&self, to: Option<Id>) {
        let from = self
            .connection
            .focused
            .replace(to)
            .filter(|it| Some(*it) != to && self.forest.get(*it).is_some());
        for (id, is_focused) in [(from, false), (to, true)] {
            id.into_iter()
                .for_each(|it| self.state(Object::Node(it), "focused", is_focused));
        }
    }

    fn caret_moved(&self, tree: u32, has_selected: bool) -> Option<()> {
        let [_, caret] = self.forest.selection(tree)?;
        let holder = self.forest.holder_of_text(caret.node);
        let block = self.forest.hypertext(holder);
        let offset = block.text[..self
            .forest
            .offset_in_hypertext(&block, caret, false)
            .unwrap_or(0)]
            .chars()
            .count();
        if has_selected {
            self.emit(
                Object::Node(holder),
                "Object",
                "TextSelectionChanged",
                "",
                [0; 2],
                "".into(),
            );
        }
        self.emit(
            Object::Node(holder),
            "Object",
            "TextCaretMoved",
            "",
            [offset, 0],
            Value::I32(0),
        );
        Some(())
    }

    fn states_changed(&self, id: Id, changed: u64) -> Option<()> {
        let node = self.forest.get(id)?;
        let before = simple_states(node.role, node.states ^ changed);
        simple_states(node.role, node.states)
            .zip(before)
            .filter(|it| it.0.2 != it.1.2)
            .for_each(|it| self.state(Object::Node(id), it.0.1, it.0.2));
        if changed & abi::LOADING != 0 && !node.has(abi::LOADING) {
            self.emit(
                Object::Node(id),
                "Document",
                "LoadComplete",
                "",
                [0; 2],
                "".into(),
            );
        }
        if changed & abi::SELECTED != 0 {
            self.plain(self.forest.selection_container(id)?, "SelectionChanged");
        }
        Some(())
    }

    fn take(&self, event: &Event) -> Option<()> {
        let forest = self.forest;
        let property = |id, name, value| {
            self.emit(
                Object::Node(id),
                "Object",
                "PropertyChange",
                name,
                [0; 2],
                value,
            )
        };
        match event {
            Event::Destroyed(id, _) => {
                let gone = self.connection.reference(Some(Object::Node(*id)));
                self.connection.bus.emit(
                    "/org/a11y/atspi/cache",
                    "org.a11y.atspi.Cache",
                    "RemoveAccessible",
                    vec![gone],
                );
            }
            Event::RootsChanged(window) => {
                forest
                    .roots(*window)
                    .into_iter()
                    .enumerate()
                    .for_each(|it| {
                        self.child(Object::Window(*window), "add", it.0, Object::Node(it.1))
                    });
            }
            Event::ChildrenChanged {
                parent,
                added,
                removed,
            } if !forest.is_leaf(*parent) => {
                removed.iter().for_each(|it| {
                    self.child(Object::Node(*parent), "remove", 0, Object::Node(*it))
                });
                let children = forest
                    .children(*parent)
                    .enumerate()
                    .filter(|it| added.contains(&it.1));
                children.for_each(|it| {
                    self.child(Object::Node(*parent), "add", it.0, Object::Node(it.1))
                });
            }
            Event::Created(id) => {
                let node = forest.get(*id)?;
                if matches!(
                    node.role,
                    Role::Alert | Role::AlertDialog | Role::Dialog | Role::Menu | Role::Tooltip
                ) {
                    self.state(Object::Node(*id), "showing", true);
                }
                if !node.is_text()
                    && forest.exposed(*id) == *id
                    && forest.live_region(*id).is_some()
                {
                    self.text_changed(*id, "insert", 0, &forest.hypertext(*id).text);
                }
            }
            Event::Loaded(id) => self.emit(
                Object::Node(*id),
                "Document",
                "LoadComplete",
                "",
                [0; 2],
                "".into(),
            ),
            Event::Focused { window, to } => {
                self.focus(to.filter(|_| forest.is_window_active(*window)))
            }
            Event::ActiveDescendantChanged(id) => {
                let active = forest.related(*id, Relation::ActiveDescendant).next()?;
                let index = forest.index_in_parent(active).unwrap_or(0);
                self.emit(
                    Object::Node(*id),
                    "Object",
                    "ActiveDescendantChanged",
                    "",
                    [index, 0],
                    self.connection.reference(Some(Object::Node(active))),
                );
            }
            Event::NameChanged(id) if forest.exposed(*id) == *id => {
                property(*id, "accessible-name", forest.get(*id)?.name().into())
            }
            Event::DescriptionChanged(id) => property(
                *id,
                "accessible-description",
                forest
                    .get(*id)?
                    .text(Text::Description)
                    .unwrap_or_default()
                    .into(),
            ),
            Event::ValueChanged(id) => property(
                *id,
                "accessible-value",
                Value::F64(forest.get(*id)?.number(Number::Now).unwrap_or(0.)),
            ),
            Event::StatesChanged(id, changed) => self.states_changed(*id, *changed)?,
            Event::TextChanged(id, Text::Invalid) => self.state(
                Object::Node(*id),
                "invalid-entry",
                forest.get(*id)?.text(Text::Invalid).is_some(),
            ),
            Event::TextChanged(id, Text::Current) => self.state(
                Object::Node(*id),
                "active",
                forest.get(*id)?.text(Text::Current).is_some(),
            ),
            Event::TextChanged(id, _) => self.plain(*id, "AttributesChanged"),
            Event::HypertextChanged {
                id,
                at,
                deleted,
                inserted,
            } => {
                self.text_changed(*id, "delete", *at, deleted);
                self.text_changed(*id, "insert", *at, inserted);
            }
            Event::Edited { field, .. } => self.caret_moved(field.tree, false)?,
            Event::SelectionChanged {
                extends: false,
                follows_edit: true,
                ..
            } => {}
            Event::SelectionChanged {
                within,
                extends,
                was_extended,
                ..
            } => self.caret_moved(within.tree, *extends || *was_extended)?,
            Event::Announced {
                tree,
                text,
                is_urgent,
            } => {
                self.emit(
                    Object::Node(forest.root_of(*tree)?),
                    "Object",
                    "Announcement",
                    "",
                    [1 + usize::from(*is_urgent), 0],
                    text.as_str().into(),
                );
            }
            _ => {}
        }
        Some(())
    }
}

pub fn emit(connection: &Connection, forest: &Forest, events: &[Event]) {
    let emitter = Emitter { connection, forest };
    if events.iter().any(|it| {
        matches!(
            it,
            Event::RootsChanged(_) | Event::Focused { .. } | Event::ActivationChanged
        )
    }) {
        emitter.windows();
    }
    let mut ordered: Vec<_> = events.iter().collect();
    ordered.sort_by_key(|it| match it {
        Event::SelectionChanged {
            follows_focus: true,
            ..
        } => 0,
        Event::StatesChanged(_, changed) if changed & abi::SELECTED != 0 => 2,
        _ => 1,
    });
    ordered.into_iter().for_each(|it| _ = emitter.take(it));
}
