// PORT NOTE: Zig wraps everything in `pub const WTF = struct { ... }` as a
// namespace. In Rust the file itself is the module, so items live at module
// level. Callers use `bun_jsc::wtf::foo()`.
//
// PORT NOTE: `jsc.markBinding(@src())` calls dropped — debug-only binding
// presence marker with no Rust equivalent.

// without a T6 dep. Re-exported here to keep the original Zig namespace shape.
pub use bun_alloc::wtf::release_fast_malloc_free_memory_for_this_thread;

// `WTF.parseDouble` canonical lives in bun_core::fmt (tier-0); re-exported here
// to keep the Zig namespace shape (`bun_jsc::wtf::parse_double`).
pub use bun_core::fmt::{InvalidCharacter, parse_double};
pub type ParseDoubleError = bun_core::fmt::InvalidCharacter;

// Canonical lives in bun_core (tier-0) so install/ can call it without bun_jsc.
pub use bun_core::wtf::{InvalidDate, parse_es5_date, parse_es5_date_raw};

// it without a bun_jsc dep. Re-exported here to keep the Zig namespace shape
// (src/jsc/WTF.zig:52).
pub use bun_http_types::ETag::wtf::write_http_date;

pub use crate::string_builder::StringBuilder;

// ported from: src/jsc/WTF.zig
