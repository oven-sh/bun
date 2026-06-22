// Canonical lives in `bun_alloc::wtf` so it is callable without a T6 dep.
pub use bun_alloc::wtf::release_fast_malloc_free_memory_for_this_thread;

// `WTF.parseDouble` canonical lives in bun_core::fmt (tier-0); re-exported here
// as `bun_jsc::wtf::parse_double`.
pub use bun_core::fmt::{InvalidCharacter, parse_double};
pub type ParseDoubleError = bun_core::fmt::InvalidCharacter;

// Canonical lives in bun_core (tier-0) so install/ can call it without bun_jsc.
pub use bun_core::wtf::{InvalidDate, parse_es5_date, parse_es5_date_raw};

// Canonical lives in `bun_http_types` so http code can call it without a
// bun_jsc dep; re-exported here.
pub use bun_http_types::ETag::wtf::write_http_date;

pub use crate::string_builder::StringBuilder;
