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
output_kind: JSC.API.BuildArtifact.OutputKind,
/// Relative
dest_path: []const u8 = "",
side: ?bun.bake.Side,
/// This is only set for the JS bundle, and not files associated with an
/// entrypoint like sourcemaps and bytecode
entry_point_index: ?u32,
referenced_css_files: []const Index = &.{},
source_index: Index.Optional = .none,

pub const Index = bun.GenericIndex(u32, OutputFile);

pub fn deinit(this: *OutputFile) void {
    this.value.deinit();

    bun.default_allocator.free(this.src_path.text);
    bun.default_allocator.free(this.dest_path);
    bun.default_allocator.free(this.referenced_css_files);
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
            return resolve_path.joinAbs(@TypeOf(Fs.FileSystem.instance.fs).tmpdir_path, .auto, file.pathname);
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

    pub fn toBunString(v: Value) bun.String {
        return switch (v) {
            .noop => bun.String.empty,
            .buffer => |buf| {
                // Use ExternalStringImpl to avoid cloning the string, at
                // the cost of allocating space to remember the allocator.
                const FreeContext = struct {
                    allocator: std.mem.Allocator,

                    fn onFree(ctx: *@This(), buffer: *anyopaque, len: u32) callconv(.C) void {
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

pub const SavedFile = struct {
    pub fn toJS(
        globalThis: *JSC.JSGlobalObject,
        path: []const u8,
        byte_size: usize,
    ) JSC.JSValue {
        const mime_type = globalThis.bunVM().mimeType(path);
        const store = JSC.WebCore.Blob.Store.initFile(
            JSC.Node.PathOrFileDescriptor{
                .path = JSC.Node.PathLike{
                    .string = bun.PathString.init(path),
                },
            },
            mime_type,
            bun.default_allocator,
        ) catch unreachable;

        var blob = bun.default_allocator.create(JSC.WebCore.Blob) catch unreachable;
        blob.* = JSC.WebCore.Blob.initWithStore(store, globalThis);
        if (mime_type) |mime| {
            blob.content_type = mime.value;
        }
        blob.size = @as(JSC.WebCore.Blob.SizeType, @truncate(byte_size));
        blob.allocator = bun.default_allocator;
        return blob.toJS(globalThis);
    }
};

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
    output_path: string,
    source_index: Index.Optional = .none,
    size: ?usize = null,
    input_path: []const u8 = "",
    display_size: u32 = 0,
    output_kind: JSC.API.BuildArtifact.OutputKind,
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
    referenced_css_files: []const Index = &.{},
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
        .referenced_css_files = options.referenced_css_files,
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
            _ = try JSC.Node.fs.NodeFS.writeFileWithPathBuffer(&path_buf, .{
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
    const fd_in = bun.FD.fromStdFile(try std.fs.openFileAbsolute(file.src_path.text, .{ .mode = .read_only }));

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

pub fn toJS(
    this: *OutputFile,
    owned_pathname: ?[]const u8,
    globalObject: *JSC.JSGlobalObject,
) bun.JSC.JSValue {
    return switch (this.value) {
        .move, .pending => @panic("Unexpected pending output file"),
        .noop => .js_undefined,
        .copy => |copy| brk: {
            const file_blob = JSC.WebCore.Blob.Store.initFile(
                if (copy.fd.isValid())
                    JSC.Node.PathOrFileDescriptor{
                        .fd = copy.fd,
                    }
                else
                    JSC.Node.PathOrFileDescriptor{
                        .path = JSC.Node.PathLike{ .string = bun.PathString.init(globalObject.allocator().dupe(u8, copy.pathname) catch unreachable) },
                    },
                this.loader.toMimeType(&.{owned_pathname orelse ""}),
                globalObject.allocator(),
            ) catch |err| {
                Output.panic("error: Unable to create file blob: \"{s}\"", .{@errorName(err)});
            };

            var build_output = bun.new(JSC.API.BuildArtifact, .{
                .blob = JSC.WebCore.Blob.initWithStore(file_blob, globalObject),
                .hash = this.hash,
                .loader = this.input_loader,
                .output_kind = this.output_kind,
                .path = bun.default_allocator.dupe(u8, copy.pathname) catch @panic("Failed to allocate path"),
            });

            this.value = .{
                .buffer = .{
                    .allocator = bun.default_allocator,
                    .bytes = &.{},
                },
            };

            break :brk build_output.toJS(globalObject);
        },
        .saved => brk: {
            var build_output = bun.default_allocator.create(JSC.API.BuildArtifact) catch @panic("Unable to allocate Artifact");
            const path_to_use = owned_pathname orelse this.src_path.text;

            const file_blob = JSC.WebCore.Blob.Store.initFile(
                JSC.Node.PathOrFileDescriptor{
                    .path = JSC.Node.PathLike{ .string = bun.PathString.init(owned_pathname orelse (bun.default_allocator.dupe(u8, this.src_path.text) catch unreachable)) },
                },
                this.loader.toMimeType(&.{owned_pathname orelse ""}),
                globalObject.allocator(),
            ) catch |err| {
                Output.panic("error: Unable to create file blob: \"{s}\"", .{@errorName(err)});
            };

            this.value = .{
                .buffer = .{
                    .allocator = bun.default_allocator,
                    .bytes = &.{},
                },
            };

            build_output.* = JSC.API.BuildArtifact{
                .blob = JSC.WebCore.Blob.initWithStore(file_blob, globalObject),
                .hash = this.hash,
                .loader = this.input_loader,
                .output_kind = this.output_kind,
                .path = bun.default_allocator.dupe(u8, path_to_use) catch @panic("Failed to allocate path"),
            };

            break :brk build_output.toJS(globalObject);
        },
        .buffer => |buffer| brk: {
            var blob = JSC.WebCore.Blob.init(@constCast(buffer.bytes), buffer.allocator, globalObject);
            if (blob.store) |store| {
                store.mime_type = this.loader.toMimeType(&.{owned_pathname orelse ""});
                blob.content_type = store.mime_type.value;
            } else {
                blob.content_type = this.loader.toMimeType(&.{owned_pathname orelse ""}).value;
            }

            blob.size = @as(JSC.WebCore.Blob.SizeType, @truncate(buffer.bytes.len));

            var build_output = bun.default_allocator.create(JSC.API.BuildArtifact) catch @panic("Unable to allocate Artifact");
            build_output.* = JSC.API.BuildArtifact{
                .blob = blob,
                .hash = this.hash,
                .loader = this.input_loader,
                .output_kind = this.output_kind,
                .path = owned_pathname orelse bun.default_allocator.dupe(u8, this.src_path.text) catch unreachable,
            };

            this.value = .{
                .buffer = .{
                    .allocator = bun.default_allocator,
                    .bytes = &.{},
                },
            };

            break :brk build_output.toJS(globalObject);
        },
    };
}

pub fn toBlob(
    this: *OutputFile,
    allocator: std.mem.Allocator,
    globalThis: *JSC.JSGlobalObject,
) !JSC.WebCore.Blob {
    return switch (this.value) {
        .move, .pending => @panic("Unexpected pending output file"),
        .noop => @panic("Cannot convert noop output file to blob"),
        .copy => |copy| brk: {
            const file_blob = try JSC.WebCore.Blob.Store.initFile(
                if (copy.fd.isValid())
                    JSC.Node.PathOrFileDescriptor{
                        .fd = copy.fd,
                    }
                else
                    JSC.Node.PathOrFileDescriptor{
                        .path = JSC.Node.PathLike{ .string = bun.PathString.init(allocator.dupe(u8, copy.pathname) catch unreachable) },
                    },
                this.loader.toMimeType(&.{ this.dest_path, this.src_path.text }),
                allocator,
            );

            this.value = .{
                .buffer = .{
                    .allocator = bun.default_allocator,
                    .bytes = &.{},
                },
            };

            break :brk JSC.WebCore.Blob.initWithStore(file_blob, globalThis);
        },
        .saved => brk: {
            const file_blob = try JSC.WebCore.Blob.Store.initFile(
                JSC.Node.PathOrFileDescriptor{
                    .path = JSC.Node.PathLike{ .string = bun.PathString.init(allocator.dupe(u8, this.src_path.text) catch unreachable) },
                },
                this.loader.toMimeType(&.{ this.dest_path, this.src_path.text }),
                allocator,
            );

            this.value = .{
                .buffer = .{
                    .allocator = bun.default_allocator,
                    .bytes = &.{},
                },
            };

            break :brk JSC.WebCore.Blob.initWithStore(file_blob, globalThis);
        },
        .buffer => |buffer| brk: {
            var blob = JSC.WebCore.Blob.init(@constCast(buffer.bytes), buffer.allocator, globalThis);
            if (blob.store) |store| {
                store.mime_type = this.loader.toMimeType(&.{ this.dest_path, this.src_path.text });
                blob.content_type = store.mime_type.value;
            } else {
                blob.content_type = this.loader.toMimeType(&.{ this.dest_path, this.src_path.text }).value;
            }

            this.value = .{
                .buffer = .{
                    .allocator = bun.default_allocator,
                    .bytes = &.{},
                },
            };

            blob.size = @as(JSC.WebCore.Blob.SizeType, @truncate(buffer.bytes.len));
            break :brk blob;
        },
    };
}

const OutputFile = @This();
const string = []const u8;
const FileDescriptorType = bun.FileDescriptor;

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const Fs = bun.fs;
const Loader = @import("./options.zig").Loader;
const resolver = @import("./resolver/resolver.zig");
const resolve_path = @import("./resolver/resolve_path.zig");
const Output = @import("./Global.zig").Output;
const Environment = bun.Environment;
