//! Native symbols normally provided by Bun's C++ / high-tier-Rust side, shimmed
//! for this crate's `cargo bench` binary. The highway SIMD symbols the lexer
//! calls are linked from the real `highway_strings.cpp` via
//! `scripts/bench-jsparser-rust.sh`; everything here is either unreached during
//! a plain-JS parse or a thin functional stand-in.
#![allow(non_snake_case, dead_code, improper_ctypes_definitions)]

use core::ffi::{c_char, c_int, c_void};

#[unsafe(no_mangle)]
extern "C" fn Bun__StackCheck__getMaxStack() -> *mut c_void {
    let probe: u8 = 0;
    let approx_sp = (&raw const probe) as usize;
    (approx_sp.saturating_sub(4 * 1024 * 1024)) as *mut c_void
}

#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__parseDouble(bytes: *const u8, length: usize, counted: *mut usize) -> f64 {
    let s = unsafe { core::slice::from_raw_parts(bytes, length) };
    match core::str::from_utf8(s)
        .ok()
        .and_then(|s| s.parse::<f64>().ok())
    {
        Some(v) => {
            unsafe { *counted = length };
            v
        }
        None => {
            unsafe { *counted = 0 };
            0.0
        }
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn WTF__dtoa(buf: &mut [u8; 124], number: f64) -> usize {
    use std::io::Write;
    let mut c = std::io::Cursor::new(&mut buf[..]);
    let _ = write!(c, "{number}");
    c.position() as usize
}

#[unsafe(no_mangle)]
unsafe extern "C" fn JSC__jsToNumber(ptr: *const u8, len: usize) -> f64 {
    let mut n = 0usize;
    unsafe { WTF__parseDouble(ptr, len, &raw mut n) }
}

#[unsafe(no_mangle)]
extern "C" fn Bun__JSC__operationMathPow(x: f64, y: f64) -> f64 {
    x.powf(y)
}

#[unsafe(no_mangle)]
extern "C" fn Bun__linux_trace_init() -> c_int {
    0
}
#[unsafe(no_mangle)]
extern "C" fn Bun__linux_trace_close() {}
#[unsafe(no_mangle)]
extern "C" fn Bun__linux_trace_emit(_: *const u8, _: usize, _: u64, _: u64) {}

#[unsafe(no_mangle)]
extern "C" fn bun_restore_stdio() {}
#[unsafe(no_mangle)]
extern "C" fn bun_cpu_features() -> u8 {
    0
}
#[unsafe(no_mangle)]
extern "C" fn is_executable_file(_: *const c_char) -> bool {
    false
}
#[unsafe(no_mangle)]
extern "C" fn Bun__WTFStringImpl__destroy(_: *const c_void) {}
#[unsafe(no_mangle)]
extern "C" fn URL__getFileURLString(_: &mut bun_core::String) -> bun_core::String {
    bun_core::String::empty()
}

#[unsafe(no_mangle)]
extern "C" fn compress2(_: *mut u8, _: *mut usize, _: *const u8, _: usize, _: c_int) -> c_int {
    -1
}

#[unsafe(no_mangle)]
extern "C" fn simdutf__base64_encode(_: *const u8, _: usize, _: *mut u8, _: c_int) -> usize {
    0
}
#[unsafe(no_mangle)]
extern "C" fn simdutf__utf8_length_from_utf16le_with_replacement(
    _: *const u16,
    len: usize,
) -> usize {
    len * 3
}

// `extern "Rust"` link-time dispatch slots declared by `bun_dispatch::link_interface!`
// in lower-tier crates; the real impls live in `bun_jsc` / `bun_js_parser_jsc`.
#[unsafe(no_mangle)]
extern "Rust" fn __bun_dispatch__TranspilerCacheImpl__Jsc__get(
    _: *mut c_void,
    _: &bun_ast::Source,
    _: core::ptr::NonNull<()>,
    _: bool,
) -> bool {
    false
}
#[unsafe(no_mangle)]
extern "Rust" fn __bun_dispatch__TranspilerCacheImpl__Jsc__put(
    _: *mut c_void,
    _: &[u8],
    _: &[u8],
    _: &[u8],
) {
}
#[unsafe(no_mangle)]
extern "Rust" fn __bun_dispatch__TranspilerCacheImpl__Jsc__is_disabled(_: *mut c_void) -> bool {
    true
}

#[unsafe(no_mangle)]
extern "Rust" fn __bun_macro_context_call(
    _: &mut bun_js_parser::Macro::MacroContext,
    _: &[u8],
    _: &[u8],
    _: &mut bun_ast::Log,
    _: &bun_ast::Source,
    _: bun_ast::Range,
    _: bun_ast::Expr,
    _: &[u8],
) -> Result<bun_ast::Expr, bun_js_parser::Error> {
    unreachable!("macro call in bench")
}
#[unsafe(no_mangle)]
extern "Rust" fn __bun_macro_context_get_remap(
    _: *mut c_void,
    _: &[u8],
) -> Option<&'static bun_js_parser::Macro::MacroRemapEntry> {
    None
}
