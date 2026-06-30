use core::mem::size_of;
use core::ptr::NonNull;
use std::sync::Arc;

use bun_ast::Loader;
use bun_collections::StringArrayHashMap;
#[cfg(windows)]
use bun_core::PathBuffer;
use bun_core::{Error as BunError, err};
use bun_core::{String as BunString, StringPointer, ZStr};
use bun_paths::strings;
#[cfg(windows)]
use bun_paths::{self as path};
use bun_sourcemap as SourceMap;
use bun_sys::Stat;

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
//
// On Windows the base path is `B:\~BUN\` instead, because file URLs are
// invalid without a drive letter. B drive because 'bun' but also because
// it's more unlikely to collide with a real path.
pub use bun_options_types::standalone_path::{
    BASE_PATH, BASE_PUBLIC_PATH, BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX, is_bun_standalone_file_path,
};

// A process-lifetime `OnceLock` (PORTING.md §Concurrency: never `static mut`).
// `get()` returns a raw `*mut`; callers
// mutate `wtf_string` / `sourcemap` lazily. A future reshape
// could push interior mutability down to those per-`File` fields (`UnsafeCell<…>`)
// so read-only paths (`find`, `entry_point`, `stat`) can take `&self`.
struct Instance(core::cell::UnsafeCell<StandaloneModuleGraph>);
// SAFETY: the graph is populated once at startup before any worker threads;
// post-init mutation is limited to per-`File` lazy fields. NOTE: `INIT_LOCK`
// only guards `LazySourceMap::load`; `File::to_wtf_string`
// mutates without any lock and relies on idempotence + JSC's own synchronization.
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

impl StandaloneModuleGraph {
    // Callers mutate `wtf_string`, so these accessors take
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
// `bun_runtime`-owned caches (`wtf_string`, source-map state)
// that are only ever touched from the JS main thread under the API lock; the
// resolver-facing read path below touches none of them. The graph pointer is
// shared across worker threads through the resolver, which is why `Send +
// Sync` must be satisfied.
unsafe impl Send for StandaloneModuleGraph {}
// SAFETY: see `Send` impl — post-init mutation is confined to per-`File` lazy caches on the JS thread.
unsafe impl Sync for StandaloneModuleGraph {}

/// Read-only lookup surface. The resolver and VM hold the graph as
/// `&'static StandaloneModuleGraph` and only need to answer "is `name` an
/// embedded module?" and hand back the canonical name slice.
///
/// The `_shared` suffix avoids colliding with the `&mut`-returning inherent
/// `find` / `find_assume_standalone_path` above, which stay for the runtime's
/// blob/sourcemap caching path.
impl StandaloneModuleGraph {
    pub fn find_assume_standalone_path_shared(&self, name: &[u8]) -> Option<&[u8]> {
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

    pub fn find_shared(&self, name: &[u8]) -> Option<&[u8]> {
        if !is_bun_standalone_file_path(name) {
            return None;
        }
        self.find_assume_standalone_path_shared(name)
    }

    pub fn base_public_path_with_default_suffix(&self) -> &'static [u8] {
        BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX.as_bytes()
    }

    pub fn compile_exec_argv(&self) -> &[u8] {
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

pub struct File {
    pub name: &'static [u8],
    pub loader: Loader,
    pub contents: &'static ZStr,
    pub sourcemap: LazySourceMap,
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

pub const TRAILER: &[u8] = b"\n---- Bun! ----\n";

impl StandaloneModuleGraph {
    /// # Safety
    /// `raw_ptr..raw_ptr+raw_len` must be a live allocation holding the
    /// serialized standalone section (`to_bytes` output), valid (and, for the
    /// bytecode/module_info subranges, writable) for the returned graph's
    /// lifetime, with no `&[u8]` formed over the writable subranges.
    pub unsafe fn from_bytes(
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
            return Err(err!(
                "Corrupted module graph: entry point ID is greater than module list count"
            ));
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
                    bun_core::debug_warn!(
                        "hintSourcePagesDontNeed: madvise failed errno={}",
                        bun_sys::last_errno()
                    );
                    return;
                }
                bun_core::debug_warn!(
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
) -> Result<*mut StandaloneModuleGraph, BunError> {
    // SAFETY: caller contract — `(raw_ptr, raw_len)` is the live standalone
    // section mapped for the life of the process.
    let graph = unsafe { StandaloneModuleGraph::from_bytes(raw_ptr, raw_len, offsets) }?;
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
