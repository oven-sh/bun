//! `unicode/udisplaycontext.h`

pub(crate) type UDisplayContext = i32;
pub(crate) const UDISPCTX_STANDARD_NAMES: UDisplayContext = 0;
pub(crate) const UDISPCTX_DIALECT_NAMES: UDisplayContext = 1;
pub(crate) const UDISPCTX_CAPITALIZATION_FOR_STANDALONE: UDisplayContext = 260;
pub(crate) const UDISPCTX_LENGTH_FULL: UDisplayContext = 512;
pub(crate) const UDISPCTX_LENGTH_SHORT: UDisplayContext = 513;
pub(crate) const UDISPCTX_NO_SUBSTITUTE: UDisplayContext = 769;
