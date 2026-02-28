const Store = @This();

data: Data,

mime_type: MimeType = .none,
ref_count: std.atomic.Value(u32) = .init(1),
is_all_ascii: ?bool = null,
allocator: std.mem.Allocator,

pub const new = bun.TrivialNew(@This());

pub fn memoryCost(this: *const Store) usize {
    return if (this.hasOneRef()) @sizeOf(@This()) + switch (this.data) {
        .bytes => this.data.bytes.len,
        .file => 0,
        .s3 => |s3| s3.estimatedSize(),
    } else 0;
}

pub fn getPath(this: *const Store) ?[]const u8 {
    return switch (this.data) {
        .bytes => |*bytes| if (bytes.stored_name.len > 0) bytes.stored_name.slice() else null,
        .file => |*file| if (file.pathlike == .path) file.pathlike.path.slice() else null,
        .s3 => |*s3| s3.pathlike.slice(),
    };
}

pub fn size(this: *const Store) SizeType {
    return switch (this.data) {
        .bytes => this.data.bytes.len,
        .s3, .file => Blob.max_size,
    };
}

pub const Map = std.HashMap(u64, *jsc.WebCore.Blob.Store, bun.IdentityContext(u64), 80);

pub const Data = union(enum) {
    bytes: Bytes,
    file: File,
    s3: S3,
};

pub fn ref(this: *Store) void {
    const old = this.ref_count.fetchAdd(1, .monotonic);
    assert(old > 0);
}

pub fn hasOneRef(this: *const Store) bool {
    return this.ref_count.load(.monotonic) == 1;
}

/// Caller is responsible for derefing the Store.
pub fn toAnyBlob(this: *Store) ?Blob.Any {
    if (this.hasOneRef()) {
        if (this.data == .bytes) {
            return .{ .InternalBlob = this.data.bytes.toInternalBlob() };
        }
    }

    return null;
}

pub fn external(ptr: ?*anyopaque, _: ?*anyopaque, _: usize) callconv(.c) void {
    if (ptr == null) return;
    var this = bun.cast(*Store, ptr);
    this.deref();
}
pub fn initS3WithReferencedCredentials(pathlike: node.PathLike, mime_type: ?MimeType, credentials: *bun.S3.S3Credentials, allocator: std.mem.Allocator) !*Store {
    var path = pathlike;
    // this actually protects/refs the pathlike
    path.toThreadSafe();

    const store = Blob.Store.new(.{
        .data = .{
            .s3 = S3.initWithReferencedCredentials(
                path,
                mime_type orelse brk: {
                    const sliced = path.slice();
                    if (sliced.len > 0) {
                        var extname = std.fs.path.extension(sliced);
                        extname = std.mem.trim(u8, extname, ".");
                        if (MimeType.byExtensionNoDefault(extname)) |mime| {
                            break :brk mime;
                        }
                    }
                    break :brk null;
                },
                credentials,
            ),
        },
        .allocator = allocator,
        .ref_count = std.atomic.Value(u32).init(1),
    });
    return store;
}

pub fn initS3(pathlike: node.PathLike, mime_type: ?MimeType, credentials: bun.S3.S3Credentials, allocator: std.mem.Allocator) !*Store {
    var path = pathlike;
    // this actually protects/refs the pathlike
    path.toThreadSafe();

    const store = Blob.Store.new(.{
        .data = .{
            .s3 = S3.init(
                path,
                mime_type orelse brk: {
                    const sliced = path.slice();
                    if (sliced.len > 0) {
                        var extname = std.fs.path.extension(sliced);
                        extname = std.mem.trim(u8, extname, ".");
                        if (MimeType.byExtensionNoDefault(extname)) |mime| {
                            break :brk mime;
                        }
                    }
                    break :brk null;
                },
                credentials,
            ),
        },
        .allocator = allocator,
        .ref_count = std.atomic.Value(u32).init(1),
    });
    return store;
}
pub fn initFile(pathlike: jsc.Node.PathOrFileDescriptor, mime_type: ?MimeType, allocator: std.mem.Allocator) !*Store {
    const store = Blob.Store.new(.{
        .data = .{
            .file = File.init(
                pathlike,
                mime_type orelse brk: {
                    if (pathlike == .path) {
                        const sliced = pathlike.path.slice();
                        if (sliced.len > 0) {
                            var extname = std.fs.path.extension(sliced);
                            extname = std.mem.trim(u8, extname, ".");
                            if (MimeType.byExtensionNoDefault(extname)) |mime| {
                                break :brk mime;
                            }
                        }
                    }

                    break :brk null;
                },
            ),
        },
        .allocator = allocator,
        .ref_count = std.atomic.Value(u32).init(1),
    });
    return store;
}

/// Takes ownership of `bytes`, which must have been allocated with `allocator`.
pub fn init(bytes: []u8, allocator: std.mem.Allocator) *Store {
    const store = Blob.Store.new(.{
        .data = .{
            .bytes = Bytes.init(bytes, allocator),
        },
        .allocator = allocator,
        .ref_count = .init(1),
    });
    return store;
}

pub fn sharedView(this: Store) []u8 {
    if (this.data == .bytes)
        return this.data.bytes.slice();

    return &[_]u8{};
}

pub fn deref(this: *Blob.Store) void {
    const old = this.ref_count.fetchSub(1, .monotonic);
    assert(old >= 1);
    if (old == 1) {
        this.deinit();
    }
}

pub fn deinit(this: *Blob.Store) void {
    const allocator = this.allocator;

    switch (this.data) {
        .bytes => |*bytes| {
            bytes.deinit();
        },
        .file => |file| {
            if (file.pathlike == .path) {
                if (file.pathlike.path == .string) {
                    allocator.free(@constCast(file.pathlike.path.slice()));
                } else {
                    file.pathlike.path.deinit();
                }
            }
        },
        .s3 => |*s3| {
            s3.deinit(allocator);
        },
    }

    bun.destroy(this);
}

pub const SerializeTag = enum(u8) {
    file = 0,
    bytes = 1,
    empty = 2,
};

pub fn serialize(this: *Store, comptime Writer: type, writer: Writer) !void {
    switch (this.data) {
        .file => |file| {
            const pathlike_tag: jsc.Node.PathOrFileDescriptor.SerializeTag = if (file.pathlike == .fd) .fd else .path;
            try writer.writeInt(u8, @intFromEnum(pathlike_tag), .little);

            switch (file.pathlike) {
                .fd => |fd| {
                    try writer.writeStruct(fd);
                },
                .path => |path| {
                    const path_slice = path.slice();
                    try writer.writeInt(u32, @as(u32, @truncate(path_slice.len)), .little);
                    try writer.writeAll(path_slice);
                },
            }
        },
        .s3 => |s3| {
            const pathlike_tag: jsc.Node.PathOrFileDescriptor.SerializeTag = .path;
            try writer.writeInt(u8, @intFromEnum(pathlike_tag), .little);

            const path_slice = s3.pathlike.slice();
            try writer.writeInt(u32, @as(u32, @truncate(path_slice.len)), .little);
            try writer.writeAll(path_slice);
        },
        .bytes => |bytes| {
            const slice = bytes.slice();
            try writer.writeInt(u32, @truncate(slice.len), .little);
            try writer.writeAll(slice);

            try writer.writeInt(u32, @truncate(bytes.stored_name.slice().len), .little);
            try writer.writeAll(bytes.stored_name.slice());
        },
    }
}

pub fn fromArrayList(list: std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator) !*Blob.Store {
    return try Blob.Store.init(list.items, allocator);
}

/// A blob store that references a file on disk.
pub const File = struct {
    pathlike: jsc.Node.PathOrFileDescriptor,
    mime_type: MimeType = MimeType.other,
    is_atty: ?bool = null,
    mode: bun.Mode = 0,
    seekable: ?bool = null,
    max_size: SizeType = Blob.max_size,
    // milliseconds since ECMAScript epoch
    last_modified: jsc.JSTimeType = jsc.init_timestamp,

    pub fn unlink(this: *const File, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        return switch (this.pathlike) {
            .path => |path_like| jsc.Node.fs.Async.unlink.create(globalThis, undefined, .{
                .path = .{
                    .encoded_slice = switch (path_like) {
                        .encoded_slice => |slice| try slice.toOwned(bun.default_allocator),
                        else => try jsc.ZigString.init(path_like.slice()).toSliceClone(bun.default_allocator),
                    },
                },
            }, globalThis.bunVM()),
            .fd => jsc.JSPromise.resolvedPromiseValue(globalThis, globalThis.createInvalidArgs("Is not possible to unlink a file descriptor", .{})),
        };
    }
    pub fn isSeekable(this: *const File) ?bool {
        if (this.seekable) |seekable| {
            return seekable;
        }

        if (this.mode != 0) {
            return bun.isRegularFile(this.mode);
        }

        return null;
    }

    pub fn init(pathlike: jsc.Node.PathOrFileDescriptor, mime_type: ?MimeType) File {
        return .{ .pathlike = pathlike, .mime_type = mime_type orelse MimeType.other };
    }
};

/// An S3 Blob Store
pub const S3 = struct {
    pathlike: node.PathLike,
    mime_type: MimeType = .other,
    credentials: ?*S3Credentials,
    options: bun.S3.MultiPartUploadOptions = .{},
    acl: ?bun.S3.ACL = null,
    storage_class: ?bun.S3.StorageClass = null,
    request_payer: bool = false,

    pub fn isSeekable(_: *const @This()) ?bool {
        return true;
    }

    pub fn getCredentials(this: *const @This()) *S3Credentials {
        bun.assert(this.credentials != null);
        return this.credentials.?;
    }

    pub fn getCredentialsWithOptions(this: *const @This(), options: ?JSValue, globalObject: *JSGlobalObject) bun.JSError!bun.S3.S3CredentialsWithOptions {
        return S3Credentials.getCredentialsWithOptions(this.getCredentials().*, this.options, options, this.acl, this.storage_class, this.request_payer, globalObject);
    }

    pub fn path(this: *@This()) []const u8 {
        var path_name = bun.URL.parse(this.pathlike.slice()).s3Path();
        // normalize start and ending
        if (strings.endsWith(path_name, "/")) {
            path_name = path_name[0..path_name.len];
        } else if (strings.endsWith(path_name, "\\")) {
            path_name = path_name[0 .. path_name.len - 1];
        }
        if (strings.startsWith(path_name, "/")) {
            path_name = path_name[1..];
        } else if (strings.startsWith(path_name, "\\")) {
            path_name = path_name[1..];
        }
        return path_name;
    }

    pub fn unlink(this: *@This(), store: *Store, globalThis: *JSGlobalObject, extra_options: ?JSValue) bun.JSError!JSValue {
        const Wrapper = struct {
            promise: jsc.JSPromise.Strong,
            store: *Store,
            global: *JSGlobalObject,

            pub const new = bun.TrivialNew(@This());

            pub fn resolve(result: bun.S3.S3DeleteResult, opaque_self: *anyopaque) bun.JSTerminated!void {
                const self: *@This() = @ptrCast(@alignCast(opaque_self));
                defer self.deinit();
                const globalObject = self.global;
                switch (result) {
                    .success => {
                        try self.promise.resolve(globalObject, .true);
                    },
                    .not_found, .failure => |err| {
                        try self.promise.reject(globalObject, err.toJS(globalObject, self.store.getPath()));
                    },
                }
            }

            fn deinit(wrap: *@This()) void {
                wrap.store.deref();
                wrap.promise.deinit();
                bun.destroy(wrap);
            }
        };
        const promise = jsc.JSPromise.Strong.init(globalThis);
        const value = promise.value();
        const proxy_url = globalThis.bunVM().transpiler.env.getHttpProxy(true, null, null);
        const proxy = if (proxy_url) |url| url.href else null;
        var aws_options = try this.getCredentialsWithOptions(extra_options, globalThis);
        defer aws_options.deinit();
        store.ref();

        try bun.S3.delete(&aws_options.credentials, this.path(), @ptrCast(&Wrapper.resolve), Wrapper.new(.{
            .promise = promise,
            .store = store, // store is needed in case of not found error
            .global = globalThis,
        }), proxy, aws_options.request_payer);

        return value;
    }

    pub fn listObjects(this: *@This(), store: *Store, globalThis: *JSGlobalObject, listOptions: JSValue, extra_options: ?JSValue) bun.JSError!JSValue {
        if (!listOptions.isEmptyOrUndefinedOrNull() and !listOptions.isObject()) {
            return globalThis.throwInvalidArguments("S3Client.listObjects() needs a S3ListObjectsOption as it's first argument", .{});
        }

        const Wrapper = struct {
            promise: jsc.JSPromise.Strong,
            store: *Store,
            resolvedlistOptions: bun.S3.S3ListObjectsOptions,
            global: *JSGlobalObject,

            pub fn resolve(result: bun.S3.S3ListObjectsResult, opaque_self: *anyopaque) bun.JSTerminated!void {
                const self: *@This() = @ptrCast(@alignCast(opaque_self));
                defer self.deinit();
                const globalObject = self.global;

                switch (result) {
                    .success => |list_result| {
                        defer list_result.deinit();
                        const list_result_js = list_result.toJS(globalObject) catch return self.promise.reject(globalObject, error.JSError);
                        try self.promise.resolve(globalObject, list_result_js);
                    },

                    inline .not_found, .failure => |err| {
                        try self.promise.reject(globalObject, err.toJS(globalObject, self.store.getPath()));
                    },
                }
            }

            fn deinit(self: *@This()) void {
                self.store.deref();
                self.promise.deinit();
                self.resolvedlistOptions.deinit();
                self.destroy();
            }

            pub inline fn destroy(self: *@This()) void {
                bun.destroy(self);
            }
        };

        const promise = jsc.JSPromise.Strong.init(globalThis);
        const value = promise.value();
        const proxy_url = globalThis.bunVM().transpiler.env.getHttpProxy(true, null, null);
        const proxy = if (proxy_url) |url| url.href else null;
        var aws_options = try this.getCredentialsWithOptions(extra_options, globalThis);
        defer aws_options.deinit();

        const options = try bun.S3.getListObjectsOptionsFromJS(globalThis, listOptions);
        store.ref();

        try bun.S3.listObjects(&aws_options.credentials, options, @ptrCast(&Wrapper.resolve), bun.new(Wrapper, .{
            .promise = promise,
            .store = store, // store is needed in case of not found error
            .resolvedlistOptions = options,
            .global = globalThis,
        }), proxy);

        return value;
    }

    pub fn initWithReferencedCredentials(pathlike: node.PathLike, mime_type: ?MimeType, credentials: *S3Credentials) S3 {
        credentials.ref();
        return .{
            .credentials = credentials,
            .pathlike = pathlike,
            .mime_type = mime_type orelse MimeType.other,
        };
    }
    pub fn init(pathlike: node.PathLike, mime_type: ?MimeType, credentials: S3Credentials) S3 {
        return .{
            .credentials = credentials.dupe(),
            .pathlike = pathlike,
            .mime_type = mime_type orelse MimeType.other,
        };
    }
    pub fn estimatedSize(this: *const @This()) usize {
        return this.pathlike.estimatedSize() + if (this.credentials) |credentials| credentials.estimatedSize() else 0;
    }

    pub fn deinit(this: *@This(), allocator: std.mem.Allocator) void {
        if (this.pathlike == .string) {
            allocator.free(@constCast(this.pathlike.slice()));
        } else {
            this.pathlike.deinit();
        }
        this.pathlike = .{
            .string = bun.PathString.empty,
        };
        if (this.credentials) |credentials| {
            credentials.deref();
            this.credentials = null;
        }
    }

    const S3Credentials = bun.S3.S3Credentials;
};

pub const Bytes = struct {
    ptr: ?[*]u8 = undefined,
    len: SizeType = 0,
    cap: SizeType = 0,
    allocator: std.mem.Allocator,

    /// Used by standalone module graph and the File constructor
    stored_name: bun.PathString = bun.PathString.empty,

    /// Takes ownership of `bytes`, which must have been allocated with
    /// `allocator`.
    pub fn init(bytes: []u8, allocator: std.mem.Allocator) Bytes {
        return .{
            .ptr = bytes.ptr,
            .len = @as(SizeType, @truncate(bytes.len)),
            .cap = @as(SizeType, @truncate(bytes.len)),
            .allocator = allocator,
        };
    }
    pub fn initEmptyWithName(name: bun.PathString, allocator: std.mem.Allocator) Bytes {
        return .{
            .ptr = null,
            .len = 0,
            .cap = 0,
            .allocator = allocator,
            .stored_name = name,
        };
    }

    pub fn fromArrayList(list: std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator) !*Bytes {
        return Bytes.init(list.items, allocator);
    }

    pub fn toInternalBlob(this: *Bytes) Blob.Internal {
        const ptr = this.ptr orelse return .{
            .bytes = std.array_list.Managed(u8){
                .items = &.{},
                .capacity = 0,
                .allocator = this.allocator,
            },
        };

        const result: Blob.Internal = .{
            .bytes = .{
                .items = ptr[0..this.len],
                .capacity = this.cap,
                .allocator = this.allocator,
            },
        };

        this.allocator = bun.default_allocator;
        this.len = 0;
        this.cap = 0;
        return result;
    }
    pub fn slice(this: Bytes) []u8 {
        if (this.ptr) |ptr| {
            return ptr[0..this.len];
        }
        return "";
    }

    pub fn allocatedSlice(this: Bytes) []u8 {
        if (this.ptr) |ptr| {
            return ptr[0..this.cap];
        }
        return "";
    }

    pub fn deinit(this: *Bytes) void {
        bun.default_allocator.free(this.stored_name.slice());
        if (this.ptr) |ptr| {
            this.allocator.free(ptr[0..this.cap]);
        }
        this.ptr = null;
        this.len = 0;
        this.cap = 0;
    }

    pub fn asArrayList(this: Bytes) std.ArrayListUnmanaged(u8) {
        return this.asArrayListLeak();
    }

    pub fn asArrayListLeak(this: Bytes) std.ArrayListUnmanaged(u8) {
        return .{
            .items = this.ptr[0..this.len],
            .capacity = this.cap,
        };
    }
};

const std = @import("std");

const bun = @import("bun");
const assert = bun.assert;
const strings = bun.strings;
const webcore = bun.webcore;
const MimeType = bun.http.MimeType;
const node = bun.api.node;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const Blob = webcore.Blob;
const SizeType = Blob.SizeType;
