use core::ffi::c_void;

use bun_bake::Side;
use bun_bundler::options::Loader;
use bun_core::Error;
use bun_fs as fs;
use bun_paths::{self as resolve_path, PathBuffer};
use bun_resolver as resolver;
use bun_str::String as BunString;
use bun_sys::Fd;

// TODO(port): `OutputKind` lives under `bun.jsc.API.BuildArtifact` in Zig; this is a
// jsc-crate type referenced from a base crate. Phase B may relocate the enum.
use bun_jsc::api::build_artifact::OutputKind;

// Instead of keeping files in-memory, we:
// 1. Write directly to disk
// 2. (Optional) move the file to the destination
// This saves us from allocating a buffer

pub struct OutputFile {
    pub loader: Loader,
    pub input_loader: Loader,
    // TODO(port): `src_path.text` ownership — Zig `deinit` freed it via
    // `default_allocator` even though it's a field of `Fs.Path`. Ensure
    // `bun_fs::Path` owns `text` so dropping `OutputFile` frees it implicitly.
    pub src_path: fs::Path,
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
    pub const ZERO_VALUE: fn() -> OutputFile = || OutputFile {
        loader: Loader::File,
        input_loader: Loader::Js,
        src_path: fs::Path::init(b""),
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
    };
    // TODO(port): Zig `zero_value` is a const struct literal; Rust can't make this a
    // true `const` because `Box`/`fs::Path` aren't const-constructible. Exposed as a
    // fn-pointer thunk so call sites read `OutputFile::ZERO_VALUE()`. Revisit in Phase B.
}

#[derive(Default, Clone, Copy)]
pub struct BakeExtra {
    pub is_route: bool,
    pub fully_static: bool,
    pub bake_is_runtime: bool,
}

// Zig: `pub const Index = bun.GenericIndex(u32, OutputFile);`
// TODO(port): `bun.GenericIndex` provides `.Optional` with `.none`; mirror that here.
pub type Index = bun_core::GenericIndex<u32, OutputFile>;
pub type IndexOptional = <Index as bun_core::GenericIndexExt>::Optional;

// Zig `deinit` only freed owned fields (value / src_path.text / dest_path /
// referenced_css_chunks); all are now owned types that drop automatically, so no
// explicit `impl Drop` is needed (and an empty one would block field moves).

// Depending on:
// - The target
// - The number of open file handles
// - Whether or not a file of the same name exists
// We may use a different system call
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
            // TODO(port): `resolve_path.joinAbs` writes into a threadlocal buffer in
            // Zig; the Rust port returns a borrow into that TLS buffer. Verify lifetime.
            resolve_path::join_abs(
                fs::FileSystem::RealFS::tmpdir_path(),
                resolve_path::Platform::Auto,
                &self.pathname,
            )
        } else {
            &self.pathname
        }
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
        // Zig carried `allocator: std.mem.Allocator` alongside `bytes`; in Rust the
        // global mimalloc allocator backs `Box<[u8]>`, so the field is dropped.
        bytes: Box<[u8]>,
    },
    Pending(resolver::Result),
    Saved(SavedFile),
}

impl Value {
    // Zig `deinit` only freed `.buffer.bytes`; `Box<[u8]>` drops automatically, so no
    // explicit `Drop` impl is needed.

    pub fn as_slice(&self) -> &[u8] {
        match self {
            Value::Buffer { bytes } => bytes,
            _ => b"",
        }
    }

    pub fn to_bun_string(self) -> BunString {
        match self {
            Value::Noop => BunString::empty(),
            Value::Buffer { bytes } => {
                // Use ExternalStringImpl to avoid cloning the string, at
                // the cost of allocating space to remember the allocator.
                //
                // Zig boxed a `FreeContext { allocator }` and passed an `extern "C"`
                // callback that frees the slice via that allocator then destroys the
                // context. With the global allocator, the context collapses to the
                // (ptr, len) pair already passed to the callback.
                extern "C" fn on_free(_ctx: *mut c_void, buffer: *mut c_void, len: u32) {
                    // SAFETY: `buffer`/`len` were produced by `Box::into_raw` on a
                    // `Box<[u8]>` below; reconstructing and dropping is sound.
                    unsafe {
                        drop(Box::from_raw(core::ptr::slice_from_raw_parts_mut(
                            buffer.cast::<u8>(),
                            len as usize,
                        )));
                    }
                }
                let len = bytes.len();
                let ptr = Box::into_raw(bytes) as *mut u8;
                // TODO(port): exact `bun_str::String::create_external` signature
                // (latin1 flag = true in Zig). Passing null ctx since allocator is gone.
                BunString::create_external(
                    core::ptr::null_mut::<c_void>(),
                    // SAFETY: ptr/len come from a live `Box<[u8]>` leaked just above.
                    unsafe { core::slice::from_raw_parts(ptr, len) },
                    true,
                    on_free,
                )
            }
            Value::Pending(_) => unreachable!(),
            other => bun_core::todo_panic!(
                "handle .{}",
                <&'static str>::from(other.kind())
            ),
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

// TODO(port): Zig re-exports `SavedFile` from `../bundler_jsc/output_file_jsc.zig`.
// It is a payload type (used in `Value::Saved`), not a `to_js` method, so the alias
// cannot simply be deleted. Phase B should decide whether `SavedFile` belongs in the
// base crate to break the bundler→bundler_jsc edge.
pub use bun_bundler_jsc::output_file_jsc::SavedFile;

impl OutputFile {
    pub fn init_pending(loader: Loader, pending: resolver::Result) -> OutputFile {
        let src_path = pending.path_const().expect("path").clone();
        OutputFile {
            loader,
            src_path,
            size: 0,
            value: Value::Pending(pending),
            ..OutputFile::ZERO_VALUE()
        }
    }

    // TODO(port): Zig took `std.fs.File`; std::fs is banned. Accepting a raw `Fd`.
    pub fn init_file(file: Fd, pathname: &[u8], size: usize) -> OutputFile {
        OutputFile {
            loader: Loader::File,
            src_path: fs::Path::init(pathname),
            size,
            value: Value::Copy(FileOperation::from_file(file, pathname)),
            ..OutputFile::ZERO_VALUE()
        }
    }

    // TODO(port): Zig took `std.fs.Dir`; using `Fd` for the dir handle.
    pub fn init_file_with_dir(file: Fd, pathname: &[u8], size: usize, dir: Fd) -> OutputFile {
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
        // allocator dropped — global mimalloc.
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
        let size = options.size.unwrap_or_else(|| match &options.data {
            OptionsData::Buffer { data } => data.len(),
            OptionsData::File { size, .. } => *size,
            OptionsData::Saved(_) => 0,
        });
        OutputFile {
            loader: options.loader,
            input_loader: options.input_loader,
            src_path: fs::Path::init(&options.input_path),
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
                    if let Some(parent) = bun_paths::dirname(rel_path) {
                        if parent.len() > root_dir_path.len() {
                            // TODO(port): Zig `root_dir.makePath(parent)` (std.fs.Dir).
                            bun_sys::make_path(root_dir, parent)?;
                        }
                    }
                }

                let mut path_buf = PathBuffer::uninit();
                // TODO(port): `jsc.Node.fs.NodeFS.writeFileWithPathBuffer` lives in
                // `bun_runtime::node::fs`. This is a jsc/runtime dep from a base crate;
                // Phase B may want a thin `bun_sys` helper instead.
                bun_runtime::node::fs::NodeFS::write_file_with_path_buffer(
                    &mut path_buf,
                    bun_runtime::node::fs::WriteFileArgs {
                        data: bun_runtime::node::fs::WriteFileData::Buffer {
                            // Zig built a JSC ArrayBuffer view over `bytes` via
                            // `@constCast`; the Rust side just borrows the slice.
                            buffer: bytes,
                        },
                        encoding: bun_runtime::node::Encoding::Buffer,
                        mode: if self.is_executable { 0o755 } else { 0o644 },
                        dirfd: root_dir,
                        file: bun_runtime::node::fs::PathOrFileDescriptor::Path(
                            bun_str::PathString::init(rel_path),
                        ),
                    },
                )
                .unwrap()?;
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
        // paths. `bun_str::ZStr::from_bytes` performs the same dupeZ.
        let src = bun_str::ZStr::from_bytes(mv.get_pathname());
        let dst = bun_str::ZStr::from_bytes(rel_path);
        bun_sys::move_file_z(mv.dir, &src, dir, &dst)?;
        Ok(())
    }

    // TODO(port): narrow error set
    pub fn copy_to(&self, _: &[u8], rel_path: &[u8], dir: Fd) -> Result<(), Error> {
        // TODO(port): Zig used `dir.stdDir().createFile(rel_path, .{})` and
        // `std.fs.cwd().openFile(...)`. Mapped to `bun_sys` openat calls.
        let fd_out = bun_sys::openat(
            dir,
            rel_path,
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
            0o644,
        )
        .unwrap()?;
        let mut do_close = false;
        let fd_in = bun_sys::openat(
            Fd::cwd(),
            &self.src_path.text,
            bun_sys::O::RDONLY,
            0,
        )
        .unwrap()?;

        #[cfg(windows)]
        {
            do_close = fs::FileSystem::instance().fs.need_to_close_files();

            // use paths instead of bun.getFdPathW()
            panic!("TODO windows");
        }

        let guard = scopeguard::guard((), |_| {
            if do_close {
                fd_out.close();
                fd_in.close();
            }
        });

        bun_sys::copy_file(fd_in, fd_out).unwrap()?;

        drop(guard);
        Ok(())
    }
}

// Zig: `pub const toJS = @import("../bundler_jsc/output_file_jsc.zig").toJS;`
// Zig: `pub const toBlob = @import("../bundler_jsc/output_file_jsc.zig").toBlob;`
// Deleted per PORTING.md — `to_js` / `to_blob` become extension-trait methods that
// live in `bun_bundler_jsc`; the base type carries no jsc reference.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/OutputFile.zig (336 lines)
//   confidence: medium
//   todos:      15
//   notes:      jsc/runtime deps (OutputKind, NodeFS, SavedFile) leak into base crate; ZERO_VALUE can't be const; std.fs.File/Dir params remapped to bun_sys::Fd
// ──────────────────────────────────────────────────────────────────────────
