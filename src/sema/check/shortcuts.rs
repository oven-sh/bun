//! The checker's fast paths. Some cache a permanent answer on the type instead of in a hash table. Others
//! return early and skip a slow path.
//!
//! An answer can be cached on the type (`Types::facts`, `Types::member_flags`) only if it is a pure function of the
//! type's interning key and the program, and computing it resolves nothing. That means it doesn't create a type,
//! signature, mapper or symbol, doesn't run a query and doesn't bump a counter. A task then can't tell a cache hit from
//! a recomputation, so any task can write the answer into any record at any time, including a published record.
//!
//! An answer whose first evaluation resolves something can't be cached there. A task that hit the cache would skip the
//! resolution only because another task got there first, so the order in which it creates types would depend on timing.
//! These answers stay in the checker that computed them, which belongs to one task. They are stored in arrays indexed
//! by type (`TypeNumbers`, `TypeMap`, `TaskFacts`) instead of hash tables. That changes only the lookup, not what is
//! stored or when.

use super::*;
use crate::table::Packed;
use std::sync::atomic::AtomicU32;

/// `Relater::maybe_keys` is searched linearly up to this length. A longer list is mirrored in a hash set. 0 means the
/// hash set is always used.
pub(super) const MAYBE_KEYS_LINEAR_LIMIT: usize = 32;

/// Snapshot of the checker's counters. A computation that resolves nothing doesn't change them.
#[derive(PartialEq, Eq, Debug)]
pub(super) struct CounterSnapshot {
    work: u64,
    first_new_type_id: NewTypes,
    non_cacheable_mark: (u64, u64),
    instantiation_count: u32,
    reported: usize,
}

/// Maps each type to a `u32`, which is 0 until set. It belongs to one checker and stores the same entries as a
/// `FxHashMap<TypeId, u32>` field would. Only the lookup is different.
#[derive(Default)]
pub(super) struct TypeNumbers {
    dense: links::ByType,
}

impl TypeNumbers {
    /// Resets every number to 0 and keeps the memory.
    pub(super) fn clear(&mut self) {
        self.dense.clear();
    }

    #[inline]
    pub(super) fn get(&self, ty: TypeId) -> u32 {
        self.dense.get(ty)
    }

    pub(super) fn set(&mut self, ty: TypeId, number: u32) {
        self.dense.set(ty, number);
    }
}

/// Works like `FxHashMap<TypeId, V>`, backed by `TypeNumbers`.
pub(super) struct TypeMap<V>(TypeNumbers, std::marker::PhantomData<V>);

impl<V> Default for TypeMap<V> {
    fn default() -> Self {
        TypeMap(TypeNumbers::default(), std::marker::PhantomData)
    }
}

impl<V: Packed<Cell = AtomicU32>> TypeMap<V> {
    /// Removes every entry and keeps the memory.
    pub(super) fn clear(&mut self) {
        self.0.clear();
    }

    #[inline]
    pub(super) fn get(&self, ty: TypeId) -> Option<V> {
        match self.0.get(ty) {
            0 => None,
            packed => Some(V::unpack(packed)),
        }
    }

    pub(super) fn insert(&mut self, ty: TypeId, value: V) {
        self.0.set(ty, value.pack());
    }

    pub(super) fn remove(&mut self, ty: TypeId) {
        if self.0.get(ty) != 0 {
            self.0.set(ty, 0);
        }
    }
}

/// Bits of `Checker::task_facts`. They record what this task has learned about a type or has already done with it. The
/// first evaluation of each one resolves something or depends on what is in progress, so none of them can be stored
/// with `Types::add_facts`.
pub(super) mod task_fact {
    /// `ObjectFlagsIsUnknownLikeUnionComputed`, `ObjectFlagsIsUnknownLikeUnion`
    pub(in super::super) const UNKNOWN_LIKE_UNION_COMPUTED: u32 = 1;
    pub(in super::super) const IS_UNKNOWN_LIKE_UNION: u32 = 1 << 1;
    /// `ObjectFlagsIsGenericTypeComputed` and its two flags, for a union or an intersection that contains a mapped
    /// type. Other unions and intersections store them in `Types::generic_object_flags`.
    pub(in super::super) const GENERIC_OBJECT_FLAGS_COMPUTED: u32 = 1 << 2;
    pub(in super::super) const IS_GENERIC_OBJECT_TYPE: u32 = 1 << 3;
    pub(in super::super) const IS_GENERIC_INDEX_TYPE: u32 = 1 << 4;
    /// See `union_property`. Every member of the union has been visited for a property. Facts are stored starting
    /// with the second walk. Storing them costs about as much as one walk, and many unions only ever have one
    /// property looked up.
    pub(in super::super) const IS_WALKED_UNION: u32 = 1 << 5;
    /// See `union_property`. Set on an intersection that is stored as a `MemberFacts::apparent_type` or a
    /// `MemberFacts::reduced_apparent_type`.
    pub(in super::super) const IS_IN_MEMBER_FACTS: u32 = 1 << 6;
}

/// A set of `task_fact` bits for each type.
#[derive(Default)]
pub(super) struct TaskFacts(TypeNumbers);

impl TaskFacts {
    /// Removes every fact and keeps the memory.
    pub(super) fn clear(&mut self) {
        self.0.clear();
    }

    #[inline]
    pub(super) fn get(&self, ty: TypeId) -> u32 {
        self.0.get(ty)
    }

    #[inline]
    pub(super) fn has(&self, ty: TypeId, fact: u32) -> bool {
        self.0.get(ty) & fact != 0
    }

    /// Returns true if any bit of `facts` wasn't set yet.
    pub(super) fn add(&mut self, ty: TypeId, facts: u32) -> bool {
        let known = self.0.get(ty);
        if known | facts == known {
            return false;
        }
        self.0.set(ty, known | facts);
        true
    }

    /// Clears the bits in `all`, then sets `facts`.
    pub(super) fn replace(&mut self, ty: TypeId, all: u32, facts: u32) {
        let known = self.0.get(ty);
        self.0.set(ty, known & !all | facts);
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub(super) fn counter_snapshot(&self) -> CounterSnapshot {
        CounterSnapshot {
            work: self.work,
            first_new_type_id: self.types().first_new_type_id(),
            non_cacheable_mark: self.non_cacheable_mark(),
            instantiation_count: self.instantiation_count,
            reported: self.reported.len(),
        }
    }

    /// True if `ty` has any of the flags in `kind`. Use it instead of matching on the `TypeData` variant where a flag
    /// is equivalent (`Types::flags_of`). Sixteen types' flags share a cache line, while one record fills a whole line.
    #[inline]
    pub(super) fn is_kind(&self, ty: TypeId, kind: u32) -> bool {
        let flags = self.flags(ty);

        flags & kind != 0
    }

    /// True for any object type but a mapped type, read from a column instead of the type's record.
    #[inline]
    pub(super) fn is_plain_object_type(&self, ty: TypeId) -> bool {
        self.types().is_plain_object(ty)
    }

    /// True if `mapped_origin` is `Some`, read from a column instead of the type's record.
    #[inline]
    pub(super) fn is_mapped_type(&self, ty: TypeId) -> bool {
        self.types().is_mapped_type(ty)
    }

    /// Equivalent to `every_type(ty, |c, member| c.flags(member) & kind != 0)`.
    #[inline]
    pub(super) fn is_every_type_of_kind(&self, ty: TypeId, kind: u32) -> bool {
        debug_assert!(kind & tf::INTERSECTION == 0);
        let every_member_matches = || self.every_type(ty, |c, member| c.flags(member) & kind != 0);
        // A type that is neither a union nor an intersection has exactly one flag, so every member matches `kind` if no
        // member has a flag outside `kind`. The exception is an enum member, which also has `ENUM_LITERAL`.
        let values = tf::STRING_LITERAL | tf::NUMBER_LITERAL;
        if kind & tf::ENUM_LITERAL != 0 && kind & values != values {
            return every_member_matches();
        }
        let also_allowed = match kind & values {
            0 => 0,
            _ => tf::ENUM_LITERAL,
        };
        // An intersection never matches `kind`, but `member_flags` reports its constituents' flags instead of its own.
        let others = self.types().member_flags(ty) & !(kind | also_allowed);

        others == 0 && !self.may_be_reduced(ty)
    }

    /// Equivalent to `some_type(ty, |c, member| c.flags(member) & kind != 0)`.
    #[inline(always)]
    pub(super) fn is_some_type_of_kind(&self, ty: TypeId, kind: u32) -> bool {
        debug_assert!(kind & tf::INTERSECTION == 0);
        let any_member_matches = || self.some_type(ty, |c, member| c.flags(member) & kind != 0);

        // `member_flags` also includes the flags of an intersection's constituents, which aren't members.

        self.types().member_flags(ty) & kind != 0
            && (!self.may_be_reduced(ty) || any_member_matches())
    }

    /// True if `ty` is known not to be a fresh literal type and not to contain one.
    #[inline]
    pub(super) fn has_no_fresh_literal(&self, ty: TypeId) -> bool {
        let has_fresh_literal = self.types().has_fresh_literal(ty);

        !has_fresh_literal
    }
}

#[cfg(test)]
mod tests {
    use super::{TaskFacts, TypeMap};
    use crate::local::LOCAL;
    use crate::types::TypeId;

    const TYPES: [TypeId; 5] = [
        TypeId(0),
        TypeId(127),
        TypeId(128),
        TypeId(LOCAL),
        TypeId(LOCAL | 500),
    ];

    #[test]
    fn type_map_stores_one_value_per_type() {
        let mut map: TypeMap<TypeId> = TypeMap::default();
        for ty in TYPES {
            assert_eq!(map.get(ty), None);
            map.remove(ty);
        }
        for (at, ty) in TYPES.into_iter().enumerate() {
            map.insert(ty, TYPES[4 - at]);
        }
        for (at, ty) in TYPES.into_iter().enumerate() {
            assert_eq!(map.get(ty), Some(TYPES[4 - at]));
        }
        map.insert(TYPES[1], TYPES[1]);
        map.remove(TYPES[3]);
        assert_eq!(map.get(TYPES[1]), Some(TYPES[1]));
        assert_eq!(map.get(TYPES[3]), None);
        assert_eq!(map.get(TYPES[2]), Some(TYPES[2]));
        assert_eq!(map.get(TypeId(1)), None);
        assert_eq!(map.get(TypeId(LOCAL | 499)), None);
        map.clear();
        for ty in TYPES {
            assert_eq!(map.get(ty), None);
        }
        // A page added after `clear` starts empty.
        map.insert(TYPES[1], TYPES[1]);
        assert_eq!(map.get(TYPES[0]), None);
    }

    #[test]
    fn task_facts_stores_bits_per_type() {
        let mut facts = TaskFacts::default();
        for ty in TYPES {
            assert_eq!(facts.get(ty), 0);
            assert!(facts.add(ty, 0b0101));
            assert!(!facts.add(ty, 0b0100));
            assert!(facts.add(ty, 0b1100));
            assert!(facts.has(ty, 0b1000) && !facts.has(ty, 0b0010));
            facts.replace(ty, 0b0110, 0b0010);
            assert_eq!(facts.get(ty), 0b1011);
        }
        assert_eq!(facts.get(TypeId(129)), 0);
        facts.clear();
        for ty in TYPES {
            assert_eq!(facts.get(ty), 0);
        }
    }
}
