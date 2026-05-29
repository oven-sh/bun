use bun_sys::{O, posix};

/// Constant for fs.access(). File can be read by the calling process.
pub const R_OK: i32 = posix::R_OK;
/// Constant for fs.access(). File can be written by the calling process.
pub const W_OK: i32 = posix::W_OK;
/// Constant for fs.access(). File can be executed by the calling process.
pub const X_OK: i32 = posix::X_OK;

// File Copy Constants
// PORT NOTE: Zig `enum(i32) { _ }` (non-exhaustive, no variants) is a newtype
// over i32 with associated decls — modelled here as a transparent tuple struct.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Copyfile(pub i32);

impl Copyfile {
    /// Zig: `@enumFromInt(raw)` — wrap a raw flags value.
    #[inline]
    pub(crate) const fn from_raw(raw: i32) -> Self {
        Self(raw)
    }

    pub(crate) const EXCLUSIVE: i32 = 1;
    pub(crate) const FORCE: i32 = 4;

    #[inline]
    pub(crate) fn is_force_clone(self) -> bool {
        (self.0 & COPYFILE_FICLONE_FORCE) != 0
    }

    #[inline]
    pub(crate) fn shouldnt_overwrite(self) -> bool {
        (self.0 & COPYFILE_EXCL) != 0
    }
}

/// Constant for fs.copyFile. Flag indicating the destination file should not be overwritten if it already exists.
pub(crate) const COPYFILE_EXCL: i32 = Copyfile::EXCLUSIVE;
///
/// Constant for fs.copyFile. Copy operation will attempt to create a copy-on-write reflink.
/// If the underlying platform does not support copy-on-write, then the operation will fail with an error.
pub(crate) const COPYFILE_FICLONE_FORCE: i32 = Copyfile::FORCE;

pub const O_NOATIME: i32 = O::NOATIME;
/// Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O with write operations waiting for data integrity.
pub const O_DSYNC: i32 = O::DSYNC;
/// Constant for fs.open(). Flag indicating to open the symbolic link itself rather than the resource it is pointing to.
pub const O_SYMLINK: i32 = O::SYMLINK;
/// Constant for fs.open(). When set, an attempt will be made to minimize caching effects of file I/O.
#[cfg(any(target_os = "linux", target_os = "android"))]
#[allow(dead_code)]
pub(crate) const O_DIRECT: i32 = libc::O_DIRECT;

// File Type Constants
/// Constant for fs.Stats mode property for determining a file's type. Bit mask used to extract the file type code.
pub const S_IFMT: i32 = posix::S::IFMT as i32;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a regular file.
pub const S_IFREG: i32 = posix::S::IFREG as i32;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a directory.
pub const S_IFDIR: i32 = posix::S::IFDIR as i32;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a character-oriented device file.
pub const S_IFCHR: i32 = posix::S::IFCHR as i32;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a block-oriented device file.
pub const S_IFBLK: i32 = posix::S::IFBLK as i32;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a FIFO/pipe.
pub const S_IFIFO: i32 = posix::S::IFIFO as i32;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a symbolic link.
pub const S_IFLNK: i32 = posix::S::IFLNK as i32;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a socket.
pub const S_IFSOCK: i32 = posix::S::IFSOCK as i32;

// File Mode Constants
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by owner.
pub const S_IRWXU: i32 = posix::S::IRWXU as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by owner.
pub const S_IRUSR: i32 = posix::S::IRUSR as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by owner.
pub const S_IXUSR: i32 = posix::S::IXUSR as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by group.
pub const S_IRWXG: i32 = posix::S::IRWXG as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by group.
pub const S_IRGRP: i32 = posix::S::IRGRP as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by group.
pub const S_IXGRP: i32 = posix::S::IXGRP as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by others.
pub const S_IRWXO: i32 = posix::S::IRWXO as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by others.
pub const S_IROTH: i32 = posix::S::IROTH as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by others.
pub const S_IXOTH: i32 = posix::S::IXOTH as i32;

// TODO(port): verify constant types — Zig left these as comptime_int / inherited
// from bun.O / std.posix.S; align with bun_sys's actual repr (u32 vs i32).

// ported from: src/runtime/node/node_fs_constant.zig
