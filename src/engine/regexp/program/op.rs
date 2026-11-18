//! The operations of a [`Program`](super::Program).
//!
//! They work on a position in the subject, which is never outside it, on cells, on the captures and on a stack.
//! Offsets count code units from the position. An operation whose test fails goes to `fail` and changes nothing
//! unless it says so. Reads at an offset are not checked: an earlier operation has shown that the units exist.

/// The index of an operation.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub struct Target(pub(crate) u32);

impl Target {
    #[inline]
    pub fn index(self) -> usize {
        self.0 as usize
    }
}

macro_rules! ids {
    ($($(#[$meta:meta])* $name:ident),*) => {$(
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
        pub struct $name(pub(crate) u32);

        impl $name {
            #[inline]
            pub fn index(self) -> usize {
                self.0 as usize
            }
        }
    )*};
}

ids!(ClassId, LookId, LoopId, ScanId, ScopeId, SiteId, SwitchId);

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Direction {
    Forward,
    Backward,
}

impl Direction {
    #[inline]
    pub fn opposite(self) -> Direction {
        match self {
            Direction::Forward => Direction::Backward,
            Direction::Backward => Direction::Forward,
        }
    }

    /// `units` in this direction, as a distance.
    #[inline]
    pub(crate) fn signed(self, units: i32) -> i32 {
        match self {
            Direction::Forward => units,
            Direction::Backward => -units,
        }
    }
}

/// A cell, and the scope that says what it holds.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Slot {
    pub cell: u32,
    pub scope: ScopeId,
}

/// The position in a slot plus a distance.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Place {
    pub slot: Slot,
    pub delta: i32,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Comparison {
    Equal,
    Below,
    AtLeast,
    Above,
    AtMost,
}

impl Comparison {
    #[inline]
    pub(crate) fn holds(self, lhs: i64, rhs: i64) -> bool {
        match self {
            Comparison::Equal => lhs == rhs,
            Comparison::Below => lhs < rhs,
            Comparison::AtLeast => lhs >= rhs,
            Comparison::Above => lhs > rhs,
            Comparison::AtMost => lhs <= rhs,
        }
    }
}

/// Captures, counted in pairs of a start and an end.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Pairs {
    pub first: u16,
    pub end: u16,
}

impl Pairs {
    pub(crate) const NONE: Pairs = Pairs { first: 0, end: 0 };

    #[inline]
    pub fn is_empty(self) -> bool {
        self.first >= self.end
    }

    /// The indices of the starts and ends.
    #[inline]
    pub fn entries(self) -> core::ops::Range<usize> {
        usize::from(self.first) * 2..usize::from(self.end) * 2
    }

    /// The least range that has both.
    pub(crate) fn hull(self, other: Pairs) -> Pairs {
        if self.is_empty() {
            other
        } else if other.is_empty() {
            self
        } else {
            Pairs {
                first: self.first.min(other.first),
                end: self.end.max(other.end),
            }
        }
    }
}

/// How far [`Op::GiveBack`] goes at a time: a number of units, or a code point.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Stride(u16);

impl Stride {
    pub(crate) const CODE_POINT: Stride = Stride(0);
    pub(crate) const UNIT: Stride = Stride(1);

    pub(crate) fn of_units(units: u32) -> Option<Stride> {
        u16::try_from(units).ok().filter(|&it| it != 0).map(Stride)
    }

    #[inline]
    pub fn is_code_point(self) -> bool {
        self == Stride::CODE_POINT
    }

    #[inline]
    pub fn least_units(self) -> u32 {
        u32::from(self.0.max(1))
    }
}

pub const UNBOUNDED: u32 = u32::MAX;

/// What going back counts as, besides the distance.
pub const WORK_OF_GOING_BACK: u32 = 8;

/// The start and the end of a capture that has not matched.
pub const UNSET: u32 = u32::MAX;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Op {
    Jump {
        to: Target,
    },
    /// Goes back to code that has run, after the position has changed or work has been counted.
    Again {
        to: Target,
    },
    NoMatch,
    Match {
        start: Place,
        end: i16,
    },
    MatchHere {
        start: i16,
        end: i16,
    },

    /// That many units are between the position and the edge of the subject.
    Need {
        direction: Direction,
        count: u32,
        fail: Target,
    },
    /// The offset leads to the edge of the subject.
    AtEdge {
        direction: Direction,
        offset: i16,
        fail: Target,
    },
    /// The offset does not lead between the halves of a surrogate pair. Checks its reads.
    NotInPair {
        offset: i16,
        fail: Target,
    },
    /// `unit | mask == value`.
    Unit {
        offset: i16,
        value: u16,
        mask: u16,
        fail: Target,
    },
    /// The same for the units in 2, 4 or 8 bytes, the first in the low bits.
    Word {
        bytes: u8,
        offset: i16,
        value: [u32; 2],
        mask: [u32; 2],
        fail: Target,
    },
    Class {
        offset: i16,
        class: ClassId,
        fail: Target,
    },
    /// `count` units from the offset up are in the class.
    ClassCount {
        offset: i16,
        count: u16,
        class: ClassId,
        fail: Target,
    },
    /// Two units from the offset up are a surrogate pair whose code point is in the class.
    Pair {
        offset: i16,
        class: ClassId,
        fail: Target,
    },
    /// Goes where the table says for the unit.
    Switch {
        offset: i16,
        table: SwitchId,
    },

    Advance {
        by: i32,
    },
    /// Moves to the start of the surrogate pair that the position is inside of, if it is.
    LeavePair,
    /// Moves to `length` units before the end, unless the position is past that.
    SkipToTail {
        length: u32,
    },
    /// Moves to the first position from here on that the scan accepts. A failure leaves the position where it is, or
    /// at the first that has fewer units after it than the scan needs.
    Scan {
        id: ScanId,
        fail: Target,
    },
    /// The slot has where the search has got. It is exchanged with the position, which is not before it. Moves back
    /// over up to `max` members of the class, no further than to what the slot had.
    WalkBack {
        slot: Slot,
        found: ScopeId,
        class: ClassId,
        max: u32,
    },
    Save {
        slot: Slot,
    },
    /// The position is the start of the subject, and goes into the slot.
    SaveStart {
        slot: Slot,
        fail: Target,
    },
    /// A metered load counts the distance as work.
    Load {
        from: Place,
        metered: bool,
    },
    /// Goes to `to` if the position plus the offset compares so with the place, which can be outside the subject.
    ComparePlace {
        when: Comparison,
        offset: i16,
        place: Place,
        to: Target,
    },
    /// Passes up to `max` members of the class and leaves `reserve` units.
    Run {
        direction: Direction,
        code_points: bool,
        /// Many members are expected.
        is_long: bool,
        /// Each unit is a turn for [`Op::CountTurn`].
        is_counted: bool,
        class: ClassId,
        max: u32,
        reserve: u32,
    },
    /// Moves against the direction, no further than `floor`, until the next unit in the direction passes the filter.
    /// A failure leaves the position somewhere on the way.
    GiveBack {
        direction: Direction,
        stride: Stride,
        floor: Place,
        filter: Filter,
        fail: Target,
    },
    /// Passes a code point of the class and leaves `reserve` units.
    CodePoint {
        direction: Direction,
        class: ClassId,
        reserve: u32,
        fail: Target,
    },
    /// Passes the text of the first capture in the list that is set, if one is, and leaves `reserve` units. A
    /// failure counts what has been compared as work.
    BackReference {
        direction: Direction,
        ignore_case: bool,
        first: u32,
        count: u32,
        reserve: u32,
        fail: Target,
    },

    Capture {
        offset: i16,
        entry: u32,
    },
    CapturePlace {
        place: Place,
        entry: u32,
    },
    Clear {
        pairs: Pairs,
    },
    SaveCaptures {
        slot: Slot,
        pairs: Pairs,
    },
    RestoreCaptures {
        slot: Slot,
        pairs: Pairs,
    },

    Zero {
        slot: Slot,
    },
    Increment {
        slot: Slot,
    },
    RaiseTo {
        slot: Slot,
        value: u32,
    },
    /// Goes to `to` if the number in the slot compares so with `value`.
    CompareNumber {
        when: Comparison,
        slot: Slot,
        value: u32,
        to: Target,
    },
    /// Counts work that no other operation does.
    Spend {
        work: u32,
    },
    /// A turn of a repeated group.
    CountTurn,

    /// Remembers where [`Op::Resume`] goes: `target`, which is at `index` among those of the scope.
    Choose {
        slot: Slot,
        index: u32,
        target: Target,
    },
    Resume {
        slot: Slot,
    },

    /// The loop has no turn yet.
    Enter {
        id: LoopId,
    },
    /// Starts a turn: keeps the position, and the cells and captures of the turn before, on the stack. Counts as work
    /// if they are many.
    Push {
        id: LoopId,
    },
    /// Gives a turn up: brings back what `Push` kept, and counts that and the distance as work.
    Pop {
        id: LoopId,
    },
    /// Ends a turn.
    Turned {
        id: LoopId,
        to: Target,
    },
    /// Goes back into the last turn, or to `none`.
    Retreat {
        id: LoopId,
        none: Target,
    },
    /// Remembers the height of the stack.
    Mark {
        slot: Slot,
    },
    /// Drops what has been pushed since.
    Cut {
        slot: Slot,
    },

    /// Goes to `seen` if the search has been here before in vain, or to where the lookaround ends if it has succeeded.
    Visit {
        site: SiteId,
        seen: Target,
    },
    /// Passes members of the class like [`Op::Run`], and visits each position from the present one on.
    VisitRun {
        direction: Direction,
        code_points: bool,
        class: ClassId,
        max: u32,
        reserve: u32,
        site: SiteId,
        seen: Target,
    },
    /// Starts to look around, that many levels deep.
    EnterLook {
        depth: u32,
    },
    LeaveLook {
        depth: u32,
        has_found: bool,
    },
    /// What the last visit at this position was for has failed, and something else is tried.
    DoubtVisit,
}

const _: () = assert!(size_of::<Op>() == 24);

/// An optional class.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Filter(u32);

impl Filter {
    #[inline]
    pub fn class(self) -> Option<ClassId> {
        (self.0 != u32::MAX).then_some(ClassId(self.0))
    }
}

impl From<Option<ClassId>> for Filter {
    fn from(class: Option<ClassId>) -> Filter {
        Filter(class.map_or(u32::MAX, |class| class.0))
    }
}

impl Op {
    /// The target that is named in the operation itself.
    #[inline]
    pub(crate) fn target_mut(&mut self) -> Option<&mut Target> {
        match self {
            Op::Jump { to }
            | Op::Again { to }
            | Op::ComparePlace { to, .. }
            | Op::CompareNumber { to, .. }
            | Op::Turned { to, .. } => Some(to),
            Op::Need { fail, .. }
            | Op::AtEdge { fail, .. }
            | Op::NotInPair { fail, .. }
            | Op::Unit { fail, .. }
            | Op::Word { fail, .. }
            | Op::Class { fail, .. }
            | Op::ClassCount { fail, .. }
            | Op::Pair { fail, .. }
            | Op::Scan { fail, .. }
            | Op::SaveStart { fail, .. }
            | Op::GiveBack { fail, .. }
            | Op::CodePoint { fail, .. }
            | Op::BackReference { fail, .. } => Some(fail),
            Op::Visit { seen, .. } | Op::VisitRun { seen, .. } => Some(seen),
            Op::Choose { target, .. } => Some(target),
            Op::Retreat { none, .. } => Some(none),
            Op::NoMatch
            | Op::Match { .. }
            | Op::MatchHere { .. }
            | Op::Switch { .. }
            | Op::Advance { .. }
            | Op::LeavePair
            | Op::SkipToTail { .. }
            | Op::WalkBack { .. }
            | Op::Save { .. }
            | Op::Load { .. }
            | Op::Run { .. }
            | Op::Capture { .. }
            | Op::CapturePlace { .. }
            | Op::Clear { .. }
            | Op::SaveCaptures { .. }
            | Op::RestoreCaptures { .. }
            | Op::Zero { .. }
            | Op::Increment { .. }
            | Op::RaiseTo { .. }
            | Op::Spend { .. }
            | Op::CountTurn
            | Op::Resume { .. }
            | Op::Enter { .. }
            | Op::Push { .. }
            | Op::Pop { .. }
            | Op::Mark { .. }
            | Op::Cut { .. }
            | Op::EnterLook { .. }
            | Op::LeaveLook { .. }
            | Op::DoubtVisit => None,
        }
    }

    /// About the cycles that machine code takes for it, but for what is in proportion to a distance that is passed
    /// and for what it counts by itself.
    #[inline]
    pub(crate) fn fixed_work(&self) -> u32 {
        match *self {
            Op::Class { .. } => 2,
            Op::ClassCount { count, .. } => 2 * u32::from(count),
            Op::Resume { .. } | Op::GiveBack { .. } | Op::Push { .. } | Op::Pop { .. } => 4,
            Op::Run { .. }
            | Op::VisitRun { .. }
            | Op::Switch { .. }
            | Op::NotInPair { .. }
            | Op::Pair { .. }
            | Op::CodePoint { .. }
            | Op::Scan { .. }
            | Op::WalkBack { .. } => 8,
            Op::Load { metered: false, .. } => 12,
            Op::BackReference { count, .. } => 8 + count,
            Op::Clear { pairs }
            | Op::SaveCaptures { pairs, .. }
            | Op::RestoreCaptures { pairs, .. } => 1 + u32::from(pairs.end - pairs.first),
            _ => 1,
        }
    }

    /// Whether the next operation can follow.
    #[inline]
    pub(crate) fn falls_through(&self) -> bool {
        !matches!(
            self,
            Op::Jump { .. }
                | Op::Again { .. }
                | Op::NoMatch
                | Op::Match { .. }
                | Op::MatchHere { .. }
                | Op::Switch { .. }
                | Op::Resume { .. }
                | Op::Turned { .. }
                | Op::Retreat { .. }
        )
    }
}

#[inline]
pub fn join_halves([low, high]: [u32; 2]) -> u64 {
    u64::from(high) << 32 | u64::from(low)
}

#[inline]
pub(crate) fn split_halves(word: u64) -> [u32; 2] {
    [word as u32, (word >> 32) as u32]
}
