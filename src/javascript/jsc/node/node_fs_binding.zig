const JSC = @import("javascript_core");
const NodeFS = @import("./node_fs.zig").NodeFS;
const std = @import("std");
const Flavor = @import("./types.zig").Flavor;
const system = std.os.system;
const Maybe = @import("./types.zig").Maybe;
const Encoding = @import("./types.zig").Encoding;
const Syscall = @import("./syscall.zig");

pub const Class = JSC.NewClass(
    NodeFS,
    .{ .name = "fs" },
    .{},
    .{
        .appendFile = .{
            .name = "appendFile",
            .rfn = NodeFS.Binding.appendFile,
        },
        .appendFileSync = .{
            .name = "appendFileSync",
            .rfn = NodeFS.Binding.appendFileSync,
        },
        .close = .{
            .name = "close",
            .rfn = NodeFS.Binding.close,
        },
        .closeSync = .{
            .name = "closeSync",
            .rfn = NodeFS.Binding.closeSync,
        },
        .copyFile = .{
            .name = "copyFile",
            .rfn = NodeFS.Binding.copyFile,
        },
        .copyFileSync = .{
            .name = "copyFileSync",
            .rfn = NodeFS.Binding.copyFileSync,
        },
        .exists = .{
            .name = "exists",
            .rfn = NodeFS.Binding.exists,
        },
        .existsSync = .{
            .name = "existsSync",
            .rfn = NodeFS.Binding.existsSync,
        },
        .fchmod = .{
            .name = "fchmod",
            .rfn = NodeFS.Binding.fchmod,
        },
        .fchmodSync = .{
            .name = "fchmodSync",
            .rfn = NodeFS.Binding.fchmodSync,
        },
        .fchown = .{
            .name = "fchown",
            .rfn = NodeFS.Binding.fchown,
        },
        .fchownSync = .{
            .name = "fchownSync",
            .rfn = NodeFS.Binding.fchownSync,
        },
        .fdatasync = .{
            .name = "fdatasync",
            .rfn = NodeFS.Binding.fdatasync,
        },
        .fdatasyncSync = .{
            .name = "fdatasyncSync",
            .rfn = NodeFS.Binding.fdatasyncSync,
        },
        .fstat = .{
            .name = "fstat",
            .rfn = NodeFS.Binding.fstat,
        },
        .fstatSync = .{
            .name = "fstatSync",
            .rfn = NodeFS.Binding.fstatSync,
        },
        .fsync = .{
            .name = "fsync",
            .rfn = NodeFS.Binding.fsync,
        },
        .fsyncSync = .{
            .name = "fsyncSync",
            .rfn = NodeFS.Binding.fsyncSync,
        },
        .ftruncate = .{
            .name = "ftruncate",
            .rfn = NodeFS.Binding.ftruncate,
        },
        .ftruncateSync = .{
            .name = "ftruncateSync",
            .rfn = NodeFS.Binding.ftruncateSync,
        },
        .futimes = .{
            .name = "futimes",
            .rfn = NodeFS.Binding.futimes,
        },
        .futimesSync = .{
            .name = "futimesSync",
            .rfn = NodeFS.Binding.futimesSync,
        },
        .lchmod = .{
            .name = "lchmod",
            .rfn = NodeFS.Binding.lchmod,
        },
        .lchmodSync = .{
            .name = "lchmodSync",
            .rfn = NodeFS.Binding.lchmodSync,
        },
        .lchown = .{
            .name = "lchown",
            .rfn = NodeFS.Binding.lchown,
        },
        .lchownSync = .{
            .name = "lchownSync",
            .rfn = NodeFS.Binding.lchownSync,
        },
        .link = .{
            .name = "link",
            .rfn = NodeFS.Binding.link,
        },
        .linkSync = .{
            .name = "linkSync",
            .rfn = NodeFS.Binding.linkSync,
        },
        .lstat = .{
            .name = "lstat",
            .rfn = NodeFS.Binding.lstat,
        },
        .lstatSync = .{
            .name = "lstatSync",
            .rfn = NodeFS.Binding.lstatSync,
        },
        .mkdir = .{
            .name = "mkdir",
            .rfn = NodeFS.Binding.mkdir,
        },
        .mkdirSync = .{
            .name = "mkdirSync",
            .rfn = NodeFS.Binding.mkdirSync,
        },
        .mkdtemp = .{
            .name = "mkdtemp",
            .rfn = NodeFS.Binding.mkdtemp,
        },
        .mkdtempSync = .{
            .name = "mkdtempSync",
            .rfn = NodeFS.Binding.mkdtempSync,
        },
        .open = .{
            .name = "open",
            .rfn = NodeFS.Binding.open,
        },
        .openSync = .{
            .name = "openSync",
            .rfn = NodeFS.Binding.openSync,
        },
        .openDir = .{
            .name = "openDir",
            .rfn = NodeFS.Binding.openDir,
        },
        .openDirSync = .{
            .name = "openDirSync",
            .rfn = NodeFS.Binding.openDirSync,
        },
        .read = .{
            .name = "read",
            .rfn = NodeFS.Binding.read,
        },
        .readSync = .{
            .name = "readSync",
            .rfn = NodeFS.Binding.readSync,
        },
        .readdir = .{
            .name = "readdir",
            .rfn = NodeFS.Binding.readdir,
        },
        .readdirSync = .{
            .name = "readdirSync",
            .rfn = NodeFS.Binding.readdirSync,
        },
        .readFile = .{
            .name = "readFile",
            .rfn = NodeFS.Binding.readFile,
        },
        .readFileSync = .{
            .name = "readFileSync",
            .rfn = NodeFS.Binding.readFileSync,
        },
        .readlink = .{
            .name = "readlink",
            .rfn = NodeFS.Binding.readlink,
        },
        .readlinkSync = .{
            .name = "readlinkSync",
            .rfn = NodeFS.Binding.readlinkSync,
        },
        .realpath = .{
            .name = "realpath",
            .rfn = NodeFS.Binding.realpath,
        },
        .realpathSync = .{
            .name = "realpathSync",
            .rfn = NodeFS.Binding.realpathSync,
        },
        .realpathNative = .{
            .name = "realpathNative",
            .rfn = NodeFS.Binding.realpathNative,
        },
        .realpathNativeSync = .{
            .name = "realpathNativeSync",
            .rfn = NodeFS.Binding.realpathNativeSync,
        },
        .rename = .{
            .name = "rename",
            .rfn = NodeFS.Binding.rename,
        },
        .renameSync = .{
            .name = "renameSync",
            .rfn = NodeFS.Binding.renameSync,
        },
        .rmdir = .{
            .name = "rmdir",
            .rfn = NodeFS.Binding.rmdir,
        },
        .rmdirSync = .{
            .name = "rmdirSync",
            .rfn = NodeFS.Binding.rmdirSync,
        },
        .stat = .{
            .name = "stat",
            .rfn = NodeFS.Binding.stat,
        },
        .statSync = .{
            .name = "statSync",
            .rfn = NodeFS.Binding.statSync,
        },
        .symlink = .{
            .name = "symlink",
            .rfn = NodeFS.Binding.symlink,
        },
        .symlinkSync = .{
            .name = "symlinkSync",
            .rfn = NodeFS.Binding.symlinkSync,
        },
        .truncate = .{
            .name = "truncate",
            .rfn = NodeFS.Binding.truncate,
        },
        .truncateSync = .{
            .name = "truncateSync",
            .rfn = NodeFS.Binding.truncateSync,
        },
        .unlink = .{
            .name = "unlink",
            .rfn = NodeFS.Binding.unlink,
        },
        .unlinkSync = .{
            .name = "unlinkSync",
            .rfn = NodeFS.Binding.unlinkSync,
        },
        .unwatchFile = .{
            .name = "unwatchFile",
            .rfn = NodeFS.Binding.unwatchFile,
        },
        .unwatchFileSync = .{
            .name = "unwatchFileSync",
            .rfn = NodeFS.Binding.unwatchFileSync,
        },
        .utimes = .{
            .name = "utimes",
            .rfn = NodeFS.Binding.utimes,
        },
        .utimesSync = .{
            .name = "utimesSync",
            .rfn = NodeFS.Binding.utimesSync,
        },
        .watch = .{
            .name = "watch",
            .rfn = NodeFS.Binding.watch,
        },
        .watchSync = .{
            .name = "watchSync",
            .rfn = NodeFS.Binding.watchSync,
        },
        .createReadStream = .{
            .name = "createReadStream",
            .rfn = NodeFS.Binding.createReadStream,
        },
        .createReadStreamSync = .{
            .name = "createReadStreamSync",
            .rfn = NodeFS.Binding.createReadStreamSync,
        },
        .createWriteStream = .{
            .name = "createWriteStream",
            .rfn = NodeFS.Binding.createWriteStream,
        },
        .createWriteStreamSync = .{
            .name = "createWriteStreamSync",
            .rfn = NodeFS.Binding.createWriteStreamSync,
        },
    },
);

pub fn appendFile(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn appendFileSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn close(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn closeSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn copyFile(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn copyFileSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn exists(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn existsSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fchmod(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fchmodSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fchown(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fchownSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fdatasync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fdatasyncSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fstat(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fstatSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fsync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn fsyncSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn ftruncate(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn ftruncateSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn futimes(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn futimesSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn lchmod(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn lchmodSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn lchown(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn lchownSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn link(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn linkSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn lstat(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn lstatSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn mkdir(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn mkdirSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn mkdtemp(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn mkdtempSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn open(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn openSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn openDir(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn openDirSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn read(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn readSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn readdir(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn readdirSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn readFile(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn readFileSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn readlink(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn readlinkSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn realpath(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn realpathSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn realpathNative(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn realpathNativeSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn rename(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn renameSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn rmdir(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn rmdirSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn stat(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn statSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn symlink(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn symlinkSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn truncate(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn truncateSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn unlink(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn unlinkSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn unwatchFile(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn unwatchFileSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn utimes(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn utimesSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn watch(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn watchSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn createReadStream(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn createReadStreamSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn createWriteStream(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = arguments;
    _ = exception;
}
pub fn createWriteStreamSync(
    this: *NodeFS,
    ctx: JSC.C.JSContextRef,
    _: JSC.C.JSObjectRef,
    _: JSC.C.JSObjectRef,
    arguments: []const JSC.C.JSValueRef,
    exception: JSC.C.ExceptionRef,
) JSC.C.JSValueRef {
    _ = ctx;
    _ = this;
    _ = exception;
    _ = arguments;
}
