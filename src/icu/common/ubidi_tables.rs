//! The state tables of the implicit rules of UAX #9, as in ubidi.cpp.
//!
//! `IMP_TAB_PROPS` reads the properties of a level run and cuts it into sequences of one *reduced* property (W1 to W7).
//! An `ImpTab` reads these sequences and gives each its level (N1, N2, I1, I2).

use crate::common::slice_ext::SliceExt;

/// The columns of an `ImpTab`, and the first ones of `IMP_TAB_PROPS`.
pub(crate) mod reduced {
    pub(crate) const L: u8 = 0;
    pub(crate) const R: u8 = 1;
    pub(crate) const EN: u8 = 2;
    pub(crate) const AN: u8 = 3;
    pub(crate) const ON: u8 = 4;
    pub(crate) const S: u8 = 5;
    pub(crate) const B: u8 = 6;
}
use reduced::{AN, B, EN, L, ON, R, S};

/// A cell is written `state` or `action:state`, ICU4C's `s(action,state)`.
macro_rules! cells {
    ($([$($first:tt $(: $state:tt)?),*],)*) => { [$([$($first $(<< 5 | $state)?),*]),*] };
}

pub(crate) fn state(cell: u8) -> u8 {
    cell & 0x1f
}

pub(crate) fn action(cell: u8) -> u8 {
    cell >> 5
}

/// The column of `IMP_TAB_PROPS` for each `DirProp`.
#[rustfmt::skip]
pub(crate) static GROUP_PROP: [u8; 25] = [
/*  L   R   EN  ES  ET  AN  CS  B   S   WS  ON  LRE LRO AL  RLE RLO PDF NSM BN  FSI LRI RLI PDI ENL ENR */
    0,  1,  2,  7,  8,  3,  9,  6,  5,  4,  4,  10, 10, 12, 10, 10, 10, 11, 10, 4,  4,  4,  4,  13, 14
];

/// `Res` is the reduced property of the sequence read so far. Action 2 starts a second sequence, which the following
/// text either merges with the first sequence or separates from it.
#[rustfmt::skip]
static IMP_TAB_PROPS: [[u8; 16]; 24] = cells![
    /*                      L    R   EN   AN   ON    S    B   ES   ET   CS   BN  NSM   AL  ENL  ENR  Res */
    /* 0 Init        */ [   1,   2,   4,   5,   7,  15,  17,   7,   9,   7,   0,   7,   3,  18,  21,  ON],
    /* 1 L           */ [   1, 1:2, 1:4, 1:5, 1:7,1:15,1:17, 1:7, 1:9, 1:7,   1,   1, 1:3,1:18,1:21,   L],
    /* 2 R           */ [ 1:1,   2, 1:4, 1:5, 1:7,1:15,1:17, 1:7, 1:9, 1:7,   2,   2, 1:3,1:18,1:21,   R],
    /* 3 AL          */ [ 1:1, 1:2, 1:6, 1:6, 1:8,1:16,1:17, 1:8, 1:8, 1:8,   3,   3,   3,1:18,1:21,   R],
    /* 4 EN          */ [ 1:1, 1:2,   4, 1:5, 1:7,1:15,1:17,2:10,  11,2:10,   4,   4, 1:3,  18,  21,  EN],
    /* 5 AN          */ [ 1:1, 1:2, 1:4,   5, 1:7,1:15,1:17, 1:7, 1:9,2:12,   5,   5, 1:3,1:18,1:21,  AN],
    /* 6 AL:EN/AN    */ [ 1:1, 1:2,   6,   6, 1:8,1:16,1:17, 1:8, 1:8,2:13,   6,   6, 1:3,  18,  21,  AN],
    /* 7 ON          */ [ 1:1, 1:2, 1:4, 1:5,   7,1:15,1:17,   7,2:14,   7,   7,   7, 1:3,1:18,1:21,  ON],
    /* 8 AL:ON       */ [ 1:1, 1:2, 1:6, 1:6,   8,1:16,1:17,   8,   8,   8,   8,   8, 1:3,1:18,1:21,  ON],
    /* 9 ET          */ [ 1:1, 1:2,   4, 1:5,   7,1:15,1:17,   7,   9,   7,   9,   9, 1:3,  18,  21,  ON],
    /*10 EN+ES/CS    */ [ 3:1, 3:2,   4, 3:5, 4:7,3:15,3:17, 4:7,4:14, 4:7,  10, 4:7, 3:3,  18,  21,  EN],
    /*11 EN+ET       */ [ 1:1, 1:2,   4, 1:5, 1:7,1:15,1:17, 1:7,  11, 1:7,  11,  11, 1:3,  18,  21,  EN],
    /*12 AN+CS       */ [ 3:1, 3:2, 3:4,   5, 4:7,3:15,3:17, 4:7,4:14, 4:7,  12, 4:7, 3:3,3:18,3:21,  AN],
    /*13 AL:EN/AN+CS */ [ 3:1, 3:2,   6,   6, 4:8,3:16,3:17, 4:8, 4:8, 4:8,  13, 4:8, 3:3,  18,  21,  AN],
    /*14 ON+ET       */ [ 1:1, 1:2, 4:4, 1:5,   7,1:15,1:17,   7,  14,   7,  14,  14, 1:3,4:18,4:21,  ON],
    /*15 S           */ [ 1:1, 1:2, 1:4, 1:5, 1:7,  15,1:17, 1:7, 1:9, 1:7,  15, 1:7, 1:3,1:18,1:21,   S],
    /*16 AL:S        */ [ 1:1, 1:2, 1:6, 1:6, 1:8,  16,1:17, 1:8, 1:8, 1:8,  16, 1:8, 1:3,1:18,1:21,   S],
    /*17 B           */ [ 1:1, 1:2, 1:4, 1:5, 1:7,1:15,  17, 1:7, 1:9, 1:7,  17, 1:7, 1:3,1:18,1:21,   B],
    /*18 ENL         */ [ 1:1, 1:2,  18, 1:5, 1:7,1:15,1:17,2:19,  20,2:19,  18,  18, 1:3,  18,  21,   L],
    /*19 ENL+ES/CS   */ [ 3:1, 3:2,  18, 3:5, 4:7,3:15,3:17, 4:7,4:14, 4:7,  19, 4:7, 3:3,  18,  21,   L],
    /*20 ENL+ET      */ [ 1:1, 1:2,  18, 1:5, 1:7,1:15,1:17, 1:7,  20, 1:7,  20,  20, 1:3,  18,  21,   L],
    /*21 ENR         */ [ 1:1, 1:2,  21, 1:5, 1:7,1:15,1:17,2:22,  23,2:22,  21,  21, 1:3,  18,  21,  AN],
    /*22 ENR+ES/CS   */ [ 3:1, 3:2,  21, 3:5, 4:7,3:15,3:17, 4:7,4:14, 4:7,  22, 4:7, 3:3,  18,  21,  AN],
    /*23 ENR+ET      */ [ 1:1, 1:2,  21, 1:5, 1:7,1:15,1:17, 1:7,  23, 1:7,  23,  23, 1:3,  18,  21,  AN],
];

pub(crate) fn props_cell(state: u8, group: u8) -> u8 {
    IMP_TAB_PROPS
        .as_flattened()
        .at(usize::from(state) * 16 + usize::from(group))
}

pub(crate) fn res_prop(state: u8) -> u8 {
    props_cell(state, 15)
}

/// The actions of processPropertySeq, in the order of ICU4C's numbers.
#[derive(Clone, Copy, Default)]
pub(crate) enum Action {
    #[default]
    None,
    InitOnSeq,
    PrependOnSeq,
    NumberAfterROn,
}
use Action::*;

static IMP_ACT0: [Action; 4] = [None, InitOnSeq, PrependOnSeq, NumberAfterROn];

/// `Res` is added to the level of the run for a sequence that leads to the state. Later actions may revise it.
pub(crate) struct ImpTab {
    rows: &'static [[u8; 8]],
    /// Indexed by the action number of a cell.
    actions: &'static [Action],
}

impl ImpTab {
    pub(crate) fn cell(&self, state: u8, prop: u8) -> u8 {
        self.rows
            .as_flattened()
            .at(usize::from(state) * 8 + usize::from(prop))
    }

    /// Returns at most 2.
    pub(crate) fn add_level(&self, state: u8) -> u8 {
        self.cell(state, 7)
    }

    pub(crate) fn action(&self, cell: u8) -> Action {
        self.actions.at(action(cell).into())
    }
}

#[rustfmt::skip]
static L_DEFAULT: ImpTab = ImpTab { actions: &IMP_ACT0, rows: &cells![
    /*                      L    R   EN   AN   ON    S    B  Res */
    /* 0 init        */ [   0,   1,   0,   2,   0,   0,   0,   0],
    /* 1 R           */ [   0,   1,   3,   3, 1:4, 1:4,   0,   1],
    /* 2 AN          */ [   0,   1,   0,   2, 1:5, 1:5,   0,   2],
    /* 3 R+EN/AN     */ [   0,   1,   3,   3, 1:4, 1:4,   0,   2],
    /* 4 R+ON        */ [   0, 2:1, 3:3, 3:3,   4,   4,   0,   0],
    /* 5 AN+ON       */ [   0, 2:1,   0, 3:2,   5,   5,   0,   0],
] };

#[rustfmt::skip]
static R_DEFAULT: ImpTab = ImpTab { actions: &IMP_ACT0, rows: &cells![
    /*                      L    R   EN   AN   ON    S    B  Res */
    /* 0 init        */ [   1,   0,   2,   2,   0,   0,   0,   0],
    /* 1 L           */ [   1,   0,   1,   3, 1:4, 1:4,   0,   1],
    /* 2 EN/AN       */ [   1,   0,   2,   2,   0,   0,   0,   1],
    /* 3 L+AN        */ [   1,   0,   1,   3,   5,   5,   0,   1],
    /* 4 L+ON        */ [ 2:1,   0, 2:1,   3,   4,   4,   0,   0],
    /* 5 L+AN+ON     */ [   1,   0,   1,   3,   5,   5,   0,   0],
] };

/// The tables for runs at an even and at an odd level.
pub(crate) type ImpTabPair = [&'static ImpTab; 2];

pub(crate) static DEFAULT: ImpTabPair = [&L_DEFAULT, &R_DEFAULT];
