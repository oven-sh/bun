fn get(comptime name: []const u8) comptime_int {
    return if (@hasDecl(bun.O, name))
        return @field(bun.O, name)
    else
        @compileError("Unknown Constant: " ++ name);
}

// File Access Constants
/// Constant for fs.access(). File is visible to the calling process.
pub const F_OK = std.posix.F_OK;
/// Constant for fs.access(). File can be read by the calling process.
pub const R_OK = std.posix.R_OK;
/// Constant for fs.access(). File can be written by the calling process.
pub const W_OK = std.posix.W_OK;
/// Constant for fs.access(). File can be executed by the calling process.
pub const X_OK = std.posix.X_OK;
// File Copy Constants
pub const Copyfile = enum(i32) {
    _,
    pub const exclusive = 1;
    pub const clone = 2;
    pub const force = 4;

    pub inline fn isForceClone(this: Copyfile) bool {
        return (@intFromEnum(this) & COPYFILE_FICLONE_FORCE) != 0;
    }

    pub inline fn shouldntOverwrite(this: Copyfile) bool {
        return (@intFromEnum(this) & COPYFILE_EXCL) != 0;
    }

    pub inline fn canUseClone(this: Copyfile) bool {
        _ = this;
        return Environment.isMac;
        // return (@intFromEnum(this) | COPYFILE_FICLONE) != 0;
    }
};

/// Constant for fs.copyFile. Flag indicating the destination file should not be overwritten if it already exists.
pub const COPYFILE_EXCL: i32 = Copyfile.exclusive;
///
/// Constant for fs.copyFile. copy operation will attempt to create a copy-on-write reflink.
/// If the underlying platform does not support copy-on-write, then a fallback copy mechanism is used.
pub const COPYFILE_FICLONE: i32 = Copyfile.clone;
///
/// Constant for fs.copyFile. Copy operation will attempt to create a copy-on-write reflink.
/// If the underlying platform does not support copy-on-write, then the operation will fail with an error.
pub const COPYFILE_FICLONE_FORCE: i32 = Copyfile.force;
// File Open Constants
/// Constant for fs.open(). Flag indicating to open a file for read-only access.
pub const O_RDONLY = bun.O.RDONLY;
/// Constant for fs.open(). Flag indicating to open a file for write-only access.
pub const O_WRONLY = bun.O.WRONLY;
/// Constant for fs.open(). Flag indicating to open a file for read-write access.
pub const O_RDWR = bun.O.RDWR;
/// Constant for fs.open(). Flag indicating to create the file if it does not already exist.
pub const O_CREAT = bun.O.CREAT;
/// Constant for fs.open(). Flag indicating that opening a file should fail if the O_CREAT flag is set and the file already exists.
pub const O_EXCL = bun.O.EXCL;

///
/// Constant for fs.open(). Flag indicating that if path identifies a terminal device,
/// opening the path shall not cause that terminal to become the controlling terminal for the process
/// (if the process does not already have one).
pub const O_NOCTTY = bun.O.NOCTTY;
/// Constant for fs.open(). Flag indicating that if the file exists and is a regular file, and the file is opened successfully for write access, its length shall be truncated to zero.
pub const O_TRUNC = bun.O.TRUNC;
/// Constant for fs.open(). Flag indicating that data will be appended to the end of the file.
pub const O_APPEND = bun.O.APPEND;
/// Constant for fs.open(). Flag indicating that the open should fail if the path is not a directory.
pub const O_DIRECTORY = bun.O.DIRECTORY;

///
/// constant for fs.open().
/// Flag indicating reading accesses to the file system will no longer result in
/// an update to the atime information associated with the file.
/// This flag is available on Linux operating systems only.
pub const O_NOATIME = get("NOATIME");
/// Constant for fs.open(). Flag indicating that the open should fail if the path is a symbolic link.
pub const O_NOFOLLOW = bun.O.NOFOLLOW;
/// Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O.
pub const O_SYNC = bun.O.SYNC;
/// Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O with write operations waiting for data integrity.
pub const O_DSYNC = bun.O.DSYNC;
/// Constant for fs.open(). Flag indicating to open the symbolic link itself rather than the resource it is pointing to.
pub const O_SYMLINK = get("SYMLINK");
/// Constant for fs.open(). When set, an attempt will be made to minimize caching effects of file I/O.
pub const O_DIRECT = get("DIRECT");
/// Constant for fs.open(). Flag indicating to open the file in nonblocking mode when possible.
pub const O_NONBLOCK = bun.O.NONBLOCK;
// File Type Constants
/// Constant for fs.Stats mode property for determining a file's type. Bit mask used to extract the file type code.
pub const S_IFMT = std.posix.S.IFMT;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a regular file.
pub const S_IFREG = std.posix.S.IFREG;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a directory.
pub const S_IFDIR = std.posix.S.IFDIR;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a character-oriented device file.
pub const S_IFCHR = std.posix.S.IFCHR;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a block-oriented device file.
pub const S_IFBLK = std.posix.S.IFBLK;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a FIFO/pipe.
pub const S_IFIFO = std.posix.S.IFIFO;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a symbolic link.
pub const S_IFLNK = std.posix.S.IFLNK;
/// Constant for fs.Stats mode property for determining a file's type. File type constant for a socket.
pub const S_IFSOCK = std.posix.S.IFSOCK;
// File Mode Constants
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by owner.
pub const S_IRWXU = std.posix.S.IRWXU;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by owner.
pub const S_IRUSR = std.posix.S.IRUSR;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by owner.
pub const S_IWUSR = std.posix.S.IWUSR;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by owner.
pub const S_IXUSR = std.posix.S.IXUSR;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by group.
pub const S_IRWXG = std.posix.S.IRWXG;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by group.
pub const S_IRGRP = std.posix.S.IRGRP;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by group.
pub const S_IWGRP = std.posix.S.IWGRP;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by group.
pub const S_IXGRP = std.posix.S.IXGRP;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by others.
pub const S_IRWXO = std.posix.S.IRWXO;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by others.
pub const S_IROTH = std.posix.S.IROTH;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by others.
pub const S_IWOTH = std.posix.S.IWOTH;
/// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by others.
pub const S_IXOTH = std.posix.S.IXOTH;

///
/// When set, a memory file mapping is used to access the file. This flag
/// is available on Windows operating systems only. On other operating systems,
/// this flag is ignored.
pub const UV_FS_O_FILEMAP = 536870912;

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
