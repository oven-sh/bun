const SSLConfig = @This();

server_name: ?[*:0]const u8 = null,

key_file_name: ?[*:0]const u8 = null,
cert_file_name: ?[*:0]const u8 = null,

ca_file_name: ?[*:0]const u8 = null,
dh_params_file_name: ?[*:0]const u8 = null,

passphrase: ?[*:0]const u8 = null,

key: ?[][*:0]const u8 = null,
cert: ?[][*:0]const u8 = null,
ca: ?[][*:0]const u8 = null,

secure_options: u32 = 0,
request_cert: i32 = 0,
reject_unauthorized: i32 = 0,
ssl_ciphers: ?[*:0]const u8 = null,
protos: ?[*:0]const u8 = null,
client_renegotiation_limit: u32 = 0,
client_renegotiation_window: u32 = 0,
requires_custom_request_ctx: bool = false,
is_using_default_ciphers: bool = true,
low_memory_mode: bool = false,

const ReadFromBlobError = bun.JSError || error{
    NullStore,
    NotAFile,
    EmptyFile,
};

fn readFromBlob(
    global: *jsc.JSGlobalObject,
    blob: *bun.webcore.Blob,
) ReadFromBlobError![:0]const u8 {
    const store = blob.store orelse return error.NullStore;
    const file = switch (store.data) {
        .file => |f| f,
        else => return error.NotAFile,
    };
    var fs: jsc.Node.fs.NodeFS = .{};
    const maybe = fs.readFileWithOptions(
        .{ .path = file.pathlike },
        .sync,
        .null_terminated,
    );
    const result = switch (maybe) {
        .result => |result| result,
        .err => |err| return global.throwValue(try err.toJS(global)),
    };
    if (result.null_terminated.len == 0) return error.EmptyFile;
    return bun.default_allocator.dupeZ(u8, result.null_terminated);
}

pub fn asUSockets(this: *const SSLConfig) uws.SocketContext.BunSocketContextOptions {
    var ctx_opts: uws.SocketContext.BunSocketContextOptions = .{};

    if (this.key_file_name != null)
        ctx_opts.key_file_name = this.key_file_name;
    if (this.cert_file_name != null)
        ctx_opts.cert_file_name = this.cert_file_name;
    if (this.ca_file_name != null)
        ctx_opts.ca_file_name = this.ca_file_name;
    if (this.dh_params_file_name != null)
        ctx_opts.dh_params_file_name = this.dh_params_file_name;
    if (this.passphrase != null)
        ctx_opts.passphrase = this.passphrase;
    ctx_opts.ssl_prefer_low_memory_usage = @intFromBool(this.low_memory_mode);

    if (this.key) |key| {
        ctx_opts.key = key.ptr;
        ctx_opts.key_count = @intCast(key.len);
    }
    if (this.cert) |cert| {
        ctx_opts.cert = cert.ptr;
        ctx_opts.cert_count = @intCast(cert.len);
    }
    if (this.ca) |ca| {
        ctx_opts.ca = ca.ptr;
        ctx_opts.ca_count = @intCast(ca.len);
    }

    if (this.ssl_ciphers != null) {
        ctx_opts.ssl_ciphers = this.ssl_ciphers;
    }
    ctx_opts.request_cert = this.request_cert;
    ctx_opts.reject_unauthorized = this.reject_unauthorized;

    return ctx_opts;
}

/// Returns socket options for client-side TLS with manual verification.
/// Sets request_cert=1 (to receive server cert) and reject_unauthorized=0
/// (to handle verification manually in handshake callback).
pub fn asUSocketsForClientVerification(this: *const SSLConfig) uws.SocketContext.BunSocketContextOptions {
    var opts = this.asUSockets();
    opts.request_cert = 1;
    opts.reject_unauthorized = 0;
    return opts;
}

/// Returns a copy of this config for client-side TLS with manual verification.
/// Sets request_cert=1 (to receive server cert) and reject_unauthorized=0
/// (to handle verification manually in handshake callback).
pub fn forClientVerification(this: SSLConfig) SSLConfig {
    var copy = this;
    copy.request_cert = 1;
    copy.reject_unauthorized = 0;
    return copy;
}

pub fn isSame(this: *const SSLConfig, other: *const SSLConfig) bool {
    inline for (comptime std.meta.fields(SSLConfig)) |field| {
        const first = @field(this, field.name);
        const second = @field(other, field.name);
        switch (field.type) {
            ?[*:0]const u8 => {
                // Compare optional single strings
                if (first) |a| {
                    const b = second orelse return false;
                    if (!stringsEqual(a, b)) return false;
                } else {
                    if (second != null) return false;
                }
            },
            ?[][*:0]const u8 => {
                // Compare optional arrays of strings (e.g., key, cert, ca)
                if (first) |slice1| {
                    const slice2 = second orelse return false;
                    if (slice1.len != slice2.len) return false;
                    for (slice1, slice2) |a, b| {
                        if (!stringsEqual(a, b)) return false;
                    }
                } else {
                    if (second != null) return false;
                }
            },
            else => if (first != second) return false,
        }
    }
    return true;
}

fn stringsEqual(a: [*:0]const u8, b: [*:0]const u8) bool {
    const lhs = bun.asByteSlice(a);
    const rhs = bun.asByteSlice(b);
    return strings.eqlLong(lhs, rhs, true);
}

fn freeStrings(slice: *?[][*:0]const u8) void {
    const inner = slice.* orelse return;
    for (inner) |string| {
        bun.freeSensitive(bun.default_allocator, std.mem.span(string));
    }
    bun.default_allocator.free(inner);
    slice.* = null;
}

fn freeString(string: *?[*:0]const u8) void {
    const inner = string.* orelse return;
    bun.freeSensitive(bun.default_allocator, std.mem.span(inner));
    string.* = null;
}

pub fn deinit(this: *SSLConfig) void {
    bun.meta.useAllFields(SSLConfig, .{
        .server_name = freeString(&this.server_name),
        .key_file_name = freeString(&this.key_file_name),
        .cert_file_name = freeString(&this.cert_file_name),
        .ca_file_name = freeString(&this.ca_file_name),
        .dh_params_file_name = freeString(&this.dh_params_file_name),
        .passphrase = freeString(&this.passphrase),
        .key = freeStrings(&this.key),
        .cert = freeStrings(&this.cert),
        .ca = freeStrings(&this.ca),
        .secure_options = {},
        .request_cert = {},
        .reject_unauthorized = {},
        .ssl_ciphers = freeString(&this.ssl_ciphers),
        .protos = freeString(&this.protos),
        .client_renegotiation_limit = {},
        .client_renegotiation_window = {},
        .requires_custom_request_ctx = {},
        .is_using_default_ciphers = {},
        .low_memory_mode = {},
    });
}

fn cloneStrings(slice: ?[][*:0]const u8) ?[][*:0]const u8 {
    const inner = slice orelse return null;
    const result = bun.handleOom(bun.default_allocator.alloc([*:0]const u8, inner.len));
    for (inner, result) |string, *out| {
        out.* = bun.handleOom(bun.default_allocator.dupeZ(u8, std.mem.span(string)));
    }
    return result;
}

fn cloneString(string: ?[*:0]const u8) ?[*:0]const u8 {
    return bun.handleOom(bun.default_allocator.dupeZ(u8, std.mem.span(string orelse return null)));
}

pub fn clone(this: *const SSLConfig) SSLConfig {
    return .{
        .server_name = cloneString(this.server_name),
        .key_file_name = cloneString(this.key_file_name),
        .cert_file_name = cloneString(this.cert_file_name),
        .ca_file_name = cloneString(this.ca_file_name),
        .dh_params_file_name = cloneString(this.dh_params_file_name),
        .passphrase = cloneString(this.passphrase),
        .key = cloneStrings(this.key),
        .cert = cloneStrings(this.cert),
        .ca = cloneStrings(this.ca),
        .secure_options = this.secure_options,
        .request_cert = this.request_cert,
        .reject_unauthorized = this.reject_unauthorized,
        .ssl_ciphers = cloneString(this.ssl_ciphers),
        .protos = cloneString(this.protos),
        .client_renegotiation_limit = this.client_renegotiation_limit,
        .client_renegotiation_window = this.client_renegotiation_window,
        .requires_custom_request_ctx = this.requires_custom_request_ctx,
        .is_using_default_ciphers = this.is_using_default_ciphers,
        .low_memory_mode = this.low_memory_mode,
    };
}

pub const zero = SSLConfig{};

pub fn fromJS(
    vm: *jsc.VirtualMachine,
    global: *jsc.JSGlobalObject,
    value: jsc.JSValue,
) bun.JSError!?SSLConfig {
    var generated: jsc.generated.SSLConfig = try .fromJS(global, value);
    defer generated.deinit();
    return .fromGenerated(vm, global, &generated);
}

pub fn fromGenerated(
    vm: *jsc.VirtualMachine,
    global: *jsc.JSGlobalObject,
    generated: *const jsc.generated.SSLConfig,
) bun.JSError!?SSLConfig {
    var result: SSLConfig = zero;
    errdefer result.deinit();
    var any = false;

    if (generated.passphrase.get()) |passphrase| {
        result.passphrase = passphrase.toOwnedSliceZ(bun.default_allocator);
        any = true;
    }
    if (generated.dh_params_file.get()) |dh_params_file| {
        result.dh_params_file_name = try handlePath(global, "dhParamsFile", dh_params_file);
        any = true;
    }
    if (generated.server_name.get()) |server_name| {
        result.server_name = server_name.toOwnedSliceZ(bun.default_allocator);
        result.requires_custom_request_ctx = true;
    }

    result.low_memory_mode = generated.low_memory_mode;
    result.reject_unauthorized = @intFromBool(
        generated.reject_unauthorized orelse vm.getTLSRejectUnauthorized(),
    );
    result.request_cert = @intFromBool(generated.request_cert);
    result.secure_options = generated.secure_options;
    any = any or
        result.low_memory_mode or
        generated.reject_unauthorized != null or
        generated.request_cert or
        result.secure_options != 0;

    result.ca = try handleFileForField(global, "ca", &generated.ca);
    result.cert = try handleFileForField(global, "cert", &generated.cert);
    result.key = try handleFileForField(global, "key", &generated.key);
    result.requires_custom_request_ctx = result.requires_custom_request_ctx or
        result.ca != null or
        result.cert != null or
        result.key != null;

    if (generated.key_file.get()) |key_file| {
        result.key_file_name = try handlePath(global, "keyFile", key_file);
        result.requires_custom_request_ctx = true;
    }
    if (generated.cert_file.get()) |cert_file| {
        result.cert_file_name = try handlePath(global, "certFile", cert_file);
        result.requires_custom_request_ctx = true;
    }
    if (generated.ca_file.get()) |ca_file| {
        result.ca_file_name = try handlePath(global, "caFile", ca_file);
        result.requires_custom_request_ctx = true;
    }

    const protocols = switch (generated.alpn_protocols) {
        .none => null,
        .string => |*ref| ref.get().toOwnedSliceZ(bun.default_allocator),
        .buffer => |*ref| blk: {
            const buffer: jsc.ArrayBuffer = ref.get().asArrayBuffer();
            break :blk try bun.default_allocator.dupeZ(u8, buffer.byteSlice());
        },
    };
    if (protocols) |some_protocols| {
        result.protos = some_protocols;
        result.requires_custom_request_ctx = true;
    }
    if (generated.ciphers.get()) |ciphers| {
        result.ssl_ciphers = ciphers.toOwnedSliceZ(bun.default_allocator);
        result.is_using_default_ciphers = false;
        result.requires_custom_request_ctx = true;
    }

    result.client_renegotiation_limit = generated.client_renegotiation_limit;
    result.client_renegotiation_window = generated.client_renegotiation_window;
    any = any or
        result.requires_custom_request_ctx or
        result.client_renegotiation_limit != 0 or
        generated.client_renegotiation_window != 0;

    // We don't need to deinit `result` if `any` is false.
    return if (any) result else null;
}

fn handlePath(
    global: *jsc.JSGlobalObject,
    comptime field: []const u8,
    string: bun.string.WTFStringImpl,
) bun.JSError![:0]const u8 {
    const name = string.toOwnedSliceZ(bun.default_allocator);
    errdefer bun.freeSensitive(bun.default_allocator, name);
    if (std.posix.system.access(name, std.posix.F_OK) != 0) {
        return global.throwInvalidArguments(
            std.fmt.comptimePrint("Unable to access {s} path", .{field}),
            .{},
        );
    }
    return name;
}

fn handleFileForField(
    global: *jsc.JSGlobalObject,
    comptime field: []const u8,
    file: *const jsc.generated.SSLConfigFile,
) bun.JSError!?[][*:0]const u8 {
    return handleFile(global, file) catch |err| switch (err) {
        error.JSError => return error.JSError,
        error.OutOfMemory => return error.OutOfMemory,
        error.JSTerminated => return error.JSTerminated,
        error.EmptyFile => return global.throwInvalidArguments(
            std.fmt.comptimePrint("TLSOptions.{s} is an empty file", .{field}),
            .{},
        ),
        error.NullStore, error.NotAFile => return global.throwInvalidArguments(
            std.fmt.comptimePrint(
                "TLSOptions.{s} is not a valid BunFile (non-BunFile `Blob`s are not supported)",
                .{field},
            ),
            .{},
        ),
    };
}

fn handleFile(
    global: *jsc.JSGlobalObject,
    file: *const jsc.generated.SSLConfigFile,
) ReadFromBlobError!?[][*:0]const u8 {
    const single = try handleSingleFile(global, switch (file.*) {
        .none => return null,
        .string => |*ref| .{ .string = ref.get() },
        .buffer => |*ref| .{ .buffer = ref.get() },
        .file => |*ref| .{ .file = ref.get() },
        .array => |*list| return try handleFileArray(global, list.items()),
    });
    errdefer bun.freeSensitive(bun.default_allocator, single);
    const result = try bun.default_allocator.alloc([*:0]const u8, 1);
    result[0] = single;
    return result;
}

fn handleFileArray(
    global: *jsc.JSGlobalObject,
    elements: []const jsc.generated.SSLConfigSingleFile,
) ReadFromBlobError!?[][*:0]const u8 {
    if (elements.len == 0) return null;
    var result: bun.collections.ArrayListDefault([*:0]const u8) = try .initCapacity(elements.len);
    errdefer {
        for (result.items()) |string| {
            bun.freeSensitive(bun.default_allocator, std.mem.span(string));
        }
        result.deinit();
    }
    for (elements) |*elem| {
        result.appendAssumeCapacity(try handleSingleFile(global, switch (elem.*) {
            .string => |*ref| .{ .string = ref.get() },
            .buffer => |*ref| .{ .buffer = ref.get() },
            .file => |*ref| .{ .file = ref.get() },
        }));
    }
    return try result.toOwnedSlice();
}

fn handleSingleFile(
    global: *jsc.JSGlobalObject,
    file: union(enum) {
        string: bun.string.WTFStringImpl,
        buffer: *jsc.JSCArrayBuffer,
        file: *bun.webcore.Blob,
    },
) ReadFromBlobError![:0]const u8 {
    return switch (file) {
        .string => |string| string.toOwnedSliceZ(bun.default_allocator),
        .buffer => |jsc_buffer| blk: {
            const buffer: jsc.ArrayBuffer = jsc_buffer.asArrayBuffer();
            break :blk try bun.default_allocator.dupeZ(u8, buffer.byteSlice());
        },
        .file => |blob| try readFromBlob(global, blob),
    };
}

pub fn takeProtos(this: *SSLConfig) ?[]const u8 {
    defer this.protos = null;
    const protos = this.protos orelse return null;
    return bun.handleOom(bun.memory.dropSentinel(protos, bun.default_allocator));
}

pub fn takeServerName(this: *SSLConfig) ?[]const u8 {
    defer this.server_name = null;
    const server_name = this.server_name orelse return null;
    return bun.handleOom(bun.memory.dropSentinel(server_name, bun.default_allocator));
}

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;
const uws = bun.uws;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
