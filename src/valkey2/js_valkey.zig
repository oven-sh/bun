//! The JavaScript-driven Valkey client.
//! The declaration of all the public methods here is given in
//! `valkey.classes.ts` and the codegen will invoke these methods.
pub const JsValkey = struct {
    const Self = @This();

    /// The actual, underlying Valkey client.
    _client: ValkeyClient,

    pub fn init() JsValkey {
        return JsValkey{ ._client = ValkeyClient.init() };
    }

    /// Construct the JsValkey object.
    pub fn constructor(
        global_object: *bun.jsc.JSGlobalObject,
        callframe: *bun.jsc.CallFrame,
        js_this: bun.jsc.JSValue,
    ) bun.JSError!*JsValkey {
        _ = callframe;
        _ = js_this;
        return global_object.throw("RedisClient2 constructor not yet implemented", .{});
    }

    /// Duplicate the JsValkey object.
    pub fn duplicate() bun.JSError!*JsValkey {
        @panic("duplicate not yet implemented");
    }

    pub fn getConnected(
        self: *const Self,
        _: *bun.jsc.JSGlobalObject,
    ) bun.jsc.JSValue {
        return bun.jsc.JSValue.jsBoolean(self._client.isConnected());
    }

    pub fn connect(
        self: *Self,
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
    ) bun.JSError!bun.jsc.JSValue {
        _ = cf;

        return self._client.connect() catch |err| {
            switch (err) {
                .InvalidState => {
                    // The client is already connected.
                    return bun.jsc.JSPromise.resolvedPromiseValue(
                        go,
                        .js_undefined,
                    );
                },
            }
        };
    }

    pub fn close(
        self: *Self,
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
    ) bun.jsc.JSValue {
        _ = self;
        _ = go;
        _ = cf;
        return .js_undefined;
    }

    pub fn finalize(self: *Self) void {
        self._client.deinit();
    }

    pub fn memoryCost(self: *const Self) usize {
        return self._client.memoryUsage();
    }

    pub const js = bun.jsc.Codegen.JSRedisClient2;
};

const bun = @import("bun");
const ValkeyClient = @import("./valkey.zig").ValkeyClient;
