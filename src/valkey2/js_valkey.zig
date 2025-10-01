//! The JavaScript-driven Valkey client.
//! The declaration of all the public methods here is given in
//! `valkey.classes.ts` and the codegen will invoke these methods.
pub const JsValkey = struct {
    const DEFAULT_CONN_STR = "valkey://localhost:6379";

    const Self = @This();

    _client: ValkeyClient,
    _ref_count: RefCount,

    pub fn constructor(
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
    ) bun.JSError!*JsValkey {
        // Parse the arguments first.
        var args_parsed = try Self.parseConstructorArgs(go, cf);
        defer args_parsed.deinit();

        return Self.new(.{
            // TODO(markovejnovic): byteSlice() feels wrong if the URL contains
            // non-ASCII characters.
            ._client = try createClient(go, args_parsed.conn_str.byteSlice()),
            ._ref_count = RefCount.init(),
        });
    }

    /// Attempt to create the Valkey client.
    /// This may fail but will offer proper JS errors.
    fn createClient(
        go: *bun.jsc.JSGlobalObject,
        conn_str: []const u8,
    ) bun.JSError!ValkeyClient {
        const vm = go.bunVM();
        return bun.handleOom(ValkeyClient.init(
            bun.default_allocator,
            vm.uwsLoop(),
            conn_str,
            .{}, // TODO(markovejnovic): Accept options from user lol
        )) catch |err| {
            switch (err) {
                error.InvalidProtocol => {
                    return go.throw(
                        "URL protocol must be one of: " ++
                            "'redis://', 'valkey://', 'rediss://', " ++
                            "'valkeys://', 'redis+tls://', " ++
                            "'redis+unix://', 'redis+tls+unix://'.",
                        .{},
                    );
                },
                error.InvalidUnixLocation => {
                    return go.throw(
                        "Invalid UNIX socket location given in the URL.",
                        .{},
                    );
                },
                error.MalformedUrl => {
                    return go.throw("Invalid connection URL given.", .{});
                },
                error.FailedToCreateSocket => {
                    // TODO(markovejnovic): Improve this error message.
                    // This error message sucks, but we can't do better.
                    return go.throw("Unspecified error creating socket.", .{});
                },
            }
        };
    }

    /// Parse arguments given to the constructor. There's a lot of arguments
    /// the constructor can take, so this is separated.
    fn parseConstructorArgs(
        go: *bun.jsc.JSGlobalObject,
        cf: *bun.jsc.CallFrame,
    ) bun.JSError!struct {
        conn_str: bun.String,

        pub fn deinit(self: *@This()) void {
            self.conn_str.deref();
        }
    } {
        const args = cf.arguments();
        const env = go.bunVM().transpiler.env;

        const conn_url = if (args.len > 0 and !args[0].isUndefined())
            try args[0].toBunString(go)
        else if (env.get("REDIS_URL") orelse env.get("VALKEY_URL")) |url|
            bun.String.init(url)
        else
            bun.String.init(DEFAULT_CONN_STR);

        return .{
            .conn_str = conn_url,
        };
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

    pub fn deinit(self: *Self) void {
        _ = self;
    }

    pub fn finalize(self: *Self) void {
        self._client.deinit();
    }

    pub fn memoryCost(self: *const Self) usize {
        return self._client.memoryUsage();
    }

    pub const js = bun.jsc.Codegen.JSRedisClient2;
    pub const new = bun.TrivialNew(@This());
    const RefCount = bun.ptr.RefCount(Self, "_ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;
};

const bun = @import("bun");
const ValkeyClient = @import("./valkey.zig").ValkeyClient;
