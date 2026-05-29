use core::ffi::c_void;

use crate::options::Loader;
// `bake::Side` / `jsc.api.BuildArtifact.OutputKind` are TYPE_ONLY move-ins;
// the `options` module already defines them locally.
use crate::options::{OutputKind, Side};
use bun_core::Error;
use bun_core::{PathString, String as BunString};
use bun_paths::PathBuffer;
use bun_paths::fs;
use bun_paths::resolve_path::{self, platform};
use bun_sys::Fd;

use crate::bun_fs::RealFS;

pub struct OutputFile {
    pub loader: Loader,
    pub input_loader: Loader,
    pub src_path: fs::Path<'static>,
    pub owned_src_path_text: Box<[u8]>,
    pub value: Value,
    pub size: usize,
    pub size_without_sourcemap: usize,
    pub hash: u64,
    pub is_executable: bool,
    pub source_map_index: u32,
    pub bytecode_index: u32,
    pub module_info_index: u32,
    pub output_kind: OutputKind,
    /// Relative
    pub dest_path: Box<[u8]>,
    pub side: Option<Side>,
    /// This is only set for the JS bundle, and not files associated with an
    /// entrypoint like sourcemaps and bytecode
    pub entry_point_index: Option<u32>,
    pub referenced_css_chunks: Box<[Index]>,
    pub source_index: IndexOptional,
    pub bake_extra: BakeExtra,
}

impl OutputFile {
    // TODO(port): Zig `zero_value` is a const struct literal; Rust can't make this a
    // true `const` because `Box`/`fs::Path` aren't const-constructible. Exposed as a
    // plain fn so call sites read `OutputFile::zero_value()`.
    pub fn zero_value() -> OutputFile {
        OutputFile {
            loader: Loader::File,
            input_loader: Loader::Js,
            src_path: fs::Path::init(b""),
            owned_src_path_text: Box::default(),
            value: Value::Noop,
            size: 0,
            size_without_sourcemap: 0,
            hash: 0,
            is_executable: false,
            source_map_index: u32::MAX,
            bytecode_index: u32::MAX,
            module_info_index: u32::MAX,
            output_kind: OutputKind::Chunk,
            dest_path: Box::default(),
            side: None,
            entry_point_index: None,
            referenced_css_chunks: Box::default(),
            source_index: IndexOptional::NONE,
            bake_extra: BakeExtra::default(),
        }
    }
}

impl Clone for OutputFile {
    fn clone(&self) -> Self {
        let owned_src_path_text = self.owned_src_path_text.clone();
        // SAFETY: `owned_src_path_text` is a sibling field that outlives `src_path`; the boxed buffer never moves.
        let text: &'static [u8] =
            unsafe { core::mem::transmute::<&[u8], &'static [u8]>(&owned_src_path_text) };
        let src_path = if !self.owned_src_path_text.is_empty() {
            fs::Path {
                is_disabled: self.src_path.is_disabled,
                is_symlink: self.src_path.is_symlink,
                ..fs::Path::init(text)
            }
        } else {
            self.src_path
        };
        OutputFile {
            loader: self.loader,
            input_loader: self.input_loader,
            src_path,
            owned_src_path_text,
            value: self.value.clone(),
            size: self.size,
            size_without_sourcemap: self.size_without_sourcemap,
            hash: self.hash,
            is_executable: self.is_executable,
            source_map_index: self.source_map_index,
            bytecode_index: self.bytecode_index,
            module_info_index: self.module_info_index,
            output_kind: self.output_kind,
            dest_path: self.dest_path.clone(),
            side: self.side,
            entry_point_index: self.entry_point_index,
            referenced_css_chunks: self.referenced_css_chunks.clone(),
            source_index: self.source_index,
            bake_extra: self.bake_extra,
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct BakeExtra {
    pub is_route: bool,
    pub fully_static: bool,
    pub bake_is_runtime: bool,
}

// Zig: `pub const Index = bun.GenericIndex(u32, OutputFile);`
pub type Index = bun_core::GenericIndex<u32, OutputFile>;
pub type IndexOptional = bun_core::GenericIndexOptional<u32, OutputFile>;

#[derive(Clone)]
pub struct FileOperation {
    // TODO(port): lifetime — Zig never frees `pathname`; may be borrowed from
    // `Options.output_path`. Using owned `Box<[u8]>` for now.
    pub pathname: Box<[u8]>,
    pub fd: Fd,
    pub dir: Fd,
    pub is_tmpdir: bool,
    pub is_outdir: bool,
    pub close_handle_on_complete: bool,
    pub autowatch: bool,
}

impl Default for FileOperation {
    fn default() -> Self {
        Self {
            pathname: Box::default(),
            fd: Fd::INVALID,
            dir: Fd::INVALID,
            is_tmpdir: false,
            is_outdir: false,
            close_handle_on_complete: false,
            autowatch: true,
        }
    }
}

impl FileOperation {
    pub fn from_file(fd: Fd, pathname: &[u8]) -> FileOperation {
        FileOperation {
            fd,
            pathname: Box::from(pathname),
            ..Default::default()
        }
    }

    pub fn get_pathname(&self) -> &[u8] {
        if self.is_tmpdir {
            // PORT NOTE: `resolve_path.joinAbs` writes into a threadlocal buffer in
            // Zig; the Rust port returns a borrow into that TLS buffer (`'static`),
            // which coerces to the `&self` lifetime here.
            return resolve_path::join_abs::<platform::Auto>(RealFS::tmpdir_path(), &self.pathname);
        }
        &self.pathname
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Kind {
    Move,
    Copy,
    Noop,
    Buffer,
    Pending,
    Saved,
}

// TODO: document how and why all variants of this union(enum) are used,
// specifically .move and .copy; the new bundler has to load files in memory
// in order to hash them, so i think it uses .buffer for those
pub enum Value {
    Move(FileOperation),
    Copy(FileOperation),
    Noop,
    Buffer {
        // Zig carried `arena: std.mem.Allocator` alongside `bytes`; in Rust the
        // global mimalloc arena backs `Box<[u8]>`, so the field is dropped.
        bytes: Box<[u8]>,
    },
    // PORT NOTE: boxed to avoid blowing up `Value`'s inline size (`resolver::Result`
    // is several hundred bytes).
    Pending(Box<bun_resolver::Result>),
    Saved(SavedFile),
}

impl Clone for Value {
    fn clone(&self) -> Self {
        match self {
            Value::Move(op) => Value::Move(op.clone()),
            Value::Copy(op) => Value::Copy(op.clone()),
            Value::Noop => Value::Noop,
            Value::Buffer { bytes } => Value::Buffer {
                bytes: bytes.clone(),
            },
            Value::Pending(_) => unreachable!("OutputFile.Value::Pending is never cloned"),
            Value::Saved(s) => Value::Saved(*s),
        }
    }
}

impl Value {
    pub fn as_slice(&self) -> &[u8] {
        match self {
            Value::Buffer { bytes } => bytes,
            _ => b"",
        }
    }

    pub fn to_bun_string(self) -> BunString {
        match self {
            Value::Noop => BunString::EMPTY,
            Value::Buffer { bytes } => {
                if bytes.is_empty() {
                    return BunString::EMPTY;
                }
                extern "C" fn on_free(_ctx: *mut c_void, buffer: *mut c_void, len: usize) {
                    // SAFETY: `buffer`/`len` were produced by `heap::alloc` on a
                    // `Box<[u8]>` below; reconstructing and dropping is sound.
                    unsafe {
                        drop(bun_core::heap::take(core::ptr::slice_from_raw_parts_mut(
                            buffer.cast::<u8>(),
                            len,
                        )));
                    }
                }
                // Hand the `Box<[u8]>` to the ExternalStringImpl: `heap::release`
                // (= `Box::leak`) yields a `&'static mut [u8]` borrow of the
                // now-JSC-owned allocation; `on_free` reclaims it on GC.
                let bytes: &'static mut [u8] = bun_core::heap::release(bytes);
                // latin1 flag = true (matches Zig).
                BunString::create_external::<*mut c_void>(
                    bytes,
                    true,
                    core::ptr::null_mut::<c_void>(),
                    on_free,
                )
            }
            Value::Pending(_) => unreachable!(),
            // Zig: `else => |tag| bun.todoPanic(@src(), "handle .{s}", .{@tagName(tag)})`
            // — an intentional shipped runtime panic for `.move`/`.copy`/`.saved`,
            // not a port placeholder.
            other => bun_core::todo_panic!("handle .{}", <&'static str>::from(other.kind())),
        }
    }

    pub fn to_bun_string_ref(&self) -> BunString {
        match self {
            Value::Noop => BunString::EMPTY,
            Value::Buffer { bytes } => {
                if bytes.is_empty() {
                    return BunString::EMPTY;
                }
                extern "C" fn noop(_: *mut c_void, _: *mut c_void, _: usize) {}
                // latin1 = true (matches Zig).
                BunString::create_external::<*mut c_void>(
                    bytes,
                    true,
                    core::ptr::null_mut::<c_void>(),
                    noop,
                )
            }
            Value::Pending(_) => unreachable!(),
            other => bun_core::todo_panic!("handle .{}", <&'static str>::from(other.kind())),
        }
    }

    pub fn kind(&self) -> Kind {
        match self {
            Value::Move(_) => Kind::Move,
            Value::Copy(_) => Kind::Copy,
            Value::Noop => Kind::Noop,
            Value::Buffer { .. } => Kind::Buffer,
            Value::Pending(_) => Kind::Pending,
            Value::Saved(_) => Kind::Saved,
        }
    }
}

/// `OutputFile.zig:SavedFile` (TYPE_ONLY move-in from bundler_jsc).
#[derive(Default, Clone, Copy)]
pub struct SavedFile {
    pub byte_size: u64,
}

impl OutputFile {
    pub fn init_pending(loader: Loader, pending: bun_resolver::Result) -> OutputFile {
        let src_path = fs::Path::init(pending.path_const().expect("path").text);
        OutputFile {
            loader,
            src_path,
            size: 0,
            value: Value::Pending(Box::new(pending)),
            ..OutputFile::zero_value()
        }
    }

    // TODO(port): Zig took `std.fs.File`; std::fs is banned. Accepting a raw `Fd`.
    pub fn init_file(file: Fd, pathname: &'static [u8], size: usize) -> OutputFile {
        OutputFile {
            loader: Loader::File,
            src_path: fs::Path::init(pathname),
            size,
            value: Value::Copy(FileOperation::from_file(file, pathname)),
            ..OutputFile::zero_value()
        }
    }

    // TODO(port): Zig took `std.fs.Dir`; using `Fd` for the dir handle.
    pub fn init_file_with_dir(
        file: Fd,
        pathname: &'static [u8],
        size: usize,
        dir: Fd,
    ) -> OutputFile {
        let mut res = Self::init_file(file, pathname, size);
        if let Value::Copy(op) = &mut res.value {
            // PORT NOTE: Zig wrote `res.value.copy.dir_handle = .fromStdDir(dir)` but
            // `FileOperation` has no `dir_handle` field — looks like a latent bug; the
            // intended field is `dir`.
            op.dir = dir;
        }
        res
    }
}

pub enum OptionsData {
    Buffer {
        // arena dropped — global mimalloc.
        data: Box<[u8]>,
    },
    File {
        // TODO(port): Zig used `std.fs.File` / `std.fs.Dir`; mapped to `Fd`.
        file: Fd,
        size: usize,
        dir: Fd,
    },
    Saved(usize),
}

pub struct Options {
    pub loader: Loader,
    pub input_loader: Loader,
    pub hash: Option<u64>,
    pub source_map_index: Option<u32>,
    pub bytecode_index: Option<u32>,
    pub module_info_index: Option<u32>,
    pub output_path: Box<[u8]>,
    pub source_index: IndexOptional,
    pub size: Option<usize>,
    pub input_path: Box<[u8]>,
    pub display_size: u32,
    pub output_kind: OutputKind,
    pub is_executable: bool,
    pub data: OptionsData,
    pub side: Option<Side>,
    pub entry_point_index: Option<u32>,
    pub referenced_css_chunks: Box<[Index]>,
    pub bake_extra: BakeExtra,
}

impl OutputFile {
    pub fn init(options: Options) -> OutputFile {
        let size = options.size.unwrap_or(match &options.data {
            OptionsData::Buffer { data } => data.len(),
            OptionsData::File { size, .. } => *size,
            OptionsData::Saved(_) => 0,
        });
        let owned_src_path_text: Box<[u8]> = options.input_path;
        // SAFETY: `owned_src_path_text` is a sibling field that outlives `src_path`; the boxed buffer never moves.
        let input_path: &'static [u8] =
            unsafe { core::mem::transmute::<&[u8], &'static [u8]>(&owned_src_path_text) };
        OutputFile {
            loader: options.loader,
            input_loader: options.input_loader,
            src_path: fs::Path::init(input_path),
            owned_src_path_text,
            dest_path: options.output_path.clone(),
            source_index: options.source_index,
            size,
            size_without_sourcemap: options.display_size as usize,
            hash: options.hash.unwrap_or(0),
            output_kind: options.output_kind,
            bytecode_index: options.bytecode_index.unwrap_or(u32::MAX),
            module_info_index: options.module_info_index.unwrap_or(u32::MAX),
            source_map_index: options.source_map_index.unwrap_or(u32::MAX),
            is_executable: options.is_executable,
            value: match options.data {
                OptionsData::Buffer { data } => Value::Buffer { bytes: data },
                OptionsData::File { file, dir, .. } => Value::Copy('brk: {
                    let mut op = FileOperation::from_file(file, &options.output_path);
                    op.dir = dir;
                    break 'brk op;
                }),
                OptionsData::Saved(_) => Value::Saved(SavedFile::default()),
            },
            side: options.side,
            entry_point_index: options.entry_point_index,
            referenced_css_chunks: options.referenced_css_chunks,
            bake_extra: options.bake_extra,
        }
    }

    // TODO(port): narrow error set
    pub fn write_to_disk(&self, root_dir: Fd, root_dir_path: &[u8]) -> Result<(), Error> {
        match &self.value {
            Value::Noop => {}
            Value::Saved(_) => {
                // already written to disk
            }
            Value::Buffer { bytes } => {
                let mut rel_path: &[u8] = &self.dest_path;
                if self.dest_path.len() > root_dir_path.len() {
                    rel_path = resolve_path::relative(root_dir_path, &self.dest_path);
                    // Zig: `std.fs.path.dirname` returns `null` when there's no
                    // separator; the Rust port returns `b""` instead.
                    let parent = resolve_path::dirname::<platform::Auto>(rel_path);
                    if !parent.is_empty() {
                        bun_sys::Dir::borrow(&root_dir).make_path(parent)?;
                    }
                }

                let mut path_buf = PathBuffer::uninit();
                let _ = bun_sys::write_file_with_path_buffer(
                    &mut path_buf,
                    &bun_sys::WriteFileArgs {
                        data: bun_sys::WriteFileData::Buffer {
                            // Zig built a JSC ArrayBuffer view over `bytes` via
                            // `@constCast`; the Rust side just borrows the slice.
                            buffer: bytes,
                        },
                        encoding: bun_sys::WriteFileEncoding::Buffer,
                        mode: if self.is_executable { 0o755 } else { 0o644 },
                        dirfd: root_dir,
                        file: bun_sys::PathOrFileDescriptor::Path(PathString::init(rel_path)),
                    },
                )?;
            }
            Value::Move(value) => {
                self.move_to(root_dir_path, &value.pathname, root_dir)?;
            }
            Value::Copy(value) => {
                self.copy_to(root_dir_path, &value.pathname, root_dir)?;
            }
            Value::Pending(_) => unreachable!(),
        }
        Ok(())
    }

    // TODO(port): narrow error set
    pub fn move_to(&self, _: &[u8], rel_path: &[u8], dir: Fd) -> Result<(), Error> {
        let Value::Move(mv) = &self.value else {
            unreachable!()
        };
        // Zig: `std.posix.toPosixPath` + `bun.sliceTo(.., 0)` to NUL-terminate both
        // paths into stack buffers. Mirrored with `resolve_path::z` over two
        // `PathBuffer`s.
        let mut src_buf = PathBuffer::uninit();
        let mut dst_buf = PathBuffer::uninit();
        let src = resolve_path::z(mv.get_pathname(), &mut src_buf);
        let dst = resolve_path::z(rel_path, &mut dst_buf);
        bun_sys::move_file_z(mv.dir, src, dir, dst)?;
        Ok(())
    }

    // TODO(port): narrow error set
    pub fn copy_to(&self, _: &[u8], rel_path: &[u8], dir: Fd) -> Result<(), Error> {
        // PORT NOTE: Zig used `dir.stdDir().createFile(rel_path, .{})` and
        // `std.fs.cwd().openFile(...)`. Mapped to `bun_sys::openat` (which takes
        // a NUL-terminated `&ZStr`).
        let mut out_buf = PathBuffer::uninit();
        let fd_out = bun_sys::openat(
            dir,
            resolve_path::z(rel_path, &mut out_buf),
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
            0o644,
        )?;
        let mut in_buf = PathBuffer::uninit();
        let fd_in = bun_sys::openat(
            Fd::cwd(),
            resolve_path::z(self.src_path.text, &mut in_buf),
            bun_sys::O::RDONLY,
            0,
        )?;

        #[cfg(windows)]
        {
            let _ = (fd_out, fd_in);
            // use paths instead of bun.getFdPathW()
            panic!("TODO windows");
        }
        #[cfg(not(windows))]
        {
            bun_sys::copy_file(fd_in, fd_out)?;
            Ok(())
        }
    }
}

// ported from: src/bundler/OutputFile.zig
