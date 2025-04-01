password: JSC.Node.StringOrBuffer = JSC.Node.StringOrBuffer.empty,
salt: JSC.Node.StringOrBuffer = JSC.Node.StringOrBuffer.empty,
iteration_count: u32 = 1,
length: i32 = 0,
algorithm: EVP.Algorithm,

pub fn run(this: *PBKDF2, output: []u8) bool {
    const password = this.password.slice();
    const salt = this.salt.slice();
    const algorithm = this.algorithm;
    const iteration_count = this.iteration_count;
    const length = this.length;

    @memset(output, 0);
    assert(this.length <= @as(i32, @intCast(output.len)));
    BoringSSL.ERR_clear_error();
    const rc = BoringSSL.PKCS5_PBKDF2_HMAC(
        if (password.len > 0) password.ptr else null,
        @intCast(password.len),
        salt.ptr,
        @intCast(salt.len),
        @intCast(iteration_count),
        algorithm.md().?,
        @intCast(length),
        output.ptr,
    );

    if (rc <= 0) {
        return false;
    }

    return true;
}

pub const Job = struct {
    pbkdf2: PBKDF2,
    output: []u8 = &[_]u8{},
    task: JSC.WorkPoolTask = .{ .callback = &runTask },
    promise: JSC.JSPromise.Strong = .{},
    vm: *JSC.VirtualMachine,
    err: ?u32 = null,
    any_task: JSC.AnyTask = undefined,
    poll: Async.KeepAlive = .{},

    pub usingnamespace bun.New(@This());

    pub fn runTask(task: *JSC.WorkPoolTask) void {
        const job: *PBKDF2.Job = @fieldParentPtr("task", task);
        defer job.vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(job.any_task.task()));
        job.output = bun.default_allocator.alloc(u8, @as(usize, @intCast(job.pbkdf2.length))) catch {
            job.err = BoringSSL.EVP_R_MEMORY_LIMIT_EXCEEDED;
            return;
        };
        if (!job.pbkdf2.run(job.output)) {
            job.err = BoringSSL.ERR_get_error();
            BoringSSL.ERR_clear_error();

            bun.default_allocator.free(job.output);
            job.output = &[_]u8{};
        }
    }

    pub fn runFromJS(this: *Job) void {
        defer this.deinit();
        if (this.vm.isShuttingDown()) {
            return;
        }

        const globalThis = this.vm.global;
        const promise = this.promise.swap();
        if (this.err) |err| {
            promise.reject(globalThis, createCryptoError(globalThis, err));
            return;
        }

        const output_slice = this.output;
        assert(output_slice.len == @as(usize, @intCast(this.pbkdf2.length)));
        const buffer_value = JSC.JSValue.createBuffer(globalThis, output_slice, bun.default_allocator);
        if (buffer_value == .zero) {
            promise.reject(globalThis, ZigString.init("Failed to create buffer").toErrorInstance(globalThis));
            return;
        }

        this.output = &[_]u8{};
        promise.resolve(globalThis, buffer_value);
    }

    pub fn deinit(this: *Job) void {
        this.poll.unref(this.vm);
        this.pbkdf2.deinitAndUnprotect();
        this.promise.deinit();
        bun.default_allocator.free(this.output);
        this.destroy();
    }

    pub fn create(vm: *JSC.VirtualMachine, globalThis: *JSC.JSGlobalObject, data: *const PBKDF2) *Job {
        var job = Job.new(.{
            .pbkdf2 = data.*,
            .vm = vm,
            .any_task = undefined,
        });

        job.promise = JSC.JSPromise.Strong.init(globalThis);
        job.any_task = JSC.AnyTask.New(@This(), &runFromJS).init(job);
        job.poll.ref(vm);
        JSC.WorkPool.schedule(&job.task);

        return job;
    }
};

pub fn deinitAndUnprotect(this: *PBKDF2) void {
    this.password.deinitAndUnprotect();
    this.salt.deinitAndUnprotect();
}

pub fn deinit(this: *PBKDF2) void {
    this.password.deinit();
    this.salt.deinit();
}

pub fn fromJS(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame, is_async: bool) bun.JSError!PBKDF2 {
    const arg0, const arg1, const arg2, const arg3, const arg4, const arg5 = callFrame.argumentsAsArray(6);

    if (!arg3.isNumber()) {
        return globalThis.throwInvalidArgumentTypeValue("keylen", "number", arg3);
    }

    const keylen_num = arg3.asNumber();

    if (std.math.isInf(keylen_num) or std.math.isNan(keylen_num)) {
        return globalThis.throwRangeError(keylen_num, .{
            .field_name = "keylen",
            .msg = "an integer",
        });
    }

    if (keylen_num < 0 or keylen_num > std.math.maxInt(i32)) {
        return globalThis.throwRangeError(keylen_num, .{ .field_name = "keylen", .min = 0, .max = std.math.maxInt(i32) });
    }

    const keylen: i32 = @intFromFloat(keylen_num);

    if (globalThis.hasException()) {
        return error.JSError;
    }

    if (!arg2.isAnyInt()) {
        return globalThis.throwInvalidArgumentTypeValue("iterations", "number", arg2);
    }

    const iteration_count = arg2.coerce(i64, globalThis);

    if (!globalThis.hasException() and (iteration_count < 1 or iteration_count > std.math.maxInt(i32))) {
        return globalThis.throwRangeError(iteration_count, .{ .field_name = "iterations", .min = 1, .max = std.math.maxInt(i32) + 1 });
    }

    if (globalThis.hasException()) {
        return error.JSError;
    }

    const algorithm = brk: {
        if (!arg4.isString()) {
            return globalThis.throwInvalidArgumentTypeValue("digest", "string", arg4);
        }

        invalid: {
            switch (try EVP.Algorithm.map.fromJSCaseInsensitive(globalThis, arg4) orelse break :invalid) {
                .shake128, .shake256, .@"sha3-224", .@"sha3-256", .@"sha3-384", .@"sha3-512" => break :invalid,
                else => |alg| break :brk alg,
            }
        }

        if (!globalThis.hasException()) {
            const slice = try arg4.toSlice(globalThis, bun.default_allocator);
            defer slice.deinit();
            const name = slice.slice();
            return globalThis.ERR_CRYPTO_INVALID_DIGEST("Invalid digest: {s}", .{name}).throw();
        }
        return error.JSError;
    };

    var out = PBKDF2{
        .iteration_count = @intCast(iteration_count),
        .length = keylen,
        .algorithm = algorithm,
    };
    defer {
        if (globalThis.hasException()) {
            if (is_async)
                out.deinitAndUnprotect()
            else
                out.deinit();
        }
    }

    const allow_string_object = true;
    out.salt = try JSC.Node.StringOrBuffer.fromJSMaybeAsync(globalThis, bun.default_allocator, arg1, is_async, allow_string_object) orelse {
        return globalThis.throwInvalidArgumentTypeValue("salt", "string or buffer", arg1);
    };

    if (out.salt.slice().len > std.math.maxInt(i32)) {
        return globalThis.throwInvalidArguments("salt is too long", .{});
    }

    out.password = try JSC.Node.StringOrBuffer.fromJSMaybeAsync(globalThis, bun.default_allocator, arg0, is_async, allow_string_object) orelse {
        return globalThis.throwInvalidArgumentTypeValue("password", "string or buffer", arg0);
    };

    if (out.password.slice().len > std.math.maxInt(i32)) {
        return globalThis.throwInvalidArguments("password is too long", .{});
    }

    if (is_async) {
        if (!arg5.isFunction()) {
            return globalThis.throwInvalidArgumentTypeValue("callback", "function", arg5);
        }
    }

    return out;
}

/// For usage in Zig
pub fn pbkdf2(
    output: []u8,
    password: []const u8,
    salt: []const u8,
    iteration_count: u32,
    algorithm: Algorithm,
) ?[]const u8 {
    var pbk = PBKDF2{
        .algorithm = algorithm,
        .password = JSC.Node.StringOrBuffer{ .encoded_slice = JSC.ZigString.Slice.fromUTF8NeverFree(password) },
        .salt = JSC.Node.StringOrBuffer{ .encoded_slice = JSC.ZigString.Slice.fromUTF8NeverFree(salt) },
        .iteration_count = iteration_count,
        .length = @intCast(output.len),
    };

    if (!pbk.run(output)) {
        return null;
    }

    return output;
}

const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const JSC = bun.JSC;
const Async = bun.Async;
const ZigString = JSC.ZigString;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;
const assert = bun.assert;
const EVP = JSC.API.Bun.Crypto.EVP;
const Algorithm = EVP.Algorithm;
const BoringSSL = bun.BoringSSL.c;
const createCryptoError = JSC.API.Bun.Crypto.createCryptoError;
const VirtualMachine = JSC.VirtualMachine;
const PBKDF2 = @This();
