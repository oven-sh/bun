use crate::id::{LayoutId, StrId, TyId};
use rustc_hash::FxHashMap;
use smallvec::SmallVec;
use std::sync::LazyLock;

pub mod prim {
    pub const UNDEFINED: u32 = 1;
    pub const NULL: u32 = 1 << 1;
    pub const FALSE: u32 = 1 << 2;
    pub const TRUE: u32 = 1 << 3;
    pub const NUMBER: u32 = 1 << 4;
    pub const STRING: u32 = 1 << 5;
    pub const SYMBOL: u32 = 1 << 6;
    pub const BIGINT: u32 = 1 << 7;
    pub const LITERAL_STRING: u32 = 1 << 8;
    pub const BOOLEAN: u32 = FALSE | TRUE;
    pub const NULLISH: u32 = UNDEFINED | NULL;
    pub const CELLS: u32 = STRING | SYMBOL | BIGINT | LITERAL_STRING;
    pub const ALL: u32 = (1 << 8) - 1;
}

#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug)]
pub enum Part {
    Class(LayoutId),
    Global(StrId, SmallVec<[TyId; 2]>),
    Array(TyId),
}

#[derive(Clone, PartialEq, Eq, Hash, Debug, Default)]
pub struct Declared {
    pub prims: u32,
    pub ints: Option<(i64, i64)>,
    pub parts: SmallVec<[Part; 1]>,
    pub any_object: bool,
    pub any_function: bool,
}

impl Declared {
    pub fn never() -> Declared {
        Declared::default()
    }
    pub fn prims(prims: u32) -> Declared {
        Declared {
            prims,
            ..Declared::default()
        }
    }
    pub fn int(value: i64) -> Declared {
        Declared::ints(value, value)
    }
    pub fn ints(minimum: i64, maximum: i64) -> Declared {
        Declared {
            ints: Some((minimum, maximum)),
            ..Declared::default()
        }
    }
    pub fn part(part: Part) -> Declared {
        let mut parts = SmallVec::new();
        parts.push(part);
        Declared {
            parts,
            ..Declared::default()
        }
    }
    pub fn any_object() -> Declared {
        Declared {
            any_object: true,
            any_function: true,
            ..Declared::default()
        }
    }
    pub fn any_function() -> Declared {
        Declared {
            any_function: true,
            ..Declared::default()
        }
    }
    pub fn anything() -> Declared {
        Declared {
            prims: prim::ALL,
            any_object: true,
            any_function: true,
            ..Declared::default()
        }
    }
    pub fn is_never(&self) -> bool {
        *self == Declared::default()
    }
    pub fn has_objects(&self) -> bool {
        self.any_object || self.any_function || !self.parts.is_empty()
    }
    pub fn has_multiple_primitive_kinds(&self) -> bool {
        let kinds = [prim::BOOLEAN, prim::STRING, prim::SYMBOL, prim::BIGINT]
            .iter()
            .filter(|&&kind| self.prims & kind != 0)
            .count();
        let numbers = usize::from(self.prims & prim::NUMBER != 0 || self.ints.is_some());
        !self.has_objects() && kinds + numbers > 1
    }
    pub fn has_cells(&self) -> bool {
        self.prims & prim::CELLS != 0 || self.has_objects()
    }
    pub fn nullable(mut self) -> Declared {
        if self.has_cells() {
            self.prims |= prim::NULLISH;
        }
        self
    }
    pub fn has_literal_string(&self) -> bool {
        self.prims & prim::LITERAL_STRING != 0
    }
    pub fn with_literal_string_widened(mut self) -> Declared {
        if self.has_literal_string() {
            self.prims = self.prims & !prim::LITERAL_STRING | prim::STRING;
        }
        self
    }
    pub fn single_layout(&self) -> Option<LayoutId> {
        match self.parts[..] {
            [Part::Class(layout)]
                if layout.is_some()
                    && self.prims & !prim::NULLISH == 0
                    && self.ints.is_none()
                    && !self.any_object
                    && !self.any_function =>
            {
                Some(layout)
            }
            _ => None,
        }
    }

    pub fn is_subset_of(&self, other: &Declared) -> bool {
        let is_part_subset = |part: &Part| {
            other.parts.iter().any(|within| match (part, within) {
                (Part::Array(_), Part::Array(_)) => true,
                (Part::Global(name, _), Part::Global(same, _)) => name == same,
                _ => part == within,
            })
        };
        self.prims & !other.prims == 0
            && (!self.any_object || other.any_object)
            && (!self.any_function || other.any_function)
            && self.ints.is_none_or(|(minimum, maximum)| {
                other.prims & prim::NUMBER != 0
                    || other
                        .ints
                        .is_some_and(|within| within.0 <= minimum && maximum <= within.1)
            })
            && (other.any_object || self.parts.iter().all(is_part_subset))
    }

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
        Declared {
            prims,
            ints,
            parts,
            any_object,
            any_function: self.any_function || other.any_function,
        }
        .normalized()
    }

    pub fn merge(&mut self, other: &Declared) {
        self.prims |= other.prims;
        self.ints = if self.prims & prim::NUMBER != 0 {
            None
        } else {
            match (self.ints, other.ints) {
                (Some(a), Some(b)) => Some((a.0.min(b.0), a.1.max(b.1))),
                (a, b) => a.or(b),
            }
        };
        self.any_object |= other.any_object;
        self.any_function |= other.any_function;
        if self.any_object {
            self.parts.clear();
        } else {
            for part in &other.parts {
                if let Err(index) = self.parts.binary_search(part) {
                    self.parts.insert(index, part.clone());
                }
            }
        }
        if self.has_literal_string()
            && (self.prims & !(prim::LITERAL_STRING | prim::NULLISH) != 0
                || self.ints.is_some()
                || self.has_objects())
        {
            self.prims = self.prims & !prim::LITERAL_STRING | prim::STRING;
        }
    }

    const PLAIN_COUNT: usize = 1 << 11;

    fn plain_index(&self) -> Option<usize> {
        (self.parts.is_empty() && self.ints.is_none()).then_some(
            self.prims as usize
                | usize::from(self.any_object) << 9
                | usize::from(self.any_function) << 10,
        )
    }

    pub fn normalized(self) -> Declared {
        if self.prims & !(prim::LITERAL_STRING | prim::NULLISH) != 0
            || self.ints.is_some()
            || self.has_objects()
        {
            self.with_literal_string_widened()
        } else {
            self
        }
    }
}

static WIDENED_LITERAL_STRINGS: LazyLock<[Declared; 4]> =
    LazyLock::new(|| [0, 1, 2, 3].map(|nullish| Declared::prims(prim::STRING | nullish)));

pub struct DeclaredTable {
    pub list: Vec<Declared>,
    ids: FxHashMap<Declared, TyId>,
    plain_ids: Vec<TyId>,
    pub anything: TyId,
}

impl Default for DeclaredTable {
    fn default() -> DeclaredTable {
        let mut table = DeclaredTable {
            list: Vec::new(),
            ids: FxHashMap::default(),
            plain_ids: Vec::new(),
            anything: TyId::NONE,
        };
        table.anything = table.intern(Declared::anything());
        table
    }
}

impl DeclaredTable {
    pub fn intern(&mut self, declared: Declared) -> TyId {
        let declared = declared.normalized();
        let Some(place) = declared.plain_index() else {
            if let Some(&id) = self.ids.get(&declared) {
                return id;
            }
            let id = TyId::new(self.list.len());
            self.list.push(declared.clone());
            self.ids.insert(declared, id);
            return id;
        };
        if self.plain_ids.is_empty() {
            self.plain_ids = vec![TyId::NONE; Declared::PLAIN_COUNT];
        }
        if self.plain_ids[place].is_none() {
            self.plain_ids[place] = TyId::new(self.list.len());
            self.list.push(declared);
        }
        self.plain_ids[place]
    }
    pub fn get(&self, id: TyId) -> &Declared {
        &self.list[id.idx()]
    }
    pub fn get_widened(&self, id: TyId) -> &Declared {
        let declared = &self.list[id.idx()];
        if declared.has_literal_string() {
            &WIDENED_LITERAL_STRINGS[(declared.prims & prim::NULLISH) as usize]
        } else {
            declared
        }
    }
    pub fn find(&self, declared: &Declared) -> Option<TyId> {
        match declared.plain_index() {
            Some(place) => self.plain_ids.get(place).copied().filter(|id| id.is_some()),
            None => self.ids.get(declared).copied(),
        }
    }
    pub fn close(&mut self) {
        self.ids = FxHashMap::default();
        self.plain_ids = Vec::new();
    }
}

#[cfg(test)]
mod tests {
    use super::{Declared, Part};
    use crate::id::LayoutId;

    #[test]
    fn class_without_layout_has_no_single_layout() {
        let of_class = |layout: LayoutId| Declared {
            parts: [Part::Class(layout)].into_iter().collect(),
            ..Declared::default()
        };
        assert_eq!(
            of_class(LayoutId::new(3)).single_layout(),
            Some(LayoutId::new(3))
        );
        assert_eq!(of_class(LayoutId::NONE).single_layout(), None);
    }
}
