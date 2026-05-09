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

    fn Bun__writeHTTPDate(buffer: *mut [u8; 32], length: usize, timestamp_ms: u64) -> c_int;
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
impl From<ParseDoubleError> for bun_core::Error {
    fn from(e: ParseDoubleError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

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

pub fn write_http_date(buffer: &mut [u8; 32], timestamp_ms: u64) -> &mut [u8] {
    if timestamp_ms == 0 {
        return &mut buffer[..0];
    }

    // SAFETY: buffer is a valid `*mut [u8; 32]`; length 32 matches.
    let res = unsafe { Bun__writeHTTPDate(buffer, 32, timestamp_ms) };
    if res < 1 {
        return &mut buffer[..0];
    }

    &mut buffer[..usize::try_from(res).expect("int cast")]
}

pub use crate::string_builder::StringBuilder;

// ported from: src/jsc/WTF.zig
