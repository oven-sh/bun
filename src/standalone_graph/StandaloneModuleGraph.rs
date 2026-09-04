//! Originally, we tried using LIEF to inject the module graph into a MachO segment
//! But this incurred a fixed 350ms overhead on every build, which is unacceptable
//! so we give up on codesigning support on macOS for now until we can find a better solution

use core::mem::{align_of, size_of};
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
use bun_sys::{self as Syscall, E, Fd, FdExt as _, Stat};

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
    /// Directory prefixes derived from `files` keys (no trailing `/`, always posix-separated).
    pub dirs: StringArrayHashMap<()>,
    pub entry_point_id: u32,
    pub compile_exec_argv: &'static [u8],
    pub flags: Flags,
    /// InternalModuleRegistry id → its bytecode inside `bytes` (JSC reads it in place; see `File::bytecode`).
    pub builtin_bytecode: Vec<(u32, *mut [u8])>,
    /// The one shared bytecode string table (`JSC::EncoderStringTable::serialize`) every chunk's payload references by ordinal; installed on the VM's `DecoderStringTable` at startup.
    pub bytecode_string_table: &'static [u8],
    /// The slot table every module's `module_info` body indexes (`ModuleInfoSlotTable`); empty when there is none.
    pub module_info_string_table: &'static [u8],
    /// The first `startup_module_count` of `files` (table order = load order) are the entry
    /// point's static import closure, i.e. what loads before the first `import()`.
    pub startup_module_count: u32,
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
// `get()` returns a raw `*mut`; the only post-init mutation is
// `File::sourcemap` (`LazySourceMap::load`, serialized by `INIT_LOCK`).
struct Instance(core::cell::UnsafeCell<StandaloneModuleGraph>);
// SAFETY: the graph is populated once at startup before any worker threads;
// after that `File::sourcemap` is mutated only under `INIT_LOCK` and
// `File::cached_blob` / `File::wtf_string` are `OnceLock`s. Everything else
// is read-only.
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

    /// Read-only lookups. Use `get()` only for `LazySourceMap::load`.
    pub fn get_ref() -> Option<&'static StandaloneModuleGraph> {
        // SAFETY: `Instance` is `Sync`; the `&self` methods touch only the immutable tables.
        INSTANCE.get().map(|cell| unsafe { &*cell.0.get() })
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
    // `&mut` only for `File::sourcemap` (`LazySourceMap::load`); every other
    // per-`File` access goes through `get_ref()` / `find_ref()`.
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

    fn lookup_file(&self, name: &[u8]) -> Option<&File> {
        #[cfg(windows)]
        {
            let mut buf = PathBuffer::uninit();
            return self.files.get(normalize_file_key(name, &mut buf));
        }
        #[cfg(not(windows))]
        self.files.get(name)
    }

    pub fn find_ref(&self, name: &[u8]) -> Option<&File> {
        if !is_bun_standalone_file_path(name) {
            return None;
        }
        self.lookup_file(name)
    }

    pub fn contains_file(&self, name: &[u8]) -> bool {
        self.find_ref(name).is_some()
    }

    pub fn stat(&self, name: &[u8]) -> Option<Stat> {
        if !is_bun_standalone_file_path(name) {
            return None;
        }
        if let Some(file) = self.lookup_file(name) {
            return Some(file.stat());
        }
        if self.find_dir(name) {
            return Some(dir_stat());
        }
        None
    }

    fn normalize_dir_path<'a>(name: &'a [u8], buf: &'a mut PathBuffer) -> &'a [u8] {
        #[cfg(windows)]
        let name = normalize_file_key(name, buf);
        #[cfg(not(windows))]
        let _ = buf;
        let mut name = name;
        while name.last() == Some(&b'/') {
            name = &name[..name.len() - 1];
        }
        name
    }

    pub fn find_dir(&self, name: &[u8]) -> bool {
        if !is_bun_standalone_file_path(name) {
            return false;
        }
        let mut buf = PathBuffer::uninit();
        let name = Self::normalize_dir_path(name, &mut buf);
        self.dirs.contains_key(name)
    }

    /// Directory `name`'s stored key (posix-separated, no trailing `/`), or
    /// the errno an `open(O_DIRECTORY)` of it would produce.
    pub fn dir_key(&self, name: &[u8]) -> Result<&[u8], E> {
        if !is_bun_standalone_file_path(name) {
            return Err(E::ENOENT);
        }
        let mut buf = PathBuffer::uninit();
        let name = Self::normalize_dir_path(name, &mut buf);
        if let Some(index) = self.dirs.get_index(name) {
            return Ok(&self.dirs.keys()[index]);
        }
        Err(if self.lookup_file(name).is_some() {
            E::ENOTDIR
        } else {
            E::ENOENT
        })
    }

    /// `(entry, is_dir)`; `entry` is the basename, or the `name`-relative path when `recursive`.
    pub fn readdir(&self, name: &[u8], recursive: bool) -> Option<Vec<(Box<[u8]>, bool)>> {
        if !is_bun_standalone_file_path(name) {
            return None;
        }
        let mut buf = PathBuffer::uninit();
        let name = Self::normalize_dir_path(name, &mut buf);
        if !self.dirs.contains_key(name) {
            return None;
        }
        let mut prefix: Vec<u8> = Vec::with_capacity(name.len() + 1);
        prefix.extend_from_slice(name);
        prefix.push(b'/');

        let mut seen: StringArrayHashMap<bool> = StringArrayHashMap::new();
        let mut push = |key: &[u8], is_dir: bool| {
            if key.len() <= prefix.len() || !key.starts_with(&prefix) {
                return;
            }
            let rel = &key[prefix.len()..];
            if recursive {
                let _ = seen.put(rel, is_dir);
            } else if let Some(sep) = strings::index_of_char(rel, b'/') {
                let _ = seen.put(&rel[..sep as usize], true);
            } else {
                let _ = seen.put(rel, is_dir);
            }
        };
        for key in self.files.keys() {
            push(key, false);
        }
        for key in self.dirs.keys() {
            push(key, true);
        }

        let mut out: Vec<(Box<[u8]>, bool)> = Vec::with_capacity(seen.count());
        for (k, v) in seen.iter() {
            out.push((Box::<[u8]>::from(&k[..]), *v));
        }
        Some(out)
    }

    pub fn find_assume_standalone_path(&mut self, name: &[u8]) -> Option<&mut File> {
        #[cfg(windows)]
        {
            let mut buf = PathBuffer::uninit();
            return self.files.get_mut(normalize_file_key(name, &mut buf));
        }
        #[cfg(not(windows))]
        self.files.get_mut(name)
    }
}

#[cfg(windows)]
fn normalize_file_key<'a>(name: &'a [u8], buf: &'a mut PathBuffer) -> &'a [u8] {
    let input = strings::paths::without_nt_prefix::<u8>(name);
    path::resolve_path::platform_to_posix_buf::<u8>(input, buf)
}

// SAFETY: the graph is the process-global INSTANCE singleton (set once at
// startup, never freed) shared by the main VM, Workers and resolver threads.
// The raw pointers in `File` point into the immortal section; `cached_blob`
// and `wtf_string` are `OnceLock`s holding VM-independent state only (null
// `global_this`, shared string impls); `sourcemap` is mutated only under
// `INIT_LOCK`.
unsafe impl Send for StandaloneModuleGraph {}
// SAFETY: see `Send` impl.
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
    fn has_module_info(&self, name: &[u8]) -> bool {
        self.find_ref(name)
            .is_some_and(|file| !file.module_info.is_empty())
    }
    fn find_assume_standalone_path(&self, name: &[u8]) -> Option<&'static [u8]> {
        self.lookup_file(name).map(|f| f.name)
    }

    fn base_public_path_with_default_suffix(&self) -> &'static [u8] {
        BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes()
    }

    fn compile_exec_argv(&self) -> &[u8] {
        self.compile_exec_argv
    }
    fn builtin_module_bytecode(&self, id: u32) -> Option<*mut [u8]> {
        StandaloneModuleGraph::builtin_module_bytecode(self, id)
    }
    fn bytecode_string_table(&self) -> &'static [u8] {
        self.bytecode_string_table
    }
    fn module_graph_load_bytes(&self) -> usize {
        let modules: usize = self
            .files
            .values()
            .iter()
            .filter(|f| f.loader.is_javascript_like() || !f.bytecode.is_empty())
            .map(|f| if f.bytecode.is_empty() { f.contents.len() } else { f.bytecode.len() } + f.module_info.len())
            .sum();
        let builtins: usize = self
            .builtin_bytecode
            .iter()
            .map(|&(_, bytes)| bytes.len())
            .sum();
        modules + builtins + self.bytecode_string_table.len()
    }
    fn page_out(&self) {
        #[cfg(target_os = "linux")]
        {
            if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE::get()
                .unwrap_or(false)
            {
                return;
            }
            let bytes = self.bytes;
            let page = bun_alloc::page_size();
            let lo = (bytes.cast::<u8>() as usize + page - 1) & !(page - 1);
            let hi = (bytes.cast::<u8>() as usize + bytes.len()) & !(page - 1);
            if hi > lo {
                // SAFETY: `[lo, hi)` is inside the mapped executable image. MADV_PAGEOUT reclaims the pages without
                // losing data: clean file-backed pages are dropped and re-read from the file on the next access, the
                // few dirtied (COW) ones go to swap if there is any and otherwise stay.
                unsafe { libc::madvise(lo as *mut core::ffi::c_void, hi - lo, libc::MADV_PAGEOUT) };
            }
        }
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
    /// Little-endian UTF-16 code units at an even section offset. Reuses the
    /// value of the never-written `Utf8` variant so an older runtime reads it
    /// through its plain-copy arm, not as an invalid discriminant.
    Utf16 = 2,
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

    unsafe extern "C" {
        /// `<mach-o/getsect.h>`: the named segment's load command in the main executable.
        fn getsegbyname(
            segname: *const core::ffi::c_char,
        ) -> *const bun_sys::macho::segment_command_64;
        /// `<mach-o/dyld.h>`: the path dyld loaded image `image_index` from.
        fn _dyld_get_image_name(image_index: u32) -> *const core::ffi::c_char;
    }

    /// `F_RDADVISE` on the executable for the file bytes backing `[lo, hi)`: an
    /// asynchronous read into the page cache that returns at once.
    /// (`MADV_WILLNEED` blocks on Darwin until the pages are in, so it is no use
    /// for overlapping I/O with startup.)
    pub(super) fn read_ahead(lo: usize, hi: usize) {
        // SAFETY: NUL-terminated segment name; returns null or a pointer into the
        // main image's load commands, which live as long as the process.
        let segment = unsafe { getsegbyname(c"__BUN".as_ptr()) };
        if segment.is_null() {
            return;
        }
        // SAFETY: non-null per the check above.
        let segment = unsafe { &*segment };
        let slide = bun_sys::c::_dyld_get_image_vmaddr_slide(0) as usize;
        let segment_start = (segment.vmaddr as usize).wrapping_add(slide);
        let segment_end = segment_start.saturating_add(segment.filesize as usize);
        if lo < segment_start || hi > segment_end {
            return;
        }
        // SAFETY: image 0 is the main executable; dyld keeps its NUL-terminated
        // path alive for the life of the process.
        let exe_path = unsafe { bun_core::ZStr::from_c_ptr(_dyld_get_image_name(0)) };
        let Ok(file) = bun_sys::File::open(exe_path, bun_sys::O::RDONLY | bun_sys::O::CLOEXEC, 0)
        else {
            return;
        };
        let advisory = libc::radvisory {
            ra_offset: (lo - segment_start + segment.fileoff as usize) as libc::off_t,
            ra_count: (hi - lo).min(i32::MAX as usize) as core::ffi::c_int,
        };
        // SAFETY: `advisory` is a valid `struct radvisory` for the duration of
        // the call; the fd stays open until `file` drops below.
        let rc = unsafe { libc::fcntl(file.fd().native(), libc::F_RDADVISE, &advisory) };
        bun_core::scoped_log!(
            super::StandaloneModuleGraph,
            "prefetch: F_RDADVISE offset={} count={} rc={}",
            advisory.ra_offset,
            advisory.ra_count,
            rc
        );
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
        // BUN_COMPILED.size holds the link-time virtual address of the
        // appended data. For a PIE executable (mandatory on Android) the
        // kernel maps every PT_LOAD at that vaddr plus a load bias, which is
        // `dlpi_addr` of the object containing BUN_COMPILED itself; for
        // non-PIE it is 0.
        // Format at target: [u64 payload_len][payload bytes]
        // Synthesize a `*mut u8` directly so the provenance carries write
        // permission for the in-place bytecode mutation done by JSC.
        let load_bias =
            bun_sys::elf::find_loaded_module(vaddr_ptr as usize).map_or(0, |m| m.base_address);
        let target = (vaddr as usize).wrapping_add(load_bias) as *mut u8;
        // SAFETY: target points to 8-byte little-endian length prefix.
        let payload_len =
            u64::from_le_bytes(unsafe { core::ptr::read_unaligned(target.cast::<[u8; 8]>()) });
        if payload_len < 8 {
            return None;
        }
        // SAFETY: payload_len bytes follow the 8-byte header at `target`.
        Some((unsafe { target.add(8) }, payload_len as usize))
    }

    /// `MADV_WILLNEED` over `[lo, hi)`: queues page-cache readahead for the
    /// file bytes backing the mapping and returns once the I/O is submitted.
    /// Issued in 128 KiB pieces because one call reads at most
    /// `max(bdi->io_pages, ra_pages)` (device dependent, 128 KiB on some).
    pub(super) fn read_ahead(lo: usize, hi: usize) {
        const PIECE: usize = 128 * 1024;
        let mut at = lo & !(bun_alloc::page_size() - 1);
        while at < hi {
            let len = PIECE.min(hi - at);
            // SAFETY: `[at, at + len)` lies inside the mapped executable
            // image; `MADV_WILLNEED` neither reads nor writes through it.
            let rc =
                unsafe { libc::madvise(at as *mut core::ffi::c_void, len, libc::MADV_WILLNEED) };
            if rc != 0 {
                bun_core::scoped_log!(
                    super::StandaloneModuleGraph,
                    "prefetch: madvise failed errno={}",
                    bun_sys::last_errno()
                );
                return;
            }
            at += len;
        }
        bun_core::scoped_log!(
            super::StandaloneModuleGraph,
            "prefetch: MADV_WILLNEED {} bytes",
            hi - lo
        );
    }
}

pub struct File {
    pub name: &'static [u8],
    pub loader: Loader,
    pub contents: &'static ZStr,
    pub sourcemap: LazySourceMap,
    /// VM-independent `webcore::Blob` template (store, content type, shared name); see
    /// `standalone_graph_jsc::file_blob`.
    pub cached_blob: std::sync::OnceLock<NonNull<Blob>>,
    pub encoding: Encoding,
    wtf_string: std::sync::OnceLock<BunString>,
    utf8: std::sync::OnceLock<Box<[u8]>>,
    // BACKREF into the embedded section; JSC mutates the bytecode buffer in place.
    pub bytecode: *mut [u8],
    pub module_info: *mut [u8],
    /// The file path used when generating bytecode (e.g., "B:/~BUN/root/app.js").
    /// Must match exactly at runtime for bytecode cache hits.
    pub bytecode_origin_path: &'static [u8],
    /// `WTF::StringImpl::hash()` of `contents`, computed at build time (0 = not recorded).
    pub source_hash: u32,
    pub module_format: ModuleFormat,
    pub side: FileSide,
}

impl File {
    /// A text import stored as a string body by `encode_text_module`.
    pub fn is_text_module(&self) -> bool {
        self.loader == Loader::Text
    }

    pub fn appears_in_embedded_files_array(&self) -> bool {
        // A text module's bytes are not the file's UTF-8.
        !self.is_text_module()
            && (self.side == FileSide::Client || !self.loader.is_javascript_like())
    }

    /// An `Encoding::Utf16` body as code units.
    fn utf16_units(&self) -> &'static [u16] {
        debug_assert!(self.encoding == Encoding::Utf16);
        let bytes = self.contents.as_bytes();
        debug_assert!(bytes.as_ptr().addr().is_multiple_of(align_of::<u16>()));
        #[expect(
            clippy::cast_ptr_alignment,
            reason = "`to_bytes` writes UTF-16 at an even offset and the section base is page-aligned (the 128-byte bytecode alignment relies on the same property)"
        )]
        // SAFETY: even byte count at a 2-byte-aligned offset of a section that is never freed.
        unsafe {
            core::slice::from_raw_parts(bytes.as_ptr().cast::<u16>(), bytes.len() / 2)
        }
    }

    /// `contents` as the file's bytes: the section itself, or a UTF-8 transcode of a UTF-16 body made once.
    pub fn utf8_contents(&self) -> &[u8] {
        if self.encoding != Encoding::Utf16 {
            return self.contents.as_bytes();
        }
        self.utf8.get_or_init(|| {
            bun_core::strings::to_utf8_alloc_with_type(self.utf16_units()).into_boxed_slice()
        })
    }

    pub fn stat(&self) -> Stat {
        let mut result: Stat = bun_core::ffi::zeroed();
        result.st_size = self.utf8_contents().len() as _;
        // `Stat` is `libc::stat` (POSIX) / `uv_stat_t` (Windows, `st_mode: u64`).
        result.st_mode = (libc::S_IFREG | 0o644) as _;
        result
    }

    pub fn less_than_by_index(ctx: &[File], lhs_i: u32, rhs_i: u32) -> bool {
        let lhs = &ctx[lhs_i as usize];
        let rhs = &ctx[rhs_i as usize];
        strings::cmp_strings_asc((), lhs.name, rhs.name)
    }

    /// `name` without the `/$bunfs/root/` prefix, as shown to JS (`Blob.name`,
    /// `Bun.embeddedFiles`).
    pub fn display_name(&self) -> &[u8] {
        self.name
            .strip_prefix(BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes())
            .unwrap_or(self.name)
    }

    /// One shared impl per process (see `BunString::make_thread_shareable`); Latin-1/UTF-16
    /// are zero-copy externals over the immortal section.
    pub fn to_wtf_string(&self) -> BunString {
        if self.contents.is_empty() {
            return BunString::EMPTY;
        }
        self.wtf_string
            .get_or_init(|| {
                let mut s = match self.encoding {
                    Encoding::Binary => BunString::clone_utf8(self.contents.as_bytes()),
                    Encoding::Latin1 if self.source_hash != 0 => {
                        // Already thread-shareable: hash known, never atomized.
                        return BunString::create_static_external_latin1_with_hash(
                            self.contents.as_bytes(),
                            self.source_hash,
                        );
                    }
                    Encoding::Latin1 => {
                        BunString::create_static_external(self.contents.as_bytes(), true)
                    }
                    Encoding::Utf16 => {
                        let units = self.utf16_units();
                        if self.source_hash != 0 {
                            return BunString::create_static_external_utf16_with_hash(
                                units,
                                self.source_hash,
                            );
                        }
                        BunString::create_static_external_utf16(units)
                    }
                };
                s.make_thread_shareable();
                s
            })
            .clone()
    }
}

fn dir_stat() -> Stat {
    let mut result: Stat = bun_core::ffi::zeroed();
    result.st_mode = (libc::S_IFDIR | 0o755) as _;
    result
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
        /// Every file's `contents` lies in one run that no bytecode, module
        /// info, name, or source map region overlaps (see `to_bytes`).
        const SOURCE_TEXT_CONTIGUOUS        = 1 << 4;
        /// A `[u32; modules]` of each file's WTF string hash (0 = none) follows
        /// the module table, so loading a module from bytecode never has to
        /// hash — i.e. page in — its source text.
        const HAS_SOURCE_HASHES             = 1 << 5;
        /// After the source hashes: `u32 count`, then `count` × `{ u32 id, StringPointer bytes }` — ahead-of-time
        /// bytecode for internal modules (InternalModuleRegistry ids), read by InternalModuleRegistry::generateModule.
        const HAS_BUILTIN_BYTECODE          = 1 << 6;
        /// After the builtin-bytecode table: one `StringPointer` to the shared bytecode string table (`JSC::EncoderStringTable::serialize`), which every chunk's payload references by ordinal.
        const HAS_BYTECODE_STRING_TABLE     = 1 << 7;
        /// After the string-table pointer: `u32` count of leading modules (in table order) that make up the
        /// entry point's static import closure, i.e. load before the first `import()`; `prefetch_startup_pages` reads ahead what they need.
        const HAS_STARTUP_MODULE_COUNT      = 1 << 8;
        /// After the startup module count: one `StringPointer` to the string table every module's `module_info`
        /// body indexes.
        const HAS_MODULE_INFO_STRING_TABLE  = 1 << 9;
        /// Built with `--compile --bytecode --target=<a different os/arch/libc than the bun that built it>`: the embedded
        /// bytecode was written by another platform's JavaScriptCore. Reported with crash reports.
        const CROSS_COMPILED_BYTECODE       = 1 << 10;
        // _padding: u21
    }
}

const TRAILER: &[u8] = b"\n---- Bun! ----\n";

unsafe extern "C" {
    fn Bun__WTFStringHashLatin1(ptr: *const u8, len: usize) -> u32;
    fn Bun__WTFStringHashUTF16(ptr: *const u16, len: usize) -> u32;
}
/// `WTF::StringImpl::hash()` for an 8-bit string with these bytes.
fn wtf_latin1_string_hash(bytes: &[u8]) -> u32 {
    // SAFETY: reads `len` bytes from `ptr`; pure function.
    unsafe { Bun__WTFStringHashLatin1(bytes.as_ptr(), bytes.len()) }
}

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
                dirs: StringArrayHashMap::new(),
                entry_point_id: 0,
                compile_exec_argv: b"",
                flags: Flags::default(),
                builtin_bytecode: Vec::new(),
                bytecode_string_table: &[],
                module_info_string_table: &[],
                startup_module_count: 0,
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

        let read_u32 = |at: usize| -> u32 {
            debug_assert!(at + 4 <= raw_len);
            // SAFETY: callers pass offsets of records `to_bytes` wrote inside `[0, raw_len)`; unaligned-safe read.
            unsafe { core::ptr::read_unaligned(raw_const.add(at).cast::<u32>()) }
        };

        // The optional records `to_bytes` chains directly after the module table, in `Flags` bit order.
        let mut record_at =
            offsets.modules_ptr.offset as usize + offsets.modules_ptr.length as usize;

        let source_hashes: Option<&[u8]> = if offsets.flags.contains(Flags::HAS_SOURCE_HASHES) {
            let length = modules_list_count * size_of::<u32>();
            // SAFETY: written by `to_bytes` directly after the module table; read-only subrange.
            let hashes = unsafe {
                slice_to(
                    raw_const,
                    raw_len,
                    StringPointer {
                        offset: record_at as u32,
                        length: length as u32,
                    },
                )
            };
            record_at += length;
            Some(hashes)
        } else {
            None
        };

        let mut builtin_bytecode: Vec<(u32, *mut [u8])> = Vec::new();
        if offsets.flags.contains(Flags::HAS_BUILTIN_BYTECODE) {
            let count = read_u32(record_at) as usize;
            record_at += size_of::<u32>();
            builtin_bytecode.reserve(count);
            for _ in 0..count {
                let id = read_u32(record_at);
                let pointer = StringPointer {
                    offset: read_u32(record_at + 4),
                    length: read_u32(record_at + 8),
                };
                record_at += 3 * size_of::<u32>();
                // SAFETY: same provenance rules as `File::bytecode`: a writable subrange JSC may patch in place.
                let bytes = unsafe { slice_to_mut(raw_ptr, raw_len, pointer) };
                builtin_bytecode.push((id, bytes));
            }
        }

        let bytecode_string_table: &'static [u8] =
            if offsets.flags.contains(Flags::HAS_BYTECODE_STRING_TABLE) {
                let ptr = StringPointer {
                    offset: read_u32(record_at),
                    length: read_u32(record_at + 4),
                };
                record_at += 2 * size_of::<u32>();
                // SAFETY: `to_bytes` placed the serialized table via `append_bytecode_aligned` into a read-only, disjoint subrange.
                unsafe { slice_to(raw_const, raw_len, ptr) }
            } else {
                &[]
            };

        let startup_module_count = if offsets.flags.contains(Flags::HAS_STARTUP_MODULE_COUNT)
            && record_at + size_of::<u32>() <= raw_len
        {
            let count = read_u32(record_at);
            record_at += size_of::<u32>();
            count
        } else {
            0
        };
        let module_info_string_table: &'static [u8] =
            if offsets.flags.contains(Flags::HAS_MODULE_INFO_STRING_TABLE)
                && record_at + 2 * size_of::<u32>() <= raw_len
            {
                let ptr = StringPointer {
                    offset: read_u32(record_at),
                    length: read_u32(record_at + 4),
                };
                if (ptr.offset as usize).saturating_add(ptr.length as usize) > raw_len {
                    &[]
                } else {
                    // SAFETY: bounds checked above; read-only subrange placed by `to_bytes`, disjoint from
                    // the writable regions.
                    unsafe { slice_to(raw_const, raw_len, ptr) }
                }
            } else {
                &[]
            };

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
                    source_hash: source_hashes.map_or(0, |h| {
                        u32::from_le_bytes(h[i * 4..i * 4 + 4].try_into().expect("4 bytes"))
                    }),
                    module_format: module.module_format,
                    side: module.side,
                    cached_blob: std::sync::OnceLock::new(),
                    encoding: module.encoding,
                    wtf_string: std::sync::OnceLock::new(),
                    utf8: std::sync::OnceLock::new(),
                },
            );
        }

        let module_count = modules.count();
        modules.lock_pointers(); // make the pointers stable forever

        // Keys are posix-separated already (see `to_bytes`), so byte-scan for `/`.
        let mut dirs = StringArrayHashMap::<()>::new();
        for key in modules.keys() {
            let mut rest: &[u8] = key;
            while let Some(sep) = strings::last_index_of_char(rest, b'/') {
                rest = &rest[..sep as usize];
                if rest.len() < BASE_PUBLIC_PATH.len() || dirs.contains_key(rest) {
                    break;
                }
                let _ = dirs.put(rest, ());
            }
        }
        dirs.lock_pointers();

        Ok(StandaloneModuleGraph {
            // Stored as a raw fat pointer — `byte_count` covers the writable
            // bytecode/module_info regions, so a `&'static [u8]` here would alias them.
            bytes: core::ptr::slice_from_raw_parts(raw_const, offsets.byte_count),
            files: modules,
            dirs,
            entry_point_id: offsets.entry_point_id,
            // SAFETY: read-only argv string subrange, disjoint from writable regions.
            compile_exec_argv: unsafe {
                slice_to_z(raw_const, raw_len, offsets.compile_exec_argv_ptr)
            }
            .as_bytes(),
            flags: offsets.flags,
            builtin_bytecode,
            bytecode_string_table,
            module_info_string_table,
            startup_module_count: startup_module_count.min(module_count as u32),
        })
    }

    /// Ahead-of-time bytecode for internal module `id`, if the executable carries it.
    pub fn builtin_module_bytecode(&self, id: u32) -> Option<*mut [u8]> {
        self.builtin_bytecode
            .iter()
            .find(|(candidate, _)| *candidate == id)
            .map(|(_, bytes)| *bytes)
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

/// A text import the bundler emitted as an asset (`Loader::Text` arm of
/// `ParseTask` in compile mode). The runtime aliases its bytes as a string.
fn is_text_module_output(output_file: &OutputFile) -> bool {
    output_file.loader == Loader::Text && output_file.output_kind == options::OutputKind::Asset
}

/// Stored as a `WTF::StringImpl` body the runtime aliases: a text import or a JS chunk this executable runs.
fn is_stored_as_string(output_file: &OutputFile) -> bool {
    is_text_module_output(output_file)
        || (output_file.loader.is_javascript_like()
            && output_file.side != Some(options::Side::Client))
}

/// Writes `utf8` as a `WTF::StringImpl` body (8-bit if ASCII, else UTF-16 at an even offset) with its hash.
fn encode_text_module(
    string_builder: &mut bun_core::StringBuilder,
    utf8: &[u8],
) -> (StringPointer, Encoding, u32) {
    let Some(first_non_ascii) = strings::first_non_ascii(utf8) else {
        let hash = if utf8.is_empty() {
            0
        } else {
            wtf_latin1_string_hash(utf8)
        };
        return (string_builder.append_count_z(utf8), Encoding::Latin1, hash);
    };
    if !string_builder.len.is_multiple_of(align_of::<u16>()) {
        string_builder.writable()[0] = 0;
        string_builder.len += 1;
    }
    let start = string_builder.len;
    let dst = string_builder.writable();
    assert!(dst.len() >= 2 * utf8.len() + 2);
    // SAFETY: `to_bytes` reserved `2 * utf8.len() + 4` bytes for this file; asserted above.
    let byte_len = unsafe {
        bun_core::strings::write_wtf8_as_utf16le(utf8, first_non_ascii as usize, dst.as_mut_ptr())
    };
    dst[byte_len] = 0;
    dst[byte_len + 1] = 0;
    #[expect(
        clippy::cast_ptr_alignment,
        reason = "written at an even offset just above"
    )]
    // SAFETY: `byte_len` initialized bytes at an even offset of the (page-aligned) section buffer.
    let hash = unsafe { Bun__WTFStringHashUTF16(dst.as_ptr().cast::<u16>(), byte_len / 2) };
    string_builder.len += byte_len + 2;
    (
        StringPointer {
            offset: start as u32,
            length: byte_len as u32,
        },
        Encoding::Utf16,
        hash,
    )
}

/// The embedded bunfs key for an output file, relative to the prefix.
fn module_dest_path(output_file: &OutputFile) -> &[u8] {
    bun_core::strings::remove_leading_dot_slash(&output_file.dest_path)
}

/// Every region of the serialized graph is addressed by a `StringPointer`, a `u32` offset and
/// length, so the graph has to fit in 4 GiB. A debug build can lower the limit through
/// `BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES` so a test reaches it without a 4 GiB input.
fn max_graph_bytes() -> usize {
    let limit = u32::MAX as usize;
    #[cfg(debug_assertions)]
    if let Some(test_limit) = bun_core::env_var::BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES.get() {
        return usize::try_from(test_limit).map_or(limit, |test_limit| test_limit.min(limit));
    }
    limit
}

pub(crate) fn to_bytes(
    target: &CompileTarget,
    prefix: &[u8],
    output_files: &[OutputFile],
    output_format: Format,
    compile_exec_argv: &[u8],
    flags: Flags,
) -> crate::Result<Vec<u8>> {
    // RAII trace handle ends on drop.
    let _serialize_trace = bun_perf::trace(bun_perf::PerfEvent::StandaloneModuleGraphSerialize);

    let is_entry_point = |output_file: &OutputFile| {
        output_file.output_kind == options::OutputKind::EntryPoint
            && (output_file.side.is_none() || output_file.side == Some(options::Side::Server))
    };

    let mut has_entry_point = false;
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
            } else if output_file.output_kind == options::OutputKind::Bytecode
                || output_file.output_kind == options::OutputKind::BuiltinBytecode
                || output_file.output_kind == options::OutputKind::BytecodeStringTable
            {
                // Allocate up to 256 byte alignment for bytecode (+ a table record for builtin bytecode)
                string_builder.cap += bytes.len().div_ceil(256) * 256 + 256 + 16;
            } else if output_file.output_kind == options::OutputKind::ModuleInfo {
                string_builder.cap += bytes.len();
            } else if output_file.output_kind == options::OutputKind::ModuleInfoStringTable {
                string_builder.cap += bytes.len() + 2 * size_of::<u32>();
            } else {
                has_entry_point |= is_entry_point(output_file);

                string_builder.count_z(bytes);
                if is_stored_as_string(output_file) {
                    // UTF-16 worst case: 2 bytes per byte, padding, 2-byte NUL.
                    string_builder.cap += bytes.len() + 3;
                }
                module_count += 1;
            }
        }
    }

    if module_count == 0 || !has_entry_point {
        return Ok(Vec::new());
    }

    string_builder.cap +=
        (size_of::<CompiledModuleGraphFile>() + size_of::<u32>()) * output_files.len();
    string_builder.cap += TRAILER.len();
    string_builder.cap += 16 + 2 * size_of::<u32>();
    string_builder.cap += size_of::<Offsets>();
    string_builder.count_z(compile_exec_argv);

    string_builder.allocate()?;

    let mut module_files: Vec<&OutputFile> = Vec::with_capacity(module_count);
    let mut entry_point_file: Option<&OutputFile> = None;
    // `Graph::from_bytes` keys files by path; a repeat would shift `entry_point_id`.
    let mut seen_paths: StringArrayHashMap<()> = StringArrayHashMap::new();

    for output_file in output_files {
        if !output_file.output_kind.is_file_in_standalone_mode() {
            continue;
        }

        if !matches!(output_file.value, options::OutputFileValue::Buffer { .. }) {
            continue;
        }

        // Same `[name]` and `[hash]` means the same bytes: keep the first copy.
        if seen_paths
            .get_or_put(module_dest_path(output_file))?
            .found_existing
        {
            continue;
        }
        if entry_point_file.is_none() && is_entry_point(output_file) {
            entry_point_file = Some(output_file);
        }
        module_files.push(output_file);
    }
    let Some(entry_point_file) = entry_point_file else {
        return Ok(Vec::new());
    };
    // Every per-module region below is written in load order (entry point's
    // static imports first, then dynamic imports breadth-first) so the modules
    // a process actually loads share pages instead of each dragging in its own.
    module_files.sort_by_key(|f| f.load_order);
    let entry_point_id = module_files
        .iter()
        .position(|f| core::ptr::eq(*f, entry_point_file))
        .unwrap();

    // The internal-module bytecode and the string table go right after the
    // last startup module's bytecode, so everything a cold start decodes
    // before the first `import()` is one run of pages (`prefetch_startup_pages`).
    let startup_module_count = module_files
        .iter()
        .take_while(|f| f.loads_at_startup)
        .count();
    let mut shared_bytecode: Option<(Vec<u8>, StringPointer, StringPointer)> = None;

    let mut modules: Vec<CompiledModuleGraphFile> = Vec::with_capacity(module_files.len());
    for (i, &output_file) in module_files.iter().enumerate() {
        if i == startup_module_count {
            shared_bytecode = Some(append_shared_bytecode(&mut string_builder, output_files));
        }
        let buf_bytes = output_file.value.as_slice();

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
                // - ELF (Linux): the payload is mapped by the kernel as part of the
                //   RW PT_LOAD (see exe_format/elf.rs) at a page-aligned address, also
                //   preceded by the same 8-byte length header, so the same arithmetic
                //   applies.
                let bytecode = output_files[output_file.bytecode_index as usize]
                    .value
                    .as_slice();
                break 'brk append_bytecode_aligned(&mut string_builder, bytecode);
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
                bun_core::scoped_log!(
                    StandaloneModuleGraph,
                    "module_info {}: {} bytes (js {} bytes, bytecode {} bytes)",
                    bstr::BStr::new(&output_file.dest_path),
                    mi_bytes.len(),
                    output_file.value.as_slice().len(),
                    bytecode.length
                );
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
                let dest_path = module_dest_path(output_file);
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

        modules.push(CompiledModuleGraphFile {
            name: StringPointer::default(),
            loader: output_file.loader,
            contents: StringPointer::default(),
            encoding: Encoding::Binary,
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
            bytecode_origin_path: StringPointer::default(),
            side: match output_file.side.unwrap_or(options::Side::Server) {
                options::Side::Server => FileSide::Server,
                options::Side::Client => FileSide::Client,
            },
            sourcemap: StringPointer::default(),
        });
    }

    let (builtin_bytecode_table, bytecode_string_table_ptr, module_info_string_table_ptr) =
        shared_bytecode
            .unwrap_or_else(|| append_shared_bytecode(&mut string_builder, output_files));

    // Region layout after the bytecode/module_info run above: source maps
    // (unread until an error prints), then every file's source text as one run
    // (`Flags::SOURCE_TEXT_CONTIGUOUS`, so `hint_source_pages_dont_need` can
    // drop exactly it), then everything booting touches — names, origin paths,
    // the module table — packed at the tail so startup faults in a few pages
    // instead of one per embedded file.
    let mut source_map_header_list: Vec<u8> = Vec::new();
    let mut source_map_string_list: Vec<u8> = Vec::new();
    for (module, output_file) in modules.iter_mut().zip(&module_files) {
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
    }

    let mut source_hashes: Vec<u8> = Vec::with_capacity(modules.len() * size_of::<u32>());
    for (module, output_file) in modules.iter_mut().zip(&module_files) {
        let mut hash = 0u32;
        if is_stored_as_string(output_file) {
            (module.contents, module.encoding, hash) =
                encode_text_module(&mut string_builder, output_file.value.as_slice());
        } else {
            module.contents = string_builder.append_count_z(output_file.value.as_slice());
        }
        // `Flags::HAS_SOURCE_HASHES`: JSC's SourceCodeKey hash, so a launch from bytecode never reads the source text.
        if !output_file.loader.is_javascript_like() {
            hash = 0;
        }
        source_hashes.extend_from_slice(&hash.to_le_bytes());
    }

    for (module, output_file) in modules.iter_mut().zip(&module_files) {
        module.name = string_builder.fmt_append_count_z(format_args!(
            "{}{}",
            bstr::BStr::new(prefix),
            bstr::BStr::new(module_dest_path(output_file))
        ));
        // The bytecode cache was generated under the bytecode output file's
        // path; the runtime must present exactly the same path to hit it.
        if output_file.bytecode_index != u32::MAX {
            module.bytecode_origin_path = string_builder
                .append_count_z(&output_files[output_file.bytecode_index as usize].dest_path);
        }
    }

    // SAFETY: `CompiledModuleGraphFile` is `#[repr(C)]` POD with no padding-dependent
    // invariants; reinterpreting its backing storage as bytes is sound.
    let modules_as_bytes: &[u8] = unsafe {
        core::slice::from_raw_parts(
            modules.as_ptr().cast::<u8>(),
            modules.len() * size_of::<CompiledModuleGraphFile>(),
        )
    };
    let modules_ptr = string_builder.append_count(modules_as_bytes);
    let hashes_ptr = string_builder.append_count(&source_hashes);
    debug_assert_eq!(hashes_ptr.offset, modules_ptr.offset + modules_ptr.length);
    let builtin_table_ptr = string_builder.append_count(&builtin_bytecode_table);
    debug_assert_eq!(
        builtin_table_ptr.offset,
        hashes_ptr.offset + hashes_ptr.length
    );
    let mut flags = flags
        | Flags::SOURCE_TEXT_CONTIGUOUS
        | Flags::HAS_SOURCE_HASHES
        | Flags::HAS_BUILTIN_BYTECODE;
    if bytecode_string_table_ptr.length != 0 {
        let mut record = [0u8; 8];
        record[0..4].copy_from_slice(&bytecode_string_table_ptr.offset.to_le_bytes());
        record[4..8].copy_from_slice(&bytecode_string_table_ptr.length.to_le_bytes());
        let _ = string_builder.append_count(&record);
        flags |= Flags::HAS_BYTECODE_STRING_TABLE;
    }
    let _ = string_builder.append_count(&(startup_module_count as u32).to_le_bytes());
    flags |= Flags::HAS_STARTUP_MODULE_COUNT;
    if module_info_string_table_ptr.length != 0 {
        let mut record = [0u8; 8];
        record[0..4].copy_from_slice(&module_info_string_table_ptr.offset.to_le_bytes());
        record[4..8].copy_from_slice(&module_info_string_table_ptr.length.to_le_bytes());
        let _ = string_builder.append_count(&record);
        flags |= Flags::HAS_MODULE_INFO_STRING_TABLE;
    }
    if !target.is_host_platform()
        && output_files
            .iter()
            .any(|file| file.output_kind == options::OutputKind::Bytecode)
    {
        flags |= Flags::CROSS_COMPILED_BYTECODE;
    }
    let compile_exec_argv_ptr = string_builder.append_count_z(compile_exec_argv);

    // Every region above is addressed by a `StringPointer`, so `len` itself has to fit in u32
    // or the `as u32` casts that built those pointers have wrapped.
    if string_builder.len > max_graph_bytes() {
        return Err(crate::Error::ModuleGraphTooLarge);
    }

    let offsets = Offsets {
        entry_point_id: entry_point_id as u32,
        modules_ptr,
        compile_exec_argv_ptr,
        byte_count: string_builder.len,
        flags,
    };

    // SAFETY: `Offsets` is `#[repr(C)]` POD; same `modules_as_bytes` rationale as above.
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
        graph.dirs.unlock_pointers();

        // `Flags::SOURCE_TEXT_CONTIGUOUS`: no other region may fall inside the
        // source-text run, or the runtime's MADV_DONTNEED would drop it.
        let range = |p: StringPointer| p.offset..p.offset + p.length;
        let lo = modules.iter().map(|m| m.contents.offset).min().unwrap();
        let hi = modules.iter().map(|m| range(m.contents).end).max().unwrap();
        let others = modules.iter().flat_map(|m| {
            [
                m.bytecode,
                m.module_info,
                m.sourcemap,
                m.name,
                m.bytecode_origin_path,
            ]
        });
        for p in others.chain([offsets.modules_ptr, offsets.compile_exec_argv_ptr]) {
            let r = range(p);
            debug_assert!(p.length == 0 || r.end <= lo || r.start >= hi);
        }
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
    pub fn fmt(args: core::fmt::Arguments<'_>) -> CompileError {
        let mut v = Vec::new();
        let _ = write!(&mut v, "{}", args);
        CompileError::Message(v)
    }

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
        CompileResult::Err(CompileError::fmt(args))
    }
}

/// The temp copy of the executable that `inject` wrote the module graph into:
/// its open fd plus the absolute path it was created at, which the caller
/// renames into place (an fd cannot be mapped back to a path on every
/// filesystem).
pub(crate) struct Injected<'a> {
    pub fd: Fd,
    pub temp_path: &'a ZStr,
}

impl<'a> Injected<'a> {
    /// `zname` was opened relative to `cwd` (or is already absolute); pin it in
    /// `temp_path_buf` so a later `chdir` cannot retarget the rename/unlink.
    fn new(fd: Fd, cwd: &[u8], zname: &ZStr, temp_path_buf: &'a mut PathBuffer) -> Injected<'a> {
        let len = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
            cwd,
            &mut temp_path_buf[..],
            &[zname.as_bytes()],
        )
        .len();
        Injected {
            fd,
            temp_path: ZStr::from_buf(&temp_path_buf[..], len),
        }
    }
}

pub(crate) fn inject<'a>(
    bytes: &[u8],
    self_exe: &ZStr,
    inject_options: &InjectOptions,
    target: &CompileTarget,
    temp_path_buf: &'a mut PathBuffer,
) -> Option<Injected<'a>> {
    let mut cwd_buf = bun_paths::path_buffer_pool::get();
    let cwd: &[u8] = match bun_sys::getcwd(&mut cwd_buf) {
        Ok(len) => &cwd_buf[..len],
        Err(err) => {
            bun_core::pretty_errorln!(
                "<r><red>error<r><d>:<r> failed to get the current directory\n{}",
                err
            );
            return None;
        }
    };
    let mut buf = PathBuffer::uninit();
    // Note: `tmpname` borrows `buf` mutably for the &ZStr it returns. The
    // tmpdir-fallback retry below may need to repoint `zname` at a heap-owned
    // buffer instead, so hoist that owner here so it outlives the loop.
    let mut zname_owned: Option<Box<[u8]>> = None;
    let mut zname: &ZStr = match bun_fs::FileSystem::tmpname(
        b"bun-build",
        &mut buf[..],
        // tmpname OR's this seed with nano_timestamp(). milli_timestamp() is a
        // bit-subset of nanos and so adds zero entropy; fast_random() is seeded
        // from the OS CSPRNG per process, which keeps concurrent
        // `bun build --compile` invocations from colliding on the same temp
        // name in a shared cwd (the per-process counter is always 0 here).
        bun_core::fast_random(),
    ) {
        Ok(n) => n,
        Err(e) => {
            bun_core::pretty_errorln!(
                "<r><red>error<r><d>:<r> failed to get temporary file name: {}",
                bstr::BStr::new(e.name())
            );
            return None;
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
            // SAFETY: both buffers NUL-terminated above; `CopyFileW` does not
            // retain the pointers past return.
            if unsafe { w::CopyFileW(in_buf.as_ptr(), out_buf.as_ptr(), w::FALSE) } == w::FALSE {
                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {}",
                    w::last_system_errno()
                );
                return None;
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
                    return None;
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
                    // Not 0: WSL2 DrvFS re-checks the mode on ftruncate() (#40111).
                    0o600,
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
                                _ => {}
                            }
                        }
                        bun_core::pretty_errorln!(
                            "<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{}",
                            err
                        );
                        return None;
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
                        return None;
                    }
                }
            }
            unreachable!()
        };

        #[cfg(not(windows))]
        {
            let _self_fd_guard = Syscall::CloseOnDrop::new(self_fd);

            if let Err(e) = bun_sys::copy_file(self_fd, fd) {
                bun_core::pretty_errorln!(
                    "<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {}",
                    e
                );
                cleanup(zname, fd);
                return None;
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
                    return None;
                }
            };
            let mut macho_file = match bun_macho::MachoFile::init(&input_bytes, bytes.len()) {
                Ok(f) => f,
                Err(e) => {
                    bun_core::pretty_errorln!("Error initializing standalone module graph: {}", e);
                    cleanup(zname, cloned_executable_fd);
                    return None;
                }
            };
            if let Err(e) = macho_file.write_section(bytes) {
                bun_core::pretty_errorln!("Error writing standalone module graph: {}", e);
                cleanup(zname, cloned_executable_fd);
                return None;
            }
            drop(input_bytes);

            if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                bun_core::pretty_errorln!("Error seeking to start of temporary file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return None;
            }

            let mut buffered_writer = std::io::BufWriter::with_capacity(
                512 * 1024,
                bun_sys::FileWriter(cloned_executable_fd),
            );
            let written = match macho_file.build_and_sign(&mut buffered_writer) {
                Ok(n) => n,
                Err(e) => {
                    bun_core::pretty_errorln!(
                        "Error writing standalone module graph: {}",
                        bstr::BStr::new(e.name())
                    );
                    cleanup(zname, cloned_executable_fd);
                    return None;
                }
            };
            if let Err(e) = std::io::Write::flush(&mut buffered_writer) {
                bun_core::pretty_errorln!("Error flushing standalone module graph: {}", e);
                cleanup(zname, cloned_executable_fd);
                return None;
            }
            // The template copy may be longer than the signed output; codesign rejects bytes past the signature.
            if let Err(err) = Syscall::ftruncate(
                cloned_executable_fd,
                i64::try_from(written).expect("int cast"),
            ) {
                bun_core::pretty_errorln!("Error truncating temporary file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return None;
            }
            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o755) };
            }
            return Some(Injected::new(
                cloned_executable_fd,
                cwd,
                zname,
                temp_path_buf,
            ));
        }
        CompileTargetOs::Windows => {
            let input_bytes = match bun_sys::File::borrow(&cloned_executable_fd).read_to_end() {
                Ok(b) => b,
                Err(err) => {
                    bun_core::pretty_errorln!("Error reading standalone module graph: {}", err);
                    cleanup(zname, cloned_executable_fd);
                    return None;
                }
            };
            let mut pe_file = match bun_pe::PEFile::init(&input_bytes) {
                Ok(f) => f,
                Err(e) => {
                    bun_core::pretty_errorln!("Error initializing PE file: {}", e);
                    cleanup(zname, cloned_executable_fd);
                    return None;
                }
            };
            if inject_options.hide_console {
                if let Err(e) = pe_file.set_subsystem(bun_pe::IMAGE_SUBSYSTEM_WINDOWS_GUI) {
                    bun_core::pretty_errorln!("Error setting PE subsystem: {}", e);
                    cleanup(zname, cloned_executable_fd);
                    return None;
                }
            }
            // Always strip authenticode when adding .bun section for --compile
            if let Err(e) = pe_file.add_bun_section(bytes) {
                bun_core::pretty_errorln!("Error adding Bun section to PE file: {}", e);
                cleanup(zname, cloned_executable_fd);
                return None;
            }
            drop(input_bytes);

            if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                bun_core::pretty_errorln!("Error seeking to start of temporary file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return None;
            }

            let mut writer = bun_sys::FileWriter(cloned_executable_fd);
            if let Err(e) = pe_file.write(&mut writer) {
                bun_core::pretty_errorln!("Error writing PE file: {}", bstr::BStr::new(e.name()));
                cleanup(zname, cloned_executable_fd);
                return None;
            }
            // Truncate to the in-memory PE size; Authenticode strip can make it shorter than the base.
            if let Err(err) = Syscall::ftruncate(
                cloned_executable_fd,
                i64::try_from(pe_file.len()).expect("int cast"),
            ) {
                bun_core::pretty_errorln!("Error truncating PE file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return None;
            }
            // Set executable permissions when running on POSIX hosts, even for Windows targets
            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o755) };
            }
            return Some(Injected::new(
                cloned_executable_fd,
                cwd,
                zname,
                temp_path_buf,
            ));
        }
        CompileTargetOs::Linux | CompileTargetOs::Freebsd => {
            // ELF section approach: find .bun section and expand it
            let input_bytes = match bun_sys::File::borrow(&cloned_executable_fd).read_to_end() {
                Ok(b) => b,
                Err(err) => {
                    bun_core::pretty_errorln!("Error reading executable: {}", err);
                    cleanup(zname, cloned_executable_fd);
                    return None;
                }
            };

            let mut elf_file = match bun_elf::ElfFile::init(input_bytes) {
                Ok(f) => f,
                Err(e) => {
                    bun_core::pretty_errorln!("Error initializing ELF file: {}", e);
                    cleanup(zname, cloned_executable_fd);
                    return None;
                }
            };

            elf_file.normalize_interpreter();

            if let Err(e) = elf_file.write_bun_section(bytes) {
                bun_core::pretty_errorln!("Error writing .bun section to ELF: {}", e);
                cleanup(zname, cloned_executable_fd);
                return None;
            }

            if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                bun_core::pretty_errorln!("Error seeking to start of temporary file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return None;
            }

            // Write the modified ELF data back to the file
            let write_file = bun_sys::File::borrow(&cloned_executable_fd);
            if let Err(err) = write_file.write_all(&elf_file.data) {
                bun_core::pretty_errorln!("Error writing ELF file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return None;
            }
            // Truncate the file to the exact size of the modified ELF
            if let Err(err) = Syscall::ftruncate(
                cloned_executable_fd,
                i64::try_from(elf_file.data.len()).expect("int cast"),
            ) {
                bun_core::pretty_errorln!("Error truncating ELF file: {}", err);
                cleanup(zname, cloned_executable_fd);
                return None;
            }

            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o755) };
            }
            return Some(Injected::new(
                cloned_executable_fd,
                cwd,
                zname,
                temp_path_buf,
            ));
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
                            return None;
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
                            return None;
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
                    return None;
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
                        return None;
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

            return Some(Injected::new(
                cloned_executable_fd,
                cwd,
                zname,
                temp_path_buf,
            ));
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
    env: &mut bun_dotenv::Loader,
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
                b"",
                http_proxy,
                bun_http::FetchRedirect::Follow,
            ));
            async_http.client.progress_node =
                core::ptr::NonNull::new(core::ptr::from_mut(progress));
            async_http.client.flags.reject_unauthorized = reject_unauthorized;
            let send_result = async_http.send_sync(&mut compressed_archive_bytes);

            progress.end();
            let status_code = send_result?.status_code() as u16;

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

/// The bun executable a `--compile` build for `target` injects into: `self_exe_path` if given, this process for the
/// host target, otherwise the cached download of that platform's bun at this version (fetched now if missing).
pub fn target_executable(
    target: &CompileTarget,
    env: &mut bun_dotenv::Loader,
    self_exe_path: Option<&[u8]>,
) -> Result<bun_core::ZBox, CompileError> {
    Ok(if let Some(path) = self_exe_path {
        bun_core::ZBox::from_vec_with_nul(path.to_vec())
    } else if target.is_default() {
        match bun_core::self_exe_path() {
            Ok(p) => bun_core::ZBox::from_vec_with_nul(p.as_bytes().to_vec()),
            Err(e) => {
                return Err(CompileError::fmt(format_args!(
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
                return Err(match e {
                    crate::Error::TargetNotFound => CompileError::fmt(format_args!(
                        "Target platform '{}' is not available for download. Check if this version of Bun supports this target.",
                        target
                    )),
                    crate::Error::NetworkError => CompileError::fmt(format_args!(
                        "Network error downloading executable for '{}'. Check your internet connection and proxy settings.",
                        target
                    )),
                    crate::Error::InvalidResponse => CompileError::fmt(format_args!(
                        "Downloaded file for '{}' appears to be corrupted. Please try again.",
                        target
                    )),
                    crate::Error::ExtractionFailed => CompileError::fmt(format_args!(
                        "Failed to extract executable for '{}'. The download may be incomplete.",
                        target
                    )),
                    _ => CompileError::fmt(format_args!(
                        "Failed to download '{}': {}",
                        target,
                        bstr::BStr::new(e.name())
                    )),
                });
            }
        }

        bun_core::ZBox::from_vec_with_nul(dest_z.as_bytes().to_vec())
    })
}

/// `--compile --bytecode` for another platform: that executable's builtins section (`bun_exe_format::builtins`), so
/// the bundler can generate bytecode for *its* internal modules. `Ok(None)` when the executable has no section this bun
/// can read; builtin bytecode is skipped then.
pub fn target_builtins(
    target: &CompileTarget,
    env: &mut bun_dotenv::Loader,
    self_exe_path: Option<&[u8]>,
) -> Result<Option<std::sync::Arc<[u8]>>, CompileError> {
    use bun_exe_format::builtins::{Builtins, BuiltinsError, find_section};
    let exe = target_executable(target, env, self_exe_path)?;
    let file = match bun_sys::File::read_from(Fd::cwd(), exe.as_bytes()) {
        Ok(bytes) => bytes,
        Err(e) => {
            return Err(CompileError::fmt(format_args!(
                "failed to read executable for '{}': {}",
                target, e
            )));
        }
    };
    match find_section(&file).and_then(|section| Builtins::parse(section).map(|_| section)) {
        Ok(section) => Ok(Some(std::sync::Arc::from(section))),
        // No section (a bun from before there was one), a newer layout than this bun reads, or a container this reader
        // doesn't handle: its internal modules load from source. A section that is there but malformed is an error.
        Err(
            BuiltinsError::MissingSection
            | BuiltinsError::UnsupportedVersion
            | BuiltinsError::UnrecognizedExecutable,
        ) => Ok(None),
        Err(e) => Err(CompileError::fmt(format_args!(
            "failed to read the builtin modules of the executable for '{}': {}",
            target, e
        ))),
    }
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
        target,
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

    let self_exe = match target_executable(target, env, self_exe_path) {
        Ok(p) => p,
        Err(e) => return Ok(CompileResult::Err(e)),
    };

    let mut temp_path_buf = bun_paths::path_buffer_pool::get();
    let Some(injected) = inject(
        &bytes,
        &self_exe,
        windows_options,
        target,
        &mut temp_path_buf,
    ) else {
        // inject() has already printed the specific error.
        return Ok(CompileResult::fail_fmt(format_args!(
            "failed to write compiled executable {}",
            bstr::BStr::new(outfile)
        )));
    };
    let fd = injected.fd;
    // Closed explicitly at every return below rather than by a guard: on Windows
    // the handle has to be closed mid-function, before `MoveFileExW`.
    debug_assert!(fd.kind() == bun_sys::FdKind::System);

    #[cfg(unix)]
    {
        // Set executable permissions (0o755 = rwxr-xr-x) - makes it executable for owner, readable/executable for group and others
        let _ = Syscall::fchmod(fd, 0o755);
    }

    #[cfg(windows)]
    {
        let temp_path: &[u8] = injected.temp_path.as_bytes();

        // Build the absolute destination path
        // On Windows, we need an absolute path for MoveFileExW
        // Get the current working directory and join with outfile
        let mut cwd_buf = PathBuffer::uninit();
        let cwd_path: &[u8] = match bun_sys::getcwd(&mut cwd_buf) {
            Ok(len) => &cwd_buf[..len],
            Err(e) => {
                fd.close();
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

        use bun_sys::windows;
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
            let err = windows::last_system_errno();
            let _ = Syscall::unlink(injected.temp_path);
            if err == bun_sys::SystemErrno::EISDIR {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "{} is a directory. Please choose a different --outfile or delete the directory",
                    bstr::BStr::new(outfile)
                )));
            }
            return Ok(CompileResult::fail_fmt(format_args!(
                "failed to move executable to {}: {}",
                bstr::BStr::new(dest_path),
                err
            )));
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
        let temp_posix = injected.temp_path;
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
                    bstr::BStr::new(temp_posix.as_bytes()),
                    bstr::BStr::new(outfile),
                    bstr::BStr::new(e.name())
                )));
            }
        }

        fd.close();
        Ok(CompileResult::Success)
    }
}

impl StandaloneModuleGraph {
    /// Loads the standalone module graph from the executable, allocates it on the heap,
    /// sets it globally, and returns the pointer.
    pub fn from_executable() -> crate::Result<Option<*mut StandaloneModuleGraph>> {
        #[cfg(target_os = "macos")]
        let data = macho::get_data();
        #[cfg(windows)]
        let data = pe::get_data();
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        let data = elf::get_data();
        #[cfg(not(any(
            target_os = "macos",
            windows,
            target_os = "linux",
            target_os = "android",
            target_os = "freebsd"
        )))]
        let data: Option<(*mut u8, usize)> = None;
        let Some((base, len)) = data else {
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
        let trailer_bytes =
            unsafe { core::slice::from_raw_parts(base.add(len - TRAILER.len()), TRAILER.len()) };
        if trailer_bytes != TRAILER {
            bun_core::debug_warn!("bun standalone module graph has invalid trailer");
            return Ok(None);
        }
        // SAFETY: offsets_ptr has at least size_of::<Offsets>() bytes.
        let offsets: Offsets = unsafe { core::ptr::read_unaligned(offsets_ptr.cast::<Offsets>()) };
        let graph = from_bytes_alloc(base, len, offsets)?;
        // SAFETY: `from_bytes_alloc` just allocated `graph` for the life of the process.
        unsafe { &*graph }.prefetch_startup_pages();
        Ok(Some(graph))
    }

    /// Starts reading the payload pages the entry point's static import closure
    /// needs — its modules' bytecode (or source text when there is none), the
    /// internal-module bytecode and the string table, one run by construction
    /// (`to_bytes`) — so on a cold start the disk reads overlap JSC
    /// initialization instead of arriving one page fault at a time while the
    /// bytecode decodes. Pages already cached cost nothing; errors are ignored.
    /// `BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE=1` skips it.
    fn prefetch_startup_pages(&self) {
        if self.startup_module_count == 0
            || bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE::get()
                .unwrap_or(false)
        {
            return;
        }
        let startup = &self.files.values()[..self.startup_module_count as usize];
        let span = if startup.iter().any(|f| !f.bytecode.is_empty()) {
            address_span(
                startup
                    .iter()
                    .flat_map(|f| [f.bytecode, f.module_info])
                    .chain(self.builtin_bytecode.iter().map(|&(_, bytes)| bytes))
                    .map(|bytes| (bytes.cast::<u8>().cast_const(), bytes.len()))
                    .chain([(
                        self.bytecode_string_table.as_ptr(),
                        self.bytecode_string_table.len(),
                    )]),
            )
        } else {
            address_span(
                startup
                    .iter()
                    .map(|f| (f.contents.as_bytes().as_ptr(), f.contents.len())),
            )
        };
        let Some((lo, hi)) = span else {
            return;
        };
        #[cfg(target_os = "macos")]
        macho::read_ahead(lo, hi);
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        elf::read_ahead(lo, hi);
        #[cfg(windows)]
        let _ = (lo, hi);
    }

    /// Hint to the kernel that the embedded source text is unlikely to be
    /// accessed again after the entrypoint has been evaluated. The pages are
    /// clean file-backed COW, so any later read (lazy require, stack-trace
    /// source lookup, `Bun.embeddedFiles`) faults back in transparently from
    /// the executable on disk. Only the contiguous source-text run written by
    /// `to_bytes` is dropped: JSC keeps decoding function bodies out of the
    /// bytecode regions for the life of the process, and dropping those turns
    /// every first call into a page fault. Only applies when running as a
    /// compiled standalone binary; `BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE=1`
    /// skips the hint.
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    pub fn hint_source_pages_dont_need() {
        let Some(graph) = Self::get_ref() else {
            return;
        };
        if bun_core::env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE::get()
            .unwrap_or(false)
        {
            return;
        }
        let Some((start, end)) = graph.source_text_pages() else {
            bun_core::scoped_log!(
                StandaloneModuleGraph,
                "hintSourcePagesDontNeed: no whole source-text page to drop"
            );
            return;
        };

        // This is a best-effort hint, so call libc madvise directly and
        // just log on failure rather than treating errors as fatal.
        // SAFETY: start..end lies inside the mapped executable image, and
        // MADV_DONTNEED neither reads nor writes through it.
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
        } else {
            bun_core::scoped_log!(
                StandaloneModuleGraph,
                "hintSourcePagesDontNeed: MADV_DONTNEED {} bytes",
                end - start
            );
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
    pub fn hint_source_pages_dont_need() {}

    /// The whole pages covered by the files' `contents` regions: `(start, end)`
    /// rounded inward, or `None` when the run does not cover a full page or the
    /// payload was not written with `Flags::SOURCE_TEXT_CONTIGUOUS` (an older
    /// `bun build` interleaves bytecode with the source text).
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    fn source_text_pages(&self) -> Option<(usize, usize)> {
        if !self.flags.contains(Flags::SOURCE_TEXT_CONTIGUOUS) {
            return None;
        }
        let (lo, hi) = address_span(
            self.files
                .values()
                .iter()
                .map(|f| (f.contents.as_bytes().as_ptr(), f.contents.len())),
        )?;
        let page = bun_alloc::page_size();
        let start = (lo + page - 1) & !(page - 1);
        let end = hi & !(page - 1);
        (end > start).then_some((start, end))
    }
}

/// `[lo, hi)` covering every non-empty `(ptr, len)` region, or `None` if there is none.
fn address_span(regions: impl Iterator<Item = (*const u8, usize)>) -> Option<(usize, usize)> {
    let (lo, hi) = regions
        .filter(|&(_, len)| len != 0)
        .fold((usize::MAX, 0usize), |(lo, hi), (ptr, len)| {
            (lo.min(ptr as usize), hi.max(ptr as usize + len))
        });
    (lo < hi).then_some((lo, hi))
}

/// Writes the ahead-of-time bytecode of the internal modules, the shared
/// bytecode string table and the module-info string table. Returns the builtin
/// table (`u32 count`, then `count` × `{ u32 id, StringPointer bytes }`) and
/// the two string tables' pointers.
fn append_shared_bytecode(
    string_builder: &mut bun_core::StringBuilder,
    output_files: &[OutputFile],
) -> (Vec<u8>, StringPointer, StringPointer) {
    let mut builtin_bytecode_table: Vec<u8> = Vec::new();
    let mut count: u32 = 0;
    builtin_bytecode_table.extend_from_slice(&0u32.to_le_bytes());
    for output_file in output_files {
        if output_file.output_kind != options::OutputKind::BuiltinBytecode {
            continue;
        }
        let options::OutputFileValue::Buffer { bytes } = &output_file.value else {
            continue;
        };
        let Some(id) = core::str::from_utf8(&output_file.dest_path)
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        let pointer = append_bytecode_aligned(string_builder, bytes);
        builtin_bytecode_table.extend_from_slice(&id.to_le_bytes());
        builtin_bytecode_table.extend_from_slice(&pointer.offset.to_le_bytes());
        builtin_bytecode_table.extend_from_slice(&pointer.length.to_le_bytes());
        count += 1;
    }
    builtin_bytecode_table[0..4].copy_from_slice(&count.to_le_bytes());

    let mut bytecode_string_table_ptr = StringPointer::default();
    for output_file in output_files {
        if output_file.output_kind != options::OutputKind::BytecodeStringTable {
            continue;
        }
        let options::OutputFileValue::Buffer { bytes } = &output_file.value else {
            continue;
        };
        bytecode_string_table_ptr = append_bytecode_aligned(string_builder, bytes);
    }
    let mut module_info_string_table_ptr = StringPointer::default();
    if let Some(table) = output_files
        .iter()
        .find(|f| f.output_kind == options::OutputKind::ModuleInfoStringTable)
    {
        module_info_string_table_ptr = string_builder.append_count(table.value.as_slice());
    }
    (
        builtin_bytecode_table,
        bytecode_string_table_ptr,
        module_info_string_table_ptr,
    )
}

/// JSC reads cached bytecode in place and expects its start 128-byte aligned once mapped. The section data begins
/// 8 bytes after a page-aligned address (the length header), so the offset must be 120 mod 128.
fn append_bytecode_aligned(
    string_builder: &mut bun_core::StringBuilder,
    bytecode: &[u8],
) -> StringPointer {
    let target_mod: usize = 128 - size_of::<u64>();
    let current_mod = string_builder.len % 128;
    let padding = if current_mod <= target_mod {
        target_mod - current_mod
    } else {
        128 - current_mod + target_mod
    };
    let writable = string_builder.writable();
    writable[0..padding].fill(0);
    string_builder.len += padding;
    let aligned_offset = string_builder.len;
    string_builder.writable()[0..bytecode.len()].copy_from_slice(bytecode);
    string_builder.len += bytecode.len();
    StringPointer {
        offset: aligned_offset as u32,
        length: bytecode.len() as u32,
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
