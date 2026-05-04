//! Originally, we tried using LIEF to inject the module graph into a MachO segment
//! But this incurred a fixed 350ms overhead on every build, which is unacceptable
//! so we give up on codesigning support on macOS for now until we can find a better solution

use core::ffi::{c_char, c_int};
use core::mem::size_of;
use core::ptr::NonNull;
use std::io::Write as _;
use std::sync::Arc;

use bun_collections::StringArrayHashMap;
use bun_core::{self as bun, Environment, Error as BunError, Output, err};
use bun_paths::{self as path, PathBuffer, WPathBuffer, OSPathBuffer, SEP_STR};
use bun_str::{self as strings, String as BunString, ZStr, StringPointer};
use bun_sys::{self as Syscall, Fd, Stat};
use bun_bundler::options::{self, Loader, Format, OutputFile, WindowsOptions};
use bun_sourcemap as SourceMap;
use bun_webcore::Blob;
use bun_schema::api as Schema;

pub struct StandaloneModuleGraph {
    pub bytes: &'static [u8],
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

pub const BASE_PUBLIC_PATH: &str = target_base_public_path_current("");

pub const BASE_PUBLIC_PATH_WITH_DEFAULT_SUFFIX: &str = target_base_public_path_current("root/");

// TODO(port): Zig used a nested `Instance` struct holding a static var. Model
// as a module-level static; access is single-threaded at startup.
static mut INSTANCE: Option<NonNull<StandaloneModuleGraph>> = None;

impl StandaloneModuleGraph {
    pub fn get() -> Option<&'static mut StandaloneModuleGraph> {
        // SAFETY: INSTANCE is only mutated once at startup before any concurrent access.
        unsafe { INSTANCE.map(|p| &mut *p.as_ptr()) }
    }

    pub fn set(instance: &mut StandaloneModuleGraph) {
        // SAFETY: called once at startup; instance lives for program lifetime.
        unsafe { INSTANCE = Some(NonNull::from(instance)); }
    }
}

// TODO(port): Zig version takes `target: Environment.OperatingSystem` + `comptime suffix`
// and concatenates at comptime. Rust cannot const-concat with a runtime enum branch
// without `const_format`. Provide the current-OS const variant + a runtime variant.
#[cfg(windows)]
const fn target_base_public_path_current(suffix: &'static str) -> &'static str {
    // PERF(port): comptime string concat — uses const_format in Phase B
    const_format::concatcp!("B:/~BUN/", suffix)
}
#[cfg(not(windows))]
const fn target_base_public_path_current(suffix: &'static str) -> &'static str {
    const_format::concatcp!("/$bunfs/", suffix)
}

// TODO(port): Zig `targetBasePublicPath(target, comptime suffix: [:0]const u8) [:0]const u8`
// concatenates at comptime via `++`. A runtime `suffix: &str` parameter cannot be
// const-concatenated. Phase B: expose as `macro_rules! target_base_public_path { ($target:expr, $suffix:literal) => ... }`
// using `const_format::concatcp!`. No runtime variant — all Zig callers pass a literal.

pub fn is_bun_standalone_file_path_canonicalized(str_: &[u8]) -> bool {
    str_.starts_with(BASE_PATH.as_bytes())
        || (cfg!(windows) && str_.starts_with(BASE_PUBLIC_PATH.as_bytes()))
}

pub fn is_bun_standalone_file_path(str_: &[u8]) -> bool {
    #[cfg(windows)]
    {
        // On Windows, remove NT path prefixes before checking
        let canonicalized = strings::without_nt_prefix::<u8>(str_);
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
            let input = strings::without_nt_prefix::<u8>(name);
            let normalized = path::platform_to_posix_buf::<u8>(input, &mut normalized_buf);
            return self.files.get_ptr_mut(normalized);
        }
        #[cfg(not(windows))]
        {
            self.files.get_ptr_mut(name)
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct CompiledModuleGraphFile {
    pub name: Schema::StringPointer,
    pub contents: Schema::StringPointer,
    pub sourcemap: Schema::StringPointer,
    pub bytecode: Schema::StringPointer,
    pub module_info: Schema::StringPointer,
    /// The file path used when generating bytecode (e.g., "B:/~BUN/root/app.js").
    /// Must match exactly at runtime for bytecode cache hits.
    pub bytecode_origin_path: Schema::StringPointer,
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
        pub fn Bun__getStandaloneModuleGraphMachoLength() -> *mut u64; // align(1) in Zig
    }

    pub fn get_data() -> Option<&'static [u8]> {
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
        let slice_ptr = length_ptr as *const u8;
        // SAFETY: section data is `length` bytes immediately following the u64 header.
        Some(unsafe { core::slice::from_raw_parts(slice_ptr.add(data_offset), length as usize) })
    }
}

mod pe {
    // TODO(port): move to standalone_graph_sys
    unsafe extern "C" {
        pub fn Bun__getStandaloneModuleGraphPELength() -> u64;
        pub fn Bun__getStandaloneModuleGraphPEData() -> *mut u8;
    }

    pub fn get_data() -> Option<&'static [u8]> {
        // SAFETY: FFI calls.
        let length = unsafe { Bun__getStandaloneModuleGraphPELength() };
        if length == 0 {
            return None;
        }
        let data_ptr = unsafe { Bun__getStandaloneModuleGraphPEData() };
        if data_ptr.is_null() {
            return None;
        }
        // SAFETY: data_ptr points to `length` bytes of section data valid for program lifetime.
        Some(unsafe { core::slice::from_raw_parts(data_ptr, length as usize) })
    }
}

mod elf {
    // TODO(port): move to standalone_graph_sys
    unsafe extern "C" {
        pub fn Bun__getStandaloneModuleGraphELFVaddr() -> *mut u64; // align(1)
    }

    pub fn get_data() -> Option<&'static [u8]> {
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
        let target = vaddr as *const u8;
        // SAFETY: target points to 8-byte little-endian length prefix.
        let payload_len = u64::from_le_bytes(unsafe { *(target as *const [u8; 8]) });
        if payload_len < 8 {
            return None;
        }
        // SAFETY: payload_len bytes follow the 8-byte header at `target`.
        Some(unsafe { core::slice::from_raw_parts(target.add(8), payload_len as usize) })
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
        // SAFETY: all-zero is a valid Stat (POD #[repr(C)]).
        let mut result: Stat = unsafe { core::mem::zeroed() };
        result.size = i64::try_from(self.contents.len()).unwrap();
        result.mode = bun_sys::S::IFREG | 0o644;
        result
    }

    pub fn less_than_by_index(ctx: &[File], lhs_i: u32, rhs_i: u32) -> bool {
        let lhs = &ctx[lhs_i as usize];
        let rhs = &ctx[rhs_i as usize];
        bun_str::strings::cmp_strings_asc((), lhs.name, rhs.name)
    }

    pub fn to_wtf_string(&mut self) -> BunString {
        if self.wtf_string.is_empty() {
            match self.encoding {
                Encoding::Binary | Encoding::Utf8 => {
                    self.wtf_string = BunString::clone_utf8(self.contents.as_bytes());
                }
                Encoding::Latin1 => {
                    self.wtf_string = BunString::create_static_external(self.contents.as_bytes(), true);
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
static INIT_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();

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
                let ism = SourceMap::InternalSourceMap { data: blob.as_ptr() };
                let mut stored = SourceMap::ParsedSourceMap {
                    ref_count: Default::default(),
                    internal: ism,
                    input_line_count: ism.input_line_count(),
                    ..Default::default()
                };

                let source_files = serialized.source_file_names();
                // TODO(port): Zig allocated a single `[]?[]u8` of len*2 and reinterpreted
                // the first half as `[][]const u8` for file_names. Rust splits into two
                // separate Vecs to avoid the punning.
                let mut file_names: Vec<&'static [u8]> = Vec::with_capacity(source_files.len());
                let mut decompressed_contents_slice: Vec<Option<Vec<u8>>> =
                    vec![None; source_files.len()];
                for src in source_files {
                    file_names.push(src.slice(serialized.bytes));
                }

                let data = Box::new(SerializedSourceMapLoaded {
                    map: SerializedSourceMap { bytes: serialized.bytes },
                    decompressed_files: decompressed_contents_slice.into_boxed_slice(),
                });

                stored.external_source_names = file_names.into_boxed_slice();
                stored.underlying_provider = SourceMap::UnderlyingProvider {
                    data: (Box::into_raw(data) as usize) as u32, // @truncate(@intFromPtr(data))
                    load_hint: SourceMap::LoadHint::None,
                    kind: SourceMap::ProviderKind::Zig,
                };
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
    pub fn from_bytes(raw_bytes: &'static mut [u8], offsets: Offsets) -> Result<StandaloneModuleGraph, BunError> {
        // TODO(port): narrow error set
        if raw_bytes.is_empty() {
            return Ok(StandaloneModuleGraph {
                bytes: b"",
                files: StringArrayHashMap::new(),
                entry_point_id: 0,
                compile_exec_argv: b"",
                flags: Flags::default(),
            });
        }

        let modules_list_bytes = slice_to(raw_bytes, offsets.modules_ptr);
        // SAFETY: modules_list_bytes was written as &[CompiledModuleGraphFile]; align(1) in Zig.
        let modules_list: &[CompiledModuleGraphFile] = unsafe {
            core::slice::from_raw_parts(
                modules_list_bytes.as_ptr() as *const CompiledModuleGraphFile,
                modules_list_bytes.len() / size_of::<CompiledModuleGraphFile>(),
            )
        };

        if offsets.entry_point_id as usize > modules_list.len() {
            return Err(err!("Corrupted module graph: entry point ID is greater than module list count"));
        }

        let mut modules = StringArrayHashMap::<File>::new();
        modules.reserve(modules_list.len());
        for module in modules_list {
            // PERF(port): was putAssumeCapacity
            modules.put(
                slice_to_z(raw_bytes, module.name).as_bytes(),
                File {
                    name: slice_to_z(raw_bytes, module.name).as_bytes(),
                    loader: module.loader,
                    contents: slice_to_z(raw_bytes, module.contents),
                    sourcemap: if module.sourcemap.length > 0 {
                        LazySourceMap::Serialized(SerializedSourceMap {
                            // TODO(port): @alignCast — alignment of source map bytes
                            bytes: slice_to(raw_bytes, module.sourcemap),
                        })
                    } else {
                        LazySourceMap::None
                    },
                    bytecode: if module.bytecode.length > 0 {
                        // SAFETY: @constCast — section bytes are writable at runtime; JSC mutates bytecode in place.
                        slice_to(raw_bytes, module.bytecode) as *const [u8] as *mut [u8]
                    } else {
                        &mut [] as *mut [u8]
                    },
                    module_info: if module.module_info.length > 0 {
                        // SAFETY: @constCast — see bytecode above.
                        slice_to(raw_bytes, module.module_info) as *const [u8] as *mut [u8]
                    } else {
                        &mut [] as *mut [u8]
                    },
                    bytecode_origin_path: if module.bytecode_origin_path.length > 0 {
                        slice_to_z(raw_bytes, module.bytecode_origin_path).as_bytes()
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
            bytes: &raw_bytes[0..offsets.byte_count],
            files: modules,
            entry_point_id: offsets.entry_point_id,
            compile_exec_argv: slice_to_z(raw_bytes, offsets.compile_exec_argv_ptr).as_bytes(),
            flags: offsets.flags,
        })
    }
}

fn slice_to(bytes: &'static [u8], ptr: StringPointer) -> &'static [u8] {
    if ptr.length == 0 {
        return b"";
    }
    &bytes[ptr.offset as usize..][..ptr.length as usize]
}

fn slice_to_z(bytes: &'static [u8], ptr: StringPointer) -> &'static ZStr {
    if ptr.length == 0 {
        return ZStr::empty();
    }
    // SAFETY: bytes[offset+length] == 0 was written by toBytes() (appendCountZ).
    unsafe { ZStr::from_raw(bytes.as_ptr().add(ptr.offset as usize), ptr.length as usize) }
}

pub fn to_bytes(
    prefix: &[u8],
    output_files: &[OutputFile],
    output_format: Format,
    compile_exec_argv: &[u8],
    flags: Flags,
) -> Result<Vec<u8>, BunError> {
    // TODO(port): narrow error set
    let _serialize_trace = bun_perf::trace("StandaloneModuleGraph.serialize");

    let mut entry_point_id: Option<usize> = None;
    let mut string_builder = bun_str::StringBuilder::default();
    let mut module_count: usize = 0;
    for output_file in output_files {
        string_builder.count_z(&output_file.dest_path);
        string_builder.count_z(prefix);
        if let options::OutputValue::Buffer(buf) = &output_file.value {
            if output_file.output_kind == options::OutputKind::Sourcemap {
                // This is an over-estimation to ensure that we allocate
                // enough memory for the source-map contents. Calculating
                // the exact amount is not possible without allocating as it
                // involves a JSON parser.
                string_builder.cap += buf.bytes.len() * 2;
            } else if output_file.output_kind == options::OutputKind::Bytecode {
                // Allocate up to 256 byte alignment for bytecode
                string_builder.cap += (buf.bytes.len() + 255) / 256 * 256 + 256;
            } else if output_file.output_kind == options::OutputKind::ModuleInfo {
                string_builder.cap += buf.bytes.len();
            } else {
                if entry_point_id.is_none() {
                    if output_file.side.is_none()
                        || output_file.side == Some(options::Side::Server)
                    {
                        if output_file.output_kind == options::OutputKind::EntryPoint {
                            entry_point_id = Some(module_count);
                        }
                    }
                }

                string_builder.count_z(&buf.bytes);
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

        let options::OutputValue::Buffer(buf) = &output_file.value else {
            continue;
        };

        let dest_path = bun_str::strings::remove_leading_dot_slash(&output_file.dest_path);

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
                let bytecode = &output_files[output_file.bytecode_index as usize]
                    .value.buffer().bytes;
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
                writable_after_padding[0..bytecode.len()].copy_from_slice(&bytecode[0..bytecode.len()]);
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
                let mi_bytes = &output_files[output_file.module_info_index as usize]
                    .value.buffer().bytes;
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

        #[cfg(any(feature = "canary", debug_assertions))]
        {
            if let Some(dump_code_dir) = bun_core::env_var::BUN_FEATURE_FLAG_DUMP_CODE.get() {
                let mut path_buf = bun_paths::path_buffer_pool().get();
                let dest_z = path::join_abs_string_buf_z(dump_code_dir, &mut *path_buf, &[dest_path], path::Style::Auto);

                // Scoped block to handle dump failures without skipping module emission
                'dump: {
                    let file = match bun_sys::File::make_open(
                        dest_z,
                        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                        0o664,
                    ).unwrap_result() {
                        Ok(f) => f,
                        Err(e) => {
                            Output::pretty_errorln(format_args!(
                                "<r><red>error<r><d>:<r> failed to open {}: {}",
                                bstr::BStr::new(dest_path), e.name()
                            ));
                            break 'dump;
                        }
                    };
                    if let Err(e) = file.write_all(&buf.bytes).unwrap_result() {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r><d>:<r> failed to write {}: {}",
                            bstr::BStr::new(dest_path), e.name()
                        ));
                        break 'dump;
                    }
                    drop(file);
                }
            }
        }

        // When there's bytecode, store the bytecode output file's path as bytecode_origin_path.
        // This path was used to generate the bytecode cache and must match at runtime.
        let bytecode_origin_path: StringPointer = if output_file.bytecode_index != u32::MAX {
            string_builder.append_count_z(&output_files[output_file.bytecode_index as usize].dest_path)
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
            contents: string_builder.append_count_z(&buf.bytes),
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
            sourcemap: Schema::StringPointer::default(),
        };

        if output_file.source_map_index != u32::MAX {
            // PERF(port): Zig used defer clearRetainingCapacity + arena.reset(.retain_capacity)
            serialize_json_source_map_for_standalone(
                &mut source_map_header_list,
                &mut source_map_string_list,
                &output_files[output_file.source_map_index as usize].value.buffer().bytes,
            )?;
            module.sourcemap = string_builder.add_concat(&[
                &source_map_header_list,
                &source_map_string_list,
            ]);
            source_map_header_list.clear();
            source_map_string_list.clear();
        }
        // PERF(port): was appendAssumeCapacity
        modules.push(module);
    }

    let offsets = Offsets {
        entry_point_id: entry_point_id.unwrap() as u32,
        modules_ptr: string_builder.append_count(bytemuck::cast_slice::<_, u8>(&modules)),
        compile_exec_argv_ptr: string_builder.append_count_z(compile_exec_argv),
        byte_count: string_builder.len,
        flags,
    };

    let _ = string_builder.append(bytemuck::bytes_of(&offsets));
    let _ = string_builder.append(TRAILER);

    // SAFETY: string_builder.ptr was set by allocate() above.
    let output_bytes = unsafe {
        core::slice::from_raw_parts_mut(string_builder.ptr.unwrap(), string_builder.len)
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
    inject_options: InjectOptions,
    target: &CompileTarget,
) -> Fd {
    let mut buf = PathBuffer::uninit();
    let mut zname: &ZStr = match bun_fs::FileSystem::tmpname(
        b"bun-build",
        &mut buf,
        // SAFETY: i64 → u64 bitcast (same size).
        unsafe { core::mem::transmute::<i64, u64>(bun_core::time::milli_timestamp()) },
    ) {
        Ok(n) => n,
        Err(e) => {
            Output::pretty_errorln(format_args!(
                "<r><red>error<r><d>:<r> failed to get temporary file name: {}",
                e.name()
            ));
            return Fd::invalid();
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
            // SAFETY: in_buf[self_exe.len()] == 0 written above.
            let in_ = unsafe { bun_str::WStr::from_raw(in_buf.as_ptr(), self_exe.len()) };
            let mut out_buf = WPathBuffer::uninit();
            strings::copy_u8_into_u16(&mut out_buf, zname.as_bytes());
            out_buf[zname.len()] = 0;
            // SAFETY: out_buf[zname.len()] == 0 written above.
            let out = unsafe { bun_str::WStr::from_raw(out_buf.as_ptr(), zname.len()) };

            if let Err(e) = bun_sys::copy_file(in_, out).unwrap_result() {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {}",
                    e.name()
                ));
                return Fd::invalid();
            }
            use bun_sys::windows as w;
            let file = match Syscall::open_file_at_windows(
                Fd::invalid(),
                out,
                Syscall::OpenFileOptions {
                    access_mask: w::SYNCHRONIZE | w::GENERIC_WRITE | w::GENERIC_READ | w::DELETE,
                    disposition: w::FILE_OPEN,
                    options: w::FILE_SYNCHRONOUS_IO_NONALERT | w::FILE_OPEN_REPARSE_POINT,
                },
            ).unwrap_result() {
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
                match Syscall::open(zname, bun_sys::O::CLOEXEC | bun_sys::O::RDWR | bun_sys::O::CREAT, 0) {
                    bun_sys::Result::Ok(res) => break 'brk2 res,
                    bun_sys::Result::Err(err) => {
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
                                let zname_z = bun_str::strings::concat(&[
                                    bun_fs::FileSystem::RealFS::tmpdir_path(),
                                    SEP_STR.as_bytes(),
                                    zname.as_bytes(),
                                    &[0],
                                ]);
                                // SAFETY: trailing 0 byte appended above.
                                zname = unsafe {
                                    ZStr::from_raw(
                                        zname_z.as_ptr(),
                                        zname_z.len().saturating_sub(1),
                                    )
                                };
                                // TODO(port): zname_z leaks here intentionally (matches Zig).
                                core::mem::forget(zname_z);
                                continue;
                            }
                            match err.get_errno() {
                                // try again
                                bun_sys::Errno::PERM
                                | bun_sys::Errno::AGAIN
                                | bun_sys::Errno::BUSY => continue,
                                _ => break,
                            }

                            #[allow(unreachable_code)]
                            {
                                Output::pretty_errorln(format_args!(
                                    "<r><red>error<r><d>:<r> failed to open temporary file to copy bun into\n{}",
                                    err
                                ));
                                // No fd to cleanup yet, just return error
                                return Fd::invalid();
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
                    bun_sys::Result::Ok(res) => break 'brk2 res,
                    bun_sys::Result::Err(err) => {
                        if retry < 2 {
                            match err.get_errno() {
                                // try again
                                bun_sys::Errno::PERM
                                | bun_sys::Errno::AGAIN
                                | bun_sys::Errno::BUSY => continue,
                                _ => {}
                            }
                        }

                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r><d>:<r> failed to open bun executable to copy from as read-only\n{}",
                            err
                        ));
                        cleanup(zname, fd);
                        return Fd::invalid();
                    }
                }
            }
            unreachable!()
        };

        #[cfg(not(windows))]
        {
            // defer self_fd.close()
            let _self_fd_guard = scopeguard::guard((), |_| self_fd.close());

            if let Err(e) = bun_sys::copy_file(self_fd, fd).unwrap_result() {
                Output::pretty_errorln(format_args!(
                    "<r><red>error<r><d>:<r> failed to copy bun executable into temporary file: {}",
                    e.name()
                ));
                cleanup(zname, fd);
                return Fd::invalid();
            }

            break 'brk fd;
        }
    };

    match target.os {
        CompileTargetOs::Mac => {
            let input_result = bun_sys::File { handle: cloned_executable_fd }.read_to_end();
            if let Some(err) = input_result.err {
                Output::pretty_errorln(format_args!("Error reading standalone module graph: {}", err));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
            let mut macho_file = match bun_macho::MachoFile::init(input_result.bytes, bytes.len()) {
                Ok(f) => f,
                Err(e) => {
                    Output::pretty_errorln(format_args!("Error initializing standalone module graph: {}", e));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::invalid();
                }
            };
            if let Err(e) = macho_file.write_section(bytes) {
                Output::pretty_errorln(format_args!("Error writing standalone module graph: {}", e));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
            // input_result.bytes dropped here

            if let bun_sys::Result::Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                Output::pretty_errorln(format_args!("Error seeking to start of temporary file: {}", err));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }

            let mut file = bun_sys::File { handle: cloned_executable_fd };
            let writer = file.writer();
            // TODO(port): Zig used writer.adaptToNewApi(&buffer) with 512KB stack buffer.
            let mut buffered_writer = bun_io::BufWriter::with_capacity(512 * 1024, writer);
            if let Err(e) = macho_file.build_and_sign(&mut buffered_writer) {
                Output::pretty_errorln(format_args!("Error writing standalone module graph: {}", e));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
            if let Err(e) = buffered_writer.flush() {
                Output::pretty_errorln(format_args!("Error flushing standalone module graph: {}", e));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
            #[cfg(not(windows))]
            {
                // SAFETY: libc fchmod on a valid native fd.
                unsafe { bun_sys::c::fchmod(cloned_executable_fd.native(), 0o777) };
            }
            return cloned_executable_fd;
        }
        CompileTargetOs::Windows => {
            let input_result = bun_sys::File { handle: cloned_executable_fd }.read_to_end();
            if let Some(err) = input_result.err {
                Output::pretty_errorln(format_args!("Error reading standalone module graph: {}", err));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
            let mut pe_file = match bun_pe::PEFile::init(input_result.bytes) {
                Ok(f) => f,
                Err(e) => {
                    Output::pretty_errorln(format_args!("Error initializing PE file: {}", e));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::invalid();
                }
            };
            // Always strip authenticode when adding .bun section for --compile
            if let Err(e) = pe_file.add_bun_section(bytes, bun_pe::AuthenticodeMode::StripAlways) {
                Output::pretty_errorln(format_args!("Error adding Bun section to PE file: {}", e));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
            // input_result.bytes dropped here

            if let bun_sys::Result::Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                Output::pretty_errorln(format_args!("Error seeking to start of temporary file: {}", err));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }

            let mut file = bun_sys::File { handle: cloned_executable_fd };
            let writer = file.writer();
            if let Err(e) = pe_file.write(writer) {
                Output::pretty_errorln(format_args!("Error writing PE file: {}", e));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
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
            let input_result = bun_sys::File { handle: cloned_executable_fd }.read_to_end();
            if let Some(err) = input_result.err {
                Output::pretty_errorln(format_args!("Error reading executable: {}", err));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }

            let mut elf_file = match bun_elf::ElfFile::init(input_result.bytes) {
                Ok(f) => f,
                Err(e) => {
                    Output::pretty_errorln(format_args!("Error initializing ELF file: {}", e));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::invalid();
                }
            };

            elf_file.normalize_interpreter();

            if let Err(e) = elf_file.write_bun_section(bytes) {
                Output::pretty_errorln(format_args!("Error writing .bun section to ELF: {}", e));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
            // input_result.bytes dropped here

            if let bun_sys::Result::Err(err) = Syscall::set_file_offset(cloned_executable_fd, 0) {
                Output::pretty_errorln(format_args!("Error seeking to start of temporary file: {}", err));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }

            // Write the modified ELF data back to the file
            let write_file = bun_sys::File { handle: cloned_executable_fd };
            if let bun_sys::Result::Err(err) = write_file.write_all(&elf_file.data) {
                Output::pretty_errorln(format_args!("Error writing ELF file: {}", err));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
            // Truncate the file to the exact size of the modified ELF
            let _ = Syscall::ftruncate(cloned_executable_fd, i64::try_from(elf_file.data.len()).unwrap());

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
                total_byte_count = bytes.len() + 8 + match Syscall::set_file_offset_to_end_windows(cloned_executable_fd).unwrap_result() {
                    Ok(v) => v,
                    Err(e) => {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r><d>:<r> failed to seek to end of temporary file\n{}", e
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
                        bun_sys::Result::Ok(res) => res,
                        bun_sys::Result::Err(err) => {
                            Output::pretty_errorln(format_args!("{}", err));
                            cleanup(zname, cloned_executable_fd);
                            return Fd::invalid();
                        }
                    };
                    break 'brk fstat.size.max(0);
                }).unwrap();

                total_byte_count = seek_position as usize + bytes.len() + 8;

                // From https://man7.org/linux/man-pages/man2/lseek.2.html
                //
                //  lseek() allows the file offset to be set beyond the end of the
                //  file (but this does not change the size of the file).  If data is
                //  later written at this point, subsequent reads of the data in the
                //  gap (a "hole") return null bytes ('\0') until data is actually
                //  written into the gap.
                //
                if let bun_sys::Result::Err(err) = Syscall::set_file_offset(cloned_executable_fd, seek_position) {
                    Output::pretty_errorln(format_args!(
                        "{}\nwhile seeking to end of temporary file (pos: {})",
                        err, seek_position
                    ));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::invalid();
                }
            }

            let mut remain = bytes;
            while !remain.is_empty() {
                match Syscall::write(cloned_executable_fd, remain) {
                    bun_sys::Result::Ok(written) => remain = &remain[written..],
                    bun_sys::Result::Err(err) => {
                        Output::pretty_errorln(format_args!(
                            "<r><red>error<r><d>:<r> failed to write to temporary file\n{}", err
                        ));
                        cleanup(zname, cloned_executable_fd);
                        return Fd::invalid();
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
                bun_sys::File { handle: cloned_executable_fd },
                bun_sys::windows::Subsystem::WindowsGui,
            ) {
                Output::err(e, "failed to disable console on executable", format_args!(""));
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
            let zname_w = match bun_str::strings::to_w_path_normalized(&mut zname_buf, zname.as_bytes()) {
                Ok(w) => w,
                Err(e) => {
                    Output::err(e, "failed to resolve executable path", format_args!(""));
                    cleanup(zname, cloned_executable_fd);
                    return Fd::invalid();
                }
            };

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
                Output::err(e, "failed to set Windows metadata on executable", format_args!(""));
                cleanup(zname, cloned_executable_fd);
                return Fd::invalid();
            }
        }

        cloned_executable_fd
    }
}

pub use bun_options_types::CompileTarget;
// TODO(port): CompileTarget.os enum variants — using a placeholder name.
use bun_options_types::CompileTargetOs;

pub fn download(
    target: &CompileTarget,
    env: &mut bun_dotenv::Loader,
) -> Result<Box<ZStr>, BunError> {
    // TODO(port): narrow error set
    let mut exe_path_buf = PathBuffer::uninit();
    let mut version_str_buf = [0u8; 1024];
    // TODO(port): std.fmt.bufPrintZ — write into fixed buffer with NUL.
    let version_str = {
        let mut cursor = &mut version_str_buf[..];
        write!(cursor, "{}", target).map_err(|_| err!("NoSpaceLeft"))?;
        let written = 1024 - cursor.len();
        version_str_buf[written] = 0;
        // SAFETY: version_str_buf[written] == 0 written above.
        unsafe { ZStr::from_raw(version_str_buf.as_ptr(), written) }
    };
    let mut needs_download: bool = true;
    let dest_z = target.exe_path(&mut exe_path_buf, version_str, env, &mut needs_download);
    if needs_download {
        if let Err(e) = target.download_to_path(env, dest_z) {
            // For CLI, provide detailed error messages and exit
            if e == err!("TargetNotFound") {
                Output::err_generic(format_args!(
                    "Does this target and version of Bun exist?\n\n404 downloading {} from npm registry",
                    target
                ));
            } else if e == err!("NetworkError") {
                Output::err_generic(format_args!(
                    "Failed to download cross-compilation target.\n\nNetwork error downloading {} from npm registry",
                    target
                ));
            } else if e == err!("InvalidResponse") {
                Output::err_generic(format_args!(
                    "Failed to verify the integrity of the downloaded tarball.\n\nThe downloaded content for {} appears to be corrupted",
                    target
                ));
            } else if e == err!("ExtractionFailed") {
                Output::err_generic(format_args!(
                    "Failed to extract the downloaded tarball.\n\nCould not extract executable for {}",
                    target
                ));
            } else {
                Output::err_generic(format_args!("Failed to download {}: {}", target, e.name()));
            }
            return Err(err!("DownloadFailed"));
        }
    }

    Ok(ZStr::from_bytes(dest_z.as_bytes()))
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
    let bytes = match to_bytes(module_prefix, output_files, output_format, compile_exec_argv, flags) {
        Ok(b) => b,
        Err(e) => {
            return Ok(CompileResult::fail_fmt(format_args!(
                "failed to generate module graph bytes: {}", e.name()
            )));
        }
    };
    if bytes.is_empty() {
        return Ok(CompileResult::fail(CompileErrorReason::NoOutputFiles));
    }
    // bytes drops at end of scope

    let mut free_self_exe = false;
    let self_exe: Box<ZStr> = if let Some(path) = self_exe_path {
        free_self_exe = true;
        ZStr::from_bytes(path)
    } else if target.is_default() {
        match bun_core::self_exe_path() {
            Ok(p) => p,
            Err(e) => {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "failed to get self executable path: {}", e.name()
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
        let version_zstr = unsafe { ZStr::from_raw(version_str.as_ptr(), version_str.len() - 1) };

        let mut needs_download: bool = true;
        let dest_z = target.exe_path(&mut exe_path_buf, version_zstr, env, &mut needs_download);

        if needs_download {
            if let Err(e) = target.download_to_path(env, dest_z) {
                return Ok(if e == err!("TargetNotFound") {
                    CompileResult::fail_fmt(format_args!("Target platform '{}' is not available for download. Check if this version of Bun supports this target.", target))
                } else if e == err!("NetworkError") {
                    CompileResult::fail_fmt(format_args!("Network error downloading executable for '{}'. Check your internet connection and proxy settings.", target))
                } else if e == err!("InvalidResponse") {
                    CompileResult::fail_fmt(format_args!("Downloaded file for '{}' appears to be corrupted. Please try again.", target))
                } else if e == err!("ExtractionFailed") {
                    CompileResult::fail_fmt(format_args!("Failed to extract executable for '{}'. The download may be incomplete.", target))
                } else if e == err!("UnsupportedTarget") {
                    CompileResult::fail_fmt(format_args!("Target '{}' is not supported", target))
                } else {
                    CompileResult::fail_fmt(format_args!("Failed to download '{}': {}", target, e.name()))
                });
            }
        }

        free_self_exe = true;
        ZStr::from_bytes(dest_z.as_bytes())
    };
    // PORT NOTE: free_self_exe tracked whether to free self_exe; Box drops unconditionally.
    let _ = free_self_exe;

    let mut fd = inject(&bytes, &self_exe, windows_options.clone(), target);
    // TODO(port): errdefer — Zig's `defer if (fd != invalid) fd.close()` reads `fd` at
    // scope exit after later reassignments. A scopeguard closure capturing `fd` by value
    // would not observe those writes; capturing by `&mut` conflicts with later uses.
    // Explicit close calls are inserted at every early-return below (matches Zig behavior).
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
                return Ok(CompileResult::fail_fmt(format_args!(
                    "Failed to get temp file path: {}", e.name()
                )));
            }
        };

        // Build the absolute destination path
        // On Windows, we need an absolute path for MoveFileExW
        // Get the current working directory and join with outfile
        let mut cwd_buf = PathBuffer::uninit();
        let cwd_path = match bun_sys::getcwd(&mut cwd_buf) {
            Ok(p) => p,
            Err(e) => {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "Failed to get current directory: {}", e.name()
                )));
            }
        };
        let dest_path = if bun_paths::is_absolute(outfile) {
            outfile
        } else {
            path::join_abs_string(cwd_path, &[outfile], path::Style::Auto)
        };

        // Convert paths to Windows UTF-16
        let mut temp_buf_w = OSPathBuffer::uninit();
        let mut dest_buf_w = OSPathBuffer::uninit();
        let temp_w = bun_str::strings::to_w_path_normalized(&mut temp_buf_w, temp_path);
        let dest_w = bun_str::strings::to_w_path_normalized(&mut dest_buf_w, dest_path);

        // Ensure null termination
        let temp_buf_u16 = bun_core::reinterpret_slice::<u16>(&mut temp_buf_w);
        let dest_buf_u16 = bun_core::reinterpret_slice::<u16>(&mut dest_buf_w);
        temp_buf_u16[temp_w.len()] = 0;
        dest_buf_u16[dest_w.len()] = 0;

        // Close the file handle before moving (Windows requires this)
        fd.close();
        fd = Fd::invalid();

        use bun_sys::windows;
        // Move the file using MoveFileExW
        // SAFETY: NUL-terminated wide strings constructed above.
        if unsafe {
            windows::kernel32::MoveFileExW(
                temp_buf_u16[..temp_w.len()].as_ptr(),
                dest_buf_u16[..dest_w.len()].as_ptr(),
                windows::MOVEFILE_COPY_ALLOWED | windows::MOVEFILE_REPLACE_EXISTING | windows::MOVEFILE_WRITE_THROUGH,
            )
        } == windows::FALSE
        {
            let werr = windows::Win32Error::get();
            if let Some(sys_err) = werr.to_system_errno() {
                if sys_err == bun_sys::Errno::EISDIR {
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
                    "failed to move executable to {}", bstr::BStr::new(dest_path)
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
            if let Err(e) = windows::rescle::set_windows_metadata(
                dest_buf_u16[..dest_w.len()].as_ptr(),
                windows_options.icon.as_deref(),
                windows_options.title.as_deref(),
                windows_options.publisher.as_deref(),
                windows_options.version.as_deref(),
                windows_options.description.as_deref(),
                windows_options.copyright.as_deref(),
            ) {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "Failed to set Windows metadata: {}", e.name()
                )));
            }
        }
        return Ok(CompileResult::Success);
    }

    #[cfg(not(windows))]
    {
        let mut buf2 = PathBuffer::uninit();
        let temp_location = match bun_sys::get_fd_path(fd, &mut buf2) {
            Ok(p) => p,
            Err(e) => {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "failed to get path for fd: {}", e.name()
                )));
            }
        };
        // TODO(port): std.posix.toPosixPath — copy into NUL-terminated fixed buffer.
        let temp_posix = match bun_paths::to_posix_path(temp_location) {
            Ok(p) => p,
            Err(e) => {
                return Ok(CompileResult::fail_fmt(format_args!("path too long: {}", e.name())));
            }
        };
        let outfile_basename = bun_paths::basename(outfile);
        let outfile_posix = match bun_paths::to_posix_path(outfile_basename) {
            Ok(p) => p,
            Err(e) => {
                return Ok(CompileResult::fail_fmt(format_args!("outfile name too long: {}", e.name())));
            }
        };

        if let Err(e) = bun_sys::move_file_z_with_handle(
            fd,
            Fd::cwd(),
            bun_str::slice_to_nul(&temp_posix),
            Fd::from_std_dir(root_dir),
            bun_str::slice_to_nul(&outfile_posix),
        ) {
            fd.close();
            fd = Fd::invalid();

            let _ = Syscall::unlink(&temp_posix);

            if e == err!("IsDir") || e == err!("EISDIR") {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "{} is a directory. Please choose a different --outfile or delete the directory",
                    bstr::BStr::new(outfile)
                )));
            } else {
                return Ok(CompileResult::fail_fmt(format_args!(
                    "failed to rename {} to {}: {}",
                    bstr::BStr::new(temp_location),
                    bstr::BStr::new(outfile),
                    e.name()
                )));
            }
        }

        Ok(CompileResult::Success)
    }
}

impl StandaloneModuleGraph {
    /// Loads the standalone module graph from the executable, allocates it on the heap,
    /// sets it globally, and returns the pointer.
    pub fn from_executable() -> Result<Option<&'static mut StandaloneModuleGraph>, BunError> {
        // TODO(port): narrow error set
        #[cfg(target_os = "macos")]
        {
            let Some(macho_bytes) = macho::get_data() else { return Ok(None); };
            if macho_bytes.len() < size_of::<Offsets>() + TRAILER.len() {
                Output::debug_warn(format_args!("bun standalone module graph is too small to be valid"));
                return Ok(None);
            }
            let macho_bytes_slice = &macho_bytes[macho_bytes.len() - size_of::<Offsets>() - TRAILER.len()..];
            let trailer_bytes = &macho_bytes[macho_bytes.len() - TRAILER.len()..][..TRAILER.len()];
            if trailer_bytes != TRAILER {
                Output::debug_warn(format_args!("bun standalone module graph has invalid trailer"));
                return Ok(None);
            }
            // SAFETY: macho_bytes_slice has at least size_of::<Offsets>() bytes.
            let offsets: Offsets = unsafe { core::ptr::read_unaligned(macho_bytes_slice.as_ptr() as *const Offsets) };
            // SAFETY: section bytes are program-static; @constCast in Zig.
            let raw = unsafe { core::slice::from_raw_parts_mut(macho_bytes.as_ptr() as *mut u8, macho_bytes.len()) };
            return from_bytes_alloc(raw, offsets).map(Some);
        }

        #[cfg(windows)]
        {
            let Some(pe_bytes) = pe::get_data() else { return Ok(None); };
            if pe_bytes.len() < size_of::<Offsets>() + TRAILER.len() {
                Output::debug_warn(format_args!("bun standalone module graph is too small to be valid"));
                return Ok(None);
            }
            let pe_bytes_slice = &pe_bytes[pe_bytes.len() - size_of::<Offsets>() - TRAILER.len()..];
            let trailer_bytes = &pe_bytes[pe_bytes.len() - TRAILER.len()..][..TRAILER.len()];
            if trailer_bytes != TRAILER {
                Output::debug_warn(format_args!("bun standalone module graph has invalid trailer"));
                return Ok(None);
            }
            // SAFETY: pe_bytes_slice has at least size_of::<Offsets>() bytes.
            let offsets: Offsets = unsafe { core::ptr::read_unaligned(pe_bytes_slice.as_ptr() as *const Offsets) };
            // SAFETY: section bytes are program-static; @constCast in Zig.
            let raw = unsafe { core::slice::from_raw_parts_mut(pe_bytes.as_ptr() as *mut u8, pe_bytes.len()) };
            return from_bytes_alloc(raw, offsets).map(Some);
        }

        #[cfg(any(target_os = "linux", target_os = "freebsd"))]
        {
            let Some(elf_bytes) = elf::get_data() else { return Ok(None); };
            if elf_bytes.len() < size_of::<Offsets>() + TRAILER.len() {
                Output::debug_warn(format_args!("bun standalone module graph is too small to be valid"));
                return Ok(None);
            }
            let elf_bytes_slice = &elf_bytes[elf_bytes.len() - size_of::<Offsets>() - TRAILER.len()..];
            let trailer_bytes = &elf_bytes[elf_bytes.len() - TRAILER.len()..][..TRAILER.len()];
            if trailer_bytes != TRAILER {
                Output::debug_warn(format_args!("bun standalone module graph has invalid trailer"));
                return Ok(None);
            }
            // SAFETY: elf_bytes_slice has at least size_of::<Offsets>() bytes.
            let offsets: Offsets = unsafe { core::ptr::read_unaligned(elf_bytes_slice.as_ptr() as *const Offsets) };
            // SAFETY: section bytes are program-static; @constCast in Zig.
            let raw = unsafe { core::slice::from_raw_parts_mut(elf_bytes.as_ptr() as *mut u8, elf_bytes.len()) };
            return from_bytes_alloc(raw, offsets).map(Some);
        }

        #[cfg(not(any(target_os = "macos", windows, target_os = "linux", target_os = "freebsd")))]
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
        { return; }

        #[cfg(not(windows))]
        {
            let bytes: &'static [u8] = {
                #[cfg(target_os = "macos")]
                { match macho::get_data() { Some(b) => b, None => return } }
                #[cfg(target_os = "linux")]
                { match elf::get_data() { Some(b) => b, None => return } }
                #[cfg(not(any(target_os = "macos", target_os = "linux")))]
                { return; }
            };

            if bytes.is_empty() {
                return;
            }

            let page: usize = bun_alloc::page_size();
            let start = (bytes.as_ptr() as usize) & !(page - 1);
            let end_unaligned = bytes.as_ptr() as usize + bytes.len();
            let end = (end_unaligned + page - 1) & !(page - 1);

            // std.posix.madvise hits `unreachable` on unexpected errnos; this is a
            // best-effort hint, so call libc directly and just log on failure.
            // SAFETY: start..end covers a mapped range of the executable image.
            let rc = unsafe { bun_sys::c::madvise(start as *mut core::ffi::c_void, end - start, bun_sys::c::MADV_DONTNEED) };
            if rc != 0 {
                // SAFETY: errno location is thread-local libc storage.
                Output::debug_warn(format_args!(
                    "hintSourcePagesDontNeed: madvise failed errno={}",
                    unsafe { *bun_sys::c::errno_location() }
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

/// Allocates a StandaloneModuleGraph on the heap, populates it from bytes, sets it globally, and returns the pointer.
fn from_bytes_alloc(raw_bytes: &'static mut [u8], offsets: Offsets) -> Result<&'static mut StandaloneModuleGraph, BunError> {
    let graph = StandaloneModuleGraph::from_bytes(raw_bytes, offsets)?;
    let graph_ptr = Box::leak(Box::new(graph));
    StandaloneModuleGraph::set(graph_ptr);
    Ok(graph_ptr)
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
        unsafe { core::ptr::read_unaligned(self.bytes.as_ptr() as *const SerializedSourceMapHeader) }
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

    pub fn source_file_names(self) -> &'static [StringPointer] {
        let head = self.header();
        // SAFETY: bytes layout per Header doc; align(1) StringPointer slice.
        unsafe {
            core::slice::from_raw_parts(
                self.bytes[size_of::<SerializedSourceMapHeader>()..].as_ptr() as *const StringPointer,
                head.source_files_count as usize,
            )
        }
    }

    fn compressed_source_files(self) -> &'static [StringPointer] {
        let head = self.header();
        // SAFETY: second contiguous StringPointer array follows the first.
        unsafe {
            core::slice::from_raw_parts(
                (self.bytes[size_of::<SerializedSourceMapHeader>()..].as_ptr() as *const StringPointer)
                    .add(head.source_files_count as usize),
                head.source_files_count as usize,
            )
        }
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
        // PORT NOTE: reshaped for borrowck — check cache first, populate, then re-borrow.
        if let Some(decompressed) = &self.decompressed_files[index] {
            return if decompressed.is_empty() { None } else { Some(decompressed) };
        }

        let compressed_codes = self.map.compressed_source_files();
        let compressed_file = compressed_codes[index].slice(self.map.bytes);
        let size = bun_zstd::get_decompressed_size(compressed_file);

        let mut bytes = vec![0u8; size];
        let result = bun_zstd::decompress(&mut bytes, compressed_file);

        match result {
            bun_zstd::Result::Err(err_msg) => {
                Output::warn(format_args!("Source map decompression error: {}", bstr::BStr::new(err_msg)));
                self.decompressed_files[index] = Some(Vec::new());
                None
            }
            bun_zstd::Result::Success(n) => {
                bytes.truncate(n);
                self.decompressed_files[index] = Some(bytes);
                self.decompressed_files[index].as_deref()
            }
        }
    }
}

pub fn serialize_json_source_map_for_standalone(
    header_list: &mut Vec<u8>,
    string_payload: &mut Vec<u8>,
    json_source: &[u8],
) -> Result<(), BunError> {
    // TODO(port): narrow error set
    // PERF(port): was arena bulk-free (arena param dropped)
    let json_src = bun_logger::Source::init_path_string(b"sourcemap.json", json_source);
    let mut log = bun_logger::Log::new();

    // the allocator given to the JS parser is not respected for all parts
    // of the parse, so we need to remember to reset the ast store
    bun_js_parser::Expr::Data::Store::reset();
    bun_js_parser::Stmt::Data::Store::reset();
    let _reset_guard = scopeguard::guard((), |_| {
        bun_js_parser::Expr::Data::Store::reset();
        bun_js_parser::Stmt::Data::Store::reset();
    });
    let mut json = bun_json::parse(&json_src, &mut log, false)
        .map_err(|_| err!("InvalidSourceMap"))?;

    let mappings_str = json.get(b"mappings").ok_or(err!("InvalidSourceMap"))?;
    if !matches!(mappings_str.data, bun_js_parser::ExprData::EString(_)) {
        return Err(err!("InvalidSourceMap"));
    }
    let sources_content = match json.get(b"sourcesContent").ok_or(err!("InvalidSourceMap"))?.data {
        bun_js_parser::ExprData::EArray(arr) => arr,
        _ => return Err(err!("InvalidSourceMap")),
    };
    let sources_paths = match json.get(b"sources").ok_or(err!("InvalidSourceMap"))?.data {
        bun_js_parser::ExprData::EArray(arr) => arr,
        _ => return Err(err!("InvalidSourceMap")),
    };
    if sources_content.items.len() != sources_paths.items.len() {
        return Err(err!("InvalidSourceMap"));
    }

    let map_vlq: &[u8] = mappings_str.data.e_string().slice();
    let map_blob = SourceMap::InternalSourceMap::from_vlq(map_vlq, 0)
        .map_err(|_| err!("InvalidSourceMap"))?;

    header_list.extend_from_slice(&u32::try_from(sources_paths.items.len()).unwrap().to_le_bytes());
    header_list.extend_from_slice(&u32::try_from(map_blob.len()).unwrap().to_le_bytes());

    let string_payload_start_location = size_of::<u32>()
        + size_of::<u32>()
        + size_of::<StringPointer>() * sources_content.items.len() * 2 // path + source
        + map_blob.len();

    for item in sources_paths.items.slice() {
        if !matches!(item.data, bun_js_parser::ExprData::EString(_)) {
            return Err(err!("InvalidSourceMap"));
        }

        let decoded = item.data.e_string().string_cloned()?;

        let offset = string_payload.len();
        string_payload.extend_from_slice(&decoded);

        let slice = StringPointer {
            offset: u32::try_from(offset + string_payload_start_location).unwrap(),
            length: u32::try_from(string_payload.len() - offset).unwrap(),
        };
        header_list.extend_from_slice(&slice.offset.to_le_bytes());
        header_list.extend_from_slice(&slice.length.to_le_bytes());
    }

    for item in sources_content.items.slice() {
        if !matches!(item.data, bun_js_parser::ExprData::EString(_)) {
            return Err(err!("InvalidSourceMap"));
        }

        let utf8 = item.data.e_string().string_cloned()?;

        let offset = string_payload.len();

        let bound = bun_zstd::compress_bound(utf8.len());
        string_payload.reserve(bound);

        // SAFETY: spare_capacity_mut yields uninitialized bytes; zstd writes into them.
        let unused = string_payload.spare_capacity_mut();
        // TODO(port): zstd compress into MaybeUninit slice — Phase B may need a safe wrapper.
        let unused_slice = unsafe {
            core::slice::from_raw_parts_mut(unused.as_mut_ptr() as *mut u8, unused.len())
        };
        let compressed_result = bun_zstd::compress(unused_slice, &utf8, 1);
        match compressed_result {
            bun_zstd::Result::Err(err_msg) => {
                Output::panic(format_args!(
                    "Unexpected error compressing sourcemap: {}",
                    bstr::BStr::new(bun_str::span(err_msg))
                ));
            }
            bun_zstd::Result::Success(n) => {
                // SAFETY: zstd wrote `n` bytes into spare capacity.
                unsafe { string_payload.set_len(string_payload.len() + n) };
            }
        }

        let slice = StringPointer {
            offset: u32::try_from(offset + string_payload_start_location).unwrap(),
            length: u32::try_from(string_payload.len() - offset).unwrap(),
        };
        header_list.extend_from_slice(&slice.offset.to_le_bytes());
        header_list.extend_from_slice(&slice.length.to_le_bytes());
    }

    header_list.extend_from_slice(&map_blob);

    debug_assert!(header_list.len() == string_payload_start_location);
    Ok(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/standalone_graph/StandaloneModuleGraph.zig (1548 lines)
//   confidence: medium
//   todos:      31
//   notes:      heavy cross-crate deps (macho/pe/elf/zstd/json/sourcemap/fs); &'static [u8] fields point into executable section; LazySourceMap.load reshaped (split punned slice into two Vecs); inject() trailing windows-metadata block is unreachable (matches Zig); to_executable() fd cleanup hand-rolled (errdefer captures mutated fd)
// ──────────────────────────────────────────────────────────────────────────
