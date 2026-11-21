//! The file that a `ReadFile`, `WriteFile` or `CopyFile` works on.

use bun_core::{ZBox, ZStr};
use bun_sys::windows_format::wide;
use bun_sys::{self as sys, E, File, FileKind, O, Tag};

use super::blocking::Blocking;
use crate::io_order::{KeptOpen, Key};
use crate::node::fs::{DEFAULT_PERMISSION, error_for_caller};
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::mkdirp;
use crate::webcore::node_types::{PathLike, PathOrFileDescriptor};

/// What the script named.
pub(super) enum Target {
    Lent(KeptOpen),
    Path {
        resolved: ZBox,
        /// For errors.
        shown: Box<[u8]>,
    },
}

impl Target {
    /// A path is resolved as in `node:fs`.
    pub(super) fn new(pathlike: &PathOrFileDescriptor<'_>) -> Self {
        match pathlike {
            PathOrFileDescriptor::Fd(fd) => Self::Lent(KeptOpen::new(*fd)),
            PathOrFileDescriptor::Path(shown) => {
                let mut buf = bun_paths::path_buffer_pool::get();
                let path = shown.slice_z(&mut buf).as_bytes();
                // The job reports a bad path.
                let verbatim = sys::windows::verbatim_path(path);
                Self::Path {
                    resolved: verbatim.unwrap_or_else(|| ZBox::from_bytes(path)),
                    shown: shown.slice().into(),
                }
            }
        }
    }

    /// `pathlike` is what `self` was made of.
    pub(super) fn key(&self, pathlike: &PathOrFileDescriptor<'_>) -> Key {
        match self {
            Self::Lent(_) => Key::descriptor(pathlike.fd()),
            Self::Path { resolved, .. } => Key::path(resolved.as_bytes()),
        }
    }

    pub(super) fn blame(&self, err: sys::Error) -> sys::Error {
        match self {
            Self::Lent(_) => err,
            Self::Path { shown, .. } => error_for_caller(
                [Some(&PathLike::borrowed(shown)), None],
                err.with_path(shown),
            ),
        }
    }
}

/// [`JobFile::can_block`], as far as it is known without opening anything.
pub(super) fn is_device(pathlike: &PathOrFileDescriptor<'_>) -> bool {
    matches!(pathlike, PathOrFileDescriptor::Fd(fd) if !sys::windows::is_disk(*fd))
}

pub(super) enum JobFile {
    Opened(File),
    Lent(KeptOpen),
}

impl core::ops::Deref for JobFile {
    type Target = File;
    fn deref(&self) -> &File {
        match self {
            Self::Opened(file) => file,
            Self::Lent(file) => file,
        }
    }
}

impl JobFile {
    pub(super) fn source(target: &mut Target) -> sys::Result<Self> {
        match target {
            Target::Lent(file) => Ok(Self::Lent(core::mem::take(file))),
            Target::Path { resolved, .. } => File::open(resolved.as_zstr(), O::RDONLY, 0)
                .map(Self::Opened)
                .map_err(|err| target.blame(err)),
        }
    }

    /// `flags` are added to those that create a file for writing.
    pub(super) fn destination(
        target: &mut Target,
        flags: i32,
        mut may_make_folder: bool,
    ) -> sys::Result<Self> {
        let (path, shown) = match target {
            Target::Lent(file) => return Ok(Self::Lent(core::mem::take(file))),
            Target::Path { resolved, shown } => (resolved.as_zstr(), &**shown),
        };
        loop {
            match File::open(path, O::WRONLY | O::CREAT | flags, DEFAULT_PERMISSION) {
                Ok(file) => return Ok(Self::Opened(file)),
                Err(err)
                    if err.get_errno() == E::ENOENT
                        && core::mem::take(&mut may_make_folder)
                        && !is_malformed(shown) =>
                {
                    make_folder_for(path, shown)?;
                }
                Err(err) => return Err(err.with_path(shown)),
            }
        }
    }

    pub(super) fn is_lent(&self) -> bool {
        matches!(self, Self::Lent(_))
    }

    /// Whether this is a pipe, a console or another device.
    pub(super) fn can_block(&self) -> sys::Result<bool> {
        if self.fd().origin().is_some() {
            return Ok(false);
        }
        Ok(self.kind()? != FileKind::File)
    }

    pub(super) fn write_everything(
        &self,
        mut bytes: &[u8],
        blocking: Option<&Blocking>,
    ) -> sys::Result<()> {
        while !bytes.is_empty() {
            let wrote = match blocking {
                Some(blocking) => blocking.write(self.fd(), bytes)?,
                None => sys::write(self.fd(), bytes)?,
            };
            if wrote == 0 {
                return Err(sys::Error::from_code(E::EIO, Tag::write));
            }
            bytes = &bytes[wrote..];
        }
        Ok(())
    }
}

fn is_malformed(path: &[u8]) -> bool {
    let mut buf = bun_paths::w_path_buffer_pool::get();
    wide::encode(path, &mut buf[..]).is_err_and(|err| err == wide::EncodeError::Malformed)
}

pub(super) fn make_folder_for(path: &ZStr, shown: &[u8]) -> sys::Result<()> {
    let folder = |path| bun_core::dirname(path).unwrap_or(path);
    let path = match path.as_bytes() {
        // The files of a compiled program are found by paths without the prefix.
        [b'\\', b'\\', b'?', b'\\', path @ ..] if matches!(path, [_, b':', b'\\', ..]) => path,
        path => path,
    };
    mkdirp(folder(path)).map_err(|err| err.with_path(folder(shown)))
}

/// `err` with its code and system call only.
pub(super) fn bare(err: &sys::Error) -> sys::Error {
    sys::Error::from_code(err.get_errno(), err.syscall)
}
