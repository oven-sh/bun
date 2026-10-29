use crate::cut_choice::choose_cuts;
use crate::image::{AddressRange, ExecutableFormat};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct RemovableBytes {
    pub range: AddressRange,
    pub is_code: bool,
    pub can_be_cut: bool,
    pub can_be_filled: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Fill {
    pub range: AddressRange,
    pub is_code: bool,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum NoCutReason {
    HeadersUnreadable,
    HeaderRoomExhausted,
    SectionHeadersMissing,
    SegmentsNotCongruent,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum CutCapacity {
    Cuts(usize),
    NoCuts(NoCutReason),
}

impl CutCapacity {
    pub(crate) fn from_free_slots(free_slots: usize) -> CutCapacity {
        match free_slots {
            0 => CutCapacity::NoCuts(NoCutReason::HeaderRoomExhausted),
            _ => CutCapacity::Cuts(free_slots),
        }
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct CutModel {
    pub format: ExecutableFormat,
    pub alignment: u64,
    pub capacity: CutCapacity,
    pub cuttable_spans: Vec<AddressRange>,
    /// What is left of each stays one piece: a cut inside it reaches its end.
    pub spans_cut_only_at_end: Vec<AddressRange>,
}

impl CutModel {
    pub(crate) fn without_cuts(
        format: ExecutableFormat,
        alignment: u64,
        reason: NoCutReason,
    ) -> CutModel {
        CutModel {
            format,
            alignment,
            capacity: CutCapacity::NoCuts(reason),
            cuttable_spans: Vec::new(),
            spans_cut_only_at_end: Vec::new(),
        }
    }

    pub fn max_cuts(&self) -> usize {
        match self.capacity {
            CutCapacity::Cuts(count) => count,
            CutCapacity::NoCuts(_) => 0,
        }
    }

    pub fn choose(&self, removable: &[RemovableBytes]) -> CutPlan {
        choose_cuts(self, removable)
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum UncutReason {
    NoCuts(NoCutReason),
    BudgetSpent,
}

impl UncutReason {
    pub fn name(self) -> &'static str {
        match self {
            UncutReason::NoCuts(reason) => reason.into(),
            UncutReason::BudgetSpent => "BudgetSpent",
        }
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Uncut {
    pub reason: UncutReason,
    pub bytes: u64,
}

#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct CutPlan {
    pub cuts: Vec<AddressRange>,
    pub fills: Vec<Fill>,
    pub uncut: Option<Uncut>,
}

impl CutPlan {
    pub fn cut_bytes(&self) -> u64 {
        self.cuts.iter().map(|cut| cut.len()).sum()
    }

    pub fn filled_bytes(&self) -> u64 {
        self.fills.iter().map(|fill| fill.range.len()).sum()
    }
}
