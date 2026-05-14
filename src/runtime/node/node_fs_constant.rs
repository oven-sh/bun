use bun_sys::{O, posix};

// PORT NOTE: the Zig `get(comptime name)` helper used `@hasDecl(bun.O, name)` +
// `@field(bun.O, name)` to look up an open-flag by string at comptime, with a
// `@compileError` fallback. Rust has no struct-field reflection; since every
// call site names a constant that exists on `bun_sys::O`, we reference those
// constants directly below and drop the helper.

// File Access Constants
/// Constant for fs.access(). File is visible to the calling process.
pub const F_OK: i32 = posix::F_OK;
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
    pub const fn from_raw(raw: i32) -> Self {
        Self(raw)
    }

    pub const EXCLUSIVE: i32 = 1;
    pub const CLONE: i32 = 2;
    pub const FORCE: i32 = 4;

    #[inline]
    pub fn is_force_clone(self) -> bool {
        (self.0 & COPYFILE_FICLONE_FORCE) != 0
    }

    #[inline]
    pub fn shouldnt_overwrite(self) -> bool {
        (self.0 & COPYFILE_EXCL) != 0
    }

    #[inline]
    pub fn can_use_clone(self) -> bool {
        let _ = self;
        cfg!(target_os = "macos")
        // return (self.0 | COPYFILE_FICLONE) != 0;
    }
}

/// Constant for fs.copyFile. Flag indicating the destination file should not be overwritten if it already exists.
pub const COPYFILE_EXCL: i32 = Copyfile::EXCLUSIVE;
///
/// Constant for fs.copyFile. copy operation will attempt to create a copy-on-write reflink.
/// If the underlying platform does not support copy-on-write, then a fallback copy mechanism is used.
pub const COPYFILE_FICLONE: i32 = Copyfile::CLONE;
///
/// Constant for fs.copyFile. Copy operation will attempt to create a copy-on-write reflink.
/// If the underlying platform does not support copy-on-write, then the operation will fail with an error.
pub const COPYFILE_FICLONE_FORCE: i32 = Copyfile::FORCE;

// File Open Constants
/// Constant for fs.open(). Flag indicating to open a file for read-only access.
pub const O_RDONLY: i32 = O::RDONLY;
/// Constant for fs.open(). Flag indicating to open a file for write-only access.
pub const O_WRONLY: i32 = O::WRONLY;
/// Constant for fs.open(). Flag indicating to open a file for read-write access.
pub const O_RDWR: i32 = O::RDWR;
/// Constant for fs.open(). Flag indicating to create the file if it does not already exist.
pub const O_CREAT: i32 = O::CREAT;
/// Constant for fs.open(). Flag indicating that opening a file should fail if the O_CREAT flag is set and the file already exists.
pub const O_EXCL: i32 = O::EXCL;

///
/// Constant for fs.open(). Flag indicating that if path identifies a terminal device,
/// opening the path shall not cause that terminal to become the controlling terminal for the process
/// (if the process does not already have one).
pub const O_NOCTTY: i32 = O::NOCTTY;
/// Constant for fs.open(). Flag indicating that if the file exists and is a regular file, and the file is opened successfully for write access, its length shall be truncated to zero.
pub const O_TRUNC: i32 = O::TRUNC;
/// Constant for fs.open(). Flag indicating that data will be appended to the end of the file.
pub const O_APPEND: i32 = O::APPEND;
/// Constant for fs.open(). Flag indicating that the open should fail if the path is not a directory.
pub const O_DIRECTORY: i32 = O::DIRECTORY;

///
/// constant for fs.open().
/// Flag indicating reading accesses to the file system will no longer result in
/// an update to the atime information associated with the file.
/// This flag is available on Linux operating systems only.
pub const O_NOATIME: i32 = O::NOATIME;
/// Constant for fs.open(). Flag indicating that the open should fail if the path is a symbolic link.
pub const O_NOFOLLOW: i32 = O::NOFOLLOW;
/// Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O.
pub const O_SYNC: i32 = O::SYNC;
/// Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O with write operations waiting for data integrity.
pub const O_DSYNC: i32 = O::DSYNC;
/// Constant for fs.open(). Flag indicating to open the symbolic link itself rather than the resource it is pointing to.
pub const O_SYMLINK: i32 = O::SYMLINK;
/// Constant for fs.open(). When set, an attempt will be made to minimize caching effects of file I/O.
#[cfg(target_os = "linux")]
pub const O_DIRECT: i32 = libc::O_DIRECT;
#[cfg(not(target_os = "linux"))]
pub const O_DIRECT: i32 = 0;
/// Constant for fs.open(). Flag indicating to open the file in nonblocking mode when possible.
pub const O_NONBLOCK: i32 = O::NONBLOCK;

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
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by owner.
pub const S_IWUSR: i32 = posix::S::IWUSR as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by owner.
pub const S_IXUSR: i32 = posix::S::IXUSR as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by group.
pub const S_IRWXG: i32 = posix::S::IRWXG as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by group.
pub const S_IRGRP: i32 = posix::S::IRGRP as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by group.
pub const S_IWGRP: i32 = posix::S::IWGRP as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by group.
pub const S_IXGRP: i32 = posix::S::IXGRP as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by others.
pub const S_IRWXO: i32 = posix::S::IRWXO as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by others.
pub const S_IROTH: i32 = posix::S::IROTH as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by others.
pub const S_IWOTH: i32 = posix::S::IWOTH as i32;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by others.
pub const S_IXOTH: i32 = posix::S::IXOTH as i32;

///
/// When set, a memory file mapping is used to access the file. This flag
/// is available on Windows operating systems only. On other operating systems,
/// this flag is ignored.
pub const UV_FS_O_FILEMAP: i32 = 536870912;

// TODO(port): verify constant types — Zig left these as comptime_int / inherited
// from bun.O / std.posix.S; Phase B should align with bun_sys's actual repr
// (u32 vs i32) once that crate lands.

// ported from: src/runtime/node/node_fs_constant.zig
