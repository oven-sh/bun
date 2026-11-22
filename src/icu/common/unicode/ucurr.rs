//! `unicode/ucurr.h`

pub(crate) type UCurrNameStyle = i32;
pub(crate) const UCURR_SYMBOL_NAME: UCurrNameStyle = 0;
pub(crate) const UCURR_LONG_NAME: UCurrNameStyle = 1;
pub(crate) const UCURR_NARROW_SYMBOL_NAME: UCurrNameStyle = 2;
pub(crate) const UCURR_FORMAL_SYMBOL_NAME: UCurrNameStyle = 3;

pub(crate) const UCURR_ALL: u32 = 2147483647;
