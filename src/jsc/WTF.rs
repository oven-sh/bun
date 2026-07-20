// `WTF.parseDouble` canonical lives in bun_core::fmt (tier-0); re-exported here
// as `bun_jsc::wtf::parse_double`.
pub use bun_core::fmt::{InvalidCharacter, parse_double};
pub type ParseDoubleError = bun_core::fmt::InvalidCharacter;

// Canonical lives in bun_core (tier-0) so install/ can call it without bun_jsc.
pub use bun_core::wtf::{InvalidDate, parse_es5_date, parse_es5_date_raw};

/// ECMA-262 §21.4.1.1 Time Value range bound (±8.64e15 ms). Mirrors
/// `WTF::maxECMAScriptTime`; a static_assert in wtf-bindings.cpp keeps them in sync.
pub const MAX_ECMASCRIPT_TIME: f64 = 8.64e15;

// Canonical lives in `bun_http_types` so http code can call it without a
// bun_jsc dep; re-exported here.
pub use bun_http_types::ETag::wtf::write_http_date;

pub use crate::string_builder::StringBuilder;
