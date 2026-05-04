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

    fn WTF__numberOfProcessorCores() -> c_int;

    fn WTF__releaseFastMallocFreeMemoryForThisThread();

    fn WTF__parseES5Date(bytes: *const u8, length: usize) -> f64;

    fn Bun__writeHTTPDate(buffer: *mut [u8; 32], length: usize, timestamp_ms: u64) -> c_int;
}

/// On Linux, this is min(sysconf(_SC_NPROCESSORS_ONLN), sched_getaffinity count, cgroup cpu.max quota).
/// Result is cached after the first call.
pub fn number_of_processor_cores() -> u32 {
    // SAFETY: FFI call with no preconditions.
    let n = unsafe { WTF__numberOfProcessorCores() };
    u32::try_from(n.max(1)).unwrap()
}

pub fn release_fast_malloc_free_memory_for_this_thread() {
    // SAFETY: FFI call with no preconditions.
    unsafe { WTF__releaseFastMallocFreeMemoryForThisThread() };
}

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
    let res = unsafe { WTF__parseDouble(buf.as_ptr(), buf.len(), &mut count) };

    if count == 0 {
        return Err(ParseDoubleError::InvalidCharacter);
    }
    Ok(res)
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ParseDateError {
    #[error("InvalidDate")]
    InvalidDate,
}
impl From<ParseDateError> for bun_core::Error {
    fn from(e: ParseDateError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

// 2000-01-01T00:00:00.000Z -> 946684800000 (ms)
pub fn parse_es5_date(buf: &[u8]) -> Result<f64, ParseDateError> {
    if buf.is_empty() {
        return Err(ParseDateError::InvalidDate);
    }

    // SAFETY: buf.as_ptr() is valid for buf.len() bytes.
    let ms = unsafe { WTF__parseES5Date(buf.as_ptr(), buf.len()) };
    if ms.is_finite() {
        return Ok(ms);
    }

    Err(ParseDateError::InvalidDate)
}

pub fn write_http_date(buffer: &mut [u8; 32], timestamp_ms: u64) -> &mut [u8] {
    if timestamp_ms == 0 {
        return &mut buffer[..0];
    }

    // SAFETY: buffer is a valid `*mut [u8; 32]`; length 32 matches.
    let res = unsafe { Bun__writeHTTPDate(buffer, 32, timestamp_ms) };
    if res < 1 {
        return &mut buffer[..0];
    }

    &mut buffer[..usize::try_from(res).unwrap()]
}

pub use crate::string_builder::StringBuilder;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/WTF.zig (71 lines)
//   confidence: high
//   todos:      1
//   notes:      namespace struct flattened to module; markBinding calls dropped
// ──────────────────────────────────────────────────────────────────────────
