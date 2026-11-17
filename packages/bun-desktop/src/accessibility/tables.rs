//! Where something is among its kind, which is only worked out if it is asked for.

use std::ops::Range;
use std::rc::Rc;

use super::forest::{Forest, Id, Node};
use crate::abi::accessibility::{self as abi, Number, Relation, Role};

#[derive(Clone)]
pub struct Cell {
    pub id: Id,
    pub rows: Range<usize>,
    pub columns: Range<usize>,
}

pub struct Grid {
    table: Id,
    pub rows: Vec<Id>,
    pub columns: usize,
    pub cells: Vec<Cell>,
}

impl Grid {
    pub fn at(&self, row: usize, column: usize) -> Option<Id> {
        self.cells
            .iter()
            .find(|it| it.rows.contains(&row) && it.columns.contains(&column))
            .map(|it| it.id)
    }
}

fn kind_of_set(role: Role) -> Option<Role> {
    use Role::*;
    match role {
        Article | Comment | ListItem | MenuItem | Option | Radio | Tab | TreeItem => Some(role),
        DocBiblioEntry | DocEndnote => Some(ListItem),
        MenuItemCheckbox | MenuItemRadio => Some(MenuItem),
        _ => core::option::Option::None,
    }
}

fn holds_sets(node: &Node) -> bool {
    use Role::*;
    matches!(
        node.role,
        List | Listbox
            | Menu
            | Menubar
            | TabList
            | RadioGroup
            | Tree
            | Feed
            | Group
            | MenuListPopup
            | DocBibliography
            | DocEndnotes
    )
}

impl Node {
    pub fn may_be_in_set(&self) -> bool {
        kind_of_set(self.role).is_some() || self.number(Number::PositionInSet).is_some()
    }

    pub fn is_set(&self) -> bool {
        holds_sets(self) && self.role != Role::Group || self.has(abi::MENU_LIST)
    }
}

impl Forest {
    /// Not those of a nested table or tree.
    pub fn members(&self, container: Id, is_member: impl Fn(&Node) -> bool) -> Vec<Id> {
        let (mut found, mut pending) = (
            Vec::new(),
            self.children(container).rev().collect::<Vec<_>>(),
        );
        while let Some(id) = pending.pop() {
            let Some(node) = self
                .get(id)
                .filter(|it| !it.is_table() && it.role != Role::Tree)
            else {
                continue;
            };
            found.extend(is_member(node).then_some(id));
            pending.extend(self.children(id).rev().filter(|_| !node.is_cell()));
        }
        found
    }

    pub fn grid(&self, table: Id) -> Rc<Grid> {
        if let Some(grid) = self
            .last_grid
            .borrow()
            .as_ref()
            .filter(|it| it.table == table)
        {
            return Rc::clone(grid);
        }
        let (rows, mut cells, mut taken_until) = (
            self.members(table, |it| it.role == Role::Row),
            Vec::new(),
            Vec::new(),
        );
        for (row, id) in rows.iter().enumerate() {
            let mut column = 0;
            for id in self.members(*id, Node::is_cell) {
                let span = |key| {
                    self.get(id)
                        .and_then(|it| it.number(key))
                        .map_or(1, |it| it as usize)
                };
                let (down, across) = (
                    span(Number::RowSpan),
                    span(Number::ColumnSpan).clamp(1, 1000),
                );
                let bottom = if down == 0 {
                    rows.len()
                } else {
                    rows.len().min(row.saturating_add(down))
                };
                while taken_until.get(column).is_some_and(|it| *it > row) {
                    column += 1;
                }
                let columns = column..column + across;
                taken_until.resize(taken_until.len().max(columns.end), 0);
                taken_until[columns.clone()].fill(bottom);
                column = columns.end;
                cells.push(Cell {
                    id,
                    rows: row..bottom,
                    columns,
                });
            }
        }
        let grid = Rc::new(Grid {
            table,
            rows,
            columns: taken_until.len(),
            cells,
        });
        self.last_grid.replace(Some(Rc::clone(&grid)));
        grid
    }

    pub fn cell(&self, id: Id) -> Option<Cell> {
        self.grid(self.closest(id, Node::is_table)?)
            .cells
            .iter()
            .find(|it| it.id == id)
            .cloned()
    }

    /// Of a cell, or of a whole table.
    pub fn headers(&self, id: Id, role: Role) -> Vec<Id> {
        let has_role = |it: &Id| self.get(*it).is_some_and(|it| it.role == role);
        let explicit: Vec<_> = self
            .related(id, Relation::Headers)
            .filter(has_role)
            .collect();
        let Some(table) = self
            .closest(id, Node::is_table)
            .filter(|_| explicit.is_empty())
        else {
            return explicit;
        };
        let extent = |it: &Cell| {
            if role == Role::ColumnHeader {
                it.columns.clone()
            } else {
                it.rows.clone()
            }
        };
        let own = self.cell(id).map(|it| extent(&it));
        let applies = |it: &&Cell| {
            has_role(&it.id)
                && it.id != id
                && own
                    .as_ref()
                    .is_none_or(|own| extent(it).start < own.end && own.start < extent(it).end)
        };
        self.grid(table)
            .cells
            .iter()
            .filter(applies)
            .map(|it| it.id)
            .collect()
    }

    fn set_of(&self, id: Id, node: &Node) -> Option<Vec<Id>> {
        let group: Vec<_> = self.related(id, Relation::RadioGroup).collect();
        if !group.is_empty() {
            return Some(group);
        }
        let is_plain = |it: &Node| matches!(it.role, Role::Generic | Role::Label);
        let container = self
            .closest(self.parent(id)?, |it| !is_plain(it))
            .filter(|it| self.get(*it).is_some_and(holds_sets))?;
        let (kind, level) = (kind_of_set(node.role)?, |it: &Node| {
            it.number(Number::Level).unwrap_or(1.)
        });
        let (mut set, mut pending) = (
            Vec::new(),
            self.children(container).rev().collect::<Vec<_>>(),
        );
        while let Some(other) = pending.pop() {
            match self.get(other)? {
                it if is_plain(it) => pending.extend(self.children(other).rev()),
                it if kind_of_set(it.role) != Some(kind) || level(it) > level(node) => {}
                it if level(it) == level(node) => set.push(other),
                _ if set.contains(&id) => break,
                _ => set.clear(),
            }
        }
        Some(set)
    }

    /// The position, from 1, and the size of the set.
    pub fn place_in_set(&self, id: Id) -> Option<[f64; 2]> {
        let node = self.get(id)?;
        let given = [Number::PositionInSet, Number::SetSize].map(|it| node.number(it));
        if let [Some(position), Some(size)] = given {
            return Some([position, size]);
        }
        let set = self
            .set_of(id, node)
            .or_else(|| given[0].map(|_| vec![id]))?;
        Some([
            given[0].or_else(|| Some(set.iter().position(|it| *it == id)? as f64 + 1.))?,
            given[1].unwrap_or(set.len() as f64),
        ])
    }

    /// Of the set that it is in, or that it holds.
    pub fn size_of_set(&self, id: Id) -> Option<f64> {
        let item = if self.get(id)?.is_set() {
            self.descendants(id)
                .find(|it| *it != id && self.get(*it).is_some_and(Node::may_be_in_set))?
        } else {
            id
        };
        Some(self.place_in_set(item)?[1])
    }
}
