//! This is the root source file of Bun's Rust crate. It can be imported using
//! `bun_core::*` (or via the `bun` facade crate), and should be able to reach
//! all code via `::` syntax.
//!
//! Prefer adding new code into a separate file and adding an import, or putting
//! code in the relevant namespace.

#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]

use core::ffi::{c_char, c_int, c_void};
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};
use std::cell::Cell;

// ─── crate re-exports (replaces the @import block) ────────────────────────────
pub use bun_core::env as Environment;
pub use bun_core::env_var;
pub use bun_core::env_var::feature_flag;
pub use bun_core::Output;
pub use bun_core::Global;
pub use bun_core::fmt;
pub use bun_core::tty;
pub use bun_core::FeatureFlags;
pub use bun_core::Progress;
pub use bun_core::deprecated;
pub use bun_core::{GenericIndex, GenericIndexOptional, GenericIndexInt};

pub use bun_sys as sys;
/// Deprecated: use bun::sys::S
pub use bun_sys::S;
pub use bun_sys::O;
pub use bun_sys::Mode;
pub use bun_sys::fd::FD;
pub use bun_sys::fd::MovableIfWindowsFd;
pub use bun_sys::SignalCode;
pub use bun_sys::tmp::Tmpfile;
// Platform-specific system APIs.
pub use bun_sys::windows;
pub use bun_platform::darwin;
pub use bun_platform::linux;
/// Translated from `c-headers-for-zig.h` for the current platform.
pub use bun_sys::c; // translated-c-headers

pub use bun_sha_hmac as sha;
pub use bun_sha_hmac::hmac;
pub use bun_meta as meta;
pub use bun_meta::traits as trait_;
pub use bun_meta::bits;
pub use bun_base64 as base64;
pub use bun_paths::resolve_path as path;
pub use bun_paths as paths;
pub use bun_paths::{
    MAX_PATH_BYTES, PathBuffer, PATH_MAX_WIDE, WPathBuffer, OSPathChar, OSPathSliceZ, OSPathSlice,
    OSPathBuffer, Path, AbsPath, AutoAbsPath, RelPath, AutoRelPath, EnvPath, path_buffer_pool,
    w_path_buffer_pool, os_path_buffer_pool,
};
pub use bun_resolver as resolver;
pub use bun_resolver::package_json::PackageJSON;
pub use bun_resolver::fs;
pub use bun_runtime::node::dir_iterator as DirIterator;
pub use bun_runtime::node::util::validators;
pub use bun_runtime::webcore::FormData;
pub use bun_runtime::api::bun::spawn::PosixSpawn as spawn;

pub use bun_glob as glob;
pub use bun_patch as patch;
pub use bun_ini as ini;
pub use bun_css as css;
pub use bun_css::SmallList;
pub use bun_csrf as csrf;
pub use bun_shell as shell;
pub use bun_md as md;
pub use bun_io::ParentDeathWatchdog;
pub use bun_io as Async;
pub use bun_libarchive as libarchive;
pub use bun_watcher::Watcher;
pub use bun_dotenv as DotEnv;
pub use bun_perf::tracy;
pub use bun_perf::tracy::trace;
pub use bun_perf as perf;
pub use bun_perf::hw_timer;
pub use bun_zstd as zstd;
pub use bun_zlib as zlib;
pub use bun_brotli as brotli;
pub use bun_libdeflate_sys as libdeflate;
pub use bun_dns as dns;
pub use bun_io as io;
pub use bun_bake as bake;
pub use bun_semver as Semver;
pub use bun_options_types::import_record::{ImportRecord, ImportKind};
pub use bun_options_types::schema;
pub use bun_sourcemap as SourceMap;
pub use bun_standalone_graph::StandaloneModuleGraph;
pub use bun_which::which;
pub use bun_safety as safety;
pub use bun_safety::asan;
pub use bun_exe_format::{macho, pe, elf};
pub use bun_highway as highway;
pub use bun_simdutf_sys as simdutf;
pub use bun_cares_sys as c_ares;
pub use bun_lolhtml_sys as LOLHTML;
pub use bun_picohttp as picohttp;
pub use bun_uws as uws;
pub use bun_boringssl as BoringSSL;
pub use bun_clap as clap;
pub use bun_analytics as analytics;
pub use bun_url::URL;
pub use bun_wyhash::Wyhash11;

pub use bun_logger as logger;
pub use bun_threading as threading;
pub use bun_threading::{Mutex, Futex, ThreadPool, UnboundedQueue};
pub const default_thread_stack_size: usize = bun_threading::ThreadPool::default_thread_stack_size;

pub use bun_http as http;
pub use bun_http::HTTPThread;

pub use bun_ptr as ptr;
pub use bun_collections::{TaggedPtr as TaggedPointer, TaggedPtrUnion as TaggedPointerUnion};

pub use bun_cli as cli;
pub use bun_runtime::cli::ci_info as ci;
pub use bun_runtime::cli::bunfig::Bunfig;
pub use bun_runtime::cli::run_command::RunCommand;

pub use bun_install as install;
pub use bun_install::PackageManager;
pub use bun_install::ConfigVersion;

pub use bun_bundler::transpiler;
pub use bun_bundler::transpiler::Transpiler;
pub use bun_bundler::options;
pub use bun_bundler::bundle_v2;
pub use bun_bundler::bundle_v2::{Loader, BundleV2, ParseTask};

pub use bun_js_parser as js_parser;
pub use bun_js_parser::lexer as js_lexer;
pub use bun_js_parser as ast;
pub use bun_js_printer as js_printer;
pub use bun_js_printer::renamer;

pub use bun_interchange as interchange;
pub use bun_interchange::json;

pub use bun_crash_handler as crash_handler;
pub use bun_crash_handler::handle_error_return_trace as handleErrorReturnTrace;
pub use bun_crash_handler::handle_oom::handle_oom as handleOom;

pub use bun_jsc::uuid as UUID;
pub use bun_str::ZigString;
// TODO(port): move to *_jsc — `bun_js` re-exports
pub use crate::bun_js::{jsc, webcore, api};
pub mod bun_js {
    pub use bun_jsc as jsc;
    pub use bun_runtime::webcore;
    pub use bun_runtime::api;
}
// TODO(port): move to *_jsc — `valkey_jsc` should not be re-exported from base facade
pub use bun_runtime::valkey_jsc as valkey;
pub use bun_runtime::webcore::s3::client as S3;

/// All functions and interfaces provided from Bun's `bindgen` utility.
// GENERATED: re-run codegen with .rs output
pub use bun_jsc::bindings::generated as gen;

// ─── allocators ───────────────────────────────────────────────────────────────
pub use bun_alloc as allocators;
pub use bun_alloc::memory;
pub use bun_alloc::mimalloc;
pub use bun_alloc::MimallocArena;
pub use bun_alloc::NullableAllocator;
pub use bun_alloc::MaxHeapAllocator;
pub use bun_alloc::heap_breakdown;
pub use bun_alloc::{is_slice_in_buffer as isSliceInBuffer, is_slice_in_buffer_t as isSliceInBufferT};

pub const use_mimalloc: bool = bun_build_options::USE_MIMALLOC;
// `default_allocator` / `z_allocator` / `DefaultAllocator` are erased — global
// mimalloc is the `#[global_allocator]` (see PORTING.md §Allocators).
// TODO(port): debug_allocator_data — Rust uses `#[global_allocator]` + miri/asan
// for leak detection; the Zig DebugAllocator vtable shim is not portable.

// ─── error types ──────────────────────────────────────────────────────────────
pub use bun_alloc::AllocError as OOM;
pub use bun_jsc::JsError as JSError;
/// JavaScript execution has been terminated.
pub use bun_jsc::JsTerminated as JSTerminated;
pub type JSOOM = bun_jsc::JsError; // JsError already has OutOfMemory
pub use bun_jsc::Node::Maybe;

// ─── misc constants ───────────────────────────────────────────────────────────
// callmod_inline / callconv_inline have no Rust equivalent — `#[inline]` is per-fn.
// TODO(port): callmod_inline / callconv_inline — use #[inline(always)] gated on cfg(debug_assertions)

pub use bun_core::{powf, pow};

/// Restrict a value to a certain interval unless it is a float and NaN.
#[inline]
pub fn clamp<T: PartialOrd + Copy>(self_: T, min: T, max: T) -> T {
    debug_assert!(min <= max);
    // TODO(port): comptime float dispatch — Rust uses specialization or separate fn
    // For floats, callers should use `clamp_float` directly.
    if self_ < min { min } else if self_ > max { max } else { self_ }
}

/// Restrict a value to a certain interval unless it is NaN.
///
/// Returns `max` if `self` is greater than `max`, and `min` if `self` is
/// less than `min`. Otherwise this returns `self`.
///
/// Note that this function returns NaN if the initial value was NaN as well.
#[inline]
pub fn clamp_float<F: Copy + PartialOrd>(self_: F, min: F, max: F) -> F {
    let mut s = self_;
    if s < min {
        s = min;
    }
    if s > max {
        s = max;
    }
    s
}

/// Converts a floating-point value to an integer following Rust semantics.
/// Rust's `as` cast already saturates and maps NaN→0, so this is a thin wrapper.
// PORT NOTE: Zig needed this because @intFromFloat is UB on overflow; in Rust
// `value as Int` already implements exactly these semantics.
#[inline]
pub fn int_from_float_f64<Int: FromF64Saturating>(value: f64) -> Int {
    Int::from_f64_saturating(value)
}
#[inline]
pub fn int_from_float_f32<Int: FromF64Saturating>(value: f32) -> Int {
    Int::from_f64_saturating(value as f64)
}
pub trait FromF64Saturating {
    fn from_f64_saturating(v: f64) -> Self;
}
macro_rules! impl_from_f64_sat {
    ($($t:ty),*) => {$(
        impl FromF64Saturating for $t {
            #[inline] fn from_f64_saturating(v: f64) -> Self { v as Self }
        }
    )*};
}
impl_from_f64_sat!(i8, i16, i32, i64, isize, u8, u16, u32, u64, usize);

// typedAllocator / namedAllocator — heap_breakdown is macOS-only profiling.
// In Rust the global pool handles this; callers just use Box/Vec.
// TODO(port): heap_breakdown integration via #[global_allocator] wrapper

// ─── PlatformIOVec ────────────────────────────────────────────────────────────
#[cfg(windows)]
pub type PlatformIOVec = bun_sys::windows::libuv::uv_buf_t;
#[cfg(not(windows))]
pub type PlatformIOVec = bun_sys::iovec;

#[cfg(windows)]
pub type PlatformIOVecConst = bun_sys::windows::libuv::uv_buf_t;
#[cfg(not(windows))]
pub type PlatformIOVecConst = bun_sys::iovec_const;

pub fn platform_iovec_create(input: &[u8]) -> PlatformIOVec {
    // TODO: remove this constCast by making the input mutable
    PlatformIOVec {
        len: input.len() as _,
        base: input.as_ptr().cast_mut(),
    }
}

pub fn platform_iovec_const_create(input: &[u8]) -> PlatformIOVecConst {
    // TODO: remove this constCast by adding uv_buf_t_const
    PlatformIOVecConst {
        len: input.len() as _,
        base: input.as_ptr().cast_mut(),
    }
}

pub fn platform_iovec_to_slice(iovec: &PlatformIOVec) -> &mut [u8] {
    #[cfg(windows)]
    {
        bun_sys::windows::libuv::uv_buf_t::slice(iovec)
    }
    #[cfg(not(windows))]
    unsafe {
        // SAFETY: iovec.base/len describe a valid mutable buffer owned by caller
        core::slice::from_raw_parts_mut(iovec.base, iovec.len as usize)
    }
}

// ─── ThreadlocalBuffers ───────────────────────────────────────────────────────

/// Intrusive list node prepended to every `ThreadlocalBuffers` allocation
/// so `free_all_threadlocal_buffers()` can walk them without knowing each
/// instantiation's `T`.
pub struct ThreadlocalBuffersNode {
    next: Option<NonNull<ThreadlocalBuffersNode>>,
    free: fn(*mut ThreadlocalBuffersNode),
}

thread_local! {
    static THREADLOCAL_BUFFERS_HEAD: Cell<Option<NonNull<ThreadlocalBuffersNode>>> =
        const { Cell::new(None) };
}

/// A lazily heap-allocated per-thread instance of `T`.
///
/// Use this instead of `thread_local! { static X: T }` when `T` is large
/// (`PathBuffer`, fixed arrays, structs of buffers). PE/COFF has no TLS-BSS
/// equivalent, so on Windows every zero-initialized threadlocal is written into
/// bun.exe's `.tls` section as raw zeros — with ~50 `PathBuffer` threadlocals
/// (96 KB each on Windows vs 4 KB on POSIX) that was ~5 MB of the binary and
/// ~5 MB copied into every thread's TLS block at thread creation whether or not
/// it ever touched the resolver. Behind a pointer, the per-thread footprint is
/// 8 bytes on disk and the backing memory is allocated only on first use.
///
/// Allocations are threaded onto a per-thread intrusive list so
/// `delete_all_pools_for_thread_exit()` (called from `WebWorker.shutdown()`)
/// can free them when a Worker thread exits.
pub struct ThreadlocalBuffers<T: Default + 'static> {
    _marker: core::marker::PhantomData<T>,
}

impl<T: Default + 'static> ThreadlocalBuffers<T> {
    // Header + payload allocated together so the type-erased free function can
    // recover the full allocation from the node pointer.
    // TODO(port): Zig used distinct `threadlocal var instance` per monomorphization.
    // Rust can't declare a generic `thread_local!` directly; Phase B should use a
    // macro to stamp out a per-type `thread_local!` static.

    #[inline]
    pub fn get() -> *mut T {
        // TODO(port): per-type thread_local instance pointer — needs macro
        Self::alloc()
    }

    #[cold]
    fn alloc() -> *mut T {
        #[repr(C)]
        struct Storage<T> {
            node: ThreadlocalBuffersNode,
            data: T,
        }
        let s = bun_core::heap::into_raw(Box::new(Storage::<T> {
            node: ThreadlocalBuffersNode {
                next: THREADLOCAL_BUFFERS_HEAD.with(|h| h.get()),
                free: Self::free,
            },
            data: T::default(),
        }));
        // SAFETY: s was just allocated by heap::alloc, non-null
        unsafe {
            THREADLOCAL_BUFFERS_HEAD
                .with(|h| h.set(Some(NonNull::new_unchecked(&mut (*s).node))));
            &mut (*s).data
        }
    }

    fn free(node: *mut ThreadlocalBuffersNode) {
        #[repr(C)]
        struct Storage<T> {
            node: ThreadlocalBuffersNode,
            data: T,
        }
        // SAFETY: node points to Storage.node (offset 0 because #[repr(C)])
        unsafe {
            let s = bun_core::from_field_ptr!(Storage<T>, node, node);
            drop(bun_core::heap::take(s));
        }
        // TODO(port): clear per-type thread_local instance pointer
    }
}

/// Free every `ThreadlocalBuffers` allocation made on the current thread.
/// Called from `delete_all_pools_for_thread_exit()` just before a Worker thread
/// exits. After this returns, a subsequent `get()` on the same thread
/// re-allocates (so ordering relative to other shutdown code is not load-bearing).
pub fn free_all_threadlocal_buffers() {
    let mut node = THREADLOCAL_BUFFERS_HEAD.with(|h| h.take());
    while let Some(n) = node {
        // SAFETY: n is a valid intrusive node from the list
        unsafe {
            let next = (*n.as_ptr()).next;
            ((*n.as_ptr()).free)(n.as_ptr());
            node = next;
        }
    }
}

// ─── cast / len / span / sliceTo ──────────────────────────────────────────────
// These are Zig comptime-reflection helpers over @typeInfo with no direct Rust
// equivalent. Callers should use Rust-native idioms instead:
//   `bun.cast(*T, p)`       → `p.cast::<T>()` / `p as *mut T`
//   `bun.len(p)`            → `slice.len()` / `bun_core::ffi::cstr(p).to_bytes().len()`
//   `bun.span(p)`           → `bun_core::ffi::cstr(p).to_bytes()` / `core::slice::from_raw_parts`
//   `bun.sliceTo(p, 0)`     → `bun_str::slice_to_nul(p)` / `bun_core::ffi::cstr(p)`
// TODO(port): comptime reflection — replace 22 callers with idioms above

#[inline]
pub unsafe fn cast<To>(value: *const c_void) -> *mut To {
    value.cast_mut().cast::<To>()
}

/// Find the length of a NUL-terminated C string.
#[inline]
pub unsafe fn len_cstr(value: *const c_char) -> usize {
    // SAFETY: caller guarantees `value` is NUL-terminated
    unsafe { bun_core::ffi::cstr(value) }.to_bytes().len()
}

#[inline]
pub unsafe fn span(pointer: *const c_char) -> &'static [u8] {
    // SAFETY: caller guarantees `pointer` is NUL-terminated and outlives the slice
    unsafe { bun_core::ffi::cstr(pointer) }.to_bytes()
}

/// Scan `pointer` until `end` or NUL sentinel, return the slice.
#[inline]
pub fn slice_to(pointer: &[u8], end: u8) -> &[u8] {
    match pointer.iter().position(|&b| b == end) {
        Some(i) => &pointer[..i],
        None => pointer,
    }
}

// ─── collections re-exports ───────────────────────────────────────────────────
pub use bun_collections as collections;
pub use bun_collections::identity_context::{IdentityContext, ArrayIdentityContext};
pub use bun_collections::{
    MultiArrayList, VecExt, ByteVecExt, OffsetByteList, bit_set, HiveArray, BoundedArray,
    LinearFifo, LinearFifoBufferType, ObjectPool,
};
pub use bun_collections::comptime_string_map;
// ComptimeStringMap → phf::Map at use sites; re-export the helper macros.
pub use bun_collections::comptime_string_map::{
    ComptimeStringMap, ComptimeStringMap16, ComptimeStringMapWithKeyType,
};

pub mod StringHashMapUnowned {
    use super::hash;

    #[derive(Copy, Clone, PartialEq, Eq)]
    pub struct Key {
        pub hash: u64,
        pub len: usize,
    }

    impl Key {
        pub fn init(str_: &[u8]) -> Key {
            Key { hash: hash(str_), len: str_.len() }
        }
    }

    pub struct Adapter;
    impl Adapter {
        pub fn eql(&self, a: Key, b: Key) -> bool {
            a.hash == b.hash && a.len == b.len
        }
        pub fn hash(&self, key: Key) -> u64 {
            key.hash
        }
    }
}

// ─── DebugOnly ────────────────────────────────────────────────────────────────
#[cfg(debug_assertions)]
pub type DebugOnly<T> = T;
#[cfg(not(debug_assertions))]
pub type DebugOnly<T> = ();

// TODO(port): DebugOnlyDefault — Rust can't return different types from one fn;
// use `#[cfg(debug_assertions)]` at call sites.

#[inline]
pub const fn range<const MIN: usize, const MAX: usize>() -> [usize; MAX - MIN]
where
    [(); MAX - MIN]:,
{
    let mut slice = [0usize; MAX - MIN];
    let mut i = MIN;
    while i < MAX {
        slice[i - MIN] = i;
        i += 1;
    }
    slice
}

pub fn copy<T: Copy>(dest: &mut [T], src: &[T]) {
    // SAFETY: memmove handles overlap; caller guarantees dest.len() >= src.len()
    let input = bun_core::as_bytes(src);
    let output = bun_core::as_bytes_mut(dest);
    memmove(output, input);
}

// TODO(port): `clone` uses @hasDecl reflection — replace with a `Clone`-bounded
// helper or per-type impls. Phase B: trait bound `T: Clone`.
pub fn clone<T: Clone>(item: &T) -> T {
    item.clone()
}

/// hash a string
#[inline]
pub fn hash(content: &[u8]) -> u64 {
    bun_wyhash::hash(content)
}

#[inline]
pub fn hash_with_seed(seed: u64, content: &[u8]) -> u64 {
    bun_wyhash::hash_with_seed(seed, content)
}

#[inline]
pub fn hash32(content: &[u8]) -> u32 {
    hash(content) as u32
}

// Dedup D087: canonical impl lives in bun_core::util::csprng (OS CSPRNG;
// bun_core sits below boringssl_sys). PERF(port): if a hot path needs the
// BoringSSL DRBG, install a vtable hook from bun_runtime at startup — see
// the comment block at bun_core/util.rs csprng.
pub use bun_core::csprng;

// Dedup D084: canonical impl lives in bun_core::util::fast_random (re-exported
// at bun_core root via `pub use util::*`). Collapsing the two SEED statics +
// thread-local PRNG cells into one is more spec-correct — bun.zig has a single
// process-wide seed.
pub use bun_core::fast_random;

// ─── poll helpers ─────────────────────────────────────────────────────────────
pub fn assert_non_blocking(fd: FD) {
    // TODO(port): std.posix.fcntl — use bun_sys::fcntl
    debug_assert!(
        (bun_sys::fcntl(fd, bun_sys::F::GETFL, 0).expect("unreachable") & O::NONBLOCK) != 0
    );
}

pub fn ensure_non_blocking(fd: FD) {
    let current = bun_sys::fcntl(fd, bun_sys::F::GETFL, 0).unwrap_or(0);
    let _ = bun_sys::fcntl(fd, bun_sys::F::SETFL, current | O::NONBLOCK);
}

// Dedup D050/D051: canonical impl lives in bun_core::util (re-exported at
// bun_core root). Zero callers reference `bun::PollFlag`/`bun::is_{readable,
// writable}` directly; the WSAPoll Windows branch + POLLOUT|ERR|HUP events
// mask + `[sys]` debug log (via a locally-declared scope, since bun_core sits
// below bun_sys) have all been folded into the canonical.
pub use bun_core::{Pollable, PollFlag, is_readable, is_writable};

/// Do not use this function, call `panic!` directly.
#[inline]
pub fn unreachable_panic(args: core::fmt::Arguments<'_>) -> ! {
    panic!("{}", args);
}

// TODO(port): StringEnum — use phf::Map<&[u8], T> at call sites

// ─── onceUnsafe ───────────────────────────────────────────────────────────────
// TODO(port): onceUnsafe — Rust: use `std::sync::OnceLock` (single-thread callers
// can use `Once` below). Zig version was not thread-safe.

pub fn is_heap_memory<T>(mem: *const T) -> bool {
    if use_mimalloc {
        // SAFETY: mi_is_in_heap_region only reads the pointer value
        return unsafe { bun_alloc::mimalloc::mi_is_in_heap_region(mem.cast::<c_void>()) };
    }
    false
}

#[inline]
pub fn slice_in_buffer<'a>(stable: &'a [u8], value: &'a [u8]) -> &'a [u8] {
    if bun_alloc::is_slice_in_buffer(stable, value) {
        return value;
    }
    if let Some(index) = bun_str::strings::index_of(stable, value) {
        return &stable[index..][..value.len()];
    }
    value
}

pub use bun_core::range_of_slice_in_buffer;

// TODO: prefer .invalid decl literal over this
// Please prefer `bun::FD::Optional::none` over this
pub const invalid_fd: FD = FD::INVALID;

/// Process start time in nanoseconds. Written once during single-threaded
/// startup; read freely thereafter. Re-exports the `bun_core` accessor.
pub use bun_core::{start_time, set_start_time};

// ─── file open helpers (TODO: move to bun_sys) ────────────────────────────────
// PORT NOTE: these wrap std.fs.File/Dir which are banned in Rust port; they
// return bun_sys::Fd / bun_sys::Dir instead.

#[derive(Copy, Clone)]
pub enum OpenMode {
    ReadOnly,
    WriteOnly,
    ReadWrite,
}

pub fn open_file_z(path_z: &bun_str::ZStr, mode: OpenMode) -> Result<bun_sys::File, bun_core::Error> {
    let mut flags: i32 = 0;
    match mode {
        OpenMode::ReadOnly => flags |= O::RDONLY,
        OpenMode::WriteOnly => flags |= O::WRONLY,
        OpenMode::ReadWrite => flags |= O::RDWR,
    }
    let res = sys::open(path_z, flags, 0).unwrap()?;
    Ok(bun_sys::File { handle: res.cast() })
}

pub fn open_file(path_: &[u8], mode: OpenMode) -> Result<bun_sys::File, bun_core::Error> {
    #[cfg(windows)]
    {
        let mut flags: i32 = 0;
        match mode {
            OpenMode::ReadOnly => flags |= O::RDONLY,
            OpenMode::WriteOnly => flags |= O::WRONLY,
            OpenMode::ReadWrite => flags |= O::RDWR,
        }
        let fd = sys::open_a(path_, flags, 0).unwrap()?;
        return Ok(fd.std_file());
    }
    #[cfg(not(windows))]
    {
        let mut buf = bun_paths::PathBuffer::uninit();
        let z = bun_paths::to_posix_path(path_, &mut buf)?;
        open_file_z(z, mode)
    }
}

pub fn open_dir(dir: bun_sys::Dir, path_: &bun_str::ZStr) -> Result<bun_sys::Dir, bun_core::Error> {
    #[cfg(windows)]
    {
        let res = sys::open_dir_at_windows_a(
            FD::from_std_dir(dir),
            path_.as_bytes(),
            sys::OpenDirOptions { iterable: true, can_rename_or_delete: true, read_only: true },
        )
        .unwrap()?;
        Ok(res.std_dir())
    }
    #[cfg(not(windows))]
    {
        let fd = sys::openat(
            FD::from_std_dir(dir),
            path_,
            O::DIRECTORY | O::CLOEXEC | O::RDONLY,
            0,
        )
        .unwrap()?;
        Ok(fd.std_dir())
    }
}

#[cfg(windows)]
pub fn open_dir_no_renaming_or_deleting_windows(
    dir: FD,
    path_: &bun_str::ZStr,
) -> Result<bun_sys::Dir, bun_core::Error> {
    let res = sys::open_dir_at_windows_a(
        dir,
        path_.as_bytes(),
        sys::OpenDirOptions { iterable: true, can_rename_or_delete: false, read_only: true },
    )
    .unwrap()?;
    Ok(res.std_dir())
}

pub fn open_dir_a(dir: bun_sys::Dir, path_: &[u8]) -> Result<bun_sys::Dir, bun_core::Error> {
    #[cfg(windows)]
    {
        let res = sys::open_dir_at_windows_a(
            FD::from_std_dir(dir),
            path_,
            sys::OpenDirOptions { iterable: true, can_rename_or_delete: true, read_only: true },
        )
        .unwrap()?;
        Ok(res.std_dir())
    }
    #[cfg(not(windows))]
    {
        let fd = sys::openat_a(
            FD::from_std_dir(dir),
            path_,
            O::DIRECTORY | O::CLOEXEC | O::RDONLY,
            0,
        )
        .unwrap()?;
        Ok(fd.std_dir())
    }
}

pub fn open_dir_for_iteration(dir: FD, path_: &[u8]) -> bun_sys::Result<FD> {
    #[cfg(windows)]
    {
        sys::open_dir_at_windows_a(
            dir,
            path_,
            sys::OpenDirOptions { iterable: true, can_rename_or_delete: false, read_only: true },
        )
    }
    #[cfg(not(windows))]
    {
        sys::openat_a(dir, path_, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0)
    }
}

pub fn open_dir_for_iteration_os_path(dir: FD, path_: &[OSPathChar]) -> bun_sys::Result<FD> {
    #[cfg(windows)]
    {
        sys::open_dir_at_windows(
            dir,
            path_,
            sys::OpenDirOptions { iterable: true, can_rename_or_delete: false, read_only: true },
        )
    }
    #[cfg(not(windows))]
    {
        sys::openat_a(dir, path_, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0)
    }
}

pub fn open_dir_absolute(path_: &[u8]) -> Result<bun_sys::Dir, bun_core::Error> {
    #[cfg(windows)]
    let fd = sys::open_dir_at_windows_a(
        invalid_fd,
        path_,
        sys::OpenDirOptions { iterable: true, can_rename_or_delete: true, read_only: true },
    )
    .unwrap()?;
    #[cfg(not(windows))]
    let fd = sys::open_a(path_, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0).unwrap()?;
    Ok(fd.std_dir())
}

pub fn open_dir_absolute_not_for_deleting_or_renaming(
    path_: &[u8],
) -> Result<bun_sys::Dir, bun_core::Error> {
    #[cfg(windows)]
    let fd = sys::open_dir_at_windows_a(
        invalid_fd,
        path_,
        sys::OpenDirOptions { iterable: true, can_rename_or_delete: false, read_only: true },
    )
    .unwrap()?;
    #[cfg(not(windows))]
    let fd = sys::open_a(path_, O::DIRECTORY | O::CLOEXEC | O::RDONLY, 0).unwrap()?;
    Ok(fd.std_dir())
}

// ─── getenv (legacy; prefer env_var) ──────────────────────────────────────────
// Canonical impls live in `bun_core::util` (re-exported via `bun_core::{getenv_z,
// getenv_z_any_case}`). The local copies that used to live here delegated through
// `bun_sys::environ()` on Windows, but `bun_core` cannot depend on `bun_sys`
// (tier inversion) and the only consumer (`getenv_truthy`) had zero callers, so
// the duplicates were dropped in favour of a re-export.
pub use bun_core::{getenv_z, getenv_z_any_case};

// ─── hash-map contexts ────────────────────────────────────────────────────────
pub struct U32HashMapContext;
impl U32HashMapContext {
    pub fn hash(&self, value: u32) -> u64 {
        value as u64
    }
    pub fn eql(&self, a: u32, b: u32) -> bool {
        a == b
    }
    pub fn pre(input: u32) -> U32Prehashed {
        U32Prehashed { value: Self.hash(input), input }
    }
}
pub struct U32Prehashed {
    pub value: u64,
    pub input: u32,
}
impl U32Prehashed {
    pub fn hash(&self, value: u32) -> u64 {
        if value == self.input { self.value } else { value as u64 }
    }
    pub fn eql(&self, a: u32, b: u32) -> bool {
        a == b
    }
}

pub struct StringArrayHashMapContext;
impl StringArrayHashMapContext {
    pub fn hash(&self, s: &[u8]) -> u32 {
        bun_wyhash::hash(s) as u32
    }
    pub fn eql(&self, a: &[u8], b: &[u8], _: usize) -> bool {
        bun_str::strings::eql_long(a, b, true)
    }
    pub fn pre(input: &[u8]) -> StringArrayPrehashed<'_> {
        StringArrayPrehashed { value: Self.hash(input), input }
    }
}
pub struct StringArrayPrehashed<'a> {
    pub value: u32,
    pub input: &'a [u8],
}
impl<'a> StringArrayPrehashed<'a> {
    pub fn hash(&self, s: &[u8]) -> u32 {
        if s.as_ptr() == self.input.as_ptr() && s.len() == self.input.len() {
            return self.value;
        }
        bun_wyhash::hash(s) as u32
    }
    pub fn eql(&self, a: &[u8], b: &[u8], _: usize) -> bool {
        bun_str::strings::eql_long(a, b, true)
    }
}

pub use bun_collections::{
    CaseInsensitiveAsciiPrehashed as CaseInsensitivePrehashed,
    CaseInsensitiveAsciiStringContext as CaseInsensitiveASCIIStringContext,
};

pub use bun_collections::StringHashMapContext;
pub use bun_collections::string_hash_map::{Prehashed as StringPrehashed, PrehashedCaseInsensitive};

// Hash-map type aliases — wired to bun_collections wrappers (wyhash, not SipHash).
pub type StringArrayHashMap<V> = bun_collections::ArrayHashMap<Box<[u8]>, V>;
pub type CaseInsensitiveASCIIStringArrayHashMap<V> =
    bun_collections::CaseInsensitiveAsciiStringArrayHashMap<V>;
pub type CaseInsensitiveASCIIStringArrayHashMapUnmanaged<V> =
    CaseInsensitiveASCIIStringArrayHashMap<V>;
pub type StringArrayHashMapUnmanaged<V> = StringArrayHashMap<V>;
pub type StringHashMap<V> = bun_collections::StringHashMap<V>;
pub type StringHashMapUnmanaged<V> = StringHashMap<V>;
pub type FDHashMap<V> = bun_collections::HashMap<FD, V>;
pub type U32HashMap<V> = bun_collections::HashMap<u32, V>;

// ─── copy_file re-exports ─────────────────────────────────────────────────────
pub use bun_sys::copy_file::{
    copy_file_error_convert as copyFileErrnoConvert, copy_file_range as copyFileRange,
    can_use_copy_file_range_syscall as canUseCopyFileRangeSyscall,
    disable_copy_file_range_syscall as disableCopyFileRangeSyscall,
    can_use_ioctl_ficlone, disable_ioctl_ficlone, copy_file as copyFile,
    copy_file_with_state as copyFileWithState, CopyFileState,
};

pub fn parse_double(input: &[u8]) -> Result<f64, bun_core::Error> {
    // TODO(port): wasm fallback to std parseFloat
    bun_jsc::wtf::parse_double(input)
}

pub fn is_missing_io_uring() -> bool {
    #[cfg(not(target_os = "linux"))]
    {
        // it is not missing when it was not supposed to be there in the first place
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        static IS_MISSING: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
        *IS_MISSING.get_or_init(|| {
            let kernel = bun_analytics::GenerateHeader::GeneratePlatform::kernel_version();
            // io_uring was introduced in earlier versions of Linux, but it was not
            // really usable for us until 5.3
            kernel.major < 5 || (kernel.major == 5 && kernel.minor < 3)
        })
    }
}

// TODO(port): enumMap / ComptimeEnumMap — use `strum::IntoStaticStr` +
// `enum_map::EnumMap` / `phf::phf_map!` at call sites.

/// Write 0's for every byte in Type. Ignores default struct values.
#[inline]
pub unsafe fn zero<T>() -> T {
    // SAFETY: caller asserts all-zero is a valid T
    unsafe { bun_core::ffi::zeroed_unchecked() }
}

// ─── getFdPath ────────────────────────────────────────────────────────────────
static NEEDS_PROC_SELF_WORKAROUND: AtomicBool = AtomicBool::new(false);

/// TODO: move to bun.sys
fn get_fd_path_via_cwd(fd: bun_sys::RawFd, buf: &mut PathBuffer) -> Result<&mut [u8], bun_core::Error> {
    /// RAII: closes `prev_fd` on drop and, once `restore` is set, fchdirs back to it first.
    struct CwdRestore {
        prev_fd: bun_sys::RawFd,
        restore: bool,
    }
    impl Drop for CwdRestore {
        fn drop(&mut self) {
            if self.restore {
                bun_sys::fchdir(self.prev_fd).expect("unreachable");
            }
            bun_sys::close(self.prev_fd);
        }
    }

    let prev_fd = bun_sys::openat_z(FD::cwd().native(), bun_str::zstr!("."), O::DIRECTORY, 0)?;
    let mut guard = CwdRestore { prev_fd, restore: false };
    bun_sys::fchdir(fd)?;
    guard.restore = true;
    bun_sys::getcwd(buf)
}

pub use bun_sys::getcwd;

pub fn getcwd_alloc() -> Result<Box<bun_str::ZStr>, bun_core::Error> {
    let mut temp = PathBuffer::uninit();
    let temp_slice = getcwd(&mut temp)?;
    Ok(bun_str::ZStr::from_bytes(temp_slice))
}

/// TODO: move to bun.sys and add a method onto FD
/// Get the absolute path to a file descriptor.
pub fn get_fd_path<'a>(fd: FD, buf: &'a mut PathBuffer) -> Result<&'a mut [u8], bun_core::Error> {
    #[cfg(windows)]
    {
        let mut wide_buf = WPathBuffer::uninit();
        let wide_slice = bun_sys::windows::GetFinalPathNameByHandle(fd.native(), Default::default(), &mut wide_buf[..])?;
        let res = bun_str::strings::copy_utf16_into_utf8(&mut buf[..], wide_slice);
        return Ok(&mut buf[..res.written]);
    }

    #[cfg(debug_assertions)]
    {
        static HAS_CHECKED: AtomicBool = AtomicBool::new(false);
        if !HAS_CHECKED.swap(true, Ordering::Relaxed) {
            NEEDS_PROC_SELF_WORKAROUND.store(
                bun_core::env_var::BUN_NEEDS_PROC_SELF_WORKAROUND.get(),
                Ordering::Relaxed,
            );
        }
    }
    #[cfg(all(not(debug_assertions), not(target_os = "linux")))]
    {
        return bun_sys::get_fd_path(fd.native(), buf);
    }

    if NEEDS_PROC_SELF_WORKAROUND.load(Ordering::Relaxed) {
        return get_fd_path_via_cwd(fd.native(), buf);
    }

    match bun_sys::get_fd_path(fd.native(), buf) {
        Ok(v) => Ok(v),
        Err(err)
            if err == bun_core::err!("FileNotFound")
                && !NEEDS_PROC_SELF_WORKAROUND.load(Ordering::Relaxed) =>
        {
            NEEDS_PROC_SELF_WORKAROUND.store(true, Ordering::Relaxed);
            get_fd_path_via_cwd(fd.native(), buf)
        }
        Err(err) => Err(err),
    }
}

/// TODO: move to bun.sys and add a method onto FD
pub fn get_fd_path_z<'a>(fd: FD, buf: &'a mut PathBuffer) -> Result<&'a mut bun_str::ZStr, bun_core::Error> {
    let len = get_fd_path(fd, buf)?.len();
    buf[len] = 0;
    Ok(bun_str::ZStr::from_buf_mut(buf, len))
}

/// TODO: move to bun.sys and add a method onto FD
#[cfg(windows)]
pub fn get_fd_path_w<'a>(fd: FD, buf: &'a mut WPathBuffer) -> Result<&'a mut [u16], bun_core::Error> {
    bun_sys::windows::GetFinalPathNameByHandle(fd.native(), Default::default(), buf)
}
#[cfg(not(windows))]
pub fn get_fd_path_w<'a>(_fd: FD, _buf: &'a mut WPathBuffer) -> Result<&'a mut [u16], bun_core::Error> {
    panic!("TODO unsupported platform for getFdPathW");
}

// lenSliceTo / SliceTo / sliceTo are comptime-reflection helpers; see comment
// above `slice_to`. Callers use `bun_str::slice_to_nul` or `slice_to` directly.
// TODO(port): comptime reflection — sliceTo type machinery dropped

pub fn concat<T: Copy>(dest: &mut [T], src: &[&[T]]) {
    let mut remain = dest;
    for group in src {
        // PORT NOTE: reshaped for borrowck
        let (head, tail) = remain.split_at_mut(group.len());
        head.copy_from_slice(group);
        remain = tail;
    }
}

/// Attempt to coerce some value into a byte slice.
#[inline]
pub unsafe fn as_byte_slice(buffer: *const c_char) -> &'static [u8] {
    // SAFETY: caller guarantees NUL-terminated
    unsafe { span(buffer) }
}

// ─── DebugOnlyDisabler ────────────────────────────────────────────────────────
pub struct DebugOnlyDisabler<T> {
    _marker: core::marker::PhantomData<T>,
}
impl<T> DebugOnlyDisabler<T> {
    thread_local! {
        static DISABLE_CREATE_IN_DEBUG: Cell<usize> = const { Cell::new(0) };
    }
    #[inline]
    pub fn disable() {
        if !cfg!(debug_assertions) {
            return;
        }
        Self::DISABLE_CREATE_IN_DEBUG.with(|c| c.set(c.get() + 1));
    }
    #[inline]
    pub fn enable() {
        if !cfg!(debug_assertions) {
            return;
        }
        Self::DISABLE_CREATE_IN_DEBUG.with(|c| c.set(c.get() - 1));
    }
    #[inline]
    pub fn assert() {
        if !cfg!(debug_assertions) {
            return;
        }
        if Self::DISABLE_CREATE_IN_DEBUG.with(|c| c.get()) > 0 {
            Output::panic(format_args!(
                "[{}] called while disabled (did you forget to call enable?)",
                core::any::type_name::<T>()
            ));
        }
    }
}
// TODO(port): DebugOnlyDisabler thread_local can't be generic-associated in
// stable Rust — Phase B: macro_rules! to stamp per-type statics.

// FailingAllocator / failing_allocator — Rust has no equivalent vtable concept;
// callers that needed "uninitialized pool" should use Option<&dyn Allocator>.
// TODO(port): failing_allocator — replace with panic-on-use pool if needed

// ─── reload process ───────────────────────────────────────────────────────────
// Canonical impl lives in bun_core (tier-0) so crash_handler can read the same
// RELOAD_IN_PROGRESS atomic. A second copy here was a split-brain hazard.
// TODO(port): bun_core::reload_process currently uses plain execve on macOS;
// the spec-faithful posix_spawn(SETEXEC|CLOEXEC_DEFAULT) path should be ported
// into bun_core using raw libc::posix_spawn* (libc is a tier-0 dep).
pub use bun_core::{
    auto_reload_on_crash, exit_thread, is_process_reload_in_progress_on_another_thread,
    maybe_handle_panic_during_process_reload, reload_process, set_auto_reload_on_crash,
};

// ─── StringSet ────────────────────────────────────────────────────────────────
pub struct StringSet {
    pub map: bun_collections::ArrayHashMap<Box<[u8]>, ()>,
}

impl StringSet {
    pub fn clone(&self) -> Result<StringSet, OOM> {
        let mut new_map = bun_collections::ArrayHashMap::default();
        new_map.reserve(self.map.len());
        for key in self.map.keys() {
            new_map.insert(Box::<[u8]>::from(&**key), ());
            // PERF(port): was assume_capacity
        }
        Ok(StringSet { map: new_map })
    }

    pub fn init() -> StringSet {
        StringSet { map: bun_collections::ArrayHashMap::default() }
    }

    /// Initialize an empty StringSet at comptime (for use as a static constant).
    pub const fn init_comptime() -> StringSet {
        // TODO(port): const-fn ArrayHashMap::new()
        StringSet { map: bun_collections::ArrayHashMap::new_const() }
    }

    pub fn is_empty(&self) -> bool {
        self.count() == 0
    }

    pub fn count(&self) -> usize {
        self.map.len()
    }

    pub fn keys(&self) -> &[Box<[u8]>] {
        self.map.keys()
    }

    pub fn insert(&mut self, key: &[u8]) -> Result<(), OOM> {
        if !self.map.contains_key(key) {
            self.map.insert(Box::<[u8]>::from(key), ());
        }
        Ok(())
    }

    pub fn contains(&self, key: &[u8]) -> bool {
        self.map.contains_key(key)
    }

    pub fn swap_remove(&mut self, key: &[u8]) -> bool {
        self.map.swap_remove(key).is_some()
    }

    pub fn clear_and_free(&mut self) {
        self.map.clear();
        self.map.shrink_to_fit();
    }
}
// Drop frees owned Box<[u8]> keys automatically — no explicit deinit body.

// ─── StringMap ────────────────────────────────────────────────────────────────
pub struct StringMap {
    pub map: bun_collections::ArrayHashMap<Box<[u8]>, Box<[u8]>>,
    pub dupe_keys: bool,
}

impl StringMap {
    pub fn clone(&self) -> Result<StringMap, OOM> {
        Ok(StringMap { map: self.map.clone(), dupe_keys: self.dupe_keys })
    }

    pub fn init(dupe_keys: bool) -> StringMap {
        StringMap { map: bun_collections::ArrayHashMap::default(), dupe_keys }
    }

    pub fn keys(&self) -> &[Box<[u8]>] {
        self.map.keys()
    }

    pub fn values(&self) -> &[Box<[u8]>] {
        self.map.values()
    }

    pub fn count(&self) -> usize {
        self.map.len()
    }

    pub fn to_api(&self) -> schema::api::StringMap {
        schema::api::StringMap { keys: self.keys(), values: self.values() }
    }

    pub fn insert(&mut self, key: &[u8], value: &[u8]) -> Result<(), OOM> {
        // PORT NOTE: dupe_keys is always effectively true here since keys are
        // Box<[u8]>; the Zig version stored borrowed slices when dupe_keys=false.
        // TODO(port): preserve borrowed-key mode if a caller relies on it
        self.map.insert(Box::<[u8]>::from(key), Box::<[u8]>::from(value));
        Ok(())
    }
    pub fn put(&mut self, key: &[u8], value: &[u8]) -> Result<(), OOM> {
        self.insert(key, value)
    }

    pub fn get(&self, key: &[u8]) -> Option<&[u8]> {
        self.map.get(key).map(|v| &**v)
    }

    pub fn sort<C: FnMut(usize, usize) -> core::cmp::Ordering>(&mut self, sort_ctx: C) {
        self.map.sort_by(sort_ctx);
    }
}
// Drop frees owned Box<[u8]> keys/values automatically.

// PERF(port): threadLocalAllocator — global mimalloc is already thread-local-cached

// ─── HiveRef ──────────────────────────────────────────────────────────────────
pub struct HiveRef<'a, T, const CAPACITY: u16> {
    pub ref_count: u32,
    pub pool: &'a mut bun_collections::HiveArrayFallback<HiveRef<'a, T, CAPACITY>, CAPACITY>,
    pub value: T,
}

impl<'a, T, const CAPACITY: u16> HiveRef<'a, T, CAPACITY> {
    pub fn init(
        value: T,
        pool: &'a mut bun_collections::HiveArrayFallback<HiveRef<'a, T, CAPACITY>, CAPACITY>,
    ) -> Result<&'a mut Self, OOM> {
        let this = pool.try_get()?;
        // SAFETY: try_get returns uninitialized slot; we fully init it here
        unsafe {
            core::ptr::write(
                this,
                HiveRef { ref_count: 1, pool, value },
            );
        }
        Ok(this)
    }

    pub fn ref_(&mut self) -> &mut Self {
        self.ref_count += 1;
        self
    }

    pub fn unref(&mut self) -> Option<&mut Self> {
        let ref_count = self.ref_count;
        self.ref_count = ref_count - 1;
        if ref_count == 1 {
            // TODO(port): @hasDecl(T, "deinit") — Drop on T handles this
            // SAFETY: self came from pool.try_get()
            unsafe {
                let pool: *mut _ = self.pool;
                (*pool).put(self);
            }
            return None;
        }
        Some(self)
    }
}

pub fn open_file_for_path(file_path: &bun_str::ZStr) -> Result<bun_sys::File, bun_core::Error> {
    #[cfg(windows)]
    {
        return bun_sys::Dir::cwd().open_file_z(file_path, Default::default());
    }
    #[cfg(not(windows))]
    {
        #[cfg(target_os = "linux")]
        let o_path = O::PATH;
        #[cfg(not(target_os = "linux"))]
        let o_path = O::RDONLY;
        let flags: u32 = O::CLOEXEC | O::NOCTTY | o_path;
        let fd = bun_sys::open_z(file_path, O::to_packed(flags), 0)?;
        Ok(bun_sys::File { handle: fd })
    }
}

pub fn open_dir_for_path(file_path: &bun_str::ZStr) -> Result<bun_sys::Dir, bun_core::Error> {
    #[cfg(windows)]
    {
        return bun_sys::Dir::cwd().open_dir_z(file_path, Default::default());
    }
    #[cfg(not(windows))]
    {
        #[cfg(target_os = "linux")]
        let o_path = O::PATH;
        #[cfg(not(target_os = "linux"))]
        let o_path = O::RDONLY;
        let flags: u32 = O::CLOEXEC | O::NOCTTY | O::DIRECTORY | o_path;
        let fd = bun_sys::open_z(file_path, O::to_packed(flags), 0)?;
        Ok(bun_sys::Dir { fd })
    }
}

pub type Generation = u16;

pub use schema::api::StringPointer;

// ─── string re-exports ────────────────────────────────────────────────────────
pub use bun_str as string;
pub use bun_str::String;
pub use bun_str::StringJoiner;
pub use bun_str::SliceWithUnderlyingString;
pub use bun_str::PathString;
pub use bun_str::HashedString;
pub use bun_str::MutableString;
pub use bun_str::StringBuilder;
/// Utilities for immutable strings
pub use bun_str::strings;
pub use bun_str::strings::CodePoint;

pub mod WTF {
    /// The String type from WebKit's WTF library.
    pub use bun_str::WTFStringImpl as StringImpl;
    pub use bun_str::WTFStringImplStruct as _StringImplStruct;
}

bun_output::declare_scope!(TODO, visible);
#[inline]
pub fn todo<T>(src: &core::panic::Location<'_>, value: T) -> T {
    if cfg!(debug_assertions) {
        bun_output::scoped_log!(TODO, "{}() at {}:{}:{}", "<fn>", src.file(), src.line(), src.column());
    }
    value
}

#[cfg(windows)]
pub const HOST_NAME_MAX: usize = 256;
#[cfg(not(windows))]
pub const HOST_NAME_MAX: usize = bun_sys::HOST_NAME_MAX;

#[repr(C)]
pub struct WindowsStat {
    pub dev: u32,
    pub ino: u32,
    pub nlink: usize,
    pub mode: Mode,
    pub uid: u32,
    pub gid: u32,
    pub rdev: u32,
    pub size: u32,
    pub blksize: isize,
    pub blocks: i64,
    pub atim: bun_sys::timespec_c,
    pub mtim: bun_sys::timespec_c,
    pub ctim: bun_sys::timespec_c,
}
impl WindowsStat {
    pub fn birthtime(&self) -> bun_sys::timespec_c {
        bun_sys::timespec_c { tv_nsec: 0, tv_sec: 0 }
    }
    pub fn mtime(&self) -> bun_sys::timespec_c {
        self.mtim
    }
    pub fn ctime(&self) -> bun_sys::timespec_c {
        self.ctim
    }
    pub fn atime(&self) -> bun_sys::timespec_c {
        self.atim
    }
}

#[cfg(windows)]
pub type Stat = bun_sys::windows::libuv::uv_stat_t;
#[cfg(not(windows))]
pub type Stat = bun_sys::Stat;

#[cfg(target_os = "macos")]
pub type StatFS = bun_sys::c::struct_statfs;
#[cfg(target_os = "linux")]
pub type StatFS = bun_sys::c::struct_statfs;
#[cfg(target_os = "freebsd")]
pub type StatFS = bun_sys::c::struct_statfs;
#[cfg(windows)]
pub type StatFS = bun_sys::windows::libuv::uv_statfs_t;

// ─── argv ─────────────────────────────────────────────────────────────────────
// Initialized once in `init_argv()` during single-threaded startup, then read
// freely. `RacyCell` (not `OnceLock`) because the BUN_OPTIONS path mutates it
// twice (set, take, set again) before the program goes multi-threaded.
static ARGV: bun_core::RacyCell<Vec<Box<bun_str::ZStr>>> = bun_core::RacyCell::new(Vec::new());
/// Number of arguments injected by BUN_OPTIONS environment variable.
pub use bun_core::{bun_options_argc, set_bun_options_argc};

pub fn argv() -> &'static [Box<bun_str::ZStr>] {
    // SAFETY: ARGV is initialized once in init_argv() during single-threaded
    // startup and never resized after.
    unsafe { &*ARGV.get() }
}

/// Trait for arg types accepted by `append_options_env` (replaces `comptime ArgType`).
pub trait OptionsEnvArg {
    fn from_slice(s: &[u8]) -> Self;
    fn from_buf(buf: Vec<u8>) -> Self;
}
impl OptionsEnvArg for bun_str::String {
    fn from_slice(s: &[u8]) -> Self {
        bun_str::String::clone_utf8(s)
    }
    fn from_buf(buf: Vec<u8>) -> Self {
        bun_str::String::clone_utf8(&buf)
    }
}
impl OptionsEnvArg for Box<bun_str::ZStr> {
    fn from_slice(s: &[u8]) -> Self {
        bun_str::ZStr::from_bytes(s)
    }
    fn from_buf(mut buf: Vec<u8>) -> Self {
        buf.push(0);
        // SAFETY: just appended NUL
        unsafe { bun_str::ZStr::from_vec_with_nul_unchecked(buf) }
    }
}

pub fn append_options_env<A: OptionsEnvArg>(
    env: &[u8],
    args: &mut Vec<A>,
) -> Result<(), OOM> {
    let mut i: usize = 0;
    let mut offset_in_args: usize = 1;
    while i < env.len() {
        // skip whitespace
        while i < env.len() && env[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= env.len() {
            break;
        }

        // Handle all command-line arguments with quotes preserved
        let start = i;
        let mut j = i;

        // Check if this is an option (starts with --)
        let is_option = j + 2 <= env.len() && env[j] == b'-' && env[j + 1] == b'-';

        if is_option {
            // Find the end of the option flag (--flag)
            while j < env.len() && !env[j].is_ascii_whitespace() && env[j] != b'=' {
                j += 1;
            }

            let end_of_flag = j;
            let mut found_equals = false;

            // Check for equals sign
            if j < env.len() && env[j] == b'=' {
                found_equals = true;
                j += 1; // Move past the equals sign
            } else if j < env.len() && env[j].is_ascii_whitespace() {
                j += 1; // Move past the space
                while j < env.len() && env[j].is_ascii_whitespace() {
                    j += 1;
                }
            }

            // Handle quoted values
            if j < env.len() && (env[j] == b'\'' || env[j] == b'"') {
                let quote_char = env[j];
                j += 1; // Move past opening quote
                while j < env.len() && env[j] != quote_char {
                    j += 1;
                }
                if j < env.len() {
                    j += 1; // Move past closing quote
                }
            } else if found_equals {
                // If we had --flag=value (no quotes), find next whitespace
                while j < env.len() && !env[j].is_ascii_whitespace() {
                    j += 1;
                }
            } else {
                // No value found after flag (e.g., `--flag1 --flag2`).
                j = end_of_flag;
            }

            // Copy the entire argument including quotes
            let arg = A::from_slice(&env[start..j]);
            args.insert(offset_in_args, arg);
            offset_in_args += 1;

            i = j;
            continue;
        }

        // Non-option arguments or standalone values
        let mut buf: Vec<u8> = Vec::new();

        let mut in_single = false;
        let mut in_double = false;
        let mut escape = false;
        while i < env.len() {
            let ch = env[i];
            if escape {
                buf.push(ch);
                escape = false;
                i += 1;
                continue;
            }
            if ch == b'\\' {
                escape = true;
                i += 1;
                continue;
            }
            if in_single {
                if ch == b'\'' {
                    in_single = false;
                } else {
                    buf.push(ch);
                }
                i += 1;
                continue;
            }
            if in_double {
                if ch == b'"' {
                    in_double = false;
                } else {
                    buf.push(ch);
                }
                i += 1;
                continue;
            }
            if ch == b'\'' {
                in_single = true;
            } else if ch == b'"' {
                in_double = true;
            } else if ch.is_ascii_whitespace() {
                break;
            } else {
                buf.push(ch);
            }
            i += 1;
        }

        args.insert(offset_in_args, A::from_buf(buf));
        offset_in_args += 1;
    }
    Ok(())
}

pub fn init_argv() -> Result<(), bun_core::Error> {
    #[cfg(unix)]
    {
        let os_argv = bun_sys::os_argv();
        let mut out: Vec<Box<bun_str::ZStr>> = Vec::with_capacity(os_argv.len());
        for &p in os_argv {
            // SAFETY: os argv entries are NUL-terminated
            let s = unsafe { bun_core::ffi::cstr(p) }.to_bytes();
            out.push(bun_str::ZStr::from_bytes(s));
        }
        // SAFETY: single-threaded init
        unsafe { *ARGV.get() = out };
    }
    #[cfg(windows)]
    {
        // SAFETY: GetCommandLineW returns a valid wide string
        let cmdline_ptr = unsafe { bun_sys::windows::GetCommandLineW() };
        let mut length: c_int = 0;
        let argvu16_ptr =
            unsafe { bun_sys::windows::CommandLineToArgvW(cmdline_ptr, &mut length) };
        if argvu16_ptr.is_null() {
            return match bun_sys::get_errno(()) {
                bun_sys::E::NOMEM => Err(bun_core::err!("OutOfMemory")),
                bun_sys::E::INVAL => Err(bun_core::err!("InvalidArgument")),
                _ => Err(bun_core::err!("Unknown")),
            };
        }
        let argvu16 =
            unsafe { core::slice::from_raw_parts(argvu16_ptr, usize::try_from(length).expect("int cast")) };
        let mut out_argv: Vec<Box<bun_str::ZStr>> = Vec::with_capacity(argvu16.len());
        let mut string_builder = StringBuilder::default();
        for &argraw in argvu16 {
            let arg = unsafe { bun_str::WStr::from_ptr(argraw) };
            string_builder.count16_z(arg);
        }
        string_builder.allocate()?;
        for &argraw in argvu16 {
            let arg = unsafe { bun_str::WStr::from_ptr(argraw) };
            let s = string_builder
                .append16(arg)
                .unwrap_or_else(|| panic!("Failed to allocate memory for argv"));
            out_argv.push(s);
        }
        // SAFETY: single-threaded init
        unsafe { *ARGV.get() = out_argv };
    }

    if let Some(opts) = bun_core::env_var::BUN_OPTIONS.get() {
        // SAFETY: single-threaded init
        unsafe {
            let argv = &mut *ARGV.get();
            let original_len = argv.len();
            let mut argv_list = core::mem::take(argv);
            append_options_env::<Box<bun_str::ZStr>>(opts, &mut argv_list)?;
            *argv = argv_list;
            set_bun_options_argc(argv.len() - original_len);
        }
    }
    Ok(())
}

#[inline]
pub fn is_regular_file(mode: u32) -> bool {
    S::ISREG(mode)
}

// ─── LazyBool ─────────────────────────────────────────────────────────────────
#[derive(Copy, Clone, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum LazyBoolValue {
    #[default]
    Unknown,
    No,
    Yes,
}

/// Create a lazily computed boolean value.
pub struct LazyBool<Parent, const FIELD_OFFSET: usize> {
    pub value: LazyBoolValue,
    getter: fn(&mut Parent) -> bool,
}

impl<Parent, const FIELD_OFFSET: usize> LazyBool<Parent, FIELD_OFFSET> {
    pub const fn new(getter: fn(&mut Parent) -> bool) -> Self {
        Self { value: LazyBoolValue::Unknown, getter }
    }

    pub fn get(&mut self) -> bool {
        if self.value == LazyBoolValue::Unknown {
            // SAFETY: self points to Parent.<field> at FIELD_OFFSET
            let parent = unsafe {
                &mut *bun_core::container_of::<Parent, Self>(core::ptr::from_mut(self), FIELD_OFFSET)
            };
            self.value = if (self.getter)(parent) {
                LazyBoolValue::Yes
            } else {
                LazyBoolValue::No
            };
        }
        self.value == LazyBoolValue::Yes
    }
}

// TODO(port): serializable / serializableInto — Zig field-reflection to zero
// padding bytes. Rust `#[repr(C)]` + `unsafe { mem::zeroed() }` then field-assign
// is the equivalent; needs a derive macro for ergonomics.

/// Like std.fs.Dir.makePath except instead of infinite looping on dangling
/// symlink, it deletes the symlink and tries again.
pub fn make_path(dir: bun_sys::Dir, sub_path: &[u8]) -> Result<(), bun_core::Error> {
    let mut it = bun_paths::component_iterator(sub_path)?;
    let Some(mut component) = it.last() else { return Ok(()) };
    loop {
        match dir.make_dir(component.path) {
            Ok(()) => {}
            Err(e) if e == bun_core::err!("PathAlreadyExists") => {
                let mut path_buf2 = [0u8; MAX_PATH_BYTES * 2];
                path_buf2[..component.path.len()].copy_from_slice(component.path);
                path_buf2[component.path.len()] = 0;
                // SAFETY: NUL written above
                let path_to_use = bun_str::ZStr::from_buf(&path_buf2[..], component.path.len());
                let result = sys::lstat(path_to_use).unwrap()?;
                let is_dir = S::ISDIR(result.mode as u32);
                // dangling symlink
                if !is_dir {
                    let _ = dir.delete_tree(component.path);
                    continue;
                }
            }
            Err(e) if e == bun_core::err!("FileNotFound") => {
                component = match it.previous() {
                    Some(p) => p,
                    None => return Err(e),
                };
                continue;
            }
            Err(e) => return Err(e),
        }
        component = match it.next() {
            Some(c) => c,
            None => return Ok(()),
        };
    }
}

/// Like make_path but accepts a UTF-16 path.
pub fn make_path_w(dir: bun_sys::Dir, sub_path: &[u16]) -> Result<(), bun_core::Error> {
    let mut buf = PathBuffer::uninit();
    let buf_len = bun_simdutf_sys::convert::utf16::to::utf8::le(sub_path, &mut buf);
    make_path(dir, &buf[..buf_len])
}

/// This is a helper for writing path string literals that are compatible with Windows.
/// Returns the string as-is on linux, on windows replace `/` with `\`
#[macro_export]
macro_rules! path_literal {
    ($lit:literal) => {{
        #[cfg(not(windows))]
        {
            $lit
        }
        #[cfg(windows)]
        {
            // TODO(port): const-eval string replacement — use const_format or
            // a build-time macro to replace '/' with '\\'
            const_format::str_replace!($lit, "/", "\\")
        }
    }};
}

/// Same as `path_literal!`, but the character type is chosen from platform.
#[macro_export]
macro_rules! os_path_literal {
    ($lit:literal) => {{
        #[cfg(not(windows))]
        {
            $lit
        }
        #[cfg(windows)]
        {
            // TODO(port): comptime UTF-16 path literal with sep rewrite
            bun_str::w!(const_format::str_replace!($lit, "/", "\\"))
        }
    }};
}

// ─── MakePath / Dirname (Windows std.fs copies) ──────────────────────────────
// TODO(port): MakePath — these are copy/pastes of Zig std internals for u16
// paths on Windows. Phase B should reimplement on top of bun_sys::windows
// directly rather than mirror Zig's NtCreateFile shim.
pub mod MakePath {
    // TODO(port): makeOpenPathAccessMaskW / makeOpenDirAccessMaskW / makeOpenPath /
    // makePath<T> / componentIterator<T> — Windows-specific NT API wrappers
}

/// Zig-API parity re-export. The body that lived here was a verbatim duplicate
/// of `bun_paths::Dirname` (its non-Windows arm even called the *private*
/// `bun_paths::dirname_posix`, so it could not compile if instantiated).
/// Canonical impl: `bun_paths::Dirname::dirname` → `path::dirname_generic`.
pub use bun_paths::Dirname;

// Canonical impl lives in `bun_alloc` (T0); it dispatches through the
// `OUT_OF_MEMORY_HANDLER` hook installed by `bun_crash_handler::install_hooks()`,
// which routes to `crashHandler(.out_of_memory, ..)` — matching
// `src/bun.zig:2632 outOfMemory()`. Re-export so `bun::out_of_memory()` callers
// (zlib, test_command) keep working without taking a direct crash_handler dep.
pub use bun_alloc::out_of_memory;

// ─── StackFallbackAllocator ───────────────────────────────────────────────────
// PERF(port): was stack-fallback — Rust port deletes this; callers use heap.
// TODO(port): StackFallbackAllocator — if a caller proves hot, reintroduce as
// a bumpalo-backed scratch with fallback to global alloc.

#[cold]
pub fn todo_panic(src: &core::panic::Location<'_>, args: core::fmt::Arguments<'_>) -> ! {
    bun_analytics::Features::todo_panic.store(1, Ordering::Relaxed);
    Output::panic(format_args!("TODO: {} ({}:{})", args, src.file(), src.line()));
}

/// Wrapper around Box::new that safely initializes the pointer.
#[inline]
pub fn create<T>(t: T) -> Box<T> {
    Box::new(t)
}

/// Globally-allocate a value on the heap. Must free with `destroy` (or just drop the Box).
#[inline]
pub fn new<T>(init: T) -> Box<T> {
    // PERF(port): heap_breakdown zone tagging — profile in Phase B
    if cfg!(debug_assertions) {
        bun_output::scoped_log!(alloc, "new({}) = <ptr>", core::any::type_name::<T>());
    }
    Box::new(init)
}

/// Error-returning version of `new`.
#[inline]
pub fn try_new<T>(init: T) -> Result<Box<T>, OOM> {
    // Rust Box::new aborts on OOM; this matches `handleOom` semantics.
    Ok(Box::new(init))
}

/// Free a globally-allocated value from `new()`.
#[inline]
pub fn destroy<T>(pointer: Box<T>) {
    if cfg!(debug_assertions) {
        bun_output::scoped_log!(alloc, "destroy({}) = <ptr>", core::any::type_name::<T>());
        // TODO(port): ref_count.maybeAssertNoRefs / assertBeforeDestroy hooks
    }
    drop(pointer);
}

#[inline]
pub fn dupe<T: Clone>(t: &T) -> Box<T> {
    new(t.clone())
}

// TrivialNew / TrivialDeinit — in Rust these are just `Box::new` / `Drop`.
// TODO(port): TrivialNew/TrivialDeinit — replace call sites with Box::new/drop

// exit_thread: re-exported from bun_core above (reload-process group).

pub fn delete_all_pools_for_thread_exit() {
    bun_jsc::WebCore::ByteListPool::delete_all();
    bun_paths::w_path_buffer_pool::delete_all();
    bun_paths::path_buffer_pool::delete_all();
    bun_jsc::ConsoleObject::Formatter::Visited::Pool::delete_all();
    bun_js_parser::StringVoidMap::Pool::delete_all();
    free_all_threadlocal_buffers();
}

// ─── errno mapping ────────────────────────────────────────────────────────────
// TODO(port): errno_map — Zig built a comptime [N]anyerror table from
// SystemErrno tag names. In Rust, `bun_core::Error` is interned by name, so
// `errno_to_zig_err` can construct directly from `SystemErrno::name()`.

pub fn errno_to_zig_err(err: i32) -> bun_core::Error {
    let mut num = err;
    if cfg!(debug_assertions) {
        debug_assert!(num != 0);
    }
    #[cfg(windows)]
    {
        // uv errors are negative, normalizing it will make this more resilient
        num = num.abs();
    }
    #[cfg(not(windows))]
    {
        if cfg!(debug_assertions) {
            debug_assert!(num > 0);
        }
    }
    if let Some(e) = bun_sys::SystemErrno::from_raw(num) {
        return bun_core::Error::intern(e.name());
    }
    bun_core::err!("Unexpected")
}

pub fn iterate_dir(dir: FD) -> DirIterator::Iterator {
    DirIterator::iterate(dir, DirIterator::Encoding::U8).iter
}

/// Zig has a todo for @ptrCast changing the `.len`. This is the workaround.
#[inline]
pub fn reinterpret_slice<T>(slice: &[u8]) -> &[T] {
    // SAFETY: caller guarantees alignment and that bytes form valid T values
    unsafe {
        core::slice::from_raw_parts(
            slice.as_ptr().cast::<T>(),
            slice.len() / core::mem::size_of::<T>(),
        )
    }
}
#[inline]
pub fn reinterpret_slice_mut<T>(slice: &mut [u8]) -> &mut [T] {
    // SAFETY: caller guarantees alignment and that bytes form valid T values
    unsafe {
        core::slice::from_raw_parts_mut(
            slice.as_mut_ptr().cast::<T>(),
            slice.len() / core::mem::size_of::<T>(),
        )
    }
}

// resolveSourcePath / runtimeEmbedFile — debug-only @embedFile bypass.
// TODO(port): runtimeEmbedFile — replace with `include_bytes!` in release and a
// `bun_sys::File::read_from` call in debug. Requires build-time `OUT_DIR` path.
#[derive(Copy, Clone)]
pub enum RuntimeEmbedRoot {
    Codegen,
    Src,
    SrcEager,
    CodegenEager,
}

#[inline]
#[cfg(windows)]
pub const fn mark_windows_only() {}
#[inline]
#[cfg(not(windows))]
pub fn mark_windows_only() -> ! {
    panic!("Assertion failure: this function should only be accessible on Windows.");
}

#[inline]
#[cfg(unix)]
pub const fn mark_posix_only() {}
#[inline]
#[cfg(not(unix))]
pub fn mark_posix_only() -> ! {
    panic!("Assertion failure: this function should only be accessible on POSIX.");
}

#[cfg(target_os = "linux")]
pub fn linux_kernel_version() -> bun_semver::Version {
    bun_analytics::GenerateHeader::GeneratePlatform::kernel_version()
}

// ─── selfExePath ──────────────────────────────────────────────────────────────
pub use bun_core::self_exe_path;

#[cfg(windows)]
pub const exe_suffix: &str = ".exe";
#[cfg(not(windows))]
pub const exe_suffix: &str = "";

pub use spawn::sync::spawn as spawnSync;

pub struct SliceIterator<'a, T> {
    pub items: &'a [T],
    pub index: usize,
}
impl<'a, T: Copy> SliceIterator<'a, T> {
    pub fn init(items: &'a [T]) -> Self {
        Self { items, index: 0 }
    }
    pub fn next(&mut self) -> Option<T> {
        if self.index >= self.items.len() {
            return None;
        }
        let v = self.items[self.index];
        self.index += 1;
        Some(v)
    }
}

// TODO: migrate
pub use bun_alloc::Arena as ArenaAllocator;

// ─── assertions ───────────────────────────────────────────────────────────────
const ASSERTION_FAILURE_MSG: &str = "Internal assertion failure";

#[cold]
#[inline(never)]
fn assertion_failure() -> ! {
    Output::panic(format_args!("{}", ASSERTION_FAILURE_MSG));
}

#[cold]
#[inline(never)]
fn assertion_failure_at_location(src: &core::panic::Location<'_>) -> ! {
    Output::panic(format_args!(
        "{} at {}:{}:{}",
        ASSERTION_FAILURE_MSG,
        src.file(),
        src.line(),
        src.column()
    ));
}

#[cold]
#[inline(never)]
fn assertion_failure_with_msg(args: core::fmt::Arguments<'_>) -> ! {
    Output::panic(format_args!("{}: {}", ASSERTION_FAILURE_MSG, args));
}

/// Like `assert`, but checks only run in debug builds.
#[inline(always)]
pub fn debug_assert(cheap_value_only_plz: bool) {
    if !cfg!(debug_assertions) {
        return;
    }
    if !cheap_value_only_plz {
        unreachable!(); // ASSERTION FAILURE
    }
}

/// Asserts that some condition holds. Stripped in release builds.
#[inline(always)]
pub fn assert(ok: bool) {
    if !cfg!(debug_assertions) {
        // TODO(port): Environment.allow_assert may differ from debug_assertions
        return;
    }
    if !ok {
        if cfg!(debug_assertions) {
            unreachable!(); // ASSERTION FAILURE
        }
        assertion_failure();
    }
}

/// Asserts with a formatted message. Stripped in release builds.
#[inline(always)]
pub fn assertf(ok: bool, args: core::fmt::Arguments<'_>) {
    if !cfg!(debug_assertions) {
        return;
    }
    if !ok {
        assertion_failure_with_msg(args);
    }
}

/// Asserts that some condition holds. Not stripped in any build mode.
#[inline(always)]
pub fn release_assert(ok: bool, args: core::fmt::Arguments<'_>) {
    if !ok {
        #[cold]
        fn cold(args: core::fmt::Arguments<'_>) -> ! {
            Output::panic(format_args!("{}: {}", ASSERTION_FAILURE_MSG, args));
        }
        cold(args);
    }
}

#[inline(always)]
#[track_caller]
pub fn assert_with_location(value: bool) {
    if !cfg!(debug_assertions) {
        return;
    }
    if !value {
        if cfg!(debug_assertions) {
            unreachable!();
        }
        assertion_failure_at_location(core::panic::Location::caller());
    }
}

#[inline]
pub fn assert_eql<T: PartialEq + core::fmt::Debug>(a: T, b: T) {
    if a == b {
        return;
    }
    if !cfg!(debug_assertions) {
        return;
    }
    Output::panic(format_args!("Assertion failure."));
}

#[inline(always)]
pub fn assert_neql<T: PartialEq>(a: T, b: T) {
    assert(a != b);
}

#[inline(always)]
pub fn unsafe_assert(condition: bool) {
    if !condition {
        // SAFETY: caller guarantees condition holds
        unsafe { core::hint::unreachable_unchecked() };
    }
}

// ─── time ─────────────────────────────────────────────────────────────────────
// PERF(port): was comptime enum monomorphization — profile in Phase B
pub fn get_rough_tick_count(mock_mode: TimespecMockMode) -> timespec {
    if matches!(mock_mode, TimespecMockMode::AllowMockedTime) {
        if let Some(fake_time) =
            bun_jsc::Jest::bun_test::FakeTimers::current_time().get_timespec_now()
        {
            return fake_time;
        }
    }
    let ns_value = hw_timer::now_ns();
    timespec {
        sec: i64::try_from(ns_value / NS_PER_S).expect("int cast"),
        nsec: i64::try_from(ns_value % NS_PER_S).expect("int cast"),
    }
}

/// Monotonic milliseconds. Values are only meaningful relative to other calls.
// PERF(port): was comptime enum monomorphization — profile in Phase B
pub fn get_rough_tick_count_ms(mock_mode: TimespecMockMode) -> u64 {
    if matches!(mock_mode, TimespecMockMode::AllowMockedTime) {
        if let Some(fake_time) =
            bun_jsc::Jest::bun_test::FakeTimers::current_time().get_timespec_now()
        {
            return fake_time.ns() / NS_PER_MS;
        }
    }
    hw_timer::now_ms()
}

const NS_PER_S: u64 = 1_000_000_000;
use bun_core::time::NS_PER_MS;
const MS_PER_S: i64 = 1_000;

#[derive(Copy, Clone)]
pub struct MaybeMockedTimespec {
    pub mocked: u64,
    pub timespec: timespec,
}
impl MaybeMockedTimespec {
    pub const EPOCH: MaybeMockedTimespec =
        MaybeMockedTimespec { mocked: 0, timespec: timespec::EPOCH };
    pub fn eql(&self, other: &MaybeMockedTimespec) -> bool {
        self.mocked == other.mocked && self.timespec.eql(&other.timespec)
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
#[allow(non_camel_case_types)]
pub struct timespec {
    pub sec: i64,
    pub nsec: i64,
}

// PORT NOTE: reshaped — Zig nested `MockMode` inside `timespec`; Rust can't
// declare an enum inside an inherent impl. Use `timespec::MockMode` via this
// path-aliased module trick in Phase B, or reference `TimespecMockMode` directly.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum TimespecMockMode {
    AllowMockedTime,
    ForceRealTime,
}

impl timespec {
    pub const EPOCH: timespec = timespec { sec: 0, nsec: 0 };
    pub type MockMode = TimespecMockMode;
    // TODO(port): inherent associated types are unstable; Phase B may move to a
    // `mod timespec { pub struct timespec; pub enum MockMode; }` layout.

    pub fn eql(&self, other: &timespec) -> bool {
        self.sec == other.sec && self.nsec == other.nsec
    }

    // TODO: this is wrong!
    pub fn duration(&self, other: &timespec) -> timespec {
        let mut sec_diff = self.sec.wrapping_sub(other.sec);
        let mut nsec_diff = self.nsec.wrapping_sub(other.nsec);
        if nsec_diff < 0 {
            sec_diff = sec_diff.wrapping_sub(1);
            nsec_diff = nsec_diff.wrapping_add(NS_PER_S as i64);
        }
        timespec { sec: sec_diff, nsec: nsec_diff }
    }

    pub fn order(&self, b: &timespec) -> core::cmp::Ordering {
        match self.sec.cmp(&b.sec) {
            core::cmp::Ordering::Equal => self.nsec.cmp(&b.nsec),
            o => o,
        }
    }

    pub fn ns(&self) -> u64 {
        if self.sec <= 0 {
            return u64::try_from(self.nsec.max(0)).expect("int cast");
        }
        debug_assert!(self.sec >= 0);
        debug_assert!(self.nsec >= 0);
        let s_ns = match u64::try_from(self.sec.max(0)).expect("int cast").checked_mul(NS_PER_S) {
            Some(v) => v,
            None => return u64::MAX,
        };
        match s_ns.checked_add(u64::try_from(self.nsec.max(0)).expect("int cast")) {
            Some(v) => v,
            None => i64::MAX as u64,
        }
    }

    pub fn ns_signed(&self) -> i64 {
        let ns_per_sec = self.sec.wrapping_mul(NS_PER_S as i64);
        let ns_from_nsec = self.nsec.div_euclid(1_000_000);
        ns_per_sec.wrapping_add(ns_from_nsec)
    }

    pub fn ms(&self) -> i64 {
        let ms_from_sec = self.sec.wrapping_mul(1000);
        let ms_from_nsec = self.nsec.div_euclid(1_000_000);
        ms_from_sec.wrapping_add(ms_from_nsec)
    }

    pub fn ms_unsigned(&self) -> u64 {
        self.ns() / NS_PER_MS
    }

    pub fn greater(&self, b: &timespec) -> bool {
        self.order(b) == core::cmp::Ordering::Greater
    }

    // PERF(port): was comptime enum monomorphization — profile in Phase B
    pub fn now(mock_mode: TimespecMockMode) -> timespec {
        get_rough_tick_count(mock_mode)
    }

    // PERF(port): was comptime enum monomorphization — profile in Phase B
    pub fn since_now(&self, mock_mode: TimespecMockMode) -> u64 {
        Self::now(mock_mode).duration(self).ns()
    }

    pub fn add_ms(&self, interval: i64) -> timespec {
        let sec_inc = interval / MS_PER_S;
        let nsec_inc = (interval % MS_PER_S) * NS_PER_MS as i64;
        let mut t = *self;
        t.sec = t.sec.wrapping_add(sec_inc);
        t.nsec = t.nsec.wrapping_add(nsec_inc);
        if t.nsec >= NS_PER_S as i64 {
            t.sec = t.sec.wrapping_add(1);
            t.nsec = t.nsec.wrapping_sub(NS_PER_S as i64);
        }
        t
    }

    pub fn add_ms_float(&self, interval_ms: f64) -> timespec {
        let ns_per_ms_f = NS_PER_MS as f64;
        let mut t = *self;
        let ms_whole_f = interval_ms.floor();
        let ms_inc: i64 = ms_whole_f as i64; // lossyCast
        let ns_total_f = interval_ms * ns_per_ms_f;
        let ns_remainder_f = ns_total_f.rem_euclid(ns_per_ms_f);
        let nsec_inc: i64 = ns_remainder_f.floor() as i64;
        let sec_inc = ms_inc / MS_PER_S;
        let ms_remainder = ms_inc.rem_euclid(MS_PER_S);
        t.sec = t.sec.wrapping_add(sec_inc);
        t.nsec = t.nsec.wrapping_add(ms_remainder * NS_PER_MS as i64 + nsec_inc);
        if t.nsec >= NS_PER_S as i64 {
            t.sec = t.sec.wrapping_add(1);
            t.nsec = t.nsec.wrapping_sub(NS_PER_S as i64);
        } else if t.nsec < 0 {
            t.sec = t.sec.wrapping_sub(1);
            t.nsec = t.nsec.wrapping_add(NS_PER_S as i64);
        }
        t
    }

    // PERF(port): was comptime enum monomorphization — profile in Phase B
    pub fn ms_from_now(mock_mode: TimespecMockMode, interval: i64) -> timespec {
        Self::now(mock_mode).add_ms(interval)
    }

    pub fn min(a: timespec, b: timespec) -> timespec {
        if a.order(&b) == core::cmp::Ordering::Less { a } else { b }
    }
    pub fn max(a: timespec, b: timespec) -> timespec {
        if a.order(&b) == core::cmp::Ordering::Greater { a } else { b }
    }
    pub fn order_ignore_epoch(a: timespec, b: timespec) -> core::cmp::Ordering {
        if a.eql(&b) {
            return core::cmp::Ordering::Equal;
        }
        if a.eql(&Self::EPOCH) {
            return core::cmp::Ordering::Greater;
        }
        if b.eql(&Self::EPOCH) {
            return core::cmp::Ordering::Less;
        }
        a.order(&b)
    }
    pub fn min_ignore_epoch(a: timespec, b: timespec) -> timespec {
        if Self::order_ignore_epoch(a, b) == core::cmp::Ordering::Less { a } else { b }
    }
}

// ─── Ordinal ──────────────────────────────────────────────────────────────────
/// An abstract number of element in a sequence.
// TODO(port): OrdinalT used `enum(Int)` with named variants; Rust uses a newtype.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct OrdinalT<Int>(pub Int);

macro_rules! impl_ordinal {
    ($($t:ty: $invalid:expr),*) => {$(
        impl OrdinalT<$t> {
            pub const INVALID: Self = Self($invalid);
            pub const START: Self = Self(0);
            #[inline] pub fn from_zero_based(int: $t) -> Self {
                debug_assert!(int as i128 >= 0);
                debug_assert!(int != $invalid);
                Self(int)
            }
            #[inline] pub fn from_one_based(int: $t) -> Self {
                debug_assert!(int as i128 > 0);
                Self(int - 1)
            }
            #[inline] pub fn zero_based(self) -> $t { self.0 }
            #[inline] pub fn one_based(self) -> $t { self.0 + 1 }
            #[inline] pub fn add(self, b: Self) -> Self {
                Self::from_zero_based(self.zero_based() + b.zero_based())
            }
            #[inline] pub fn add_scalar(self, inc: $t) -> Self {
                Self::from_zero_based(self.zero_based() + inc)
            }
            #[inline] pub fn is_valid(self) -> bool { (self.zero_based() as i128) >= 0 }
        }
    )*};
}
impl_ordinal!(c_int: -1, u32: u32::MAX, i32: -1);

/// ABI-equivalent of WTF::OrdinalNumber
pub type Ordinal = OrdinalT<c_int>;

pub fn memmove(output: &mut [u8], input: &[u8]) {
    if output.is_empty() {
        return;
    }
    // Rust's borrow rules forbid `&mut [u8]`/`&[u8]` overlap; memmove ⇒ memcpy.
    output[..input.len()].copy_from_slice(input);
}

/// like std.enums.tagName, except it doesn't lose the sentinel value.
// TODO(port): tagName — use `strum::IntoStaticStr` derive on the enum instead.

pub fn get_total_memory_size() -> usize {
    // SAFETY: FFI call into bun cpp bindings, no invariants required
    unsafe { cpp::Bun__ramSize() }
}

pub const bytecode_extension: &str = ".jsc";

#[inline]
pub fn split_at_mut<T>(slice: &mut [T], mid: usize) -> (&mut [T], &mut [T]) {
    debug_assert!(mid <= slice.len());
    slice.split_at_mut(mid)
}

/// Reverse of the slice index operator.
pub fn index_of_pointer_in_slice<T>(slice: &[T], item: &T) -> usize {
    debug_assert!(isSliceInBufferT(core::slice::from_ref(item), slice));
    let offset = (core::ptr::from_ref::<T>(item) as usize) - (slice.as_ptr() as usize);
    offset / core::mem::size_of::<T>()
}

pub use bun_core::get_thread_count;

// ─── Once ─────────────────────────────────────────────────────────────────────
pub use bun_core::Once;

/// Takes the value out of an Option, replacing it with None.
#[inline]
pub fn take<T>(val: &mut Option<T>) -> Option<T> {
    val.take()
}

/// Deinitializes the value and sets the optional to None.
#[inline]
pub fn clear<T>(val: &mut Option<T>) {
    *val = None; // Drop handles deinit
}

#[inline]
pub fn move_<T: Default>(val: &mut T) -> T {
    core::mem::take(val)
}

#[inline]
pub fn wrapping_negation<T: core::ops::Neg<Output = T> + num_traits::WrappingSub + Default>(
    val: T,
) -> T {
    T::default().wrapping_sub(&val)
}

// assertNoPointers — comptime-only check; Rust has no equivalent. Use
// `#[derive(bytemuck::NoUninit)]` or static asserts at the type instead.
// TODO(port): assertNoPointers — bytemuck bound

#[inline]
pub fn write_any_to_hasher<T: bytemuck::NoUninit>(hasher: &mut impl core::hash::Hasher, thing: &T) {
    hasher.write(bytemuck::bytes_of(thing));
}

// isComptimeKnown — no Rust equivalent (always false at runtime).
#[inline]
pub const fn is_comptime_known<T>(_x: &T) -> bool {
    false
}

#[inline]
pub fn item_or_null<T: Copy>(slice: &[T], index: usize) -> Option<T> {
    slice.get(index).copied()
}

// ─── StackCheck ───────────────────────────────────────────────────────────────
pub use bun_core::StackCheck;

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum StackOverflow {
    #[error("StackOverflow")]
    StackOverflow,
}

#[cold]
#[inline(never)]
pub fn throw_stack_overflow() -> Result<(), StackOverflow> {
    Err(StackOverflow::StackOverflow)
}

/// Zero memory before freeing sensitive data.
pub use bun_alloc::free_sensitive;

#[cfg(target_os = "macos")]
pub type mach_port = libc::mach_port_t;
#[cfg(not(target_os = "macos"))]
pub type mach_port = u32;

/// Automatically generated C++ bindings for functions marked with `[[ZIG_EXPORT(...)]]`
pub use bun_cpp_sys as cpp;

pub fn contains<T: PartialEq + Copy>(item: T, list: &Vec<T>) -> bool {
    // TODO(port): u8 specialization → bun_str::strings::contains_char
    list.iter().any(|&x| x == item)
}

// Export function to check if --use-system-ca flag is set
#[bun_jsc::host_fn]
pub fn get_use_system_ca(
    _global: &bun_jsc::JSGlobalObject,
    _frame: &bun_jsc::CallFrame,
) -> bun_jsc::JsResult<bun_jsc::JSValue> {
    Ok(bun_jsc::JSValue::from(
        bun_runtime::cli::Arguments::Bun__Node__UseSystemCA
            .load(core::sync::atomic::Ordering::Relaxed),
    ))
}

// ported from: src/bun.zig
