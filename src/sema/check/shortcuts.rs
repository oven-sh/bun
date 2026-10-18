//! Answers that hold for good, kept where they are read instead of in a hash table, and early answers that spare a long
//! way. This file has their switches.
//!
//! The rule for what is kept with a type (`Types::facts`, `Types::member_flags`): it is a function of the interning key of
//! the type and of the program, and computing it resolves nothing. It creates no type, signature, mapper or symbol, makes
//! no query and moves no counter. So reading it and computing it again cannot be told apart, and any task may write it into
//! any record at any time, a published one too.
//!
//! An answer whose first evaluation resolves something is not kept there: a task that found it would skip the resolution
//! because another task was faster, and the order in which it creates its types would depend on timing. It stays with the
//! checker that found it, and so with one task, in an array by type instead of a hash table (`TypeNumbers`, `TypeMap`,
//! `TaskFacts`): what is stored, and when, is what it was.

use super::*;
use crate::table::Packed;
use std::sync::atomic::AtomicU32;

/// `false`: every one of them is off, and the long way is taken as before.
const ALL: bool = true;

/// `couldContainTypeVariables` is kept with the type. Off: in `Checker::could_contain_type_variables`.
pub(super) const COULD_CONTAIN_TYPE_VARIABLES: bool = ALL;
/// `getGenericObjectFlags` of a union or an intersection without a mapped type is kept with the type. Off: all of them are
/// in `Checker::task_facts`.
pub(super) const GENERIC_OBJECT_FLAGS: bool = ALL;
/// `isTypeReferenceWithGenericArguments` is kept with the type. Off: the type arguments are visited each time.
pub(super) const GENERIC_ARGUMENTS: bool = ALL;
/// `maybeTypeOfKind` and the like read `Types::member_flags`. Off: they visit the constituents.
pub(super) const MEMBER_FLAGS: bool = ALL;
/// `isWeakType` of an object type reads `Resolved::is_weak`. Off: it visits the properties.
pub(super) const WEAK_TYPES: bool = ALL;
/// `shouldNormalizeIntersection` does not look for an empty object type in an intersection without an instantiable type.
pub(super) const NORMALIZED_INTERSECTIONS: bool = ALL;
/// Two different literal types of one kind are unrelated, without going through the rules of `isSimpleTypeRelatedTo`.
pub(super) const DISTINCT_LITERALS: bool = ALL;
/// `Relater::maybe_keys` is searched as a list up to this length, and has a hash set beside it from then on. 0: always.
pub(super) const MAYBE_KEYS_SEARCHED_AS_A_LIST: usize = if ALL { 32 } else { 0 };
/// `getTypeOfPropertyOfContextualType` passes over the members of a union that `union_property` knows not to have the name.
pub(super) const CONTEXTUAL_UNIONS: bool = ALL;
/// `isLiteralOfContextualType` reads `Types::member_flags` of a contextual type without a type variable. Off: it visits
/// the constituents.
pub(super) const LITERAL_CONTEXTS: bool = ALL;
/// `is_every_type_of_kind` and `is_some_type_of_kind` read `Types::member_flags`. Off: they visit the members.
pub(super) const KINDS_OF_MEMBERS: bool = ALL;
/// `is_kind` reads `Type.flags`, which are 4 bytes in a column. Off: the record of the type, as the questions that look at
/// the variant of `TypeData` do.
pub(super) const KINDS_FROM_FLAGS: bool = ALL;
/// A type without a fresh literal type in it is its own regular and its own widened literal type, which
/// `Types::has_fresh_literal` says. Off: the type and the members of a union are visited.
pub(super) const FRESH_LITERALS: bool = ALL;
/// `TypeNumbers` has an array. Off: a hash table, as before.
pub(super) const DENSE_TYPE_MAPS: bool = ALL;
/// `forget_nodes_of_leaf` goes through the memos once they have doubled. Off: after every file.
pub(super) const FORGETS_LEAVES_TOGETHER: bool = ALL;

/// Every answer that comes from one of the above is computed the long way as well, and a difference is a panic that names
/// the types and the file. For debugging.
pub(super) const SHADOW: bool = false;

/// What a computation that resolves nothing leaves as it was.
#[derive(PartialEq, Eq, Debug)]
pub(super) struct Traces {
    work: u64,
    first_new_type_id: NewTypes,
    non_cacheable_mark: (u64, u64),
    instantiation_count: u32,
    reported: usize,
}

/// A number for each type, 0 until one is set. It belongs to one checker, as a `FxHashMap<TypeId, u32>` of the checker
/// would, and holds what that would hold: only the way to an entry is another one.
#[derive(Default)]
pub(super) struct TypeNumbers {
    dense: links::ByType,
    /// In place of `dense` without `DENSE_TYPE_MAPS`, and beside it under `SHADOW`.
    hashed: FxHashMap<TypeId, u32>,
}

impl TypeNumbers {
    #[inline]
    pub(super) fn get(&self, ty: TypeId) -> u32 {
        let hashed = || self.hashed.get(&ty).copied().unwrap_or(0);
        if !DENSE_TYPE_MAPS {
            return hashed();
        }
        let number = self.dense.get(ty);
        if SHADOW {
            assert_eq!(number, hashed(), "the number of {ty:?}");
        }
        number
    }

    pub(super) fn set(&mut self, ty: TypeId, number: u32) {
        if DENSE_TYPE_MAPS {
            self.dense.set(ty, number);
        }
        if !DENSE_TYPE_MAPS || SHADOW {
            self.hashed.insert(ty, number);
        }
    }
}

/// `FxHashMap<TypeId, V>`, over `TypeNumbers`.
pub(super) struct TypeMap<V>(TypeNumbers, std::marker::PhantomData<V>);

impl<V> Default for TypeMap<V> {
    fn default() -> Self {
        TypeMap(TypeNumbers::default(), std::marker::PhantomData)
    }
}

impl<V: Packed<Cell = AtomicU32>> TypeMap<V> {
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

/// The bits of `Checker::task_facts`: what this task has found out about a type, or done with it. The first evaluation of
/// each resolves something or depends on what is in progress, so none of them is for `Types::add_facts`.
pub(super) mod task_fact {
    /// `ObjectFlagsIsUnknownLikeUnionComputed`, `ObjectFlagsIsUnknownLikeUnion`
    pub(in super::super) const KNOWS_UNKNOWN_LIKE_UNION: u32 = 1;
    pub(in super::super) const IS_UNKNOWN_LIKE_UNION: u32 = 1 << 1;
    /// `ObjectFlagsIsGenericTypeComputed` and the two flags, of a union or an intersection in which there is a mapped type.
    /// The others have them in `Types::generic_object_flags`.
    pub(in super::super) const KNOWS_GENERIC_OBJECT_FLAGS: u32 = 1 << 2;
    pub(in super::super) const IS_GENERIC_OBJECT_TYPE: u32 = 1 << 3;
    pub(in super::super) const IS_GENERIC_INDEX_TYPE: u32 = 1 << 4;
    /// The extends type of a conditional type that was related to an instantiation of the same declaration with the same
    /// extends type: the inference between the two has been made.
    pub(in super::super) const HAS_INFERRED_BETWEEN_SAME_EXTENDS: u32 = 1 << 5;
    /// See `union_property`: all the members of the union were visited for a property. Facts and summaries are kept from
    /// the second time on: to keep them costs about as much as to visit the members once, and many unions are asked for one
    /// property and no more.
    pub(in super::super) const IS_WALKED_UNION: u32 = 1 << 6;
    /// See `union_property`: an intersection among `MemberFacts::apparent_type` and `MemberFacts::reduced_apparent_type`.
    pub(in super::super) const IS_IN_MEMBER_FACTS: u32 = 1 << 7;
}

/// A set of `task_fact` bits for each type.
#[derive(Default)]
pub(super) struct TaskFacts(TypeNumbers);

impl TaskFacts {
    #[inline]
    pub(super) fn get(&self, ty: TypeId) -> u32 {
        self.0.get(ty)
    }

    #[inline]
    pub(super) fn has(&self, ty: TypeId, fact: u32) -> bool {
        self.0.get(ty) & fact != 0
    }

    /// Returns whether one of `facts` is new.
    pub(super) fn add(&mut self, ty: TypeId, facts: u32) -> bool {
        let known = self.0.get(ty);
        if known | facts == known {
            return false;
        }
        self.0.set(ty, known | facts);
        true
    }

    /// Of the bits `all`, `ty` has `facts` from now on and no other.
    pub(super) fn replace(&mut self, ty: TypeId, all: u32, facts: u32) {
        let known = self.0.get(ty);
        self.0.set(ty, known & !all | facts);
    }
}

impl<'p, 's> Checker<'p, 's> {
    pub(super) fn traces(&self) -> Traces {
        Traces {
            work: self.work,
            first_new_type_id: self.types().first_new_type_id(),
            non_cacheable_mark: self.non_cacheable_mark(),
            instantiation_count: self.instantiation_count,
            reported: self.reported.len(),
        }
    }

    /// Whether `ty` has one of the flags `kind`. For a question about the variant of `TypeData` where a flag says the
    /// same (`Types::flags_of`): the flags of sixteen types are in one cache line, a record fills one.
    #[inline]
    pub(super) fn is_kind(&self, ty: TypeId, kind: u32) -> bool {
        if !KINDS_FROM_FLAGS {
            return self.types().flags_of_record(ty) & kind != 0;
        }
        let flags = self.flags(ty);
        if SHADOW && flags != self.types().flags_of_record(ty) {
            self.fact_differs("Type.flags", &[ty]);
        }
        flags & kind != 0
    }

    /// `shape::is_plain_object`, likewise.
    #[inline]
    pub(super) fn is_plain_object_type(&self, ty: TypeId) -> bool {
        if !KINDS_FROM_FLAGS {
            return shape::is_plain_object(self.data(ty));
        }
        let is_plain_object = self.types().is_plain_object(ty);
        if SHADOW && is_plain_object != shape::is_plain_object(self.data(ty)) {
            self.fact_differs("an object type that is not a mapped type", &[ty]);
        }
        is_plain_object
    }

    /// Whether `mapped_origin` is `Some`, likewise.
    #[inline]
    pub(super) fn is_mapped_type(&self, ty: TypeId) -> bool {
        if !KINDS_FROM_FLAGS {
            return self.mapped_origin(ty).is_some();
        }
        let is_mapped_type = self.types().is_mapped_type(ty);
        if SHADOW && is_mapped_type != self.mapped_origin(ty).is_some() {
            self.fact_differs("a mapped type", &[ty]);
        }
        is_mapped_type
    }

    /// `every_type(ty, |c, member| c.flags(member) & kind != 0)`
    #[inline]
    pub(super) fn is_every_type_of_kind(&self, ty: TypeId, kind: u32) -> bool {
        debug_assert!(kind & tf::INTERSECTION == 0);
        let is_each = || self.every_type(ty, |c, member| c.flags(member) & kind != 0);
        // A type that is neither a union nor an intersection has one flag, so each is of the kind if none has another flag.
        // But a member of an enum has `ENUM_LITERAL` beside the flag of its value.
        let values = tf::STRING_LITERAL | tf::NUMBER_LITERAL;
        if !KINDS_OF_MEMBERS || kind & tf::ENUM_LITERAL != 0 && kind & values != values {
            return is_each();
        }
        let beside = match kind & values {
            0 => 0,
            _ => tf::ENUM_LITERAL,
        };
        // An intersection has none of the flags, whatever it consists of.
        let others = self.types().member_flags(ty) & !(kind | beside);
        let is_every = others == 0 && !self.may_be_reduced(ty);
        if SHADOW && is_every != is_each() {
            self.fact_differs("every member is of a kind", &[ty]);
        }
        is_every
    }

    /// `some_type(ty, |c, member| c.flags(member) & kind != 0)`
    #[inline]
    pub(super) fn is_some_type_of_kind(&self, ty: TypeId, kind: u32) -> bool {
        debug_assert!(kind & tf::INTERSECTION == 0);
        let is_one = || self.some_type(ty, |c, member| c.flags(member) & kind != 0);
        if !KINDS_OF_MEMBERS {
            return is_one();
        }
        // `member_flags` has what is in an intersection too, which is not a member.
        let is_some =
            self.types().member_flags(ty) & kind != 0 && (!self.may_be_reduced(ty) || is_one());
        if SHADOW && is_some != is_one() {
            self.fact_differs("a member is of a kind", &[ty]);
        }
        is_some
    }

    /// Whether `ty` is known to be no fresh literal type and to have none among its members.
    #[inline]
    pub(super) fn is_without_fresh_literal(&self, ty: TypeId) -> bool {
        if !FRESH_LITERALS {
            return false;
        }
        let has_fresh_literal = self.types().has_fresh_literal(ty);
        if SHADOW && has_fresh_literal != self.finds_fresh_literal(ty) {
            self.fact_differs("a fresh literal type", &[ty]);
        }
        !has_fresh_literal
    }

    /// `Types::has_fresh_literal`, constituent by constituent.
    fn finds_fresh_literal(&self, ty: TypeId) -> bool {
        match self.data(ty) {
            TypeData::Union(parts) | TypeData::Intersection(parts) => {
                parts.iter().any(|&part| self.finds_fresh_literal(part))
            }
            data => relate::is_fresh_literal_kind(data),
        }
    }

    /// Under `SHADOW`: the long way does not give what `fact` says about `types`.
    #[cold]
    #[inline(never)]
    pub(super) fn fact_differs(&self, fact: &str, types: &[TypeId]) -> ! {
        let file =
            (self.task.file).map(|file| bstr::BStr::new(self.files().module(file).file_name()));
        let types: Vec<(TypeId, &TypeData)> = types.iter().map(|&ty| (ty, self.data(ty))).collect();
        panic!("{fact}: the long way gives another answer, while checking {file:?}, for {types:#?}")
    }

    /// `fact_differs`, with the types printed as in a diagnostic.
    #[cold]
    #[inline(never)]
    pub(super) fn fact_differs_for(&mut self, fact: &str, types: &[TypeId]) -> ! {
        let printed: Vec<String> = types
            .iter()
            .map(|&ty| bstr::BStr::new(&self.type_to_string(ty)).to_string())
            .collect();
        self.fact_differs(&format!("{fact} {printed:?}"), types)
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
    fn a_value_for_each_type() {
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
    }

    #[test]
    fn bits_for_each_type() {
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
    }
}
