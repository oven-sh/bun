const OutputFile = @This();

// Instead of keeping files in-memory, we:
// 1. Write directly to disk
// 2. (Optional) move the file to the destination
// This saves us from allocating a buffer

loader: Loader,
input_loader: Loader = .js,
src_path: Fs.Path,
value: Value,
size: usize = 0,
size_without_sourcemap: usize = 0,
hash: u64 = 0,
is_executable: bool = false,
source_map_index: u32 = std.math.maxInt(u32),
bytecode_index: u32 = std.math.maxInt(u32),
module_info_index: u32 = std.math.maxInt(u32),
output_kind: jsc.API.BuildArtifact.OutputKind,
/// Relative
dest_path: []const u8 = "",
side: ?bun.bake.Side,
/// This is only set for the JS bundle, and not files associated with an
/// entrypoint like sourcemaps and bytecode
entry_point_index: ?u32,
referenced_css_chunks: []const Index = &.{},
source_index: Index.Optional = .none,
bake_extra: BakeExtra = .{},

pub const zero_value = OutputFile{
    .loader = .file,
    .src_path = Fs.Path.init(""),
    .value = .noop,
    .output_kind = .chunk,
    .side = null,
    .entry_point_index = null,
};

pub const BakeExtra = struct {
    is_route: bool = false,
    fully_static: bool = false,
    bake_is_runtime: bool = false,
};

pub const Index = bun.GenericIndex(u32, OutputFile);

pub fn deinit(this: *OutputFile) void {
    this.value.deinit();

    bun.default_allocator.free(this.src_path.text);
    bun.default_allocator.free(this.dest_path);
    bun.default_allocator.free(this.referenced_css_chunks);
}

// Depending on:
// - The target
// - The number of open file handles
// - Whether or not a file of the same name exists
// We may use a different system call
pub const FileOperation = struct {
    pathname: string,
    fd: FileDescriptorType = bun.invalid_fd,
    dir: FileDescriptorType = bun.invalid_fd,
    is_tmpdir: bool = false,
    is_outdir: bool = false,
    close_handle_on_complete: bool = false,
    autowatch: bool = true,

    pub fn fromFile(fd: bun.FD, pathname: string) FileOperation {
        return .{
            .fd = fd,
            .pathname = pathname,
        };
    }

    pub fn getPathname(file: *const FileOperation) string {
        if (file.is_tmpdir) {
            return resolve_path.joinAbs(Fs.FileSystem.RealFS.tmpdirPath(), .auto, file.pathname);
        } else {
            return file.pathname;
        }
    }
};

pub const Kind = enum {
    move,
    copy,
    noop,
    buffer,
    pending,
    saved,
};

// TODO: document how and why all variants of this union(enum) are used,
// specifically .move and .copy; the new bundler has to load files in memory
// in order to hash them, so i think it uses .buffer for those
pub const Value = union(Kind) {
    move: FileOperation,
    copy: FileOperation,
    noop: u0,
    buffer: struct {
        allocator: std.mem.Allocator,
        bytes: []const u8,
    },
    pending: resolver.Result,
    saved: SavedFile,

    pub fn deinit(this: *Value) void {
        switch (this.*) {
            .buffer => |buf| {
                buf.allocator.free(buf.bytes);
            },
            .saved => {},
            .move => {},
            .copy => {},
            .noop => {},
            .pending => {},
        }
    }

    pub fn asSlice(v: Value) []const u8 {
        return switch (v) {
            .buffer => |buf| buf.bytes,
            else => "",
        };
    }

    pub fn toBunString(v: Value) bun.String {
        return switch (v) {
            .noop => bun.String.empty,
            .buffer => |buf| {
                // Use ExternalStringImpl to avoid cloning the string, at
                // the cost of allocating space to remember the allocator.
                const FreeContext = struct {
                    allocator: std.mem.Allocator,

                    fn onFree(ctx: *@This(), buffer: *anyopaque, len: u32) callconv(.c) void {
                        ctx.allocator.free(@as([*]u8, @ptrCast(buffer))[0..len]);
                        bun.destroy(ctx);
                    }
                };
                return bun.String.createExternal(
                    *FreeContext,
                    buf.bytes,
                    true,
                    bun.new(FreeContext, .{ .allocator = buf.allocator }),
                    FreeContext.onFree,
                );
            },
            .pending => unreachable,
            else => |tag| bun.todoPanic(@src(), "handle .{s}", .{@tagName(tag)}),
        };
    }
};

pub const SavedFile = @import("../bundler_jsc/output_file_jsc.zig").SavedFile;

pub fn initPending(loader: Loader, pending: resolver.Result) OutputFile {
    return .{
        .loader = loader,
        .src_path = pending.pathConst().?.*,
        .size = 0,
        .value = .{ .pending = pending },
    };
}

pub fn initFile(file: std.fs.File, pathname: string, size: usize) OutputFile {
    return .{
        .loader = .file,
        .src_path = Fs.Path.init(pathname),
        .size = size,
        .value = .{ .copy = FileOperation.fromFile(file.handle, pathname) },
    };
}

pub fn initFileWithDir(file: std.fs.File, pathname: string, size: usize, dir: std.fs.Dir) OutputFile {
    var res = initFile(file, pathname, size);
    res.value.copy.dir_handle = .fromStdDir(dir);
    return res;
}

pub const Options = struct {
    loader: Loader,
    input_loader: Loader,
    hash: ?u64 = null,
    source_map_index: ?u32 = null,
    bytecode_index: ?u32 = null,
    module_info_index: ?u32 = null,
    output_path: string,
    source_index: Index.Optional = .none,
    size: ?usize = null,
    input_path: []const u8 = "",
    display_size: u32 = 0,
    output_kind: jsc.API.BuildArtifact.OutputKind,
    is_executable: bool,
    data: union(enum) {
        buffer: struct {
            allocator: std.mem.Allocator,
            data: []const u8,
        },
        file: struct {
            file: std.fs.File,
            size: usize,
            dir: std.fs.Dir,
        },
        saved: usize,
    },
    side: ?bun.bake.Side,
    entry_point_index: ?u32,
    referenced_css_chunks: []const Index = &.{},
    bake_extra: BakeExtra = .{},
};

pub fn init(options: Options) OutputFile {
    return .{
        .loader = options.loader,
        .input_loader = options.input_loader,
        .src_path = Fs.Path.init(options.input_path),
        .dest_path = options.output_path,
        .source_index = options.source_index,
        .size = options.size orelse switch (options.data) {
            .buffer => |buf| buf.data.len,
            .file => |file| file.size,
            .saved => 0,
        },
        .size_without_sourcemap = options.display_size,
        .hash = options.hash orelse 0,
        .output_kind = options.output_kind,
        .bytecode_index = options.bytecode_index orelse std.math.maxInt(u32),
        .module_info_index = options.module_info_index orelse std.math.maxInt(u32),
        .source_map_index = options.source_map_index orelse std.math.maxInt(u32),
        .is_executable = options.is_executable,
        .value = switch (options.data) {
            .buffer => |buffer| Value{ .buffer = .{ .allocator = buffer.allocator, .bytes = buffer.data } },
            .file => |file| Value{
                .copy = brk: {
                    var op = FileOperation.fromFile(.fromStdFile(file.file), options.output_path);
                    op.dir = .fromStdDir(file.dir);
                    break :brk op;
                },
            },
            .saved => Value{ .saved = .{} },
        },
        .side = options.side,
        .entry_point_index = options.entry_point_index,
        .referenced_css_chunks = options.referenced_css_chunks,
        .bake_extra = options.bake_extra,
    };
}

pub fn writeToDisk(f: OutputFile, root_dir: std.fs.Dir, root_dir_path: []const u8) !void {
    switch (f.value) {
        .noop => {},
        .saved => {
            // already written to disk
        },
        .buffer => |value| {
            var rel_path = f.dest_path;
            if (f.dest_path.len > root_dir_path.len) {
                rel_path = resolve_path.relative(root_dir_path, f.dest_path);
                if (std.fs.path.dirname(rel_path)) |parent| {
                    if (parent.len > root_dir_path.len) {
                        try root_dir.makePath(parent);
                    }
                }
            }

            var path_buf: bun.PathBuffer = undefined;
            _ = try jsc.Node.fs.NodeFS.writeFileWithPathBuffer(&path_buf, .{
                .data = .{ .buffer = .{
                    .buffer = .{
                        .ptr = @constCast(value.bytes.ptr),
                        .len = value.bytes.len,
                        .byte_len = value.bytes.len,
                    },
                } },
                .encoding = .buffer,
                .mode = if (f.is_executable) 0o755 else 0o644,
                .dirfd = .fromStdDir(root_dir),
                .file = .{ .path = .{
                    .string = bun.PathString.init(rel_path),
                } },
            }).unwrap();
        },
        .move => |value| {
            try f.moveTo(root_dir_path, value.pathname, .fromStdDir(root_dir));
        },
        .copy => |value| {
            try f.copyTo(root_dir_path, value.pathname, .fromStdDir(root_dir));
        },
        .pending => unreachable,
    }
}

pub fn moveTo(file: *const OutputFile, _: string, rel_path: []const u8, dir: FileDescriptorType) !void {
    try bun.sys.moveFileZ(file.value.move.dir, bun.sliceTo(&(try std.posix.toPosixPath(file.value.move.getPathname())), 0), dir, bun.sliceTo(&(try std.posix.toPosixPath(rel_path)), 0));
}

pub fn copyTo(file: *const OutputFile, _: string, rel_path: []const u8, dir: FileDescriptorType) !void {
    const fd_out = bun.FD.fromStdFile(try dir.stdDir().createFile(rel_path, .{}));
    var do_close = false;
    const fd_in = bun.FD.fromStdFile(try std.fs.cwd().openFile(file.src_path.text, .{ .mode = .read_only }));

    if (Environment.isWindows) {
        do_close = Fs.FileSystem.instance.fs.needToCloseFiles();

        // use paths instead of bun.getFdPathW()
        @panic("TODO windows");
    }

    defer {
        if (do_close) {
            fd_out.close();
            fd_in.close();
        }
    }

    try bun.copyFile(fd_in, fd_out).unwrap();
}

pub const toJS = @import("../bundler_jsc/output_file_jsc.zig").toJS;

pub const toBlob = @import("../bundler_jsc/output_file_jsc.zig").toBlob;

const string = []const u8;

const resolve_path = @import("../paths/resolve_path.zig");
const resolver = @import("../resolver/resolver.zig");
const std = @import("std");
const Loader = @import("./options.zig").Loader;

const bun = @import("bun");
const Environment = bun.Environment;
const FileDescriptorType = bun.FD;
const Fs = bun.fs;
const jsc = bun.jsc;
