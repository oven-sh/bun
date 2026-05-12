//! Originally, we tried using LIEF to inject the module graph into a MachO segment
//! But this incurred a fixed 350ms overhead on every build, which is unacceptable
//! so we give up on codesigning support on macOS for now until we can find a better solution

use bun_collections::VecExt;
use core::ffi::{c_char, c_int};
use core::mem::size_of;
use core::ptr::NonNull;
use std::io::Write as _;
use std::sync::Arc;

use bun_ast::Loader;
use bun_bundler::options::{self, OutputFile};
use bun_collections::StringArrayHashMap;
use bun_core::{self as bun, Environment, Error as BunError, Output, err};
use bun_core::{String as BunString, StringPointer, ZStr};
use bun_exe_format::{elf as bun_elf, macho as bun_macho, pe as bun_pe};
use bun_options_types::bundle_enums::{Format, WindowsOptions};
use bun_paths::fs as bun_fs;
use bun_paths::{self as path, OSPathBuffer, PathBuffer, SEP_STR, WPathBuffer, strings};
use bun_sourcemap as SourceMap;
use bun_sys::{self as Syscall, Fd, FdExt as _, Stat};

// TODO(b2-blocked): bun_webcore::Blob — `cached_blob` is only ever set from
// `bun_runtime` (higher tier); model as opaque erased pointer here.
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

// TODO(port): Zig version takes `target: Environment.OperatingSystem` + `comptime suffix`
// and concatenates at comptime. Rust cannot const-concat with a runtime enum branch
// nor across a `const fn` boundary. Phase B: expose as a `macro_rules!` over
// `const_format::concatcp!`. For now we materialize the two call-sites directly.
#[cfg(windows)]
pub const BASE_PUBLIC_PATH: &str = "B:/~BUN/";
#[cfg(not(windows))]
pub const BASE_PUBLIC_PATH: &str = "/$bunfs/";

#[cfg(windows)]
pub const BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX: &str = const_format::concatcp!("B:/~BUN/", "root/");
#[cfg(not(windows))]
pub const BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX: &str = const_format::concatcp!("/$bunfs/", "root/");

// TODO(port): Zig used a nested `Instance` struct holding a static var. Model
// as a process-lifetime `OnceLock` (PORTING.md §Concurrency: never `static mut`).
// `get()` returns a raw `*mut` to mirror Zig's `?*StandaloneModuleGraph`; callers
// mutate `wtf_string` / `cached_blob` / `sourcemap` lazily. Phase-B follow-up:
// push interior mutability down to those per-`File` fields (`UnsafeCell<…>`) so
// read-only paths (`find`, `entry_point`, `stat`) can take `&self`.
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
        // Mirrors Zig's `?*StandaloneModuleGraph`: a raw pointer with no
        // uniqueness invariant. Do NOT hand out `&'static mut` here — multiple
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

// TODO(port): Zig `targetBasePublicPath(target, comptime suffix: [:0]const u8) [:0]const u8`
// concatenates at comptime via `++`. A runtime `suffix: &[u8]` parameter cannot be
// const-concatenated. All Zig callers pass either `""` or `"root/"`, so the runtime
// variant special-cases those two literals.
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

pub fn is_bun_standalone_file_path_canonicalized(str_: &[u8]) -> bool {
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
    // TODO(port): interior mutability — Zig returns `*File` and callers mutate
    // `wtf_string` / `cached_blob`. Using `&mut self` here may force callers to
    // hold `&mut StandaloneModuleGraph`; Phase B may switch to `UnsafeCell` fields.
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
// resolver-facing read path below touches none of them. Zig stored this as a
// plain `*StandaloneModuleGraph` shared across worker threads with no
// synchronization; mirror that here so the `Send + Sync` supertrait on
// `bun_resolver::StandaloneModuleGraph` is satisfied.
unsafe impl Send for StandaloneModuleGraph {}
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
pub struct CompiledModuleGraphFile {
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

mod macho {
    // TODO(port): move to standalone_graph_sys
    unsafe extern "C" {
        pub(super) fn Bun__getStandaloneModuleGraphMachoLength() -> *mut u64; // align(1) in Zig
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
        let data_ptr = unsafe { Bun__getStandaloneModuleGraphPEData() };
        if data_ptr.is_null() {
            return None;
        }
        // data_ptr points to `length` bytes of section data valid for program lifetime.
        Some((data_ptr, length as usize))
    }
}

mod elf {
    // TODO(port): move to standalone_graph_sys
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

pub struct File {
    pub name: &'static [u8],
    pub loader: Loader,
    pub contents: &'static ZStr,
    pub sourcemap: LazySourceMap,
    // TODO(port): lifetime — assigned in runtime/api/ (out of crate)
    pub cached_blob: Option<NonNull<Blob>>,
    pub encoding: Encoding,
    pub wtf_string: BunString,
    // TODO(port): Zig type is []u8 (mutable) obtained via @constCast on section bytes.
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
        strings::cmp_strings_asc(&(), lhs.name, rhs.name)
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

    // TODO(port): move to *_jsc — `pub const blob = @import("../runtime/api/standalone_graph_jsc.zig").fileBlob;`
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
            LazySourceMap::Parsed(map) => Some(map.clone()),
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
                // PORT NOTE: `from_internal` fills `internal = Some(ism)` +
                // `input_line_count = ism.input_line_count()` and defaults the rest.
                let mut stored = SourceMap::ParsedSourceMap::from_internal(ism);

                let source_files_count = serialized.source_files_count();
                // TODO(port): Zig allocated a single `[]?[]u8` of len*2 and reinterpreted
                // the first half as `[][]const u8` for file_names. Rust splits into two
                // separate Vecs to avoid the punning.
                // PERF(port): `external_source_names` is `Vec<Box<[u8]>>` so we
                // copy the section bytes; Zig held a borrowed slice. Phase B may
                // switch the field to `Vec<&'static [u8]>` for the standalone path.
                let mut file_names: Vec<Box<[u8]>> = Vec::with_capacity(source_files_count);
                let mut decompressed_contents_slice: Vec<Option<Vec<u8>>> =
                    vec![None; source_files_count];
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
                // Zig: `.underlying_provider = .{ .data = @truncate(@intFromPtr(data)) }`
                // (kind = .zig, load_hint = .none implicit). `from_provider` packs the
                // same triple into the `SourceContentPtr` bitfield.
                stored.underlying_provider = SourceMap::SourceContentPtr::from_provider(
                    bun_core::heap::into_raw(data).cast::<SourceMap::SourceProviderMap>(),
                );
                stored.is_standalone_module_graph = true;

                let parsed = Arc::new(stored);
                // PERF(port): Zig did parsed.ref() (intrusive) to never free; Arc clone held in self.
                *self = LazySourceMap::Parsed(parsed.clone());
                Some(parsed)
            }
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct Offsets {
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
    pub fn from_bytes(
        raw_ptr: *mut u8,
        raw_len: usize,
        offsets: Offsets,
    ) -> Result<StandaloneModuleGraph, BunError> {
        if raw_len == 0 {
            return Ok(StandaloneModuleGraph {
                bytes: core::ptr::slice_from_raw_parts(NonNull::<u8>::dangling().as_ptr(), 0),
                files: StringArrayHashMap::new(),
                entry_point_id: 0,
                compile_exec_argv: b"",
                flags: Flags::default(),
            });
        }

        // Zig's `raw_bytes: []u8` aliases freely — this function hands out read-only subslices
        // (name/contents/sourcemap) AND writable subslices (bytecode/module_info, which JSC
        // mutates in place) into the same allocation. In Rust we must not derive the writable
        // ones from a `&[u8]` reborrow (writing through const-derived provenance is UB), and we
        // must not hold a long-lived `&[u8]` that *spans* a writable subrange (a foreign write
        // would invalidate it under Stacked/Tree Borrows). Keep `(raw_ptr, raw_len)` raw and
        // derive every read-only `&'static [u8]` per-call over its own disjoint subrange only;
        // the bytecode/module_info regions never have a shared reference formed over them.
        let raw_const: *const u8 = raw_ptr;

        // SAFETY: modules metadata blob is a read-only subrange of `[0, raw_len)` disjoint
        // from bytecode/module_info, serialized by `to_bytes`.
        let modules_list_bytes = unsafe { slice_to(raw_const, raw_len, offsets.modules_ptr) };
        // PORT NOTE: StandaloneModuleGraph.zig:309 builds `[]align(1) const CompiledModuleGraphFile`
        // because the modules blob sits at an arbitrary byte offset in the section. In Rust,
        // `&[CompiledModuleGraphFile]` would require natural alignment (StringPointer's u32 fields
        // → 4-byte). We instead iterate by index and `read_unaligned` each fixed-size record into a
        // local (`CompiledModuleGraphFile` is `Copy`/POD), so no `&T` ever points at unaligned memory.
        let modules_list_count = modules_list_bytes.len() / size_of::<CompiledModuleGraphFile>();
        let modules_list_base = modules_list_bytes
            .as_ptr()
            .cast::<CompiledModuleGraphFile>();

        if offsets.entry_point_id as usize > modules_list_count {
            return Err(err!(
                "Corrupted module graph: entry point ID is greater than module list count"
            ));
        }

        let mut modules = StringArrayHashMap::<File>::new();
        modules.reserve(modules_list_count);
        for i in 0..modules_list_count {
            // SAFETY: index < count derived from byte length above; bytes live for 'static.
            let module: CompiledModuleGraphFile =
                unsafe { core::ptr::read_unaligned(modules_list_base.add(i)) };
            let module = &module;
            // SAFETY: each name/contents/sourcemap/bytecode_origin_path subrange is in-bounds
            // (serialized by `to_bytes`) and disjoint from the writable bytecode/module_info
            // subranges; section bytes are a live 'static allocation.
            // PERF(port): was putAssumeCapacity
            let _ = modules.put(
                unsafe { slice_to_z(raw_const, raw_len, module.name) }.as_bytes(),
                File {
                    name: unsafe { slice_to_z(raw_const, raw_len, module.name) }.as_bytes(),
                    loader: module.loader,
                    contents: unsafe { slice_to_z(raw_const, raw_len, module.contents) },
                    sourcemap: if module.sourcemap.length > 0 {
                        LazySourceMap::Serialized(SerializedSourceMap {
                            // TODO(port): @alignCast — alignment of source map bytes
                            bytes: unsafe { slice_to(raw_const, raw_len, module.sourcemap) },
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
                        unsafe { slice_to_z(raw_const, raw_len, module.bytecode_origin_path) }
                            .as_bytes()
                    } else {
                        b""
                    },
                    module_format: module.module_format,
                    side: module.side,
                    cached_blob: None,
                    encoding: Encoding::Binary,
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
    unsafe { ZStr::from_raw(base.add(off), n) }
}

pub fn to_bytes(
    prefix: &[u8],
    output_files: &[OutputFile],
    output_format: Format,
    compile_exec_argv: &[u8],
    flags: Flags,
) -> Result<Vec<u8>, BunError> {
    // TODO(b2-blocked): bun_perf::PerfEvent::StandaloneModuleGraph_serialize — generated
    // enum is still a `_Stub` placeholder; restore the trace call once the generator emits
    // real variants.
    // let _serialize_trace = bun_perf::trace(bun_perf::PerfEvent::StandaloneModuleGraph_serialize);

    let mut entry_point_id: Option<usize> = None;
    let mut string_builder = bun_core::StringBuilder::default();
    let mut module_count: usize = 0;
    for output_file in output_files {
        string_builder.count_z(&output_file.dest_path);
        string_builder.count_z(prefix);
        if let options::OutputValue::Buffer { bytes } = &output_file.value {
            if output_file.output_kind == options::OutputKind::Sourcemap {
                // This is an over-estimation to ensure that we allocate
                // enough memory for the source-map contents. Calculating
                // the exact amount is not possible without allocating as it
                // involves a JSON parser.
                string_builder.cap += bytes.len() * 2;
            } else if output_file.output_kind == options::OutputKind::Bytecode {
                // Allocate up to 256 byte alignment for bytecode
                string_builder.cap += (bytes.len() + 255) / 256 * 256 + 256;
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
    // PERF(port): was arena bulk-free (source_map_arena)

    for output_file in output_files {
        if !output_file.output_kind.is_file_in_standalone_mode() {
            continue;
        }

        let options::OutputValue::Buffer { bytes: buf_bytes } = &output_file.value else {
            continue;
        };

        let dest_path = bun_core::strings::remove_leading_dot_slash(&output_file.dest_path);

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

        // PORT NOTE: Zig used `bun.sys.File.makeOpen` (open, on-fail mkdir parent +
        // retry). `src/sys/File.rs` is still cfg-gated upstream, so the
        // `make_open` body is inlined here against the live `bun_sys` stub
        // surface (`openat` / `make_path` / `File::write_all`).
        // Zig: `if (comptime bun.Environment.is_canary or bun.Environment.isDebug)`
        if Environment::IS_CANARY || Environment::IS_DEBUG {
            if let Some(dump_code_dir) = bun_core::env_var::BUN_FEATURE_FLAG_DUMP_CODE.get() {
                let mut path_buf = bun_paths::path_buffer_pool::get();
                let dest_z = path::resolve_path::join_abs_string_buf_z::<path::platform::Auto>(
                    dump_code_dir,
                    &mut path_buf[..],
                    &[dest_path],
                );

                // Scoped block to handle dump failures without skipping module emission
                'dump: {
                    let flags = bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;
                    // Inline of `bun.sys.File.makeOpen(dest_z, flags, 0o664)`:
                    let file = match Syscall::openat(Fd::cwd(), dest_z, flags, 0o664) {
                        Ok(fd) => bun_sys::File::from_fd(fd),
                        Err(first_err) => {
                            let dir_path = path::resolve_path::dirname::<path::platform::Auto>(
                                dest_z.as_bytes(),
                            );
                            let _ = bun_sys::make_path(bun_sys::Dir::cwd(), dir_path);
                            match Syscall::openat(Fd::cwd(), dest_z, flags, 0o664) {
                                Ok(fd) => bun_sys::File::from_fd(fd),
                                Err(e) => {
                                    Output::pretty_errorln(format_args!(
                                        "<r><red>error<r><d>:<r> failed to open {}: {}",
                                        bstr::BStr::new(dest_path),
                                        e
                                    ));
                                    break 'dump;
                                }
                            }
                        }
                    };
                    if let Err(e) = file.write_all(buf_bytes) {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r><d>:<r> failed to write {}: {}",
                            bstr::BStr::new(dest_path),
                            e
                        ));
                        let _ = file.close();
                        break 'dump;
                    }
                    let _ = file.close();
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
            encoding: match output_file.loader {
                Loader::Js | Loader::Jsx | Loader::Ts | Loader::Tsx => Encoding::Latin1,
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
            // PERF(port): Zig used defer clearRetainingCapacity + arena.reset(.retain_capacity)
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
        // PERF(port): was appendAssumeCapacity
        modules.push(module);
    }

    // SAFETY: `CompiledModuleGraphFile` is `#[repr(C)]` POD with no padding-dependent
    // invariants; reinterpreting its backing storage as bytes is the same as Zig's
    // `std.mem.sliceAsBytes`.
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

    // SAFETY: string_builder.ptr was set by allocate() above.
    let output_bytes = unsafe {
        core::slice::from_raw_parts_mut(string_builder.ptr.unwrap().as_ptr(), string_builder.len)
    };

    #[cfg(debug_assertions)]
    {
        // An expensive sanity check:
        // TODO(port): from_bytes wants &'static mut; debug-only sanity check elided.
        // let mut graph = StandaloneModuleGraph::from_bytes(output_bytes, offsets)?;
        // debug_assert_eq!(graph.files.count(), modules.len());
    }

    // TODO(port): StringBuilder owns the buffer; return it as Vec<u8>.
    Ok(output_bytes.to_vec())
}

// TODO(port): std.heap.page_size_max — platform constant
const PAGE_SIZE: usize = 16384;

pub type InjectOptions = WindowsOptions;

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

pub fn inject(
    bytes: &[u8],
    self_exe: &ZStr,
    inject_options: &InjectOptions,
    target: &CompileTarget,
) -> Fd {
    let mut buf = PathBuffer::uninit();
    // PORT NOTE: `tmpname` borrows `buf` mutably for the &ZStr it returns. The
    // tmpdir-fallback retry below may need to repoint `zname` at a heap-owned
    // buffer instead, so hoist that owner here so it outlives the loop.
    let mut zname_owned: Option<Box<[u8]>> = None;
    let mut zname: &ZStr = match bun_fs::FileSystem::tmpname(
        b"bun-build",
        &mut buf[..],
        // i64 → u64 bitcast (Zig: `@bitCast`).
        bun_core::time::milli_timestamp() as u64,
    ) {
        Ok(n) => n,
        Err(e) => {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r><d>:<r> failed to get temporary file name: {}",
                bstr::BStr::new(e.name())
            ));
            return Fd::INVALID;
        }
    };

    let cleanup = |name: &ZStr, fd: Fd| {
        // Ensure we own the file
        #[cfg(unix)]
        {
            // Make the file writable so we can delete it
            let _ = Syscall::fchmod(fd, 0o777);
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
                // Zig prints `@errorName(err)` (e.g. `AccessDenied`); map the
                // Win32 code through the errno table so users see a name, not
                // a raw integer.
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {:?}",
                    e.to_system_errno()
                        .unwrap_or(bun_sys::SystemErrno::EUNKNOWN)
                ));
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
                    Output::pretty_errorln(format_args!(
                        "<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{}",
                        e
                    ));
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
                    bun_sys::O::CLOEXEC | bun_sys::O::RDWR | bun_sys::O::CREAT,
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
                                    // PORT NOTE: Zig leaked the concat buffer here. PORTING.md
                                    // §Forbidden bans `mem::forget`; the buffer is parked in
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

                            #[allow(unreachable_code)]
                            {
                                Output::pretty_errorln(format_args!(
                                    "<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{}",
                                    err
                                ));
                                // No fd to cleanup yet, just return error
                                return Fd::INVALID;
                            }
                        }
                        // PORT NOTE: Zig falls through to `unreachable` on retry == 2; the
                        // print+return above is dead code in Zig too (kept for diff parity).
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

                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r><d>:<r> failed to open bun executable to copy from as read-only\n{}",
                            err
                        ));
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
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {}",
                    e
                ));
                cleanup(zname, fd);
                return Fd::INVALID;
            }

            break 'brk fd;
        }
    };
    let _ = (&mut zname_owned, &mut zname);

    match target.os {
        CompileTargetOs::Mac => {
            let input_bytes = match (bun_sys::File {
                handle: cloned_executable_fd,
            })
            .read_to_end()
            {
                Ok(b) => b,
                Err(err) => {
                    Output::pretty_errorln(format_args!(
                        "Error reading standalone module graph: {}",
                        err
                    ));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };
            let mut macho_file = match bun_macho::MachoFile::init(&input_bytes, bytes.len()) {
                Ok(f) => f,
                Err(e) => {
                    Output::pretty_errorln(format_args!(
                        "Error initializing standalone module graph: {}",
                        e
                    ));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };
            if let Err(e) = macho_file.write_section(bytes) {
                Output::pretty_errorln(format_args!(
                    "Error writing standalone module graph: {}",
                    e
                ));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            drop(input_bytes);

            if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                Output::pretty_errorln(format_args!(
                    "Error seeking to start of temporary file: {}",
                    err
                ));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }

            // TODO(port): Zig used writer.adaptToNewApi(&buffer) with 512KB stack buffer.
            // `std::io::BufWriter` heap-allocates the buffer; PERF parity is Phase B.
            let mut buffered_writer = std::io::BufWriter::with_capacity(
                512 * 1024,
                bun_sys::FileWriter(cloned_executable_fd),
            );
            if let Err(e) = macho_file.build_and_sign(&mut buffered_writer) {
                Output::pretty_errorln(format_args!(
                    "Error writing standalone module graph: {}",
                    bstr::BStr::new(e.name())
                ));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            if let Err(e) = std::io::Write::flush(&mut buffered_writer) {
                Output::pretty_errorln(format_args!(
                    "Error flushing standalone module graph: {}",
                    e
                ));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o777) };
            }
            return cloned_executable_fd;
        }
        CompileTargetOs::Windows => {
            let input_bytes = match (bun_sys::File {
                handle: cloned_executable_fd,
            })
            .read_to_end()
            {
                Ok(b) => b,
                Err(err) => {
                    Output::pretty_errorln(format_args!(
                        "Error reading standalone module graph: {}",
                        err
                    ));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };
            let mut pe_file = match bun_pe::PEFile::init(&input_bytes) {
                Ok(f) => f,
                Err(e) => {
                    Output::pretty_errorln(format_args!("Error initializing PE file: {}", e));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };
            // Always strip authenticode when adding .bun section for --compile
            if let Err(e) = pe_file.add_bun_section(bytes, bun_pe::StripMode::StripAlways) {
                Output::pretty_errorln(format_args!("Error adding Bun section to PE file: {}", e));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            drop(input_bytes);

            if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                Output::pretty_errorln(format_args!(
                    "Error seeking to start of temporary file: {}",
                    err
                ));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }

            let mut writer = bun_sys::FileWriter(cloned_executable_fd);
            if let Err(e) = pe_file.write(&mut writer) {
                Output::pretty_errorln(format_args!(
                    "Error writing PE file: {}",
                    bstr::BStr::new(e.name())
                ));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }
            // Set executable permissions when running on POSIX hosts, even for Windows targets
            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o777) };
            }
            return cloned_executable_fd;
        }
        CompileTargetOs::Linux | CompileTargetOs::Freebsd => {
            // ELF section approach: find .bun section and expand it
            let input_bytes = match (bun_sys::File {
                handle: cloned_executable_fd,
            })
            .read_to_end()
            {
                Ok(b) => b,
                Err(err) => {
                    Output::pretty_errorln(format_args!("Error reading executable: {}", err));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };

            let mut elf_file = match bun_elf::ElfFile::init(input_bytes) {
                Ok(f) => f,
                Err(e) => {
                    Output::pretty_errorln(format_args!("Error initializing ELF file: {}", e));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            };

            elf_file.normalize_interpreter();

            if let Err(e) = elf_file.write_bun_section(bytes) {
                Output::pretty_errorln(format_args!("Error writing .bun section to ELF: {}", e));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }

            if let Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                Output::pretty_errorln(format_args!(
                    "Error seeking to start of temporary file: {}",
                    err
                ));
                cleanup(zname, cloned_executable_fd);
                return Fd::INVALID;
            }

            // Write the modified ELF data back to the file
            let write_file = bun_sys::File {
                handle: cloned_executable_fd,
            };
            if let Err(err) = write_file.write_all(&elf_file.data) {
                Output::pretty_errorln(format_args!("Error writing ELF file: {}", err));
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
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o777) };
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
                            Output::pretty_errorln(format_args!(
                                "<r><red>error<r><d>:<r> failed to seek to end of temporary file\n{}",
                                e
                            ));
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
                            Output::pretty_errorln(format_args!("{}", err));
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
                    Output::pretty_errorln(format_args!(
                        "{}\nwhile seeking to end of temporary file (pos: {})",
                        err, seek_position
                    ));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::INVALID;
                }
            }

            let mut remain = bytes;
            while !remain.is_empty() {
                match Syscall::write(cloned_executable_fd, remain) {
                    Ok(written) => remain = &remain[written..],
                    Err(err) => {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r><d>:<r> failed to write to temporary file\n{}",
                            err
                        ));
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
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o777) };
            }

            return cloned_executable_fd;
        }
    }

    // TODO(port): the code below is unreachable in Zig too (every match arm returns).
    // Keeping for parity with Zig source.
    #[allow(unreachable_code)]
    {
        #[cfg(windows)]
        if inject_options.hide_console {
            if let Err(e) = bun_sys::windows::edit_win32_binary_subsystem(
                bun_sys::File {
                    handle: cloned_executable_fd,
                },
                bun_sys::windows::Subsystem::WindowsGui,
            ) {
                Output::err(
                    e,
                    "failed to disable console on executable",
                    format_args!(""),
                );
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
        }

        // Set Windows icon and/or metadata if any options are provided (single operation)
        #[cfg(windows)]
        if inject_options.icon.is_some()
            || inject_options.title.is_some()
            || inject_options.publisher.is_some()
            || inject_options.version.is_some()
            || inject_options.description.is_some()
            || inject_options.copyright.is_some()
        {
            let mut zname_buf = OSPathBuffer::uninit();
            let zname_w = strings::paths::to_w_path_normalized(&mut zname_buf, zname.as_bytes());

            // Single call to set all Windows metadata at once
            if let Err(e) = bun_sys::windows::rescle::set_windows_metadata(
                zname_w.as_ptr(),
                inject_options.icon.as_deref(),
                inject_options.title.as_deref(),
                inject_options.publisher.as_deref(),
                inject_options.version.as_deref(),
                inject_options.description.as_deref(),
                inject_options.copyright.as_deref(),
            ) {
                Output::err(
                    e,
                    "failed to set Windows metadata on executable",
                    format_args!(""),
                );
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
        }

        let _ = inject_options;
        cloned_executable_fd
    }
}

use bun_core::Environment::OperatingSystem as CompileTargetOs;
pub use bun_options_types::compile_target::CompileTarget;

/// Port of `CompileTarget.downloadToPath` (CompileTarget.zig). Moved up from
/// `bun_options_types` (T3) so it can name `bun_http::AsyncHTTP` directly
/// instead of routing through `extern "Rust"` shims; the only callers are the
/// two `download*` fns below in this crate.
pub fn download_to_path(
    target: &CompileTarget,
    env: &mut bun_dotenv::Loader<'_>,
    dest_z: &ZStr,
) -> Result<(), BunError> {
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
                return Err(err);
            }
        };
        let url_str_copy: Box<[u8]> = Box::from(url_str);
        let url = bun_url::URL::parse(&url_str_copy);
        {
            // TODO(port): errdefer progress.end() — `start` returns `&mut Node`
            // borrowing `refresher`, so a scopeguard capturing it would alias.
            // Phase B: reshape with a guard that re-borrows on drop.
            // PORT NOTE: reshaped for borrowck — `get_http_proxy_for` borrows
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
                    return Err(err!("TargetNotFound"));
                }
                403 | 429 | 499..=599 => {
                    // Return error without printing - let caller handle the messaging
                    return Err(err!("NetworkError"));
                }
                200 => {}
                _ => return Err(err!("NetworkError")),
            }
        }

        let mut tarball_bytes: Vec<u8> = Vec::new();
        {
            refresher.refresh();
            // defer compressed_archive_bytes.list.deinit(allocator) — handled by Drop

            if compressed_archive_bytes.list.is_empty() {
                // Return error without printing - let caller handle the messaging
                return Err(err!("InvalidResponse"));
            }

            {
                // PORT NOTE: reshaped for borrowck — `refresher.start` borrows
                // `refresher` mutably; do gunzip work first, drive progress around it.
                refresher.start(b"Decompressing", 0);
                let gunzip_result = (|| -> Result<(), BunError> {
                    let mut gunzip = bun_zlib::ZlibReaderArrayList::init(
                        compressed_archive_bytes.list.as_slice(),
                        &mut tarball_bytes,
                    )
                    .map_err(|_| err!("InvalidResponse"))?;
                    gunzip.read_all(true).map_err(|_| err!("InvalidResponse"))?;
                    Ok(())
                })();
                refresher.root.end();
                if let Err(e) = gunzip_result {
                    // Return error without printing - let caller handle the messaging
                    return Err(e);
                }
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
                    return Err(err!("ExtractionFailed"));
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
                        return Err(err!("ExtractionFailed"));
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

pub fn download(
    target: &CompileTarget,
    env: &mut bun_dotenv::Loader<'_>,
) -> Result<bun_core::ZBox, BunError> {
    let mut exe_path_buf = PathBuffer::uninit();
    let mut version_str_buf = [0u8; 1024];
    // TODO(port): std.fmt.bufPrintZ — write into fixed buffer with NUL.
    let written = {
        let mut cursor = &mut version_str_buf[..];
        write!(cursor, "{}", target).map_err(|_| err!("NoSpaceLeft"))?;
        1024 - cursor.len()
    };
    version_str_buf[written] = 0;
    // SAFETY: version_str_buf[written] == 0 written above; buffer outlives the borrow.
    let version_str = ZStr::from_buf(&version_str_buf[..], written);
    let mut needs_download: bool = true;
    let dest_z = target.exe_path(&mut exe_path_buf, version_str, env, &mut needs_download);
    if needs_download {
        if let Err(e) = download_to_path(target, env, dest_z) {
            // For CLI, provide detailed error messages and exit
            // TODO(port): `err!()` is a Phase-A stub (all variants compare equal);
            // branch dispatch is correct once `bun_core::Error::from_name` interns.
            if e == err!("TargetNotFound") {
                Output::err_fmt(format_args!(
                    "Does this target and version of Bun exist?\n\n404 downloading {} from npm registry",
                    target
                ));
            } else if e == err!("NetworkError") {
                Output::err_fmt(format_args!(
                    "Failed to download cross-compilation target.\n\nNetwork error downloading {} from npm registry",
                    target
                ));
            } else if e == err!("InvalidResponse") {
                Output::err_fmt(format_args!(
                    "Failed to verify the integrity of the downloaded tarball.\n\nThe downloaded content for {} appears to be corrupted",
                    target
                ));
            } else if e == err!("ExtractionFailed") {
                Output::err_fmt(format_args!(
                    "Failed to extract the downloaded tarball.\n\nCould not extract executable for {}",
                    target
                ));
            } else {
                Output::err_fmt(format_args!(
                    "Failed to download {}: {}",
                    target,
                    bstr::BStr::new(e.name())
                ));
            }
            return Err(err!("DownloadFailed"));
        }
    }

    Ok(bun_core::ZBox::from_vec_with_nul(
        dest_z.as_bytes().to_vec(),
    ))
}

pub fn to_executable(
    target: &CompileTarget,
    output_files: &[OutputFile],
    root_dir: Fd, // TODO(port): was std.fs.Dir
    module_prefix: &[u8],
    outfile: &[u8],
    env: &mut bun_dotenv::Loader,
    output_format: Format,
    windows_options: WindowsOptions,
    compile_exec_argv: &[u8],
    self_exe_path: Option<&[u8]>,
    flags: Flags,
) -> Result<CompileResult, BunError> {
    // TODO(port): narrow error set
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

    // PORT NOTE: Zig tracked `free_self_exe` to decide whether the slice was
    // allocator-owned. `ZBox` always owns its bytes and drops on scope exit,
    // so the flag is unnecessary.
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
        // TODO(port): std.fmt.allocPrintSentinel — build NUL-terminated owned string.
        let mut version_str: Vec<u8> = Vec::new();
        let _ = write!(&mut version_str, "{}", target);
        version_str.push(0);
        // SAFETY: trailing 0 byte appended above.
        let version_zstr = ZStr::from_slice_with_nul(&version_str[..]);

        let mut needs_download: bool = true;
        let dest_z = target.exe_path(&mut exe_path_buf, version_zstr, env, &mut needs_download);

        if needs_download {
            if let Err(e) = download_to_path(target, env, dest_z) {
                return Ok(if e == err!("TargetNotFound") {
                    CompileResult::fail_fmt(format_args!(
                        "Target platform '{}' is not available for download. Check if this version of Bun supports this target.",
                        target
                    ))
                } else if e == err!("NetworkError") {
                    CompileResult::fail_fmt(format_args!(
                        "Network error downloading executable for '{}'. Check your internet connection and proxy settings.",
                        target
                    ))
                } else if e == err!("InvalidResponse") {
                    CompileResult::fail_fmt(format_args!(
                        "Downloaded file for '{}' appears to be corrupted. Please try again.",
                        target
                    ))
                } else if e == err!("ExtractionFailed") {
                    CompileResult::fail_fmt(format_args!(
                        "Failed to extract executable for '{}'. The download may be incomplete.",
                        target
                    ))
                } else if e == err!("UnsupportedTarget") {
                    CompileResult::fail_fmt(format_args!("Target '{}' is not supported", target))
                } else {
                    CompileResult::fail_fmt(format_args!(
                        "Failed to download '{}': {}",
                        target,
                        bstr::BStr::new(e.name())
                    ))
                });
            }
        }

        bun_core::ZBox::from_vec_with_nul(dest_z.as_bytes().to_vec())
    };

    let mut fd = inject(&bytes, &self_exe, &windows_options, target);
    // PORT NOTE: Zig's `defer if (fd != invalid) fd.close()` reads `fd` at scope exit
    // after later reassignments. A scopeguard closure capturing `fd` by value would not
    // observe those writes; capturing by `&mut` conflicts with later uses. Explicit
    // `if fd != Fd::INVALID { fd.close(); }` calls are inserted at every return below
    // (both error and success paths) to match Zig behavior.
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
        fd = Fd::invalid();

        use bun_sys::windows::{self, Win32ErrorExt as _};
        // Move the file using MoveFileExW
        // SAFETY: NUL-terminated wide strings constructed above. Pass the
        // full-buffer pointer (not a `[..len]` sub-slice) so the pointer's
        // provenance covers the trailing NUL at index `len` that the W-suffix
        // API will read — matches Zig's `buf[0..len :0].ptr` sentinel slice.
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
                    e.name()
                )));
            }
        }
        return Ok(CompileResult::Success);
    }

    #[cfg(not(windows))]
    {
        let mut buf2 = PathBuffer::uninit();
        // PORT NOTE: borrowck — `get_fd_path` returns `&mut [u8]` borrowing `buf2`;
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
        // TODO(port): std.posix.toPosixPath — copy into NUL-terminated fixed buffer.
        // `resolve_path::z` does the same (copy + NUL) and yields `&ZStr`.
        let mut temp_posix_buf = PathBuffer::uninit();
        let temp_posix = path::resolve_path::z(&temp_location, &mut temp_posix_buf);
        let outfile_basename = bun_paths::basename(outfile);
        let mut outfile_posix_buf = PathBuffer::uninit();
        let outfile_posix = path::resolve_path::z(outfile_basename, &mut outfile_posix_buf);

        if let Err(e) =
            bun_sys::move_file_z_with_handle(fd, Fd::cwd(), temp_posix, root_dir, outfile_posix)
        {
            fd.close();
            fd = Fd::INVALID;

            let _ = Syscall::unlink(temp_posix);

            if e == err!("IsDir") || e == err!("EISDIR") {
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
    pub fn from_executable() -> Result<Option<*mut StandaloneModuleGraph>, BunError> {
        #[cfg(target_os = "macos")]
        {
            let Some((base, len)) = macho::get_data() else {
                return Ok(None);
            };
            if len < size_of::<Offsets>() + TRAILER.len() {
                Output::debug_warn(format_args!(
                    "bun standalone module graph is too small to be valid"
                ));
                return Ok(None);
            }
            // SAFETY: `[len - Offsets - TRAILER, len)` is in-bounds (checked above) and
            // read-only; build short-lived views via raw `read_unaligned` so no `&[u8]`
            // ever spans the writable bytecode region carried in `base`'s provenance.
            let offsets_ptr = unsafe { base.add(len - size_of::<Offsets>() - TRAILER.len()) };
            let trailer_bytes = unsafe {
                core::slice::from_raw_parts(base.add(len - TRAILER.len()), TRAILER.len())
            };
            if trailer_bytes != TRAILER {
                Output::debug_warn(format_args!(
                    "bun standalone module graph has invalid trailer"
                ));
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
                Output::debug_warn(format_args!(
                    "bun standalone module graph is too small to be valid"
                ));
                return Ok(None);
            }
            // SAFETY: `[len - Offsets - TRAILER, len)` is in-bounds (checked above) and
            // read-only; build short-lived views via raw `read_unaligned` so no `&[u8]`
            // ever spans the writable bytecode region carried in `base`'s provenance.
            let offsets_ptr = unsafe { base.add(len - size_of::<Offsets>() - TRAILER.len()) };
            let trailer_bytes = unsafe {
                core::slice::from_raw_parts(base.add(len - TRAILER.len()), TRAILER.len())
            };
            if trailer_bytes != TRAILER {
                Output::debug_warn(format_args!(
                    "bun standalone module graph has invalid trailer"
                ));
                return Ok(None);
            }
            // SAFETY: offsets_ptr has at least size_of::<Offsets>() bytes.
            let offsets: Offsets =
                unsafe { core::ptr::read_unaligned(offsets_ptr.cast::<Offsets>()) };
            return from_bytes_alloc(base, len, offsets).map(Some);
        }

        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        {
            let Some((base, len)) = elf::get_data() else {
                return Ok(None);
            };
            if len < size_of::<Offsets>() + TRAILER.len() {
                Output::debug_warn(format_args!(
                    "bun standalone module graph is too small to be valid"
                ));
                return Ok(None);
            }
            // SAFETY: `[len - Offsets - TRAILER, len)` is in-bounds (checked above) and
            // read-only; build short-lived views via raw `read_unaligned` so no `&[u8]`
            // ever spans the writable bytecode region carried in `base`'s provenance.
            let offsets_ptr = unsafe { base.add(len - size_of::<Offsets>() - TRAILER.len()) };
            let trailer_bytes = unsafe {
                core::slice::from_raw_parts(base.add(len - TRAILER.len()), TRAILER.len())
            };
            if trailer_bytes != TRAILER {
                Output::debug_warn(format_args!(
                    "bun standalone module graph has invalid trailer"
                ));
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
                #[cfg(target_os = "linux")]
                {
                    match elf::get_data() {
                        Some(b) => b,
                        None => return,
                    }
                }
                #[cfg(not(any(target_os = "macos", target_os = "linux")))]
                {
                    return;
                }
            };

            if len == 0 {
                return;
            }

            let page: usize = bun_alloc::page_size();
            let start = (base as usize) & !(page - 1);
            let end_unaligned = base as usize + len;
            let end = (end_unaligned + page - 1) & !(page - 1);

            // std.posix.madvise hits `unreachable` on unexpected errnos; this is a
            // best-effort hint, so call libc directly and just log on failure.
            // SAFETY: start..end covers a mapped range of the executable image.
            let rc = unsafe {
                libc::madvise(
                    start as *mut core::ffi::c_void,
                    end - start,
                    libc::MADV_DONTNEED,
                )
            };
            if rc != 0 {
                Output::debug_warn(format_args!(
                    "hintSourcePagesDontNeed: madvise failed errno={}",
                    bun_sys::last_errno()
                ));
                return;
            }
            Output::debug_warn(format_args!(
                "hintSourcePagesDontNeed: MADV_DONTNEED {} bytes",
                end - start
            ));
        }
    }
}

/// Allocates a StandaloneModuleGraph in the process-static `INSTANCE`,
/// populates it from bytes, sets it globally, and returns the pointer.
fn from_bytes_alloc(
    raw_ptr: *mut u8,
    raw_len: usize,
    offsets: Offsets,
) -> Result<*mut StandaloneModuleGraph, BunError> {
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
pub struct SerializedSourceMapHeader {
    pub source_files_count: u32,
    pub map_bytes_length: u32,
}

impl SerializedSourceMap {
    pub fn header(self) -> SerializedSourceMapHeader {
        // SAFETY: bytes.len() >= size_of::<Header>() must hold (caller checked); align(1) read.
        unsafe {
            core::ptr::read_unaligned(self.bytes.as_ptr().cast::<SerializedSourceMapHeader>())
        }
    }

    pub fn mapping_blob(self) -> Option<&'static [u8]> {
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

    // PORT NOTE: Zig types these arrays as `[]align(1) const StringPointer` because the
    // serialized byte buffer carries no alignment guarantee. Materializing a Rust
    // `&[StringPointer]` would require `align_of::<StringPointer>() == 4` alignment
    // (UB otherwise), so expose count + indexed unaligned reads instead.

    pub fn source_files_count(self) -> usize {
        self.header().source_files_count as usize
    }

    fn string_pointers_base(self) -> *const StringPointer {
        self.bytes[size_of::<SerializedSourceMapHeader>()..]
            .as_ptr()
            .cast()
    }

    pub fn source_file_name(self, index: usize) -> StringPointer {
        debug_assert!(index < self.source_files_count());
        // SAFETY: index bounds-checked; layout per Header doc; pointer may be misaligned.
        unsafe { core::ptr::read_unaligned(self.string_pointers_base().add(index)) }
    }

    fn compressed_source_file(self, index: usize) -> StringPointer {
        let count = self.source_files_count();
        debug_assert!(index < count);
        // SAFETY: second contiguous StringPointer array immediately follows the first.
        unsafe { core::ptr::read_unaligned(self.string_pointers_base().add(count + index)) }
    }
}

/// Once loaded, this map stores additional data for keeping track of source code.
pub struct SerializedSourceMapLoaded {
    pub map: SerializedSourceMap,

    /// Only decompress source code once! Once a file is decompressed,
    /// it is stored here. Decompression failures are stored as an empty
    /// string, which will be treated as "no contents".
    pub decompressed_files: Box<[Option<Vec<u8>>]>,
}

impl SerializedSourceMapLoaded {
    pub fn source_file_contents(&mut self, index: usize) -> Option<&[u8]> {
        // PORT NOTE: reshaped for borrowck — populate cache first, then borrow once.
        if self.decompressed_files[index].is_none() {
            // SAFETY: `self.map.bytes` is a 'static read-only sourcemap subrange (disjoint
            // from bytecode); StringPointer was serialized by `to_bytes` and is in-bounds.
            let compressed_file = unsafe {
                slice_to(
                    self.map.bytes.as_ptr(),
                    self.map.bytes.len(),
                    self.map.compressed_source_file(index),
                )
            };
            let size = bun_zstd::get_decompressed_size(compressed_file);

            let mut bytes = vec![0u8; size];
            match bun_zstd::decompress(&mut bytes, compressed_file) {
                bun_zstd::Result::Err(err_msg) => {
                    Output::warn(format_args!(
                        "Source map decompression error: {}",
                        bstr::BStr::new(err_msg.as_bytes())
                    ));
                    self.decompressed_files[index] = Some(Vec::new());
                }
                bun_zstd::Result::Success(n) => {
                    bytes.truncate(n);
                    self.decompressed_files[index] = Some(bytes);
                }
            }
        }

        let decompressed = self.decompressed_files[index].as_deref().unwrap();
        if decompressed.is_empty() {
            None
        } else {
            Some(decompressed)
        }
    }
}

pub fn serialize_json_source_map_for_standalone(
    header_list: &mut Vec<u8>,
    string_payload: &mut Vec<u8>,
    json_source: &[u8],
) -> Result<(), BunError> {
    use bun_ast::ExprData as AstData;

    // PERF(port): Zig threaded an arena allocator through; here we own a local
    // bump arena and drop it on return (matches `defer arena.free`).
    let arena = bun_alloc::Arena::new();

    let json_src = bun_ast::Source::init_path_string("sourcemap.json", json_source);
    let mut log = bun_ast::Log::init();

    // the allocator given to the JS parser is not respected for all parts
    // of the parse, so we need to remember to reset the ast store
    let _reset_guard = bun_ast::StoreResetGuard::new();

    let json = bun_parsers::json::parse::<false>(&json_src, &mut log, &arena)
        .map_err(|_| err!("InvalidSourceMap"))?;

    let mappings_str = json.get(b"mappings").ok_or(err!("InvalidSourceMap"))?;
    if !matches!(mappings_str.data, AstData::EString(_)) {
        return Err(err!("InvalidSourceMap"));
    }
    let sources_content = match json
        .get(b"sourcesContent")
        .ok_or(err!("InvalidSourceMap"))?
        .data
    {
        AstData::EArray(arr) => arr,
        _ => return Err(err!("InvalidSourceMap")),
    };
    let sources_paths = match json.get(b"sources").ok_or(err!("InvalidSourceMap"))?.data {
        AstData::EArray(arr) => arr,
        _ => return Err(err!("InvalidSourceMap")),
    };
    if sources_content.items.len_u32() != sources_paths.items.len_u32() {
        return Err(err!("InvalidSourceMap"));
    }

    // SAFETY: matched `EString` above; `StoreRef` derefs `&mut` into the arena node.
    let mut mappings_e_string = mappings_str
        .data
        .e_string()
        .expect("infallible: variant checked");
    let map_vlq: &[u8] = mappings_e_string.slice(&arena);
    let map_blob =
        SourceMap::InternalSourceMap::from_vlq(map_vlq, 0).map_err(|_| err!("InvalidSourceMap"))?;

    header_list.extend_from_slice(&u32::to_le_bytes(sources_paths.items.len_u32()));
    header_list.extend_from_slice(
        &u32::try_from(map_blob.len())
            .expect("int cast")
            .to_le_bytes(),
    );

    let string_payload_start_location = size_of::<u32>()
        + size_of::<u32>()
        + size_of::<StringPointer>() * (sources_content.items.len_u32() as usize) * 2 // path + source
        + map_blob.len();

    for item in sources_paths.items.slice() {
        let AstData::EString(s) = item.data else {
            return Err(err!("InvalidSourceMap"));
        };

        let decoded = s.string_cloned(&arena).map_err(|_| err!("OutOfMemory"))?;

        let offset = string_payload.len();
        string_payload.extend_from_slice(decoded);

        let slice = StringPointer {
            offset: u32::try_from(offset + string_payload_start_location).expect("int cast"),
            length: u32::try_from(string_payload.len() - offset).expect("int cast"),
        };
        header_list.extend_from_slice(&slice.offset.to_le_bytes());
        header_list.extend_from_slice(&slice.length.to_le_bytes());
    }

    for item in sources_content.items.slice() {
        let AstData::EString(s) = item.data else {
            return Err(err!("InvalidSourceMap"));
        };

        let utf8 = s.string_cloned(&arena).map_err(|_| err!("OutOfMemory"))?;

        let offset = string_payload.len();

        let bound = bun_zstd::compress_bound(utf8.len());
        // SAFETY: zstd writes only into the spare slice and reports the byte
        // count on success; on error we commit 0 and `Output::panic` diverges.
        unsafe {
            bun_core::vec::fill_spare(string_payload, bound, |spare| {
                match bun_zstd::compress(spare, utf8, Some(1)) {
                    bun_zstd::Result::Err(err_msg) => {
                        Output::panic(format_args!(
                            "Unexpected error compressing sourcemap: {}",
                            bstr::BStr::new(err_msg.as_bytes())
                        ));
                    }
                    bun_zstd::Result::Success(n) => (n, ()),
                }
            })
        };

        let slice = StringPointer {
            offset: u32::try_from(offset + string_payload_start_location).expect("int cast"),
            length: u32::try_from(string_payload.len() - offset).expect("int cast"),
        };
        header_list.extend_from_slice(&slice.offset.to_le_bytes());
        header_list.extend_from_slice(&slice.length.to_le_bytes());
    }

    header_list.extend_from_slice(&map_blob);

    debug_assert!(header_list.len() == string_payload_start_location);
    Ok(())
}

// ported from: src/standalone_graph/StandaloneModuleGraph.zig
