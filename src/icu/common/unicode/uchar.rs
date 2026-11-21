//! `unicode/uchar.h`

pub(crate) type UCharCategory = i32;
pub(crate) const U_LOWERCASE_LETTER: UCharCategory = 2;
pub(crate) const U_SPACE_SEPARATOR: UCharCategory = 12;

pub(crate) type UCharDirection = i32;
pub(crate) const U_LEFT_TO_RIGHT: UCharDirection = 0;
pub(crate) const U_RIGHT_TO_LEFT: UCharDirection = 1;
pub(crate) const U_EUROPEAN_NUMBER: UCharDirection = 2;
pub(crate) const U_EUROPEAN_NUMBER_SEPARATOR: UCharDirection = 3;
pub(crate) const U_EUROPEAN_NUMBER_TERMINATOR: UCharDirection = 4;
pub(crate) const U_ARABIC_NUMBER: UCharDirection = 5;
pub(crate) const U_COMMON_NUMBER_SEPARATOR: UCharDirection = 6;
pub(crate) const U_OTHER_NEUTRAL: UCharDirection = 10;
pub(crate) const U_RIGHT_TO_LEFT_ARABIC: UCharDirection = 13;
pub(crate) const U_DIR_NON_SPACING_MARK: UCharDirection = 17;
pub(crate) const U_BOUNDARY_NEUTRAL: UCharDirection = 18;

pub(crate) type UJoiningType = i32;
pub(crate) const U_JT_DUAL_JOINING: UJoiningType = 2;
pub(crate) const U_JT_LEFT_JOINING: UJoiningType = 3;
pub(crate) const U_JT_RIGHT_JOINING: UJoiningType = 4;
pub(crate) const U_JT_TRANSPARENT: UJoiningType = 5;

pub(crate) type ULineBreak = i32;
pub(crate) const U_LB_COMPLEX_CONTEXT: ULineBreak = 24;

pub(crate) const U_GC_ND_MASK: i32 = 512;
pub(crate) const U_GC_M_MASK: i32 = 448;
pub(crate) const U_GC_Z_MASK: i32 = 28672;
pub(crate) const U_GC_S_MASK: i32 = 251658240;
