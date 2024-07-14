
const bun = @import("root").bun;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const JSValue = JSC.JSValue;
const Async = bun.Async;
const Hashers = @import("../../sha.zig");
const JSGlobalObject = JSC.JSGlobalObject;
const std = @import("std");
const ZigString = bun.JSC.ZigString;
const strings = bun.strings;
const assert = bun.assert;
const string = []const u8;
const BoringSSL = bun.BoringSSL;
pub const EVP = struct {
    ctx: BoringSSL.EVP_MD_CTX = undefined,
    md: *const BoringSSL.EVP_MD = undefined,
    algorithm: Algorithm,

    // we do this to avoid asking BoringSSL what the digest name is
    // because that API is confusing
    pub const Algorithm = enum {
        // @"DSA-SHA",
        // @"DSA-SHA1",
        // @"MD5-SHA1",
        // @"RSA-MD5",
        // @"RSA-RIPEMD160",
        // @"RSA-SHA1",
        // @"RSA-SHA1-2",
        // @"RSA-SHA224",
        // @"RSA-SHA256",
        // @"RSA-SHA384",
        // @"RSA-SHA512",
        // @"ecdsa-with-SHA1",
        blake2b256,
        blake2b512,
        md4,
        md5,
        ripemd160,
        sha1,
        sha224,
        sha256,
        sha384,
        sha512,
        @"sha512-224",
        @"sha512-256",
        @"sha3-224",
        @"sha3-256",
        @"sha3-384",
        @"sha3-512",
        shake128,
        shake256,

        pub fn md(this: Algorithm) ?*const BoringSSL.EVP_MD {
            return switch (this) {
                .blake2b256 => BoringSSL.EVP_blake2b256(),
                .blake2b512 => BoringSSL.EVP_blake2b512(),
                .md4 => BoringSSL.EVP_md4(),
                .md5 => BoringSSL.EVP_md5(),
                .sha1 => BoringSSL.EVP_sha1(),
                .sha224 => BoringSSL.EVP_sha224(),
                .sha256 => BoringSSL.EVP_sha256(),
                .sha384 => BoringSSL.EVP_sha384(),
                .sha512 => BoringSSL.EVP_sha512(),
                .@"sha512-224" => BoringSSL.EVP_sha512_224(),
                .@"sha512-256" => BoringSSL.EVP_sha512_256(),
                else => null,
            };
        }

        pub const names: std.EnumArray(Algorithm, ZigString) = brk: {
            var all = std.EnumArray(Algorithm, ZigString).initUndefined();
            var iter = all.iterator();
            while (iter.next()) |entry| {
                entry.value.* = ZigString.init(@tagName(entry.key));
            }
            break :brk all;
        };

        pub const map = bun.ComptimeStringMap(Algorithm, .{
            .{ "blake2b256", .blake2b256 },
            .{ "blake2b512", .blake2b512 },
            .{ "ripemd160", .ripemd160 },
            .{ "rmd160", .ripemd160 },
            .{ "md4", .md4 },
            .{ "md5", .md5 },
            .{ "sha1", .sha1 },
            .{ "sha128", .sha1 },
            .{ "sha224", .sha224 },
            .{ "sha256", .sha256 },
            .{ "sha384", .sha384 },
            .{ "sha512", .sha512 },
            .{ "sha-1", .sha1 },
            .{ "sha-224", .sha224 },
            .{ "sha-256", .sha256 },
            .{ "sha-384", .sha384 },
            .{ "sha-512", .sha512 },
            .{ "sha-512/224", .@"sha512-224" },
            .{ "sha-512_224", .@"sha512-224" },
            .{ "sha-512224", .@"sha512-224" },
            .{ "sha512-224", .@"sha512-224" },
            .{ "sha-512/256", .@"sha512-256" },
            .{ "sha-512_256", .@"sha512-256" },
            .{ "sha-512256", .@"sha512-256" },
            .{ "sha512-256", .@"sha512-256" },
            .{ "sha384", .sha384 },
            .{ "sha3-224", .@"sha3-224" },
            .{ "sha3-256", .@"sha3-256" },
            .{ "sha3-384", .@"sha3-384" },
            .{ "sha3-512", .@"sha3-512" },
            .{ "shake128", .shake128 },
            .{ "shake256", .shake256 },
            // .{ "md5-sha1", .@"MD5-SHA1" },
            // .{ "dsa-sha", .@"DSA-SHA" },
            // .{ "dsa-sha1", .@"DSA-SHA1" },
            // .{ "ecdsa-with-sha1", .@"ecdsa-with-SHA1" },
            // .{ "rsa-md5", .@"RSA-MD5" },
            // .{ "rsa-sha1", .@"RSA-SHA1" },
            // .{ "rsa-sha1-2", .@"RSA-SHA1-2" },
            // .{ "rsa-sha224", .@"RSA-SHA224" },
            // .{ "rsa-sha256", .@"RSA-SHA256" },
            // .{ "rsa-sha384", .@"RSA-SHA384" },
            // .{ "rsa-sha512", .@"RSA-SHA512" },
            // .{ "rsa-ripemd160", .@"RSA-RIPEMD160" },
        });
    };

    pub const Digest = [BoringSSL.EVP_MAX_MD_SIZE]u8;

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

    pub const PBKDF2 = struct {
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

                const globalThis = this.promise.strong.globalThis orelse this.vm.global;
                const promise = this.promise.swap();
                if (this.err) |err| {
                    promise.reject(globalThis, createCryptoError(globalThis, err));
                    return;
                }

                const output_slice = this.output;
                assert(output_slice.len == @as(usize, @intCast(this.pbkdf2.length)));
                const buffer_value = JSC.JSValue.createBuffer(globalThis, output_slice, bun.default_allocator);
                if (buffer_value == .zero) {
                    promise.reject(globalThis, globalThis.createTypeErrorInstance("Failed to create buffer", .{}));
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

        pub fn fromJS(globalThis: *JSC.JSGlobalObject, arguments: []const JSC.JSValue, is_async: bool) ?PBKDF2 {
            if (arguments.len < 5) {
                globalThis.throwNotEnoughArguments("pbkdf2", 5, arguments.len);
                return null;
            }

            if (!arguments[3].isAnyInt()) {
                _ = globalThis.throwInvalidArgumentTypeValue("keylen", "integer", arguments[3]);
                return null;
            }

            const length = arguments[3].coerce(i64, globalThis);

            if (!globalThis.hasException() and (length < 0 or length > std.math.maxInt(i32))) {
                globalThis.throwInvalidArguments("keylen must be > 0 and < {d}", .{std.math.maxInt(i32)});
            }

            if (globalThis.hasException()) {
                return null;
            }

            if (!arguments[2].isAnyInt()) {
                _ = globalThis.throwInvalidArgumentTypeValue("iteration count", "integer", arguments[2]);
                return null;
            }

            const iteration_count = arguments[2].coerce(i64, globalThis);

            if (!globalThis.hasException() and (iteration_count < 1 or iteration_count > std.math.maxInt(u32))) {
                globalThis.throwInvalidArguments("iteration count must be >= 1 and <= maxInt", .{});
            }

            if (globalThis.hasException()) {
                return null;
            }

            const algorithm = brk: {
                if (!arguments[4].isString()) {
                    _ = globalThis.throwInvalidArgumentTypeValue("algorithm", "string", arguments[4]);
                    return null;
                }

                break :brk EVP.Algorithm.map.fromJSCaseInsensitive(globalThis, arguments[4]) orelse {
                    if (!globalThis.hasException()) {
                        const slice = arguments[4].toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        const name = slice.slice();
                        const err = globalThis.createTypeErrorInstanceWithCode(.ERR_CRYPTO_INVALID_DIGEST, "Unsupported algorithm \"{s}\"", .{name});
                        globalThis.throwValue(err);
                    }
                    return null;
                };
            };

            var out = PBKDF2{
                .iteration_count = @intCast(iteration_count),
                .length = @truncate(length),
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

            out.salt = JSC.Node.StringOrBuffer.fromJSMaybeAsync(globalThis, bun.default_allocator, arguments[1], is_async) orelse {
                _ = globalThis.throwInvalidArgumentTypeValue("salt", "string or buffer", arguments[1]);
                return null;
            };

            if (out.salt.slice().len > std.math.maxInt(i32)) {
                globalThis.throwInvalidArguments("salt is too long", .{});
                return null;
            }

            out.password = JSC.Node.StringOrBuffer.fromJSMaybeAsync(globalThis, bun.default_allocator, arguments[0], is_async) orelse {
                if (!globalThis.hasException()) {
                    _ = globalThis.throwInvalidArgumentTypeValue("password", "string or buffer", arguments[0]);
                }
                return null;
            };

            if (out.password.slice().len > std.math.maxInt(i32)) {
                globalThis.throwInvalidArguments("password is too long", .{});
                return null;
            }

            return out;
        }
    };

    pub fn init(algorithm: Algorithm, md: *const BoringSSL.EVP_MD, engine: *BoringSSL.ENGINE) EVP {
        BoringSSL.load();

        var ctx: BoringSSL.EVP_MD_CTX = undefined;
        BoringSSL.EVP_MD_CTX_init(&ctx);
        _ = BoringSSL.EVP_DigestInit_ex(&ctx, md, engine);
        return .{
            .ctx = ctx,
            .md = md,
            .algorithm = algorithm,
        };
    }

    pub fn reset(this: *EVP, engine: *BoringSSL.ENGINE) void {
        BoringSSL.ERR_clear_error();
        _ = BoringSSL.EVP_DigestInit_ex(&this.ctx, this.md, engine);
    }

    pub fn hash(this: *EVP, engine: *BoringSSL.ENGINE, input: []const u8, output: []u8) ?u32 {
        BoringSSL.ERR_clear_error();
        var outsize: c_uint = @min(@as(u16, @truncate(output.len)), this.size());
        if (BoringSSL.EVP_Digest(input.ptr, input.len, output.ptr, &outsize, this.md, engine) != 1) {
            return null;
        }

        return outsize;
    }

    pub fn final(this: *EVP, engine: *BoringSSL.ENGINE, output: []u8) []u8 {
        BoringSSL.ERR_clear_error();
        var outsize: u32 = @min(@as(u16, @truncate(output.len)), this.size());
        if (BoringSSL.EVP_DigestFinal_ex(
            &this.ctx,
            output.ptr,
            &outsize,
        ) != 1) {
            return "";
        }

        this.reset(engine);

        return output[0..outsize];
    }

    pub fn update(this: *EVP, input: []const u8) void {
        BoringSSL.ERR_clear_error();
        _ = BoringSSL.EVP_DigestUpdate(&this.ctx, input.ptr, input.len);
    }

    pub fn size(this: *EVP) u16 {
        return @as(u16, @truncate(BoringSSL.EVP_MD_CTX_size(&this.ctx)));
    }

    pub fn copy(this: *const EVP, engine: *BoringSSL.ENGINE) error{OutOfMemory}!EVP {
        BoringSSL.ERR_clear_error();
        var new = init(this.algorithm, this.md, engine);
        if (BoringSSL.EVP_MD_CTX_copy_ex(&new.ctx, &this.ctx) == 0) {
            return error.OutOfMemory;
        }
        return new;
    }

    pub fn byNameAndEngine(engine: *BoringSSL.ENGINE, name: []const u8) ?EVP {
        if (Algorithm.map.getWithEql(name, strings.eqlCaseInsensitiveASCIIIgnoreLength)) |algorithm| {
            if (algorithm.md()) |md| {
                return EVP.init(algorithm, md, engine);
            }

            if (BoringSSL.EVP_get_digestbyname(@tagName(algorithm))) |md| {
                return EVP.init(algorithm, md, engine);
            }
        }

        return null;
    }

    pub fn byName(name: ZigString, global: *JSC.JSGlobalObject) ?EVP {
        var name_str = name.toSlice(global.allocator());
        defer name_str.deinit();
        return byNameAndEngine(global.bunVM().rareData().boringEngine(), name_str.slice());
    }

    pub fn deinit(this: *EVP) void {
        // https://github.com/oven-sh/bun/issues/3250
        _ = BoringSSL.EVP_MD_CTX_cleanup(&this.ctx);
    }
};

pub fn createCryptoError(globalThis: *JSC.JSGlobalObject, err_code: u32) JSValue {
    var outbuf: [128 + 1 + "BoringSSL error: ".len]u8 = undefined;
    @memset(&outbuf, 0);
    outbuf[0.."BoringSSL error: ".len].* = "BoringSSL error: ".*;
    const message_buf = outbuf["BoringSSL error: ".len..];

    _ = BoringSSL.ERR_error_string_n(err_code, message_buf, message_buf.len);

    const error_message: []const u8 = bun.sliceTo(outbuf[0..], 0);
    if (error_message.len == "BoringSSL error: ".len) {
        return ZigString.static("Unknown BoringSSL error").toErrorInstance(globalThis);
    }

    return ZigString.fromUTF8(error_message).toErrorInstance(globalThis);
}
const unknown_password_algorithm_message = "unknown algorithm, expected one of: \"bcrypt\", \"argon2id\", \"argon2d\", \"argon2i\" (default is \"argon2id\")";

pub const PasswordObject = struct {
    pub const pwhash = std.crypto.pwhash;
    pub const Algorithm = enum {
        argon2i,
        argon2d,
        argon2id,
        bcrypt,

        pub const Value = union(Algorithm) {
            argon2i: Argon2Params,
            argon2d: Argon2Params,
            argon2id: Argon2Params,
            // bcrypt only accepts "cost"
            bcrypt: u6,

            pub const bcrpyt_default = 10;

            pub const default = Algorithm.Value{
                .argon2id = .{},
            };

            pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) ?Value {
                if (value.isObject()) {
                    if (value.getTruthy(globalObject, "algorithm")) |algorithm_value| {
                        if (!algorithm_value.isString()) {
                            globalObject.throwInvalidArgumentType("hash", "algorithm", "string");
                            return null;
                        }

                        const algorithm_string = algorithm_value.getZigString(globalObject);

                        switch (PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                            globalObject.throwInvalidArgumentType("hash", "algorithm", unknown_password_algorithm_message);
                            return null;
                        }) {
                            .bcrypt => {
                                var algorithm = PasswordObject.Algorithm.Value{
                                    .bcrypt = PasswordObject.Algorithm.Value.bcrpyt_default,
                                };

                                if (value.getTruthy(globalObject, "cost")) |rounds_value| {
                                    if (!rounds_value.isNumber()) {
                                        globalObject.throwInvalidArgumentType("hash", "cost", "number");
                                        return null;
                                    }

                                    const rounds = rounds_value.coerce(i32, globalObject);

                                    if (rounds < 4 or rounds > 31) {
                                        globalObject.throwInvalidArguments("Rounds must be between 4 and 31", .{});
                                        return null;
                                    }

                                    algorithm.bcrypt = @as(u6, @intCast(rounds));
                                }

                                return algorithm;
                            },
                            inline .argon2id, .argon2d, .argon2i => |tag| {
                                var argon = Algorithm.Argon2Params{};

                                if (value.getTruthy(globalObject, "timeCost")) |time_value| {
                                    if (!time_value.isNumber()) {
                                        globalObject.throwInvalidArgumentType("hash", "timeCost", "number");
                                        return null;
                                    }

                                    const time_cost = time_value.coerce(i32, globalObject);

                                    if (time_cost < 1) {
                                        globalObject.throwInvalidArguments("Time cost must be greater than 0", .{});
                                        return null;
                                    }

                                    argon.time_cost = @as(u32, @intCast(time_cost));
                                }

                                if (value.getTruthy(globalObject, "memoryCost")) |memory_value| {
                                    if (!memory_value.isNumber()) {
                                        globalObject.throwInvalidArgumentType("hash", "memoryCost", "number");
                                        return null;
                                    }

                                    const memory_cost = memory_value.coerce(i32, globalObject);

                                    if (memory_cost < 1) {
                                        globalObject.throwInvalidArguments("Memory cost must be greater than 0", .{});
                                        return null;
                                    }

                                    argon.memory_cost = @as(u32, @intCast(memory_cost));
                                }

                                return @unionInit(Algorithm.Value, @tagName(tag), argon);
                            },
                        }

                        unreachable;
                    } else {
                        globalObject.throwInvalidArgumentType("hash", "options.algorithm", "string");
                        return null;
                    }
                } else if (value.isString()) {
                    const algorithm_string = value.getZigString(globalObject);

                    switch (PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                        globalObject.throwInvalidArgumentType("hash", "algorithm", unknown_password_algorithm_message);
                        return null;
                    }) {
                        .bcrypt => {
                            return PasswordObject.Algorithm.Value{
                                .bcrypt = PasswordObject.Algorithm.Value.bcrpyt_default,
                            };
                        },
                        .argon2id => {
                            return PasswordObject.Algorithm.Value{
                                .argon2id = .{},
                            };
                        },
                        .argon2d => {
                            return PasswordObject.Algorithm.Value{
                                .argon2d = .{},
                            };
                        },
                        .argon2i => {
                            return PasswordObject.Algorithm.Value{
                                .argon2i = .{},
                            };
                        },
                    }
                } else {
                    globalObject.throwInvalidArgumentType("hash", "algorithm", "string");
                    return null;
                }

                unreachable;
            }
        };

        pub const Argon2Params = struct {
            // we don't support the other options right now, but can add them later if someone asks
            memory_cost: u32 = pwhash.argon2.Params.interactive_2id.m,
            time_cost: u32 = pwhash.argon2.Params.interactive_2id.t,

            pub fn toParams(this: Argon2Params) pwhash.argon2.Params {
                return pwhash.argon2.Params{
                    .t = this.time_cost,
                    .m = this.memory_cost,
                    .p = 1,
                };
            }
        };

        pub const argon2 = Algorithm.argon2id;

        pub const label = bun.ComptimeStringMap(
            Algorithm,
            .{
                .{ "argon2i", .argon2i },
                .{ "argon2d", .argon2d },
                .{ "argon2id", .argon2id },
                .{ "bcrypt", .bcrypt },
            },
        );

        pub const default = Algorithm.argon2;

        pub fn get(pw: []const u8) ?Algorithm {
            if (pw[0] != '$') {
                return null;
            }

            // PHC format looks like $<algorithm>$<params>$<salt>$<hash><optional stuff>
            if (strings.hasPrefixComptime(pw[1..], "argon2d$")) {
                return .argon2d;
            }
            if (strings.hasPrefixComptime(pw[1..], "argon2i$")) {
                return .argon2i;
            }
            if (strings.hasPrefixComptime(pw[1..], "argon2id$")) {
                return .argon2id;
            }

            if (strings.hasPrefixComptime(pw[1..], "bcrypt")) {
                return .bcrypt;
            }

            // https://en.wikipedia.org/wiki/Crypt_(C)
            if (strings.hasPrefixComptime(pw[1..], "2")) {
                return .bcrypt;
            }

            return null;
        }
    };

    pub const HashError = pwhash.Error || error{UnsupportedAlgorithm};

    // This is purposely simple because nobody asked to make it more complicated
    pub fn hash(
        allocator: std.mem.Allocator,
        password: []const u8,
        algorithm: Algorithm.Value,
    ) HashError![]const u8 {
        switch (algorithm) {
            inline .argon2i, .argon2d, .argon2id => |argon| {
                var outbuf: [4096]u8 = undefined;
                const hash_options = pwhash.argon2.HashOptions{
                    .params = argon.toParams(),
                    .allocator = allocator,
                    .mode = switch (algorithm) {
                        .argon2i => .argon2i,
                        .argon2d => .argon2d,
                        .argon2id => .argon2id,
                        else => unreachable,
                    },
                    .encoding = .phc,
                };
                // warning: argon2's code may spin up threads if paralellism is set to > 0
                // we don't expose this option
                // but since it parses from phc format, it's possible that it will be set
                // eventually we should do something that about that.
                const out_bytes = try pwhash.argon2.strHash(password, hash_options, &outbuf);
                return try allocator.dupe(u8, out_bytes);
            },
            .bcrypt => |cost| {
                var outbuf: [4096]u8 = undefined;
                var outbuf_slice: []u8 = outbuf[0..];
                var password_to_use = password;
                // bcrypt silently truncates passwords longer than 72 bytes
                // we use SHA512 to hash the password if it's longer than 72 bytes
                if (password.len > 72) {
                    var sha_512 = bun.sha.SHA512.init();
                    defer sha_512.deinit();
                    sha_512.update(password);
                    sha_512.final(outbuf[0..bun.sha.SHA512.digest]);
                    password_to_use = outbuf[0..bun.sha.SHA512.digest];
                    outbuf_slice = outbuf[bun.sha.SHA512.digest..];
                }

                const hash_options = pwhash.bcrypt.HashOptions{
                    .params = pwhash.bcrypt.Params{ .rounds_log = cost },
                    .allocator = allocator,
                    .encoding = .crypt,
                };
                const out_bytes = try pwhash.bcrypt.strHash(password_to_use, hash_options, outbuf_slice);
                return try allocator.dupe(u8, out_bytes);
            },
        }
    }

    pub fn verify(
        allocator: std.mem.Allocator,
        password: []const u8,
        previous_hash: []const u8,
        algorithm: ?Algorithm,
    ) HashError!bool {
        if (previous_hash.len == 0) {
            return false;
        }

        return verifyWithAlgorithm(
            allocator,
            password,
            previous_hash,
            algorithm orelse Algorithm.get(previous_hash) orelse return error.UnsupportedAlgorithm,
        );
    }

    pub fn verifyWithAlgorithm(
        allocator: std.mem.Allocator,
        password: []const u8,
        previous_hash: []const u8,
        algorithm: Algorithm,
    ) HashError!bool {
        switch (algorithm) {
            .argon2id, .argon2d, .argon2i => {
                pwhash.argon2.strVerify(previous_hash, password, .{ .allocator = allocator }) catch |err| {
                    if (err == error.PasswordVerificationFailed) {
                        return false;
                    }

                    return err;
                };
                return true;
            },
            .bcrypt => {
                var password_to_use = password;
                var outbuf: [bun.sha.SHA512.digest]u8 = undefined;

                // bcrypt silently truncates passwords longer than 72 bytes
                // we use SHA512 to hash the password if it's longer than 72 bytes
                if (password.len > 72) {
                    var sha_512 = bun.sha.SHA512.init();
                    defer sha_512.deinit();
                    sha_512.update(password);
                    sha_512.final(&outbuf);
                    password_to_use = &outbuf;
                }
                pwhash.bcrypt.strVerify(previous_hash, password_to_use, .{ .allocator = allocator }) catch |err| {
                    if (err == error.PasswordVerificationFailed) {
                        return false;
                    }

                    return err;
                };
                return true;
            },
        }
    }
};

pub const JSPasswordObject = struct {
    const PascalToUpperUnderscoreCaseFormatter = struct {
        input: []const u8,
        pub fn format(self: @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            for (self.input) |c| {
                if (std.ascii.isUpper(c)) {
                    try writer.writeByte('_');
                    try writer.writeByte(c);
                } else if (std.ascii.isLower(c)) {
                    try writer.writeByte(std.ascii.toUpper(c));
                } else {
                    try writer.writeByte(c);
                }
            }
        }
    };

    pub export fn JSPasswordObject__create(globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        var object = JSValue.createEmptyObject(globalObject, 4);
        object.put(
            globalObject,
            ZigString.static("hash"),
            JSC.createCallback(globalObject, ZigString.static("hash"), 2, JSPasswordObject__hash),
        );
        object.put(
            globalObject,
            ZigString.static("hashSync"),
            JSC.createCallback(globalObject, ZigString.static("hashSync"), 2, JSPasswordObject__hashSync),
        );
        object.put(
            globalObject,
            ZigString.static("verify"),
            JSC.createCallback(globalObject, ZigString.static("verify"), 2, JSPasswordObject__verify),
        );
        object.put(
            globalObject,
            ZigString.static("verifySync"),
            JSC.createCallback(globalObject, ZigString.static("verifySync"), 2, JSPasswordObject__verifySync),
        );
        return object;
    }

    const HashJob = struct {
        algorithm: PasswordObject.Algorithm.Value,
        password: []const u8,
        promise: JSC.JSPromise.Strong,
        event_loop: *JSC.EventLoop,
        global: *JSC.JSGlobalObject,
        ref: Async.KeepAlive = .{},
        task: JSC.WorkPoolTask = .{ .callback = &run },

        pub const Result = struct {
            value: Value,
            ref: Async.KeepAlive = .{},

            task: JSC.AnyTask = undefined,
            promise: JSC.JSPromise.Strong,
            global: *JSC.JSGlobalObject,

            pub const Value = union(enum) {
                err: PasswordObject.HashError,
                hash: []const u8,

                pub fn toErrorInstance(this: Value, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                    const error_code = std.fmt.allocPrint(bun.default_allocator, "PASSWORD_{}", .{PascalToUpperUnderscoreCaseFormatter{ .input = @errorName(this.err) }}) catch bun.outOfMemory();
                    defer bun.default_allocator.free(error_code);
                    const instance = globalObject.createErrorInstance("Password hashing failed with error \"{s}\"", .{@errorName(this.err)});
                    instance.put(globalObject, ZigString.static("code"), JSC.ZigString.init(error_code).toJS(globalObject));
                    return instance;
                }
            };

            pub fn runFromJS(this: *Result) void {
                var promise = this.promise;
                this.promise = .{};
                this.ref.unref(this.global.bunVM());
                const global = this.global;
                switch (this.value) {
                    .err => {
                        const error_instance = this.value.toErrorInstance(global);
                        bun.default_allocator.destroy(this);
                        promise.reject(global, error_instance);
                    },
                    .hash => |value| {
                        const js_string = JSC.ZigString.init(value).toJS(global);
                        bun.default_allocator.destroy(this);
                        promise.resolve(global, js_string);
                    },
                }
            }
        };

        pub fn deinit(this: *HashJob) void {
            this.ref = .{};
            this.promise.strong.deinit();
            bun.default_allocator.free(this.password);
            bun.default_allocator.destroy(this);
        }

        pub fn getValue(password: []const u8, algorithm: PasswordObject.Algorithm.Value) Result.Value {
            const value = PasswordObject.hash(bun.default_allocator, password, algorithm) catch |err| {
                return Result.Value{ .err = err };
            };
            return Result.Value{ .hash = value };
        }

        pub fn run(task: *bun.ThreadPool.Task) void {
            var this: *HashJob = @fieldParentPtr("task", task);

            var result = bun.default_allocator.create(Result) catch bun.outOfMemory();
            result.* = Result{
                .value = getValue(this.password, this.algorithm),
                .task = JSC.AnyTask.New(Result, Result.runFromJS).init(result),
                .promise = this.promise,
                .global = this.global,
                .ref = this.ref,
            };
            this.ref = .{};
            this.promise.strong = .{};
            this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(&result.task));
            this.deinit();
        }
    };
    pub fn hash(
        globalObject: *JSC.JSGlobalObject,
        password: []const u8,
        algorithm: PasswordObject.Algorithm.Value,
        comptime sync: bool,
    ) JSC.JSValue {
        assert(password.len > 0); // caller must check

        if (comptime sync) {
            const value = HashJob.getValue(password, algorithm);
            switch (value) {
                .err => {
                    const error_instance = value.toErrorInstance(globalObject);
                    globalObject.throwValue(error_instance);
                    return .zero;
                },
                .hash => |h| {
                    return JSC.ZigString.init(h).toJS(globalObject);
                },
            }

            unreachable;
        }

        var job = bun.default_allocator.create(HashJob) catch bun.outOfMemory();
        var promise = JSC.JSPromise.Strong.init(globalObject);

        job.* = HashJob{
            .algorithm = algorithm,
            .password = password,
            .promise = promise,
            .event_loop = globalObject.bunVM().eventLoop(),
            .global = globalObject,
        };

        job.ref.ref(globalObject.bunVM());
        JSC.WorkPool.schedule(&job.task);

        return promise.value();
    }

    pub fn verify(
        globalObject: *JSC.JSGlobalObject,
        password: []const u8,
        prev_hash: []const u8,
        algorithm: ?PasswordObject.Algorithm,
        comptime sync: bool,
    ) JSC.JSValue {
        assert(password.len > 0); // caller must check

        if (comptime sync) {
            const value = VerifyJob.getValue(password, prev_hash, algorithm);
            switch (value) {
                .err => {
                    const error_instance = value.toErrorInstance(globalObject);
                    globalObject.throwValue(error_instance);
                    return JSC.JSValue.undefined;
                },
                .pass => |pass| {
                    return JSC.JSValue.jsBoolean(pass);
                },
            }

            unreachable;
        }

        var job = bun.default_allocator.create(VerifyJob) catch bun.outOfMemory();
        var promise = JSC.JSPromise.Strong.init(globalObject);

        job.* = VerifyJob{
            .algorithm = algorithm,
            .password = password,
            .prev_hash = prev_hash,
            .promise = promise,
            .event_loop = globalObject.bunVM().eventLoop(),
            .global = globalObject,
        };

        job.ref.ref(globalObject.bunVM());
        JSC.WorkPool.schedule(&job.task);

        return promise.value();
    }

    // Once we have bindings generator, this should be replaced with a generated function
    pub fn JSPasswordObject__hash(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments_ = callframe.arguments(2);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwNotEnoughArguments("hash", 1, 0);
            return JSC.JSValue.undefined;
        }

        var algorithm = PasswordObject.Algorithm.Value.default;

        if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull()) {
            algorithm = PasswordObject.Algorithm.Value.fromJS(globalObject, arguments[1]) orelse
                return JSC.JSValue.undefined;
        }

        const password_to_hash = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(globalObject, arguments[0], bun.default_allocator) catch {
            globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
            return JSC.JSValue.undefined;
        };

        if (password_to_hash.len == 0) {
            globalObject.throwInvalidArguments("password must not be empty", .{});
            bun.default_allocator.free(password_to_hash);
            return JSC.JSValue.undefined;
        }

        return hash(globalObject, password_to_hash, algorithm, false);
    }

    // Once we have bindings generator, this should be replaced with a generated function
    pub fn JSPasswordObject__hashSync(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments_ = callframe.arguments(2);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            globalObject.throwNotEnoughArguments("hash", 1, 0);
            return JSC.JSValue.undefined;
        }

        var algorithm = PasswordObject.Algorithm.Value.default;

        if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull()) {
            algorithm = PasswordObject.Algorithm.Value.fromJS(globalObject, arguments[1]) orelse
                return JSC.JSValue.undefined;
        }

        var string_or_buffer = JSC.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
            globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
            return JSC.JSValue.undefined;
        };

        if (string_or_buffer.slice().len == 0) {
            globalObject.throwInvalidArguments("password must not be empty", .{});
            string_or_buffer.deinit();
            return JSC.JSValue.undefined;
        }

        defer string_or_buffer.deinit();

        return hash(globalObject, string_or_buffer.slice(), algorithm, true);
    }

    const VerifyJob = struct {
        algorithm: ?PasswordObject.Algorithm = null,
        password: []const u8,
        prev_hash: []const u8,
        promise: JSC.JSPromise.Strong,
        event_loop: *JSC.EventLoop,
        global: *JSC.JSGlobalObject,
        ref: Async.KeepAlive = .{},
        task: JSC.WorkPoolTask = .{ .callback = &run },

        pub const Result = struct {
            value: Value,
            ref: Async.KeepAlive = .{},

            task: JSC.AnyTask = undefined,
            promise: JSC.JSPromise.Strong,
            global: *JSC.JSGlobalObject,

            pub const Value = union(enum) {
                err: PasswordObject.HashError,
                pass: bool,

                pub fn toErrorInstance(this: Value, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                    const error_code = std.fmt.allocPrint(bun.default_allocator, "PASSWORD{}", .{PascalToUpperUnderscoreCaseFormatter{ .input = @errorName(this.err) }}) catch bun.outOfMemory();
                    defer bun.default_allocator.free(error_code);
                    const instance = globalObject.createErrorInstance("Password verification failed with error \"{s}\"", .{@errorName(this.err)});
                    instance.put(globalObject, ZigString.static("code"), JSC.ZigString.init(error_code).toJS(globalObject));
                    return instance;
                }
            };

            pub fn runFromJS(this: *Result) void {
                var promise = this.promise;
                this.promise = .{};
                this.ref.unref(this.global.bunVM());
                const global = this.global;
                switch (this.value) {
                    .err => {
                        const error_instance = this.value.toErrorInstance(global);
                        bun.default_allocator.destroy(this);
                        promise.reject(global, error_instance);
                    },
                    .pass => |pass| {
                        bun.default_allocator.destroy(this);
                        promise.resolve(global, JSC.JSValue.jsBoolean(pass));
                    },
                }
            }
        };

        pub fn deinit(this: *VerifyJob) void {
            this.ref = .{};
            this.promise.strong.deinit();
            bun.default_allocator.free(this.password);
            bun.default_allocator.free(this.prev_hash);
            bun.default_allocator.destroy(this);
        }

        pub fn getValue(password: []const u8, prev_hash: []const u8, algorithm: ?PasswordObject.Algorithm) Result.Value {
            const pass = PasswordObject.verify(bun.default_allocator, password, prev_hash, algorithm) catch |err| {
                return Result.Value{ .err = err };
            };
            return Result.Value{ .pass = pass };
        }

        pub fn run(task: *bun.ThreadPool.Task) void {
            var this: *VerifyJob = @fieldParentPtr("task", task);

            var result = bun.default_allocator.create(Result) catch bun.outOfMemory();
            result.* = Result{
                .value = getValue(this.password, this.prev_hash, this.algorithm),
                .task = JSC.AnyTask.New(Result, Result.runFromJS).init(result),
                .promise = this.promise,
                .global = this.global,
                .ref = this.ref,
            };
            this.ref = .{};
            this.promise.strong = .{};
            this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(&result.task));
            this.deinit();
        }
    };

    // Once we have bindings generator, this should be replaced with a generated function
    pub fn JSPasswordObject__verify(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments_ = callframe.arguments(3);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 2) {
            globalObject.throwNotEnoughArguments("verify", 2, 0);
            return JSC.JSValue.undefined;
        }

        var algorithm: ?PasswordObject.Algorithm = null;

        if (arguments.len > 2 and !arguments[2].isEmptyOrUndefinedOrNull()) {
            if (!arguments[2].isString()) {
                globalObject.throwInvalidArgumentType("verify", "algorithm", "string");
                return JSC.JSValue.undefined;
            }

            const algorithm_string = arguments[2].getZigString(globalObject);

            algorithm = PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                globalObject.throwInvalidArgumentType("verify", "algorithm", unknown_password_algorithm_message);
                return JSC.JSValue.undefined;
            };
        }

        const owned_password = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(globalObject, arguments[0], bun.default_allocator) catch |err| {
            if (err != error.JSError) globalObject.throwInvalidArgumentType("verify", "password", "string or TypedArray");
            return JSC.JSValue.undefined;
        };

        const owned_hash = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(globalObject, arguments[1], bun.default_allocator) catch |err| {
            bun.default_allocator.free(owned_password);
            if (err != error.JSError) globalObject.throwInvalidArgumentType("verify", "hash", "string or TypedArray");
            return JSC.JSValue.undefined;
        };

        if (owned_hash.len == 0) {
            bun.default_allocator.free(owned_password);
            return JSC.JSPromise.resolvedPromiseValue(globalObject, JSC.JSValue.jsBoolean(false));
        }

        if (owned_password.len == 0) {
            bun.default_allocator.free(owned_hash);
            return JSC.JSPromise.resolvedPromiseValue(globalObject, JSC.JSValue.jsBoolean(false));
        }

        return verify(globalObject, owned_password, owned_hash, algorithm, false);
    }

    // Once we have bindings generator, this should be replaced with a generated function
    pub fn JSPasswordObject__verifySync(
        globalObject: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments_ = callframe.arguments(3);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 2) {
            globalObject.throwNotEnoughArguments("verify", 2, 0);
            return JSC.JSValue.undefined;
        }

        var algorithm: ?PasswordObject.Algorithm = null;

        if (arguments.len > 2 and !arguments[2].isEmptyOrUndefinedOrNull()) {
            if (!arguments[2].isString()) {
                globalObject.throwInvalidArgumentType("verify", "algorithm", "string");
                return JSC.JSValue.undefined;
            }

            const algorithm_string = arguments[2].getZigString(globalObject);

            algorithm = PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                globalObject.throwInvalidArgumentType("verify", "algorithm", unknown_password_algorithm_message);
                return JSC.JSValue.undefined;
            };
        }

        var password = JSC.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
            globalObject.throwInvalidArgumentType("verify", "password", "string or TypedArray");
            return JSC.JSValue.undefined;
        };

        var hash_ = JSC.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[1]) orelse {
            password.deinit();
            globalObject.throwInvalidArgumentType("verify", "hash", "string or TypedArray");
            return JSC.JSValue.undefined;
        };

        defer password.deinit();
        defer hash_.deinit();

        if (hash_.slice().len == 0) {
            return JSC.JSValue.jsBoolean(false);
        }

        if (password.slice().len == 0) {
            return JSC.JSValue.jsBoolean(false);
        }

        return verify(globalObject, password.slice(), hash_.slice(), algorithm, true);
    }
};

pub const CryptoHasher = union(enum) {
    evp: EVP,
    zig: CryptoHasherZig,

    const Digest = EVP.Digest;

    pub usingnamespace JSC.Codegen.JSCryptoHasher;
    usingnamespace bun.New(@This());

    pub const digest = JSC.wrapInstanceMethod(CryptoHasher, "digest_", false);
    pub const hash = JSC.wrapStaticMethod(CryptoHasher, "hash_", false);

    pub fn getByteLength(
        this: *CryptoHasher,
        _: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return JSC.JSValue.jsNumber(switch (this.*) {
            .evp => |*inner| inner.size(),
            .zig => |*inner| inner.digest_length,
        });
    }

    pub fn getAlgorithm(
        this: *CryptoHasher,
        globalObject: *JSC.JSGlobalObject,
    ) JSC.JSValue {
        return switch (this.*) {
            inline else => |*inner| ZigString.fromUTF8(bun.asByteSlice(@tagName(inner.algorithm))).toJS(globalObject),
        };
    }

    pub fn getAlgorithms(
        globalThis_: *JSC.JSGlobalObject,
        _: JSValue,
        _: JSValue,
    ) JSC.JSValue {
        var values = EVP.Algorithm.names.values;
        return JSC.JSValue.createStringArray(globalThis_, &values, values.len, true);
    }

    fn hashToEncoding(
        globalThis: *JSGlobalObject,
        evp: *EVP,
        input: JSC.Node.BlobOrStringOrBuffer,
        encoding: JSC.Node.Encoding,
    ) JSC.JSValue {
        var output_digest_buf: Digest = undefined;
        defer input.deinit();

        if (input == .blob and input.blob.isBunFile()) {
            globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            return .zero;
        }

        const len = evp.hash(globalThis.bunVM().rareData().boringEngine(), input.slice(), &output_digest_buf) orelse {
            const err = BoringSSL.ERR_get_error();
            const instance = createCryptoError(globalThis, err);
            BoringSSL.ERR_clear_error();
            globalThis.throwValue(instance);
            return .zero;
        };
        return encoding.encodeWithMaxSize(globalThis, BoringSSL.EVP_MAX_MD_SIZE, output_digest_buf[0..len]);
    }

    fn hashToBytes(
        globalThis: *JSGlobalObject,
        evp: *EVP,
        input: JSC.Node.BlobOrStringOrBuffer,
        output: ?JSC.ArrayBuffer,
    ) JSC.JSValue {
        var output_digest_buf: Digest = undefined;
        var output_digest_slice: []u8 = &output_digest_buf;
        defer input.deinit();

        if (input == .blob and input.blob.isBunFile()) {
            globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            return .zero;
        }

        if (output) |output_buf| {
            const size = evp.size();
            var bytes = output_buf.byteSlice();
            if (bytes.len < size) {
                globalThis.throwInvalidArguments("TypedArray must be at least {d} bytes", .{size});
                return JSC.JSValue.zero;
            }
            output_digest_slice = bytes[0..size];
        }

        const len = evp.hash(globalThis.bunVM().rareData().boringEngine(), input.slice(), output_digest_slice) orelse {
            const err = BoringSSL.ERR_get_error();
            const instance = createCryptoError(globalThis, err);
            BoringSSL.ERR_clear_error();
            globalThis.throwValue(instance);
            return .zero;
        };

        if (output) |output_buf| {
            return output_buf.value;
        } else {
            // Clone to GC-managed memory
            return JSC.ArrayBuffer.createBuffer(globalThis, output_digest_slice[0..len]);
        }
    }

    pub fn hash_(
        globalThis: *JSGlobalObject,
        algorithm: ZigString,
        input: JSC.Node.BlobOrStringOrBuffer,
        output: ?JSC.Node.StringOrBuffer,
    ) JSC.JSValue {
        var evp = EVP.byName(algorithm, globalThis) orelse return CryptoHasherZig.hashByName(globalThis, algorithm, input, output) orelse {
            globalThis.throwInvalidArguments("Unsupported algorithm \"{any}\"", .{algorithm});
            return .zero;
        };
        defer evp.deinit();

        if (output) |string_or_buffer| {
            switch (string_or_buffer) {
                inline else => |*str| {
                    defer str.deinit();
                    const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                        globalThis.throwInvalidArguments("Unknown encoding: {s}", .{str.slice()});
                        return JSC.JSValue.zero;
                    };

                    return hashToEncoding(globalThis, &evp, input, encoding);
                },
                .buffer => |buffer| {
                    return hashToBytes(globalThis, &evp, input, buffer.buffer);
                },
            }
        } else {
            return hashToBytes(globalThis, &evp, input, null);
        }
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) ?*CryptoHasher {
        const arguments = callframe.arguments(2);
        if (arguments.len == 0) {
            globalThis.throwInvalidArguments("Expected an algorithm name as an argument", .{});
            return null;
        }

        const algorithm_name = arguments.ptr[0];
        if (algorithm_name.isEmptyOrUndefinedOrNull() or !algorithm_name.isString()) {
            globalThis.throwInvalidArguments("algorithm must be a string", .{});
            return null;
        }

        const algorithm = algorithm_name.getZigString(globalThis);

        if (algorithm.len == 0) {
            globalThis.throwInvalidArguments("Invalid algorithm name", .{});
            return null;
        }

        var this: CryptoHasher = undefined;
        const evp = EVP.byName(algorithm, globalThis) orelse return CryptoHasherZig.constructor(algorithm) orelse {
            globalThis.throwInvalidArguments("Unsupported algorithm {any}", .{algorithm});
            return null;
        };
        this = .{ .evp = evp };
        return CryptoHasher.new(this);
    }

    pub fn getter(
        globalObject: *JSC.JSGlobalObject,
        _: *JSC.JSObject,
    ) JSC.JSValue {
        return CryptoHasher.getConstructor(globalObject);
    }

    pub fn update(this: *CryptoHasher, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const thisValue = callframe.this();
        const arguments = callframe.arguments(2);
        const input = arguments.ptr[0];
        const encoding = arguments.ptr[1];
        const buffer = JSC.Node.BlobOrStringOrBuffer.fromJSWithEncodingValue(globalThis, globalThis.bunVM().allocator, input, encoding) orelse {
            globalThis.throwInvalidArguments("expected blob, string or buffer", .{});
            return JSC.JSValue.zero;
        };
        defer buffer.deinit();
        if (buffer == .blob and buffer.blob.isBunFile()) {
            globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            return .zero;
        }

        switch (this.*) {
            .evp => |*inner| {
                inner.update(buffer.slice());
                const err = BoringSSL.ERR_get_error();
                if (err != 0) {
                    const instance = createCryptoError(globalThis, err);
                    BoringSSL.ERR_clear_error();
                    globalThis.throwValue(instance);
                    return .zero;
                }
            },
            .zig => |*inner| {
                inner.update(buffer.slice());
                return thisValue;
            },
        }

        return thisValue;
    }

    pub fn copy(
        this: *CryptoHasher,
        globalObject: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) JSC.JSValue {
        var new: CryptoHasher = undefined;
        switch (this.*) {
            .evp => |*inner| {
                new = .{ .evp = inner.copy(globalObject.bunVM().rareData().boringEngine()) catch bun.outOfMemory() };
            },
            .zig => |*inner| {
                new = .{ .zig = inner.copy() };
            },
        }
        return CryptoHasher.new(new).toJS(globalObject);
    }

    pub fn digest_(
        this: *CryptoHasher,
        globalThis: *JSGlobalObject,
        output: ?JSC.Node.StringOrBuffer,
    ) JSC.JSValue {
        if (output) |string_or_buffer| {
            switch (string_or_buffer) {
                inline else => |*str| {
                    defer str.deinit();
                    const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                        globalThis.throwInvalidArguments("Unknown encoding: {}", .{str.*});
                        return JSC.JSValue.zero;
                    };

                    return this.digestToEncoding(globalThis, encoding);
                },
                .buffer => |buffer| {
                    return this.digestToBytes(
                        globalThis,
                        buffer.buffer,
                    );
                },
            }
        } else {
            return this.digestToBytes(globalThis, null);
        }
    }

    fn digestToBytes(this: *CryptoHasher, globalThis: *JSGlobalObject, output: ?JSC.ArrayBuffer) JSC.JSValue {
        var output_digest_buf: EVP.Digest = undefined;
        var output_digest_slice: []u8 = &output_digest_buf;
        if (output) |output_buf| {
            var bytes = output_buf.byteSlice();
            if (bytes.len < output_digest_buf.len) {
                globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{output_digest_buf.len}), .{});
                return JSC.JSValue.zero;
            }
            output_digest_slice = bytes[0..bytes.len];
        } else {
            output_digest_buf = std.mem.zeroes(EVP.Digest);
        }

        const result = this.final(globalThis, output_digest_slice);

        if (output) |output_buf| {
            return output_buf.value;
        } else {
            // Clone to GC-managed memory
            return JSC.ArrayBuffer.createBuffer(globalThis, result);
        }
    }

    fn digestToEncoding(this: *CryptoHasher, globalThis: *JSGlobalObject, encoding: JSC.Node.Encoding) JSC.JSValue {
        var output_digest_buf: EVP.Digest = std.mem.zeroes(EVP.Digest);
        const output_digest_slice: []u8 = &output_digest_buf;
        const out = this.final(globalThis, output_digest_slice);
        return encoding.encodeWithMaxSize(globalThis, BoringSSL.EVP_MAX_MD_SIZE, out);
    }

    fn final(this: *CryptoHasher, globalThis: *JSGlobalObject, output_digest_slice: []u8) []u8 {
        return switch (this.*) {
            .evp => |*inner| inner.final(globalThis.bunVM().rareData().boringEngine(), output_digest_slice),
            .zig => |*inner| inner.final(output_digest_slice),
        };
    }

    pub fn finalize(this: *CryptoHasher) void {
        switch (this.*) {
            .evp => |*inner| {
                // https://github.com/oven-sh/bun/issues/3250
                inner.deinit();
            },
            .zig => |*inner| {
                inner.deinit();
            },
        }
        this.destroy();
    }
};

const CryptoHasherZig = struct {
    algorithm: EVP.Algorithm,
    state: *anyopaque,
    digest_length: u8,

    const algo_map = [_]struct { string, type }{
        .{ "sha3-224", std.crypto.hash.sha3.Sha3_224 },
        .{ "sha3-256", std.crypto.hash.sha3.Sha3_256 },
        .{ "sha3-384", std.crypto.hash.sha3.Sha3_384 },
        .{ "sha3-512", std.crypto.hash.sha3.Sha3_512 },
        .{ "shake128", std.crypto.hash.sha3.Shake128 },
        .{ "shake256", std.crypto.hash.sha3.Shake256 },
    };

    inline fn digestLength(Algorithm: type) comptime_int {
        return switch (Algorithm) {
            std.crypto.hash.sha3.Shake128 => 16,
            std.crypto.hash.sha3.Shake256 => 32,
            else => Algorithm.digest_length,
        };
    }

    pub fn hashByName(
        globalThis: *JSGlobalObject,
        algorithm: ZigString,
        input: JSC.Node.BlobOrStringOrBuffer,
        output: ?JSC.Node.StringOrBuffer,
    ) ?JSC.JSValue {
        inline for (algo_map) |item| {
            if (bun.strings.eqlComptime(algorithm.slice(), item[0])) {
                return hashByNameInner(globalThis, item[1], input, output);
            }
        }
        return null;
    }

    fn hashByNameInner(globalThis: *JSGlobalObject, comptime Algorithm: type, input: JSC.Node.BlobOrStringOrBuffer, output: ?JSC.Node.StringOrBuffer) JSC.JSValue {
        if (output) |string_or_buffer| {
            switch (string_or_buffer) {
                inline else => |*str| {
                    defer str.deinit();
                    globalThis.throwInvalidArguments("Unknown encoding: {s}", .{str.slice()});
                    return JSC.JSValue.zero;
                },
                .buffer => |buffer| {
                    return hashByNameInnerToBytes(globalThis, Algorithm, input, buffer.buffer);
                },
            }
        }
        return hashByNameInnerToBytes(globalThis, Algorithm, input, null);
    }

    fn hashByNameInnerToBytes(globalThis: *JSGlobalObject, comptime Algorithm: type, input: JSC.Node.BlobOrStringOrBuffer, output: ?JSC.ArrayBuffer) JSC.JSValue {
        defer input.deinit();

        if (input == .blob and input.blob.isBunFile()) {
            globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            return .zero;
        }

        var h = Algorithm.init(.{});
        const digest_length_comptime = digestLength(Algorithm);

        if (output) |output_buf| {
            if (output_buf.byteSlice().len < digest_length_comptime) {
                globalThis.throwInvalidArguments("TypedArray must be at least {d} bytes", .{digest_length_comptime});
                return JSC.JSValue.zero;
            }
        }

        h.update(input.slice());

        if (output) |output_buf| {
            h.final(output_buf.slice()[0..digest_length_comptime]);
            return output_buf.value;
        } else {
            var out: [digestLength(Algorithm)]u8 = undefined;
            h.final(&out);
            // Clone to GC-managed memory
            return JSC.ArrayBuffer.createBuffer(globalThis, &out);
        }
    }

    fn constructor(algorithm: ZigString) ?*CryptoHasher {
        inline for (algo_map) |item| {
            if (bun.strings.eqlComptime(algorithm.slice(), item[0])) {
                return CryptoHasher.new(.{ .zig = .{
                    .algorithm = @field(EVP.Algorithm, item[0]),
                    .state = bun.new(item[1], item[1].init(.{})),
                    .digest_length = digestLength(item[1]),
                } });
            }
        }
        return null;
    }

    fn update(self: *CryptoHasherZig, bytes: []const u8) void {
        inline for (algo_map) |item| {
            if (self.algorithm == @field(EVP.Algorithm, item[0])) {
                return item[1].update(@ptrCast(@alignCast(self.state)), bytes);
            }
        }
        @panic("unreachable");
    }

    fn copy(self: *const CryptoHasherZig) CryptoHasherZig {
        inline for (algo_map) |item| {
            if (self.algorithm == @field(EVP.Algorithm, item[0])) {
                return .{
                    .algorithm = self.algorithm,
                    .state = bun.dupe(item[1], @ptrCast(@alignCast(self.state))),
                    .digest_length = self.digest_length,
                };
            }
        }
        @panic("unreachable");
    }

    fn final(self: *CryptoHasherZig, output_digest_slice: []u8) []u8 {
        inline for (algo_map) |item| {
            if (self.algorithm == @field(EVP.Algorithm, item[0])) {
                item[1].final(@ptrCast(@alignCast(self.state)), @ptrCast(output_digest_slice));
                return output_digest_slice[0..self.digest_length];
            }
        }
        @panic("unreachable");
    }

    fn deinit(self: *CryptoHasherZig) void {
        inline for (algo_map) |item| {
            if (self.algorithm == @field(EVP.Algorithm, item[0])) {
                return bun.destroy(@as(*item[1], @ptrCast(@alignCast(self.state))));
            }
        }
        @panic("unreachable");
    }
};

fn StaticCryptoHasher(comptime Hasher: type, comptime name: [:0]const u8) type {
    return struct {
        hashing: Hasher = Hasher{},

        const ThisHasher = @This();

        pub usingnamespace @field(JSC.Codegen, "JS" ++ name);

        pub const digest = JSC.wrapInstanceMethod(ThisHasher, "digest_", false);
        pub const hash = JSC.wrapStaticMethod(ThisHasher, "hash_", false);

        pub fn getByteLength(
            _: *@This(),
            _: *JSC.JSGlobalObject,
        ) JSC.JSValue {
            return JSC.JSValue.jsNumber(@as(u16, Hasher.digest));
        }

        pub fn getByteLengthStatic(
            _: *JSC.JSGlobalObject,
            _: JSValue,
            _: JSValue,
        ) JSC.JSValue {
            return JSC.JSValue.jsNumber(@as(u16, Hasher.digest));
        }

        fn hashToEncoding(
            globalThis: *JSGlobalObject,
            input: JSC.Node.BlobOrStringOrBuffer,
            encoding: JSC.Node.Encoding,
        ) JSC.JSValue {
            var output_digest_buf: Hasher.Digest = undefined;

            if (input == .blob and input.blob.isBunFile()) {
                globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
                return .zero;
            }

            if (comptime @typeInfo(@TypeOf(Hasher.hash)).Fn.params.len == 3) {
                Hasher.hash(input.slice(), &output_digest_buf, JSC.VirtualMachine.get().rareData().boringEngine());
            } else {
                Hasher.hash(input.slice(), &output_digest_buf);
            }

            return encoding.encodeWithSize(globalThis, Hasher.digest, &output_digest_buf);
        }

        fn hashToBytes(
            globalThis: *JSGlobalObject,
            input: JSC.Node.BlobOrStringOrBuffer,
            output: ?JSC.ArrayBuffer,
        ) JSC.JSValue {
            var output_digest_buf: Hasher.Digest = undefined;
            var output_digest_slice: *Hasher.Digest = &output_digest_buf;
            if (output) |output_buf| {
                var bytes = output_buf.byteSlice();
                if (bytes.len < Hasher.digest) {
                    globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{Hasher.digest}), .{});
                    return JSC.JSValue.zero;
                }
                output_digest_slice = bytes[0..Hasher.digest];
            }

            if (comptime @typeInfo(@TypeOf(Hasher.hash)).Fn.params.len == 3) {
                Hasher.hash(input.slice(), output_digest_slice, JSC.VirtualMachine.get().rareData().boringEngine());
            } else {
                Hasher.hash(input.slice(), output_digest_slice);
            }

            if (output) |output_buf| {
                return output_buf.value;
            } else {
                var array_buffer_out = JSC.ArrayBuffer.fromBytes(bun.default_allocator.dupe(u8, output_digest_slice) catch unreachable, .Uint8Array);
                return array_buffer_out.toJSUnchecked(globalThis, null);
            }
        }

        pub fn hash_(
            globalThis: *JSGlobalObject,
            input: JSC.Node.BlobOrStringOrBuffer,
            output: ?JSC.Node.StringOrBuffer,
        ) JSC.JSValue {
            defer input.deinit();

            if (input == .blob and input.blob.isBunFile()) {
                globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
                return .zero;
            }

            if (output) |string_or_buffer| {
                switch (string_or_buffer) {
                    inline else => |*str| {
                        defer str.deinit();
                        const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                            globalThis.throwInvalidArguments("Unknown encoding: {s}", .{str.slice()});
                            return JSC.JSValue.zero;
                        };

                        return hashToEncoding(globalThis, input, encoding);
                    },
                    .buffer => |buffer| {
                        return hashToBytes(globalThis, input, buffer.buffer);
                    },
                }
            } else {
                return hashToBytes(globalThis, input, null);
            }
        }

        pub fn constructor(_: *JSC.JSGlobalObject, _: *JSC.CallFrame) ?*@This() {
            const this = bun.default_allocator.create(@This()) catch return null;

            this.* = .{ .hashing = Hasher.init() };
            return this;
        }

        pub fn getter(
            globalObject: *JSC.JSGlobalObject,
            _: *JSC.JSObject,
        ) JSC.JSValue {
            return ThisHasher.getConstructor(globalObject);
        }

        pub fn update(this: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
            const thisValue = callframe.this();
            const input = callframe.argument(0);
            const buffer = JSC.Node.BlobOrStringOrBuffer.fromJS(globalThis, globalThis.bunVM().allocator, input) orelse {
                globalThis.throwInvalidArguments("expected blob or string or buffer", .{});
                return JSC.JSValue.zero;
            };
            defer buffer.deinit();

            if (buffer == .blob and buffer.blob.isBunFile()) {
                globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
                return .zero;
            }
            this.hashing.update(buffer.slice());
            return thisValue;
        }

        pub fn digest_(
            this: *@This(),
            globalThis: *JSGlobalObject,
            output: ?JSC.Node.StringOrBuffer,
        ) JSC.JSValue {
            if (output) |*string_or_buffer| {
                switch (string_or_buffer.*) {
                    inline else => |*str| {
                        defer str.deinit();
                        const encoding = JSC.Node.Encoding.from(str.slice()) orelse {
                            globalThis.throwInvalidArguments("Unknown encoding: \"{s}\"", .{str.slice()});
                            return JSC.JSValue.zero;
                        };

                        return this.digestToEncoding(globalThis, encoding);
                    },
                    .buffer => |*buffer| {
                        return this.digestToBytes(
                            globalThis,
                            buffer.buffer,
                        );
                    },
                }
            } else {
                return this.digestToBytes(globalThis, null);
            }
        }

        fn digestToBytes(this: *@This(), globalThis: *JSGlobalObject, output: ?JSC.ArrayBuffer) JSC.JSValue {
            var output_digest_buf: Hasher.Digest = undefined;
            var output_digest_slice: *Hasher.Digest = &output_digest_buf;
            if (output) |output_buf| {
                var bytes = output_buf.byteSlice();
                if (bytes.len < Hasher.digest) {
                    globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{Hasher.digest}), .{});
                    return JSC.JSValue.zero;
                }
                output_digest_slice = bytes[0..Hasher.digest];
            } else {
                output_digest_buf = std.mem.zeroes(Hasher.Digest);
            }

            this.hashing.final(output_digest_slice);

            if (output) |output_buf| {
                return output_buf.value;
            } else {
                var array_buffer_out = JSC.ArrayBuffer.fromBytes(bun.default_allocator.dupe(u8, &output_digest_buf) catch unreachable, .Uint8Array);
                return array_buffer_out.toJSUnchecked(globalThis, null);
            }
        }

        fn digestToEncoding(this: *@This(), globalThis: *JSGlobalObject, encoding: JSC.Node.Encoding) JSC.JSValue {
            var output_digest_buf: Hasher.Digest = comptime brk: {
                var bytes: Hasher.Digest = undefined;
                var i: usize = 0;
                while (i < Hasher.digest) {
                    bytes[i] = 0;
                    i += 1;
                }
                break :brk bytes;
            };

            const output_digest_slice: *Hasher.Digest = &output_digest_buf;

            this.hashing.final(output_digest_slice);

            return encoding.encodeWithSize(globalThis, Hasher.digest, output_digest_slice);
        }

        pub fn finalize(this: *@This()) void {
            VirtualMachine.get().allocator.destroy(this);
        }
    };
}

pub const MD4 = StaticCryptoHasher(Hashers.MD4, "MD4");
pub const MD5 = StaticCryptoHasher(Hashers.MD5, "MD5");
pub const SHA1 = StaticCryptoHasher(Hashers.SHA1, "SHA1");
pub const SHA224 = StaticCryptoHasher(Hashers.SHA224, "SHA224");
pub const SHA256 = StaticCryptoHasher(Hashers.SHA256, "SHA256");
pub const SHA384 = StaticCryptoHasher(Hashers.SHA384, "SHA384");
pub const SHA512 = StaticCryptoHasher(Hashers.SHA512, "SHA512");
pub const SHA512_256 = StaticCryptoHasher(Hashers.SHA512_256, "SHA512_256");

pub const Sign = @import("./crypto/sign.zig").Sign;