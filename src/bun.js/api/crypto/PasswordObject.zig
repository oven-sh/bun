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

            pub fn fromJS(globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) bun.JSError!Value {
                if (value.isObject()) {
                    if (try value.getTruthy(globalObject, "algorithm")) |algorithm_value| {
                        if (!algorithm_value.isString()) {
                            return globalObject.throwInvalidArgumentType("hash", "algorithm", "string");
                        }

                        const algorithm_string = try algorithm_value.getZigString(globalObject);

                        switch (PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                            return globalObject.throwInvalidArgumentType("hash", "algorithm", unknown_password_algorithm_message);
                        }) {
                            .bcrypt => {
                                var algorithm = PasswordObject.Algorithm.Value{
                                    .bcrypt = PasswordObject.Algorithm.Value.bcrpyt_default,
                                };

                                if (try value.getTruthy(globalObject, "cost")) |rounds_value| {
                                    if (!rounds_value.isNumber()) {
                                        return globalObject.throwInvalidArgumentType("hash", "cost", "number");
                                    }

                                    const rounds = rounds_value.coerce(i32, globalObject);

                                    if (rounds < 4 or rounds > 31) {
                                        return globalObject.throwInvalidArguments("Rounds must be between 4 and 31", .{});
                                    }

                                    algorithm.bcrypt = @as(u6, @intCast(rounds));
                                }

                                return algorithm;
                            },
                            inline .argon2id, .argon2d, .argon2i => |tag| {
                                var argon = Algorithm.Argon2Params{};

                                if (try value.getTruthy(globalObject, "timeCost")) |time_value| {
                                    if (!time_value.isNumber()) {
                                        return globalObject.throwInvalidArgumentType("hash", "timeCost", "number");
                                    }

                                    const time_cost = time_value.coerce(i32, globalObject);

                                    if (time_cost < 1) {
                                        return globalObject.throwInvalidArguments("Time cost must be greater than 0", .{});
                                    }

                                    argon.time_cost = @as(u32, @intCast(time_cost));
                                }

                                if (try value.getTruthy(globalObject, "memoryCost")) |memory_value| {
                                    if (!memory_value.isNumber()) {
                                        return globalObject.throwInvalidArgumentType("hash", "memoryCost", "number");
                                    }

                                    const memory_cost = memory_value.coerce(i32, globalObject);

                                    if (memory_cost < 1) {
                                        return globalObject.throwInvalidArguments("Memory cost must be greater than 0", .{});
                                    }

                                    argon.memory_cost = @as(u32, @intCast(memory_cost));
                                }

                                return @unionInit(Algorithm.Value, @tagName(tag), argon);
                            },
                        }

                        unreachable;
                    } else {
                        return globalObject.throwInvalidArgumentType("hash", "options.algorithm", "string");
                    }
                } else if (value.isString()) {
                    const algorithm_string = try value.getZigString(globalObject);

                    switch (PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                        return globalObject.throwInvalidArgumentType("hash", "algorithm", unknown_password_algorithm_message);
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
                    return globalObject.throwInvalidArgumentType("hash", "algorithm", "string");
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
                    .params = pwhash.bcrypt.Params{
                        .rounds_log = cost,
                        .silently_truncate_password = true,
                    },
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
                pwhash.bcrypt.strVerify(previous_hash, password_to_use, .{
                    .allocator = allocator,
                    .silently_truncate_password = true,
                }) catch |err| {
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

        pub const new = bun.TrivialNew(@This());

        pub const Result = struct {
            value: Value,
            ref: Async.KeepAlive = .{},

            task: JSC.AnyTask = undefined,
            promise: JSC.JSPromise.Strong,
            global: *JSC.JSGlobalObject,

            pub const new = bun.TrivialNew(@This());

            pub const Value = union(enum) {
                err: PasswordObject.HashError,
                hash: []const u8,

                pub fn toErrorInstance(this: Value, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                    const error_code = std.fmt.allocPrint(bun.default_allocator, "PASSWORD{}", .{PascalToUpperUnderscoreCaseFormatter{ .input = @errorName(this.err) }}) catch bun.outOfMemory();
                    defer bun.default_allocator.free(error_code);
                    const instance = globalObject.createErrorInstance("Password hashing failed with error \"{s}\"", .{@errorName(this.err)});
                    instance.put(globalObject, ZigString.static("code"), JSC.ZigString.init(error_code).toJS(globalObject));
                    return instance;
                }
            };

            pub fn runFromJS(this: *Result) void {
                var promise = this.promise;
                defer promise.deinit();
                this.promise = .{};
                this.ref.unref(this.global.bunVM());
                const global = this.global;
                switch (this.value) {
                    .err => {
                        const error_instance = this.value.toErrorInstance(global);
                        bun.destroy(this);
                        promise.reject(global, error_instance);
                    },
                    .hash => |value| {
                        const js_string = JSC.ZigString.init(value).toJS(global);
                        bun.destroy(this);
                        promise.resolve(global, js_string);
                    },
                }
            }
        };

        pub fn deinit(this: *HashJob) void {
            this.promise.deinit();
            bun.freeSensitive(bun.default_allocator, this.password);
            bun.destroy(this);
        }

        pub fn getValue(password: []const u8, algorithm: PasswordObject.Algorithm.Value) Result.Value {
            const value = PasswordObject.hash(bun.default_allocator, password, algorithm) catch |err| {
                return Result.Value{ .err = err };
            };
            return Result.Value{ .hash = value };
        }

        pub fn run(task: *bun.ThreadPool.Task) void {
            var this: *HashJob = @fieldParentPtr("task", task);

            var result = Result.new(.{
                .value = getValue(this.password, this.algorithm),
                .task = undefined,
                .promise = this.promise,
                .global = this.global,
                .ref = this.ref,
            });
            this.promise = .empty;

            result.task = JSC.AnyTask.New(Result, Result.runFromJS).init(result);
            this.ref = .{};
            this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(&result.task));
            this.deinit();
        }
    };

    pub fn hash(globalObject: *JSC.JSGlobalObject, password: []const u8, algorithm: PasswordObject.Algorithm.Value, comptime sync: bool) bun.JSError!JSC.JSValue {
        assert(password.len > 0); // caller must check

        if (comptime sync) {
            const value = HashJob.getValue(password, algorithm);
            switch (value) {
                .err => {
                    const error_instance = value.toErrorInstance(globalObject);
                    return globalObject.throwValue(error_instance);
                },
                .hash => |h| {
                    return JSC.ZigString.init(h).toJS(globalObject);
                },
            }

            unreachable;
        }

        const promise = JSC.JSPromise.Strong.init(globalObject);

        var job = HashJob.new(.{
            .algorithm = algorithm,
            .password = password,
            .promise = promise,
            .event_loop = globalObject.bunVM().eventLoop(),
            .global = globalObject,
        });
        job.ref.ref(globalObject.bunVM());
        JSC.WorkPool.schedule(&job.task);

        return promise.value();
    }

    pub fn verify(globalObject: *JSC.JSGlobalObject, password: []const u8, prev_hash: []const u8, algorithm: ?PasswordObject.Algorithm, comptime sync: bool) bun.JSError!JSC.JSValue {
        assert(password.len > 0); // caller must check

        if (comptime sync) {
            const value = VerifyJob.getValue(password, prev_hash, algorithm);
            switch (value) {
                .err => {
                    const error_instance = value.toErrorInstance(globalObject);
                    return globalObject.throwValue(error_instance);
                },
                .pass => |pass| {
                    return JSC.JSValue.jsBoolean(pass);
                },
            }

            unreachable;
        }

        var promise = JSC.JSPromise.Strong.init(globalObject);

        const job = VerifyJob.new(.{
            .algorithm = algorithm,
            .password = password,
            .prev_hash = prev_hash,
            .promise = promise,
            .event_loop = globalObject.bunVM().eventLoop(),
            .global = globalObject,
        });
        job.ref.ref(globalObject.bunVM());
        JSC.WorkPool.schedule(&job.task);

        return promise.value();
    }

    // Once we have bindings generator, this should be replaced with a generated function
    pub fn JSPasswordObject__hash(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments_ = callframe.arguments_old(2);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            return globalObject.throwNotEnoughArguments("hash", 1, 0);
        }

        var algorithm = PasswordObject.Algorithm.Value.default;

        if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull()) {
            algorithm = try PasswordObject.Algorithm.Value.fromJS(globalObject, arguments[1]);
        }

        // TODO: this most likely should error like `hashSync` instead of stringifying.
        //
        // fromJS(...) orelse {
        //   return globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
        // }
        const password_to_hash = try JSC.Node.StringOrBuffer.fromJSToOwnedSlice(globalObject, arguments[0], bun.default_allocator);
        errdefer bun.default_allocator.free(password_to_hash);

        if (password_to_hash.len == 0) {
            return globalObject.throwInvalidArguments("password must not be empty", .{});
        }

        return hash(globalObject, password_to_hash, algorithm, false);
    }

    // Once we have bindings generator, this should be replaced with a generated function
    pub fn JSPasswordObject__hashSync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments_ = callframe.arguments_old(2);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 1) {
            return globalObject.throwNotEnoughArguments("hash", 1, 0);
        }

        var algorithm = PasswordObject.Algorithm.Value.default;

        if (arguments.len > 1 and !arguments[1].isEmptyOrUndefinedOrNull()) {
            algorithm = try PasswordObject.Algorithm.Value.fromJS(globalObject, arguments[1]);
        }

        var string_or_buffer = try JSC.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
            return globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
        };
        defer string_or_buffer.deinit();

        if (string_or_buffer.slice().len == 0) {
            return globalObject.throwInvalidArguments("password must not be empty", .{});
        }

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

        pub const new = bun.TrivialNew(@This());

        pub const Result = struct {
            value: Value,
            ref: Async.KeepAlive = .{},

            task: JSC.AnyTask = undefined,
            promise: JSC.JSPromise.Strong,
            global: *JSC.JSGlobalObject,

            pub const new = bun.TrivialNew(@This());

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
                defer promise.deinit();
                this.promise = .{};
                this.ref.unref(this.global.bunVM());
                const global = this.global;
                switch (this.value) {
                    .err => {
                        const error_instance = this.value.toErrorInstance(global);
                        bun.destroy(this);
                        promise.reject(global, error_instance);
                    },
                    .pass => |pass| {
                        bun.destroy(this);
                        promise.resolve(global, JSC.JSValue.jsBoolean(pass));
                    },
                }
            }
        };

        pub fn deinit(this: *VerifyJob) void {
            this.promise.deinit();

            bun.freeSensitive(bun.default_allocator, this.password);
            bun.freeSensitive(bun.default_allocator, this.prev_hash);

            bun.destroy(this);
        }

        pub fn getValue(password: []const u8, prev_hash: []const u8, algorithm: ?PasswordObject.Algorithm) Result.Value {
            const pass = PasswordObject.verify(bun.default_allocator, password, prev_hash, algorithm) catch |err| {
                return Result.Value{ .err = err };
            };
            return Result.Value{ .pass = pass };
        }

        pub fn run(task: *bun.ThreadPool.Task) void {
            var this: *VerifyJob = @fieldParentPtr("task", task);

            var result = Result.new(.{
                .value = getValue(this.password, this.prev_hash, this.algorithm),
                .task = undefined,
                .promise = this.promise,
                .global = this.global,
                .ref = this.ref,
            });
            this.promise = .empty;

            result.task = JSC.AnyTask.New(Result, Result.runFromJS).init(result);
            this.ref = .{};
            this.event_loop.enqueueTaskConcurrent(JSC.ConcurrentTask.createFrom(&result.task));
            this.deinit();
        }
    };

    // Once we have bindings generator, this should be replaced with a generated function
    pub fn JSPasswordObject__verify(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments_ = callframe.arguments_old(3);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 2) {
            return globalObject.throwNotEnoughArguments("verify", 2, 0);
        }

        var algorithm: ?PasswordObject.Algorithm = null;

        if (arguments.len > 2 and !arguments[2].isEmptyOrUndefinedOrNull()) {
            if (!arguments[2].isString()) {
                return globalObject.throwInvalidArgumentType("verify", "algorithm", "string");
            }

            const algorithm_string = try arguments[2].getZigString(globalObject);

            algorithm = PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                if (!globalObject.hasException()) {
                    return globalObject.throwInvalidArgumentType("verify", "algorithm", unknown_password_algorithm_message);
                }
                return error.JSError;
            };
        }

        // TODO: this most likely should error like `verifySync` instead of stringifying.
        //
        // fromJS(...) orelse {
        //   return globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
        // }
        const owned_password = try JSC.Node.StringOrBuffer.fromJSToOwnedSlice(globalObject, arguments[0], bun.default_allocator);

        // TODO: this most likely should error like `verifySync` instead of stringifying.
        //
        // fromJS(...) orelse {
        //   return globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
        // }
        const owned_hash = JSC.Node.StringOrBuffer.fromJSToOwnedSlice(globalObject, arguments[1], bun.default_allocator) catch |err| {
            bun.default_allocator.free(owned_password);
            return err;
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
    pub fn JSPasswordObject__verifySync(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const arguments_ = callframe.arguments_old(3);
        const arguments = arguments_.ptr[0..arguments_.len];

        if (arguments.len < 2) {
            return globalObject.throwNotEnoughArguments("verify", 2, 0);
        }

        var algorithm: ?PasswordObject.Algorithm = null;

        if (arguments.len > 2 and !arguments[2].isEmptyOrUndefinedOrNull()) {
            if (!arguments[2].isString()) {
                return globalObject.throwInvalidArgumentType("verify", "algorithm", "string");
            }

            const algorithm_string = try arguments[2].getZigString(globalObject);

            algorithm = PasswordObject.Algorithm.label.getWithEql(algorithm_string, JSC.ZigString.eqlComptime) orelse {
                if (!globalObject.hasException()) {
                    return globalObject.throwInvalidArgumentType("verify", "algorithm", unknown_password_algorithm_message);
                }
                return .zero;
            };
        }

        var password = try JSC.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[0]) orelse {
            return globalObject.throwInvalidArgumentType("verify", "password", "string or TypedArray");
        };

        var hash_ = try JSC.Node.StringOrBuffer.fromJS(globalObject, bun.default_allocator, arguments[1]) orelse {
            password.deinit();
            return globalObject.throwInvalidArgumentType("verify", "hash", "string or TypedArray");
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

const std = @import("std");
const bun = @import("bun");
const string = bun.string;
const strings = bun.strings;
const default_allocator = bun.default_allocator;
const JSC = bun.JSC;
const Async = bun.Async;
const ZigString = JSC.ZigString;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const CallFrame = JSC.CallFrame;
const assert = bun.assert;

const unknown_password_algorithm_message = "unknown algorithm, expected one of: \"bcrypt\", \"argon2id\", \"argon2d\", \"argon2i\" (default is \"argon2id\")";
