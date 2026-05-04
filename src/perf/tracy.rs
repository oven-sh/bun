//! https://github.com/wolfpld/tracy
//! To use this module, you must have Tracy installed on your system.
//! On macOS, you can install it with `brew install tracy`.
//!
//! This file is based on the code from Zig's transpiler source.
//! Thank you to the Zig team

use core::ffi::{c_char, c_int, c_void};
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};

use bun_core::env_var;
use bun_sys as sys;

pub const ENABLE_ALLOCATION: bool = false;
pub const ENABLE_CALLSTACK: bool = false;

// PORT NOTE: Zig `pub var enable = false;` — use AtomicBool so reads are safe
// from any thread without `unsafe`. All loads/stores are Relaxed (matches Zig's
// unsynchronized plain global).
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
#[derive(Clone, Copy)]
pub struct ___tracy_c_zone_context {
    pub id: u32,
    pub active: c_int,
}

impl Default for ___tracy_c_zone_context {
    fn default() -> Self {
        Self { id: 0, active: 0 }
    }
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

/// Mirror of `std.builtin.SourceLocation` for the fields Tracy needs.
/// Construct via a macro at the call site (see TODO below).
// TODO(port): callers pass `@src()` in Zig; in Rust this must be a macro that
// expands to a per-callsite `static SRCLOC: ___tracy_source_location_data`.
// `core::panic::Location` lacks `fn_name`, so a wrapper macro is required.
#[derive(Clone, Copy)]
pub struct SourceLocation {
    pub fn_name: &'static core::ffi::CStr,
    pub file: &'static core::ffi::CStr,
    pub line: u32,
}

#[inline]
pub fn trace(srcloc: &'static ___tracy_source_location_data) -> Ctx {
    // TODO(port): Zig signature is `trace(comptime src: SourceLocation)` and
    // synthesizes a per-monomorphization `static holder.srcloc`. Rust cannot
    // create a fresh static per generic-value instantiation without a macro,
    // so this fn takes the already-built static directly. Phase B: provide
    // `tracy_trace!()` macro that declares the static and calls this.
    if !enable() {
        return Ctx::default();
    }

    if ENABLE_CALLSTACK {
        ___tracy_emit_zone_begin_callstack(srcloc, CALLSTACK_DEPTH, 1)
    } else {
        ___tracy_emit_zone_begin(srcloc, 1)
    }
}

#[inline]
pub fn trace_named(srcloc: &'static ___tracy_source_location_data) -> Ctx {
    // TODO(port): Zig `traceNamed(comptime src, comptime name)` — same
    // per-callsite-static issue as `trace`. The `name` is folded into the
    // caller-provided static `srcloc.name`. Phase B macro:
    // `tracy_trace_named!("name")`.
    if !enable() {
        return Ctx::default();
    }

    if ENABLE_CALLSTACK {
        ___tracy_emit_zone_begin_callstack(srcloc, CALLSTACK_DEPTH, 1)
    } else {
        ___tracy_emit_zone_begin(srcloc, 1)
    }
}

pub fn tracy_allocator() -> TracyAllocator {
    TracyAllocator::init(None)
}

/// Zig: `fn TracyAllocator(comptime name: ?[:0]const u8) type { return struct { ... } }`
///
/// In Zig this is a `std.mem.Allocator` vtable wrapper around a parent allocator.
/// Per PORTING.md §Allocators, `src/perf/` is not an AST crate, so the
/// `std.mem.Allocator` parameter is deleted and the parent is implicitly the
/// global mimalloc (`#[global_allocator]`).
// TODO(port): re-express as a `core::alloc::GlobalAlloc` shim over
// `bun_alloc::Mimalloc` that emits tracy alloc/free hooks (alloc/alloc_named/
// free/free_named below). Only relevant if `ENABLE_ALLOCATION` is flipped on —
// it is `false` today, so this is dead in practice. Phase B.
// PERF(port): Zig monomorphized on `comptime name`; Rust stores it as a field
// because `Option<&'static CStr>` is not a valid const-generic param on stable.
pub struct TracyAllocator {
    name: Option<&'static core::ffi::CStr>,
}

impl TracyAllocator {
    pub fn init(name: Option<&'static core::ffi::CStr>) -> Self {
        Self { name }
    }

    // PORT NOTE: Zig `allocFn`/`resizeFn`/`freeFn` built a `std.mem.Allocator`
    // vtable. That concept does not exist in the Rust port (global mimalloc via
    // `#[global_allocator]`); the tracy emit hooks they called are preserved
    // below as `alloc`/`alloc_named`/`free`/`free_named` for the Phase-B
    // `GlobalAlloc` shim to use.
}

/// This function only accepts comptime-known strings, see `message_copy` for runtime strings
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

/// This function only accepts comptime-known strings, see `message_color_copy` for runtime strings
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
pub fn message_color_copy(msg: &bun_str::ZStr, color: u32) {
    if !enable() {
        return;
    }
    ___tracy_emit_message_c(
        msg.as_ptr(),
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

/// Zig: `fn Frame(comptime name: [:0]const u8) type`
// PERF(port): was comptime monomorphization (zero-sized struct per name) —
// store name as a field instead. Profile in Phase B.
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

#[inline]
fn alloc(ptr: *mut u8, len: usize) {
    if !enable() {
        return;
    }

    if ENABLE_CALLSTACK {
        ___tracy_emit_memory_alloc_callstack(ptr.cast(), len, CALLSTACK_DEPTH, 0);
    } else {
        ___tracy_emit_memory_alloc(ptr.cast(), len, 0);
    }
}

#[inline]
fn alloc_named(ptr: *mut u8, len: usize, name: &'static core::ffi::CStr) {
    if !enable() {
        return;
    }

    if ENABLE_CALLSTACK {
        ___tracy_emit_memory_alloc_callstack_named(ptr.cast(), len, CALLSTACK_DEPTH, 0, name.as_ptr());
    } else {
        ___tracy_emit_memory_alloc_named(ptr.cast(), len, 0, name.as_ptr());
    }
}

#[inline]
fn free(ptr: *mut u8) {
    if !enable() {
        return;
    }

    if ENABLE_CALLSTACK {
        ___tracy_emit_memory_free_callstack(ptr.cast(), CALLSTACK_DEPTH, 0);
    } else {
        ___tracy_emit_memory_free(ptr.cast(), 0);
    }
}

#[inline]
fn free_named(ptr: *mut u8, name: &'static core::ffi::CStr) {
    if !enable() {
        return;
    }

    if ENABLE_CALLSTACK {
        ___tracy_emit_memory_free_callstack_named(ptr.cast(), CALLSTACK_DEPTH, 0, name.as_ptr());
    } else {
        ___tracy_emit_memory_free_named(ptr.cast(), 0, name.as_ptr());
    }
}

/// Function-pointer type aliases for dynamically-loaded Tracy C API.
#[allow(non_camel_case_types)]
mod tracy_fns {
    use super::*;

    pub type emit_frame_mark_start = unsafe extern "C" fn(name: *const c_char);
    pub type emit_frame_mark_end = unsafe extern "C" fn(name: *const c_char);
    pub type emit_zone_begin = unsafe extern "C" fn(
        srcloc: *const ___tracy_source_location_data,
        active: c_int,
    ) -> ___tracy_c_zone_context;
    pub type emit_zone_begin_callstack = unsafe extern "C" fn(
        srcloc: *const ___tracy_source_location_data,
        depth: c_int,
        active: c_int,
    ) -> ___tracy_c_zone_context;
    pub type emit_zone_text =
        unsafe extern "C" fn(ctx: ___tracy_c_zone_context, txt: *const u8, size: usize);
    pub type emit_zone_name =
        unsafe extern "C" fn(ctx: ___tracy_c_zone_context, txt: *const u8, size: usize);
    pub type emit_zone_color = unsafe extern "C" fn(ctx: ___tracy_c_zone_context, color: u32);
    pub type emit_zone_value = unsafe extern "C" fn(ctx: ___tracy_c_zone_context, value: u64);
    pub type emit_zone_end = unsafe extern "C" fn(ctx: ___tracy_c_zone_context);
    pub type emit_memory_alloc =
        unsafe extern "C" fn(ptr: *const c_void, size: usize, secure: c_int);
    pub type emit_memory_alloc_callstack =
        unsafe extern "C" fn(ptr: *const c_void, size: usize, depth: c_int, secure: c_int);
    pub type emit_memory_free = unsafe extern "C" fn(ptr: *const c_void, secure: c_int);
    pub type emit_memory_free_callstack =
        unsafe extern "C" fn(ptr: *const c_void, depth: c_int, secure: c_int);
    pub type emit_memory_alloc_named =
        unsafe extern "C" fn(ptr: *const c_void, size: usize, secure: c_int, name: *const c_char);
    pub type emit_memory_alloc_callstack_named = unsafe extern "C" fn(
        ptr: *const c_void,
        size: usize,
        depth: c_int,
        secure: c_int,
        name: *const c_char,
    );
    pub type emit_memory_free_named =
        unsafe extern "C" fn(ptr: *const c_void, secure: c_int, name: *const c_char);
    pub type emit_memory_free_callstack_named =
        unsafe extern "C" fn(ptr: *const c_void, depth: c_int, secure: c_int, name: *const c_char);
    pub type emit_message = unsafe extern "C" fn(txt: *const u8, size: usize, callstack: c_int);
    pub type emit_message_l = unsafe extern "C" fn(txt: *const c_char, callstack: c_int);
    pub type emit_message_c =
        unsafe extern "C" fn(txt: *const u8, size: usize, color: u32, callstack: c_int);
    pub type emit_message_lc =
        unsafe extern "C" fn(txt: *const c_char, color: u32, callstack: c_int);
    pub type emit_frame_mark = unsafe extern "C" fn(name: *const c_char);
    pub type connected = unsafe extern "C" fn() -> c_int;
    pub type set_thread_name = unsafe extern "C" fn(name: *const c_char);
    pub type startup_profiler = unsafe extern "C" fn();
    pub type shutdown_profiler = unsafe extern "C" fn();
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
    let f = dlsym::<tracy_fns::connected>(c"___tracy_connected").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f() }
}

#[allow(non_snake_case)]
fn ___tracy_set_thread_name(name: *const c_char) {
    let f = dlsym::<tracy_fns::set_thread_name>(c"___tracy_set_thread_name").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(name) }
}

#[allow(non_snake_case)]
fn ___tracy_emit_frame_mark_start(name: *const c_char) {
    let f = dlsym::<tracy_fns::emit_frame_mark_start>(c"___tracy_emit_frame_mark_start").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(name) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_frame_mark_end(name: *const c_char) {
    let f = dlsym::<tracy_fns::emit_frame_mark_end>(c"___tracy_emit_frame_mark_end").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(name) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_begin(
    srcloc: *const ___tracy_source_location_data,
    active: c_int,
) -> ___tracy_c_zone_context {
    let f = dlsym::<tracy_fns::emit_zone_begin>(c"___tracy_emit_zone_begin").unwrap();
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
        .unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(srcloc, depth, active) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_text(ctx: ___tracy_c_zone_context, txt: *const u8, size: usize) {
    let f = dlsym::<tracy_fns::emit_zone_text>(c"___tracy_emit_zone_text").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx, txt, size) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_name(ctx: ___tracy_c_zone_context, txt: *const u8, size: usize) {
    let f = dlsym::<tracy_fns::emit_zone_name>(c"___tracy_emit_zone_name").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx, txt, size) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_color(ctx: ___tracy_c_zone_context, color: u32) {
    let f = dlsym::<tracy_fns::emit_zone_color>(c"___tracy_emit_zone_color").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx, color) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_value(ctx: ___tracy_c_zone_context, value: u64) {
    let f = dlsym::<tracy_fns::emit_zone_value>(c"___tracy_emit_zone_value").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx, value) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_zone_end(ctx: ___tracy_c_zone_context) {
    let f = dlsym::<tracy_fns::emit_zone_end>(c"___tracy_emit_zone_end").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ctx) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_memory_alloc(ptr: *const c_void, size: usize, secure: c_int) {
    let f = dlsym::<tracy_fns::emit_memory_alloc>(c"___tracy_emit_memory_alloc").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ptr, size, secure) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_memory_alloc_callstack(
    ptr: *const c_void,
    size: usize,
    depth: c_int,
    secure: c_int,
) {
    let f = dlsym::<tracy_fns::emit_memory_alloc_callstack>(c"___tracy_emit_memory_alloc_callstack")
        .unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ptr, size, depth, secure) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_memory_free(ptr: *const c_void, secure: c_int) {
    let f = dlsym::<tracy_fns::emit_memory_free>(c"___tracy_emit_memory_free").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ptr, secure) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_memory_free_callstack(ptr: *const c_void, depth: c_int, secure: c_int) {
    let f = dlsym::<tracy_fns::emit_memory_free_callstack>(c"___tracy_emit_memory_free_callstack")
        .unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ptr, depth, secure) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_memory_alloc_named(
    ptr: *const c_void,
    size: usize,
    secure: c_int,
    name: *const c_char,
) {
    let f =
        dlsym::<tracy_fns::emit_memory_alloc_named>(c"___tracy_emit_memory_alloc_named").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ptr, size, secure, name) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_memory_alloc_callstack_named(
    ptr: *const c_void,
    size: usize,
    depth: c_int,
    secure: c_int,
    name: *const c_char,
) {
    let f = dlsym::<tracy_fns::emit_memory_alloc_callstack_named>(
        c"___tracy_emit_memory_alloc_callstack_named",
    )
    .unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ptr, size, depth, secure, name) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_memory_free_named(ptr: *const c_void, secure: c_int, name: *const c_char) {
    let f = dlsym::<tracy_fns::emit_memory_free_named>(c"___tracy_emit_memory_free_named").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ptr, secure, name) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_memory_free_callstack_named(
    ptr: *const c_void,
    depth: c_int,
    secure: c_int,
    name: *const c_char,
) {
    let f = dlsym::<tracy_fns::emit_memory_free_callstack_named>(
        c"___tracy_emit_memory_free_callstack_named",
    )
    .unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(ptr, depth, secure, name) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_message(txt: *const u8, size: usize, callstack: c_int) {
    let f = dlsym::<tracy_fns::emit_message>(c"___tracy_emit_message").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(txt, size, callstack) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_message_l(txt: *const c_char, callstack: c_int) {
    let f = dlsym::<tracy_fns::emit_message_l>(c"___tracy_emit_messageL").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(txt, callstack) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_message_c(txt: *const u8, size: usize, color: u32, callstack: c_int) {
    let f = dlsym::<tracy_fns::emit_message_c>(c"___tracy_emit_messageC").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(txt, size, color, callstack) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_message_lc(txt: *const c_char, color: u32, callstack: c_int) {
    let f = dlsym::<tracy_fns::emit_message_lc>(c"___tracy_emit_messageLC").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(txt, color, callstack) }
}
#[allow(non_snake_case)]
fn ___tracy_emit_frame_mark(name: *const c_char) {
    let f = dlsym::<tracy_fns::emit_frame_mark>(c"___tracy_emit_frame_mark").unwrap();
    // SAFETY: symbol resolved from libtracy with matching signature
    unsafe { f(name) }
}

pub fn init() -> bool {
    #[cfg(target_family = "wasm")]
    {
        // TODO(port): bun.Environment.isNative — assuming "native" == not-wasm
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

    let f = dlsym::<tracy_fns::connected>(c"___tracy_connected").unwrap();
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

    let f = dlsym::<tracy_fns::set_thread_name>(c"___tracy_set_thread_name").unwrap();
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

// PORT NOTE: Zig defined `Handle` as a per-instantiation local struct inside
// `dlsym`, giving each (Type, symbol) pair its own static handle. That is
// wasteful (re-dlopens libtracy per symbol) and not expressible in Rust without
// const-generic strings. Use a single shared handle instead — dlopen on the
// same path is refcounted so behavior is equivalent.
static HANDLE: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());

fn handle_getter() -> Option<*mut c_void> {
    let h = HANDLE.load(Ordering::Acquire);
    if h.is_null() {
        None
    } else {
        Some(h)
    }
}

fn dlsym<T: Copy>(symbol: &'static core::ffi::CStr) -> Option<T> {
    #[cfg(target_family = "wasm")]
    {
        return None;
    }

    #[cfg(target_os = "linux")]
    {
        // use LD_PRELOAD on linux
        if let Some(val) = sys::c::dlsym::<T>(symbol) {
            return Some(val);
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
            #[cfg(target_os = "linux")]
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
            #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
            const PATHS_TO_TRY: &[&core::ffi::CStr] = &[];

            // TODO(port): RTLD flags — Zig used `@bitCast(@as(i32, -2))` on
            // macOS (RTLD_DEFAULT semantics for dlopen?) and default `.{}` on
            // Linux. Map to bun_sys::dlopen flag type once defined.
            #[cfg(target_os = "macos")]
            let rtld: c_int = -2;
            #[cfg(not(target_os = "macos"))]
            let rtld: c_int = 0;

            if let Some(path) = env_var::BUN_TRACY_PATH.get() {
                // TODO(port): std.posix.toPosixPath — copy into a NUL-terminated
                // PathBuffer. Phase B: use bun_paths helper.
                let mut buf = bun_paths::PathBuffer::uninit();
                let zpath = bun_paths::z(path, &mut buf);
                let handle = sys::dlopen(zpath, rtld);
                if !handle.is_null() {
                    HANDLE.store(handle, Ordering::Release);
                    break 'get;
                }
            }
            for path in PATHS_TO_TRY {
                let handle = sys::dlopen(*path, rtld);
                if !handle.is_null() {
                    HANDLE.store(handle, Ordering::Release);
                    break;
                }
            }

            if HANDLE.load(Ordering::Acquire).is_null() {
                return None;
            }
        }
    }

    sys::c::dlsym_with_handle::<T>(symbol, handle_getter)
}

// TODO(port): Zig pulls this from `@import("build_options").tracy_callstack_depth`.
// Phase B: wire to build-time config (env! / cfg-set const).
const CALLSTACK_DEPTH: c_int = 10;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/perf/tracy.zig (558 lines)
//   confidence: medium
//   todos:      8
//   notes:      trace/trace_named need callsite macros for per-static srcloc; TracyAllocator stubbed (std.mem.Allocator vtable → GlobalAlloc shim in Phase B, ENABLE_ALLOCATION=false); dlsym handle hoisted to module static
// ──────────────────────────────────────────────────────────────────────────
