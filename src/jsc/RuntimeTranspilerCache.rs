#![allow(unused_imports, unused_variables, dead_code, unreachable_code)]
#![warn(unused_must_use)]

use core::cell::{Cell, RefCell};
use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use bun_ast::ExportsKind;
use bun_ast::Source;
use bun_core::{self as bun, FeatureFlags, env_var};
use bun_core::{PathString, String as BunString, ZStr};
use bun_io::Write as _;
use bun_js_parser::ParserOptions;
use bun_paths::resolve_path::{self as path_handler, platform};
use bun_paths::{self as paths, MAX_PATH_BYTES, PathBuffer, SEP};
use bun_resolver::fs::{FileSystem, Path as FsPath, RealFS};
use bun_sys::{self as sys, Fd, FdExt as _};
// Zig: `std.hash.Wyhash` (final4 variant). Must match exactly so on-disk
// `.pile` filenames/hashes are interchangeable with Zig-produced caches.
use bun_wyhash::Wyhash;

bun_core::declare_scope!(cache, visible);

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

/// Source files smaller than this are not written to / read from the on-disk
/// transpiler cache. Originally 50 KiB, which excluded almost every file in a
/// typical `node_modules` tree (eslint pulls in ~1500 small CommonJS files, all
/// well under that floor), forcing a full lex -> parse -> visit -> print ->
/// sourcemap pass on every invocation. A `statx` + `open` + `read` of a tiny
/// cache file is far cheaper than re-transpiling, so the floor is low. The cache
/// key still incorporates the source byte length (see `input_byte_length` /
/// `is_stale`), so shrinking this does not weaken staleness detection.
const MINIMUM_CACHE_SIZE: usize = 4 * 1024;

// When making parser changes, it gets extremely confusing.
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
    pub const SIZE: usize = 4 + 1 + 1 + 12 * 8;

    pub fn encode<W: bun_io::Write>(&self, writer: &mut W) -> Result<(), bun_core::Error> {
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

    /// PORT NOTE: Zig took `anytype reader`; both call sites
    /// (`from_file_with_cache_file_path`, the debug round-trip in `Entry::save`)
    /// drive it from a `fixedBufferStream`, so we accept the concrete
    /// `bun_io::FixedBufferStream` over a borrowed slice.
    pub fn decode(
        &mut self,
        reader: &mut bun_io::FixedBufferStream<&[u8]>,
    ) -> Result<(), bun_core::Error> {
        self.cache_version = reader.read_int_le::<u32>()?;
        if self.cache_version != EXPECTED_VERSION {
            return Err(bun_core::err!(StaleCache));
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
            _ => return Err(bun_core::err!(InvalidModuleType)),
        };

        self.output_encoding = Encoding(output_encoding_raw);
        match self.output_encoding {
            Encoding::UTF8 | Encoding::UTF16 | Encoding::LATIN1 => {}
            // Invalid encoding
            _ => return Err(bun_core::err!(UnknownEncoding)),
        }

        Ok(())
    }
}

// Static assert that `encode()` writes exactly `Metadata::SIZE` bytes — guards
// against the hand-summed constant drifting from the field list.
const _: () = assert!(Metadata::SIZE == 4 + 1 + 1 + 12 * 8);

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

    fn deinit(&mut self) {
        match core::mem::take(self) {
            OutputCode::Utf8(_b) => {} // Box drops
            OutputCode::String(s) => s.deref(),
        }
    }
}

#[derive(Default)]
pub struct Entry {
    pub metadata: Metadata,
    pub output_code: OutputCode,
    pub sourcemap: Box<[u8]>,
    pub esm_record: Box<[u8]>,
}

impl Entry {
    /// PORT NOTE: Zig `deinit` took three allocator params; per §Allocators
    /// (non-AST crate) the Rust port owns its buffers via `Box<[u8]>` /
    /// `BunString`, so this is just an explicit `deref()` + drop.
    pub fn deinit(&mut self) {
        self.output_code.deinit();
        self.sourcemap = Box::default();
        self.esm_record = Box::default();
    }

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
        let _tracer = bun_core::perf::trace("RuntimeTranspilerCache.save");

        // atomically write to a tmpfile and then move it to the final destination
        let mut tmpname_buf = PathBuffer::uninit();
        let tmpfilename = FileSystem::tmpname(
            paths::extension(destination_path.slice()),
            &mut tmpname_buf[..],
            input_hash,
        )?;
        // Reborrow shared: `Tmpfile::create` wants `&ZStr`, and we still need
        // it for the errdefer `unlinkat` below.
        let tmpfilename: &ZStr = &*tmpfilename;

        let output_bytes = output_code.byte_slice();

        // First we open the tmpfile, to avoid any other work in the event of failure.
        let mut tmpfile = sys::Tmpfile::create(destination_dir, tmpfilename)?;
        // Zig: `defer tmpfile.fd.close()` — close on all exit paths.
        let _close_guard = sys::CloseOnDrop::new(tmpfile.fd);
        {
            // Zig: `errdefer if (!tmpfile.using_tmpfile) unlinkat(...)` — disarmed
            // via `into_inner` on the success path below.
            let errdefer = scopeguard::guard(tmpfile.using_tmpfile, |using_tmpfile| {
                if !using_tmpfile {
                    let _ = sys::unlinkat(destination_dir, tmpfilename);
                }
            });

            let mut metadata_buf = [0u8; Metadata::SIZE * 2];
            let metadata_bytes_len: usize = {
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
                        // PORT NOTE: `bun_core::String` has no `.encoding()` yet;
                        // derive from the is_* predicates (same discrimination Zig's
                        // `String.encoding()` performs).
                        OutputCode::String(str) => {
                            if str.is_utf16() {
                                Encoding::UTF16
                            } else if str.is_utf8() {
                                Encoding::UTF8
                            } else {
                                Encoding::LATIN1
                            }
                        }
                    },
                    sourcemap_byte_length: sourcemap.len() as u64,
                    output_byte_offset: Metadata::SIZE as u64,
                    output_byte_length: output_bytes.len() as u64,
                    sourcemap_byte_offset: (Metadata::SIZE + output_bytes.len()) as u64,
                    esm_record_byte_offset: (Metadata::SIZE + output_bytes.len() + sourcemap.len())
                        as u64,
                    esm_record_byte_length: esm_record.len() as u64,
                    ..Default::default()
                };

                metadata.output_hash = hash(output_bytes);
                metadata.sourcemap_hash = hash(sourcemap);
                if !esm_record.is_empty() {
                    metadata.esm_record_hash = hash(esm_record);
                }

                let mut metadata_stream = bun_io::FixedBufferStream::new_mut(&mut metadata_buf[..]);
                metadata.encode(&mut metadata_stream)?;
                let pos = metadata_stream.pos;

                #[cfg(debug_assertions)]
                {
                    let mut reader =
                        bun_io::FixedBufferStream::new(&metadata_buf[0..Metadata::SIZE]);
                    let mut metadata2 = Metadata::default();
                    if let Err(err) = metadata2.decode(&mut reader) {
                        bun_core::Output::panic(format_args!(
                            "Metadata did not roundtrip encode -> decode  successfully: {}",
                            err.name(),
                        ));
                    }
                    debug_assert!(metadata == metadata2);
                }

                pos
            };
            let metadata_bytes: &[u8] = &metadata_buf[0..metadata_bytes_len];

            let mut vecs_buf: [sys::PlatformIoVecConst; 4] = bun_core::ffi::zeroed();
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

            let mut position: i64 = 0;
            let end_position =
                Metadata::SIZE + output_bytes.len() + sourcemap.len() + esm_record.len();

            #[cfg(debug_assertions)]
            {
                let mut total: usize = 0;
                for v in vecs {
                    debug_assert!(v.len > 0);
                    // `uv_buf_t::len` is `ULONG` (u32) on Windows, `usize` on POSIX.
                    total += v.len as usize;
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
                i64::try_from(end_position).expect("int cast"),
            );
            while (position as usize) < end_position {
                let written = sys::pwritev(tmpfile.fd, vecs, position)?;
                if written == 0 {
                    return Err(bun_core::err!(WriteFailed));
                }

                position += i64::try_from(written).expect("int cast");
            }

            // disarm errdefer (success path)
            let _ = scopeguard::ScopeGuard::into_inner(errdefer);
        }

        // Zig: `@ptrCast(std.fs.path.basename(...))` — basename of a NUL-terminated
        // path is itself NUL-terminated (it's a suffix), so we can hand it to
        // `Tmpfile::finish` as a `&ZStr` without copying.
        let dest_slice = destination_path.slice();
        let base = paths::basename(dest_slice);
        // SAFETY: `base` is a suffix of `destination_path`, which the caller
        // built via `get_cache_file_path` and is NUL-terminated at `dest_slice.len()`.
        let base_z = unsafe { ZStr::from_raw(base.as_ptr(), base.len()) };
        tmpfile.finish(base_z)?;
        Ok(())
    }

    pub fn load(&mut self, file: &sys::File) -> Result<(), bun_core::Error> {
        let stat_size = file.get_end_pos()? as u64;
        if stat_size
            < (Metadata::SIZE as u64)
                + self.metadata.output_byte_length
                + self.metadata.sourcemap_byte_length
        {
            return Err(bun_core::err!(MissingData));
        }

        debug_assert!(
            matches!(&self.output_code, OutputCode::Utf8(b) if b.is_empty()),
            "this should be the default value"
        );

        self.output_code = if self.metadata.output_byte_length == 0 {
            OutputCode::String(BunString::empty())
        } else {
            match self.metadata.output_encoding {
                Encoding::UTF8 => {
                    // PORT NOTE / PERF: Zig threaded `output_code_allocator`
                    // (the per-call arena) here so the ~1.2 MB scratch buffer
                    // was bump-freed with the parse arena. The Rust port
                    // dropped that field and `pread_box`'d into a `Box<[u8]>`
                    // on the worker thread's mimalloc heap, which — even after
                    // the consumer's `String::clone_utf8` + drop — leaves the
                    // segment resident in that thread heap (build/create-vue
                    // bench regression).
                    //
                    // Instead, pread straight into a WTF-allocated Latin-1
                    // buffer (`WTF::StringImpl::tryCreateUninitialized` →
                    // bmalloc, not the worker mimalloc heap). Transpiler
                    // output is overwhelmingly pure ASCII, in which case the
                    // buffer *is* the final `BunString` and we skip the
                    // 1.2 MB `clone_utf8` memcpy the consumer used to do at
                    // RuntimeTranspilerStore.rs / jsc_hooks.rs. Only if the
                    // bytes contain non-ASCII UTF-8 do we fall back to
                    // `clone_utf8` (transcode → UTF-16) and deref the scratch.
                    let len = self.metadata.output_byte_length as usize;
                    let (scratch, bytes) = BunString::create_uninitialized_latin1(len);
                    // `(dead, &mut [])` on WTF allocation failure; `len > 0`
                    // (handled above), so an empty slice means OOM.
                    if bytes.is_empty() {
                        return Err(bun_core::err!(OutOfMemory));
                    }
                    // errdefer scratch.deref() — BunString is `Copy`, so guard explicitly.
                    let errdefer = scopeguard::guard(scratch, |s| s.deref());
                    let read_bytes = file.pread_all(bytes, self.metadata.output_byte_offset)?;
                    if read_bytes as u64 != self.metadata.output_byte_length {
                        return Err(bun_core::err!(MissingData));
                    }

                    if self.metadata.output_hash != 0 && hash(bytes) != self.metadata.output_hash {
                        return Err(bun_core::err!(InvalidHash));
                    }

                    if bun_core::strings::is_all_ascii(bytes) {
                        // Fast path: ASCII ⊂ Latin-1, so `scratch` is already
                        // the correct `BunString` — hand it straight to the
                        // consumer as `OutputCode::String`.
                        scopeguard::ScopeGuard::into_inner(errdefer);
                        OutputCode::String(scratch)
                    } else {
                        // Rare path: real multi-byte UTF-8. Transcode into a
                        // fresh WTF string and drop the Latin-1 scratch (the
                        // guard derefs it on scope exit).
                        OutputCode::String(BunString::clone_utf8(bytes))
                    }
                }
                Encoding::LATIN1 => {
                    let len = self.metadata.output_byte_length as usize;
                    let (latin1, bytes) = BunString::create_uninitialized_latin1(len);
                    // `create_uninitialized_latin1` returns `(dead, &mut [])` on
                    // WTF allocation failure; `len > 0` here (handled above), so
                    // an empty slice means OOM.
                    if bytes.is_empty() {
                        return Err(bun_core::err!(OutOfMemory));
                    }
                    // errdefer latin1.deref() — BunString is `Copy`, so guard explicitly.
                    let errdefer = scopeguard::guard(latin1, |s| s.deref());
                    let read_bytes = file.pread_all(bytes, self.metadata.output_byte_offset)?;

                    if self.metadata.output_hash != 0 {
                        if hash(latin1.latin1()) != self.metadata.output_hash {
                            return Err(bun_core::err!(InvalidHash));
                        }
                    }

                    if read_bytes as u64 != self.metadata.output_byte_length {
                        return Err(bun_core::err!(MissingData));
                    }

                    scopeguard::ScopeGuard::into_inner(errdefer);
                    OutputCode::String(latin1)
                }
                Encoding::UTF16 => {
                    let char_len = (self.metadata.output_byte_length / 2) as usize;
                    let (string, chars) = BunString::create_uninitialized_utf16(char_len);
                    // See LATIN1 branch above — empty slice for nonzero `char_len`
                    // signals WTF allocation failure.
                    if chars.is_empty() {
                        return Err(bun_core::err!(OutOfMemory));
                    }
                    let errdefer = scopeguard::guard(string, |s| s.deref());

                    // `chars` is `&mut [u16; char_len]` backed by contiguous
                    // WTFString storage; reinterpret as bytes for pread via the
                    // safe POD cast (`u16` → `u8` always satisfies size/align).
                    let chars_bytes: &mut [u8] = bytemuck::cast_slice_mut(chars);
                    let read_bytes =
                        file.pread_all(chars_bytes, self.metadata.output_byte_offset)?;
                    if read_bytes as u64 != self.metadata.output_byte_length {
                        return Err(bun_core::err!(MissingData));
                    }

                    if self.metadata.output_hash != 0 {
                        let utf16_bytes: &[u8] = bytemuck::cast_slice(string.utf16());
                        if hash(utf16_bytes) != self.metadata.output_hash {
                            return Err(bun_core::err!(InvalidHash));
                        }
                    }

                    scopeguard::ScopeGuard::into_inner(errdefer);
                    OutputCode::String(string)
                }

                _ => unreachable!("Unexpected output encoding"),
            }
        };

        // Zig: errdefer { switch (this.output_code) { .utf8 => free, .string => deref } }
        // BunString is Copy with no Drop, so dropping `Entry` on error does NOT
        // deref the WTFStringImpl — must do it explicitly here.
        let output_code_errdefer = scopeguard::guard(&mut self.output_code, |oc| oc.deinit());

        if self.metadata.sourcemap_byte_length > 0 {
            self.sourcemap = pread_box(
                file,
                self.metadata.sourcemap_byte_length as usize,
                self.metadata.sourcemap_byte_offset,
            )?;
        }

        if self.metadata.esm_record_byte_length > 0 {
            let esm_record = pread_box(
                file,
                self.metadata.esm_record_byte_length as usize,
                self.metadata.esm_record_byte_offset,
            )?;

            if self.metadata.esm_record_hash != 0 {
                if hash(&esm_record) != self.metadata.esm_record_hash {
                    return Err(bun_core::err!(InvalidHash));
                }
            }

            self.esm_record = esm_record;
        }

        scopeguard::ScopeGuard::into_inner(output_code_errdefer);
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
    // fields. `sourcemap` / `esm_record` were `bun.default_allocator` at every
    // call site so `Box<[u8]>` (global mimalloc) is equivalent.
    // `output_code_allocator` was the per-call arena; rather than re-thread it,
    // the UTF-8 load arm now preads straight into WTF storage (see
    // `Entry::load`), so no arena scratch is needed at all.
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

/// Allocate `len` bytes and fill them via `pread_all` at `offset`, returning
/// `MissingData` on a short read.
///
/// Uses `Box::new_uninit_slice` instead of `vec![0u8; len]` so the cache hot
/// path (lint/create-next benches) skips the redundant zero-memset — the kernel
/// is about to overwrite every byte anyway.
fn pread_box(file: &sys::File, len: usize, offset: u64) -> Result<Box<[u8]>, bun_core::Error> {
    let mut buf = Box::<[u8]>::new_uninit_slice(len);
    // SAFETY: `MaybeUninit<u8>` and `u8` have identical size/align, and
    // `pread_all` only ever *writes* into the slice (the syscall fills it) —
    // it never reads the uninitialized bytes. Standard read-into-uninit-buffer
    // pattern; the slice is not exposed past this point until proven full.
    let dst: &mut [u8] =
        unsafe { core::slice::from_raw_parts_mut(buf.as_mut_ptr().cast::<u8>(), len) };
    let read = file.pread_all(dst, offset)?;
    if read != len {
        return Err(bun_core::err!(MissingData));
    }
    // SAFETY: `pread_all` reported `len` bytes written, so every element is
    // initialized.
    Ok(unsafe { buf.assume_init() })
}

impl RuntimeTranspilerCache {
    pub fn write_cache_filename(buf: &mut [u8], input_hash: u64) -> Result<usize, bun_core::Error> {
        // Zig: "{x}" on std.mem.asBytes(&input_hash) — hex-encodes the 8 native-endian bytes.
        let bytes = input_hash.to_ne_bytes();
        let suffix: &[u8] = if cfg!(debug_assertions) {
            b".debug.pile"
        } else {
            b".pile"
        };
        let needed = bytes.len() * 2 + suffix.len();
        if buf.len() < needed {
            return Err(bun_core::err!(NoSpaceLeft));
        }
        let i = bun_core::fmt::bytes_to_hex_lower(&bytes, &mut buf[..bytes.len() * 2]);
        buf[i..i + suffix.len()].copy_from_slice(suffix);
        Ok(needed)
    }

    pub fn get_cache_file_path(
        buf: &mut PathBuffer,
        input_hash: u64,
    ) -> Result<&ZStr, bun_core::Error> {
        let cache_dir_len = Self::get_cache_dir(buf)?;
        buf[cache_dir_len] = SEP;
        let cache_filename_len =
            Self::write_cache_filename(&mut buf[cache_dir_len + 1..], input_hash)?;
        let total = cache_dir_len + 1 + cache_filename_len;
        buf[total] = 0;

        // SAFETY: we wrote a NUL at buf[total] above.
        Ok(ZStr::from_buf(&buf[..], total))
    }

    /// Writes the resolved cache directory into `buf` (NUL-terminated) and
    /// returns its byte length. Returns 0 to mean "cache disabled" (Zig
    /// returned `""`).
    fn really_get_cache_dir(buf: &mut PathBuffer) -> usize {
        #[cfg(debug_assertions)]
        {
            BUN_DEBUG_RESTORE_FROM_CACHE.store(
                env_var::BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE
                    .get()
                    .unwrap_or(false),
                Ordering::Relaxed,
            );
        }

        if let Some(dir) = env_var::BUN_RUNTIME_TRANSPILER_CACHE_PATH.get() {
            if dir.is_empty() || (dir.len() == 1 && dir[0] == b'0') {
                return 0;
            }

            let len = dir.len().min(MAX_PATH_BYTES - 1);
            buf[0..len].copy_from_slice(&dir[0..len]);
            buf[len] = 0;
            return len;
        }

        // PORT NOTE: Zig used `FileSystem.instance.absBufZ(parts, buf)`. The
        // inline `bun_resolver::fs::FileSystem` surface only exposes `abs_buf`
        // (no `_z`), so go straight to the underlying joiner with the same
        // `top_level_dir` + `Loose` platform Zig's `absBufZ` used.
        let top = FileSystem::instance().top_level_dir;

        if let Some(dir) = env_var::XDG_CACHE_HOME.get() {
            let parts: &[&[u8]] = &[dir, b"bun", b"@t@"];
            return path_handler::join_abs_string_buf_z::<platform::Loose>(
                top,
                &mut buf[..],
                parts,
            )
            .len();
        }

        #[cfg(target_os = "macos")]
        {
            // On a mac, default to ~/Library/Caches/bun/*
            // This is different than ~/.bun/install/cache, and not configurable by the user.
            if let Some(home) = env_var::HOME.get() {
                let parts: &[&[u8]] = &[home, b"Library/", b"Caches/", b"bun", b"@t@"];
                return path_handler::join_abs_string_buf_z::<platform::Loose>(
                    top,
                    &mut buf[..],
                    parts,
                )
                .len();
            }
        }

        if let Some(dir) = env_var::HOME.get() {
            let parts: &[&[u8]] = &[dir, b".bun", b"install", b"cache", b"@t@"];
            return path_handler::join_abs_string_buf_z::<platform::Loose>(
                top,
                &mut buf[..],
                parts,
            )
            .len();
        }

        {
            let parts: &[&[u8]] = &[RealFS::tmpdir_path(), b"bun", b"@t@"];
            path_handler::join_abs_string_buf_z::<platform::Loose>(top, &mut buf[..], parts).len()
        }
    }

    // Only do this at most once per-thread.
    // PORT NOTE: Zig used `bun.ThreadlocalBuffers(struct { buf: bun.PathBuffer })`
    // plus a threadlocal `?[:0]const u8` pointing into it. Rust thread_local
    // can't easily borrow into itself across calls, so we cache the resolved
    // path bytes + length and re-copy into the caller's buffer on each call.
    thread_local! {
        // bun.ThreadlocalBuffers: heap-backed so only a Box pointer lives in TLS.
        static CACHE_DIR_BUF: RefCell<Box<PathBuffer>> = RefCell::new(Box::new(PathBuffer::ZEROED));
        static RUNTIME_TRANSPILER_CACHE: Cell<Option<usize>> = const { Cell::new(None) };
    }

    /// Copies the (cached) cache-dir path into `buf`, NUL-terminates it, and
    /// returns its length. Zig returned the threadlocal `[:0]const u8`; we
    /// return the length so the caller can keep mutably borrowing `buf` to
    /// append the filename.
    fn get_cache_dir(buf: &mut PathBuffer) -> Result<usize, bun_core::Error> {
        if IS_DISABLED.load(Ordering::Relaxed) {
            return Err(bun_core::err!(CacheDisabled));
        }
        let path_len = match Self::RUNTIME_TRANSPILER_CACHE.with(|c| c.get()) {
            Some(len) => len,
            None => {
                let len = Self::CACHE_DIR_BUF
                    .with_borrow_mut(|tl_buf| Self::really_get_cache_dir(tl_buf));
                if len == 0 {
                    IS_DISABLED.store(true, Ordering::Relaxed);
                    return Err(bun_core::err!(CacheDisabled));
                }
                Self::RUNTIME_TRANSPILER_CACHE.with(|c| c.set(Some(len)));
                len
            }
        };
        Self::CACHE_DIR_BUF.with_borrow(|tl_buf| {
            buf[0..path_len].copy_from_slice(&tl_buf[0..path_len]);
        });
        buf[path_len] = 0;
        Ok(path_len)
    }

    pub fn from_file(
        input_hash: u64,
        feature_hash: u64,
        input_stat_size: u64,
    ) -> Result<Entry, bun_core::Error> {
        let _tracer = bun_core::perf::trace("RuntimeTranspilerCache.fromFile");

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
        let cache_fd = sys::open(cache_file_path.slice_assume_z(), sys::O::RDONLY, 0)?;
        // Zig: `defer cache_fd.close()` — close on all exit paths.
        let _close_guard = sys::CloseOnDrop::new(cache_fd);
        // Zig: `errdefer { _ = bun.sys.unlink(...) }` — on any error, delete the
        // cache file. Disarmed via `into_inner` on the success path below.
        let unlink_guard = scopeguard::guard(cache_file_path, |p| {
            let _ = sys::unlink(p.slice_assume_z());
        });

        let file = sys::File::from_fd(cache_fd);
        let metadata_bytes = file.pread_all(&mut metadata_bytes_buf, 0)?;
        #[cfg(windows)]
        {
            file.seek_to(0)?;
        }
        let mut reader = bun_io::FixedBufferStream::new(&metadata_bytes_buf[0..metadata_bytes]);

        let mut entry = Entry {
            metadata: Metadata::default(),
            output_code: OutputCode::Utf8(Box::default()),
            sourcemap: Box::default(),
            esm_record: Box::default(),
        };
        entry.metadata.decode(&mut reader)?;
        if entry.metadata.input_hash != input_hash
            || entry.metadata.input_byte_length != input_stat_size
        {
            // delete the cache in this case
            return Err(bun_core::err!(InvalidInputHash));
        }

        if entry.metadata.features_hash != feature_hash {
            // delete the cache in this case
            return Err(bun_core::err!(MismatchedFeatureHash));
        }

        entry.load(&file)?;

        // disarm errdefer (success path)
        let _ = scopeguard::ScopeGuard::into_inner(unlink_guard);
        Ok(entry)
    }

    pub fn is_eligible(&self, path: &FsPath<'_>) -> bool {
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
        let _tracer = bun_core::perf::trace("RuntimeTranspilerCache.toFile");

        let mut cache_file_path_buf = PathBuffer::uninit();
        // PORT NOTE: Zig matched on `source_code.encoding()`; derive from
        // `is_utf8()` instead. Zig's `.utf8` arm borrowed `source_code.byteSlice()`
        // without copying; `OutputCode::Utf8` here owns a `Box<[u8]>`, so we
        // copy. PERF(port): add a borrowed `OutputCode` variant in Phase B.
        //
        // Zig: `else => .{ .string = source_code }` — by-value copy, **no**
        // `dupeRef()` and **no** matching `deref()`. `BunString` is `Copy` and
        // `OutputCode` has no `Drop`, so `*source_code` here is the same
        // refcount-neutral borrow. (A previous revision did `dupe_ref()` +
        // scopeguard `deref()`, which was balanced but redundant.)
        let output_code: OutputCode = if source_code.is_utf8() {
            OutputCode::Utf8(Box::from(source_code.byte_slice()))
        } else {
            OutputCode::String(*source_code)
        };

        let cache_file_path = Self::get_cache_file_path(&mut cache_file_path_buf, input_hash)?;
        bun_core::scoped_log!(
            cache,
            "filename to put into: '{}'",
            bstr::BStr::new(cache_file_path.as_bytes())
        );

        if cache_file_path.is_empty() {
            return Ok(());
        }

        let cache_dir_fd: Fd = 'brk: {
            let dirname = path_handler::dirname::<platform::Auto>(cache_file_path.as_bytes());
            if !dirname.is_empty() {
                // Zig: `std.fs.cwd().makeOpenPath(dirname, .{ .access_sub_paths = true })`
                let dir =
                    sys::Dir::cwd().make_open_path(dirname, sys::OpenDirOptions::default())?;
                // Zig: `errdefer dir.close()` (brk-scoped). `sys::Dir` has no
                // `Drop`, so close explicitly on the `make_lib_uv_owned` error
                // edge (Windows-only failure path) before propagating.
                let dfd = dir.fd;
                break 'brk match dfd.make_lib_uv_owned() {
                    Ok(f) => f,
                    Err(e) => {
                        dfd.close();
                        return Err(e.into());
                    }
                };
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

    pub fn is_disabled() -> bool {
        IS_DISABLED.load(Ordering::Relaxed)
    }

    pub fn get(
        &mut self,
        source: &Source,
        parser_options: &ParserOptions<'_>,
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

        // PORT NOTE: `bun_paths::fs::Path<'static>` is the trimmed TYPE_ONLY mirror and
        // doesn't carry `is_file()` yet; inline the same check the resolver
        // `Path::is_file` performs (`namespace == "" || namespace == "file"`).
        if !(source.path.namespace.is_empty() || source.path.namespace == b"file") {
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
                bun_core::scoped_log!(
                    cache,
                    "get(\"{}\") = {}",
                    bstr::BStr::new(source.path.text),
                    err.name()
                );
                return false;
            }
        };
        #[cfg(debug_assertions)]
        {
            if BUN_DEBUG_RESTORE_FROM_CACHE.load(Ordering::Relaxed) {
                bun_core::scoped_log!(
                    cache,
                    "get(\"{}\") = {} bytes, restored",
                    bstr::BStr::new(source.path.text),
                    self.entry.as_ref().unwrap().output_code.byte_slice().len()
                );
            } else {
                bun_core::scoped_log!(
                    cache,
                    "get(\"{}\") = {} bytes, ignored for debug build",
                    bstr::BStr::new(source.path.text),
                    self.entry.as_ref().unwrap().output_code.byte_slice().len()
                );
            }
        }
        bun_analytics::features::transpiler_cache.fetch_add(1, Ordering::Relaxed);

        #[cfg(debug_assertions)]
        {
            if !BUN_DEBUG_RESTORE_FROM_CACHE.load(Ordering::Relaxed) {
                if let Some(mut entry) = self.entry.take() {
                    entry.deinit();
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
        // Zig: `this.output_code = output_code;` — refcount stays at 1, sole owner.
        // BunString is Copy with no Drop, so an extra dupe_ref here would leak.
        self.output_code = Some(output_code);

        if let Err(err) = Self::to_file(
            self.input_byte_length.unwrap(),
            self.input_hash.unwrap(),
            self.features_hash.unwrap(),
            sourcemap,
            esm_record,
            &output_code,
            self.exports_kind,
        ) {
            bun_core::scoped_log!(cache, "put() = {}", err.name());
            return;
        }
        #[cfg(debug_assertions)]
        {
            bun_core::scoped_log!(cache, "put() = {} bytes", output_code.latin1().len());
        }
    }
}

pub static IS_DISABLED: AtomicBool = AtomicBool::new(false);

// ──────────────────────────────────────────────────────────────────────────
// VTable bridge for the canonical (lower-tier) `bun_ast::RuntimeTranspilerCache`.
//
// LAYERING: `ParseOptions.runtime_transpiler_cache` carries the lower-tier
// type so the parser crate names no `bun_jsc` types. `RuntimeTranspilerStore::run`
// constructs that lower-tier cache with this vtable so the parser's
// `cache.get()` reaches the disk-backed `RuntimeTranspilerCache::get()` above.
// On a hit the concrete `Entry` is boxed and stored type-erased in
// `bun_ast::RuntimeTranspilerCache.entry`; the store casts it back via
// `heap::take(ptr.cast::<Entry>())`.
// ──────────────────────────────────────────────────────────────────────────

bun_ast::link_impl_TranspilerCacheImpl! {
    Jsc for bun_ast::RuntimeTranspilerCache => |this| {
        get(source, parser_options, used_jsx) => {
            let this = &mut *this;
            let source = &*source;
            let parser_options = &*parser_options.cast::<ParserOptions<'_>>();

            let mut jsc = RuntimeTranspilerCache {
                input_hash: this.input_hash,
                input_byte_length: this.input_byte_length,
                features_hash: this.features_hash,
                exports_kind: this.exports_kind,
                output_code: None,
                entry: None,
            };
            let hit = jsc.get(source, parser_options, used_jsx);
            this.input_hash = jsc.input_hash;
            this.input_byte_length = jsc.input_byte_length;
            this.features_hash = jsc.features_hash;
            this.exports_kind = jsc.exports_kind;
            if let Some(entry) = jsc.entry {
                this.entry = Some(bun_core::heap::into_raw(Box::new(entry)).cast::<()>());
            }
            hit
        },
        put(output_code_bytes, sourcemap, esm_record) => {
            let this = &mut *this;
            if this.input_hash.is_none() || IS_DISABLED.load(Ordering::Relaxed) {
                return;
            }
            debug_assert!(this.entry.is_none());
            this.output_code = Some(Box::<[u8]>::from(output_code_bytes));

            let output_code = BunString::clone_latin1(output_code_bytes);
            let result = RuntimeTranspilerCache::to_file(
                this.input_byte_length.unwrap(),
                this.input_hash.unwrap(),
                this.features_hash.unwrap(),
                sourcemap,
                esm_record,
                &output_code,
                this.exports_kind,
            );
            output_code.deref();
            if let Err(err) = result {
                bun_core::scoped_log!(cache, "put() = {}", err.name());
            }
        },
        is_disabled() => RuntimeTranspilerCache::is_disabled(),
    }
}

// ported from: src/jsc/RuntimeTranspilerCache.zig
