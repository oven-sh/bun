use core::ffi::c_int;

// PORT NOTE: Zig wraps everything in `pub const WTF = struct { ... }` as a
// namespace. In Rust the file itself is the module, so items live at module
// level. Callers use `bun_jsc::wtf::foo()`.
//
// PORT NOTE: `jsc.markBinding(@src())` calls dropped — debug-only binding
// presence marker with no Rust equivalent.

// TODO(port): move to jsc_sys
unsafe extern "C" {
    fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64;

    safe fn WTF__numberOfProcessorCores() -> c_int;
}

/// On Linux, this is min(sysconf(_SC_NPROCESSORS_ONLN), sched_getaffinity count, cgroup cpu.max quota).
/// Result is cached after the first call.
pub fn number_of_processor_cores() -> u32 {
    let n = WTF__numberOfProcessorCores();
    u32::try_from(n.max(1)).expect("int cast")
}

// MOVE_DOWN(b0): canonical lives in bun_alloc so bun_threading (T2) can call it
// without a T6 dep. Re-exported here to keep the original Zig namespace shape.
pub use bun_alloc::wtf::release_fast_malloc_free_memory_for_this_thread;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ParseDoubleError {
    #[error("InvalidCharacter")]
    InvalidCharacter,
}
bun_core::named_error_set!(ParseDoubleError);

pub fn parse_double(buf: &[u8]) -> Result<f64, ParseDoubleError> {
    if buf.is_empty() {
        return Err(ParseDoubleError::InvalidCharacter);
    }

    let mut count: usize = 0;
    // SAFETY: buf.as_ptr() is valid for buf.len() bytes; `count` is a valid out-param.
    let res = unsafe { WTF__parseDouble(buf.as_ptr(), buf.len(), &raw mut count) };

    if count == 0 {
        return Err(ParseDoubleError::InvalidCharacter);
    }
    Ok(res)
}

// Canonical lives in bun_core (tier-0) so install/ can call it without bun_jsc.
pub use bun_core::wtf::{parse_es5_date, parse_es5_date_raw, InvalidDate};
/// Back-compat alias for the Zig namespace shape.
pub type ParseDateError = bun_core::wtf::InvalidDate;

// MOVE_DOWN(b0): canonical lives in bun_http_types (T3) so bun_resolver can call
// it without a bun_jsc dep. Re-exported here to keep the Zig namespace shape
// (src/jsc/WTF.zig:52).
pub use bun_http_types::ETag::wtf::write_http_date;

pub use crate::string_builder::StringBuilder;

// ported from: src/jsc/WTF.zig
