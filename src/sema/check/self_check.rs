//! Two evaluations of one key have to agree: a check that a check without steps makes of itself.
//!
//! An entry is written at once (`Task::may_write_at_once`) on the strength of a rule: nothing that its evaluation has
//! read depends on more than the program. Then two tasks that evaluate one key get one value. A task that finds that
//! another one was first has both values at hand and compares them. A difference is a hole in the rule: it is counted, by
//! table, and the first few are kept to be printed. On request the same is done for what has waited for a commit and
//! lost (`View::compares_lost`), where a difference need not be a mistake: a result of a cycle depends on where
//! the cycle was entered.

use super::Checker;
use super::sink::Arg;
use super::task::{Task, table_names};
use crate::atom::Atom;
use crate::program::FileId;
use crate::types::{ComponentsId, Follow, MapperId, SigId, TypeId, Visitor};
use crate::util::FxHasher;
use std::fmt::Write as _;
use std::hash::{Hash, Hasher};

/// Something that a key or a value mentions.
#[derive(Copy, Clone)]
pub(crate) enum Mention {
    Atom(Atom),
    Components(ComponentsId),
    Mapper(MapperId),
    Sig(SigId),
    Type(TypeId),
    File(FileId),
    /// A key of a table keyed by node: the file, and the number of the node among those of its kind.
    Node(FileId, u32),
    /// The hash of anything else.
    Plain(u64),
}

/// An entry for which another task was first, with another value. Every id in it is published.
pub struct Differing {
    /// Of the table: an index in `table_names`.
    slot: u32,
    key: Vec<Mention>,
    /// The value that is stored, and the one that was computed in vain: the first `Mentions::KEPT` mentions of each.
    stored: Vec<Mention>,
    computed: Vec<Mention>,
    /// The file that the task that has computed the latter was visiting.
    computed_in: Option<FileId>,
}

#[derive(Default)]
pub struct DifferingEntries {
    /// How many there were, by slot. No longer than it has to be.
    pub by_table: Vec<u64>,
    /// The first `KEPT` of them.
    pub first: Vec<Differing>,
}

impl DifferingEntries {
    const KEPT: usize = 24;

    pub fn add(&mut self, more: DifferingEntries) {
        let tables = self.by_table.len().max(more.by_table.len());
        self.by_table.resize(tables, 0);
        for (sum, more) in self.by_table.iter_mut().zip(more.by_table) {
            *sum += more;
        }
        let room = Self::KEPT.saturating_sub(self.first.len());
        self.first.extend(more.first.into_iter().take(room));
    }

    /// `entry`: called if there is room for one more.
    fn count(&mut self, slot: u32, entry: impl FnOnce() -> Differing) {
        if self.by_table.len() <= slot as usize {
            self.by_table.resize(slot as usize + 1, 0);
        }
        self.by_table[slot as usize] += 1;
        if self.first.len() < Self::KEPT {
            self.first.push(entry());
        }
    }
}

pub(crate) struct Mentions(Vec<Mention>);

impl Mentions {
    const KEPT: usize = 6;

    pub(crate) fn of(value: &impl Follow) -> Vec<Mention> {
        let mut mentions = Mentions(Vec::new());
        value.visit(&mut mentions);
        mentions.0
    }

    fn push(&mut self, mention: Mention) {
        if self.0.len() < Self::KEPT {
            self.0.push(mention);
        }
    }
}

impl Visitor for Mentions {
    const IS_ORDERED: bool = true;
    fn atom(&mut self, atom: Atom) {
        self.push(Mention::Atom(atom));
    }
    fn components(&mut self, id: ComponentsId) {
        self.push(Mention::Components(id));
    }
    fn mapper(&mut self, id: MapperId) {
        self.push(Mention::Mapper(id));
    }
    fn sig(&mut self, id: SigId) {
        self.push(Mention::Sig(id));
    }
    fn ty(&mut self, id: TypeId) {
        self.push(Mention::Type(id));
    }
    fn file(&mut self, file: FileId) {
        self.push(Mention::File(file));
    }
    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        let mut hasher = FxHasher::default();
        value.hash(&mut hasher);
        self.push(Mention::Plain(hasher.finish()));
    }
    fn handle(&mut self, _: u32) {}
}

/// Whether two values of one table are equal. Every id in them is published. By a hash, since a value need not be
/// comparable.
pub(crate) fn is_same_value<T: Follow>(a: &T, b: &T) -> bool {
    let hash_of = |value: &T| {
        let mut hash = HashOfValue(FxHasher::default());
        value.visit(&mut hash);
        hash.0.finish()
    };
    hash_of(a) == hash_of(b)
}

struct HashOfValue(FxHasher);

impl Visitor for HashOfValue {
    const IS_ORDERED: bool = true;
    fn atom(&mut self, atom: Atom) {
        self.0.write_u64(6 << 32 | u64::from(atom.0));
    }
    fn components(&mut self, id: ComponentsId) {
        self.0.write_u64(1 << 32 | u64::from(id.0));
    }
    fn mapper(&mut self, id: MapperId) {
        self.0.write_u64(2 << 32 | u64::from(id.0));
    }
    fn sig(&mut self, id: SigId) {
        self.0.write_u64(3 << 32 | u64::from(id.0));
    }
    fn ty(&mut self, id: TypeId) {
        self.0.write_u64(4 << 32 | u64::from(id.0));
    }
    fn file(&mut self, file: FileId) {
        self.0.write_u64(5 << 32 | u64::from(file.0));
    }
    fn plain<T: Hash + ?Sized>(&mut self, value: &T) {
        value.hash(&mut self.0);
    }
    /// Two tasks that build one shape have two copies of it.
    fn handle(&mut self, _: u32) {}
}

/// See `Differing`. `slot`: of the table.
#[cold]
#[inline(never)]
pub(crate) fn note_differing(
    task: &Task,
    slot: u32,
    key: Vec<Mention>,
    stored: &impl Follow,
    computed: &impl Follow,
) {
    task.differing.borrow_mut().count(slot, || Differing {
        slot,
        key,
        stored: Mentions::of(stored),
        computed: Mentions::of(computed),
        computed_in: task.file,
    });
}

impl Checker<'_, '_> {
    /// One line about `entry`. For a checker outside the plan, when no task runs: to print a type is to ask about it.
    pub fn describe_entry_that_differs(&mut self, entry: &Differing) -> String {
        let table = table_names().get(entry.slot as usize).copied();
        let mut line = format!("{}[", table.unwrap_or("?"));
        self.describe_mentions(entry.slot, &entry.key, &mut line);
        line.push_str("] is (");
        self.describe_mentions(entry.slot, &entry.stored, &mut line);
        line.push_str("), computed again: (");
        self.describe_mentions(entry.slot, &entry.computed, &mut line);
        line.push(')');
        if let Some(file) = entry.computed_in {
            line.push_str(" in ");
            self.describe_place(file, None, &mut line);
        }
        line
    }

    /// The path of `file`, and the line and the column of `position`, both from 1.
    fn describe_place(&self, file: FileId, position: Option<u32>, line: &mut String) {
        let path = self.files().module(file).file_name();
        _ = write!(line, "{}", bstr::BStr::new(path));
        // The tree of a file that nothing imports is freed by now. No key is a node of such a file.
        let before = position.and_then(|position| self.hir(file).text.get(..position as usize));
        if let Some(before) = before {
            let row = bun_core::strings::count_char(before, b'\n') + 1;
            let column = match bun_core::strings::last_index_of_char(before, b'\n') {
                Some(end_of_line) => before.len() - end_of_line,
                None => before.len() + 1,
            };
            line.push_str(&format!("({row},{column})"));
        }
    }

    /// Where the node with `index` among those of its kind in `file` begins, for a key of the table with `slot`.
    fn position_of_key(&self, slot: u32, file: FileId, index: u32) -> Option<u32> {
        let (hir, at) = (self.hir(file), index as usize);
        match *table_names().get(slot as usize)? {
            "expr_types"
            | "calls"
            | "call_return_types"
            | "call_diagnostics"
            | "deferred_nodes"
            | "context_free_expr_types"
            | "effects_signatures"
            | "resolved_effects_signatures" => hir.exprs.get(at).map(|it| it.pos),
            "pat_types" => hir.pats.get(at).map(|it| it.pos),
            "context_checked" | "fn_return_types" => match self.bound(file).fns.get(at)?.owner {
                crate::bind::FnOwner::Expr(e) => hir.exprs.get(e.idx()).map(|it| it.pos),
                _ => hir.fns.get(at).map(|it| it.name_pos),
            },
            _ => None,
        }
    }

    fn describe_mentions(&mut self, slot: u32, mentions: &[Mention], line: &mut String) {
        for (i, mention) in mentions.iter().enumerate() {
            if i != 0 {
                line.push_str(", ");
            }
            if let Mention::Node(file, index) = *mention {
                line.push_str(&format!("node {index} of "));
                self.describe_place(file, self.position_of_key(slot, file, index), line);
                continue;
            }
            let (kind, number, printed) = match *mention {
                Mention::Type(id) => ("type", u64::from(id.0), Some(Arg::Type(id))),
                Mention::Sig(id) => ("signature", u64::from(id.0), Some(Arg::Sig(id))),
                Mention::Atom(atom) if atom.is_none() => ("name", u64::from(atom.0), None),
                Mention::Atom(atom) => ("name", u64::from(atom.0), Some(Arg::Atom(atom))),
                Mention::Mapper(id) => ("mapper", u64::from(id.0), None),
                Mention::Components(id) => ("components", u64::from(id.0), None),
                Mention::File(file) | Mention::Node(file, _) => ("file", u64::from(file.0), None),
                Mention::Plain(hash) => ("data", hash, None),
            };
            line.push_str(kind);
            line.push(' ');
            line.push_str(&number.to_string());
            if let Some(printed) = printed {
                self.describe(printed, line);
            }
            if let Mention::Mapper(id) = *mention {
                for &(from, to) in self.types().mapping(id).iter().take(3) {
                    self.describe(Arg::Type(from), line);
                    line.push_str(" ->");
                    self.describe(Arg::Type(to), line);
                }
            }
        }
    }

    fn describe(&mut self, arg: Arg<'_>, line: &mut String) {
        for printed in self.stringify_args(&[arg]) {
            line.push_str(" `");
            _ = write!(line, "{}", bstr::BStr::new(&printed));
            line.push('`');
        }
    }
}
