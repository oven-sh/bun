//! Answers that hold for good, kept where they are read instead of in a hash table, and early answers that spare a long
//! way. This file has their switches.
//!
//! The rule for what is kept with a type (`Types::facts`, `Types::member_flags`): it is a function of the interning key of
//! the type and of the program, and computing it resolves nothing. It creates no type, signature, mapper or symbol, makes
//! no query and moves no counter. So reading it and computing it again cannot be told apart, and any task may write it into
//! any record at any time, a published one too.
//!
//! An answer whose first evaluation resolves something is not kept there: a task that found it would skip the resolution
//! because another task was faster, and the order in which it creates its types would depend on timing.

use super::*;

/// `false`: every one of them is off, and the long way is taken as before.
const ALL: bool = true;

/// `couldContainTypeVariables` is kept with the type. Off: in `Checker::could_contain_type_variables`.
pub(super) const COULD_CONTAIN_TYPE_VARIABLES: bool = ALL;
/// `getGenericObjectFlags` of a union or an intersection without a mapped type is kept with the type. Off: all of them are
/// in `Checker::generic_object_flags`.
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

/// Every answer that comes from one of the above is computed the long way as well, and a difference is a panic that names
/// the types and the file. For debugging.
pub(super) const SHADOW: bool = false;

/// What a computation that resolves nothing leaves as it was.
#[derive(PartialEq, Eq, Debug)]
pub(super) struct Traces {
    work: u64,
    first_new_type_id: TypeId,
    non_cacheable_mark: (u64, u64),
    instantiation_count: u32,
    reported: usize,
}

impl<'p, 's> Checker<'p, 's> {
    /// For `SHADOW`.
    pub(super) fn traces(&self) -> Traces {
        Traces {
            work: self.work,
            first_new_type_id: self.types().first_new_type_id(),
            non_cacheable_mark: self.non_cacheable_mark(),
            instantiation_count: self.instantiation_count,
            reported: self.reported.len(),
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
