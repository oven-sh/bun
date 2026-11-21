//! `unicode/uloc.h`

pub(crate) type ULayoutType = i32;
pub(crate) const ULOC_LAYOUT_LTR: ULayoutType = 0;
pub(crate) const ULOC_LAYOUT_RTL: ULayoutType = 1;
pub(crate) const ULOC_LAYOUT_TTB: ULayoutType = 2;
pub(crate) const ULOC_LAYOUT_BTT: ULayoutType = 3;
pub(crate) const ULOC_LAYOUT_UNKNOWN: ULayoutType = 4;

pub(crate) const ULOC_FULLNAME_CAPACITY: i32 = 157;
pub(crate) const ULOC_KEYWORDS_CAPACITY: i32 = 96;
