//! `toJS`/`toBlob` bridges for `bundler/OutputFile.zig`. Aliased back so
//! call sites stay `output.toJS(global)`.

pub const SavedFile = struct {
    pub fn toJS(
        globalThis: *jsc.JSGlobalObject,
        path: []const u8,
        byte_size: usize,
    ) jsc.JSValue {
        const mime_type = globalThis.bunVM().mimeType(path);
        const store = jsc.WebCore.Blob.Store.initFile(
            jsc.Node.PathOrFileDescriptor{
                .path = jsc.Node.PathLike{
                    .string = bun.PathString.init(path),
                },
            },
            mime_type,
            bun.default_allocator,
        ) catch unreachable;

        var blob = bun.default_allocator.create(jsc.WebCore.Blob) catch unreachable;
        blob.* = jsc.WebCore.Blob.initWithStore(store, globalThis);
        if (mime_type) |mime| {
            blob.content_type = mime.value;
        }
        blob.size = @as(jsc.WebCore.Blob.SizeType, @truncate(byte_size));
        blob.allocator = bun.default_allocator;
        return blob.toJS(globalThis);
    }
};

pub fn toJS(
    this: *OutputFile,
    owned_pathname: ?[]const u8,
    globalObject: *jsc.JSGlobalObject,
) bun.jsc.JSValue {
    return switch (this.value) {
        .move, .pending => @panic("Unexpected pending output file"),
        .noop => .js_undefined,
        .copy => |copy| brk: {
            const file_blob = jsc.WebCore.Blob.Store.initFile(
                if (copy.fd.isValid())
                    jsc.Node.PathOrFileDescriptor{
                        .fd = copy.fd,
                    }
                else
                    jsc.Node.PathOrFileDescriptor{
                        .path = jsc.Node.PathLike{ .string = bun.PathString.init(globalObject.allocator().dupe(u8, copy.pathname) catch unreachable) },
                    },
                this.loader.toMimeType(&.{owned_pathname orelse ""}),
                globalObject.allocator(),
            ) catch |err| {
                Output.panic("error: Unable to create file blob: \"{s}\"", .{@errorName(err)});
            };

            var build_output = bun.new(jsc.API.BuildArtifact, .{
                .blob = jsc.WebCore.Blob.initWithStore(file_blob, globalObject),
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
            var build_output = bun.default_allocator.create(jsc.API.BuildArtifact) catch @panic("Unable to allocate Artifact");
            const path_to_use = owned_pathname orelse this.src_path.text;

            const file_blob = jsc.WebCore.Blob.Store.initFile(
                jsc.Node.PathOrFileDescriptor{
                    .path = jsc.Node.PathLike{ .string = bun.PathString.init(owned_pathname orelse (bun.default_allocator.dupe(u8, this.src_path.text) catch unreachable)) },
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

            build_output.* = jsc.API.BuildArtifact{
                .blob = jsc.WebCore.Blob.initWithStore(file_blob, globalObject),
                .hash = this.hash,
                .loader = this.input_loader,
                .output_kind = this.output_kind,
                .path = bun.default_allocator.dupe(u8, path_to_use) catch @panic("Failed to allocate path"),
            };

            break :brk build_output.toJS(globalObject);
        },
        .buffer => |buffer| brk: {
            var blob = jsc.WebCore.Blob.init(@constCast(buffer.bytes), buffer.allocator, globalObject);
            if (blob.store) |store| {
                store.mime_type = this.loader.toMimeType(&.{owned_pathname orelse ""});
                blob.content_type = store.mime_type.value;
            } else {
                blob.content_type = this.loader.toMimeType(&.{owned_pathname orelse ""}).value;
            }

            blob.size = @as(jsc.WebCore.Blob.SizeType, @truncate(buffer.bytes.len));

            var build_output = bun.default_allocator.create(jsc.API.BuildArtifact) catch @panic("Unable to allocate Artifact");
            build_output.* = jsc.API.BuildArtifact{
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
    globalThis: *jsc.JSGlobalObject,
) !jsc.WebCore.Blob {
    return switch (this.value) {
        .move, .pending => @panic("Unexpected pending output file"),
        .noop => @panic("Cannot convert noop output file to blob"),
        .copy => |copy| brk: {
            const file_blob = try jsc.WebCore.Blob.Store.initFile(
                if (copy.fd.isValid())
                    jsc.Node.PathOrFileDescriptor{
                        .fd = copy.fd,
                    }
                else
                    jsc.Node.PathOrFileDescriptor{
                        .path = jsc.Node.PathLike{ .string = bun.PathString.init(allocator.dupe(u8, copy.pathname) catch unreachable) },
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

            break :brk jsc.WebCore.Blob.initWithStore(file_blob, globalThis);
        },
        .saved => brk: {
            const file_blob = try jsc.WebCore.Blob.Store.initFile(
                jsc.Node.PathOrFileDescriptor{
                    .path = jsc.Node.PathLike{ .string = bun.PathString.init(allocator.dupe(u8, this.src_path.text) catch unreachable) },
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

            break :brk jsc.WebCore.Blob.initWithStore(file_blob, globalThis);
        },
        .buffer => |buffer| brk: {
            var blob = jsc.WebCore.Blob.init(@constCast(buffer.bytes), buffer.allocator, globalThis);
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

            blob.size = @as(jsc.WebCore.Blob.SizeType, @truncate(buffer.bytes.len));
            break :brk blob;
        },
    };
}

const string = []const u8;

const OutputFile = @import("../bundler/OutputFile.zig");
const std = @import("std");

const bun = @import("bun");
const Output = bun.Output;
const jsc = bun.jsc;
