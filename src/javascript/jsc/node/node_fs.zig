const std = @import("std");
const _global = @import("../../../global.zig");
const strings = _global.strings;
const string = _global.string;
const AsyncIO = @import("io");
const JSC = @import("../../../jsc.zig");
const PathString = JSC.PathString;
const Environment = _global.Environment;
const C = _global.C;
const Flavor = @import("./types.zig").Flavor;
const system = std.os.system;
const Maybe = @import("./types.zig").Maybe;
const Encoding = @import("./types.zig").Encoding;
const Syscall = @import("./syscall.zig");
const builtin = @import("builtin");
const os = @import("std").os;
const darwin = os.darwin;
const linux = os.linux;

pub const FlavoredIO = struct {
    io: *AsyncIO,
};

const PathOrBuffer = union(Tag) {
    path: PathString,
    buffer: Buffer,

    pub const Tag = enum { path, buffer };

    pub inline fn slice(this: PathOrBuffer) []const u8 {
        return this.path.slice();
    }
};

const ArrayBuffer = JSC.MarkedArrayBuffer;
const Buffer = ArrayBuffer;

pub const SystemError = struct {
    errno: c_int = 0,
    path: PathString,
    syscall: [:0]const u8 = "",
};

pub fn CallbackTask(comptime Result: type) type {
    return struct {
        callback: JSC.C.JSObjectRef,
        option: Option,
        success: bool = false,
        completion: AsyncIO.Completion,

        pub const Option = union {
            err: SystemError,
            result: Result,
        };
    };
}

/// https://nodejs.org/api/fs.html
/// https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/node/fs.d.ts
pub const NodeFS = struct {
    const Mode = c_uint;
    const FileDescriptor = c_int;
    const uid_t = std.os.uid_t;
    const gid_t = std.os.gid_t;
    const TimeLike = c_int;
    const ReadPosition = ?u63;
    async_io: *AsyncIO,

    pub const StringOrBuffer = union(Tag) {
        string: string,
        buffer: Buffer,

        pub const Tag = enum { string, buffer };

        pub fn slice(this: StringOrBuffer) []const u8 {
            return switch (this) {
                .string => this.string,
                .buffer => @panic("Not implemented yet"),
            };
        }
    };

    pub const FileSystemFlags = enum(c_int) {
        /// Open file for appending. The file is created if it does not exist.
        @"a" = std.os.O.APPEND,
        /// Like 'a' but fails if the path exists.
        @"ax" = std.os.O.APPEND | std.os.O.EXCL,
        /// Open file for reading and appending. The file is created if it does not exist.
        @"a+" = std.os.O.APPEND | std.os.O.RDWR,
        /// Like 'a+' but fails if the path exists.
        @"ax+" = std.os.O.APPEND | std.os.O.RDWR | std.os.O.EXCL,
        /// Open file for appending in synchronous mode. The file is created if it does not exist.
        @"as" = std.os.O.APPEND,
        /// Open file for reading and appending in synchronous mode. The file is created if it does not exist.
        @"as+" = std.os.O.APPEND | std.os.O.RDWR,
        /// Open file for reading. An exception occurs if the file does not exist.
        @"r" = std.os.O.RDONLY,
        /// Open file for reading and writing. An exception occurs if the file does not exist.
        @"r+" = std.os.O.RDWR,
        /// Open file for reading and writing in synchronous mode. Instructs the operating system to bypass the local file system cache.
        /// This is primarily useful for opening files on NFS mounts as it allows skipping the potentially stale local cache. It has a very real impact on I/O performance so using this flag is not recommended unless it is needed.
        /// This doesn't turn fs.open() or fsPromises.open() into a synchronous blocking call. If synchronous operation is desired, something like fs.openSync() should be used.
        @"rs+" = std.os.O.RDWR,
        /// Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
        @"w" = std.os.O.WRONLY | std.os.O.CREAT,
        /// Like 'w' but fails if the path exists.
        @"wx" = std.os.O.WRONLY | std.os.O.TRUNC,
        ///  Open file for reading and writing. The file is created (if it does not exist) or truncated (if it exists).
        @"w+" = std.os.O.RDWR | std.os.O.CREAT,
        ///  Like 'w+' but fails if the path exists.
        @"wx+" = std.os.O.RDWR | std.os.O.EXCL,
    };

    const PathLike = union(Tag) {
        string: PathString,
        buffer: void,
        url: void,

        pub const Tag = enum { string, buffer, url };

        pub inline fn slice(this: PathLike) string {
            return this.string.slice();
        }

        pub fn sliceZWithForceCopy(this: PathLike, buf: [:0]u8, comptime force: bool) [:0]const u8 {
            var sliced = this.string.slice();
            if (comptime !force) {
                if (sliced[sliced.len - 1] == 0) {
                    var sliced_ptr = sliced.ptr;
                    return sliced_ptr[0 .. sliced.len - 1 :0];
                }
            }

            @memcpy(&buf, sliced.ptr, sliced.len);
            buf[sliced.len] = 0;
            return buf[0..sliced.len :0];
        }

        pub inline fn sliceZ(this: PathLike, buf: [:0]u8) [:0]const u8 {
            return sliceZWithForceCopy(this, buf, false);
        }
    };

    const PathOrFileDescriptor = union(Tag) {
        path: PathLike,
        fd: FileDescriptor,

        pub const Tag = enum { fd, path };
    };

    pub const Arguments = struct {
        pub const Rename = struct {
            old_path: PathLike,
            new_path: PathLike,
        };

        pub const Truncate = struct {
            path: PathLike,
            len: ?u32 = null,
        };

        pub const FTruncate = struct {
            fd: FileDescriptor,
            len: ?u32 = null,
        };

        pub const Chown = struct {
            path: PathLike,
            uid: uid_t,
            gid: gid_t,
        };

        pub const FChown = struct {
            fd: FileDescriptor,
            uid: uid_t,
            gid: gid_t,
        };

        pub const LChown = Chown;

        pub const LUTimes = struct {
            path: PathLike,
            atime: TimeLike,
            mtime: TimeLike,
        };

        pub const Chmod = struct {
            path: PathLike,
            mode: Mode = 0x777,
        };

        pub const FChmod = struct {
            fd: FileDescriptor,
            mode: Mode = 0x777,
        };

        pub const LCHmod = Chmod;

        pub const Stat = struct {
            path: PathLike,
            big_int: bool = false,

            throw_if_no_entry: bool = false,
        };

        pub const FStat = struct {
            fd: FileDescriptor,
            big_int: bool = false,
        };

        pub const LStat = Stat;

        pub const Link = struct {
            old_path: PathLike,
            new_path: PathLike,
        };

        pub const Symlink = struct {
            old_path: PathLike,
            new_path: PathLike,
        };

        pub const ReadLink = struct {
            path: PathLike,
            encoding: Encoding = Encoding.utf8,
        };

        pub const RealPath = struct {
            path: PathLike,
            encoding: Encoding = Encoding.utf8,
        };

        pub const Unlink = struct {
            path: PathLike,
        };

        pub const Rm = struct {
            path: PathLike,
            force: bool = false,
            max_retries: u32 = 0,
            recursive: bool = false,
            retry_delay: c_uint = 100,
        };

        pub const RmDir = struct {
            path: PathLike,

            max_retries: u32 = 0,
            recursive: bool = false,
            retry_delay: c_uint = 100,
        };

        /// https://github.com/nodejs/node/blob/master/lib/fs.js#L1285
        pub const Mkdir = struct {
            path: PathLike,
            /// Indicates whether parent folders should be created.
            /// If a folder was created, the path to the first created folder will be returned.
            /// @default false
            recursive: bool = false,
            /// A file mode. If a string is passed, it is parsed as an octal integer. If not specified
            /// @default 
            mode: Mode = 0o777,
        };

        const MkdirTemp = struct {
            encoding: Encoding = Encoding.utf8,
            prefix: string,
        };

        pub const Readdir = struct {
            encoding: Encoding = Encoding.utf8,
            with_file_types: bool = false,
        };

        pub const Close = struct {
            fd: FileDescriptor,
        };

        pub const Open = struct {
            path: PathLike,
            flags: FileSystemFlags = FileSystemFlags.@"r",
            mode: Mode = 0o666,
        };

        /// Change the file system timestamps of the object referenced by `path`.
        ///
        /// The `atime` and `mtime` arguments follow these rules:
        ///
        /// * Values can be either numbers representing Unix epoch time in seconds,`Date`s, or a numeric string like `'123456789.0'`.
        /// * If the value can not be converted to a number, or is `NaN`, `Infinity` or`-Infinity`, an `Error` will be thrown.
        /// @since v0.4.2
        pub const UTimes = struct {
            path: PathLike,
            atime: TimeLike,
            mtime: TimeLike,
        };

        pub const FUTimes = struct {
            fd: FileDescriptor,
            atime: TimeLike,
            mtime: TimeLike,
        };

        pub const FSync = struct { fd: FileDescriptor };

        /// Write `buffer` to the file specified by `fd`. If `buffer` is a normal object, it
        /// must have an own `toString` function property.
        /// 
        /// `offset` determines the part of the buffer to be written, and `length` is
        /// an integer specifying the number of bytes to write.
        /// 
        /// `position` refers to the offset from the beginning of the file where this data
        /// should be written. If `typeof position !== 'number'`, the data will be written
        /// at the current position. See [`pwrite(2)`](http://man7.org/linux/man-pages/man2/pwrite.2.html).
        /// 
        /// The callback will be given three arguments `(err, bytesWritten, buffer)` where`bytesWritten` specifies how many _bytes_ were written from `buffer`.
        /// 
        /// If this method is invoked as its `util.promisify()` ed version, it returns
        /// a promise for an `Object` with `bytesWritten` and `buffer` properties.
        /// 
        /// It is unsafe to use `fs.write()` multiple times on the same file without waiting
        /// for the callback. For this scenario, {@link createWriteStream} is
        /// recommended.
        /// 
        /// On Linux, positional writes don't work when the file is opened in append mode.
        /// The kernel ignores the position argument and always appends the data to
        /// the end of the file.
        /// @since v0.0.2
        /// 
        pub const Write = struct {
            fd: FileDescriptor,
            buffer: Buffer,
            offset: u64 = 0,
            length: u64 = std.math.maxInt(u64),
            position: ReadPosition = null,
        };

        pub const Read = struct {
            fd: FileDescriptor,
            buffer: Buffer,
            offset: u64 = 0,
            length: u64 = std.math.maxInt(u64),
            position: ReadPosition = null,
        };

        /// Asynchronously reads the entire contents of a file.
        /// @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
        /// If a file descriptor is provided, the underlying file will _not_ be closed automatically.
        /// @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
        /// If a flag is not provided, it defaults to `'r'`.
        pub const ReadFile = struct {
            path: PathOrFileDescriptor,
            encoding: Encoding = Encoding.utf8,
        };

        pub const WriteFileOptions = struct {
            encoding: Encoding = Encoding.utf8,
            flag: FileSystemFlags = FileSystemFlags.@"w",
            mode: Mode = 0o666,
        };

        pub const WriteFile = struct {
            pub usingnamespace WriteFileOptions;
            file: PathOrFileDescriptor,
            data: StringOrBuffer,
        };

        pub const AppendFile = WriteFile;

        pub const OpenDir = struct {
            path: PathLike,
            encoding: Encoding = Encoding.utf8,

            /// Number of directory entries that are buffered internally when reading from the directory. Higher values lead to better performance but higher memory usage. Default: 32
            buffer_size: c_int = 32,
        };
        pub const Exists = struct {
            path: PathLike,
        };

        pub const Access = struct {
            path: PathLike,
            mode: FileSystemFlags = FileSystemFlags.@"r",
        };

        fn StreamOptions(comptime flags: FileSystemFlags, highwater_mark: u64) type {
            return struct {
                flags: FileSystemFlags = flags,
                encoding: Encoding = Encoding.buffer,
                fd: FileDescriptor = 0,
                mode: Mode = 0,
                auto_close: bool = true,
                emit_close: bool = true,
                start: u32 = 0,
                highwater_mark: u32 = highwater_mark,
            };
        }

        pub const CreateReadStream = struct {
            path: PathLike,

            pub const ReadStreamOptions = StreamOptions(FileSystemFlags.@"r", 64_384);
            pub usingnamespace ReadStreamOptions;
        };

        pub const FDataSync = struct {
            fd: FileDescriptor,
        };

        pub const CopyFile = struct {
            src: PathLike,
            dest: PathLike,
            mode: Constants.Copyfile,
        };

        pub const WriteEv = struct {
            fd: FileDescriptor,
            buffers: []ArrayBuffer,
            position: ReadPosition,
        };

        pub const ReadEv = struct {
            fd: FileDescriptor,
            buffers: []ArrayBuffer,
            position: ReadPosition,
        };

        pub const Copy = struct {
            pub const FilterCallback = fn (source: string, destination: string) bool;
            /// Dereference symlinks
            /// @default false
            dereference: bool = false,

            /// When `force` is `false`, and the destination
            /// exists, throw an error.
            /// @default false
            errorOnExist: bool = false,

            /// Function to filter copied files/directories. Return
            /// `true` to copy the item, `false` to ignore it.
            filter: ?FilterCallback = null,

            /// Overwrite existing file or directory. _The copy
            /// operation will ignore errors if you set this to false and the destination
            /// exists. Use the `errorOnExist` option to change this behavior.
            /// @default true
            force: bool = true,

            /// When `true` timestamps from `src` will
            /// be preserved.
            /// @default false
            preserve_timestamps: bool = false,

            /// Copy directories recursively.
            /// @default false
            recursive: bool = false,
        };
    };

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
            pub const force = 3;

            pub inline fn isForceClone(this: Copyfile) bool {
                return (@enumToInt(this) | COPYFILE_FICLONE_FORCE) != 0;
            }

            pub inline fn shouldOverwrite(this: Copyfile) bool {
                return (@enumToInt(this) | COPYFILE_EXCL) != 0;
            }

            pub inline fn canUseClone(this: Copyfile) bool {
                _ = this;
                return Environment.isMac;
                // return (@enumToInt(this) | COPYFILE_FICLONE) != 0;
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
        pub const O_NOATIME = std.os.O.NOATIME;
        /// Constant for fs.open(). Flag indicating that the open should fail if the path is a symbolic link.
        pub const O_NOFOLLOW = std.os.O.NOFOLLOW;
        /// Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O.
        pub const O_SYNC = std.os.O.SYNC;
        /// Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O with write operations waiting for data integrity.
        pub const O_DSYNC = std.os.O.DSYNC;
        /// Constant for fs.open(). Flag indicating to open the symbolic link itself rather than the resource it is pointing to.
        pub const O_SYMLINK = std.os.O.SYMLINK;
        /// Constant for fs.open(). When set, an attempt will be made to minimize caching effects of file I/O.
        pub const O_DIRECT = std.os.O.DIRECT;
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

    pub const Date = u32;

    fn StatsLike(comptime T: type) type {
        return struct {
            dev: T,
            ino: T,
            mode: T,
            nlink: T,
            uid: T,
            gid: T,
            rdev: T,
            size: T,
            blksize: T,
            blocks: T,
            atime_ms: T,
            mtime_ms: T,
            ctime_ms: T,
            birthtime_ms: T,
            atime: Date,
            mtime: Date,
            ctime: Date,
            birthtime: Date,

            pub fn init(stat_: os.Stat) @This() {
                return @This(){
                    .dev = @truncate(T, stat_.dev),
                    .ino = @truncate(T, stat_.ino),
                    .mode = @truncate(T, stat_.mode),
                    .nlink = @truncate(T, stat_.nlink),
                    .uid = @truncate(T, stat_.uid),
                    .gid = @truncate(T, stat_.gid),
                    .rdev = @truncate(T, stat_.rdev),
                    .size = @truncate(T, stat_.size),
                    .blksize = @truncate(T, stat_.blksize),
                    .blocks = @truncate(T, stat_.blocks),
                    .atime_ms = @truncate(T, if (stat_.atime > 0) (stat_.atime / std.time.ns_per_ms) else 0),
                    .mtime_ms = @truncate(T, if (stat_.mtime > 0) (stat_.mtime / std.time.ns_per_ms) else 0),
                    .ctime_ms = @truncate(T, if (stat_.ctime > 0) (stat_.ctime / std.time.ns_per_ms) else 0),
                    .atime = @truncate(T, stat_.atime),
                    .mtime = @truncate(T, stat_.mtime),
                    .ctime = @truncate(T, stat_.ctime),

                    .birthtime_ms = 0,
                    .birthtime = 0,
                };
            }
        };
    }

    pub const Stats = StatsLike(i32);
    pub const BigIntStats = StatsLike(i64);

    pub const DirEnt = struct { name: PathString };

    /// A class representing a directory stream.
    ///
    /// Created by {@link opendir}, {@link opendirSync}, or `fsPromises.opendir()`.
    ///
    /// ```js
    /// import { opendir } from 'fs/promises';
    ///
    /// try {
    ///   const dir = await opendir('./');
    ///   for await (const dirent of dir)
    ///     console.log(dirent.name);
    /// } catch (err) {
    ///   console.error(err);
    /// }
    /// ```
    ///
    /// When using the async iterator, the `fs.Dir` object will be automatically
    /// closed after the iterator exits.
    /// @since v12.12.0
    const Dir = struct {
        path: PathString,
    };

    pub const Return = struct {
        pub const Access = void;
        pub const AppendFile = void;
        pub const Close = void;
        pub const CopyFile = void;
        pub const Exists = bool;
        pub const Fchmod = void;
        pub const Chmod = void;
        pub const Fchown = void;
        pub const Fdatasync = void;
        pub const Fstat = Stats;
        pub const Fsync = void;
        pub const Ftruncate = void;
        pub const Futimes = void;
        pub const Lchmod = void;
        pub const Lchown = void;
        pub const Link = void;
        pub const Lstat = Stats;
        pub const Mkdir = string;
        pub const Mkdtemp = PathString;
        pub const Open = FileDescriptor;
        pub const Read = struct {
            bytes_read: u32,
            buffer: Buffer,
        };
        pub const Readdir = union(Tag) {
            with_file_types: []const DirEnt,
            files: []const PathOrBuffer,

            pub const Tag = enum {
                with_file_types,
                files,
            };
        };
        pub const ReadFile = StringOrBuffer;
        pub const Readlink = PathString;
        pub const Realpath = PathString;
        pub const RealpathNative = PathString;
        pub const Rename = void;
        pub const Rmdir = void;
        pub const Stat = Stats;
        pub const Symlink = void;
        pub const Truncate = void;
        pub const Unlink = void;
        pub const UnwatchFile = void;
        pub const Utimes = void;
        pub const Watch = void;
        pub const CreateReadStream = void;
        pub const CreateWriteStream = void;
    };

    pub fn access(_: *NodeFS, comptime _: Flavor, args: Arguments.Access) Maybe(Return.Access) {
        var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var path = args.path.sliceZ(&path_buf);
        if (system.access(path, @enumToInt(args.mode))) |bad| return bad;
        return Maybe(Return.Access).success;
    }

    pub fn appendFile(this: *NodeFS, comptime flavor: Flavor, args: Arguments.AppendFile) Maybe(Return.AppendFile) {
        var data = args.data.slice();

        switch (args.file) {
            .fd => |fd| {
                switch (comptime flavor) {
                    .sync => {
                        while (data.len > 0) {
                            const written = switch (Syscall.write(fd, data)) {
                                .result => |result| result,
                                else => |err| return .{ .err = err },
                            };
                            data = data[written..];
                        }

                        return Maybe(Return.AppendFile).success;
                    },
                    else => {
                        _ = this;
                        @compileError("Not implemented yet");
                    },
                }
            },
            .path => |path_| {
                const path = path_.slice();
                switch (comptime flavor) {
                    .sync => {
                        const fd = switch (Syscall.open(path, FileSystemFlags.@"a", 000666)) {
                            .result => |result| result,
                            else => |err| return .{ .err = err },
                        };

                        defer {
                            _ = Syscall.close(fd);
                        }

                        while (data.len > 0) {
                            const written = switch (Syscall.write(fd, data)) {
                                .result => |result| result,
                                else => |err| return .{ .err = err },
                            };
                            data = data[written..];
                        }

                        return Maybe(Return.AppendFile).success;
                    },
                    else => {
                        _ = this;
                        @compileError("Not implemented yet");
                    },
                }
            },
        }

        return Maybe(Return.AppendFile).todo;
    }

    pub fn close(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Close) Maybe(Return.Close) {
        switch (comptime flavor) {
            .sync => {
                return if (Syscall.close(args.fd)) |err| .{ .err = err } else Maybe(Return.Close).success;
            },
            else => {
                _ = this;
            },
        }

        return .{ .err = Syscall.Error.todo };
    }

    /// https://github.com/libuv/libuv/pull/2233
    /// https://github.com/pnpm/pnpm/issues/2761
    /// https://github.com/libuv/libuv/pull/2578
    /// https://github.com/nodejs/node/issues/34624
    pub fn copyFile(this: *NodeFS, comptime flavor: Flavor, args: Arguments.CopyFile) Maybe(Return.CopyFile) {
        const ret = Maybe(Return.CopyFile);

        switch (comptime flavor) {
            .sync => {
                var src_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                var dest_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                var src = args.src.sliceZ(&src_buf);
                var dest = args.dest.sliceZ(&dest_buf);

                if (comptime Environment.isMac) {
                    if (args.mode.isForceClone()) {
                        // https://www.manpagez.com/man/2/clonefile/
                        return ret.errno(C.clonefile(src, dest, 0)) orelse ret.success;
                    }

                    var mode: c_int = C.darwin.COPYFILE_ACL | C.darwin.COPYFILE_STAT | C.darwin.COPYFILE_XATTR | C.darwin.COPYFILE_DATA;
                    if (!args.mode.shouldOverwrite()) {
                        mode |= C.darwin.COPYFILE_EXCL;
                    }

                    return ret.errno(std.c.copyfile(src, dest, mode)) orelse ret.success;
                }

                if (comptime Environment.isLinux) {
                    const src_fd = linux.open(src, std.os.O.RDONLY, 0644);
                    if (ret.errno(src_fd)) |errno| return errno;
                    defer {
                        _ = Syscall.close(src_fd);
                    }

                    const stat_: linux.Stat = switch (Syscall.fstat(src_fd)) {
                        .result => |result| result,
                        else => |err| return Maybe(Return.CopyFile){ .err = err },
                    };

                    if (!os.S.ISREG(stat_.mode)) {
                        return Maybe(Return.CopyFile){ .err = .{ .errno = @enumToInt(os.E.NOTSUP) } };
                    }

                    var flags: Mode = std.os.O_CREAT | std.os.O_WRONLY | std.os.O_TRUNC;
                    if (!args.mode.shouldOverwrite()) {
                        flags |= std.os.O_EXCL;
                    }

                    const dest_fd = switch (Syscall.open(dest, flags, flags)) {
                        .result => |result| result,
                        else => |err| return Maybe(Return.CopyFile){ .err = err },
                    };
                    defer {
                        _ = Syscall.close(dest_fd);
                    }

                    var off_in_copy = @bitCast(i64, @as(u64, 0));
                    var off_out_copy = @bitCast(i64, @as(u64, 0));

                    // https://manpages.debian.org/testing/manpages-dev/ioctl_ficlone.2.en.html
                    if (args.mode.isForceClone()) {
                        return Maybe(Return.CopyFile).todo;
                    }

                    var size = stat_.size;
                    while (size > 0) {
                        // Linux Kernel 5.3 or later
                        const written = linux.copy_file_range(src_fd, &off_in_copy, dest_fd, &off_out_copy, size, 0);
                        if (ret.errno(written)) |err| return err;
                        // wrote zero bytes means EOF
                        if (written == 0) break;
                        size -= written;
                    }

                    return ret.success;
                }
            },
            else => {
                _ = args;
                _ = this;
                _ = flavor;
            },
        }

        return Maybe(Return.CopyFile).todo;
    }
    pub fn exists(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Exists) Maybe(Return.Exists) {
        const Ret = Maybe(Return.Exists);
        var path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        const path = args.path.sliceZ(&path_buf);
        switch (comptime flavor) {
            .sync => {
                // TODO: bench if faster to stat() or open() + close()
                // I imagine stat() is slower for directories and faster for files
                const fd = switch (Syscall.open(path, FileSystemFlags.@"r", 000666)) {
                    .result => |result| result,
                    else => |err| return switch (@intToEnum(std.os.E, err.err.errno)) {
                        .NOTFOUND => .{ .result = false },
                        else => .{ .err = err },
                    },
                };
                _ = Syscall.close(fd);

                return .{ .result = true };
            },
            else => {},
        }
        _ = args;
        _ = this;
        _ = flavor;
        return Ret.todo;
    }

    /// This should almost never be async
    pub fn chmod(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Chmod) Maybe(Return.Chmod) {
        var buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        const path = args.path.sliceZ(&buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Chmod).errno(C.chmod(path, args.mode)) orelse
                    Maybe(Return.Chmod).success;
            },
            else => {},
        }
        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Chmod).todo;
    }

    /// This should almost never be async
    pub fn fchmod(this: *NodeFS, comptime flavor: Flavor, args: Arguments.FChmod) Maybe(Return.Fchmod) {
        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Fchmod).errno(C.fchmod(args.fd, args.mode)) orelse
                    Maybe(Return.Fchmod).success;
            },
            else => {},
        }
        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Fchmod).todo;
    }
    pub fn fchown(this: *NodeFS, comptime flavor: Flavor, args: Arguments.FChown) !Maybe(Return.FChown) {
        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Fchown).errno(C.fchown(args.fd, args.uid, args.gid)) orelse
                    Maybe(Return.Fchown).success;
            },
            else => {},
        }
        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Fchown).todo;
    }
    pub fn fdatasync(this: *NodeFS, comptime flavor: Flavor, args: Arguments.FDataSync) Maybe(Return.FDataSync) {
        switch (comptime flavor) {
            .sync => return Maybe(Return.Fdatasync).errno(system.fdatasync(args.fd)) orelse
                Maybe(Return.Fdatasync).success,
            else => {},
        }

        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.FDataSync).todo;
    }
    pub fn fstat(this: *NodeFS, comptime flavor: Flavor, args: Arguments.FStat) Maybe(Return.Fstat) {
        if (args.big_int) return Maybe(Return.Fstat).todo;

        switch (comptime flavor) {
            .sync => {
                const stat_: os.Stat = switch (Syscall.fstat(args.fd)) {
                    .result => |result| result,
                    else => |err| return Maybe(Return.Fstat){ .err = err },
                };

                return Maybe(Return.Fstat){ .result = Stats.init(stat_) };
            },
            else => {},
        }

        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Fstat).todo;
    }

    pub fn fsync(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Fsync) Maybe(Return.Fsync) {
        switch (comptime flavor) {
            .sync => return Maybe(Return.Fsync).errno(system.fsync(args.fd)) orelse
                Maybe(Return.Fsync).success,
            else => {},
        }

        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Fsync).todo;
    }

    pub fn ftruncate(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Ftruncate) Maybe(Return.Ftruncate) {
        switch (comptime flavor) {
            .sync => return Maybe(Return.Ftruncate).errno(system.ftruncate(args.fd)) orelse
                Maybe(Return.Ftruncate).success,
            else => {},
        }

        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Ftruncate).todo;
    }
    pub fn futimes(this: *NodeFS, comptime flavor: Flavor, args: Arguments.FUTimes) Maybe(Return.Futimes) {
        var times = [2]std.os.timespec{
            .{
                .tv_sec = args.mtime,
                .tv_nsec = 0,
            },
            .{
                .tv_sec = args.atime,
                .tv_nsec = 0,
            },
        };

        switch (comptime flavor) {
            .sync => return switch (Maybe(Return.Fstat).errno(system.futimens(args.fd, &times))) {
                .err => |err| err,
                else => Maybe(Return.Futimes).success,
            },
            else => {},
        }

        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Fstat).todo;
    }

    pub fn lchmod(this: *NodeFS, comptime flavor: Flavor, args: Arguments.LCHmod) Maybe(Return.Lchmod) {
        var buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        const path = args.path.sliceZ(&buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Lchmod).errno(C.lchmod(path, args.mode)) orelse
                    Maybe(Return.Lchmod).success;
            },
            else => {},
        }
        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Lchmod).todo;
    }

    pub fn lchown(this: *NodeFS, comptime flavor: Flavor, args: Arguments.LChown) Maybe(Return.Lchown) {
        var buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        const path = args.path.sliceZ(&buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Lchown).errno(C.lchown(path, args.uid, args.gid)) orelse
                    Maybe(Return.Lchown).success;
            },
            else => {},
        }
        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Lchown).todo;
    }
    pub fn link(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Link) Maybe(Return.Link) {
        var from_path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var to_path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        const from = args.old_path.sliceZ(&from_path_buf);
        const to = args.old_path.sliceZ(&to_path_buf);

        switch (comptime flavor) {
            .sync => {
                return Maybe(Return.Link).errno(system.link(from, to, 0)) orelse
                    Maybe(Return.Link).success;
            },
            else => {},
        }

        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Link).todo;
    }
    pub fn lstat(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Lstat) Maybe(Return.Lstat) {
        if (args.big_int) return Maybe(Return.Lstat).todo;

        switch (comptime flavor) {
            .sync => {
                const stat_: os.Stat = switch (Syscall.lstat(args.fd)) {
                    .result => |result| result,
                    else => |err| return Maybe(Return.Lstat){ .err = err },
                };

                return Maybe(Return.Lstat){ .result = Stats.init(stat_) };
            },
            else => {},
        }

        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Lstat).todo;
    }

    // Node doesn't absolute the path so we don't have to either
    pub fn mkdirNonRecursive(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Mkdir) Maybe(Return.Mkdir) {
        switch (comptime flavor) {
            .sync => {
                var buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                const path = args.path.sliceZ(&buf);
                if (Maybe(Return.Mkdir).errno(system.mkdir(path, args.mode))) |err| {
                    return switch (err.getErrno()) {
                        .EXIST => Maybe(Return.Mkdir){ .result = "" },
                        else => .{ .err = err.err },
                    };
                }

                return Maybe(Return.Mkdir){ .result = args.path.slice() };
            },
            else => {},
        }
        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Mkdir).todo;
    }

    // TODO: windows
    // TODO: verify this works correctly with unicode codepoints
    pub fn mkdirRecursive(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Mkdir) Maybe(Return.Mkdir) {
        switch (comptime flavor) {
            // The sync version does no allocation except when returning the path
            .sync => {
                var buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                const path = args.path.sliceZWithForceCopy(&buf, true);
                const len = path.len;
                // First, attempt to create the desired directory
                // If that fails, then walk back up the path until we have a match
                if (Maybe(Return.Mkdir).errno(system.mkdir(path, args.mode))) |err| {
                    switch (err.getErrno()) {
                        .EXIST => return Maybe(Return.Mkdir){ .result = "" },
                        else => return .{ .err = err },

                        // continue
                        .NOENT => {},
                    }
                } else {
                    return Maybe(Return.Mkdir){ .result = args.path.slice() };
                }

                var working_mem: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                @memcpy(&working_mem, path, len);

                if (comptime Environment.isWindows) @compileError("This needs to be implemented on Windows.");
                var i: usize = len - 1;

                // iterate backwards until creating the directory works successfully
                while (i > 0) : (i -= 1) {
                    if (path[i] == std.fs.path.sep) {
                        working_mem[i] = 0;
                        var parent: [:0]u8 = working_mem[0 .. i - 1 :0];

                        if (Maybe(Return.Mkdir).errno(system.mkdir(parent, args.mode))) |err| {
                            working_mem[i] = std.fs.path.sep;
                            switch (err.getErrno()) {
                                .EXIST => {
                                    break;
                                },
                                .NOENT => {
                                    continue;
                                },
                                else => return .{ .err = err },
                            }
                        } else {
                            working_mem[i] = std.fs.path.sep;
                            break;
                        }
                    }
                }
                var first_match: u16 = i;
                i += 1;
                // after we find one that works, we go forward _after_ the first working directory
                while (i < len) : (i += 1) {
                    if (path[i] == std.fs.path.sep) {
                        working_mem[i] = 0;
                        var parent: [:0]u8 = working_mem[0 .. i - 1 :0];

                        if (Maybe(Return.Mkdir).errno(system.mkdir(parent, args.mode))) |err| {
                            working_mem[i] = std.fs.path.sep;
                            switch (err.getErrno()) {
                                .EXIST => {
                                    std.debug.assert(false);
                                    continue;
                                },
                                else => return .{ .err = err },
                            }
                        } else {
                            working_mem[i] = std.fs.path.sep;
                            break;
                        }
                    }
                }

                first_match = @truncate(u16, i);
                // Our final directory will not have a trailing separator
                // so we have to create it once again
                if (Maybe(Return.Mkdir).errno(system.mkdir(path, args.mode))) |err| {
                    switch (err.getErrno()) {
                        // handle the race condition
                        .EXIST => {
                            var display_path: []const u8 = "";
                            if (first_match != std.math.maxInt(u16)) {
                                // TODO: this leaks memory
                                display_path = _global.default_allocator.dupe(u8, display_path[0..first_match]) catch unreachable;
                            }
                            return Maybe(Return.Mkdir){ .result = display_path };
                        },

                        // NOENT shouldn't happen here
                        else => return .{ .err = err },
                    }
                } else {
                    var display_path = args.path.slice();
                    if (first_match != std.math.maxInt(u16)) {
                        // TODO: this leaks memory
                        display_path = _global.default_allocator.dupe(u8, display_path[0..first_match]) catch unreachable;
                    }
                    return Maybe(Return.Mkdir){ .result = display_path };
                }
            },
            else => {},
        }

        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Mkdir).todo;
    }

    pub fn mkdtemp(this: *NodeFS, comptime flavor: Flavor, args: Arguments.MkdirTemp) Maybe(Return.Mkdtemp) {
        var prefix_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        prefix_buf[0] = 0;
        const len = args.prefix.len;
        if (len > 0) {
            @memcpy(&prefix_buf, args.prefix.ptr, len);
            prefix_buf[len] = 0;
        }

        const rc = C.mkdtemp(&prefix_buf);
        if (std.c.getErrno(rc)) |errno| {
            return .{ .err = Syscall.Error{ .errno = errno, .syscall = .mkdtemp } };
        }
        var prefix: [:0]u8 = std.mem.sliceTo(&prefix_buf, 0);
        _ = this;
        _ = flavor;
        return .{
            .result = _global.default_allocator.dupe(u8, prefix) catch unreachable,
        };
    }
    pub fn open(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Open) Maybe(Return.Open) {
        switch (comptime flavor) {
            // The sync version does no allocation except when returning the path
            .sync => {
                var buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
                const path = args.path.sliceZ(&buf);
                return switch (Syscall.open(path, @enumToInt(args.flags), args.mode)) {
                    .err => |err| .{
                        .err = .{ .err = err.withPath(args.path.slice()) },
                    },
                    .result => |fd| .{ .result = fd },
                };
            },
            else => {},
        }

        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.Open).todo;
    }
    pub fn openDir(this: *NodeFS, comptime flavor: Flavor, args: Arguments.OpenDir) Maybe(Return.OpenDir) {
        _ = args;
        _ = this;
        _ = flavor;
        return Maybe(Return.OpenDir).todo;
    }

    pub fn read(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Read) Maybe(Return.Read) {
        _ = args;
        _ = this;
        _ = flavor;
        std.debug.assert(args.position == null);

        switch (comptime flavor) {
            // The sync version does no allocation except when returning the path
            .sync => {
                var buf = args.buffer.buffer.slice()[args.offset..];
                if (buf.len == 0 or buf.len < args.length) {
                    return .{ .result = 0 };
                }
                buf = buf[0..args.length];
                var total: usize = 0;
                while (buf.len > 0) {
                    switch (Syscall.read(args.fd, buf)) {
                        .err => |err| return .{
                            .err = .{ .err = err },
                        },
                        .result => |amt| {
                            total += amt;
                            buf = buf[@minimum(amt, buf.len)..];
                            if (amt == 0) {
                                break;
                            }
                        },
                    }
                }

                return .{ .result = total };
            },
            else => {},
        }

        return Maybe(Return.Read).todo;
    }

    pub fn pread(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Read) Maybe(Return.Read) {
        _ = args;
        _ = this;
        _ = flavor;

        const position = args.position.?;

        switch (comptime flavor) {
            .sync => {
                var buf = args.buffer.buffer.slice()[args.offset..];
                if (buf.len == 0 or buf.len < args.length) {
                    return .{ .result = 0 };
                }
                buf = buf[0..args.length];
                var total: usize = 0;
                while (buf.len > 0) {
                    switch (Syscall.pread(args.fd, buf, position)) {
                        .err => |err| return .{
                            .err = .{ .err = err },
                        },
                        .result => |amt| {
                            total += amt;
                            buf = buf[@minimum(amt, buf.len)..];
                            if (amt == 0) {
                                break;
                            }
                        },
                    }
                }

                return .{ .result = total };
            },
            else => {},
        }

        return Maybe(Return.Read).todo;
    }

    pub fn readdir(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Readdir) Maybe(Return.Readdir) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn readFile(this: *NodeFS, comptime flavor: Flavor, args: Arguments.ReadFile) Maybe(Return.ReadFile) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn readlink(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Readlink) Maybe(Return.Readlink) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn realpath(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Realpath) Maybe(Return.Realpath) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn realpathNative(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Realpath) Maybe(Return.Realpath) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn rename(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Rename) Maybe(Return.Rename) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn rmdir(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Rmdir) Maybe(Return.Rmdir) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn stat(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Stat) Maybe(Return.Stat) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn symlink(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Symlink) Maybe(Return.Symlink) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn truncate(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Truncate) Maybe(Return.Truncate) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn unlink(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Unlink) Maybe(Return.Unlink) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn unwatchFile(this: *NodeFS, comptime flavor: Flavor, args: Arguments.UnwatchFile) Maybe(Return.UnwatchFile) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn utimes(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Utimes) Maybe(Return.Utimes) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn watch(this: *NodeFS, comptime flavor: Flavor, args: Arguments.Watch) Maybe(Return.Watch) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn createReadStream(this: *NodeFS, comptime flavor: Flavor, args: Arguments.CreateReadStream) Maybe(Return.CreateReadStream) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
    pub fn createWriteStream(this: *NodeFS, comptime flavor: Flavor, args: Arguments.CreateWriteStream) Maybe(Return.CreateWriteStream) {
        _ = args;
        _ = this;
        _ = flavor;
        return error.NotImplementedYet;
    }
};
