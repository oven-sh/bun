//! Native symbols that Bun's C++ side provides, for this probe binary only. Never part of the change.
#![allow(clippy::missing_safety_doc)]
use core::ffi::{c_char, c_int, c_void};

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__initialize() {}

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut c_void {
    let probe: u8 = 0;
    let approx_sp = (&raw const probe) as usize;
    // `main` runs the work on a thread with a 64 MiB stack: leave the last 4 MiB alone.
    let size = STACK_SIZE.load(core::sync::atomic::Ordering::Relaxed);
    let base = STACK_TOP.load(core::sync::atomic::Ordering::Relaxed);
    if base == 0 {
        return (approx_sp.saturating_sub(6 * 1024 * 1024)) as *mut c_void;
    }
    (base.saturating_sub(size) + 4 * 1024 * 1024) as *mut c_void
}

pub(crate) static STACK_TOP: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);
pub(crate) static STACK_SIZE: core::sync::atomic::AtomicUsize = core::sync::atomic::AtomicUsize::new(0);

#[repr(C)]
struct SimdutfResult {
    status: i32,
    count: usize,
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_utf8(buf: *const u8, len: usize) -> bool {
    core::str::from_utf8(unsafe { core::slice::from_raw_parts(buf, len) }).is_ok()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii(buf: *const u8, len: usize) -> bool {
    unsafe { core::slice::from_raw_parts(buf, len) }.is_ascii()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le(input: *const u16, length: usize) -> usize {
    let units = unsafe { core::slice::from_raw_parts(input, length) };
    char::decode_utf16(units.iter().copied()).map(|c| c.map_or(3, char::len_utf8)).sum()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(input: *const u16, length: usize) -> usize {
    unsafe { simdutf__utf8_length_from_utf16le(input, length) }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf16le_to_utf8_with_errors(buf: *const u16, len: usize, out: *mut u8) -> SimdutfResult {
    let units = unsafe { core::slice::from_raw_parts(buf, len) };
    let mut written = 0usize;
    let mut read = 0usize;
    for c in char::decode_utf16(units.iter().copied()) {
        match c {
            Ok(c) => {
                let mut tmp = [0u8; 4];
                let s = c.encode_utf8(&mut tmp);
                unsafe { core::ptr::copy_nonoverlapping(s.as_ptr(), out.add(written), s.len()) };
                written += s.len();
                read += c.len_utf16();
            }
            Err(_) => return SimdutfResult { status: 6, count: read },
        }
    }
    SimdutfResult { status: 0, count: written }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__base64_encode(_: *const u8, _: usize, _: *mut u8, _: c_int) -> usize {
    std::process::abort()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64 {
    let s = unsafe { core::slice::from_raw_parts(bytes, length) };
    let mut i = 0;
    if i < s.len() && (s[i] == b'+' || s[i] == b'-') {
        i += 1;
    }
    let digits_start = i;
    while i < s.len() && s[i].is_ascii_digit() {
        i += 1;
    }
    let mut any = i > digits_start;
    if i < s.len() && s[i] == b'.' {
        let mut k = i + 1;
        while k < s.len() && s[k].is_ascii_digit() {
            k += 1;
        }
        if any || k > i + 1 {
            any = true;
            i = k;
        }
    }
    if any && i < s.len() && (s[i] == b'e' || s[i] == b'E') {
        let mut k = i + 1;
        if k < s.len() && (s[k] == b'+' || s[k] == b'-') {
            k += 1;
        }
        let exp_start = k;
        while k < s.len() && s[k].is_ascii_digit() {
            k += 1;
        }
        if k > exp_start {
            i = k;
        }
    }
    if !any {
        unsafe { *counted = 0 };
        return 0.0;
    }
    unsafe { *counted = i };
    core::str::from_utf8(&s[..i]).ok().and_then(|t| t.parse::<f64>().ok()).unwrap_or(f64::NAN)
}

#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__DumpStackTrace(_: *const usize, _: usize) {}

#[unsafe(no_mangle)]
extern "C" fn bun_cpu_features() -> u8 {
    0
}

#[unsafe(no_mangle)]
unsafe extern "C" fn is_executable_file(_: *const c_char) -> bool {
    false
}

#[unsafe(no_mangle)]
extern "C" fn bun_restore_stdio() {}

#[unsafe(no_mangle)]
extern "C" fn on_before_reload_process_posix() {}

#[unsafe(no_mangle)]
unsafe extern "C" fn posix_spawn_bun(_: *mut c_int, _: *const c_char, _: *const c_void, _: *const *const c_char, _: *const *const c_char) -> isize {
    std::process::abort()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn compress2(_: *mut u8, _: *mut usize, _: *const u8, _: usize, _: c_int) -> c_int {
    std::process::abort()
}

#[unsafe(no_mangle)]
extern "Rust" fn __bun_macro_context_get_remap(_: *mut c_void, _: &[u8]) -> Option<&'static ()> {
    None
}

#[unsafe(no_mangle)]
extern "C" fn WTFReportAssertionFailure(_: *const c_char, _: c_int, _: *const c_char, _: *const c_char) {
    std::process::abort()
}

#[unsafe(no_mangle)]
extern "C" fn WTFReportAssertionFailureWithMessage(_: *const c_char, _: c_int, _: *const c_char, _: *const c_char, _: *const c_char) {
    std::process::abort()
}

#[unsafe(no_mangle)]
extern "C" fn WTFReportBacktrace() {}

/// ECMAScript `Number::toString(10)`.
#[unsafe(no_mangle)]
extern "C" fn WTF__dtoa(buf: &mut [u8; 124], number: f64) -> usize {
    let text = js_number(number);
    buf[..text.len()].copy_from_slice(text.as_bytes());
    text.len()
}

fn js_number(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x == 0.0 {
        return "0".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x < 0.0 {
        return format!("-{}", js_number(-x));
    }
    let sci = format!("{x:e}");
    let (mantissa, exponent) = sci.split_once('e').unwrap();
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().unwrap() + 1;
    if k <= n && n <= 21 {
        return format!("{digits}{}", "0".repeat((n - k) as usize));
    }
    if 0 < n && n <= 21 {
        return format!("{}.{}", &digits[..n as usize], &digits[n as usize..]);
    }
    if -6 < n && n <= 0 {
        return format!("0.{}{digits}", "0".repeat((-n) as usize));
    }
    let e = n - 1;
    let sign = if e < 0 { '-' } else { '+' };
    if k == 1 {
        return format!("{digits}e{sign}{}", e.abs());
    }
    format!("{}.{}e{sign}{}", &digits[..1], &digits[1..], e.abs())
}

// ── added for the full parse (visit pass) ──
#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__validate_ascii_with_errors(buf: *const u8, len: usize) -> SimdutfResult {
    let s = unsafe { core::slice::from_raw_parts(buf, len) };
    match s.iter().position(|b| !b.is_ascii()) {
        Some(i) => SimdutfResult { status: 1, count: i },
        None => SimdutfResult { status: 0, count: len },
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__utf16_length_from_utf8(input: *const u8, length: usize) -> usize {
    let s = unsafe { core::slice::from_raw_parts(input, length) };
    String::from_utf8_lossy(s).encode_utf16().count()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn simdutf__convert_utf8_to_utf16le_with_errors(buf: *const u8, len: usize, out: *mut u16) -> SimdutfResult {
    let s = unsafe { core::slice::from_raw_parts(buf, len) };
    match core::str::from_utf8(s) {
        Ok(text) => {
            let mut n = 0usize;
            for unit in text.encode_utf16() {
                unsafe { *out.add(n) = unit };
                n += 1;
            }
            SimdutfResult { status: 0, count: n }
        }
        Err(e) => SimdutfResult { status: 1, count: e.valid_up_to() },
    }
}

#[unsafe(no_mangle)]
extern "Rust" fn __bun_macro_context_call() {
    eprintln!("PROBE: __bun_macro_context_call reached");
    std::process::abort()
}

#[unsafe(no_mangle)]
extern "C" fn __bun_dispatch__TranspilerCacheImpl__Jsc__get() {
    eprintln!("PROBE: transpiler cache reached");
    std::process::abort()
}

#[unsafe(no_mangle)]
extern "C" fn URL__getFileURLString() {
    eprintln!("PROBE: URL__getFileURLString reached");
    std::process::abort()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn JSC__jsToNumber(ptr: *const u8, len: usize) -> f64 {
    let s = unsafe { core::slice::from_raw_parts(ptr, len) };
    core::str::from_utf8(s).ok().and_then(|t| t.trim().parse::<f64>().ok()).unwrap_or(f64::NAN)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__linux_trace_init() -> c_int {
    0
}

#[unsafe(no_mangle)]
extern "C" fn Bun__linux_trace_emit() {}

#[unsafe(no_mangle)]
extern "C" fn Bun__WTFStringImpl__destroy(_: *const c_void) {
    eprintln!("PROBE: WTFStringImpl destroy reached");
    std::process::abort()
}

#[unsafe(no_mangle)]
extern "C" fn Bun__JSC__operationMathPow(x: f64, y: f64) -> f64 {
    x.powf(y)
}
