const bun = @import("root").bun;
const Environment = bun.Environment;
const std = @import("std");

fn get(comptime name: []const u8) comptime_int {
    return if (@hasDecl(std.os.O, name))
        return @field(std.os.O, name)
    else
        return 0;
}
pub const Constants = struct {
    // File Access Constants
    /// Constant for fs.access(). File is visible to the calling process.
    pub const F_OK = std.os.F_OK;
    /// Constant for fs.access(). File can be read by the calling process.
    pub const R_OK = std.os.R_OK;
    /// Constant for fs.access(). File can be written by the calling process.
    pub const W_OK = std.os.W_OK;
    /// Constant for fs.access(). File can be executed by the calling process.
    pub const X_OK = std.os.X_OK;
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
    pub const COPYFILE_EXCL: i32 = 1 << Copyfile.exclusive;

    ///
    /// Constant for fs.copyFile. copy operation will attempt to create a copy-on-write reflink.
    /// If the underlying platform does not support copy-on-write, then a fallback copy mechanism is used.
    pub const COPYFILE_FICLONE: i32 = 1 << Copyfile.clone;
    ///
    /// Constant for fs.copyFile. Copy operation will attempt to create a copy-on-write reflink.
    /// If the underlying platform does not support copy-on-write, then the operation will fail with an error.
    pub const COPYFILE_FICLONE_FORCE: i32 = 1 << Copyfile.force;
    // File Open Constants
    /// Constant for fs.open(). Flag indicating to open a file for read-only access.
    pub const O_RDONLY = std.os.O.RDONLY;
    /// Constant for fs.open(). Flag indicating to open a file for write-only access.
    pub const O_WRONLY = std.os.O.WRONLY;
    /// Constant for fs.open(). Flag indicating to open a file for read-write access.
    pub const O_RDWR = std.os.O.RDWR;
    /// Constant for fs.open(). Flag indicating to create the file if it does not already exist.
    pub const O_CREAT = std.os.O.CREAT;
    /// Constant for fs.open(). Flag indicating that opening a file should fail if the O_CREAT flag is set and the file already exists.
    pub const O_EXCL = std.os.O.EXCL;

    ///
    /// Constant for fs.open(). Flag indicating that if path identifies a terminal device,
    /// opening the path shall not cause that terminal to become the controlling terminal for the process
    /// (if the process does not already have one).
    pub const O_NOCTTY = std.os.O.NOCTTY;
    /// Constant for fs.open(). Flag indicating that if the file exists and is a regular file, and the file is opened successfully for write access, its length shall be truncated to zero.
    pub const O_TRUNC = std.os.O.TRUNC;
    /// Constant for fs.open(). Flag indicating that data will be appended to the end of the file.
    pub const O_APPEND = std.os.O.APPEND;
    /// Constant for fs.open(). Flag indicating that the open should fail if the path is not a directory.
    pub const O_DIRECTORY = std.os.O.DIRECTORY;

    ///
    /// constant for fs.open().
    /// Flag indicating reading accesses to the file system will no longer result in
    /// an update to the atime information associated with the file.
    /// This flag is available on Linux operating systems only.
    pub const O_NOATIME = get("NOATIME");
    /// Constant for fs.open(). Flag indicating that the open should fail if the path is a symbolic link.
    pub const O_NOFOLLOW = std.os.O.NOFOLLOW;
    /// Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O.
    pub const O_SYNC = std.os.O.SYNC;
    /// Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O with write operations waiting for data integrity.
    pub const O_DSYNC = std.os.O.DSYNC;
    /// Constant for fs.open(). Flag indicating to open the symbolic link itself rather than the resource it is pointing to.
    pub const O_SYMLINK = get("SYMLINK");
    /// Constant for fs.open(). When set, an attempt will be made to minimize caching effects of file I/O.
    pub const O_DIRECT = get("DIRECT");
    /// Constant for fs.open(). Flag indicating to open the file in nonblocking mode when possible.
    pub const O_NONBLOCK = std.os.O.NONBLOCK;
    // File Type Constants
    /// Constant for fs.Stats mode property for determining a file's type. Bit mask used to extract the file type code.
    pub const S_IFMT = std.os.S.IFMT;
    /// Constant for fs.Stats mode property for determining a file's type. File type constant for a regular file.
    pub const S_IFREG = std.os.S.IFREG;
    /// Constant for fs.Stats mode property for determining a file's type. File type constant for a directory.
    pub const S_IFDIR = std.os.S.IFDIR;
    /// Constant for fs.Stats mode property for determining a file's type. File type constant for a character-oriented device file.
    pub const S_IFCHR = std.os.S.IFCHR;
    /// Constant for fs.Stats mode property for determining a file's type. File type constant for a block-oriented device file.
    pub const S_IFBLK = std.os.S.IFBLK;
    /// Constant for fs.Stats mode property for determining a file's type. File type constant for a FIFO/pipe.
    pub const S_IFIFO = std.os.S.IFIFO;
    /// Constant for fs.Stats mode property for determining a file's type. File type constant for a symbolic link.
    pub const S_IFLNK = std.os.S.IFLNK;
    /// Constant for fs.Stats mode property for determining a file's type. File type constant for a socket.
    pub const S_IFSOCK = std.os.S.IFSOCK;
    // File Mode Constants
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by owner.
    pub const S_IRWXU = std.os.S.IRWXU;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by owner.
    pub const S_IRUSR = std.os.S.IRUSR;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by owner.
    pub const S_IWUSR = std.os.S.IWUSR;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by owner.
    pub const S_IXUSR = std.os.S.IXUSR;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by group.
    pub const S_IRWXG = std.os.S.IRWXG;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by group.
    pub const S_IRGRP = std.os.S.IRGRP;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by group.
    pub const S_IWGRP = std.os.S.IWGRP;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by group.
    pub const S_IXGRP = std.os.S.IXGRP;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by others.
    pub const S_IRWXO = std.os.S.IRWXO;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by others.
    pub const S_IROTH = std.os.S.IROTH;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by others.
    pub const S_IWOTH = std.os.S.IWOTH;
    /// Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by others.
    pub const S_IXOTH = std.os.S.IXOTH;

    ///
    /// When set, a memory file mapping is used to access the file. This flag
    /// is available on Windows operating systems only. On other operating systems,
    /// this flag is ignored.
    pub const UV_FS_O_FILEMAP = 49152;
};

// Due to zig's format support max 32 arguments, we need to split
// here.
const constants_string_format1 =
    \\var constants = {{
    \\  F_OK: {d},
    \\  R_OK: {d},
    \\  W_OK: {d},
    \\  X_OK: {d},
    \\  COPYFILE_EXCL: {d},
    \\  COPYFILE_FICLONE: {d},
    \\  COPYFILE_FICLONE_FORCE: {d},
    \\  O_RDONLY: {d},
    \\  O_WRONLY: {d},
    \\  O_RDWR: {d},
    \\  O_CREAT: {d},
    \\  O_EXCL: {d},
    \\  O_NOCTTY: {d},
    \\  O_TRUNC: {d},
    \\  O_APPEND: {d},
    \\  O_DIRECTORY: {d},
    \\  O_NOATIME: {d},
    \\  O_NOFOLLOW: {d},
    \\  O_SYNC: {d},
    \\  O_DSYNC: {d},
;
const constants_string_format2 =
    \\  O_SYMLINK: {s},
    \\  O_DIRECT: {d},
    \\  O_NONBLOCK: {d},
    \\  S_IFMT: {d},
    \\  S_IFREG: {d},
    \\  S_IFDIR: {d},
    \\  S_IFCHR: {d},
    \\  S_IFBLK: {d},
    \\  S_IFIFO: {d},
    \\  S_IFLNK: {d},
    \\  S_IFSOCK: {d},
    \\  S_IRWXU: {d},
    \\  S_IRUSR: {d},
    \\  S_IWUSR: {d},
    \\  S_IXUSR: {d},
    \\  S_IRWXG: {d},
    \\  S_IRGRP: {d},
    \\  S_IWGRP: {d},
    \\  S_IXGRP: {d},
    \\  S_IRWXO: {d},
    \\  S_IROTH: {d},
    \\  S_IWOTH: {d},
    \\  S_IXOTH: {d},
    \\  UV_FS_O_FILEMAP: {d}
    \\}};
    \\
;

const constants_string1 = std.fmt.comptimePrint(constants_string_format1, .{ Constants.F_OK, Constants.R_OK, Constants.W_OK, Constants.X_OK, Constants.COPYFILE_EXCL, Constants.COPYFILE_FICLONE, Constants.COPYFILE_FICLONE_FORCE, Constants.O_RDONLY, Constants.O_WRONLY, Constants.O_RDWR, Constants.O_CREAT, Constants.O_EXCL, Constants.O_NOCTTY, Constants.O_TRUNC, Constants.O_APPEND, Constants.O_DIRECTORY, Constants.O_NOATIME, Constants.O_NOFOLLOW, Constants.O_SYNC, Constants.O_DSYNC });

const constants_string2 =
    std.fmt.comptimePrint(constants_string_format2, .{ if (@TypeOf(Constants.O_SYMLINK) == void) "undefined" else std.fmt.comptimePrint("{}", .{Constants.O_SYMLINK}), Constants.O_DIRECT, Constants.O_NONBLOCK, Constants.S_IFMT, Constants.S_IFREG, Constants.S_IFDIR, Constants.S_IFCHR, Constants.S_IFBLK, Constants.S_IFIFO, Constants.S_IFLNK, Constants.S_IFSOCK, Constants.S_IRWXU, Constants.S_IRUSR, Constants.S_IWUSR, Constants.S_IXUSR, Constants.S_IRWXG, Constants.S_IRGRP, Constants.S_IWGRP, Constants.S_IXGRP, Constants.S_IRWXO, Constants.S_IROTH, Constants.S_IWOTH, Constants.S_IXOTH, Constants.UV_FS_O_FILEMAP });

pub const constants_string = constants_string1 ++ constants_string2;
