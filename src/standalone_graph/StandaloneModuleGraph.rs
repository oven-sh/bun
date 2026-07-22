//! Originally, we tried using LIEF to inject the module graph into a MachO segment
//! But this incurred a fixed 350ms overhead on every build, which is unacceptable
//! so we give up on codesigning support on macOS for now until we can find a better solution

use core::mem::size_of;
use core::ptr::NonNull;
use std::io::Write as _;
use std::sync::Arc;

use bun_ast::Loader;
use bun_bundler::options::{self, OutputFile};
use bun_collections::StringArrayHashMap;
use bun_core::{Environment, Output};
use bun_core::{String as BunString, StringPointer, ZStr};
use bun_exe_format::{elf as bun_elf, macho as bun_macho, pe as bun_pe};
use bun_options_types::bundle_enums::{Format, WindowsOptions};
#[cfg(not(windows))]
use bun_paths::SEP_STR;
use bun_paths::fs as bun_fs;
use bun_paths::{self as path, PathBuffer, strings};
#[cfg(windows)]
use bun_paths::{OSPathBuffer, WPathBuffer};
use bun_sourcemap as SourceMap;
use bun_sys::{self as Syscall, Fd, FdExt as _, Stat};

bun_core::declare_scope!(StandaloneModuleGraph, hidden);

// `bun_webcore::Blob` lives in a higher tier and `cached_blob` is only ever
// set from `bun_runtime`, so it is modeled as an opaque erased pointer here.
bun_opaque::opaque_ffi! {
    /// Opaque stand-in for `bun_webcore::Blob`. Only stored as `NonNull<Blob>`.
    pub struct Blob;
}

pub struct StandaloneModuleGraph {
    /// Raw view over the serialized graph (`[0, offsets.byte_count)`). Stored as a
    /// raw fat pointer — NOT `&'static [u8]` — because `byte_count` covers the
    /// bytecode/module_info subranges that JSC mutates in place via
    /// `File.bytecode`. Holding a `&'static [u8]` over those bytes would freeze
    /// them under Stacked/Tree Borrows and make the later foreign write UB.
    pub bytes: *const [u8],
    pub files: StringArrayHashMap<File>,
    pub entry_point_id: u32,
    pub compile_exec_argv: &'static [u8],
    pub flags: Flags,
}

// We never want to hit the filesystem for these files
// We use the `/$bunfs/` prefix to indicate that it's a virtual path
// It is `/$bunfs/` because:
//
// - `$` makes it unlikely to collide with a real path
// - `/$bunfs/` is 8 characters which is fast to compare for 64-bit CPUs
#[cfg(not(windows))]
pub const BASE_PATH: &str = "/$bunfs/";
// Special case for windows because of file URLs being invalid
// if they do not have a drive letter. B drive because 'bun' but
// also because it's more unlikely to collide with a real path.
#[cfg(windows)]
pub const BASE_PATH: &str = "B:\\~BUN\\";

// Rust cannot const-concat with a runtime enum branch nor across a `const fn`
// boundary, so the two call-site combinations are materialized directly with
// `const_format::concatcp!`.
#[cfg(windows)]
pub const BASE_PUBLIC_PATH: &str = "B:/~BUN/";
#[cfg(not(windows))]
pub const BASE_PUBLIC_PATH: &str = "/$bunfs/";

#[cfg(windows)]
pub const BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX: &str = const_format::concatcp!("B:/~BUN/", "root/");
#[cfg(not(windows))]
pub const BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX: &str = const_format::concatcp!("/$bunfs/", "root/");

// A process-lifetime `OnceLock` (PORTING.md §Concurrency: never `static mut`).
// `get()` returns a raw `*mut`; callers
// mutate `wtf_string` / `cached_blob` / `sourcemap` lazily. A future reshape
// could push interior mutability down to those per-`File` fields (`UnsafeCell<…>`)
// so read-only paths (`find`, `entry_point`, `stat`) can take `&self`.
struct Instance(core::cell::UnsafeCell<StandaloneModuleGraph>);
// SAFETY: the graph is populated once at startup before any worker threads;
// post-init mutation is limited to per-`File` lazy fields. NOTE: `INIT_LOCK`
// only guards `LazySourceMap::load`; `File::to_wtf_string` and `cached_blob`
// mutate without any lock and rely on idempotence + JSC's own synchronization.
// (`Send` is auto-derived: `UnsafeCell<T: Send>` is `Send`.)
unsafe impl Sync for Instance {}

static INSTANCE: std::sync::OnceLock<Instance> = std::sync::OnceLock::new();

impl StandaloneModuleGraph {
    pub fn get() -> Option<*mut StandaloneModuleGraph> {
        // A raw pointer with no uniqueness invariant. Do NOT hand out
        // `&'static mut` here — multiple
        // callers (resolver, sourcemap loader, worker threads) may hold the
        // result concurrently, and overlapping `&mut` is UB regardless of
        // whether either side writes.
        INSTANCE.get().map(|cell| cell.0.get())
    }

    pub fn set(instance: StandaloneModuleGraph) -> *mut StandaloneModuleGraph {
        let _ = INSTANCE.set(Instance(core::cell::UnsafeCell::new(instance)));
        INSTANCE.get().unwrap().0.get()
    }
}

// A runtime `suffix: &[u8]` parameter cannot be
// const-concatenated. All callers pass either `""` or `"root/"`, so the runtime
// variant special-cases those two literals (`unreachable!` guards anything new).
pub fn target_base_public_path(
    target: bun_core::Environment::OperatingSystem,
    suffix: &'static [u8],
) -> &'static [u8] {
    match target {
        bun_core::Environment::OperatingSystem::Windows => match suffix {
            b"" => b"B:/~BUN/",
            b"root/" => b"B:/~BUN/root/",
            _ => unreachable!("target_base_public_path: unsupported suffix literal"),
        },
        _ => match suffix {
            b"" => b"/$bunfs/",
            b"root/" => b"/$bunfs/root/",
            _ => unreachable!("target_base_public_path: unsupported suffix literal"),
        },
    }
}

pub(crate) fn is_bun_standalone_file_path_canonicalized(str_: &[u8]) -> bool {
    str_.starts_with(BASE_PATH.as_bytes())
        || (cfg!(windows) && str_.starts_with(BASE_PUBLIC_PATH.as_bytes()))
}

pub fn is_bun_standalone_file_path(str_: &[u8]) -> bool {
    #[cfg(windows)]
    {
        // On Windows, remove NT path prefixes before checking
        let canonicalized = strings::paths::without_nt_prefix::<u8>(str_);
        return is_bun_standalone_file_path_canonicalized(canonicalized);
    }
    #[cfg(not(windows))]
    {
        is_bun_standalone_file_path_canonicalized(str_)
    }
}

impl StandaloneModuleGraph {
    // Callers mutate `wtf_string` / `cached_blob`, so these accessors take
    // `&mut self`. Switching to `UnsafeCell` per-`File`
    // fields would let read-only paths take `&self`; see the `Instance` note above.
    pub fn entry_point(&mut self) -> &mut File {
        &mut self.files.values_mut()[self.entry_point_id as usize]
    }

    // by normalized file path
    pub fn find(&mut self, name: &[u8]) -> Option<&mut File> {
        if !is_bun_standalone_file_path(name) {
            return None;
        }
        self.find_assume_standalone_path(name)
    }

    pub fn stat(&mut self, name: &[u8]) -> Option<Stat> {
        let file = self.find(name)?;
        Some(file.stat())
    }

    pub fn find_assume_standalone_path(&mut self, name: &[u8]) -> Option<&mut File> {
        #[cfg(windows)]
        {
            let mut normalized_buf = PathBuffer::uninit();
            let input = strings::paths::without_nt_prefix::<u8>(name);
            let normalized =
                path::resolve_path::platform_to_posix_buf::<u8>(input, &mut normalized_buf);
            return self.files.get_mut(normalized);
        }
        #[cfg(not(windows))]
        {
            self.files.get_mut(name)
        }
    }
}

// SAFETY: the graph is the process-global INSTANCE singleton (set once at
// startup, never freed). The raw-pointer / `Cell` fields it carries are
// `bun_runtime`-owned caches (`cached_blob`, `wtf_string`, source-map state)
// that are only ever touched from the JS main thread under the API lock; the
// resolver-facing read path below touches none of them. The graph pointer is
// shared across worker threads through the resolver, which is why the
// `Send + Sync` supertrait on `bun_resolver::StandaloneModuleGraph` must be
// satisfied.
unsafe impl Send for StandaloneModuleGraph {}
// SAFETY: see `Send` impl — post-init mutation is confined to per-`File` lazy caches on the JS thread.
unsafe impl Sync for StandaloneModuleGraph {}

/// Resolver-facing trait object impl. The resolver and VM hold the graph as
/// `&'static dyn bun_resolver::StandaloneModuleGraph` so they stay below
/// `bun_standalone_graph` in the dep graph; this is the sole implementor.
///
/// The trait surface is read-only (`&self`) — the resolver only needs to
/// answer "is `name` an embedded module?" and hand back the canonical name
/// slice; the `&mut`-returning inherent methods above stay for the runtime's
/// blob/sourcemap caching path.
impl bun_resolver::StandaloneModuleGraph for StandaloneModuleGraph {
    fn find_assume_standalone_path(&self, name: &[u8]) -> Option<&[u8]> {
        #[cfg(windows)]
        let file = {
            let mut normalized_buf = PathBuffer::uninit();
            let input = strings::paths::without_nt_prefix::<u8>(name);
            let normalized =
                path::resolve_path::platform_to_posix_buf::<u8>(input, &mut normalized_buf);
            self.files.get(normalized)
        };
        #[cfg(not(windows))]
        let file = self.files.get(name);
        file.map(|f| f.name)
    }

    fn find(&self, name: &[u8]) -> Option<&[u8]> {
        if !is_bun_standalone_file_path(name) {
            return None;
        }
        <Self as bun_resolver::StandaloneModuleGraph>::find_assume_standalone_path(self, name)
    }

    fn base_public_path_with_default_suffix(&self) -> &'static [u8] {
        BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes()
    }

    fn compile_exec_argv(&self) -> &[u8] {
        self.compile_exec_argv
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct CompiledModuleGraphFile {
    pub name: StringPointer,
    pub contents: StringPointer,
    pub sourcemap: StringPointer,
    pub bytecode: StringPointer,
    pub module_info: StringPointer,
    /// The file path used when generating bytecode (e.g., "B:/~BUN/root/app.js").
    /// Must match exactly at runtime for bytecode cache hits.
    pub bytecode_origin_path: StringPointer,
    pub encoding: Encoding,
    pub loader: Loader,
    pub module_format: ModuleFormat,
    pub side: FileSide,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum FileSide {
    #[default]
    Server = 0,
    Client = 1,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Encoding {
    Binary = 0,
    #[default]
    Latin1 = 1,
    // Not used yet.
    Utf8 = 2,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum ModuleFormat {
    #[default]
    None = 0,
    Esm = 1,
    Cjs = 2,
}

#[cfg(target_os = "macos")]
mod macho {
    // Declared inline rather than in a dedicated `*_sys` crate: this crate is
    // the symbol's only consumer.
    unsafe extern "C" {
        pub(super) fn Bun__getStandaloneModuleGraphMachoLength() -> *mut u64; // possibly unaligned
    }

    /// Returns `(base, len)` for the embedded `__BUN` section data. Kept as a
    /// raw `*mut u8` so the FFI write-provenance is preserved end-to-end —
    /// collapsing to `&[u8]` here would freeze it to read-only and make the
    /// later `from_bytes` writable subslices UB under Stacked Borrows.
    pub(super) fn get_data() -> Option<(*mut u8, usize)> {
        // SAFETY: FFI call returns pointer to embedded section header or null.
        let length_ptr = unsafe { Bun__getStandaloneModuleGraphMachoLength() };
        if length_ptr.is_null() {
            return None;
        }
        // SAFETY: pointer is valid if non-null; read unaligned u64.
        let length = unsafe { core::ptr::read_unaligned(length_ptr) };
        if length < 8 {
            return None;
        }
        // BlobHeader has 8 bytes size (u64), so data starts at offset 8.
        let data_offset = core::mem::size_of::<u64>();
        let slice_ptr = length_ptr.cast::<u8>();
        // SAFETY: section data is `length` bytes immediately following the u64 header.
        Some((unsafe { slice_ptr.add(data_offset) }, length as usize))
    }
}

#[cfg(windows)]
mod pe {
    use bun_exe_format::pe::{
        Bun__getStandaloneModuleGraphPEData, Bun__getStandaloneModuleGraphPELength,
    };

    /// Returns `(base, len)` for the embedded `.bun` PE section data. Kept as a
    /// raw `*mut u8` so the FFI write-provenance is preserved end-to-end —
    /// collapsing to `&[u8]` here would freeze it to read-only and make the
    /// later `from_bytes` writable subslices UB under Stacked Borrows.
    pub(super) fn get_data() -> Option<(*mut u8, usize)> {
        // SAFETY: FFI calls.
        let length = unsafe { Bun__getStandaloneModuleGraphPELength() };
        if length == 0 {
            return None;
        }
        // SAFETY: FFI call returning a process-lifetime section pointer (or null).
        let data_ptr = unsafe { Bun__getStandaloneModuleGraphPEData() };
        if data_ptr.is_null() {
            return None;
        }
        // data_ptr points to `length` bytes of section data valid for program lifetime.
        Some((data_ptr, length as usize))
    }
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
mod elf {
    // Declared inline rather than in a dedicated `*_sys` crate: this crate is
    // the symbol's only consumer.
    unsafe extern "C" {
        pub(super) fn Bun__getStandaloneModuleGraphELFVaddr() -> *mut u64; // align(1)
    }

    /// Returns `(base, len)` for the embedded ELF segment data. Kept as a raw
    /// `*mut u8` so write-provenance is preserved end-to-end — collapsing to
    /// `&[u8]` here would freeze it to read-only and make the later
    /// `from_bytes` writable subslices UB under Stacked Borrows.
    pub(super) fn get_data() -> Option<(*mut u8, usize)> {
        // SAFETY: FFI call.
        let vaddr_ptr = unsafe { Bun__getStandaloneModuleGraphELFVaddr() };
        if vaddr_ptr.is_null() {
            return None;
        }
        // SAFETY: read unaligned u64 vaddr.
        let vaddr = unsafe { core::ptr::read_unaligned(vaddr_ptr) };
        if vaddr == 0 {
            return None;
        }
        // BUN_COMPILED.size holds the virtual address of the appended data.
        // The kernel mapped it via PT_LOAD, so we can dereference directly.
        // Format at target: [u64 payload_len][payload bytes]
        // Synthesize a `*mut u8` directly so the provenance carries write
        // permission for the in-place bytecode mutation done by JSC.
        let target = vaddr as *mut u8;
        // SAFETY: target points to 8-byte little-endian length prefix.
        let payload_len =
            u64::from_le_bytes(unsafe { core::ptr::read_unaligned(target.cast::<[u8; 8]>()) });
        if payload_len < 8 {
            return None;
        }
        // SAFETY: payload_len bytes follow the 8-byte header at `target`.
        Some((unsafe { target.add(8) }, payload_len as usize))
    }
}

/// Called as the very first statement in `main()` on ELF targets, before any
/// other global is read or written. `bun build --compile` grows the writable
/// PT_LOAD segment so the appended module graph (and the zero-fill that
/// replaces the former BSS hole) is file-backed. The kernel's ELF loader maps
/// that full `p_filesz` range whether or not the file on disk is long enough,
/// so a truncated download still executes; the first touch of a page past EOF
/// then delivers SIGBUS. Once the crash handler is up, that surfaces as a
/// "panic: Bus error ... oh no: Bun has crashed" banner misattributing the
/// user's incomplete file to a Bun bug.
///
/// Running this check later (e.g. inside `from_executable`) is too late: the
/// now-file-backed BSS tail may itself be past EOF, so any startup path that
/// happens to touch a global placed there faults first. This function is
/// therefore restricted to stack storage, `.rodata` literals, and raw `libc`
/// syscalls, and it runs before `bun_crash_handler::init`, `Output`, argv
/// capture, or anything else that reaches into mutable globals.
///
/// Best-effort: on systems without `/proc` the check degrades to a no-op
/// rather than blocking startup. A plain `bun` (non-standalone) binary has
/// `BUN_COMPILED.size == 0` and returns immediately without any syscall.
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
pub fn exit_early_if_self_exe_truncated() {
    // `BUN_COMPILED` sits in the original `.bun` section in the middle of the
    // RW segment (between `.init_array` and `.data.rel.ro`), not in the
    // appended tail, so this read is safe regardless of truncation.
    // SAFETY: FFI call returning a process-lifetime pointer (or null).
    let vaddr_ptr = unsafe { elf::Bun__getStandaloneModuleGraphELFVaddr() };
    if vaddr_ptr.is_null() {
        return;
    }
    // SAFETY: pointer is non-null; read unaligned u64.
    if unsafe { core::ptr::read_unaligned(vaddr_ptr) } == 0 {
        return;
    }
    exit_early_if_self_exe_truncated_cold();
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
#[inline(always)]
pub fn exit_early_if_self_exe_truncated() {}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
#[cold]
#[inline(never)]
fn exit_early_if_self_exe_truncated_cold() {
    use core::mem::MaybeUninit;

    const PT_LOAD: u32 = 1;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    let path = b"/proc/self/exe\0";
    #[cfg(target_os = "freebsd")]
    let path = b"/proc/curproc/file\0";

    // SAFETY: `path` is a NUL-terminated literal.
    let fd = unsafe { libc::open(path.as_ptr().cast(), libc::O_RDONLY | libc::O_CLOEXEC) };
    if fd < 0 {
        return;
    }

    // SAFETY: zeroed `libc::stat` is valid; `fstat` writes to it.
    let mut st = unsafe { MaybeUninit::<libc::stat>::zeroed().assume_init() };
    // SAFETY: `fd` is open; `&mut st` is a valid out-pointer.
    let fstat_rc = unsafe { libc::fstat(fd, &raw mut st) };
    if fstat_rc != 0 || st.st_size < 0 {
        // SAFETY: `fd` is a valid owned descriptor.
        unsafe { libc::close(fd) };
        return;
    }
    let file_size = st.st_size as u64;

    let mut buf = [0u8; 4096];
    // SAFETY: `fd` is open for reading; `buf` is a valid writable buffer.
    let n = unsafe { libc::read(fd, buf.as_mut_ptr().cast(), buf.len()) };
    // SAFETY: `fd` is a valid owned descriptor.
    unsafe { libc::close(fd) };
    if n < 64 {
        return;
    }
    let data = &buf[..n as usize];

    // Minimal ELF64 LE parse: e_phoff/e_phentsize/e_phnum and, per phdr,
    // p_type/p_offset/p_filesz at their fixed offsets.
    if &data[0..4] != b"\x7fELF" || data[4] != 2 || data[5] != 1 {
        return;
    }
    let e_phoff = u64::from_le_bytes(data[32..40].try_into().unwrap());
    let e_phentsize = u16::from_le_bytes(data[54..56].try_into().unwrap()) as u64;
    let e_phnum = u16::from_le_bytes(data[56..58].try_into().unwrap()) as u64;
    let Some(table_end) = e_phnum
        .checked_mul(e_phentsize)
        .and_then(|t| e_phoff.checked_add(t))
    else {
        return;
    };
    if e_phentsize < 56 || table_end > data.len() as u64 {
        return;
    }

    let mut required: u64 = 0;
    let mut i: u64 = 0;
    while i < e_phnum {
        let off = (e_phoff + i * e_phentsize) as usize;
        let p_type = u32::from_le_bytes(data[off..off + 4].try_into().unwrap());
        if p_type == PT_LOAD {
            let p_offset = u64::from_le_bytes(data[off + 8..off + 16].try_into().unwrap());
            let p_filesz = u64::from_le_bytes(data[off + 32..off + 40].try_into().unwrap());
            if let Some(end) = p_offset.checked_add(p_filesz) {
                if end > required {
                    required = end;
                }
            }
        }
        i += 1;
    }

    if file_size >= required {
        return;
    }

    let mut msg = StackBuf::<256>::new();
    let _ = core::fmt::Write::write_fmt(
        &mut msg,
        format_args!(
            "error: This executable is incomplete: {} bytes on disk, but its load segments require at least {} bytes.\n\nnote: The file was likely truncated during download or copy. Re-download it and try again.\n",
            file_size, required,
        ),
    );
    // SAFETY: stderr (fd 2) is always writable; `msg` is a valid readable buffer.
    unsafe { libc::write(2, msg.as_ptr().cast(), msg.len()) };
    // SAFETY: `_exit` is async-signal-safe and never returns.
    unsafe { libc::_exit(1) };
}

/// Fixed-capacity stack buffer implementing `core::fmt::Write`. Used only by
/// `exit_early_if_self_exe_truncated_cold` so the error path stays off the
/// heap and away from `bun_core::Output` globals.
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
struct StackBuf<const N: usize> {
    buf: [u8; N],
    len: usize,
}
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
impl<const N: usize> StackBuf<N> {
    const fn new() -> Self {
        Self {
            buf: [0u8; N],
            len: 0,
        }
    }
    fn as_ptr(&self) -> *const u8 {
        self.buf.as_ptr()
    }
    fn len(&self) -> usize {
        self.len
    }
}
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
impl<const N: usize> core::fmt::Write for StackBuf<N> {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        let bytes = s.as_bytes();
        let remaining = N - self.len;
        let take = bytes.len().min(remaining);
        self.buf[self.len..self.len + take].copy_from_slice(&bytes[..take]);
        self.len += take;
        Ok(())
    }
}

pub struct File {
    pub name: &'static [u8],
    pub loader: Loader,
    pub contents: &'static ZStr,
    pub sourcemap: LazySourceMap,
    pub cached_blob: Option<NonNull<Blob>>,
    pub encoding: Encoding,
    pub wtf_string: BunString,
    // BACKREF into the embedded section; JSC mutates the bytecode buffer in place.
    pub bytecode: *mut [u8],
    pub module_info: *mut [u8],
    /// The file path used when generating bytecode (e.g., "B:/~BUN/root/app.js").
    /// Must match exactly at runtime for bytecode cache hits.
    pub bytecode_origin_path: &'static [u8],
    pub module_format: ModuleFormat,
    pub side: FileSide,
}

impl File {
    pub fn appears_in_embedded_files_array(&self) -> bool {
        self.side == FileSide::Client || !self.loader.is_javascript_like()
    }

    pub fn stat(&self) -> Stat {
        // SAFETY: all-zero is a valid `libc::stat` (POD `#[repr(C)]`).
        let mut result: Stat = unsafe { bun_core::ffi::zeroed_unchecked() };
        result.st_size = self.contents.len() as _;
        // `Stat` is `libc::stat` (POSIX) / `uv_stat_t` (Windows, `st_mode: u64`).
        result.st_mode = (libc::S_IFREG | 0o644) as _;
        result
    }

    pub fn less_than_by_index(ctx: &[File], lhs_i: u32, rhs_i: u32) -> bool {
        let lhs = &ctx[lhs_i as usize];
        let rhs = &ctx[rhs_i as usize];
        strings::cmp_strings_asc((), lhs.name, rhs.name)
    }

    pub fn to_wtf_string(&mut self) -> BunString {
        if self.wtf_string.is_empty() {
            match self.encoding {
                Encoding::Binary | Encoding::Utf8 => {
                    self.wtf_string = BunString::clone_utf8(self.contents.as_bytes());
                }
                Encoding::Latin1 => {
                    self.wtf_string =
                        BunString::create_static_external(self.contents.as_bytes(), true);
                }
            }
        }
        // We don't want this to free.
        self.wtf_string.dupe_ref()
    }
}

pub enum LazySourceMap {
    Serialized(SerializedSourceMap),
    Parsed(Arc<SourceMap::ParsedSourceMap>),
    None,
}

/// It probably is not possible to run two decoding jobs on the same file
// PORTING.md §Concurrency: `bun_threading::Guarded` for const-init statics.
static INIT_LOCK: bun_threading::Guarded<()> = bun_threading::Guarded::new(());

impl LazySourceMap {
    pub fn load(&mut self) -> Option<Arc<SourceMap::ParsedSourceMap>> {
        let _guard = INIT_LOCK.lock();

        match self {
            LazySourceMap::None => None,
            LazySourceMap::Parsed(map) => Some(Arc::clone(map)),
            LazySourceMap::Serialized(serialized) => {
                let Some(blob) = serialized.mapping_blob() else {
                    *self = LazySourceMap::None;
                    return None;
                };
                if !SourceMap::InternalSourceMap::is_valid_blob(blob) {
                    *self = LazySourceMap::None;
                    return None;
                }
                let ism = SourceMap::InternalSourceMap {
                    data: blob.as_ptr(),
                };
                // Note: `from_internal` fills `internal = Some(ism)` +
                // `input_line_count = ism.input_line_count()` and defaults the rest.
                let mut stored = SourceMap::ParsedSourceMap::from_internal(ism);

                let source_files_count = serialized.source_files_count();
                // PERF: `external_source_names` is `Vec<Box<[u8]>>` so we
                // copy the section bytes. Could switch
                // the field to `Vec<&'static [u8]>` for the standalone path.
                let mut file_names: Vec<Box<[u8]>> = Vec::with_capacity(source_files_count);
                let decompressed_contents_slice: Vec<std::sync::OnceLock<Vec<u8>>> =
                    std::iter::repeat_with(std::sync::OnceLock::new)
                        .take(source_files_count)
                        .collect();
                for i in 0..source_files_count {
                    // SAFETY: `serialized.bytes` is a 'static read-only sourcemap subrange
                    // (disjoint from bytecode); StringPointer offsets were serialized by
                    // `to_bytes` and are in-bounds.
                    file_names.push(Box::from(unsafe {
                        slice_to(
                            serialized.bytes.as_ptr(),
                            serialized.bytes.len(),
                            serialized.source_file_name(i),
                        )
                    }));
                }

                let data = Box::new(SerializedSourceMapLoaded {
                    map: SerializedSourceMap {
                        bytes: serialized.bytes,
                    },
                    decompressed_files: decompressed_contents_slice.into_boxed_slice(),
                });

                stored.external_source_names = file_names;
                // `from_provider` stores the pointer as a raw address in
                // `SourceContentPtr.data`; the provider dispatch is never
                // invoked for this type-punned pointer (guarded by
                // `is_standalone_module_graph`).
                stored.underlying_provider = SourceMap::SourceContentPtr::from_provider(
                    bun_core::heap::into_raw(data).cast::<SourceMap::SourceProviderMap>(),
                );
                stored.is_standalone_module_graph = true;

                let parsed = Arc::new(stored);
                // The Arc clone held in self keeps the parsed map alive.
                *self = LazySourceMap::Parsed(Arc::clone(&parsed));
                Some(parsed)
            }
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub(crate) struct Offsets {
    pub byte_count: usize,
    pub modules_ptr: StringPointer,
    pub entry_point_id: u32,
    pub compile_exec_argv_ptr: StringPointer,
    pub flags: Flags,
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u32 {
        const DISABLE_DEFAULT_ENV_FILES     = 1 << 0;
        const DISABLE_AUTOLOAD_BUNFIG       = 1 << 1;
        const DISABLE_AUTOLOAD_TSCONFIG     = 1 << 2;
        const DISABLE_AUTOLOAD_PACKAGE_JSON = 1 << 3;
        // _padding: u28
    }
}

const TRAILER: &[u8] = b"\n---- Bun! ----\n";

impl StandaloneModuleGraph {
    fn from_bytes(
        raw_ptr: *mut u8,
        raw_len: usize,
        offsets: Offsets,
    ) -> crate::Result<StandaloneModuleGraph> {
        if raw_len == 0 {
            return Ok(StandaloneModuleGraph {
                bytes: core::ptr::slice_from_raw_parts(NonNull::<u8>::dangling().as_ptr(), 0),
                files: StringArrayHashMap::new(),
                entry_point_id: 0,
                compile_exec_argv: b"",
                flags: Flags::default(),
            });
        }

        // This function hands out read-only subslices
        // (name/contents/sourcemap) AND writable subslices (bytecode/module_info, which JSC
        // mutates in place) into the same allocation. We must not derive the writable
        // ones from a `&[u8]` reborrow (writing through const-derived provenance is UB), and we
        // must not hold a long-lived `&[u8]` that *spans* a writable subrange (a foreign write
        // would invalidate it under Stacked/Tree Borrows). Keep `(raw_ptr, raw_len)` raw and
        // derive every read-only `&'static [u8]` per-call over its own disjoint subrange only;
        // the bytecode/module_info regions never have a shared reference formed over them.
        let raw_const: *const u8 = raw_ptr;

        // SAFETY: modules metadata blob is a read-only subrange of `[0, raw_len)` disjoint
        // from bytecode/module_info, serialized by `to_bytes`.
        let modules_list_bytes = unsafe { slice_to(raw_const, raw_len, offsets.modules_ptr) };
        // Note: the modules blob sits at an arbitrary byte offset in the section, and
        // `&[CompiledModuleGraphFile]` would require natural alignment (StringPointer's u32 fields
        // → 4-byte). We instead iterate by index and `read_unaligned` each fixed-size record into a
        // local (`CompiledModuleGraphFile` is `Copy`/POD), so no `&T` ever points at unaligned memory.
        let modules_list_count = modules_list_bytes.len() / size_of::<CompiledModuleGraphFile>();
        let modules_list_base = modules_list_bytes.as_ptr();

        if offsets.entry_point_id as usize > modules_list_count {
            return Err(crate::Error::CorruptedModuleGraphEntryPointIDIsGreaterThanModuleListCount);
        }

        let mut modules = StringArrayHashMap::<File>::new();
        modules.reserve(modules_list_count);
        for i in 0..modules_list_count {
            // SAFETY: index < count derived from byte length above; bytes live for 'static.
            let module: CompiledModuleGraphFile = unsafe {
                core::ptr::read_unaligned(
                    modules_list_base
                        .add(i * size_of::<CompiledModuleGraphFile>())
                        .cast::<CompiledModuleGraphFile>(),
                )
            };
            let module = &module;
            // SAFETY: each name/contents/sourcemap/bytecode_origin_path subrange is in-bounds
            // (serialized by `to_bytes`) and disjoint from the writable bytecode/module_info
            // subranges; section bytes are a live 'static allocation.
            let (name, contents, sourcemap_bytes, bytecode_origin) = unsafe {
                (
                    slice_to_z(raw_const, raw_len, module.name),
                    slice_to_z(raw_const, raw_len, module.contents),
                    slice_to(raw_const, raw_len, module.sourcemap),
                    slice_to_z(raw_const, raw_len, module.bytecode_origin_path),
                )
            };
            let _ = modules.put(
                name.as_bytes(),
                File {
                    name: name.as_bytes(),
                    loader: module.loader,
                    contents,
                    sourcemap: if module.sourcemap.length > 0 {
                        LazySourceMap::Serialized(SerializedSourceMap {
                            // `&[u8]` is align(1), and every structured read
                            // from these bytes (header / StringPointer tables)
                            // goes through `read_unaligned` in SerializedSourceMap.
                            bytes: sourcemap_bytes,
                        })
                    } else {
                        LazySourceMap::None
                    },
                    bytecode: if module.bytecode.length > 0 {
                        // SAFETY: section bytes are a writable 'static allocation; JSC mutates
                        // bytecode in place. Subrange is in-bounds (serialized by to_bytes) and
                        // disjoint from every read-only subslice handed out above — no
                        // `&[u8]` is ever formed over this range.
                        unsafe { slice_to_mut(raw_ptr, raw_len, module.bytecode) }
                    } else {
                        std::ptr::from_mut::<[u8]>(&mut [])
                    },
                    module_info: if module.module_info.length > 0 {
                        // SAFETY: see bytecode above.
                        unsafe { slice_to_mut(raw_ptr, raw_len, module.module_info) }
                    } else {
                        std::ptr::from_mut::<[u8]>(&mut [])
                    },
                    bytecode_origin_path: if module.bytecode_origin_path.length > 0 {
                        bytecode_origin.as_bytes()
                    } else {
                        b""
                    },
                    module_format: module.module_format,
                    side: module.side,
                    cached_blob: None,
                    encoding: module.encoding,
                    wtf_string: BunString::empty(),
                },
            );
        }

        modules.lock_pointers(); // make the pointers stable forever

        Ok(StandaloneModuleGraph {
            // Stored as a raw fat pointer — `byte_count` covers the writable
            // bytecode/module_info regions, so a `&'static [u8]` here would alias them.
            bytes: core::ptr::slice_from_raw_parts(raw_const, offsets.byte_count),
            files: modules,
            entry_point_id: offsets.entry_point_id,
            // SAFETY: read-only argv string subrange, disjoint from writable regions.
            compile_exec_argv: unsafe {
                slice_to_z(raw_const, raw_len, offsets.compile_exec_argv_ptr)
            }
            .as_bytes(),
            flags: offsets.flags,
        })
    }
}

/// Read-only subslice helper. Builds a `&'static [u8]` over the *subrange only* so no
/// shared reference ever spans the writable bytecode/module_info regions of the same
/// allocation (which would be invalidated by JSC's in-place writes).
///
/// SAFETY: caller guarantees `base[..len]` is a live 'static allocation and
/// `[ptr.offset, ptr.offset + ptr.length)` is in-bounds and never written through a
/// `*mut` alias for the lifetime of the returned reference.
unsafe fn slice_to(base: *const u8, len: usize, ptr: StringPointer) -> &'static [u8] {
    if ptr.length == 0 {
        return b"";
    }
    let off = ptr.offset as usize;
    let n = ptr.length as usize;
    debug_assert!(off.checked_add(n).is_some_and(|end| end <= len));
    let _ = len;
    // SAFETY: caller contract — `[off, off+n)` lies within a live 'static read-only allocation.
    unsafe { core::slice::from_raw_parts(base.add(off), n) }
}

/// Mutable-subslice helper for `from_bytes`. Derives a `*mut [u8]` directly from the raw
/// section base so the result carries write provenance — going through `slice_to` (which
/// returns `&[u8]`) and casting `*const [u8] as *mut [u8]` would be UB on write.
///
/// SAFETY: caller guarantees `base[..len]` is a live allocation with write permission and
/// that `[ptr.offset, ptr.offset + ptr.length)` is in-bounds.
unsafe fn slice_to_mut(base: *mut u8, len: usize, ptr: StringPointer) -> *mut [u8] {
    let off = ptr.offset as usize;
    let n = ptr.length as usize;
    debug_assert!(off.checked_add(n).is_some_and(|end| end <= len));
    let _ = len;
    // SAFETY: caller contract — `off` is in-bounds of the writable allocation at `base`.
    core::ptr::slice_from_raw_parts_mut(unsafe { base.add(off) }, n)
}

/// SAFETY: as `slice_to`, plus `base[ptr.offset + ptr.length] == 0` (written by
/// `to_bytes` via `appendCountZ`).
unsafe fn slice_to_z(base: *const u8, len: usize, ptr: StringPointer) -> &'static ZStr {
    if ptr.length == 0 {
        return ZStr::EMPTY;
    }
    let off = ptr.offset as usize;
    let n = ptr.length as usize;
    debug_assert!(off.checked_add(n).is_some_and(|end| end < len));
    let _ = len;
    // SAFETY: caller contract — `[off, off+n]` is in-bounds with a NUL terminator at `base[off+n]`.
    unsafe { ZStr::from_raw(base.add(off), n) }
}

pub(crate) fn to_bytes(
    prefix: &[u8],
    output_files: &[OutputFile],
    output_format: Format,
    compile_exec_argv: &[u8],
    flags: Flags,
) -> crate::Result<Vec<u8>> {
    // RAII trace handle ends on drop.
    let _serialize_trace = bun_perf::trace(bun_perf::PerfEvent::StandaloneModuleGraphSerialize);

    let mut entry_point_id: Option<usize> = None;
    let mut string_builder = bun_core::StringBuilder::default();
    let mut module_count: usize = 0;
    for output_file in output_files {
        string_builder.count_z(&output_file.dest_path);
        string_builder.count_z(prefix);
        if let options::OutputFileValue::Buffer { bytes } = &output_file.value {
            if output_file.output_kind == options::OutputKind::Sourcemap {
                // This is an over-estimation to ensure that we allocate
                // enough memory for the source-map contents. Calculating
                // the exact amount is not possible without allocating as it
                // involves a JSON parser.
                string_builder.cap += bytes.len() * 2;
            } else if output_file.output_kind == options::OutputKind::Bytecode {
                // Allocate up to 256 byte alignment for bytecode
                string_builder.cap += bytes.len().div_ceil(256) * 256 + 256;
            } else if output_file.output_kind == options::OutputKind::ModuleInfo {
                string_builder.cap += bytes.len();
            } else {
                if entry_point_id.is_none() {
                    if output_file.side.is_none() || output_file.side == Some(options::Side::Server)
                    {
                        if output_file.output_kind == options::OutputKind::EntryPoint {
                            entry_point_id = Some(module_count);
                        }
                    }
                }

                string_builder.count_z(bytes);
                module_count += 1;
            }
        }
    }

    if module_count == 0 || entry_point_id.is_none() {
        return Ok(Vec::new());
    }

    string_builder.cap += size_of::<CompiledModuleGraphFile>() * output_files.len();
    string_builder.cap += TRAILER.len();
    string_builder.cap += 16;
    string_builder.cap += size_of::<Offsets>();
    string_builder.count_z(compile_exec_argv);

    string_builder.allocate()?;

    let mut modules: Vec<CompiledModuleGraphFile> = Vec::with_capacity(module_count);

    let mut source_map_header_list: Vec<u8> = Vec::new();
    let mut source_map_string_list: Vec<u8> = Vec::new();

    for output_file in output_files {
        if !output_file.output_kind.is_file_in_standalone_mode() {
            continue;
        }

        let options::OutputFileValue::Buffer { bytes: buf_bytes } = &output_file.value else {
            continue;
        };

        let dest_path = bun_core::strings::remove_leading_dot_slash(&output_file.dest_path);

        // Windows: store the key with `/`. The template printer emits native
        // `\` into `dest_path`, but `find_assume_standalone_path` normalizes
        // lookups to `/`, so a `\` key would miss (ENOENT). `src/bundler/Chunk.rs`
        // only normalizes a scratch copy, so we re-normalize here.
        #[cfg(windows)]
        let mut dest_path_buf = PathBuffer::uninit();
        #[cfg(windows)]
        let dest_path: &[u8] =
            path::resolve_path::platform_to_posix_buf::<u8>(dest_path, &mut dest_path_buf);

        let bytecode: StringPointer = 'brk: {
            if output_file.bytecode_index != u32::MAX {
                // Bytecode alignment for JSC bytecode cache deserialization.
                // Not aligning correctly causes a runtime assertion error or segfault.
                //
                // PLATFORM-SPECIFIC ALIGNMENT:
                // - PE (Windows) and Mach-O (macOS): The module graph data is embedded in
                //   a dedicated section with an 8-byte size header. At runtime, the section
                //   is memory-mapped at a page-aligned address (hence 128-byte aligned).
                //   The data buffer starts 8 bytes after the section start.
                //   For bytecode at offset O to be 128-byte aligned:
                //     (section_va + 8 + O) % 128 == 0
                //     => O % 128 == 120
                //
                // - ELF (Linux): The module graph data is appended to the executable and
                //   read into a heap-allocated buffer at runtime. The allocator provides
                //   natural alignment, and there's no 8-byte section header offset.
                //   However, using target_mod=120 is still safe because:
                //   - If the buffer is 128-aligned: bytecode at offset 120 is at (128n + 120),
                //     which when loaded at a 128-aligned address gives proper alignment.
                //   - The extra 120 bytes of padding is acceptable overhead.
                //
                // This alignment strategy (target_mod=120) works for all platforms because
                // it's the worst-case offset needed for the 8-byte header scenario.
                let bytecode = output_files[output_file.bytecode_index as usize]
                    .value
                    .as_slice();
                let current_offset = string_builder.len;
                // Calculate padding so that (current_offset + padding) % 128 == 120
                // This accounts for the 8-byte section header on PE/Mach-O platforms.
                let target_mod: usize = 128 - size_of::<u64>(); // 120 = accounts for 8-byte header
                let current_mod = current_offset % 128;
                let padding = if current_mod <= target_mod {
                    target_mod - current_mod
                } else {
                    128 - current_mod + target_mod
                };
                // Zero the padding bytes to ensure deterministic output
                let writable = string_builder.writable();
                writable[0..padding].fill(0);
                string_builder.len += padding;
                let aligned_offset = string_builder.len;
                let writable_after_padding = string_builder.writable();
                writable_after_padding[0..bytecode.len()]
                    .copy_from_slice(&bytecode[0..bytecode.len()]);
                let unaligned_space = &writable_after_padding[bytecode.len()..];
                let len = bytecode.len() + unaligned_space.len().min(128);
                string_builder.len += len;
                break 'brk StringPointer {
                    offset: aligned_offset as u32,
                    length: len as u32,
                };
            } else {
                break 'brk StringPointer::default();
            }
        };

        // Embed module_info for ESM bytecode
        let module_info: StringPointer = 'brk: {
            if output_file.module_info_index != u32::MAX {
                let mi_bytes = output_files[output_file.module_info_index as usize]
                    .value
                    .as_slice();
                let offset = string_builder.len;
                let writable = string_builder.writable();
                writable[0..mi_bytes.len()].copy_from_slice(&mi_bytes[0..mi_bytes.len()]);
                string_builder.len += mi_bytes.len();
                break 'brk StringPointer {
                    offset: offset as u32,
                    length: mi_bytes.len() as u32,
                };
            }
            break 'brk StringPointer::default();
        };

        if Environment::IS_CANARY || Environment::IS_DEBUG {
            if let Some(dump_code_dir) = bun_core::env_var::BUN_FEATURE_FLAG_DUMP_CODE.get() {
                // `dest_path` keeps `..` for the embedded bunfs key below; neutralize
                // every `..` segment here so the on-disk dump can't escape
                // `dump_code_dir` (the join would otherwise normalize `..` above it).
                let mut dump_rel: Vec<u8> = Vec::new();
                options::write_sanitized_parent_dirs(&mut dump_rel, dest_path)
                    .expect("write to Vec<u8>");
                let mut path_buf = bun_paths::path_buffer_pool::get();
                let dest_z = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
                    dump_code_dir,
                    &mut path_buf[..],
                    &[&dump_rel],
                );

                // Scoped block to handle dump failures without skipping module emission
                'dump: {
                    let flags = bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;
                    let file = match bun_sys::File::make_open(dest_z.as_bytes(), flags, 0o664) {
                        Ok(file) => file,
                        Err(e) => {
                            bun_core::pretty_errorln!(
                                "<r><red>error<r><d>:<r> failed to open {}: {}",
                                bstr::BStr::new(dest_path),
                                e
                            );
                            break 'dump;
                        }
                    };
                    if let Err(e) = file.write_all(buf_bytes) {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r><d>:<r> failed to write {}: {}",
                            bstr::BStr::new(dest_path),
                            e
                        );
                        break 'dump;
                    }
                }
            }
        }

        // When there's bytecode, store the bytecode output file's path as bytecode_origin_path.
        // This path was used to generate the bytecode cache and must match at runtime.
        let bytecode_origin_path: StringPointer = if output_file.bytecode_index != u32::MAX {
            string_builder
                .append_count_z(&output_files[output_file.bytecode_index as usize].dest_path)
        } else {
            StringPointer::default()
        };

        let mut module = CompiledModuleGraphFile {
            name: string_builder.fmt_append_count_z(format_args!(
                "{}{}",
                bstr::BStr::new(prefix),
                bstr::BStr::new(dest_path)
            )),
            loader: output_file.loader,
            contents: string_builder.append_count_z(buf_bytes),
            // Latin1 lets the runtime wrap the mmapped section bytes in a
            // zero-copy ExternalStringImpl. The printer escapes non-ASCII for
            // server-side JS, but `--banner`/`--footer`/hashbang and
            // client-side (target=browser) chunks are concatenated verbatim
            // as UTF-8, so verify the final bytes before committing to Latin1.
            encoding: match output_file.loader {
                Loader::Js | Loader::Jsx | Loader::Ts | Loader::Tsx
                    if strings::first_non_ascii(buf_bytes).is_none() =>
                {
                    Encoding::Latin1
                }
                _ => Encoding::Binary,
            },
            module_format: if output_file.loader.is_javascript_like() {
                match output_format {
                    Format::Cjs => ModuleFormat::Cjs,
                    Format::Esm => ModuleFormat::Esm,
                    _ => ModuleFormat::None,
                }
            } else {
                ModuleFormat::None
            },
            bytecode,
            module_info,
            bytecode_origin_path,
            side: match output_file.side.unwrap_or(options::Side::Server) {
                options::Side::Server => FileSide::Server,
                options::Side::Client => FileSide::Client,
            },
            sourcemap: StringPointer::default(),
        };

        if output_file.source_map_index != u32::MAX {
            serialize_json_source_map_for_standalone(
                &mut source_map_header_list,
                &mut source_map_string_list,
                output_files[output_file.source_map_index as usize]
                    .value
                    .as_slice(),
            )?;
            module.sourcemap =
                string_builder.add_concat(&[&source_map_header_list, &source_map_string_list]);
            source_map_header_list.clear();
            source_map_string_list.clear();
        }
        modules.push(module);
    }

    // SAFETY: `CompiledModuleGraphFile` is `#[repr(C)]` POD with no padding-dependent
    // invariants; reinterpreting its backing storage as bytes is sound.
    let modules_as_bytes: &[u8] = unsafe {
        core::slice::from_raw_parts(
            modules.as_ptr().cast::<u8>(),
            modules.len() * size_of::<CompiledModuleGraphFile>(),
        )
    };
    let offsets = Offsets {
        entry_point_id: entry_point_id.unwrap() as u32,
        modules_ptr: string_builder.append_count(modules_as_bytes),
        compile_exec_argv_ptr: string_builder.append_count_z(compile_exec_argv),
        byte_count: string_builder.len,
        flags,
    };

    // SAFETY: `Offsets` is `#[repr(C)]` POD; same `sliceAsBytes` rationale as above.
    let offsets_as_bytes: &[u8] = unsafe {
        core::slice::from_raw_parts((&raw const offsets).cast::<u8>(), size_of::<Offsets>())
    };
    let _ = string_builder.append(offsets_as_bytes);
    let _ = string_builder.append(TRAILER);

    #[cfg(debug_assertions)]
    {
        // An expensive sanity check: round-trip
        // the serialized bytes and verify the module count survives. The graph
        // only borrows the builder's buffer transiently — it is unlocked and
        // dropped before the buffer is moved out below.
        let graph = StandaloneModuleGraph::from_bytes(
            string_builder.ptr.unwrap().as_ptr(),
            string_builder.len,
            offsets,
        )?;
        debug_assert_eq!(graph.files.count(), modules.len());
        graph.files.unlock_pointers();
    }

    // StringBuilder owns the buffer; hand it back without copying. `cap` may
    // exceed `len` (sourcemap capacity is over-estimated above), so truncate
    // the reconstituted Vec down to the written prefix — the `[len, cap)` tail
    // is never read.
    let len = string_builder.len;
    let mut output = string_builder.move_to_slice().into_vec();
    output.truncate(len);
    Ok(output)
}

pub(crate) type InjectOptions = WindowsOptions;

pub enum CompileResult {
    Success,
    Err(CompileError),
}

pub enum CompileError {
    Message(Vec<u8>),
    Reason(CompileErrorReason),
}

#[derive(Clone, Copy, strum::IntoStaticStr)]
pub enum CompileErrorReason {
    NoEntryPoint,
    NoOutputFiles,
}

impl CompileErrorReason {
    pub fn message(self) -> &'static [u8] {
        match self {
            CompileErrorReason::NoEntryPoint => b"No entry point found for compilation",
            CompileErrorReason::NoOutputFiles => b"No output files to bundle",
        }
    }
}

impl CompileError {
    pub fn slice(&self) -> &[u8] {
        match self {
            CompileError::Message(m) => m,
            CompileError::Reason(r) => r.message(),
        }
    }
}

impl CompileResult {
    pub fn fail(reason: CompileErrorReason) -> CompileResult {
        CompileResult::Err(CompileError::Reason(reason))
    }

    pub fn fail_fmt(args: core::fmt::Arguments<'_>) -> CompileResult {
        let mut v = Vec::new();
        let _ = write!(&mut v, "{}", args);
        CompileResult::Err(CompileError::Message(v))
    }
}

pub(crate) fn inject(
    bytes: &[u8],
    self_exe: &ZStr,
    inject_options: &InjectOptions,
    target: &CompileTarget,
) -> Fd {
    let _ = inject_options;
    let mut buf = PathBuffer::uninit();
    // Note: `tmpname` borrows `buf` mutably for the &ZStr it returns. The
    // tmpdir-fallback retry below may need to repoint `zname` at a heap-owned
    // buffer instead, so hoist that owner here so it outlives the loop.
    let mut zname_owned: Option<Box<[u8]>> = None;
    let mut zname: &ZStr = match bun_fs::FileSystem::tmpname(
        b"bun-build",
        &mut buf[..],
        // i64 → u64 bitcast.
        bun_core::time::milli_timestamp() as u64,
    ) {
        Ok(n) => n,
        Err(e) => {
            bun_core::pretty_errorln!(
                "<r><red>error<r><d>:<r> failed to get temporary file name: {}",
                bstr::BStr::new(e.name())
            );
            return Fd::INVALID;
        }
    };

    let cleanup = |name: &ZStr, fd: Fd| {
        // Ensure we own the file
        #[cfg(unix)]
        {
            // Make the file writable so we can delete it
            let _ = Syscall::fchmod(fd, 0o700);
        }
        fd.close();
        let _ = Syscall::unlink(name);
    };

    let cloned_executable_fd: Fd = 'brk: {
        #[cfg(windows)]
        {
            // copy self and then open it for writing

            let mut in_buf = WPathBuffer::uninit();
            strings::copy_u8_into_u16(&mut in_buf, self_exe.as_bytes());
            in_buf[self_exe.len()] = 0;
            let mut out_buf = WPathBuffer::uninit();
            strings::copy_u8_into_u16(&mut out_buf, zname.as_bytes());
            out_buf[zname.len()] = 0;

            use bun_sys::windows as w;
            use bun_sys::windows::Win32ErrorExt as _;
            // SAFETY: both buffers NUL-terminated above; `CopyFileW` does not
            // retain the pointers past return.
            if unsafe { w::CopyFileW(in_buf.as_ptr(), out_buf.as_ptr(), w::FALSE) } == w::FALSE {
                let e = w::Win32Error::get();
                // Map the Win32 code through the errno table so users see a
                // name, not a raw integer.
                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {:?}",
                    e.to_system_errno()
                        .unwrap_or(bun_sys::SystemErrno::EUNKNOWN)
                );
                return Fd::invalid();
            }
            let out = &out_buf[..zname.len()];
            let file = match Syscall::open_file_at_windows(
                Fd::invalid(),
                out,
                Syscall::NtCreateFileOptions {
                    access_mask: w::SYNCHRONIZE | w::GENERIC_WRITE | w::GENERIC_READ | w::DELETE,
                    disposition: w::FILE_OPEN,
                    options: w::FILE_SYNCHRONOUS_IO_NONALERT | w::FILE_OPEN_REPARSE_POINT,
                    ..Default::default()
                },
            ) {
                Ok(f) => f,
                Err(e) => {
                    bun_core::pretty_errorln!(
                        "<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{}",
                        e
                    );
                    return Fd::invalid();
                }
            };

            break 'brk file;
        }

        #[cfg(target_os = "macos")]
        {
            // if we're on a mac, use clonefile() if we can
            // failure is okay, clonefile is just a fast path.
            if let bun_sys::Result::Ok(()) = Syscall::clonefile(self_exe, zname) {
                if let bun_sys::Result::Ok(res) =
                    Syscall::open(zname, bun_sys::O::RDWR | bun_sys::O::CLOEXEC, 0)
                {
                    break 'brk res;
                }
            }
        }

        // otherwise, just copy the file

        #[cfg(not(windows))]
        let fd: Fd = 'brk2: {
            let mut tried_changing_abs_dir = false;
            for retry in 0..3 {
                match Syscall::open(
                    zname,
                    bun_sys::O::CLOEXEC | bun_sys::O::RDWR | bun_sys::O::CREAT | bun_sys::O::EXCL,
                    0,
                ) {
                    Ok(res) => break 'brk2 res,
                    Err(err) => {
                        if retry < 2 {
                            // they may not have write access to the present working directory
                            //
                            // but we want to default to it since it's the
                            // least likely to need to be copied due to
                            // renameat() across filesystems
                            //
                            // so in the event of a failure, we try to
                            // we retry using the tmp dir
                            //
                            // but we only do that once because otherwise it's just silly
                            if !tried_changing_abs_dir {
                                tried_changing_abs_dir = true;
                                // `RealFS::tmpdir_path` lives in `bun_resolver::fs` (T6);
                                // reached via `bun_bundler`'s public re-export so this
                                // crate doesn't take a direct `bun_resolver` edge.
                                {
                                    let zname_z = bun_core::strings::concat(&[
                                        bun_bundler::bun_fs::RealFS::tmpdir_path(),
                                        SEP_STR.as_bytes(),
                                        zname.as_bytes(),
                                        &[0],
                                    ]);
                                    // Note: the concat buffer is parked in
                                    // `zname_owned` (declared at fn entry) so it outlives the
                                    // loop and drops at fn exit.
                                    let len = zname_z.len().saturating_sub(1);
                                    zname_owned = Some(zname_z);
                                    // SAFETY: trailing 0 byte appended above; `zname_owned`
                                    // keeps the allocation alive for the rest of the fn.
                                    zname = unsafe {
                                        ZStr::from_raw(zname_owned.as_ref().unwrap().as_ptr(), len)
                                    };
                                    continue;
                                }
                            }
                            match err.get_errno() {
                                // try again
                                bun_sys::E::EPERM | bun_sys::E::EAGAIN | bun_sys::E::EBUSY => {
                                    continue;
                                }
                                _ => break,
                            }
                        }
                    }
                }
            }
            unreachable!()
        };
        #[cfg(not(windows))]
        let self_fd: Fd = 'brk2: {
            for retry in 0..3 {
                match Syscall::open(self_exe, bun_sys::O::CLOEXEC | bun_sys::O::RDONLY, 0) {
                    Ok(res) => break 'brk2 res,
                    Err(err) => {
                        if retry < 2 {
                            match err.get_errno() {
                                // try again
                                bun_sys::E::EPERM | bun_sys::E::EAGAIN | bun_sys::E::EBUSY => {
                                    continue;
                                }
                                _ => {}
                            }
                        }

                        bun_core::pretty_errorln!(
                            "<r><red>error<r><d>:<r> failed to open bun executable to copy from as read-only\n{}",
                            err
                        );
                        cleanup(zname, fd);
                        return Fd::INVALID;
                    }
                }
            }
            unreachable!()
        };

        #[cfg(not(windows))]
        {
            // defer self_fd.close()
            let _self_fd_guard = Syscall::CloseOnDrop::new(self_fd);

            if let Err(e) = bun_sys::copy_file(self_fd, fd) {
                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {}",
                    e
                );
                cleanup(zname, fd);
                return Fd::INVALID;
            }

            break 'brk fd;
        }
    };
    let _ = (&mut zname_owned, &mut zname);

    match target.os {
        CompileTargetOs::Mac => {
            let input_bytes = match bun_sys::File::borrow(&cloned_executable_fd).read_to_end() {
                Ok(b) => b,
                Err(err) => {
                    bun_core::pretty_errorln!("Error reading standalone module graph: {}", err);
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };
            let mut macho_file = match bun_macho::MachoFile::init(&input_bytes, bytes.len()) {
                Ok(f) => f,
                Err(e) => {
                    bun_core::pretty_errorln!("Error initializing standalone module graph: {}", e);
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };
            if let Err(e) = macho_file.write_section(bytes) {
                bun_core::pretty_errorln!("Error writing standalone module graph: {}", e);
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            drop(input_bytes);

            if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                bun_core::pretty_errorln!("Error seeking to start of temporary file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }

            let mut buffered_writer = std::io::BufWriter::with_capacity(
                512 * 1024,
                bun_sys::FileWriter(cloned_executable_fd),
            );
            if let Err(e) = macho_file.build_and_sign(&mut buffered_writer) {
                bun_core::pretty_errorln!(
                    "Error writing standalone module graph: {}",
                    bstr::BStr::new(e.name())
                );
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            if let Err(e) = std::io::Write::flush(&mut buffered_writer) {
                bun_core::pretty_errorln!("Error flushing standalone module graph: {}", e);
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o755) };
            }
            return cloned_executable_fd;
        }
        CompileTargetOs::Windows => {
            let input_bytes = match bun_sys::File::borrow(&cloned_executable_fd).read_to_end() {
                Ok(b) => b,
                Err(err) => {
                    bun_core::pretty_errorln!("Error reading standalone module graph: {}", err);
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };
            let mut pe_file = match bun_pe::PEFile::init(&input_bytes) {
                Ok(f) => f,
                Err(e) => {
                    bun_core::pretty_errorln!("Error initializing PE file: {}", e);
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };
            // Always strip authenticode when adding .bun section for --compile
            if let Err(e) = pe_file.add_bun_section(bytes, bun_pe::StripMode::StripAlways) {
                bun_core::pretty_errorln!("Error adding Bun section to PE file: {}", e);
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            drop(input_bytes);

            if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                bun_core::pretty_errorln!("Error seeking to start of temporary file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }

            let mut writer = bun_sys::FileWriter(cloned_executable_fd);
            if let Err(e) = pe_file.write(&mut writer) {
                bun_core::pretty_errorln!("Error writing PE file: {}", bstr::BStr::new(e.name()));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            // Set executable permissions when running on POSIX hosts, even for Windows targets
            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o755) };
            }
            return cloned_executable_fd;
        }
        CompileTargetOs::Linux | CompileTargetOs::Freebsd => {
            // ELF section approach: find .bun section and expand it
            let input_bytes = match bun_sys::File::borrow(&cloned_executable_fd).read_to_end() {
                Ok(b) => b,
                Err(err) => {
                    bun_core::pretty_errorln!("Error reading executable: {}", err);
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };

            let mut elf_file = match bun_elf::ElfFile::init(input_bytes) {
                Ok(f) => f,
                Err(e) => {
                    bun_core::pretty_errorln!("Error initializing ELF file: {}", e);
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };

            elf_file.normalize_interpreter();

            if let Err(e) = elf_file.write_bun_section(bytes) {
                bun_core::pretty_errorln!("Error writing .bun section to ELF: {}", e);
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }

            if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                bun_core::pretty_errorln!("Error seeking to start of temporary file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }

            // Write the modified ELF data back to the file
            let write_file = bun_sys::File::borrow(&cloned_executable_fd);
            if let Err(err) = write_file.write_all(&elf_file.data) {
                bun_core::pretty_errorln!("Error writing ELF file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            // Truncate the file to the exact size of the modified ELF
            let _ = Syscall::ftruncate(
                cloned_executable_fd,
                i64::try_from(elf_file.data.len()).expect("int cast"),
            );

            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o755) };
            }
            return cloned_executable_fd;
        }
        _ => {
            let total_byte_count: usize;
            #[cfg(windows)]
            {
                total_byte_count = bytes.len()
                    + 8
                    + match Syscall::set_file_offset_to_end_windows(cloned_executable_fd) {
                        Ok(v) => v,
                        Err(e) => {
                            bun_core::pretty_errorln!(
                                "<r><red>error<r><d>:<r> failed to seek to end of temporary file\n{}",
                                e
                            );
                            cleanup(zname, cloned_executable_fd);
                            return Fd::invalid();
                        }
                    };
            }
            #[cfg(not(windows))]
            {
                let seek_position: u64 = u64::try_from('brk: {
                    let fstat = match Syscall::fstat(cloned_executable_fd) {
                        Ok(res) => res,
                        Err(err) => {
                            bun_core::pretty_errorln!("{}", err);
                            cleanup(zname, cloned_executable_fd);
                            return Fd::INVALID;
                        }
                    };
                    break 'brk fstat.st_size.max(0);
                })
                .unwrap();

                total_byte_count = seek_position as usize + bytes.len() + 8;

                // From https://man7.org/linux/man-pages/man2/lseek.2.html
                //
                //  lseek() allows the file offset to be set beyond the end of the
                //  file (but this does not change the size of the file).  If data is
                //  later written at this point, subsequent reads of the data in the
                //  gap (a "hole") return null bytes ('\0') until data is actually
                //  written into the gap.
                //
                if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, seek_position) {
                    bun_core::pretty_errorln!(
                        "{}\nwhile seeking to end of temporary file (pos: {})",
                        err,
                        seek_position
                    );
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            }

            let mut remain = bytes;
            while !remain.is_empty() {
                match Syscall::write(cloned_executable_fd, remain) {
                    Ok(written) => remain = &remain[written..],
                    Err(err) => {
                        bun_core::pretty_errorln!(
                            "<r><red>error<r><d>:<r> failed to write to temporary file\n{}",
                            err
                        );
                        cleanup(zname, cloned_executable_fd);
                        return Fd::INVALID;
                    }
                }
            }

            // the final 8 bytes in the file are the length of the module graph with padding, excluding the trailer and offsets
            let _ = Syscall::write(cloned_executable_fd, &total_byte_count.to_ne_bytes());
            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o755) };
            }

            return cloned_executable_fd;
        }
    }
}

use bun_core::Environment::OperatingSystem as CompileTargetOs;
pub use bun_options_types::compile_target::CompileTarget;

/// Moved up from `bun_options_types` (T3) so it can name
/// `bun_http::AsyncHTTP` directly
/// instead of routing through `extern "Rust"` shims; the only callers are the
/// two `download*` fns below in this crate.
pub(crate) fn download_to_path(
    target: &CompileTarget,
    env: &mut bun_dotenv::Loader<'_>,
    dest_z: &ZStr,
) -> crate::Result<()> {
    bun_http::http_thread::init(&Default::default());
    let mut refresher = bun_core::Progress::Progress::default();

    {
        refresher.refresh();

        // TODO: This is way too much code necessary to send a single HTTP request...
        let mut compressed_archive_bytes =
            Box::new(bun_core::MutableString::init(24 * 1024 * 1024)?);
        let mut url_buffer = [0u8; 2048];
        let url_str = match target.to_npm_registry_url(&mut url_buffer) {
            Ok(s) => s,
            Err(err) => {
                // Return error without printing - let caller decide how to handle
                return Err(err.into());
            }
        };
        let url_str_copy: Box<[u8]> = Box::from(url_str);
        let url = bun_url::URL::parse(&url_str_copy);
        {
            // The unconditional
            // `progress.end()` below is sufficient: no fallible call sits between
            // `refresher.start` and it, so every exit path (including the
            // error returns after it) ends the node exactly once.
            // Note: reshaped for borrowck — `get_http_proxy_for` borrows
            // `env` for the proxy URL lifetime; read the bool first.
            let reject_unauthorized = env.get_tls_reject_unauthorized();
            let http_proxy: Option<bun_url::URL<'_>> = env.get_http_proxy_for(&url);
            let progress = refresher.start(b"Downloading", 0);

            let mut async_http = Box::new(bun_http::AsyncHTTP::init_sync(
                bun_http::Method::GET,
                url,
                Default::default(),
                b"",
                &raw mut *compressed_archive_bytes,
                b"",
                http_proxy,
                None,
                bun_http::FetchRedirect::Follow,
            ));
            async_http.client.progress_node =
                core::ptr::NonNull::new(core::ptr::from_mut(progress));
            async_http.client.flags.reject_unauthorized = reject_unauthorized;
            let send_result = async_http.send_sync();

            progress.end();
            let status_code = send_result?.status_code as u16;

            match status_code {
                404 => {
                    // Return error without printing - let caller handle the messaging
                    return Err(crate::Error::TargetNotFound);
                }
                403 | 429 | 499..=599 => {
                    // Return error without printing - let caller handle the messaging
                    return Err(crate::Error::NetworkError);
                }
                200 => {}
                _ => return Err(crate::Error::NetworkError),
            }
        }

        let mut tarball_bytes: Vec<u8> = Vec::new();
        {
            refresher.refresh();
            // defer compressed_archive_bytes.list.deinit(allocator) — handled by Drop

            if compressed_archive_bytes.list.is_empty() {
                // Return error without printing - let caller handle the messaging
                return Err(crate::Error::InvalidResponse);
            }

            {
                // Note: reshaped for borrowck — `refresher.start` borrows
                // `refresher` mutably; do gunzip work first, drive progress around it.
                refresher.start(b"Decompressing", 0);
                let gunzip_result = (|| -> crate::Result<()> {
                    let mut gunzip = bun_zlib::ZlibReaderArrayList::init(
                        compressed_archive_bytes.list.as_slice(),
                        &mut tarball_bytes,
                    )
                    .map_err(|_| crate::Error::InvalidResponse)?;
                    gunzip
                        .read_all(true)
                        .map_err(|_| crate::Error::InvalidResponse)?;
                    Ok(())
                })();
                refresher.root.end();
                gunzip_result?;
            }
            refresher.refresh();

            {
                refresher.start(b"Extracting", 0);
                // defer node.end() — see explicit calls below

                let mut tmpname_buf = [0u8; 1024];
                let tempdir_name: &ZStr =
                    bun_fs::FileSystem::tmpname(b"tmp", &mut tmpname_buf, bun_core::fast_random())?;
                let tmpdir = bun_sys::Dir::cwd()
                    .make_open_path(tempdir_name.as_bytes(), Default::default())?;
                scopeguard::defer! {
                    let _ = bun_sys::Dir::cwd().delete_tree(tempdir_name.as_bytes());
                }
                let extract_res = bun_libarchive::Archiver::extract_to_dir(
                    tarball_bytes.as_slice(),
                    tmpdir.fd(),
                    None,
                    &mut (),
                    bun_libarchive::ExtractOptions {
                        // "package/bin"
                        depth_to_skip: 2,
                        ..Default::default()
                    },
                );
                if extract_res.is_err() {
                    refresher.root.end();
                    // Return error without printing - let caller handle the messaging
                    return Err(crate::Error::ExtractionFailed);
                }

                let mut did_retry = false;
                loop {
                    let src_name: &ZStr = if target.os == CompileTargetOs::Windows {
                        bun_core::zstr!("bun.exe")
                    } else {
                        bun_core::zstr!("bun")
                    };
                    let mv = bun_sys::move_file_z(tmpdir.fd(), src_name, Fd::INVALID, dest_z);
                    if mv.is_err() {
                        if !did_retry {
                            did_retry = true;
                            let dirname = path::dirname_simple(dest_z.as_bytes());
                            if !dirname.is_empty() {
                                let _ = bun_sys::Dir::cwd().make_path(dirname);
                                continue;
                            }

                            // fallthrough, failed for another reason
                        }
                        refresher.root.end();
                        // Return error without printing - let caller handle the messaging
                        return Err(crate::Error::ExtractionFailed);
                    }
                    break;
                }
                tmpdir.close();
                refresher.root.end();
            }
            refresher.refresh();
        }
    }
    Ok(())
}

pub fn to_executable(
    target: &CompileTarget,
    output_files: &[OutputFile],
    root_dir: Fd,
    module_prefix: &[u8],
    outfile: &[u8],
    env: &mut bun_dotenv::Loader,
    output_format: Format,
    windows_options: &WindowsOptions,
    compile_exec_argv: &[u8],
    self_exe_path: Option<&[u8]>,
    flags: Flags,
) -> crate::Result<CompileResult> {
    #[cfg(windows)]
    let _ = root_dir;
    let bytes = match to_bytes(
        module_prefix,
        output_files,
        output_format,
        compile_exec_argv,
        flags,
    ) {
        Ok(b) => b,
        Err(e) => {
            return Ok(CompileResult::fail_fmt(format_args!(
                "failed to generate module graph bytes: {}",
                bstr::BStr::new(e.name())
            )));
        }
    };
    if bytes.is_empty() {
        return Ok(CompileResult::fail(CompileErrorReason::NoOutputFiles));
    }
    // bytes drops at end of scope

    // `ZBox` always owns its bytes and drops on scope exit, so no
    // ownership flag is needed.
    let self_exe: bun_core::ZBox = if let Some(path) = self_exe_path {
        bun_core::ZBox::from_vec_with_nul(path.to_vec())
    } else if target.is_default() {
        match bun_core::self_exe_path() {
            Ok(p) => bun_core::ZBox::from_vec_with_nul(p.as_bytes().to_vec()),
            Err(e) => {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "failed to get self executable path: {}",
                    bstr::BStr::new(e.name())
                )));
            }
        }
    } else {
        let mut exe_path_buf = PathBuffer::uninit();
        let mut version_str: Vec<u8> = Vec::new();
        let _ = write!(&mut version_str, "{}", target);
        version_str.push(0);
        // SAFETY: trailing 0 byte appended above.
        let version_zstr = ZStr::from_slice_with_nul(&version_str[..]);

        let mut needs_download: bool = true;
        let dest_z = target.exe_path(&mut exe_path_buf, version_zstr, env, &mut needs_download);

        if needs_download {
            if let Err(e) = download_to_path(target, env, dest_z) {
                return Ok(match e {
                    crate::Error::TargetNotFound => CompileResult::fail_fmt(format_args!(
                        "Target platform '{}' is not available for download. Check if this version of Bun supports this target.",
                        target
                    )),
                    crate::Error::NetworkError => CompileResult::fail_fmt(format_args!(
                        "Network error downloading executable for '{}'. Check your internet connection and proxy settings.",
                        target
                    )),
                    crate::Error::InvalidResponse => CompileResult::fail_fmt(format_args!(
                        "Downloaded file for '{}' appears to be corrupted. Please try again.",
                        target
                    )),
                    crate::Error::ExtractionFailed => CompileResult::fail_fmt(format_args!(
                        "Failed to extract executable for '{}'. The download may be incomplete.",
                        target
                    )),
                    crate::Error::UnsupportedTarget => CompileResult::fail_fmt(format_args!(
                        "Target '{}' is not supported",
                        target
                    )),
                    _ => CompileResult::fail_fmt(format_args!(
                        "Failed to download '{}': {}",
                        target,
                        bstr::BStr::new(e.name())
                    )),
                });
            }
        }

        bun_core::ZBox::from_vec_with_nul(dest_z.as_bytes().to_vec())
    };

    let fd = inject(&bytes, &self_exe, windows_options, target);
    // Note: a scopeguard closure capturing `fd` by value would not observe
    // later reassignments; capturing by `&mut` conflicts with later uses. Explicit
    // `if fd != Fd::INVALID { fd.close(); }` calls are inserted at every return below
    // (both error and success paths).
    debug_assert!(fd.kind() == bun_sys::FdKind::System);

    #[cfg(unix)]
    {
        // Set executable permissions (0o755 = rwxr-xr-x) - makes it executable for owner, readable/executable for group and others
        let _ = Syscall::fchmod(fd, 0o755);
    }

    #[cfg(windows)]
    {
        // Get the current path of the temp file
        let mut temp_buf = PathBuffer::uninit();
        let temp_path = match bun_sys::get_fd_path(fd, &mut temp_buf) {
            Ok(p) => p,
            Err(e) => {
                if fd != Fd::INVALID {
                    fd.close();
                }
                return Ok(CompileResult::fail_fmt(format_args!(
                    "Failed to get temp file path: {}",
                    bstr::BStr::new(e.name())
                )));
            }
        };

        // Build the absolute destination path
        // On Windows, we need an absolute path for MoveFileExW
        // Get the current working directory and join with outfile
        let mut cwd_buf = PathBuffer::uninit();
        let cwd_path: &[u8] = match bun_sys::getcwd(&mut cwd_buf) {
            Ok(len) => &cwd_buf[..len],
            Err(e) => {
                if fd != Fd::INVALID {
                    fd.close();
                }
                return Ok(CompileResult::fail_fmt(format_args!(
                    "Failed to get current directory: {}",
                    bstr::BStr::new(e.name())
                )));
            }
        };
        let dest_path = if bun_paths::is_absolute(outfile) {
            outfile
        } else {
            path::resolve_path::join_abs_string::<path::platform::Auto>(cwd_path, &[outfile])
        };

        // Convert paths to Windows UTF-16
        let mut temp_buf_w = OSPathBuffer::uninit();
        let mut dest_buf_w = OSPathBuffer::uninit();
        let temp_w_len = strings::paths::to_w_path_normalized(&mut temp_buf_w, temp_path).len();
        let dest_w_len = strings::paths::to_w_path_normalized(&mut dest_buf_w, dest_path).len();

        // `to_w_path_normalized` already NUL-terminates (`buf[len] = 0`); the
        // explicit re-slice below is just to derive the wide-string pointers.
        let temp_buf_u16: &mut [u16] = &mut temp_buf_w;
        let dest_buf_u16: &mut [u16] = &mut dest_buf_w;
        temp_buf_u16[temp_w_len] = 0;
        dest_buf_u16[dest_w_len] = 0;

        // Close the file handle before moving (Windows requires this)
        fd.close();

        use bun_sys::windows::{self, Win32ErrorExt as _};
        // Move the file using MoveFileExW
        // SAFETY: NUL-terminated wide strings constructed above. Pass the
        // full-buffer pointer (not a `[..len]` sub-slice) so the pointer's
        // provenance covers the trailing NUL at index `len` that the W-suffix
        // API will read.
        if unsafe {
            windows::kernel32::MoveFileExW(
                temp_buf_u16.as_ptr(),
                dest_buf_u16.as_ptr(),
                windows::MOVEFILE_COPY_ALLOWED
                    | windows::MOVEFILE_REPLACE_EXISTING
                    | windows::MOVEFILE_WRITE_THROUGH,
            )
        } == windows::FALSE
        {
            let werr = windows::Win32Error::get();
            if let Some(sys_err) = werr.to_system_errno() {
                if sys_err == bun_sys::SystemErrno::EISDIR {
                    return Ok(CompileResult::fail_fmt(format_args!(
                        "{} is a directory. Please choose a different --outfile or delete the directory",
                        bstr::BStr::new(outfile)
                    )));
                } else {
                    return Ok(CompileResult::fail_fmt(format_args!(
                        "failed to move executable to {}: {}",
                        bstr::BStr::new(dest_path),
                        <&'static str>::from(sys_err)
                    )));
                }
            } else {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "failed to move executable to {}",
                    bstr::BStr::new(dest_path)
                )));
            }
        }

        // Set Windows icon and/or metadata using unified function
        if windows_options.icon.is_some()
            || windows_options.title.is_some()
            || windows_options.publisher.is_some()
            || windows_options.version.is_some()
            || windows_options.description.is_some()
            || windows_options.copyright.is_some()
        {
            // The file has been moved to dest_path
            // SAFETY: full-buffer pointer so provenance includes the NUL at
            // `dest_buf_u16[dest_w_len]` (FFI reads it as a C wide string).
            if let Err(e) = windows::rescle::set_windows_metadata(
                dest_buf_u16.as_ptr(),
                windows_options.icon.as_deref(),
                windows_options.title.as_deref(),
                windows_options.publisher.as_deref(),
                windows_options.version.as_deref(),
                windows_options.description.as_deref(),
                windows_options.copyright.as_deref(),
            ) {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "Failed to set Windows metadata: {}",
                    e
                )));
            }
        }
        return Ok(CompileResult::Success);
    }

    #[cfg(not(windows))]
    {
        let mut buf2 = PathBuffer::uninit();
        // Note: borrowck — `get_fd_path` returns `&mut [u8]` borrowing `buf2`;
        // copy it into an owned buffer so `temp_posix_buf` can also borrow `buf2`'s
        // sibling without overlap.
        let temp_location: Vec<u8> = match bun_sys::get_fd_path(fd, &mut buf2) {
            Ok(p) => p.to_vec(),
            Err(e) => {
                if fd != Fd::INVALID {
                    fd.close();
                }
                return Ok(CompileResult::fail_fmt(format_args!(
                    "failed to get path for fd: {}",
                    e
                )));
            }
        };
        let mut temp_posix_buf = PathBuffer::uninit();
        let temp_posix = path::resolve_path::z(&temp_location, &mut temp_posix_buf);
        let outfile_basename = bun_paths::basename(outfile);
        let mut outfile_posix_buf = PathBuffer::uninit();
        let outfile_posix = path::resolve_path::z(outfile_basename, &mut outfile_posix_buf);

        if let Err(e) =
            bun_sys::move_file_z_with_handle(fd, Fd::cwd(), temp_posix, root_dir, outfile_posix)
        {
            fd.close();

            let _ = Syscall::unlink(temp_posix);

            if e.get_errno() == bun_errno::SystemErrno::EISDIR {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "{} is a directory. Please choose a different --outfile or delete the directory",
                    bstr::BStr::new(outfile)
                )));
            } else {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "failed to rename {} to {}: {}",
                    bstr::BStr::new(&temp_location),
                    bstr::BStr::new(outfile),
                    bstr::BStr::new(e.name())
                )));
            }
        }

        if fd != Fd::INVALID {
            fd.close();
        }
        Ok(CompileResult::Success)
    }
}

impl StandaloneModuleGraph {
    /// Loads the standalone module graph from the executable, allocates it on the heap,
    /// sets it globally, and returns the pointer.
    pub fn from_executable() -> crate::Result<Option<*mut StandaloneModuleGraph>> {
        #[cfg(target_os = "macos")]
        {
            let Some((base, len)) = macho::get_data() else {
                return Ok(None);
            };
            if len < size_of::<Offsets>() + TRAILER.len() {
                bun_core::debug_warn!("bun standalone module graph is too small to be valid");
                return Ok(None);
            }
            // SAFETY: `[len - Offsets - TRAILER, len)` is in-bounds (checked above) and
            // read-only; build short-lived views via raw `read_unaligned` so no `&[u8]`
            // ever spans the writable bytecode region carried in `base`'s provenance.
            let offsets_ptr = unsafe { base.add(len - size_of::<Offsets>() - TRAILER.len()) };
            // SAFETY: `[len - TRAILER.len(), len)` is in-bounds (length checked above) and read-only.
            let trailer_bytes = unsafe {
                core::slice::from_raw_parts(base.add(len - TRAILER.len()), TRAILER.len())
            };
            if trailer_bytes != TRAILER {
                bun_core::debug_warn!("bun standalone module graph has invalid trailer");
                return Ok(None);
            }
            // SAFETY: offsets_ptr has at least size_of::<Offsets>() bytes.
            let offsets: Offsets =
                unsafe { core::ptr::read_unaligned(offsets_ptr.cast::<Offsets>()) };
            return from_bytes_alloc(base, len, offsets).map(Some);
        }

        #[cfg(windows)]
        {
            let Some((base, len)) = pe::get_data() else {
                return Ok(None);
            };
            if len < size_of::<Offsets>() + TRAILER.len() {
                bun_core::debug_warn!("bun standalone module graph is too small to be valid");
                return Ok(None);
            }
            // SAFETY: `[len - Offsets - TRAILER, len)` is in-bounds (checked above) and
            // read-only; build short-lived views via raw `read_unaligned` so no `&[u8]`
            // ever spans the writable bytecode region carried in `base`'s provenance.
            let offsets_ptr = unsafe { base.add(len - size_of::<Offsets>() - TRAILER.len()) };
            // SAFETY: `[len - TRAILER.len(), len)` is in-bounds (length checked above) and read-only.
            let trailer_bytes = unsafe {
                core::slice::from_raw_parts(base.add(len - TRAILER.len()), TRAILER.len())
            };
            if trailer_bytes != TRAILER {
                bun_core::debug_warn!("bun standalone module graph has invalid trailer");
                return Ok(None);
            }
            // SAFETY: offsets_ptr has at least size_of::<Offsets>() bytes.
            let offsets: Offsets =
                unsafe { core::ptr::read_unaligned(offsets_ptr.cast::<Offsets>()) };
            return from_bytes_alloc(base, len, offsets).map(Some);
        }

        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        {
            let Some((base, len)) = elf::get_data() else {
                return Ok(None);
            };
            if len < size_of::<Offsets>() + TRAILER.len() {
                bun_core::debug_warn!("bun standalone module graph is too small to be valid");
                return Ok(None);
            }
            // SAFETY: `[len - Offsets - TRAILER, len)` is in-bounds (checked above) and
            // read-only; build short-lived views via raw `read_unaligned` so no `&[u8]`
            // ever spans the writable bytecode region carried in `base`'s provenance.
            let offsets_ptr = unsafe { base.add(len - size_of::<Offsets>() - TRAILER.len()) };
            // SAFETY: `[len - TRAILER.len(), len)` is in-bounds (length checked above) and read-only.
            let trailer_bytes = unsafe {
                core::slice::from_raw_parts(base.add(len - TRAILER.len()), TRAILER.len())
            };
            if trailer_bytes != TRAILER {
                bun_core::debug_warn!("bun standalone module graph has invalid trailer");
                return Ok(None);
            }
            // SAFETY: offsets_ptr has at least size_of::<Offsets>() bytes.
            let offsets: Offsets =
                unsafe { core::ptr::read_unaligned(offsets_ptr.cast::<Offsets>()) };
            return from_bytes_alloc(base, len, offsets).map(Some);
        }

        #[cfg(not(any(
            target_os = "macos",
            windows,
            target_os = "linux",
            target_os = "android",
            target_os = "freebsd"
        )))]
        {
            unreachable!()
        }
    }

    /// Hint to the kernel that the embedded `__BUN`/`.bun` source pages are
    /// unlikely to be accessed again after the entrypoint has been parsed.
    /// The pages are clean file-backed COW, so any later read (lazy require,
    /// stack-trace source lookup) faults back in transparently from the
    /// executable on disk. Only applies when running as a compiled
    /// standalone binary.
    pub fn hint_source_pages_dont_need() {
        #[cfg(windows)]
        {
            return;
        }

        #[cfg(not(windows))]
        {
            let (base, len): (*mut u8, usize) = {
                #[cfg(target_os = "macos")]
                {
                    match macho::get_data() {
                        Some(b) => b,
                        None => return,
                    }
                }
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    match elf::get_data() {
                        Some(b) => b,
                        None => return,
                    }
                }
                #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
                {
                    return;
                }
            };

            #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
            {
                if len == 0 {
                    return;
                }

                let page: usize = bun_alloc::page_size();
                let start = (base as usize) & !(page - 1);
                let end_unaligned = base as usize + len;
                let end = (end_unaligned + page - 1) & !(page - 1);

                // This is a best-effort hint, so call libc madvise directly and
                // just log on failure rather than treating errors as fatal.
                // SAFETY: start..end covers a mapped range of the executable image.
                let rc = unsafe {
                    libc::madvise(
                        start as *mut core::ffi::c_void,
                        end - start,
                        libc::MADV_DONTNEED,
                    )
                };
                if rc != 0 {
                    bun_core::scoped_log!(
                        StandaloneModuleGraph,
                        "hintSourcePagesDontNeed: madvise failed errno={}",
                        bun_sys::last_errno()
                    );
                    return;
                }
                bun_core::scoped_log!(
                    StandaloneModuleGraph,
                    "hintSourcePagesDontNeed: MADV_DONTNEED {} bytes",
                    end - start
                );
            }
        }
    }
}

/// Allocates a StandaloneModuleGraph in the process-static `INSTANCE`,
/// populates it from bytes, sets it globally, and returns the pointer.
fn from_bytes_alloc(
    raw_ptr: *mut u8,
    raw_len: usize,
    offsets: Offsets,
) -> crate::Result<*mut StandaloneModuleGraph> {
    let graph = StandaloneModuleGraph::from_bytes(raw_ptr, raw_len, offsets)?;
    Ok(StandaloneModuleGraph::set(graph))
}

/// Source map serialization in the bundler is specially designed to be
/// loaded in memory as is. Source contents are compressed with ZSTD to
/// reduce the file size, and mappings are stored as an InternalSourceMap
/// blob (varint deltas + sync points) so lookups need no decode pass.
#[derive(Clone, Copy)]
pub struct SerializedSourceMap {
    pub bytes: &'static [u8],
}

/// Following the header bytes:
/// - source_files_count number of StringPointer, file names
/// - source_files_count number of StringPointer, zstd compressed contents
/// - the InternalSourceMap blob, `map_bytes_length` bytes
/// - all the StringPointer contents
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct SerializedSourceMapHeader {
    pub source_files_count: u32,
    pub map_bytes_length: u32,
}

impl SerializedSourceMap {
    pub(crate) fn header(self) -> SerializedSourceMapHeader {
        // SAFETY: bytes.len() >= size_of::<Header>() must hold (caller checked); align(1) read.
        unsafe {
            core::ptr::read_unaligned(self.bytes.as_ptr().cast::<SerializedSourceMapHeader>())
        }
    }

    pub(crate) fn mapping_blob(self) -> Option<&'static [u8]> {
        if self.bytes.len() < size_of::<SerializedSourceMapHeader>() {
            return None;
        }
        let head = self.header();
        let start = size_of::<SerializedSourceMapHeader>()
            + head.source_files_count as usize * size_of::<StringPointer>() * 2;
        if start > self.bytes.len() || head.map_bytes_length as usize > self.bytes.len() - start {
            return None;
        }
        Some(&self.bytes[start..][..head.map_bytes_length as usize])
    }

    // Note: the serialized byte buffer carries no alignment guarantee. Materializing a
    // `&[StringPointer]` would require `align_of::<StringPointer>() == 4` alignment
    // (UB otherwise), so expose count + indexed unaligned reads instead.

    pub(crate) fn source_files_count(self) -> usize {
        self.header().source_files_count as usize
    }

    fn string_pointers_base(self) -> *const StringPointer {
        self.bytes[size_of::<SerializedSourceMapHeader>()..]
            .as_ptr()
            .cast()
    }

    pub(crate) fn source_file_name(self, index: usize) -> StringPointer {
        debug_assert!(index < self.source_files_count());
        // SAFETY: index bounds-checked; layout per Header doc; pointer may be misaligned.
        unsafe { core::ptr::read_unaligned(self.string_pointers_base().add(index)) }
    }
}

/// Once loaded, this map stores additional data for keeping track of source code.
pub struct SerializedSourceMapLoaded {
    pub map: SerializedSourceMap,

    /// Only decompress source code once! Once a file is decompressed,
    /// it is stored here. Decompression failures are stored as an empty
    /// string, which will be treated as "no contents".
    pub decompressed_files: Box<[std::sync::OnceLock<Vec<u8>>]>,
}

pub(crate) fn serialize_json_source_map_for_standalone(
    header_list: &mut Vec<u8>,
    string_payload: &mut Vec<u8>,
    json_source: &[u8],
) -> crate::Result<()> {
    use bun_ast::ExprData as AstData;

    let json_src = bun_ast::Source::init_path_string("sourcemap.json", json_source);
    let mut log = bun_ast::Log::init();

    // the allocator given to the JS parser is not respected for all parts
    // of the parse, so we need to remember to reset the ast store
    let _reset_guard = bun_ast::StoreResetGuard::new();

    let parsed = bun_parsers::json::ParsedJson::parse_json(&json_src, &mut log)
        .map_err(|_| crate::Error::InvalidSourceMap)?;
    let json = parsed.root;

    let mappings_str = json
        .get(b"mappings")
        .ok_or(crate::Error::InvalidSourceMap)?;
    let map_vlq: &[u8] = mappings_str
        .as_utf8_string_literal()
        .ok_or(crate::Error::InvalidSourceMap)?;
    let sources_content = match json
        .get(b"sourcesContent")
        .ok_or(crate::Error::InvalidSourceMap)?
        .data
    {
        AstData::EArrayJSON(arr) => arr,
        _ => return Err(crate::Error::InvalidSourceMap),
    };
    let sources_content = sources_content.get();
    let sources_paths = match json
        .get(b"sources")
        .ok_or(crate::Error::InvalidSourceMap)?
        .data
    {
        AstData::EArrayJSON(arr) => arr,
        _ => return Err(crate::Error::InvalidSourceMap),
    };
    let sources_paths = sources_paths.get();
    if sources_content.items().len() != sources_paths.items().len() {
        return Err(crate::Error::InvalidSourceMap);
    }

    let map_blob = SourceMap::InternalSourceMap::from_vlq(map_vlq, 0)
        .map_err(|_| crate::Error::InvalidSourceMap)?;

    // Every offset/length in the serialized map is a u32 `StringPointer`;
    // anything that cannot be represented is a build error, not a crash.
    let map_blob_len_u32 =
        u32::try_from(map_blob.len()).map_err(|_| crate::Error::SourceMapTooLarge)?;
    let sources_len_u32 =
        u32::try_from(sources_paths.items().len()).map_err(|_| crate::Error::SourceMapTooLarge)?;
    header_list.extend_from_slice(&sources_len_u32.to_le_bytes());
    header_list.extend_from_slice(&map_blob_len_u32.to_le_bytes());

    let string_payload_start_location = size_of::<u32>()
        + size_of::<u32>()
        + size_of::<StringPointer>() * sources_content.items().len() * 2 // path + source
        + map_blob.len();

    for item in sources_paths.items() {
        let decoded = item.as_str().ok_or(crate::Error::InvalidSourceMap)?;

        let offset = string_payload.len();
        string_payload.extend_from_slice(decoded);

        let slice = StringPointer {
            offset: u32::try_from(offset + string_payload_start_location)
                .map_err(|_| crate::Error::SourceMapTooLarge)?,
            length: u32::try_from(string_payload.len() - offset)
                .map_err(|_| crate::Error::SourceMapTooLarge)?,
        };
        header_list.extend_from_slice(&slice.offset.to_le_bytes());
        header_list.extend_from_slice(&slice.length.to_le_bytes());
    }

    for item in sources_content.items() {
        let utf8 = item.as_str().ok_or(crate::Error::InvalidSourceMap)?;

        let offset = string_payload.len();

        let bound = bun_zstd::compress_bound(utf8.len());
        // `ZSTD_compressBound` returns an *error code* (a value near
        // `usize::MAX`) when the input size exceeds `ZSTD_MAX_INPUT_SIZE`;
        // feeding that to `Vec::reserve` below would abort with a capacity
        // overflow instead of failing the build.
        if bun_zstd::is_error(bound) {
            return Err(crate::Error::SourceMapTooLarge);
        }
        string_payload.reserve(bound);
        if let bun_zstd::Result::Err(err_msg) =
            bun_zstd::compress_append(string_payload, utf8, Some(1))
        {
            Output::panic(format_args!(
                "Unexpected error compressing sourcemap: {}",
                bstr::BStr::new(err_msg.as_bytes())
            ));
        }

        let slice = StringPointer {
            offset: u32::try_from(offset + string_payload_start_location)
                .map_err(|_| crate::Error::SourceMapTooLarge)?,
            length: u32::try_from(string_payload.len() - offset)
                .map_err(|_| crate::Error::SourceMapTooLarge)?,
        };
        header_list.extend_from_slice(&slice.offset.to_le_bytes());
        header_list.extend_from_slice(&slice.length.to_le_bytes());
    }

    header_list.extend_from_slice(&map_blob);

    debug_assert!(header_list.len() == string_payload_start_location);
    Ok(())
}
