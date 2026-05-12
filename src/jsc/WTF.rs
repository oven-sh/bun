use core::ffi::c_int;

// PORT NOTE: Zig wraps everything in `pub const WTF = struct { ... }` as a
// namespace. In Rust the file itself is the module, so items live at module
// level. Callers use `bun_jsc::wtf::foo()`.
//
// PORT NOTE: `jsc.markBinding(@src())` calls dropped — debug-only binding
// presence marker with no Rust equivalent.

// TODO(port): move to jsc_sys
unsafe extern "C" {
    safe fn WTF__numberOfProcessorCores() -> c_int;
}

/// On Linux, this is min(sysconf(_SC_NPROCESSORS_ONLN), sched_getaffinity count, cgroup cpu.max quota).
/// Result is cached after the first call.
pub fn number_of_processor_cores() -> u32 {
    let n = WTF__numberOfProcessorCores();
    u32::try_from(n.max(1)).expect("int cast")
}

// without a T6 dep. Re-exported here to keep the original Zig namespace shape.
pub use bun_alloc::wtf::release_fast_malloc_free_memory_for_this_thread;

// `WTF.parseDouble` canonical lives in bun_core::fmt (tier-0); re-exported here
// to keep the Zig namespace shape (`bun_jsc::wtf::parse_double`).
pub use bun_core::fmt::{InvalidCharacter, parse_double};
/// Back-compat alias for the Zig `error{InvalidCharacter}` set name.
pub type ParseDoubleError = bun_core::fmt::InvalidCharacter;

// Canonical lives in bun_core (tier-0) so install/ can call it without bun_jsc.
pub use bun_core::wtf::{InvalidDate, parse_es5_date, parse_es5_date_raw};
/// Back-compat alias for the Zig namespace shape.
pub type ParseDateError = bun_core::wtf::InvalidDate;

// it without a bun_jsc dep. Re-exported here to keep the Zig namespace shape
// (src/jsc/WTF.zig:52).
pub use bun_http_types::ETag::wtf::write_http_date;

pub use crate::string_builder::StringBuilder;

// ported from: src/jsc/WTF.zig
