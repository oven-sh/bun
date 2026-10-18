//! Counters for the work done on union and intersection members. `--timing` prints them.

use super::super::*;
use smallvec::SmallVec;

/// Labels for the counters that `Checker::member_counts` returns.
pub const MEMBER_COUNTS: [&str; 11] = [
    "intersections reduced",
    "with a shared name",
    "unions made objects",
    "properties of unions created",
    "members visited",
    "members visited without facts",
    "intersections listed",
    "properties listed",
    "intersections left unlisted",
    "asked of unlisted intersections",
    "listed after being asked",
];

/// An index into `MEMBER_COUNTS`.
#[derive(Copy, Clone)]
pub(in super::super) enum MemberCount {
    /// Cache misses in `never_intersections`.
    Reduced,
    /// Calls to `may_have_never_reduced_property`, from any caller.
    WithSharedName,
    /// Cache misses in `union_objects`.
    UnionsMadeObjects,
    UnionPropertiesCreated,
    MembersVisited,
    MembersVisitedWithoutFacts,
    IntersectionsListed,
    PropertiesListed,
    IntersectionsLeftUnlisted,
    /// Calls to `property_of_unlisted_intersection`.
    AskedOfUnlisted,
    /// The subset of those calls that listed the properties because the intersection had been queried often.
    ListedAfterBeingAsked,
}

#[derive(Default)]
pub(in super::super) struct Reductions {
    /// Mapped types whose members are being resolved. See `has_base_type_in_progress`.
    pub(super) mapped_types_in_progress: SmallVec<[TypeId; 4]>,
    counts: [u64; MEMBER_COUNTS.len()],
}

impl Checker<'_, '_> {
    #[inline]
    pub(in super::super) fn tally(&mut self, what: MemberCount, more: usize) {
        self.reductions.counts[what as usize] += more as u64;
    }

    /// Returns the counters in `MEMBER_COUNTS` order. They depend only on the program and how it is split into tasks.
    pub fn member_counts(&self) -> [u64; MEMBER_COUNTS.len()] {
        self.reductions.counts
    }
}
