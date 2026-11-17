//! The last changes, for lists of nodes that are cheaper to correct than to make again.

use core::cell::Cell;

use smallvec::SmallVec;

use super::arena::Arena;
use super::{Atom, Node, NodeFlags as F, atom};

const LEN: usize = 16;

#[derive(Clone, Copy)]
struct Entry {
    /// The lower half of the version that it has led to.
    version: u32,
    is_removal: bool,
    /// Of the parent, before.
    flags: F,
    node: *const Node,
    parent: *const Node,
}

#[derive(Clone, Copy)]
pub(super) struct Move<'a> {
    pub(super) node: &'a Node,
    pub(super) parent: &'a Node,
    pub(super) is_removal: bool,
}

pub(super) type Few<T> = SmallVec<[T; LEN]>;

struct Journal {
    entries: [Cell<Entry>; LEN],
    /// The nodes of what has led to this version, or to one before, may have been collected.
    expired: Cell<u64>,
}

impl Journal {
    const fn new(version: u64) -> Journal {
        const NONE: Entry = Entry {
            version: 0,
            is_removal: false,
            flags: F::empty(),
            node: core::ptr::null(),
            parent: core::ptr::null(),
        };
        Journal {
            entries: [const { Cell::new(NONE) }; LEN],
            expired: Cell::new(version),
        }
    }

    #[inline(always)]
    fn record(&self, entry: Entry) {
        self.entries[entry.version as usize % LEN].set(entry);
    }

    /// What has led to `version`, and so on backwards, for as long as that is known.
    fn before(&self, version: u64) -> impl Iterator<Item = Entry> {
        let versions = (self.expired.get() + 1..=version).rev().take(LEN);
        versions.map_while(|it| {
            Some(self.entries[it as usize % LEN].get())
                .filter(|entry| entry.version == it as u32 && !entry.node.is_null())
        })
    }

    fn between(&self, old: u64, new: u64) -> Option<Few<Entry>> {
        let count = usize::try_from(new.checked_sub(old)?).ok()?;
        Some(self.before(new).take(count).collect::<Few<_>>()).filter(|it| it.len() == count)
    }
}

/// The attributes that a list depends on.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Reads {
    Nothing,
    /// What elements are called, and what they belong to.
    Ties,
    Classes,
}

pub(super) struct Changes {
    of_tree: Journal,
    /// By `Reads`.
    of_attributes: [Journal; 2],
    versions: [Cell<u64>; 3],
    collections: Cell<u32>,
}

impl Changes {
    pub(super) fn new(version: u64) -> Changes {
        Changes {
            of_tree: Journal::new(version),
            of_attributes: [(); 2].map(|()| Journal::new(version)),
            versions: [(); 3].map(|()| Cell::new(version)),
            collections: Cell::new(0),
        }
    }
}

fn moves<'a>(entries: impl Iterator<Item = Entry>) -> Few<Move<'a>> {
    // SAFETY: a script had them after the last collection.
    entries
        .map(|it| unsafe {
            Move {
                node: &*it.node,
                parent: &*it.parent,
                is_removal: it.is_removal,
            }
        })
        .collect()
}

impl Arena {
    /// After `version` has changed for it.
    #[inline(always)]
    pub(super) fn record_move(&self, node: &Node, parent: &Node, is_removal: bool, flags: F) {
        self.changes.of_tree.record(Entry {
            version: self.version.get() as u32,
            is_removal,
            flags,
            node,
            parent,
        });
    }

    /// Likewise, for text that has no object.
    #[inline(always)]
    pub(super) fn record_bare_text(&self, parent: &Node) {
        self.record_move(parent, parent, false, F::empty());
    }

    #[inline]
    pub(super) fn record_attribute(&self, element: &Node, name: &Atom) {
        let reads = match name.known() {
            atom!("class") => Reads::Classes,
            atom!("id")
            | atom!("name")
            | atom!("for")
            | atom!("form")
            | atom!("type")
            | atom!("href") => Reads::Ties,
            _ => return,
        };
        let version = &self.changes.versions[reads as usize];
        version.update(|it| it + 1);
        self.changes.of_attributes[reads as usize - 1].record(Entry {
            version: version.get() as u32,
            is_removal: false,
            flags: F::empty(),
            node: element,
            parent: element,
        });
    }

    /// In a way that may affect any element.
    pub(super) fn ties_changed(&self) {
        self.changes.versions[Reads::Ties as usize].update(|it| it + 1);
    }

    /// Likewise.
    pub(super) fn classes_changed(&self) {
        self.changes.versions[Reads::Classes as usize].update(|it| it + 1);
    }

    pub(super) fn collections(&self) -> u32 {
        self.barrier.collections()
    }

    #[inline(always)]
    pub(super) fn version_of(&self, reads: Reads) -> u64 {
        self.changes.versions[reads as usize].get()
    }

    fn forget_what_may_be_collected(&self) {
        let collections = self.collections();
        if self.changes.collections.replace(collections) != collections {
            self.changes.of_tree.expired.set(self.version.get());
            self.changes
                .of_attributes
                .iter()
                .zip(&self.changes.versions[1..])
                .for_each(|(journal, version)| journal.expired.set(version.get()));
        }
    }

    /// The first first. They are for use until something is allocated.
    pub(super) fn moves_since(&self, version: u64) -> Option<Few<Move<'_>>> {
        self.forget_what_may_be_collected();
        Some(moves(
            self.changes
                .of_tree
                .between(version, self.version.get())?
                .into_iter()
                .rev()
                .filter(|it| it.node != it.parent),
        ))
    }

    /// From and to `parent`, since it has lost `flag`.
    pub(super) fn moves_since_loss(&self, parent: &Node, flag: F) -> Option<Few<Move<'_>>> {
        self.forget_what_may_be_collected();
        let mut own = Few::new();
        for entry in self
            .changes
            .of_tree
            .before(self.version.get())
            .filter(|it| core::ptr::eq(it.parent, parent))
        {
            (!core::ptr::eq(entry.node, parent)).then_some(())?;
            own.push(entry);
            if entry.flags.contains(flag) {
                return Some(moves(own.into_iter().rev()));
            }
        }
        None
    }

    /// The elements whose attributes have changed.
    pub(super) fn changed_since(&self, reads: Reads, version: u64) -> Option<Few<&Node>> {
        if self.version_of(reads) == version {
            return Some(Few::new());
        }
        self.forget_what_may_be_collected();
        let entries = self.changes.of_attributes[reads as usize - 1]
            .between(version, self.version_of(reads))?;
        Some(
            moves(entries.into_iter())
                .into_iter()
                .map(|it| it.node)
                .collect(),
        )
    }
}
