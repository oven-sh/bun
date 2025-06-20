const SSLConfig = @This();

requires_custom_request_ctx: bool = false,
server_name: [*c]const u8 = null,

key_file_name: [*c]const u8 = null,
cert_file_name: [*c]const u8 = null,

ca_file_name: [*c]const u8 = null,
dh_params_file_name: [*c]const u8 = null,

passphrase: [*c]const u8 = null,
low_memory_mode: bool = false,

key: ?[][*c]const u8 = null,
key_count: u32 = 0,

cert: ?[][*c]const u8 = null,
cert_count: u32 = 0,

ca: ?[][*c]const u8 = null,
ca_count: u32 = 0,

secure_options: u32 = 0,
request_cert: i32 = 0,
reject_unauthorized: i32 = 0,
ssl_ciphers: ?[*:0]const u8 = null,
protos: ?[*:0]const u8 = null,
protos_len: usize = 0,
client_renegotiation_limit: u32 = 0,
client_renegotiation_window: u32 = 0,

const BlobFileContentResult = struct {
    data: [:0]const u8,

    fn init(comptime fieldname: []const u8, js_obj: JSC.JSValue, global: *JSC.JSGlobalObject) bun.JSError!?BlobFileContentResult {
        {
            const body = try JSC.WebCore.Body.Value.fromJS(global, js_obj);
            if (body == .Blob and body.Blob.store != null and body.Blob.store.?.data == .file) {
                var fs: JSC.Node.fs.NodeFS = .{};
                const read = fs.readFileWithOptions(.{ .path = body.Blob.store.?.data.file.pathlike }, .sync, .null_terminated);
                switch (read) {
                    .err => {
                        return global.throwValue(read.err.toJSC(global));
                    },
                    else => {
                        const str = read.result.null_terminated;
                        if (str.len > 0) {
                            return .{ .data = str };
                        }
                        return global.throwInvalidArguments(std.fmt.comptimePrint("Invalid {s} file", .{fieldname}), .{});
                    },
                }
            }
        }

        return null;
    }
};

pub fn asUSockets(this: SSLConfig) uws.SocketContext.BunSocketContextOptions {
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
        ctx_opts.key_count = this.key_count;
    }
    if (this.cert) |cert| {
        ctx_opts.cert = cert.ptr;
        ctx_opts.cert_count = this.cert_count;
    }
    if (this.ca) |ca| {
        ctx_opts.ca = ca.ptr;
        ctx_opts.ca_count = this.ca_count;
    }

    if (this.ssl_ciphers != null) {
        ctx_opts.ssl_ciphers = this.ssl_ciphers;
    }
    ctx_opts.request_cert = this.request_cert;
    ctx_opts.reject_unauthorized = this.reject_unauthorized;

    return ctx_opts;
}

pub fn isSame(thisConfig: *const SSLConfig, otherConfig: *const SSLConfig) bool {
    { //strings
        const fields = .{
            "server_name",
            "key_file_name",
            "cert_file_name",
            "ca_file_name",
            "dh_params_file_name",
            "passphrase",
            "ssl_ciphers",
            "protos",
        };

        inline for (fields) |field| {
            const lhs = @field(thisConfig, field);
            const rhs = @field(otherConfig, field);
            if (lhs != null and rhs != null) {
                if (!stringsEqual(lhs, rhs))
                    return false;
            } else if (lhs != null or rhs != null) {
                return false;
            }
        }
    }

    {
        //numbers
        const fields = .{ "secure_options", "request_cert", "reject_unauthorized", "low_memory_mode" };

        inline for (fields) |field| {
            const lhs = @field(thisConfig, field);
            const rhs = @field(otherConfig, field);
            if (lhs != rhs)
                return false;
        }
    }

    {
        // complex fields
        const fields = .{ "key", "ca", "cert" };
        inline for (fields) |field| {
            const lhs_count = @field(thisConfig, field ++ "_count");
            const rhs_count = @field(otherConfig, field ++ "_count");
            if (lhs_count != rhs_count)
                return false;
            if (lhs_count > 0) {
                const lhs = @field(thisConfig, field);
                const rhs = @field(otherConfig, field);
                for (0..lhs_count) |i| {
                    if (!stringsEqual(lhs.?[i], rhs.?[i]))
                        return false;
                }
            }
        }
    }

    return true;
}

fn stringsEqual(a: [*c]const u8, b: [*c]const u8) bool {
    const lhs = bun.asByteSlice(a);
    const rhs = bun.asByteSlice(b);
    return strings.eqlLong(lhs, rhs, true);
}

pub fn deinit(this: *SSLConfig) void {
    const fields = .{
        "server_name",
        "key_file_name",
        "cert_file_name",
        "ca_file_name",
        "dh_params_file_name",
        "passphrase",
        "ssl_ciphers",
        "protos",
    };

    inline for (fields) |field| {
        if (@field(this, field)) |slice_ptr| {
            const slice = std.mem.span(slice_ptr);
            if (slice.len > 0) {
                bun.freeSensitive(bun.default_allocator, slice);
            }
            @field(this, field) = "";
        }
    }

    if (this.cert) |cert| {
        for (0..this.cert_count) |i| {
            const slice = std.mem.span(cert[i]);
            if (slice.len > 0) {
                bun.freeSensitive(bun.default_allocator, slice);
            }
        }

        bun.default_allocator.free(cert);
        this.cert = null;
    }

    if (this.key) |key| {
        for (0..this.key_count) |i| {
            const slice = std.mem.span(key[i]);
            if (slice.len > 0) {
                bun.freeSensitive(bun.default_allocator, slice);
            }
        }

        bun.default_allocator.free(key);
        this.key = null;
    }

    if (this.ca) |ca| {
        for (0..this.ca_count) |i| {
            const slice = std.mem.span(ca[i]);
            if (slice.len > 0) {
                bun.freeSensitive(bun.default_allocator, slice);
            }
        }

        bun.default_allocator.free(ca);
        this.ca = null;
    }
}

pub const zero = SSLConfig{};

pub fn fromJS(vm: *JSC.VirtualMachine, global: *JSC.JSGlobalObject, obj: JSC.JSValue) bun.JSError!?SSLConfig {
    var result = zero;
    errdefer result.deinit();

    var arena: bun.ArenaAllocator = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();

    if (!obj.isObject()) {
        return global.throwInvalidArguments("tls option expects an object", .{});
    }

    var any = false;

    result.reject_unauthorized = @intFromBool(vm.getTLSRejectUnauthorized());

    // Required
    if (try obj.getTruthy(global, "keyFile")) |key_file_name| {
        var sliced = try key_file_name.toSlice(global, bun.default_allocator);
        defer sliced.deinit();
        if (sliced.len > 0) {
            result.key_file_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
            if (std.posix.system.access(result.key_file_name, std.posix.F_OK) != 0) {
                return global.throwInvalidArguments("Unable to access keyFile path", .{});
            }
            any = true;
            result.requires_custom_request_ctx = true;
        }
    }

    if (try obj.getTruthy(global, "key")) |js_obj| {
        if (js_obj.jsType().isArray()) {
            const count = try js_obj.getLength(global);
            if (count > 0) {
                const native_array = try bun.default_allocator.alloc([*c]const u8, count);

                var valid_count: u32 = 0;
                for (0..count) |i| {
                    const item = try js_obj.getIndex(global, @intCast(i));
                    if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), item)) |sb| {
                        defer sb.deinit();
                        const sliced = sb.slice();
                        if (sliced.len > 0) {
                            native_array[valid_count] = try bun.default_allocator.dupeZ(u8, sliced);
                            valid_count += 1;
                            any = true;
                            result.requires_custom_request_ctx = true;
                        }
                    } else if (try BlobFileContentResult.init("key", item, global)) |content| {
                        if (content.data.len > 0) {
                            native_array[valid_count] = content.data.ptr;
                            valid_count += 1;
                            result.requires_custom_request_ctx = true;
                            any = true;
                        } else {
                            // mark and free all CA's
                            result.cert = native_array;
                            result.deinit();
                            return null;
                        }
                    } else {
                        // mark and free all keys
                        result.key = native_array;
                        return global.throwInvalidArguments("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                    }
                }

                if (valid_count == 0) {
                    bun.default_allocator.free(native_array);
                } else {
                    result.key = native_array;
                }

                result.key_count = valid_count;
            }
        } else if (try BlobFileContentResult.init("key", js_obj, global)) |content| {
            if (content.data.len > 0) {
                const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
                native_array[0] = content.data.ptr;
                result.key = native_array;
                result.key_count = 1;
                any = true;
                result.requires_custom_request_ctx = true;
            } else {
                result.deinit();
                return null;
            }
        } else {
            const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
            if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), js_obj)) |sb| {
                defer sb.deinit();
                const sliced = sb.slice();
                if (sliced.len > 0) {
                    native_array[0] = try bun.default_allocator.dupeZ(u8, sliced);
                    any = true;
                    result.requires_custom_request_ctx = true;
                    result.key = native_array;
                    result.key_count = 1;
                } else {
                    bun.default_allocator.free(native_array);
                }
            } else {
                // mark and free all certs
                result.key = native_array;
                return global.throwInvalidArguments("key argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
            }
        }
    }

    if (try obj.getTruthy(global, "certFile")) |cert_file_name| {
        var sliced = try cert_file_name.toSlice(global, bun.default_allocator);
        defer sliced.deinit();
        if (sliced.len > 0) {
            result.cert_file_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
            if (std.posix.system.access(result.cert_file_name, std.posix.F_OK) != 0) {
                return global.throwInvalidArguments("Unable to access certFile path", .{});
            }
            any = true;
            result.requires_custom_request_ctx = true;
        }
    }

    if (try obj.getTruthy(global, "ALPNProtocols")) |protocols| {
        if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), protocols)) |sb| {
            defer sb.deinit();
            const sliced = sb.slice();
            if (sliced.len > 0) {
                result.protos = try bun.default_allocator.dupeZ(u8, sliced);
                result.protos_len = sliced.len;
            }

            any = true;
            result.requires_custom_request_ctx = true;
        } else {
            return global.throwInvalidArguments("ALPNProtocols argument must be an string, Buffer or TypedArray", .{});
        }
    }

    if (try obj.getTruthy(global, "cert")) |js_obj| {
        if (js_obj.jsType().isArray()) {
            const count = try js_obj.getLength(global);
            if (count > 0) {
                const native_array = try bun.default_allocator.alloc([*c]const u8, count);

                var valid_count: u32 = 0;
                for (0..count) |i| {
                    const item = try js_obj.getIndex(global, @intCast(i));
                    if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), item)) |sb| {
                        defer sb.deinit();
                        const sliced = sb.slice();
                        if (sliced.len > 0) {
                            native_array[valid_count] = try bun.default_allocator.dupeZ(u8, sliced);
                            valid_count += 1;
                            any = true;
                            result.requires_custom_request_ctx = true;
                        }
                    } else if (try BlobFileContentResult.init("cert", item, global)) |content| {
                        if (content.data.len > 0) {
                            native_array[valid_count] = content.data.ptr;
                            valid_count += 1;
                            result.requires_custom_request_ctx = true;
                            any = true;
                        } else {
                            // mark and free all CA's
                            result.cert = native_array;
                            result.deinit();
                            return null;
                        }
                    } else {
                        // mark and free all certs
                        result.cert = native_array;
                        return global.throwInvalidArguments("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                    }
                }

                if (valid_count == 0) {
                    bun.default_allocator.free(native_array);
                } else {
                    result.cert = native_array;
                }

                result.cert_count = valid_count;
            }
        } else if (try BlobFileContentResult.init("cert", js_obj, global)) |content| {
            if (content.data.len > 0) {
                const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
                native_array[0] = content.data.ptr;
                result.cert = native_array;
                result.cert_count = 1;
                any = true;
                result.requires_custom_request_ctx = true;
            } else {
                result.deinit();
                return null;
            }
        } else {
            const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
            if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), js_obj)) |sb| {
                defer sb.deinit();
                const sliced = sb.slice();
                if (sliced.len > 0) {
                    native_array[0] = try bun.default_allocator.dupeZ(u8, sliced);
                    any = true;
                    result.requires_custom_request_ctx = true;
                    result.cert = native_array;
                    result.cert_count = 1;
                } else {
                    bun.default_allocator.free(native_array);
                }
            } else {
                // mark and free all certs
                result.cert = native_array;
                return global.throwInvalidArguments("cert argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
            }
        }
    }

    if (try obj.getBooleanStrict(global, "requestCert")) |request_cert| {
        result.request_cert = if (request_cert) 1 else 0;
        any = true;
    }

    if (try obj.getBooleanStrict(global, "rejectUnauthorized")) |reject_unauthorized| {
        result.reject_unauthorized = if (reject_unauthorized) 1 else 0;
        any = true;
    }

    if (try obj.getTruthy(global, "ciphers")) |ssl_ciphers| {
        var sliced = try ssl_ciphers.toSlice(global, bun.default_allocator);
        defer sliced.deinit();
        if (sliced.len > 0) {
            result.ssl_ciphers = try bun.default_allocator.dupeZ(u8, sliced.slice());
            any = true;
            result.requires_custom_request_ctx = true;
        }
    }

    if (try obj.getTruthy(global, "serverName") orelse try obj.getTruthy(global, "servername")) |server_name| {
        var sliced = try server_name.toSlice(global, bun.default_allocator);
        defer sliced.deinit();
        if (sliced.len > 0) {
            result.server_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
            any = true;
            result.requires_custom_request_ctx = true;
        }
    }

    if (try obj.getTruthy(global, "ca")) |js_obj| {
        if (js_obj.jsType().isArray()) {
            const count = try js_obj.getLength(global);
            if (count > 0) {
                const native_array = try bun.default_allocator.alloc([*c]const u8, count);

                var valid_count: u32 = 0;
                for (0..count) |i| {
                    const item = try js_obj.getIndex(global, @intCast(i));
                    if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), item)) |sb| {
                        defer sb.deinit();
                        const sliced = sb.slice();
                        if (sliced.len > 0) {
                            native_array[valid_count] = bun.default_allocator.dupeZ(u8, sliced) catch unreachable;
                            valid_count += 1;
                            any = true;
                            result.requires_custom_request_ctx = true;
                        }
                    } else if (try BlobFileContentResult.init("ca", item, global)) |content| {
                        if (content.data.len > 0) {
                            native_array[valid_count] = content.data.ptr;
                            valid_count += 1;
                            any = true;
                            result.requires_custom_request_ctx = true;
                        } else {
                            // mark and free all CA's
                            result.cert = native_array;
                            result.deinit();
                            return null;
                        }
                    } else {
                        // mark and free all CA's
                        result.cert = native_array;
                        return global.throwInvalidArguments("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
                    }
                }

                if (valid_count == 0) {
                    bun.default_allocator.free(native_array);
                } else {
                    result.ca = native_array;
                }

                result.ca_count = valid_count;
            }
        } else if (try BlobFileContentResult.init("ca", js_obj, global)) |content| {
            if (content.data.len > 0) {
                const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
                native_array[0] = content.data.ptr;
                result.ca = native_array;
                result.ca_count = 1;
                any = true;
                result.requires_custom_request_ctx = true;
            } else {
                result.deinit();
                return null;
            }
        } else {
            const native_array = try bun.default_allocator.alloc([*c]const u8, 1);
            if (try JSC.Node.StringOrBuffer.fromJS(global, arena.allocator(), js_obj)) |sb| {
                defer sb.deinit();
                const sliced = sb.slice();
                if (sliced.len > 0) {
                    native_array[0] = try bun.default_allocator.dupeZ(u8, sliced);
                    any = true;
                    result.requires_custom_request_ctx = true;
                    result.ca = native_array;
                    result.ca_count = 1;
                } else {
                    bun.default_allocator.free(native_array);
                }
            } else {
                // mark and free all certs
                result.ca = native_array;
                return global.throwInvalidArguments("ca argument must be an string, Buffer, TypedArray, BunFile or an array containing string, Buffer, TypedArray or BunFile", .{});
            }
        }
    }

    if (try obj.getTruthy(global, "caFile")) |ca_file_name| {
        var sliced = try ca_file_name.toSlice(global, bun.default_allocator);
        defer sliced.deinit();
        if (sliced.len > 0) {
            result.ca_file_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
            if (std.posix.system.access(result.ca_file_name, std.posix.F_OK) != 0) {
                return global.throwInvalidArguments("Invalid caFile path", .{});
            }
        }
    }
    // Optional
    if (any) {
        if (try obj.getTruthy(global, "secureOptions")) |secure_options| {
            if (secure_options.isNumber()) {
                result.secure_options = secure_options.toU32();
            }
        }

        if (try obj.getTruthy(global, "clientRenegotiationLimit")) |client_renegotiation_limit| {
            if (client_renegotiation_limit.isNumber()) {
                result.client_renegotiation_limit = client_renegotiation_limit.toU32();
            }
        }

        if (try obj.getTruthy(global, "clientRenegotiationWindow")) |client_renegotiation_window| {
            if (client_renegotiation_window.isNumber()) {
                result.client_renegotiation_window = client_renegotiation_window.toU32();
            }
        }

        if (try obj.getTruthy(global, "dhParamsFile")) |dh_params_file_name| {
            var sliced = try dh_params_file_name.toSlice(global, bun.default_allocator);
            defer sliced.deinit();
            if (sliced.len > 0) {
                result.dh_params_file_name = try bun.default_allocator.dupeZ(u8, sliced.slice());
                if (std.posix.system.access(result.dh_params_file_name, std.posix.F_OK) != 0) {
                    return global.throwInvalidArguments("Invalid dhParamsFile path", .{});
                }
            }
        }

        if (try obj.getTruthy(global, "passphrase")) |passphrase| {
            var sliced = try passphrase.toSlice(global, bun.default_allocator);
            defer sliced.deinit();
            if (sliced.len > 0) {
                result.passphrase = try bun.default_allocator.dupeZ(u8, sliced.slice());
            }
        }

        if (try obj.get(global, "lowMemoryMode")) |low_memory_mode| {
            if (low_memory_mode.isBoolean() or low_memory_mode.isUndefined()) {
                result.low_memory_mode = low_memory_mode.toBoolean();
                any = true;
            } else {
                return global.throw("Expected lowMemoryMode to be a boolean", .{});
            }
        }
    }

    if (!any)
        return null;
    return result;
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const uws = bun.uws;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const VirtualMachine = JSC.VirtualMachine;
const strings = bun.strings;
