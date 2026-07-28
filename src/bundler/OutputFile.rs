use core::ffi::c_void;

use crate::options::Loader;
// `bake::Side` / `jsc.api.BuildArtifact.OutputKind` are TYPE_ONLY move-ins;
// the `options` module already defines them locally.
use crate::Error;
use crate::options::{OutputKind, Side};
use bun_core::String as BunString;
use bun_paths::PathBuffer;
use bun_paths::fs;
use bun_paths::resolve_path::{self, platform};
use bun_sys::Fd;

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
    // Not a `const` because `Box`/`fs::Path` aren't const-constructible.
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

pub type Index = bun_core::GenericIndex<u32, OutputFile>;
pub type IndexOptional = bun_core::GenericIndexOptional<u32, OutputFile>;

#[derive(Clone)]
pub struct FileOperation {
    // Owned copy so the field has a single, obvious lifetime.
    pub pathname: Box<[u8]>,
}

#[derive(Clone)]
pub enum Value {
    Copy(FileOperation),
    Noop,
    Buffer { bytes: Box<[u8]> },
    Saved(SavedFile),
}

impl Value {
    pub fn as_slice(&self) -> &[u8] {
        match self {
            Value::Buffer { bytes } => bytes,
            _ => b"",
        }
    }

    /// Borrowing variant of [`Self::to_bun_string`]: wraps the buffer in a
    /// `WTF::ExternalStringImpl` that aliases `bytes` with a **no-op** free
    /// callback (zero-copy). Caller guarantees `self` outlives every use of the
    /// returned string.
    ///
    /// `PerThread.bundled_outputs` owns the bytes for the entire prerender
    /// phase. The consuming [`Self::to_bun_string`] cannot be used there
    /// because the `Vec<OutputFile>` is only borrowed.
    pub fn to_bun_string_ref(&self) -> BunString {
        match self {
            Value::Noop => BunString::EMPTY,
            Value::Buffer { bytes } => {
                if bytes.is_empty() {
                    return BunString::EMPTY;
                }
                extern "C" fn noop(_: *mut c_void, _: *mut c_void, _: usize) {}
                // latin1 = true.
                BunString::create_external::<*mut c_void>(
                    bytes,
                    true,
                    core::ptr::null_mut::<c_void>(),
                    noop,
                )
            }
            Value::Copy(_) | Value::Saved(_) => {
                bun_core::todo_panic!("to_bun_string_ref: Copy/Saved")
            }
        }
    }
}

#[derive(Default, Clone, Copy)]
pub struct SavedFile {}

pub enum OptionsData {
    Buffer {
        // arena dropped — global mimalloc.
        data: Box<[u8]>,
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
            dest_path: options.output_path,
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
                OptionsData::Saved(_) => Value::Saved(SavedFile::default()),
            },
            side: options.side,
            entry_point_index: options.entry_point_index,
            referenced_css_chunks: options.referenced_css_chunks,
            bake_extra: options.bake_extra,
        }
    }

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
                    // `dirname` returns `b""` when there's no separator.
                    let parent = resolve_path::dirname::<platform::Auto>(rel_path);
                    if !parent.is_empty() {
                        bun_sys::Dir::borrow(&root_dir).make_path(parent)?;
                    }
                }

                let mut path_buf = PathBuffer::uninit();
                let _ = bun_sys::write_file_with_path_buffer(
                    &mut path_buf,
                    &bun_sys::WriteFileArgs {
                        data: bun_sys::WriteFileData::Buffer { buffer: bytes },
                        encoding: bun_sys::WriteFileEncoding::Buffer,
                        mode: if self.is_executable { 0o755 } else { 0o644 },
                        dirfd: root_dir,
                        file: bun_sys::PathOrFileDescriptor::Path(rel_path),
                    },
                )?;
            }
            Value::Copy(value) => {
                self.copy_to(root_dir_path, &value.pathname, root_dir)?;
            }
        }
        Ok(())
    }

    pub fn copy_to(&self, _: &[u8], rel_path: &[u8], dir: Fd) -> Result<(), Error> {
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

// `to_js` / `to_blob` are extension-trait methods that
// live in `bun_bundler_jsc`; the base type carries no jsc reference.
