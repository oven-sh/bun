//! https://github.com/wolfpld/tracy
//! To use this module, you must have Tracy installed on your system.
//! On macOS, you can install it with `brew install tracy`.

use core::ffi::{c_char, c_int, c_void};
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};

use bun_core::env_var;

pub const ENABLE_ALLOCATION: bool = false;
pub const ENABLE_CALLSTACK: bool = false;

// An AtomicBool keeps reads safe from any thread without `unsafe`. All
// loads/stores are Relaxed.
static ENABLE: AtomicBool = AtomicBool::new(false);

#[inline(always)]
pub fn enable() -> bool {
    ENABLE.load(Ordering::Relaxed)
}
#[inline(always)]
pub fn set_enable(v: bool) {
    ENABLE.store(v, Ordering::Relaxed);
}

#[allow(non_camel_case_types)]
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct ___tracy_c_zone_context {
    pub id: u32,
    pub active: c_int,
}

impl ___tracy_c_zone_context {
    #[inline]
    pub fn end(self) {
        if !enable() {
            return;
        }
        ___tracy_emit_zone_end(self);
    }

    #[inline]
    pub fn add_text(self, text: &[u8]) {
        if !enable() {
            return;
        }
        ___tracy_emit_zone_text(self, text.as_ptr(), text.len());
    }

    #[inline]
    pub fn set_name(self, name: &[u8]) {
        if !enable() {
            return;
        }
        ___tracy_emit_zone_name(self, name.as_ptr(), name.len());
    }

    #[inline]
    pub fn set_color(self, color: u32) {
        if !enable() {
            return;
        }
        ___tracy_emit_zone_color(self, color);
    }

    #[inline]
    pub fn set_value(self, value: u64) {
        if !enable() {
            return;
        }
        ___tracy_emit_zone_value(self, value);
    }
}

pub type Ctx = ___tracy_c_zone_context;

/// Begin a Tracy zone. The
/// per-callsite static source location is emitted by the `tracy_trace!`
/// macro, which calls this with the already-built static.
#[inline]
pub fn trace(srcloc: &'static ___tracy_source_location_data) -> Ctx {
    if !enable() {
        return Ctx::default();
    }

    if ENABLE_CALLSTACK {
        ___tracy_emit_zone_begin_callstack(srcloc, CALLSTACK_DEPTH, 1)
    } else {
        ___tracy_emit_zone_begin(srcloc, 1)
    }
}

/// Begin a named Tracy zone. The
/// per-callsite static (with `name` set) is emitted by the
/// `tracy_trace_named!` macro, which calls this with the already-built
/// static.
#[inline]
pub fn trace_named(srcloc: &'static ___tracy_source_location_data) -> Ctx {
    if !enable() {
        return Ctx::default();
    }

    if ENABLE_CALLSTACK {
        ___tracy_emit_zone_begin_callstack(srcloc, CALLSTACK_DEPTH, 1)
    } else {
        ___tracy_emit_zone_begin(srcloc, 1)
    }
}

/// Begin a Tracy zone with a per-callsite static source location.
/// Expands to a fresh `static SRCLOC` per
/// callsite (no intermediate `SourceLocation` struct) and calls
/// `tracy::trace`.
#[macro_export]
macro_rules! tracy_trace {
    () => {{
        static SRCLOC: $crate::tracy::___tracy_source_location_data =
            $crate::tracy::___tracy_source_location_data {
                name: ::core::ptr::null(),
                function: concat!(module_path!(), "\0")
                    .as_ptr()
                    .cast::<::core::ffi::c_char>(),
                file: concat!(file!(), "\0")
                    .as_ptr()
                    .cast::<::core::ffi::c_char>(),
                line: line!(),
                color: 0,
            };
        $crate::tracy::trace(&SRCLOC)
    }};
}

/// Begin a named Tracy zone with a per-callsite static source location.
/// The name must be a
/// string literal; it is NUL-terminated and stored in the per-callsite
/// static, then passed to `tracy::trace_named`.
#[macro_export]
macro_rules! tracy_trace_named {
    ($name:literal) => {{
        static SRCLOC: $crate::tracy::___tracy_source_location_data =
            $crate::tracy::___tracy_source_location_data {
                name: concat!($name, "\0").as_ptr().cast::<::core::ffi::c_char>(),
                function: concat!(module_path!(), "\0")
                    .as_ptr()
                    .cast::<::core::ffi::c_char>(),
                file: concat!(file!(), "\0")
                    .as_ptr()
                    .cast::<::core::ffi::c_char>(),
                line: line!(),
                color: 0,
            };
        $crate::tracy::trace_named(&SRCLOC)
    }};
}

pub fn tracy_allocator() -> TracyAllocator {
    TracyAllocator::init()
}

/// no allocator parameter; the parent is implicitly the
/// global mimalloc (`#[global_allocator]`).
// The tracy alloc/free hooks (`___tracy_emit_memory_alloc` etc.) are not
// wired up: `ENABLE_ALLOCATION` is `false`,
// so allocation tracking is intentionally dead.
// If it is ever flipped on, express it as a `core::alloc::GlobalAlloc` shim
// over the global mimalloc that emits the tracy hooks.
pub struct TracyAllocator {}

impl TracyAllocator {
    pub fn init() -> Self {
        Self {}
    }
}

/// This function only accepts `'static` strings, see `message_copy` for runtime strings
#[inline]
pub fn message(msg: &'static core::ffi::CStr) {
    if !enable() {
        return;
    }
    ___tracy_emit_message_l(
        msg.as_ptr(),
        if ENABLE_CALLSTACK { CALLSTACK_DEPTH } else { 0 },
    );
}

/// This function only accepts `'static` strings, see `message_color_copy` for runtime strings
#[inline]
pub fn message_color(msg: &'static core::ffi::CStr, color: u32) {
    if !enable() {
        return;
    }
    ___tracy_emit_message_lc(
        msg.as_ptr(),
        color,
        if ENABLE_CALLSTACK { CALLSTACK_DEPTH } else { 0 },
    );
}

#[inline]
pub fn message_copy(msg: &[u8]) {
    if !enable() {
        return;
    }
    ___tracy_emit_message(
        msg.as_ptr(),
        msg.len(),
        if ENABLE_CALLSTACK { CALLSTACK_DEPTH } else { 0 },
    );
}

#[inline]
pub fn message_color_copy(msg: &bun_core::ZStr, color: u32) {
    if !enable() {
        return;
    }
    ___tracy_emit_message_c(
        msg.as_bytes().as_ptr(),
        msg.as_bytes().len(),
        color,
        if ENABLE_CALLSTACK { CALLSTACK_DEPTH } else { 0 },
    );
}

#[inline]
pub fn frame_mark() {
    if !enable() {
        return;
    }
    ___tracy_emit_frame_mark(ptr::null());
}

#[inline]
pub fn frame_mark_named(name: &'static core::ffi::CStr) {
    if !enable() {
        return;
    }
    ___tracy_emit_frame_mark(name.as_ptr());
}

#[inline]
pub fn named_frame(name: &'static core::ffi::CStr) -> Frame {
    frame_mark_start(name);
    Frame { name }
}

/// Tracy frame span; `name` is stored as a field (one struct serves all
/// names).
pub struct Frame {
    name: &'static core::ffi::CStr,
}

impl Frame {
    pub fn end(self) {
        frame_mark_end(self.name);
    }
}

#[inline]
fn frame_mark_start(name: &'static core::ffi::CStr) {
    if !enable() {
        return;
    }
    ___tracy_emit_frame_mark_start(name.as_ptr());
}

#[inline]
fn frame_mark_end(name: &'static core::ffi::CStr) {
    if !enable() {
        return;
    }
    ___tracy_emit_frame_mark_end(name.as_ptr());
}

/// Function-pointer type aliases for dynamically-loaded Tracy C API.
#[allow(non_camel_case_types)]
mod tracy_fns {
    use super::*;

    pub(super) type emit_frame_mark_start = unsafe extern "C" fn(name: *const c_char);
    pub(super) type emit_frame_mark_end = unsafe extern "C" fn(name: *const c_char);
    pub(super) type emit_zone_begin = unsafe extern "C" fn(
        srcloc: *const ___tracy_source_location_data,
        active: c_int,
    ) -> ___tracy_c_zone_context;
    pub(super) type emit_zone_begin_callstack = unsafe extern "C" fn(
        srcloc: *const ___tracy_source_location_data,
        depth: c_int,
        active: c_int,
    )
        -> ___tracy_c_zone_context;
    pub(super) type emit_zone_text =
        unsafe extern "C" fn(ctx: ___tracy_c_zone_context, txt: *const u8, size: usize);
    pub(super) type emit_zone_name =
        unsafe extern "C" fn(ctx: ___tracy_c_zone_context, txt: *const u8, size: usize);
    pub(super) type emit_zone_color =
        unsafe extern "C" fn(ctx: ___tracy_c_zone_context, color: u32);
    pub(super) type emit_zone_value =
        unsafe extern "C" fn(ctx: ___tracy_c_zone_context, value: u64);
    pub(super) type emit_zone_end = unsafe extern "C" fn(ctx: ___tracy_c_zone_context);
    pub(super) type emit_message =
        unsafe extern "C" fn(txt: *const u8, size: usize, callstack: c_int);
    pub(super) type emit_message_l = unsafe extern "C" fn(txt: *const c_char, callstack: c_int);
    pub(super) type emit_message_c =
        unsafe extern "C" fn(txt: *const u8, size: usize, color: u32, callstack: c_int);
    pub(super) type emit_message_lc =
        unsafe extern "C" fn(txt: *const c_char, color: u32, callstack: c_int);
    pub(super) type emit_frame_mark = unsafe extern "C" fn(name: *const c_char);
    pub(super) type connected = unsafe extern "C" fn() -> c_int;
    pub(super) type set_thread_name = unsafe extern "C" fn(name: *const c_char);
    pub(super) type startup_profiler = unsafe extern "C" fn();
    pub(super) type shutdown_profiler = unsafe extern "C" fn();
}

#[allow(non_snake_case)]
fn ___tracy_startup_profiler() {
    // these might not exist
    let Some(f) = dlsym::<tracy_fns::startup_profiler>(c"___tracy_startup_profiler") else {
        return;
    };
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f() };
}

#[allow(non_snake_case)]
fn ___tracy_shutdown_profiler() {
    // these might not exist
    let Some(f) = dlsym::<tracy_fns::shutdown_profiler>(c"___tracy_shutdown_profiler") else {
        return;
    };
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f() };
}

static HAS_STARTED: AtomicBool = AtomicBool::new(false);

pub fn has_started() -> bool {
    HAS_STARTED.load(Ordering::Relaxed)
}

pub fn start() {
    if !enable() || HAS_STARTED.load(Ordering::Relaxed) {
        return;
    }
    ___tracy_startup_profiler();
}

pub fn stop() {
    if !enable() || !HAS_STARTED.load(Ordering::Relaxed) {
        return;
    }
    ___tracy_shutdown_profiler();
}

#[allow(non_snake_case)]
fn ___tracy_connected() -> c_int {
    let f = dlsym::<tracy_fns::connected>(c"___tracy_connected").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f() }
}

#[allow(non_snake_case)]
fn ___tracy_set_thread_name(name: *const c_char) {
    let f = dlsym::<tracy_fns::set_thread_name>(c"___tracy_set_thread_name").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(name) }
}

#[allow(non_snake_case)]
fn ___tracy_emit_frame_mark_start(name: *const c_char) {
    let f = dlsym::<tracy_fns::emit_frame_mark_start>(c"___tracy_emit_frame_mark_start")
        .expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(name) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_frame_mark_end(name: *const c_char) {
    let f = dlsym::<tracy_fns::emit_frame_mark_end>(c"___tracy_emit_frame_mark_end")
        .expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(name) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_begin(
    srcloc: *const ___tracy_source_location_data,
    active: c_int,
) -> ___tracy_c_zone_context {
    let f = dlsym::<tracy_fns::emit_zone_begin>(c"___tracy_emit_zone_begin").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(srcloc, active) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_begin_callstack(
    srcloc: *const ___tracy_source_location_data,
    depth: c_int,
    active: c_int,
) -> ___tracy_c_zone_context {
    let f = dlsym::<tracy_fns::emit_zone_begin_callstack>(c"___tracy_emit_zone_begin_callstack")
        .expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(srcloc, depth, active) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_text(ctx: ___tracy_c_zone_context, txt: *const u8, size: usize) {
    let f = dlsym::<tracy_fns::emit_zone_text>(c"___tracy_emit_zone_text").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx, txt, size) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_name(ctx: ___tracy_c_zone_context, txt: *const u8, size: usize) {
    let f = dlsym::<tracy_fns::emit_zone_name>(c"___tracy_emit_zone_name").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx, txt, size) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_color(ctx: ___tracy_c_zone_context, color: u32) {
    let f = dlsym::<tracy_fns::emit_zone_color>(c"___tracy_emit_zone_color").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx, color) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_value(ctx: ___tracy_c_zone_context, value: u64) {
    let f = dlsym::<tracy_fns::emit_zone_value>(c"___tracy_emit_zone_value").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx, value) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_end(ctx: ___tracy_c_zone_context) {
    let f = dlsym::<tracy_fns::emit_zone_end>(c"___tracy_emit_zone_end").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_message(txt: *const u8, size: usize, callstack: c_int) {
    let f = dlsym::<tracy_fns::emit_message>(c"___tracy_emit_message").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(txt, size, callstack) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_message_l(txt: *const c_char, callstack: c_int) {
    let f = dlsym::<tracy_fns::emit_message_l>(c"___tracy_emit_messageL").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(txt, callstack) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_message_c(txt: *const u8, size: usize, color: u32, callstack: c_int) {
    let f = dlsym::<tracy_fns::emit_message_c>(c"___tracy_emit_messageC").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(txt, size, color, callstack) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_message_lc(txt: *const c_char, color: u32, callstack: c_int) {
    let f = dlsym::<tracy_fns::emit_message_lc>(c"___tracy_emit_messageLC").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(txt, color, callstack) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_frame_mark(name: *const c_char) {
    let f = dlsym::<tracy_fns::emit_frame_mark>(c"___tracy_emit_frame_mark").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(name) }
}

pub fn init() -> bool {
    #[cfg(target_family = "wasm")]
    {
        return false;
    }

    if enable() {
        return true;
    }

    if dlsym::<tracy_fns::emit_message>(c"___tracy_emit_message").is_none() {
        return false;
    }
    set_enable(true);
    true
}

pub fn is_connected() -> bool {
    #[cfg(target_family = "wasm")]
    {
        return false;
    }

    if !enable() {
        return false;
    }

    let f = dlsym::<tracy_fns::connected>(c"___tracy_connected").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f() != 0 }
}

pub fn init_thread(name: &'static core::ffi::CStr) {
    #[cfg(target_family = "wasm")]
    {
        return;
    }

    if !enable() {
        return;
    }

    let f = dlsym::<tracy_fns::set_thread_name>(c"___tracy_set_thread_name").expect("tracy symbol");
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(name.as_ptr()) }
}

#[allow(non_camel_case_types)]
#[repr(C)]
pub struct ___tracy_source_location_data {
    pub name: *const c_char,
    pub function: *const c_char,
    pub file: *const c_char,
    pub line: u32,
    pub color: u32,
}

// SAFETY: Tracy requires srcloc data to have 'static lifetime; all pointer
// fields are populated from string literals (`&'static CStr`) so sending the
// struct across threads is sound.
unsafe impl Sync for ___tracy_source_location_data {}

impl Default for ___tracy_source_location_data {
    fn default() -> Self {
        Self {
            name: ptr::null(),
            function: c"".as_ptr(),
            file: c"".as_ptr(),
            line: 0,
            color: 0,
        }
    }
}

// A single shared handle serves all symbols (a per-(Type, symbol) handle
// would wastefully re-dlopen libtracy per symbol; dlopen on the same path is
// refcounted anyway).
static HANDLE: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());

fn handle_getter() -> Option<*mut c_void> {
    let h = HANDLE.load(Ordering::Acquire);
    if h.is_null() { None } else { Some(h) }
}

/// `&'static CStr` → `&'static ZStr` (both are NUL-terminated, len excludes NUL).
#[inline(always)]
fn cstr_as_zstr(s: &'static core::ffi::CStr) -> &'static bun_core::ZStr {
    bun_core::ZStr::from_cstr(s)
}

fn dlsym<T: Copy>(symbol: &'static core::ffi::CStr) -> Option<T> {
    #[cfg(target_family = "wasm")]
    {
        let _ = symbol;
        return None;
    }

    #[cfg(not(target_family = "wasm"))]
    {
        debug_assert_eq!(
            core::mem::size_of::<T>(),
            core::mem::size_of::<*mut c_void>()
        );

        let sym_z = cstr_as_zstr(symbol);

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // use LD_PRELOAD on linux (RTLD_DEFAULT lookup)
            if let Some(p) = bun_sys::dlsym_impl(None, sym_z) {
                // SAFETY: caller asserts `T` is fn-pointer-shaped matching the symbol's ABI.
                return Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&p) });
            }
        }

        'get: {
            if HANDLE.load(Ordering::Acquire).is_null() {
                #[cfg(target_os = "macos")]
                const PATHS_TO_TRY: &[&core::ffi::CStr] = &[
                    c"/usr/local/opt/tracy/lib/libtracy.dylib",
                    c"/usr/local/lib/libtracy.dylib",
                    c"/opt/homebrew/lib/libtracy.so",
                    c"/opt/homebrew/lib/libtracy.dylib",
                    c"/usr/lib/libtracy.dylib",
                    c"libtracy.dylib",
                    c"libtracy.so",
                    c"libTracyClient.dylib",
                    c"libTracyClient.so",
                ];
                #[cfg(any(target_os = "linux", target_os = "android"))]
                const PATHS_TO_TRY: &[&core::ffi::CStr] = &[
                    c"/usr/local/lib/libtracy.so",
                    c"/usr/local/opt/tracy/lib/libtracy.so",
                    c"/opt/tracy/lib/libtracy.so",
                    c"/usr/lib/libtracy.so",
                    c"/usr/local/lib/libTracyClient.so",
                    c"/usr/local/opt/tracy/lib/libTracyClient.so",
                    c"/opt/tracy/lib/libTracyClient.so",
                    c"/usr/lib/libTracyClient.so",
                    c"libtracy.so",
                    c"libTracyClient.so",
                ];
                #[cfg(windows)]
                const PATHS_TO_TRY: &[&core::ffi::CStr] = &[c"tracy.dll"];
                #[cfg(not(any(
                    target_os = "macos",
                    target_os = "linux",
                    target_os = "android",
                    windows
                )))]
                const PATHS_TO_TRY: &[&core::ffi::CStr] = &[];

                // RTLD flags passed straight through to dlopen as raw values:
                // -2 on macOS, 0 elsewhere.
                #[cfg(target_os = "macos")]
                let rtld: i32 = -2;
                #[cfg(not(target_os = "macos"))]
                let rtld: i32 = 0;

                if let Some(path) = env_var::BUN_TRACY_PATH.get() {
                    // Copy into a NUL-terminated PathBuffer.
                    let mut buf = bun_core::paths::PathBuffer::uninit();
                    let zpath = bun_core::paths::resolve_path::z(path, &mut buf);
                    if let Some(handle) = bun_sys::dlopen(zpath, rtld) {
                        HANDLE.store(handle, Ordering::Release);
                        break 'get;
                    }
                }
                for path in PATHS_TO_TRY {
                    if let Some(handle) = bun_sys::dlopen(cstr_as_zstr(path), rtld) {
                        HANDLE.store(handle, Ordering::Release);
                        break;
                    }
                }

                if HANDLE.load(Ordering::Acquire).is_null() {
                    return None;
                }
            }
        }

        // Uncached lookup through the shared handle. PERF: a per-symbol
        // OnceLock cache is possible — profile if it shows up on a hot path.
        let p = bun_sys::dlsym_impl(handle_getter(), sym_z)?;
        // SAFETY: caller asserts `T` is fn-pointer-shaped matching the symbol's ABI.
        Some(unsafe { core::mem::transmute_copy::<*mut c_void, T>(&p) })
    }
}

// Only consulted when `ENABLE_CALLSTACK` is true.
const CALLSTACK_DEPTH: c_int = 10;

#[cfg(test)]
mod tests {
    // Expand both macros so the per-callsite statics (and their const
    // initializers) are compile-checked even though no runtime caller exists
    // yet. With `enable()` false (the default), `trace`/`trace_named` return
    // `Ctx::default()` and `end()` is a no-op, so this is safe to run.
    #[test]
    fn trace_macros_expand() {
        let ctx = crate::tracy_trace!();
        ctx.end();
        let named = crate::tracy_trace_named!("test");
        named.end();
    }
}
