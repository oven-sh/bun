//! Counts of what is done for the members of unions and intersections, for `--timing`.

use super::super::*;
use smallvec::SmallVec;

/// The names of `Checker::member_counts`.
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
    /// `never_intersections` did not have the intersection.
    Reduced,
    /// `may_have_never_reduced_property` was asked, for whatever reason.
    WithSharedName,
    /// `union_objects` did not have the union.
    UnionsMadeObjects,
    UnionPropertiesCreated,
    MembersVisited,
    MembersVisitedWithoutFacts,
    IntersectionsListed,
    PropertiesListed,
    IntersectionsLeftUnlisted,
    /// `property_of_unlisted_intersection` was called.
    AskedOfUnlisted,
    /// .. so often that it has listed the properties.
    ListedAfterBeingAsked,
}

#[derive(Default)]
pub(in super::super) struct Reductions {
    /// The mapped types whose members are being resolved. See `has_base_type_in_progress`.
    pub(super) mapped_types_in_progress: SmallVec<[TypeId; 4]>,
    counts: [u64; MEMBER_COUNTS.len()],
}

impl Checker<'_, '_> {
    #[inline]
    pub(in super::super) fn tally(&mut self, what: MemberCount, more: usize) {
        self.reductions.counts[what as usize] += more as u64;
    }

    /// In the order of `MEMBER_COUNTS`. A function of the program and of how it is cut into tasks.
    pub fn member_counts(&self) -> [u64; MEMBER_COUNTS.len()] {
        self.reductions.counts
    }
}
