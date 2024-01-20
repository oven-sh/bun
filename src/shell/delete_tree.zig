//! Modified version of `std.fs.deleteTree`:
//! - nonsense instances of `unreachable` removed
//! - uses Bun's DirIterator
//! - can pass a Context which allows you to inspect which files/directories have been deleted (needed for shell's implementation of rm with verbose flag)
const std = @import("std");
const os = std.os;

const bun = @import("root").bun;
const DirIterator = @import("../bun.js/node/dir_iterator.zig");
const Maybe = @import("../bun.js/node/types.zig").Maybe;
const Syscall = @import("../sys.zig");

pub const DeleteTreeError = error{
    InvalidHandle,
    AccessDenied,
    FileTooBig,
    SymLinkLoop,
    ProcessFdQuotaExceeded,
    NameTooLong,
    SystemFdQuotaExceeded,
    NoDevice,
    SystemResources,
    ReadOnlyFileSystem,
    FileSystem,
    FileBusy,
    DeviceBusy,

    /// One of the path components was not a directory.
    /// This error is unreachable if `sub_path` does not contain a path separator.
    NotDir,

    /// On Windows, file paths must be valid Unicode.
    InvalidUtf8,

    /// On Windows, file paths cannot contain these characters:
    /// '/', '*', '?', '"', '<', '>', '|'
    BadPathName,

    /// On Windows, `\\server` or `\\server\share` was not found.
    NetworkNotFound,
} || os.UnexpectedError;
