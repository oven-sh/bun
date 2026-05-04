use core::cell::{Cell, RefCell};
use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use bun_core::{self as bun, Output, env_var, perf, FeatureFlags, Environment};
use bun_str::{self as bstr_mod, String as BunString, ZStr};
use bun_sys::{self as sys, Fd};
use bun_paths::{self as paths, PathBuffer, MAX_PATH_BYTES, SEP};
use bun_js_parser::ast::ExportsKind;
use bun_logger::Source;
use bun_fs::{FileSystem, Path as FsPath, PathString};
use bun_wyhash::Wyhash;

bun_output::declare_scope!(cache, visible);

/// ** Update the version number when any breaking changes are made to the cache format or to the JS parser **
/// Version 3: "Infinity" becomes "1/0".
/// Version 4: TypeScript enums are properly handled + more constant folding
/// Version 5: `require.main === module` no longer marks a module as CJS
/// Version 6: `use strict` is preserved in CommonJS modules when at the top of the file
/// Version 7: Several bundler changes that are likely to impact the runtime as well.
/// Version 8: Fix for generated symbols
/// Version 9: String printing changes
/// Version 10: Constant folding for ''.charCodeAt(n)
/// Version 11: Fix ￿ printing regression
/// Version 12: "use strict"; makes it CommonJS if we otherwise don't know which one to pick.
/// Version 13: Hoist `import.meta.require` definition, see #15738
/// Version 14: Updated global defines table list.
/// Version 15: Updated global defines table list.
/// Version 16: Added typeof undefined minification optimization.
/// Version 17: Removed transpiler import rewrite for bun:test. Not bumping it causes test/js/bun/http/req-url-leak.test.ts to fail with SyntaxError: Export named 'expect' not found in module 'bun:test'.
/// Version 18: Include ESM record (module info) with an ES Module, see #15758
/// Version 19: Sourcemap blob is InternalSourceMap (varint stream + sync points), not VLQ.
/// Version 20: InternalSourceMap stream is bit-packed windows.
const EXPECTED_VERSION: u32 = 20;

const MINIMUM_CACHE_SIZE: usize = 50 * 1024;

// When making parser changes, it gets extremely confusing.
// TODO(port): mutable global; only touched in debug builds — keep as plain static mut behind cfg
#[cfg(debug_assertions)]
static BUN_DEBUG_RESTORE_FROM_CACHE: AtomicBool = AtomicBool::new(false);

const SEED: u64 = 42;

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub enum ModuleType {
    #[default]
    None = 0,
    Esm = 1,
    Cjs = 2,
}

/// Non-exhaustive in Zig (`_` arm) — represented as a transparent u8 so unknown
/// values round-trip until validated in `decode`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub struct Encoding(u8);

impl Encoding {
    pub const NONE: Encoding = Encoding(0);
    pub const UTF8: Encoding = Encoding(1);
    pub const UTF16: Encoding = Encoding(2);
    pub const LATIN1: Encoding = Encoding(3);
}

#[derive(Clone, PartialEq, Eq)]
pub struct Metadata {
    pub cache_version: u32,
    pub output_encoding: Encoding,
    pub module_type: ModuleType,

    pub features_hash: u64,

    pub input_byte_length: u64,
    pub input_hash: u64,

    pub output_byte_offset: u64,
    pub output_byte_length: u64,
    pub output_hash: u64,

    pub sourcemap_byte_offset: u64,
    pub sourcemap_byte_length: u64,
    pub sourcemap_hash: u64,

    pub esm_record_byte_offset: u64,
    pub esm_record_byte_length: u64,
    pub esm_record_hash: u64,
}

impl Default for Metadata {
    fn default() -> Self {
        Self {
            cache_version: EXPECTED_VERSION,
            output_encoding: Encoding::NONE,
            module_type: ModuleType::None,
            features_hash: 0,
            input_byte_length: 0,
            input_hash: 0,
            output_byte_offset: 0,
            output_byte_length: 0,
            output_hash: 0,
            sourcemap_byte_offset: 0,
            sourcemap_byte_length: 0,
            sourcemap_hash: 0,
            esm_record_byte_offset: 0,
            esm_record_byte_length: 0,
            esm_record_hash: 0,
        }
    }
}

impl Metadata {
    // Zig computed this via @typeInfo field iteration; in Rust we sum it by hand.
    // 1×u32 + 2×u8 (enum reprs) + 12×u64 = 4 + 2 + 96 = 102
    // TODO(port): static-assert this matches encode() output length
    pub const SIZE: usize = 4 + 1 + 1 + 12 * 8;

    pub fn encode(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        writer.write_int_le::<u32>(self.cache_version)?;
        writer.write_int_le::<u8>(self.module_type as u8)?;
        writer.write_int_le::<u8>(self.output_encoding.0)?;

        writer.write_int_le::<u64>(self.features_hash)?;

        writer.write_int_le::<u64>(self.input_byte_length)?;
        writer.write_int_le::<u64>(self.input_hash)?;

        writer.write_int_le::<u64>(self.output_byte_offset)?;
        writer.write_int_le::<u64>(self.output_byte_length)?;
        writer.write_int_le::<u64>(self.output_hash)?;

        writer.write_int_le::<u64>(self.sourcemap_byte_offset)?;
        writer.write_int_le::<u64>(self.sourcemap_byte_length)?;
        writer.write_int_le::<u64>(self.sourcemap_hash)?;

        writer.write_int_le::<u64>(self.esm_record_byte_offset)?;
        writer.write_int_le::<u64>(self.esm_record_byte_length)?;
        writer.write_int_le::<u64>(self.esm_record_hash)?;
        Ok(())
    }

    pub fn decode(&mut self, reader: &mut impl bun_io::Read) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.cache_version = reader.read_int_le::<u32>()?;
        if self.cache_version != EXPECTED_VERSION {
            return Err(bun_core::err!("StaleCache"));
        }

        // PORT NOTE: reshaped for borrowck/enum-safety — Zig stored raw @enumFromInt then
        // validated at the end; here we validate immediately so ModuleType never holds an
        // out-of-range discriminant.
        let module_type_raw = reader.read_int_le::<u8>()?;
        let output_encoding_raw = reader.read_int_le::<u8>()?;

        self.features_hash = reader.read_int_le::<u64>()?;

        self.input_byte_length = reader.read_int_le::<u64>()?;
        self.input_hash = reader.read_int_le::<u64>()?;

        self.output_byte_offset = reader.read_int_le::<u64>()?;
        self.output_byte_length = reader.read_int_le::<u64>()?;
        self.output_hash = reader.read_int_le::<u64>()?;

        self.sourcemap_byte_offset = reader.read_int_le::<u64>()?;
        self.sourcemap_byte_length = reader.read_int_le::<u64>()?;
        self.sourcemap_hash = reader.read_int_le::<u64>()?;

        self.esm_record_byte_offset = reader.read_int_le::<u64>()?;
        self.esm_record_byte_length = reader.read_int_le::<u64>()?;
        self.esm_record_hash = reader.read_int_le::<u64>()?;

        self.module_type = match module_type_raw {
            1 => ModuleType::Esm,
            2 => ModuleType::Cjs,
            // Invalid module type
            _ => return Err(bun_core::err!("InvalidModuleType")),
        };

        self.output_encoding = Encoding(output_encoding_raw);
        match self.output_encoding {
            Encoding::UTF8 | Encoding::UTF16 | Encoding::LATIN1 => {}
            // Invalid encoding
            _ => return Err(bun_core::err!("UnknownEncoding")),
        }

        Ok(())
    }
}

pub enum OutputCode {
    Utf8(Box<[u8]>),
    String(BunString),
}

impl Default for OutputCode {
    fn default() -> Self {
        OutputCode::Utf8(Box::default())
    }
}

impl OutputCode {
    pub fn byte_slice(&self) -> &[u8] {
        match self {
            OutputCode::Utf8(b) => b,
            OutputCode::String(s) => s.byte_slice(),
        }
    }
}

// Drop is automatic: Box<[u8]> frees, BunString derefs in its own Drop.

#[derive(Default)]
pub struct Entry {
    pub metadata: Metadata,
    pub output_code: OutputCode,
    pub sourcemap: Box<[u8]>,
    pub esm_record: Box<[u8]>,
}

// Zig `deinit` only freed owned fields (with three allocator params); in Rust the
// retyped Box/BunString fields drop automatically, so no explicit Drop body is needed.

impl Entry {
    pub fn save(
        destination_dir: Fd,
        destination_path: PathString,
        input_byte_length: u64,
        input_hash: u64,
        features_hash: u64,
        sourcemap: &[u8],
        esm_record: &[u8],
        output_code: &OutputCode,
        exports_kind: ExportsKind,
    ) -> Result<(), bun_core::Error> {
        let _tracer = perf::trace("RuntimeTranspilerCache.save");

        // atomically write to a tmpfile and then move it to the final destination
        let mut tmpname_buf = PathBuffer::uninit();
        let tmpfilename = FileSystem::tmpname(
            paths::extension(destination_path.slice()),
            &mut tmpname_buf,
            input_hash,
        )?;

        let output_bytes = output_code.byte_slice();

        // First we open the tmpfile, to avoid any other work in the event of failure.
        let mut tmpfile = bun_sys::Tmpfile::create(destination_dir, tmpfilename)?;
        // TODO(port): Zig had `defer { tmpfile.fd.close(); }` — assuming Tmpfile closes its fd on Drop.
        {
            let guard = scopeguard::guard((), |_| {
                if !tmpfile.using_tmpfile {
                    let _ = sys::unlinkat(destination_dir, tmpfilename);
                }
            });

            let mut metadata_buf = [0u8; Metadata::SIZE * 2];
            let metadata_bytes: &[u8] = 'brk: {
                let mut metadata = Metadata {
                    input_byte_length,
                    input_hash,
                    features_hash,
                    module_type: match exports_kind {
                        ExportsKind::Cjs => ModuleType::Cjs,
                        _ => ModuleType::Esm,
                    },
                    output_encoding: match output_code {
                        OutputCode::Utf8(_) => Encoding::UTF8,
                        OutputCode::String(str) => match str.encoding() {
                            bun_str::Encoding::Utf8 => Encoding::UTF8,
                            bun_str::Encoding::Utf16 => Encoding::UTF16,
                            bun_str::Encoding::Latin1 => Encoding::LATIN1,
                        },
                    },
                    sourcemap_byte_length: sourcemap.len() as u64,
                    output_byte_offset: Metadata::SIZE as u64,
                    output_byte_length: output_bytes.len() as u64,
                    sourcemap_byte_offset: (Metadata::SIZE + output_bytes.len()) as u64,
                    esm_record_byte_offset: (Metadata::SIZE + output_bytes.len() + sourcemap.len()) as u64,
                    esm_record_byte_length: esm_record.len() as u64,
                    ..Default::default()
                };

                metadata.output_hash = hash(output_bytes);
                metadata.sourcemap_hash = hash(sourcemap);
                if !esm_record.is_empty() {
                    metadata.esm_record_hash = hash(esm_record);
                }

                // TODO(port): bun_io::FixedBufferStream — placeholder for std.io.fixedBufferStream
                let mut metadata_stream = bun_io::FixedBufferStream::new(&mut metadata_buf[..]);
                metadata.encode(&mut metadata_stream.writer())?;

                #[cfg(debug_assertions)]
                {
                    let mut metadata_stream2 =
                        bun_io::FixedBufferStream::new(&mut metadata_buf[0..Metadata::SIZE]);
                    let mut metadata2 = Metadata::default();
                    if let Err(err) = metadata2.decode(&mut metadata_stream2.reader()) {
                        bun_core::Output::panic(
                            "Metadata did not roundtrip encode -> decode  successfully: {}",
                            err.name(),
                        );
                    }
                    debug_assert!(metadata == metadata2);
                }

                let pos = metadata_stream.pos();
                break 'brk &metadata_buf[0..pos];
            };

            let mut vecs_buf: [sys::PlatformIoVecConst; 4] =
                // SAFETY: we only read the first `vecs_i` elements below.
                unsafe { core::mem::zeroed() };
            let mut vecs_i: usize = 0;
            vecs_buf[vecs_i] = sys::platform_iovec_const_create(metadata_bytes);
            vecs_i += 1;
            if !output_bytes.is_empty() {
                vecs_buf[vecs_i] = sys::platform_iovec_const_create(output_bytes);
                vecs_i += 1;
            }
            if !sourcemap.is_empty() {
                vecs_buf[vecs_i] = sys::platform_iovec_const_create(sourcemap);
                vecs_i += 1;
            }
            if !esm_record.is_empty() {
                vecs_buf[vecs_i] = sys::platform_iovec_const_create(esm_record);
                vecs_i += 1;
            }
            let vecs: &[sys::PlatformIoVecConst] = &vecs_buf[0..vecs_i];

            let mut position: isize = 0;
            let end_position = Metadata::SIZE + output_bytes.len() + sourcemap.len() + esm_record.len();

            #[cfg(debug_assertions)]
            {
                let mut total: usize = 0;
                for v in vecs {
                    debug_assert!(v.len > 0);
                    total += v.len;
                }
                debug_assert!(end_position == total);
            }
            debug_assert!(
                end_position as i64
                    == i64::try_from(
                        sourcemap.len() + output_bytes.len() + Metadata::SIZE + esm_record.len()
                    )
                    .unwrap()
            );

            let _ = sys::preallocate_file(
                tmpfile.fd.cast(),
                0,
                i64::try_from(end_position).unwrap(),
            );
            while (position as usize) < end_position {
                let written = sys::pwritev(tmpfile.fd, vecs, position)?;
                if written <= 0 {
                    return Err(bun_core::err!("WriteFailed"));
                }

                position += isize::try_from(written).unwrap();
            }

            // disarm errdefer (success path)
            scopeguard::ScopeGuard::into_inner(guard);
        }

        // TODO(port): @ptrCast on basename — Zig coerces []const u8 to [:0]const u8 here;
        // assume Tmpfile::finish takes &[u8].
        tmpfile.finish(paths::basename(destination_path.slice()))?;
        Ok(())
    }

    pub fn load(&mut self, file: &sys::File) -> Result<(), bun_core::Error> {
        // TODO(port): Zig used std.fs.File; mapped to bun_sys::File. getEndPos/preadAll/seekTo
        // assumed to exist on bun_sys::File.
        let stat_size = file.get_end_pos()?;
        if stat_size
            < (Metadata::SIZE as u64)
                + self.metadata.output_byte_length
                + self.metadata.sourcemap_byte_length
        {
            return Err(bun_core::err!("MissingData"));
        }

        debug_assert!(
            matches!(&self.output_code, OutputCode::Utf8(b) if b.is_empty()),
            "this should be the default value"
        );

        self.output_code = if self.metadata.output_byte_length == 0 {
            OutputCode::String(BunString::empty())
        } else {
            match self.metadata.output_encoding {
                Encoding::UTF8 => 'brk: {
                    let mut utf8 =
                        vec![0u8; usize::try_from(self.metadata.output_byte_length).unwrap()].into_boxed_slice();
                    let read_bytes =
                        file.pread_all(&mut utf8, self.metadata.output_byte_offset)?;
                    if read_bytes as u64 != self.metadata.output_byte_length {
                        return Err(bun_core::err!("MissingData"));
                    }
                    break 'brk OutputCode::Utf8(utf8);
                }
                Encoding::LATIN1 => 'brk: {
                    let (latin1, bytes) = BunString::create_uninitialized_latin1(
                        usize::try_from(self.metadata.output_byte_length).unwrap(),
                    );
                    // errdefer latin1.deref() — handled by BunString Drop on early return
                    let read_bytes =
                        file.pread_all(bytes, self.metadata.output_byte_offset)?;

                    if self.metadata.output_hash != 0 {
                        if hash(latin1.latin1()) != self.metadata.output_hash {
                            return Err(bun_core::err!("InvalidHash"));
                        }
                    }

                    if read_bytes as u64 != self.metadata.output_byte_length {
                        return Err(bun_core::err!("MissingData"));
                    }

                    break 'brk OutputCode::String(latin1);
                }
                Encoding::UTF16 => 'brk: {
                    let (string, chars) = BunString::create_uninitialized_utf16(
                        usize::try_from(self.metadata.output_byte_length / 2).unwrap(),
                    );
                    // errdefer string.deref() — handled by BunString Drop on early return

                    // SAFETY: chars is &mut [u16] backed by contiguous WTFString storage;
                    // reinterpreting as bytes for pread is sound (alignment of u8 ≤ u16).
                    let chars_bytes = unsafe {
                        core::slice::from_raw_parts_mut(
                            chars.as_mut_ptr().cast::<u8>(),
                            chars.len() * 2,
                        )
                    };
                    let read_bytes =
                        file.pread_all(chars_bytes, self.metadata.output_byte_offset)?;
                    if read_bytes as u64 != self.metadata.output_byte_length {
                        return Err(bun_core::err!("MissingData"));
                    }

                    if self.metadata.output_hash != 0 {
                        let utf16 = string.utf16();
                        // SAFETY: same reinterpretation as above, read-only.
                        let utf16_bytes = unsafe {
                            core::slice::from_raw_parts(
                                utf16.as_ptr().cast::<u8>(),
                                utf16.len() * 2,
                            )
                        };
                        if hash(utf16_bytes) != self.metadata.output_hash {
                            return Err(bun_core::err!("InvalidHash"));
                        }
                    }

                    break 'brk OutputCode::String(string);
                }

                _ => unreachable!("Unexpected output encoding"),
            }
        };

        // errdefer { free output_code } — Drop on self.output_code handles this if we
        // return early below; the field is already assigned, so on error the caller's
        // Entry drop will free it. Matches Zig semantics closely enough.
        // TODO(port): Zig errdefer freed output_code before returning; here it stays in
        // `self` until the Entry is dropped. Behavioral diff only if caller inspects
        // a partially-loaded Entry after error (it doesn't — fromFileWithCacheFilePath
        // discards on error).

        if self.metadata.sourcemap_byte_length > 0 {
            let mut sourcemap =
                vec![0u8; usize::try_from(self.metadata.sourcemap_byte_length).unwrap()].into_boxed_slice();
            let read_bytes =
                file.pread_all(&mut sourcemap, self.metadata.sourcemap_byte_offset)?;
            if read_bytes as u64 != self.metadata.sourcemap_byte_length {
                return Err(bun_core::err!("MissingData"));
            }

            self.sourcemap = sourcemap;
        }

        if self.metadata.esm_record_byte_length > 0 {
            let mut esm_record =
                vec![0u8; usize::try_from(self.metadata.esm_record_byte_length).unwrap()].into_boxed_slice();
            let read_bytes =
                file.pread_all(&mut esm_record, self.metadata.esm_record_byte_offset)?;
            if read_bytes as u64 != self.metadata.esm_record_byte_length {
                return Err(bun_core::err!("MissingData"));
            }

            if self.metadata.esm_record_hash != 0 {
                if hash(&esm_record) != self.metadata.esm_record_hash {
                    return Err(bun_core::err!("InvalidHash"));
                }
            }

            self.esm_record = esm_record;
        }

        Ok(())
    }
}

pub struct RuntimeTranspilerCache {
    pub input_hash: Option<u64>,
    pub input_byte_length: Option<u64>,
    pub features_hash: Option<u64>,
    pub exports_kind: ExportsKind,
    pub output_code: Option<BunString>,
    pub entry: Option<Entry>,
    // PORT NOTE: Zig had sourcemap_allocator / output_code_allocator / esm_record_allocator
    // fields. Per §Allocators (non-AST crate) these are deleted; Box<[u8]> uses global
    // mimalloc. If callers passed distinct arenas, Phase B may need to thread them back.
    // TODO(port): verify callers always passed bun.default_allocator (or equivalent).
}

impl Default for RuntimeTranspilerCache {
    fn default() -> Self {
        Self {
            input_hash: None,
            input_byte_length: None,
            features_hash: None,
            exports_kind: ExportsKind::None,
            output_code: None,
            entry: None,
        }
    }
}

pub fn hash(bytes: &[u8]) -> u64 {
    Wyhash::hash(SEED, bytes)
}

impl RuntimeTranspilerCache {
    pub fn write_cache_filename(buf: &mut [u8], input_hash: u64) -> Result<usize, bun_core::Error> {
        // Zig: "{x}" on std.mem.asBytes(&input_hash) — hex-encodes the 8 native-endian bytes.
        let bytes = input_hash.to_ne_bytes();
        // TODO(port): confirm bun_io::buf_print or equivalent; hand-rolled for now.
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let suffix: &[u8] = if cfg!(debug_assertions) {
            b".debug.pile"
        } else {
            b".pile"
        };
        let needed = bytes.len() * 2 + suffix.len();
        if buf.len() < needed {
            return Err(bun_core::err!("NoSpaceLeft"));
        }
        let mut i = 0usize;
        for b in bytes {
            buf[i] = HEX[(b >> 4) as usize];
            buf[i + 1] = HEX[(b & 0x0f) as usize];
            i += 2;
        }
        buf[i..i + suffix.len()].copy_from_slice(suffix);
        Ok(needed)
    }

    pub fn get_cache_file_path(
        buf: &mut PathBuffer,
        input_hash: u64,
    ) -> Result<&ZStr, bun_core::Error> {
        let cache_dir_len = Self::get_cache_dir(buf)?.len();
        buf[cache_dir_len] = SEP;
        let cache_filename_len =
            Self::write_cache_filename(&mut buf[cache_dir_len + 1..], input_hash)?;
        buf[cache_dir_len + 1 + cache_filename_len] = 0;

        // SAFETY: we wrote a NUL at buf[cache_dir_len + 1 + cache_filename_len] above.
        Ok(unsafe { ZStr::from_raw(buf.as_ptr(), cache_dir_len + 1 + cache_filename_len) })
    }

    fn really_get_cache_dir(buf: &mut PathBuffer) -> &ZStr {
        #[cfg(debug_assertions)]
        {
            BUN_DEBUG_RESTORE_FROM_CACHE.store(
                env_var::BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE.get(),
                Ordering::Relaxed,
            );
        }

        if let Some(dir) = env_var::BUN_RUNTIME_TRANSPILER_CACHE_PATH.get() {
            if dir.is_empty() || (dir.len() == 1 && dir[0] == b'0') {
                // SAFETY: empty ZStr is the static "" sentinel.
                return ZStr::empty();
            }

            let len = dir.len().min(MAX_PATH_BYTES - 1);
            buf[0..len].copy_from_slice(&dir[0..len]);
            buf[len] = 0;
            // SAFETY: buf[len] == 0 written above.
            return unsafe { ZStr::from_raw(buf.as_ptr(), len) };
        }

        if let Some(dir) = env_var::XDG_CACHE_HOME.get() {
            let parts: &[&[u8]] = &[dir, b"bun", b"@t@"];
            return FileSystem::instance().abs_buf_z(parts, buf);
        }

        #[cfg(target_os = "macos")]
        {
            // On a mac, default to ~/Library/Caches/bun/*
            // This is different than ~/.bun/install/cache, and not configurable by the user.
            if let Some(home) = env_var::HOME.get() {
                let parts: &[&[u8]] = &[home, b"Library/", b"Caches/", b"bun", b"@t@"];
                return FileSystem::instance().abs_buf_z(parts, buf);
            }
        }

        if let Some(dir) = env_var::HOME.get() {
            let parts: &[&[u8]] = &[dir, b".bun", b"install", b"cache", b"@t@"];
            return FileSystem::instance().abs_buf_z(parts, buf);
        }

        {
            let parts: &[&[u8]] = &[bun_fs::RealFS::tmpdir_path(), b"bun", b"@t@"];
            return FileSystem::instance().abs_buf_z(parts, buf);
        }
    }

    // Only do this at most once per-thread.
    // TODO(port): Zig used `bun.ThreadlocalBuffers(struct { buf: bun.PathBuffer })` plus a
    // threadlocal `?[:0]const u8` pointing into it. Rust thread_local can't easily borrow
    // into itself across calls, so we cache the resolved path bytes directly.
    thread_local! {
        static CACHE_DIR_BUF: RefCell<PathBuffer> = const { RefCell::new(PathBuffer::ZEROED) };
        static RUNTIME_TRANSPILER_CACHE: Cell<Option<usize>> = const { Cell::new(None) };
    }

    fn get_cache_dir(buf: &mut PathBuffer) -> Result<&ZStr, bun_core::Error> {
        if IS_DISABLED.load(Ordering::Relaxed) {
            return Err(bun_core::err!("CacheDisabled"));
        }
        let path_len = match Self::RUNTIME_TRANSPILER_CACHE.with(|c| c.get()) {
            Some(len) => len,
            None => {
                let len = Self::CACHE_DIR_BUF.with_borrow_mut(|tl_buf| {
                    Self::really_get_cache_dir(tl_buf).len()
                });
                if len == 0 {
                    IS_DISABLED.store(true, Ordering::Relaxed);
                    return Err(bun_core::err!("CacheDisabled"));
                }
                Self::RUNTIME_TRANSPILER_CACHE.with(|c| c.set(Some(len)));
                len
            }
        };
        Self::CACHE_DIR_BUF.with_borrow(|tl_buf| {
            buf[0..path_len].copy_from_slice(&tl_buf[0..path_len]);
        });
        buf[path_len] = 0;
        // SAFETY: buf[path_len] == 0 written above.
        // PORT NOTE: Zig returned the threadlocal slice (not buf), but callers index into
        // `buf` using only `.len()`, so returning a slice into `buf` is equivalent.
        Ok(unsafe { ZStr::from_raw(buf.as_ptr(), path_len) })
    }

    pub fn from_file(
        input_hash: u64,
        feature_hash: u64,
        input_stat_size: u64,
    ) -> Result<Entry, bun_core::Error> {
        let _tracer = perf::trace("RuntimeTranspilerCache.fromFile");

        let mut cache_file_path_buf = PathBuffer::uninit();
        let cache_file_path = Self::get_cache_file_path(&mut cache_file_path_buf, input_hash)?;
        debug_assert!(!cache_file_path.is_empty());
        Self::from_file_with_cache_file_path(
            PathString::init(cache_file_path.as_bytes()),
            input_hash,
            feature_hash,
            input_stat_size,
        )
    }

    pub fn from_file_with_cache_file_path(
        cache_file_path: PathString,
        input_hash: u64,
        feature_hash: u64,
        input_stat_size: u64,
    ) -> Result<Entry, bun_core::Error> {
        let mut metadata_bytes_buf = [0u8; Metadata::SIZE * 2];
        let cache_fd =
            sys::open(cache_file_path.slice_assume_z(), sys::O::RDONLY, 0)?;
        // defer cache_fd.close() — TODO(port): assume Fd closes on Drop or wrap in guard
        let _close_guard = scopeguard::guard((), |_| {
            cache_fd.close();
        });
        let unlink_guard = scopeguard::guard((), |_| {
            // On any error, we delete the cache file
            let _ = sys::unlink(cache_file_path.slice_assume_z());
        });

        let file = cache_fd.std_file();
        // TODO(port): file is bun_sys::File; pread_all / seek_to assumed.
        let metadata_bytes = file.pread_all(&mut metadata_bytes_buf, 0)?;
        #[cfg(windows)]
        {
            file.seek_to(0)?;
        }
        let mut metadata_stream =
            bun_io::FixedBufferStream::new(&mut metadata_bytes_buf[0..metadata_bytes]);

        let mut entry = Entry {
            metadata: Metadata::default(),
            output_code: OutputCode::Utf8(Box::default()),
            sourcemap: Box::default(),
            esm_record: Box::default(),
        };
        let mut reader = metadata_stream.reader();
        entry.metadata.decode(&mut reader)?;
        if entry.metadata.input_hash != input_hash
            || entry.metadata.input_byte_length != input_stat_size
        {
            // delete the cache in this case
            return Err(bun_core::err!("InvalidInputHash"));
        }

        if entry.metadata.features_hash != feature_hash {
            // delete the cache in this case
            return Err(bun_core::err!("MismatchedFeatureHash"));
        }

        entry.load(&file)?;

        // disarm errdefer (success path)
        scopeguard::ScopeGuard::into_inner(unlink_guard);
        Ok(entry)
    }

    pub fn is_eligible(&self, path: &FsPath) -> bool {
        path.is_file()
    }

    pub fn to_file(
        input_byte_length: u64,
        input_hash: u64,
        features_hash: u64,
        sourcemap: &[u8],
        esm_record: &[u8],
        source_code: &BunString,
        exports_kind: ExportsKind,
    ) -> Result<(), bun_core::Error> {
        let _tracer = perf::trace("RuntimeTranspilerCache.toFile");

        let mut cache_file_path_buf = PathBuffer::uninit();
        let output_code: OutputCode = match source_code.encoding() {
            // TODO(port): Zig borrowed source_code.byteSlice() into .utf8 without copying;
            // OutputCode::Utf8 here is Box<[u8]> which would copy. For `to_file` we only
            // need a borrowed view passed to Entry::save, so use a local enum or pass
            // the slice directly. For now, clone — PERF(port): avoid clone in Phase B.
            bun_str::Encoding::Utf8 => OutputCode::Utf8(Box::from(source_code.byte_slice())),
            _ => OutputCode::String(source_code.clone()),
        };

        let cache_file_path = Self::get_cache_file_path(&mut cache_file_path_buf, input_hash)?;
        bun_output::scoped_log!(cache, "filename to put into: '{}'", bstr::BStr::new(cache_file_path.as_bytes()));

        if cache_file_path.is_empty() {
            return Ok(());
        }

        let cache_dir_fd: Fd = 'brk: {
            if let Some(dirname) = paths::dirname(cache_file_path.as_bytes()) {
                // TODO(port): std.fs.cwd().makeOpenPath — map to bun_sys::make_open_path
                let dir = sys::make_open_path(Fd::cwd(), dirname, sys::OpenDirOptions { access_sub_paths: true })?;
                break 'brk Fd::from_std_dir(dir).make_libuv_owned()?;
            }

            break 'brk Fd::cwd();
        };
        let _dir_guard = scopeguard::guard(cache_dir_fd, |fd| {
            if fd != Fd::cwd() {
                fd.close();
            }
        });

        Entry::save(
            cache_dir_fd,
            PathString::init(cache_file_path.as_bytes()),
            input_byte_length,
            input_hash,
            features_hash,
            sourcemap,
            esm_record,
            &output_code,
            exports_kind,
        )
    }

    pub fn get(
        &mut self,
        source: &Source,
        parser_options: &bun_js_parser::Parser::Options,
        used_jsx: bool,
    ) -> bool {
        if !FeatureFlags::RUNTIME_TRANSPILER_CACHE {
            return false;
        }

        if self.entry.is_some() {
            return true;
        }

        if source.contents.len() < MINIMUM_CACHE_SIZE {
            return false;
        }

        if IS_DISABLED.load(Ordering::Relaxed) {
            return false;
        }

        if !source.path.is_file() {
            return false;
        }

        let input_hash = self.input_hash.unwrap_or_else(|| hash(&source.contents));
        self.input_hash = Some(input_hash);
        self.input_byte_length = Some(source.contents.len() as u64);

        let mut features_hasher = Wyhash::init(SEED);
        parser_options.hash_for_runtime_transpiler(&mut features_hasher, used_jsx);
        self.features_hash = Some(features_hasher.final_());

        self.entry = match Self::from_file(
            input_hash,
            self.features_hash.unwrap(),
            source.contents.len() as u64,
        ) {
            Ok(e) => Some(e),
            Err(err) => {
                bun_output::scoped_log!(
                    cache,
                    "get(\"{}\") = {}",
                    bstr::BStr::new(&source.path.text),
                    err.name()
                );
                return false;
            }
        };
        #[cfg(debug_assertions)]
        {
            if BUN_DEBUG_RESTORE_FROM_CACHE.load(Ordering::Relaxed) {
                bun_output::scoped_log!(
                    cache,
                    "get(\"{}\") = {} bytes, restored",
                    bstr::BStr::new(&source.path.text),
                    self.entry.as_ref().unwrap().output_code.byte_slice().len()
                );
            } else {
                bun_output::scoped_log!(
                    cache,
                    "get(\"{}\") = {} bytes, ignored for debug build",
                    bstr::BStr::new(&source.path.text),
                    self.entry.as_ref().unwrap().output_code.byte_slice().len()
                );
            }
        }
        bun_core::analytics::Features::TRANSPILER_CACHE.fetch_add(1, Ordering::Relaxed);

        #[cfg(debug_assertions)]
        {
            if !BUN_DEBUG_RESTORE_FROM_CACHE.load(Ordering::Relaxed) {
                if let Some(_entry) = self.entry.take() {
                    // entry dropped here (Zig: entry.deinit(...))
                }
            }
        }

        self.entry.is_some()
    }

    pub fn put(&mut self, output_code_bytes: &[u8], sourcemap: &[u8], esm_record: &[u8]) {
        const _: () = assert!(
            FeatureFlags::RUNTIME_TRANSPILER_CACHE,
            "RuntimeTranspilerCache is disabled"
        );

        if self.input_hash.is_none() || IS_DISABLED.load(Ordering::Relaxed) {
            return;
        }
        debug_assert!(self.entry.is_none());
        let output_code = BunString::clone_latin1(output_code_bytes);
        self.output_code = Some(output_code.clone());
        // TODO(port): Zig stored `output_code` then passed the same handle to to_file;
        // BunString is refcounted so clone+store is equivalent.

        if let Err(err) = Self::to_file(
            self.input_byte_length.unwrap(),
            self.input_hash.unwrap(),
            self.features_hash.unwrap(),
            sourcemap,
            esm_record,
            &output_code,
            self.exports_kind,
        ) {
            bun_output::scoped_log!(cache, "put() = {}", err.name());
            return;
        }
        #[cfg(debug_assertions)]
        {
            bun_output::scoped_log!(cache, "put() = {} bytes", output_code.latin1().len());
        }
    }
}

pub static IS_DISABLED: AtomicBool = AtomicBool::new(false);

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/RuntimeTranspilerCache.zig (706 lines)
//   confidence: medium
//   todos:      17
//   notes:      allocator fields dropped per §Allocators (verify callers); bun_io::FixedBufferStream/Read/Write + bun_sys::File pread_all/Tmpfile/make_open_path are placeholders; threadlocal cache-dir reshaped to store len instead of slice
// ──────────────────────────────────────────────────────────────────────────
