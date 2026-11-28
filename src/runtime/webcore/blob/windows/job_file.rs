//! The file a `ReadFile`, `WriteFile` or `CopyFile` job operates on.

use bun_core::{ZBox, ZStr};
use bun_sys::windows_format::wtf16;
use bun_sys::{self as sys, E, File, FileKind, O, Tag};

use super::blocking::BlockingIo;
use crate::io_order::{Key, RetainedFile};
use crate::node::fs::DEFAULT_PERMISSION;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::mkdirp;
use crate::webcore::node_types::PathOrFileDescriptor;

/// What a job opens.
pub(super) enum Target {
    Fd(RetainedFile),
    Path {
        resolved_path: ZBox,
        /// Reported in errors.
        original_path: Box<[u8]>,
    },
}

impl Target {
    /// Resolves a path like `node:fs`.
    pub(super) fn new(pathlike: &PathOrFileDescriptor<'_>) -> Self {
        match pathlike {
            PathOrFileDescriptor::Fd(fd) => Self::Fd(RetainedFile::new(*fd)),
            PathOrFileDescriptor::Path(original_path) => {
                let mut buf = bun_paths::Path::new();
                let path = original_path.slice_z(&mut buf).as_bytes();
                // A bad path is reported by the job's own system call.
                let verbatim_path = sys::windows::verbatim_path(path);
                Self::Path {
                    resolved_path: verbatim_path.unwrap_or_else(|| ZBox::from_bytes(path)),
                    original_path: original_path.slice().into(),
                }
            }
        }
    }

    /// `pathlike` must be the value passed to [`Target::new`].
    pub(super) fn key(&self, pathlike: &PathOrFileDescriptor<'_>) -> Key {
        match self {
            Self::Fd(_) => Key::from_fd(pathlike.fd()),
            Self::Path { resolved_path, .. } => Key::from_path(resolved_path.as_bytes()),
        }
    }

    pub(super) fn attach_path(&self, err: sys::Error) -> sys::Error {
        match self {
            Self::Fd(_) => err,
            Self::Path { original_path, .. } => err.with_path(original_path),
        }
    }
}

/// [`JobFile::can_block`] before the open, when only a descriptor can be classified.
pub(super) fn is_device(pathlike: &PathOrFileDescriptor<'_>) -> bool {
    matches!(pathlike, PathOrFileDescriptor::Fd(fd) if !sys::windows::is_disk_file(*fd))
}

pub(super) enum JobFile {
    Opened(File),
    Borrowed(RetainedFile),
}

impl core::ops::Deref for JobFile {
    type Target = File;
    fn deref(&self) -> &File {
        match self {
            Self::Opened(file) => file,
            Self::Borrowed(file) => file,
        }
    }
}

impl JobFile {
    pub(super) fn open_source(target: &mut Target) -> sys::Result<Self> {
        match target {
            Target::Fd(file) => Ok(Self::Borrowed(core::mem::take(file))),
            Target::Path { resolved_path, .. } => File::open(resolved_path.as_zstr(), O::RDONLY, 0)
                .map(Self::Opened)
                .map_err(|err| target.attach_path(err)),
        }
    }

    pub(super) fn open_destination(
        target: &mut Target,
        extra_flags: i32,
        mut should_mkdirp: bool,
    ) -> sys::Result<Self> {
        let (path, original_path) = match target {
            Target::Fd(file) => return Ok(Self::Borrowed(core::mem::take(file))),
            Target::Path {
                resolved_path,
                original_path,
            } => (resolved_path.as_zstr(), &**original_path),
        };
        loop {
            match File::open(path, O::WRONLY | O::CREAT | extra_flags, DEFAULT_PERMISSION) {
                Ok(file) => return Ok(Self::Opened(file)),
                Err(err)
                    if err.get_errno() == E::ENOENT
                        && core::mem::take(&mut should_mkdirp)
                        && !is_malformed(original_path) =>
                {
                    create_parent_dirs(path, original_path)?;
                }
                Err(err) => return Err(err.with_path(original_path)),
            }
        }
    }

    pub(super) fn is_borrowed(&self) -> bool {
        matches!(self, Self::Borrowed(_))
    }

    /// Whether this is a pipe, a console or another device.
    pub(super) fn can_block(&self) -> sys::Result<bool> {
        if self.fd().origin().is_some() {
            return Ok(false);
        }
        Ok(self.kind()? != FileKind::File)
    }

    /// Each open of a named pipe is a connection of its own.
    pub(super) fn is_own_connection(&self) -> bool {
        !self.is_borrowed() && matches!(self.kind(), Ok(FileKind::NamedPipe))
    }

    pub(super) fn write_all(
        &self,
        mut bytes: &[u8],
        blocking_io: Option<&BlockingIo>,
    ) -> sys::Result<()> {
        while !bytes.is_empty() {
            let written = match blocking_io {
                Some(io) => io.write(self.fd(), bytes)?,
                None => sys::write(self.fd(), bytes)?,
            };
            if written == 0 {
                return Err(sys::Error::from_code(E::EIO, Tag::write));
            }
            bytes = &bytes[written..];
        }
        Ok(())
    }
}

fn is_malformed(path: &[u8]) -> bool {
    let mut buf = bun_paths::w_path_buffer_pool::get();
    wtf16::encode(path, &mut buf[..]).is_err_and(|err| err == wtf16::EncodeError::Malformed)
}

pub(super) fn create_parent_dirs(path: &ZStr, original_path: &[u8]) -> sys::Result<()> {
    let dirname = |path| bun_paths::dirname(path).unwrap_or(path);
    let path = match path.as_bytes() {
        // Files embedded in a compiled executable are looked up without the `\\?\` prefix.
        [b'\\', b'\\', b'?', b'\\', path @ ..] if matches!(path, [_, b':', b'\\', ..]) => path,
        path => path,
    };
    mkdirp(dirname(path)).map_err(|err| err.with_path(dirname(original_path)))
}

/// Drops the path, destination and descriptor.
pub(super) fn strip_error_context(err: &sys::Error) -> sys::Error {
    sys::Error::from_code(err.get_errno(), err.syscall)
}
