const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const string = bun.string;
const Crypto = JSC.API.Bun.Crypto;
const BoringSSL = bun.BoringSSL.c;
const EVP = Crypto.EVP;
const PBKDF2 = EVP.PBKDF2;
const JSValue = JSC.JSValue;
const validators = @import("./util/validators.zig");
const JSGlobalObject = JSC.JSGlobalObject;
const JSError = bun.JSError;
const String = bun.String;
const UUID = bun.UUID;
const Async = bun.Async;
const Node = JSC.Node;

fn ExternCryptoJob(comptime name: []const u8) type {
    return struct {
        vm: *JSC.VirtualMachine,
        task: JSC.WorkPoolTask,
        any_task: JSC.AnyTask,
        poll: Async.KeepAlive = .{},
        callback: JSC.Strong.Optional,

        ctx: *Ctx,

        const Ctx = opaque {
            const ctx_name = name ++ "Ctx";
            pub const runTask = @extern(*const fn (*Ctx, *JSGlobalObject) callconv(.c) void, .{ .name = "Bun__" ++ ctx_name ++ "__runTask" }).*;
            pub const runFromJS = @extern(*const fn (*Ctx, *JSGlobalObject, JSValue) callconv(.c) void, .{ .name = "Bun__" ++ ctx_name ++ "__runFromJS" }).*;
            pub const deinit = @extern(*const fn (*Ctx) callconv(.c) void, .{ .name = "Bun__" ++ ctx_name ++ "__deinit" }).*;
        };

        pub fn create(global: *JSGlobalObject, ctx: *Ctx, callback: JSValue) callconv(.c) *@This() {
            const vm = global.bunVM();
            const job = bun.new(@This(), .{
                .vm = vm,
                .task = .{
                    .callback = &runTask,
                },
                .any_task = undefined,
                .ctx = ctx,
                .callback = .create(callback, global),
            });
            job.any_task = JSC.AnyTask.New(@This(), &runFromJS).init(job);
            return job;
        }

        pub fn createAndSchedule(global: *JSGlobalObject, ctx: *Ctx, callback: JSValue) callconv(.c) void {
            var job = create(global, ctx, callback);
            job.schedule();
        }

        pub fn runTask(task: *JSC.WorkPoolTask) void {
            const job: *@This() = @fieldParentPtr("task", task);
            var vm = job.vm;
            defer vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(job.any_task.task()));

            job.ctx.runTask(vm.global);
        }

        pub fn runFromJS(this: *@This()) void {
            defer this.deinit();
            const vm = this.vm;

            if (vm.isShuttingDown()) {
                return;
            }

            const callback = this.callback.trySwap() orelse {
                return;
            };

            this.ctx.runFromJS(vm.global, callback);
        }

        fn deinit(this: *@This()) void {
            this.ctx.deinit();
            this.poll.unref(this.vm);
            this.callback.deinit();
            bun.destroy(this);
        }

        pub fn schedule(this: *@This()) callconv(.c) void {
            this.poll.ref(this.vm);
            JSC.WorkPool.schedule(&this.task);
        }

        comptime {
            @export(&create, .{ .name = "Bun__" ++ name ++ "__create" });
            @export(&schedule, .{ .name = "Bun__" ++ name ++ "__schedule" });
            @export(&createAndSchedule, .{ .name = "Bun__" ++ name ++ "__createAndSchedule" });
        }
    };
}

// Definitions for job structs created from c++
pub const CheckPrimeJob = ExternCryptoJob("CheckPrimeJob");
pub const GeneratePrimeJob = ExternCryptoJob("GeneratePrimeJob");
pub const HkdfJob = ExternCryptoJob("HkdfJob");
pub const SecretKeyJob = ExternCryptoJob("SecretKeyJob");
pub const RsaKeyPairJob = ExternCryptoJob("RsaKeyPairJob");
pub const DsaKeyPairJob = ExternCryptoJob("DsaKeyPairJob");
pub const EcKeyPairJob = ExternCryptoJob("EcKeyPairJob");
pub const NidKeyPairJob = ExternCryptoJob("NidKeyPairJob");
pub const DhKeyPairJob = ExternCryptoJob("DhKeyPairJob");
pub const DhJob = ExternCryptoJob("DhJob");
pub const SignJob = ExternCryptoJob("SignJob");

comptime {
    _ = CheckPrimeJob;
    _ = GeneratePrimeJob;
    _ = HkdfJob;
    _ = SecretKeyJob;
    _ = RsaKeyPairJob;
    _ = DsaKeyPairJob;
    _ = EcKeyPairJob;
    _ = NidKeyPairJob;
    _ = DhKeyPairJob;
    _ = DhJob;
    _ = SignJob;
}

fn CryptoJob(comptime Ctx: type) type {
    return struct {
        vm: *JSC.VirtualMachine,
        task: JSC.WorkPoolTask,
        any_task: JSC.AnyTask,
        poll: Async.KeepAlive = .{},

        callback: JSC.Strong.Optional,

        ctx: Ctx,

        pub fn init(global: *JSGlobalObject, callback: JSValue, ctx: *const Ctx) JSError!*@This() {
            const vm = global.bunVM();
            const job = bun.new(@This(), .{
                .vm = vm,
                .task = .{
                    .callback = &runTask,
                },
                .any_task = undefined,
                .ctx = ctx.*,
                .callback = .create(callback, global),
            });
            errdefer bun.destroy(job);
            try job.ctx.init(global);
            job.any_task = JSC.AnyTask.New(@This(), &runFromJS).init(job);
            return job;
        }

        pub fn initAndSchedule(global: *JSGlobalObject, callback: JSValue, ctx: *const Ctx) JSError!void {
            var job = try init(global, callback, ctx);
            job.schedule();
        }

        pub fn runTask(task: *JSC.WorkPoolTask) void {
            const job: *@This() = @fieldParentPtr("task", task);
            var vm = job.vm;
            defer vm.enqueueTaskConcurrent(JSC.ConcurrentTask.create(job.any_task.task()));

            job.ctx.runTask(job.ctx.result);
        }

        pub fn runFromJS(this: *@This()) void {
            defer this.deinit();
            const vm = this.vm;

            if (vm.isShuttingDown()) {
                return;
            }

            const callback = this.callback.trySwap() orelse {
                return;
            };

            this.ctx.runFromJS(vm.global, callback);
        }

        fn deinit(this: *@This()) void {
            this.ctx.deinit();
            this.poll.unref(this.vm);
            this.callback.deinit();
            bun.destroy(this);
        }

        pub fn schedule(this: *@This()) callconv(.c) void {
            this.poll.ref(this.vm);
            JSC.WorkPool.schedule(&this.task);
        }
    };
}

const random = struct {
    const JobCtx = struct {
        value: JSValue,
        bytes: [*]u8,
        offset: u32,
        length: usize,

        result: void = {},

        fn init(this: *JobCtx, _: *JSGlobalObject) JSError!void {
            this.value.protect();
        }

        fn runTask(this: *JobCtx, _: void) void {
            bun.csprng(this.bytes[this.offset..][0..this.length]);
        }

        fn runFromJS(this: *JobCtx, global: *JSGlobalObject, callback: JSValue) void {
            const vm = global.bunVM();
            vm.eventLoop().runCallback(callback, global, .js_undefined, &.{ .null, this.value });
        }

        fn deinit(this: *JobCtx) void {
            this.value.unprotect();
        }
    };

    const Job = CryptoJob(JobCtx);

    const max_possible_length = @min(JSC.ArrayBuffer.max_size, std.math.maxInt(i32));
    const max_range = 0xffff_ffff_ffff;

    fn randomInt(global: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        var min_value, var max_value, var callback = callFrame.argumentsAsArray(3);

        var min_specified = true;
        if (max_value.isUndefined() or max_value.isCallable()) {
            callback = max_value;
            max_value = min_value;
            min_value = JSValue.jsNumber(0);
            min_specified = false;
        }

        if (!callback.isUndefined()) {
            _ = try validators.validateFunction(global, "callback", callback);
        }

        if (!min_value.isSafeInteger()) {
            return global.throwInvalidArgumentTypeValue2("min", "a safe integer", min_value);
        }
        if (!max_value.isSafeInteger()) {
            return global.throwInvalidArgumentTypeValue2("max", "a safe integer", max_value);
        }

        const min: i64 = @intFromFloat(@trunc(min_value.asNumber()));
        const max: i64 = @intFromFloat(@trunc(max_value.asNumber()));

        if (max <= min) {
            return global.ERR(.OUT_OF_RANGE, "The value of \"max\" is out of range. It must be greater than the value of \"min\" ({d}). Received {d}", .{
                min,
                max,
            }).throw();
        }

        if (max - min > max_range) {
            if (min_specified) {
                return global.ERR(.OUT_OF_RANGE, "The value of \"max - min\" is out of range. It must be <= {d}. Received {d}", .{ max_range, max - min }).throw();
            }
            return global.ERR(.OUT_OF_RANGE, "The value of \"max\" is out of range. It must be <= {d}. Received {d}", .{ max_range, max - min }).throw();
        }

        const res = std.crypto.random.intRangeLessThan(i64, min, max);

        if (!callback.isUndefined()) {
            callback.callNextTick(global, [2]JSValue{ .js_undefined, JSValue.jsNumber(res) });
            return .js_undefined;
        }

        return JSValue.jsNumber(res);
    }

    fn randomUUID(global: *JSGlobalObject, callFrame: *JSC.CallFrame) JSError!JSValue {
        const args = callFrame.arguments();

        var disable_entropy_cache = false;
        if (args.len > 0) {
            const options = args[0];
            if (!options.isUndefined()) {
                try validators.validateObject(global, options, "options", .{}, .{});
                if (try options.get(global, "disableEntropyCache")) |disable_entropy_cache_value| {
                    disable_entropy_cache = try validators.validateBoolean(global, disable_entropy_cache_value, "options.disableEntropyCache", .{});
                }
            }
        }

        var str, var bytes = String.createUninitialized(.latin1, 36);

        const uuid = if (disable_entropy_cache)
            UUID.init()
        else
            global.bunVM().rareData().nextUUID();

        uuid.print(bytes[0..36]);
        return str.transferToJS(global);
    }

    fn assertOffset(global: *JSGlobalObject, offset_value: JSValue, element_size: u8, length: usize) JSError!u32 {
        if (!offset_value.isNumber()) {
            return global.throwInvalidArgumentTypeValue("offset", "number", offset_value);
        }
        const offset = offset_value.asNumber() * @as(f32, @floatFromInt(element_size));

        const max_length = @min(length, max_possible_length);
        if (std.math.isNan(offset) or offset > @as(f64, @floatFromInt(max_length)) or offset < 0) {
            return global.throwRangeError(offset, .{ .field_name = "offset", .min = 0, .max = max_length });
        }

        return @intFromFloat(offset);
    }
    fn assertSize(global: *JSGlobalObject, size_value: JSValue, element_size: u8, offset: u32, length: usize) JSError!u32 {
        var size = try validators.validateNumber(global, size_value, "size", null, null);
        size *= @as(f32, @floatFromInt(element_size));

        if (std.math.isNan(size) or size > max_possible_length or size < 0) {
            return global.throwRangeError(size, .{ .field_name = "size", .min = 0, .max = max_possible_length });
        }

        if (size + @as(f32, @floatFromInt(offset)) > @as(f64, @floatFromInt(length))) {
            return global.throwRangeError(size + @as(f32, @floatFromInt(offset)), .{ .field_name = "size + offset", .max = @intCast(length) });
        }

        return @intFromFloat(size);
    }

    fn randomBytes(global: *JSGlobalObject, callFrame: *JSC.CallFrame) JSError!JSValue {
        const size_value, const callback = callFrame.argumentsAsArray(2);

        const size = try assertSize(global, size_value, 1, 0, max_possible_length + 1);

        if (!callback.isUndefined()) {
            _ = try validators.validateFunction(global, "callback", callback);
        }

        const result, const bytes = try JSC.ArrayBuffer.alloc(global, .ArrayBuffer, size);

        if (callback.isUndefined()) {
            // sync
            bun.csprng(bytes);
            return result;
        }

        const ctx: JobCtx = .{
            .value = result,
            .bytes = bytes.ptr,
            .offset = 0,
            .length = size,
        };
        try Job.initAndSchedule(global, callback, &ctx);

        return .js_undefined;
    }

    fn randomFillSync(global: *JSGlobalObject, callFrame: *JSC.CallFrame) JSError!JSValue {
        const buf_value, const offset_value, const size_value = callFrame.argumentsAsArray(3);

        const buf = buf_value.asArrayBuffer(global) orelse {
            return global.throwInvalidArgumentTypeValue("buf", "ArrayBuffer or ArrayBufferView", buf_value);
        };

        const element_size = buf.bytesPerElement() orelse 1;

        const offset = try assertOffset(
            global,
            if (offset_value.isUndefined()) JSC.jsNumber(0) else offset_value,
            element_size,
            buf.byte_len,
        );

        const size = if (size_value.isUndefined())
            buf.byte_len - offset
        else
            try assertSize(global, size_value, element_size, offset, buf.byte_len);

        if (size == 0) {
            return buf_value;
        }

        bun.csprng(buf.slice()[offset..][0..size]);

        return buf_value;
    }

    fn randomFill(global: *JSGlobalObject, callFrame: *JSC.CallFrame) JSError!JSValue {
        const buf_value, var offset_value, var size_value, var callback =
            callFrame.argumentsAsArray(4);

        const buf = buf_value.asArrayBuffer(global) orelse {
            return global.throwInvalidArgumentTypeValue("buf", "ArrayBuffer or ArrayBufferView", buf_value);
        };

        const element_size = buf.bytesPerElement() orelse 1;

        var offset: u32 = 0;
        if (offset_value.isCallable()) {
            callback = offset_value;
            offset = try assertOffset(global, JSValue.jsNumber(0), element_size, buf.byte_len);
            size_value = JSValue.jsNumber(buf.len);
        } else if (size_value.isCallable()) {
            callback = size_value;
            offset = try assertOffset(global, offset_value, element_size, buf.byte_len);
            size_value = JSValue.jsNumber(buf.len - offset);
        } else {
            _ = try validators.validateFunction(global, "callback", callback);
            offset = try assertOffset(global, offset_value, element_size, buf.byte_len);
        }

        const size = if (size_value.isUndefined())
            buf.byte_len - offset
        else
            try assertSize(global, size_value, element_size, offset, buf.byte_len);

        if (size == 0) {
            _ = try callback.call(global, .js_undefined, &.{ .null, JSValue.jsNumber(0) });
            return .js_undefined;
        }

        const ctx: JobCtx = .{
            .value = buf_value,
            .bytes = buf.slice().ptr,
            .offset = offset,
            .length = size,
        };
        try Job.initAndSchedule(global, callback, &ctx);

        return .js_undefined;
    }
};

fn pbkdf2(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const data = try PBKDF2.fromJS(globalThis, callFrame, true);

    const job = PBKDF2.Job.create(JSC.VirtualMachine.get(), globalThis, &data);
    return job.promise.value();
}

fn pbkdf2Sync(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var data = try PBKDF2.fromJS(globalThis, callFrame, false);
    defer data.deinit();
    var out_arraybuffer = JSC.JSValue.createBufferFromLength(globalThis, @intCast(data.length));
    if (out_arraybuffer == .zero or globalThis.hasException()) {
        data.deinit();
        return .zero;
    }

    const output = out_arraybuffer.asArrayBuffer(globalThis) orelse {
        data.deinit();
        return globalThis.throwOutOfMemory();
    };

    if (!data.run(output.slice())) {
        const err = Crypto.createCryptoError(globalThis, BoringSSL.ERR_get_error());
        BoringSSL.ERR_clear_error();
        return globalThis.throwValue(err);
    }

    return out_arraybuffer;
}

pub fn timingSafeEqual(global: *JSGlobalObject, callFrame: *JSC.CallFrame) JSError!JSValue {
    const l_value, const r_value = callFrame.argumentsAsArray(2);

    const l_buf = l_value.asArrayBuffer(global) orelse {
        return global.ERR(.INVALID_ARG_TYPE, "The \"buf1\" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.", .{}).throw();
    };
    const l = l_buf.byteSlice();

    const r_buf = r_value.asArrayBuffer(global) orelse {
        return global.ERR(.INVALID_ARG_TYPE, "The \"buf2\" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.", .{}).throw();
    };
    const r = r_buf.byteSlice();

    if (l.len != r.len) {
        return global.ERR(.CRYPTO_TIMING_SAFE_EQUAL_LENGTH, "Input buffers must have the same byte length", .{}).throw();
    }

    return JSC.jsBoolean(BoringSSL.CRYPTO_memcmp(l.ptr, r.ptr, l.len) == 0);
}

pub fn secureHeapUsed(_: *JSGlobalObject, _: *JSC.CallFrame) JSError!JSValue {
    return .js_undefined;
}

pub fn getFips(_: *JSGlobalObject, _: *JSC.CallFrame) JSError!JSValue {
    return JSValue.jsNumber(0);
}

pub fn setFips(_: *JSGlobalObject, _: *JSC.CallFrame) JSError!JSValue {
    return .js_undefined;
}

pub fn setEngine(global: *JSGlobalObject, _: *JSC.CallFrame) JSError!JSValue {
    return global.ERR(.CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED, "Custom engines not supported by BoringSSL", .{}).throw();
}

fn forEachHash(_: *const BoringSSL.EVP_MD, maybe_from: ?[*:0]const u8, _: ?[*:0]const u8, ctx: *anyopaque) callconv(.c) void {
    const from = maybe_from orelse return;
    const hashes: *bun.CaseInsensitiveASCIIStringArrayHashMap(void) = @alignCast(@ptrCast(ctx));
    hashes.put(bun.span(from), {}) catch bun.outOfMemory();
}

fn getHashes(global: *JSGlobalObject, _: *JSC.CallFrame) JSError!JSValue {
    var hashes: bun.CaseInsensitiveASCIIStringArrayHashMap(void) = .init(bun.default_allocator);
    defer hashes.deinit();

    // TODO(dylan-conway): cache the names
    BoringSSL.EVP_MD_do_all_sorted(&forEachHash, @alignCast(@ptrCast(&hashes)));

    const array = try JSValue.createEmptyArray(global, hashes.count());

    for (hashes.keys(), 0..) |hash, i| {
        const str = String.createUTF8ForJS(global, hash);
        array.putIndex(global, @intCast(i), str);
    }

    return array;
}

const Scrypt = struct {
    password: Node.StringOrBuffer,
    salt: Node.StringOrBuffer,
    N: u32,
    r: u32,
    p: u32,
    maxmem: u64,
    keylen: u32,

    // used in async mode
    buf: JSC.Strong.Optional = .empty,
    result: []u8 = &.{},
    err: ?u32 = null,

    const Job = CryptoJob(Scrypt);

    pub fn fromJS(global: *JSGlobalObject, callFrame: *JSC.CallFrame, comptime is_async: bool) JSError!if (is_async) struct { @This(), JSValue } else @This() {
        const password_value, const salt_value, const keylen_value, var maybe_options_value: ?JSValue, var callback =
            callFrame.argumentsAsArray(5);

        if (is_async) {
            if (callback.isUndefined()) {
                callback = maybe_options_value.?;
                maybe_options_value = null;
            }
        }

        const password = try Node.StringOrBuffer.fromJSMaybeAsync(global, bun.default_allocator, password_value, is_async, true) orelse {
            return global.throwInvalidArgumentTypeValue("password", "string, ArrayBuffer, Buffer, TypedArray, or DataView", password_value);
        };
        errdefer password.deinit();

        const salt = try Node.StringOrBuffer.fromJSMaybeAsync(global, bun.default_allocator, salt_value, is_async, true) orelse {
            return global.throwInvalidArgumentTypeValue("salt", "string, ArrayBuffer, Buffer, TypedArray, or DataView", salt_value);
        };
        errdefer salt.deinit();

        const keylen = try validators.validateInt32(global, keylen_value, "keylen", .{}, 0, null);

        var N: ?u32 = null;
        var r: ?u32 = null;
        var p: ?u32 = null;
        var maxmem: ?i64 = null;

        if (maybe_options_value) |options_value| {
            if (options_value.getObject()) |options| {
                if (try options.get(global, "N")) |N_value| {
                    N = try validators.validateUint32(global, N_value, "N", .{}, false);
                }

                if (try options.get(global, "cost")) |cost_value| {
                    if (N != null) {
                        return global.throwIncompatibleOptionPair("N", "cost");
                    }

                    N = try validators.validateUint32(global, cost_value, "cost", .{}, false);
                }

                if (try options.get(global, "r")) |r_value| {
                    r = try validators.validateUint32(global, r_value, "r", .{}, false);
                }

                if (try options.get(global, "blockSize")) |blocksize_value| {
                    if (r != null) {
                        return global.throwIncompatibleOptionPair("r", "blockSize");
                    }

                    r = try validators.validateUint32(global, blocksize_value, "blockSize", .{}, false);
                }

                if (try options.get(global, "p")) |p_value| {
                    p = try validators.validateUint32(global, p_value, "p", .{}, false);
                }

                if (try options.get(global, "parallelization")) |parallelization_value| {
                    if (p != null) {
                        return global.throwIncompatibleOptionPair("p", "parallelization");
                    }

                    p = try validators.validateUint32(global, parallelization_value, "parallelization", .{}, false);
                }

                if (try options.get(global, "maxmem")) |maxmem_value| {
                    maxmem = try validators.validateInteger(global, maxmem_value, "maxmem", 0, null);
                }
            }
        }

        const N_default: u32 = 16384;
        const r_default: u32 = 8;
        const p_default: u32 = 1;
        const maxmem_default: i64 = 33554432;

        if (N == null or N.? == 0) {
            N = N_default;
        }
        if (r == null or r.? == 0) {
            r = r_default;
        }
        if (p == null or p.? == 0) {
            p = p_default;
        }
        if (maxmem == null or maxmem.? == 0) {
            maxmem = maxmem_default;
        }

        const ctx: Scrypt = .{
            .password = password,
            .salt = salt,
            .N = N.?,
            .r = r.?,
            .p = p.?,
            .maxmem = @intCast(maxmem.?),
            .keylen = @intCast(keylen),
        };

        if (is_async) {
            _ = try validators.validateFunction(global, "callback", callback);
        }

        try ctx.checkScryptParams(global);

        if (is_async) {
            return .{ ctx, callback };
        }

        return ctx;
    }

    fn checkScryptParams(this: *const Scrypt, global: *JSGlobalObject) JSError!void {
        const N = this.N;
        const r = this.r;
        const p = this.p;
        const maxmem = this.maxmem;
        if (BoringSSL.EVP_PBE_validate_scrypt_params(
            null,
            0,
            null,
            0,
            N,
            r,
            p,
            maxmem,
            null,
            0,
        ) == 0) {
            return global.throwInvalidScryptParams();
        }
    }

    fn init(this: *Scrypt, global: *JSGlobalObject) JSError!void {
        const buf, const bytes = try JSC.ArrayBuffer.alloc(global, .ArrayBuffer, this.keylen);

        // to be filled in later
        this.result = bytes;
        this.buf = .create(buf, global);
    }

    fn runTask(this: *Scrypt, key: []u8) void {
        const password = this.password.slice();
        const salt = this.salt.slice();

        if (key.len == 0) {
            // result will be an empty buffer
            return;
        }

        if (password.len > std.math.maxInt(i32) or salt.len > std.math.maxInt(i32)) {
            this.err = 0;
            return;
        }

        const res = BoringSSL.EVP_PBE_scrypt(
            password.ptr,
            password.len,
            salt.ptr,
            salt.len,
            this.N,
            this.r,
            this.p,
            this.maxmem,
            key.ptr,
            key.len,
        );

        if (res == 0) {
            this.err = BoringSSL.ERR_peek_last_error();
            return;
        }
    }

    fn runFromJS(this: *Scrypt, global: *JSGlobalObject, callback: JSValue) void {
        const vm = global.bunVM();

        if (this.err) |err| {
            if (err != 0) {
                var buf: [256]u8 = undefined;
                const msg = BoringSSL.ERR_error_string_n(err, &buf, buf.len);
                const exception = global.ERR(.CRYPTO_OPERATION_FAILED, "Scrypt failed: {s}", .{msg}).toJS();
                vm.eventLoop().runCallback(callback, global, .js_undefined, &.{exception});
                return;
            }

            const exception = global.ERR(.CRYPTO_OPERATION_FAILED, "Scrypt failed", .{}).toJS();
            vm.eventLoop().runCallback(callback, global, .js_undefined, &.{exception});
            return;
        }

        const buf = this.buf.swap();
        vm.eventLoop().runCallback(callback, global, .js_undefined, &.{ .js_undefined, buf });
    }

    fn deinit(this: *Scrypt) void {
        this.buf.deinit();
    }
};

fn scrypt(global: *JSGlobalObject, callFrame: *JSC.CallFrame) JSError!JSValue {
    const ctx, const callback = try Scrypt.fromJS(global, callFrame, true);
    try Scrypt.Job.initAndSchedule(global, callback, &ctx);
    return .js_undefined;
}

fn scryptSync(global: *JSGlobalObject, callFrame: *JSC.CallFrame) JSError!JSValue {
    var ctx = try Scrypt.fromJS(global, callFrame, false);
    const buf, const bytes = try JSC.ArrayBuffer.alloc(global, .ArrayBuffer, ctx.keylen);
    ctx.runTask(bytes);
    return buf;
}

pub fn createNodeCryptoBindingZig(global: *JSC.JSGlobalObject) JSC.JSValue {
    const crypto = JSC.JSValue.createEmptyObject(global, 15);

    crypto.put(global, String.init("pbkdf2"), JSC.JSFunction.create(global, "pbkdf2", pbkdf2, 5, .{}));
    crypto.put(global, String.init("pbkdf2Sync"), JSC.JSFunction.create(global, "pbkdf2Sync", pbkdf2Sync, 5, .{}));
    crypto.put(global, String.init("randomInt"), JSC.JSFunction.create(global, "randomInt", random.randomInt, 2, .{}));
    crypto.put(global, String.init("randomFill"), JSC.JSFunction.create(global, "randomFill", random.randomFill, 4, .{}));
    crypto.put(global, String.init("randomFillSync"), JSC.JSFunction.create(global, "randomFillSync", random.randomFillSync, 3, .{}));
    crypto.put(global, String.init("randomUUID"), JSC.JSFunction.create(global, "randomUUID", random.randomUUID, 1, .{}));
    crypto.put(global, String.init("randomBytes"), JSC.JSFunction.create(global, "randomBytes", random.randomBytes, 2, .{}));
    crypto.put(global, String.init("timingSafeEqual"), JSC.JSFunction.create(global, "timingSafeEqual", timingSafeEqual, 2, .{}));

    crypto.put(global, String.init("secureHeapUsed"), JSC.JSFunction.create(global, "secureHeapUsed", secureHeapUsed, 0, .{}));
    crypto.put(global, String.init("getFips"), JSC.JSFunction.create(global, "getFips", getFips, 0, .{}));
    crypto.put(global, String.init("setFips"), JSC.JSFunction.create(global, "setFips", setFips, 1, .{}));
    crypto.put(global, String.init("setEngine"), JSC.JSFunction.create(global, "setEngine", setEngine, 2, .{}));

    crypto.put(global, String.init("getHashes"), JSC.JSFunction.create(global, "getHashes", getHashes, 0, .{}));

    crypto.put(global, String.init("scrypt"), JSC.JSFunction.create(global, "scrypt", scrypt, 5, .{}));
    crypto.put(global, String.init("scryptSync"), JSC.JSFunction.create(global, "scryptSync", scryptSync, 4, .{}));

    return crypto;
}
