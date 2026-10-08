//! What a value is, in terms the compiler behind the front end can read. It comes from the type checker and from nowhere else, and the
//! engine takes it for a fact: it tests nothing that a type says.

use crate::id::{LayoutId, StrId, TyId};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

pub mod prim {
    pub const UNDEFINED: u32 = 1;
    pub const NULL: u32 = 1 << 1;
    pub const FALSE: u32 = 1 << 2;
    pub const TRUE: u32 = 1 << 3;
    pub const NUMBER: u32 = 1 << 4;
    pub const STRING: u32 = 1 << 5;
    pub const SYMBOL: u32 = 1 << 6;
    pub const BIGINT: u32 = 1 << 7;
    pub const BOOLEAN: u32 = FALSE | TRUE;
    pub const NULLISH: u32 = UNDEFINED | NULL;
    /// Kept as a reference, as objects and functions are.
    pub const CELLS: u32 = STRING | SYMBOL | BIGINT;
    pub const ALL: u32 = (1 << 8) - 1;
}

#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum Part {
    /// An object of the type of the program with this layout, a class, an interface, an alias, a type literal: one whose own layout is
    /// among the members of this one.
    Class(LayoutId),
    /// An instance of a class that the program only knows the declaration of, by its name, with its type arguments.
    Global(StrId, SmallVec<[TyId; 2]>),
    /// `T[]`, a tuple. The type of the elements is what they are expected to be: nothing keeps anyone from storing something else.
    Array(TyId),
}

#[derive(Clone, PartialEq, Eq, Hash, Debug, Default)]
pub struct Declared {
    pub prims: u32,
    /// Only these numbers, all of them integers: the least and the most.
    pub ints: Option<(i64, i64)>,
    /// Sorted.
    pub parts: SmallVec<[Part; 1]>,
    pub any_object: bool,
    pub any_function: bool,
}

impl Declared {
    pub fn never() -> Declared {
        Declared::default()
    }
    pub fn prims(prims: u32) -> Declared {
        Declared { prims, ..Declared::default() }
    }
    pub fn int(value: i64) -> Declared {
        Declared::ints(value, value)
    }
    /// Integers from the least to the most.
    pub fn ints(least: i64, most: i64) -> Declared {
        Declared { ints: Some((least, most)), ..Declared::default() }
    }
    pub fn part(part: Part) -> Declared {
        let mut parts = SmallVec::new();
        parts.push(part);
        Declared { parts, ..Declared::default() }
    }
    pub fn any_object() -> Declared {
        Declared { any_object: true, any_function: true, ..Declared::default() }
    }
    pub fn any_function() -> Declared {
        Declared { any_function: true, ..Declared::default() }
    }
    pub fn anything() -> Declared {
        Declared { prims: prim::ALL, any_object: true, any_function: true, ..Declared::default() }
    }
    pub fn is_never(&self) -> bool {
        *self == Declared::default()
    }
    pub fn has_objects(&self) -> bool {
        self.any_object || self.any_function || !self.parts.is_empty()
    }
    /// Whether some of it is kept as a reference.
    pub fn has_cells(&self) -> bool {
        self.prims & prim::CELLS != 0 || self.has_objects()
    }
    /// A reference may be nil, whatever the source says: a field that nothing has been stored to yet, `undefined!`, the `parent` of a
    /// root. What cannot do with `undefined` or `null` tests for them, as the language has it. A number or a boolean is only what its
    /// type says.
    pub fn nilable(mut self) -> Declared {
        if self.has_cells() {
            self.prims |= prim::NULLISH;
        }
        self
    }
    /// The layout, if it is objects of one type of the program, or nil, and nothing else.
    pub fn only_layout(&self) -> Option<LayoutId> {
        match self.parts[..] {
            [Part::Class(layout)] if self.prims & !prim::NULLISH == 0 && self.ints.is_none() && !self.any_object && !self.any_function => Some(layout),
            _ => None,
        }
    }

    /// Whether the other description has room for all that this one has, going by the two alone: a layout is within itself only. What an
    /// array or an instance of a class of the engine holds makes no difference.
    pub fn is_described_within(&self, other: &Declared) -> bool {
        let is_part_within = |part: &Part| {
            other.parts.iter().any(|within| match (part, within) {
                (Part::Array(_), Part::Array(_)) => true,
                (Part::Global(name, _), Part::Global(same, _)) => name == same,
                _ => part == within,
            })
        };
        self.prims & !other.prims == 0
            && (!self.any_object || other.any_object)
            && (!self.any_function || other.any_function)
            && self.ints.is_none_or(|(least, most)| other.prims & prim::NUMBER != 0 || other.ints.is_some_and(|within| within.0 <= least && most <= within.1))
            && (other.any_object || self.parts.iter().all(is_part_within))
    }

    /// Either.
    pub fn or(&self, other: &Declared) -> Declared {
        let prims = self.prims | other.prims;
        let ints = if prims & prim::NUMBER != 0 {
            None
        } else {
            match (self.ints, other.ints) {
                (Some(a), Some(b)) => Some((a.0.min(b.0), a.1.max(b.1))),
                (a, b) => a.or(b),
            }
        };
        let any_object = self.any_object || other.any_object;
        let mut parts = SmallVec::new();
        if !any_object {
            parts = self.parts.clone();
            parts.extend(other.parts.iter().cloned());
            parts.sort_unstable();
            parts.dedup();
        }
        Declared { prims, ints, parts, any_object, any_function: self.any_function || other.any_function }
    }
}

pub struct DeclaredTable {
    pub list: Vec<Declared>,
    ids: FxHashMap<Declared, TyId>,
    pub anything: TyId,
}

impl Default for DeclaredTable {
    fn default() -> DeclaredTable {
        let mut table = DeclaredTable { list: Vec::new(), ids: FxHashMap::default(), anything: TyId::NONE };
        table.anything = table.intern(Declared::anything());
        table
    }
}

impl DeclaredTable {
    pub fn intern(&mut self, declared: Declared) -> TyId {
        if let Some(&id) = self.ids.get(&declared) {
            return id;
        }
        let id = TyId::new(self.list.len());
        self.list.push(declared.clone());
        self.ids.insert(declared, id);
        id
    }
    pub fn get(&self, id: TyId) -> &Declared {
        &self.list[id.idx()]
    }
}
