pub const CryptoHasher = union(enum) {
    // HMAC_CTX contains 3 EVP_CTX, so let's store it as a pointer.
    hmac: ?*HMAC,

    evp: EVP,
    zig: CryptoHasherZig,

    const Digest = EVP.Digest;

    pub const js = jsc.Codegen.JSCryptoHasher;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub const new = bun.TrivialNew(@This());

    // For using only CryptoHasherZig in c++
    pub const Extern = struct {
        fn getByName(global: *JSGlobalObject, name_bytes: [*:0]const u8, name_len: usize) callconv(.c) ?*CryptoHasher {
            const name = name_bytes[0..name_len];

            if (CryptoHasherZig.init(name)) |inner| {
                return CryptoHasher.new(.{
                    .zig = inner,
                });
            }

            const algorithm = EVP.Algorithm.map.get(name) orelse {
                return null;
            };

            switch (algorithm) {
                .ripemd160,
                .blake2b256,
                .blake2b512,

                .@"sha512-224",
                => {
                    if (algorithm.md()) |md| {
                        return CryptoHasher.new(.{
                            .evp = EVP.init(algorithm, md, global.bunVM().rareData().boringEngine()),
                        });
                    }
                },
                else => {
                    return null;
                },
            }

            return null;
        }

        fn getFromOther(global: *JSGlobalObject, other_handle: *CryptoHasher) callconv(.c) ?*CryptoHasher {
            switch (other_handle.*) {
                .zig => |other| {
                    const hasher = CryptoHasher.new(.{
                        .zig = other.copy(),
                    });
                    return hasher;
                },
                .evp => |other| {
                    return CryptoHasher.new(.{
                        .evp = other.copy(global.bunVM().rareData().boringEngine()) catch {
                            return null;
                        },
                    });
                },
                else => {
                    return null;
                },
            }
        }

        fn destroy(handle: *CryptoHasher) callconv(.c) void {
            handle.finalize();
        }

        fn update(handle: *CryptoHasher, input_bytes: [*]const u8, input_len: usize) callconv(.c) bool {
            const input = input_bytes[0..input_len];

            switch (handle.*) {
                .zig => {
                    handle.zig.update(input);
                    return true;
                },
                .evp => {
                    handle.evp.update(input);
                    return true;
                },
                else => {
                    return false;
                },
            }
        }

        fn digest(handle: *CryptoHasher, global: *JSGlobalObject, buf: [*]u8, buf_len: usize) callconv(.c) u32 {
            const digest_buf = buf[0..buf_len];
            switch (handle.*) {
                .zig => {
                    const res = handle.zig.finalWithLen(digest_buf, buf_len);
                    return @intCast(res.len);
                },
                .evp => {
                    const res = handle.evp.final(global.bunVM().rareData().boringEngine(), digest_buf);
                    return @intCast(res.len);
                },
                else => {
                    return 0;
                },
            }
        }

        fn getDigestSize(handle: *CryptoHasher) callconv(.c) u32 {
            return switch (handle.*) {
                .zig => |inner| inner.digest_length,
                .evp => |inner| inner.size(),
                else => 0,
            };
        }

        pub fn @"export"() void {
            @export(&CryptoHasher.Extern.getByName, .{ .name = "Bun__CryptoHasherExtern__getByName" });
            @export(&CryptoHasher.Extern.getFromOther, .{ .name = "Bun__CryptoHasherExtern__getFromOther" });
            @export(&CryptoHasher.Extern.destroy, .{ .name = "Bun__CryptoHasherExtern__destroy" });
            @export(&CryptoHasher.Extern.update, .{ .name = "Bun__CryptoHasherExtern__update" });
            @export(&CryptoHasher.Extern.digest, .{ .name = "Bun__CryptoHasherExtern__digest" });
            @export(&CryptoHasher.Extern.getDigestSize, .{ .name = "Bun__CryptoHasherExtern__getDigestSize" });
        }
    };

    pub const digest = jsc.host_fn.wrapInstanceMethod(CryptoHasher, "digest_", false);
    pub const hash = jsc.host_fn.wrapStaticMethod(CryptoHasher, "hash_", false);

    fn throwHmacConsumed(globalThis: *jsc.JSGlobalObject) bun.JSError {
        return globalThis.throw("HMAC has been consumed and is no longer usable", .{});
    }

    pub fn getByteLength(this: *CryptoHasher, globalThis: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return jsc.JSValue.jsNumber(switch (this.*) {
            .evp => |*inner| inner.size(),
            .hmac => |inner| if (inner) |hmac| hmac.size() else {
                return throwHmacConsumed(globalThis);
            },
            .zig => |*inner| inner.digest_length,
        });
    }

    pub fn getAlgorithm(this: *CryptoHasher, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
        return switch (this.*) {
            inline .evp, .zig => |*inner| ZigString.fromUTF8(bun.asByteSlice(@tagName(inner.algorithm))).toJS(globalObject),
            .hmac => |inner| if (inner) |hmac| ZigString.fromUTF8(bun.asByteSlice(@tagName(hmac.algorithm))).toJS(globalObject) else {
                return throwHmacConsumed(globalObject);
            },
        };
    }

    pub fn getAlgorithms(globalThis_: *jsc.JSGlobalObject, _: JSValue, _: JSValue) bun.JSError!jsc.JSValue {
        return bun.String.toJSArray(globalThis_, &EVP.Algorithm.names.values);
    }

    fn hashToEncoding(globalThis: *JSGlobalObject, evp: *EVP, input: jsc.Node.BlobOrStringOrBuffer, encoding: jsc.Node.Encoding) bun.JSError!jsc.JSValue {
        var output_digest_buf: Digest = undefined;
        defer input.deinit();

        if (input == .blob and input.blob.isBunFile()) {
            return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
        }

        const len = evp.hash(globalThis.bunVM().rareData().boringEngine(), input.slice(), &output_digest_buf) orelse {
            const err = BoringSSL.ERR_get_error();
            const instance = createCryptoError(globalThis, err);
            BoringSSL.ERR_clear_error();
            return globalThis.throwValue(instance);
        };
        return encoding.encodeWithMaxSize(globalThis, BoringSSL.EVP_MAX_MD_SIZE, output_digest_buf[0..len]);
    }

    fn hashToBytes(globalThis: *JSGlobalObject, evp: *EVP, input: jsc.Node.BlobOrStringOrBuffer, output: ?jsc.ArrayBuffer) bun.JSError!jsc.JSValue {
        var output_digest_buf: Digest = undefined;
        var output_digest_slice: []u8 = &output_digest_buf;
        defer input.deinit();

        if (input == .blob and input.blob.isBunFile()) {
            return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
        }

        if (output) |output_buf| {
            const size = evp.size();
            var bytes = output_buf.byteSlice();
            if (bytes.len < size) {
                return globalThis.throwInvalidArguments("TypedArray must be at least {d} bytes", .{size});
            }
            output_digest_slice = bytes[0..size];
        }

        const len = evp.hash(globalThis.bunVM().rareData().boringEngine(), input.slice(), output_digest_slice) orelse {
            const err = BoringSSL.ERR_get_error();
            const instance = createCryptoError(globalThis, err);
            BoringSSL.ERR_clear_error();
            return globalThis.throwValue(instance);
        };

        if (output) |output_buf| {
            return output_buf.value;
        } else {
            // Clone to GC-managed memory
            return jsc.ArrayBuffer.createBuffer(globalThis, output_digest_slice[0..len]);
        }
    }

    pub fn hash_(
        globalThis: *JSGlobalObject,
        algorithm: ZigString,
        input: jsc.Node.BlobOrStringOrBuffer,
        output: ?jsc.Node.StringOrBuffer,
    ) bun.JSError!jsc.JSValue {
        var evp = EVP.byName(algorithm, globalThis) orelse return try CryptoHasherZig.hashByName(globalThis, algorithm, input, output) orelse {
            return globalThis.throwInvalidArguments("Unsupported algorithm \"{f}\"", .{algorithm});
        };
        defer evp.deinit();

        if (output) |string_or_buffer| {
            switch (string_or_buffer) {
                inline else => |*str| {
                    defer str.deinit();
                    const encoding = jsc.Node.Encoding.from(str.slice()) orelse {
                        return globalThis.ERR(.INVALID_ARG_VALUE, "Unknown encoding: {s}", .{str.slice()}).throw();
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

    // Bun.CryptoHasher(algorithm, hmacKey?: string | Buffer)
    pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*CryptoHasher {
        const arguments = callframe.arguments_old(2);
        if (arguments.len == 0) {
            return globalThis.throwInvalidArguments("Expected an algorithm name as an argument", .{});
        }

        const algorithm_name = arguments.ptr[0];
        if (algorithm_name.isEmptyOrUndefinedOrNull() or !algorithm_name.isString()) {
            return globalThis.throwInvalidArguments("algorithm must be a string", .{});
        }

        const algorithm = try algorithm_name.getZigString(globalThis);

        if (algorithm.len == 0) {
            return globalThis.throwInvalidArguments("Invalid algorithm name", .{});
        }

        const hmac_value = arguments.ptr[1];
        var hmac_key: ?jsc.Node.StringOrBuffer = null;
        defer {
            if (hmac_key) |*key| {
                key.deinit();
            }
        }

        if (!hmac_value.isEmptyOrUndefinedOrNull()) {
            hmac_key = try jsc.Node.StringOrBuffer.fromJS(globalThis, bun.default_allocator, hmac_value) orelse {
                return globalThis.throwInvalidArguments("key must be a string or buffer", .{});
            };
        }

        return CryptoHasher.new(brk: {
            if (hmac_key) |*key| {
                const chosen_algorithm = try algorithm_name.toEnumFromMap(globalThis, "algorithm", EVP.Algorithm, EVP.Algorithm.map);
                if (chosen_algorithm == .ripemd160) {
                    // crashes at runtime.
                    return globalThis.throw("ripemd160 is not supported", .{});
                }

                break :brk .{
                    .hmac = HMAC.init(chosen_algorithm, key.slice()) orelse {
                        if (!globalThis.hasException()) {
                            const err = BoringSSL.ERR_get_error();
                            if (err != 0) {
                                const instance = createCryptoError(globalThis, err);
                                BoringSSL.ERR_clear_error();
                                return globalThis.throwValue(instance);
                            } else {
                                return globalThis.throwTODO("HMAC is not supported for this algorithm yet");
                            }
                        }
                        return error.JSError;
                    },
                };
            }

            break :brk .{
                .evp = EVP.byName(algorithm, globalThis) orelse return CryptoHasherZig.constructor(algorithm) orelse {
                    return globalThis.throwInvalidArguments("Unsupported algorithm {f}", .{algorithm});
                },
            };
        });
    }

    pub fn getter(
        globalObject: *jsc.JSGlobalObject,
        _: *jsc.JSObject,
    ) jsc.JSValue {
        return CryptoHasher.js.getConstructor(globalObject);
    }

    pub fn update(this: *CryptoHasher, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const thisValue = callframe.this();
        const arguments = callframe.arguments_old(2);
        const input = arguments.ptr[0];
        if (input.isEmptyOrUndefinedOrNull()) {
            return globalThis.throwInvalidArguments("expected blob, string or buffer", .{});
        }
        const encoding = arguments.ptr[1];
        const buffer = try jsc.Node.BlobOrStringOrBuffer.fromJSWithEncodingValue(globalThis, globalThis.bunVM().allocator, input, encoding) orelse {
            if (!globalThis.hasException()) return globalThis.throwInvalidArguments("expected blob, string or buffer", .{});
            return error.JSError;
        };
        defer buffer.deinit();
        if (buffer == .blob and buffer.blob.isBunFile()) {
            return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
        }

        switch (this.*) {
            .evp => |*inner| {
                inner.update(buffer.slice());
                const err = BoringSSL.ERR_get_error();
                if (err != 0) {
                    const instance = createCryptoError(globalThis, err);
                    BoringSSL.ERR_clear_error();
                    return globalThis.throwValue(instance);
                }
            },
            .hmac => |inner| {
                const hmac = inner orelse {
                    return throwHmacConsumed(globalThis);
                };

                hmac.update(buffer.slice());
                const err = BoringSSL.ERR_get_error();
                if (err != 0) {
                    const instance = createCryptoError(globalThis, err);
                    BoringSSL.ERR_clear_error();
                    return globalThis.throwValue(instance);
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
        globalObject: *jsc.JSGlobalObject,
        _: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        const copied: CryptoHasher = switch (this.*) {
            .evp => |*inner| .{ .evp = bun.handleOom(inner.copy(globalObject.bunVM().rareData().boringEngine())) },
            .hmac => |inner| brk: {
                const hmac = inner orelse {
                    return throwHmacConsumed(globalObject);
                };
                break :brk .{
                    .hmac = hmac.copy() catch {
                        const err = createCryptoError(globalObject, BoringSSL.ERR_get_error());
                        BoringSSL.ERR_clear_error();
                        return globalObject.throwValue(err);
                    },
                };
            },
            .zig => |*inner| .{ .zig = inner.copy() },
        };
        return CryptoHasher.new(copied).toJS(globalObject);
    }

    pub fn digest_(this: *CryptoHasher, globalThis: *JSGlobalObject, output: ?jsc.Node.StringOrBuffer) bun.JSError!jsc.JSValue {
        if (output) |string_or_buffer| {
            switch (string_or_buffer) {
                inline else => |*str| {
                    defer str.deinit();
                    const encoding = jsc.Node.Encoding.from(str.slice()) orelse {
                        return globalThis.ERR(.INVALID_ARG_VALUE, "Unknown encoding: {s}", .{str.slice()}).throw();
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

    fn digestToBytes(this: *CryptoHasher, globalThis: *JSGlobalObject, output: ?jsc.ArrayBuffer) bun.JSError!jsc.JSValue {
        var output_digest_buf: EVP.Digest = undefined;
        var output_digest_slice: []u8 = &output_digest_buf;
        if (output) |output_buf| {
            var bytes = output_buf.byteSlice();
            if (bytes.len < output_digest_buf.len) {
                return globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{output_digest_buf.len}), .{});
            }
            output_digest_slice = bytes[0..bytes.len];
        } else {
            output_digest_buf = std.mem.zeroes(EVP.Digest);
        }

        const result = this.final(globalThis, output_digest_slice) catch return .zero;
        if (globalThis.hasException()) {
            return error.JSError;
        }

        if (output) |output_buf| {
            return output_buf.value;
        } else {
            // Clone to GC-managed memory
            return jsc.ArrayBuffer.createBuffer(globalThis, result);
        }
    }

    fn digestToEncoding(this: *CryptoHasher, globalThis: *JSGlobalObject, encoding: jsc.Node.Encoding) bun.JSError!jsc.JSValue {
        var output_digest_buf: EVP.Digest = std.mem.zeroes(EVP.Digest);
        const output_digest_slice: []u8 = &output_digest_buf;
        const out = this.final(globalThis, output_digest_slice) catch return .zero;
        if (globalThis.hasException()) {
            return error.JSError;
        }
        return encoding.encodeWithMaxSize(globalThis, BoringSSL.EVP_MAX_MD_SIZE, out);
    }

    fn final(this: *CryptoHasher, globalThis: *JSGlobalObject, output_digest_slice: []u8) bun.JSError![]u8 {
        return switch (this.*) {
            .hmac => |inner| brk: {
                const hmac: *HMAC = inner orelse {
                    return throwHmacConsumed(globalThis);
                };
                this.hmac = null;
                defer hmac.deinit();
                break :brk hmac.final(output_digest_slice);
            },
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
            .hmac => |inner| {
                if (inner) |hmac| {
                    hmac.deinit();
                }
            },
        }
        bun.destroy(this);
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
        .{ "blake2s256", std.crypto.hash.blake2.Blake2s256 },
    };

    inline fn digestLength(Algorithm: type) comptime_int {
        return switch (Algorithm) {
            std.crypto.hash.sha3.Shake128 => 16,
            std.crypto.hash.sha3.Shake256 => 32,
            else => Algorithm.digest_length,
        };
    }

    pub fn hashByName(globalThis: *JSGlobalObject, algorithm: ZigString, input: jsc.Node.BlobOrStringOrBuffer, output: ?jsc.Node.StringOrBuffer) bun.JSError!?jsc.JSValue {
        inline for (algo_map) |item| {
            if (bun.strings.eqlComptime(algorithm.slice(), item[0])) {
                return try hashByNameInner(globalThis, item[1], input, output);
            }
        }
        return null;
    }

    fn hashByNameInner(globalThis: *JSGlobalObject, comptime Algorithm: type, input: jsc.Node.BlobOrStringOrBuffer, output: ?jsc.Node.StringOrBuffer) bun.JSError!jsc.JSValue {
        if (output) |string_or_buffer| {
            switch (string_or_buffer) {
                inline else => |*str| {
                    defer str.deinit();
                    const encoding = jsc.Node.Encoding.from(str.slice()) orelse {
                        return globalThis.ERR(.INVALID_ARG_VALUE, "Unknown encoding: {s}", .{str.slice()}).throw();
                    };

                    if (encoding == .buffer) {
                        return hashByNameInnerToBytes(globalThis, Algorithm, input, null);
                    }

                    return hashByNameInnerToString(globalThis, Algorithm, input, encoding);
                },
                .buffer => |buffer| {
                    return hashByNameInnerToBytes(globalThis, Algorithm, input, buffer.buffer);
                },
            }
        }
        return hashByNameInnerToBytes(globalThis, Algorithm, input, null);
    }

    fn hashByNameInnerToString(globalThis: *JSGlobalObject, comptime Algorithm: type, input: jsc.Node.BlobOrStringOrBuffer, encoding: jsc.Node.Encoding) bun.JSError!jsc.JSValue {
        defer input.deinit();

        if (input == .blob and input.blob.isBunFile()) {
            return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
        }

        var h = Algorithm.init(.{});
        h.update(input.slice());

        var out: [digestLength(Algorithm)]u8 = undefined;
        h.final(&out);

        return encoding.encodeWithSize(globalThis, digestLength(Algorithm), &out);
    }

    fn hashByNameInnerToBytes(globalThis: *JSGlobalObject, comptime Algorithm: type, input: jsc.Node.BlobOrStringOrBuffer, output: ?jsc.ArrayBuffer) bun.JSError!jsc.JSValue {
        defer input.deinit();

        if (input == .blob and input.blob.isBunFile()) {
            return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
        }

        var h = Algorithm.init(.{});
        const digest_length_comptime = digestLength(Algorithm);

        if (output) |output_buf| {
            if (output_buf.byteSlice().len < digest_length_comptime) {
                return globalThis.throwInvalidArguments("TypedArray must be at least {d} bytes", .{digest_length_comptime});
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
            return jsc.ArrayBuffer.createBuffer(globalThis, &out);
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

    pub fn init(algorithm: []const u8) ?CryptoHasherZig {
        inline for (algo_map) |item| {
            const name, const T = item;
            if (bun.strings.eqlComptime(algorithm, name)) {
                const handle: CryptoHasherZig = .{
                    .algorithm = @field(EVP.Algorithm, name),
                    .state = bun.new(T, T.init(.{})),
                    .digest_length = digestLength(T),
                };

                return handle;
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

    fn finalWithLen(self: *CryptoHasherZig, output_digest_slice: []u8, res_len: usize) []u8 {
        inline for (algo_map) |pair| {
            const name, const T = pair;
            if (self.algorithm == @field(EVP.Algorithm, name)) {
                T.final(@ptrCast(@alignCast(self.state)), @ptrCast(output_digest_slice));
                const reset: *T = @ptrCast(@alignCast(self.state));
                reset.* = T.init(.{});
                return output_digest_slice[0..res_len];
            }
        }
        @panic("unreachable");
    }

    fn final(self: *CryptoHasherZig, output_digest_slice: []u8) []u8 {
        return self.finalWithLen(output_digest_slice, self.digest_length);
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
        digested: bool = false,

        const ThisHasher = @This();

        pub const js = @field(jsc.Codegen, "JS" ++ name);
        pub const toJS = js.toJS;
        pub const fromJS = js.fromJS;
        pub const fromJSDirect = js.fromJSDirect;

        pub const digest = host_fn.wrapInstanceMethod(ThisHasher, "digest_", false);
        pub const hash = host_fn.wrapStaticMethod(ThisHasher, "hash_", false);

        pub fn getByteLength(
            _: *@This(),
            _: *jsc.JSGlobalObject,
        ) jsc.JSValue {
            return jsc.JSValue.jsNumber(@as(u16, Hasher.digest));
        }

        pub fn getByteLengthStatic(
            _: *jsc.JSGlobalObject,
            _: JSValue,
            _: JSValue,
        ) jsc.JSValue {
            return jsc.JSValue.jsNumber(@as(u16, Hasher.digest));
        }

        fn hashToEncoding(globalThis: *JSGlobalObject, input: jsc.Node.BlobOrStringOrBuffer, encoding: jsc.Node.Encoding) bun.JSError!jsc.JSValue {
            var output_digest_buf: Hasher.Digest = undefined;

            if (input == .blob and input.blob.isBunFile()) {
                return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            }

            if (comptime @typeInfo(@TypeOf(Hasher.hash)).@"fn".params.len == 3) {
                Hasher.hash(input.slice(), &output_digest_buf, jsc.VirtualMachine.get().rareData().boringEngine());
            } else {
                Hasher.hash(input.slice(), &output_digest_buf);
            }

            return encoding.encodeWithSize(globalThis, Hasher.digest, &output_digest_buf);
        }

        fn hashToBytes(globalThis: *JSGlobalObject, input: jsc.Node.BlobOrStringOrBuffer, output: ?jsc.ArrayBuffer) bun.JSError!jsc.JSValue {
            var output_digest_buf: Hasher.Digest = undefined;
            var output_digest_slice: *Hasher.Digest = &output_digest_buf;
            if (output) |output_buf| {
                var bytes = output_buf.byteSlice();
                if (bytes.len < Hasher.digest) {
                    return globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{Hasher.digest}), .{});
                }
                output_digest_slice = bytes[0..Hasher.digest];
            }

            if (comptime @typeInfo(@TypeOf(Hasher.hash)).@"fn".params.len == 3) {
                Hasher.hash(input.slice(), output_digest_slice, jsc.VirtualMachine.get().rareData().boringEngine());
            } else {
                Hasher.hash(input.slice(), output_digest_slice);
            }

            if (output) |output_buf| {
                return output_buf.value;
            } else {
                var array_buffer_out = jsc.ArrayBuffer.fromBytes(bun.default_allocator.dupe(u8, output_digest_slice) catch unreachable, .Uint8Array);
                return array_buffer_out.toJSUnchecked(globalThis);
            }
        }

        pub fn hash_(
            globalThis: *JSGlobalObject,
            input: jsc.Node.BlobOrStringOrBuffer,
            output: ?jsc.Node.StringOrBuffer,
        ) bun.JSError!jsc.JSValue {
            defer input.deinit();

            if (input == .blob and input.blob.isBunFile()) {
                return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            }

            if (output) |string_or_buffer| {
                switch (string_or_buffer) {
                    inline else => |*str| {
                        defer str.deinit();
                        const encoding = jsc.Node.Encoding.from(str.slice()) orelse {
                            return globalThis.ERR(.INVALID_ARG_VALUE, "Unknown encoding: {s}", .{str.slice()}).throw();
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

        pub fn constructor(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*@This() {
            const this = try bun.default_allocator.create(@This());
            this.* = .{ .hashing = Hasher.init() };
            return this;
        }

        pub fn getter(
            globalObject: *jsc.JSGlobalObject,
            _: *jsc.JSObject,
        ) jsc.JSValue {
            return ThisHasher.js.getConstructor(globalObject);
        }

        pub fn update(this: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
            if (this.digested) {
                return globalThis.ERR(.INVALID_STATE, name ++ " hasher already digested, create a new instance to update", .{}).throw();
            }
            const thisValue = callframe.this();
            const input = callframe.argument(0);
            const buffer = try jsc.Node.BlobOrStringOrBuffer.fromJS(globalThis, globalThis.bunVM().allocator, input) orelse {
                return globalThis.throwInvalidArguments("expected blob or string or buffer", .{});
            };
            defer buffer.deinit();

            if (buffer == .blob and buffer.blob.isBunFile()) {
                return globalThis.throw("Bun.file() is not supported here yet (it needs an async version)", .{});
            }
            this.hashing.update(buffer.slice());
            return thisValue;
        }

        pub fn digest_(
            this: *@This(),
            globalThis: *JSGlobalObject,
            output: ?jsc.Node.StringOrBuffer,
        ) bun.JSError!jsc.JSValue {
            if (this.digested) {
                return globalThis.ERR(.INVALID_STATE, name ++ " hasher already digested, create a new instance to digest again", .{}).throw();
            }
            if (output) |*string_or_buffer| {
                switch (string_or_buffer.*) {
                    inline else => |*str| {
                        defer str.deinit();
                        const encoding = jsc.Node.Encoding.from(str.slice()) orelse {
                            return globalThis.ERR(.INVALID_ARG_VALUE, "Unknown encoding: {s}", .{str.slice()}).throw();
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

        fn digestToBytes(this: *@This(), globalThis: *JSGlobalObject, output: ?jsc.ArrayBuffer) bun.JSError!jsc.JSValue {
            var output_digest_buf: Hasher.Digest = undefined;
            var output_digest_slice: *Hasher.Digest = &output_digest_buf;
            if (output) |output_buf| {
                var bytes = output_buf.byteSlice();
                if (bytes.len < Hasher.digest) {
                    return globalThis.throwInvalidArguments(comptime std.fmt.comptimePrint("TypedArray must be at least {d} bytes", .{Hasher.digest}), .{});
                }
                output_digest_slice = bytes[0..Hasher.digest];
            } else {
                output_digest_buf = std.mem.zeroes(Hasher.Digest);
            }

            this.hashing.final(output_digest_slice);
            this.digested = true;

            if (output) |output_buf| {
                return output_buf.value;
            } else {
                var array_buffer_out = jsc.ArrayBuffer.fromBytes(bun.default_allocator.dupe(u8, &output_digest_buf) catch unreachable, .Uint8Array);
                return array_buffer_out.toJSUnchecked(globalThis);
            }
        }

        fn digestToEncoding(this: *@This(), globalThis: *JSGlobalObject, encoding: jsc.Node.Encoding) bun.JSError!jsc.JSValue {
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
            this.digested = true;

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

const string = []const u8;

const Hashers = @import("../../../sha.zig");
const std = @import("std");

const bun = @import("bun");
const default_allocator = bun.default_allocator;
const strings = bun.strings;
const BoringSSL = bun.BoringSSL.c;

const jsc = bun.jsc;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const VirtualMachine = jsc.VirtualMachine;
const ZigString = jsc.ZigString;
const host_fn = bun.jsc.host_fn;

const Crypto = jsc.API.Bun.Crypto;
const EVP = Crypto.EVP;
const HMAC = Crypto.HMAC;
const createCryptoError = Crypto.createCryptoError;
