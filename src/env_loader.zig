const DotEnvFileSuffix = enum {
    development,
    production,
    @"test",
};

pub const Loader = struct {
    map: *Map,
    allocator: std.mem.Allocator,

    @".env.local": ?logger.Source = null,
    @".env.development": ?logger.Source = null,
    @".env.production": ?logger.Source = null,
    @".env.test": ?logger.Source = null,
    @".env.development.local": ?logger.Source = null,
    @".env.production.local": ?logger.Source = null,
    @".env.test.local": ?logger.Source = null,
    @".env": ?logger.Source = null,

    // only populated with files specified explicitly (e.g. --env-file arg)
    custom_files_loaded: bun.StringArrayHashMap(logger.Source),

    quiet: bool = false,

    did_load_process: bool = false,
    reject_unauthorized: ?bool = null,

    aws_credentials: ?s3.S3Credentials = null,

    pub fn iterator(this: *const Loader) Map.HashTable.Iterator {
        return this.map.iterator();
    }

    pub fn has(this: *const Loader, input: []const u8) bool {
        const value = this.get(input) orelse return false;
        if (value.len == 0) return false;

        return !strings.eqlComptime(value, "\"\"") and !strings.eqlComptime(value, "''") and !strings.eqlComptime(value, "0") and !strings.eqlComptime(value, "false");
    }

    pub fn isProduction(this: *const Loader) bool {
        const env = this.get("BUN_ENV") orelse this.get("NODE_ENV") orelse return false;
        return strings.eqlComptime(env, "production");
    }

    pub fn isTest(this: *const Loader) bool {
        const env = this.get("BUN_ENV") orelse this.get("NODE_ENV") orelse return false;
        return strings.eqlComptime(env, "test");
    }

    pub fn getNodePath(this: *Loader, fs: *Fs.FileSystem, buf: *bun.PathBuffer) ?[:0]const u8 {
        if (this.get("NODE") orelse this.get("npm_node_execpath")) |node| {
            @memcpy(buf[0..node.len], node);
            buf[node.len] = 0;
            return buf[0..node.len :0];
        }

        if (which(buf, this.get("PATH") orelse return null, fs.top_level_dir, "node")) |node| {
            return node;
        }

        return null;
    }

    pub fn isCI(this: *const Loader) bool {
        return (this.get("CI") orelse
            this.get("TDDIUM") orelse
            this.get("GITHUB_ACTIONS") orelse
            this.get("JENKINS_URL") orelse
            this.get("bamboo.buildKey")) != null;
    }

    pub fn loadTracy(_: *const Loader) void {}

    pub fn getS3Credentials(this: *Loader) s3.S3Credentials {
        if (this.aws_credentials) |credentials| {
            return credentials;
        }

        var accessKeyId: []const u8 = "";
        var secretAccessKey: []const u8 = "";
        var region: []const u8 = "";
        var endpoint: []const u8 = "";
        var bucket: []const u8 = "";
        var session_token: []const u8 = "";
        var insecure_http: bool = false;

        if (this.get("S3_ACCESS_KEY_ID")) |access_key| {
            accessKeyId = access_key;
        } else if (this.get("AWS_ACCESS_KEY_ID")) |access_key| {
            accessKeyId = access_key;
        }
        if (this.get("S3_SECRET_ACCESS_KEY")) |access_key| {
            secretAccessKey = access_key;
        } else if (this.get("AWS_SECRET_ACCESS_KEY")) |access_key| {
            secretAccessKey = access_key;
        }

        if (this.get("S3_REGION")) |region_| {
            region = region_;
        } else if (this.get("AWS_REGION")) |region_| {
            region = region_;
        }
        if (this.get("S3_ENDPOINT")) |endpoint_| {
            const url = bun.URL.parse(endpoint_);
            endpoint = url.hostWithPath();
            insecure_http = url.isHTTP();
        } else if (this.get("AWS_ENDPOINT")) |endpoint_| {
            const url = bun.URL.parse(endpoint_);
            endpoint = url.hostWithPath();
            insecure_http = url.isHTTP();
        }
        if (this.get("S3_BUCKET")) |bucket_| {
            bucket = bucket_;
        } else if (this.get("AWS_BUCKET")) |bucket_| {
            bucket = bucket_;
        }
        if (this.get("S3_SESSION_TOKEN")) |token| {
            session_token = token;
        } else if (this.get("AWS_SESSION_TOKEN")) |token| {
            session_token = token;
        }
        this.aws_credentials = .{
            .ref_count = .init(),
            .accessKeyId = accessKeyId,
            .secretAccessKey = secretAccessKey,
            .region = region,
            .endpoint = endpoint,
            .bucket = bucket,
            .sessionToken = session_token,
            .insecure_http = insecure_http,
        };

        return this.aws_credentials.?;
    }
    /// Checks whether `NODE_TLS_REJECT_UNAUTHORIZED` is set to `0` or `false`.
    ///
    /// **Prefer VirtualMachine.getTLSRejectUnauthorized()** for JavaScript, as individual workers could have different settings.
    pub fn getTLSRejectUnauthorized(this: *Loader) bool {
        if (this.reject_unauthorized) |reject_unauthorized| {
            return reject_unauthorized;
        }
        if (this.get("NODE_TLS_REJECT_UNAUTHORIZED")) |reject| {
            if (strings.eql(reject, "0")) {
                this.reject_unauthorized = false;
                return false;
            }
            if (strings.eql(reject, "false")) {
                this.reject_unauthorized = false;
                return false;
            }
        }
        // default: true
        this.reject_unauthorized = true;
        return true;
    }

    pub fn getHttpProxyFor(this: *Loader, url: URL) ?URL {
        return this.getHttpProxy(url.isHTTP(), url.hostname, url.host);
    }

    pub fn hasHTTPProxy(this: *const Loader) bool {
        return this.has("http_proxy") or this.has("HTTP_PROXY") or this.has("https_proxy") or this.has("HTTPS_PROXY");
    }

    /// Get proxy URL for HTTP/HTTPS requests, respecting NO_PROXY.
    /// `hostname` is the host without port (e.g., "localhost")
    /// `host` is the host with port if present (e.g., "localhost:3000")
    pub fn getHttpProxy(this: *Loader, is_http: bool, hostname: ?[]const u8, host: ?[]const u8) ?URL {
        // TODO: When Web Worker support is added, make sure to intern these strings
        var http_proxy: ?URL = null;

        if (is_http) {
            if (this.get("http_proxy") orelse this.get("HTTP_PROXY")) |proxy| {
                if (proxy.len > 0 and !strings.eqlComptime(proxy, "\"\"") and !strings.eqlComptime(proxy, "''")) {
                    http_proxy = URL.parse(proxy);
                }
            }
        } else {
            if (this.get("https_proxy") orelse this.get("HTTPS_PROXY")) |proxy| {
                if (proxy.len > 0 and !strings.eqlComptime(proxy, "\"\"") and !strings.eqlComptime(proxy, "''")) {
                    http_proxy = URL.parse(proxy);
                }
            }
        }

        // NO_PROXY filter
        // See the syntax at https://about.gitlab.com/blog/2021/01/27/we-need-to-talk-no-proxy/
        if (http_proxy != null and hostname != null) {
            if (this.get("no_proxy") orelse this.get("NO_PROXY")) |no_proxy_text| {
                if (no_proxy_text.len == 0 or strings.eqlComptime(no_proxy_text, "\"\"") or strings.eqlComptime(no_proxy_text, "''")) {
                    return http_proxy;
                }

                var no_proxy_iter = std.mem.splitScalar(u8, no_proxy_text, ',');
                while (no_proxy_iter.next()) |no_proxy_item| {
                    var no_proxy_entry = strings.trim(no_proxy_item, &strings.whitespace_chars);
                    if (no_proxy_entry.len == 0) {
                        continue;
                    }
                    if (strings.eql(no_proxy_entry, "*")) {
                        return null;
                    }
                    //strips .
                    if (strings.startsWithChar(no_proxy_entry, '.')) {
                        no_proxy_entry = no_proxy_entry[1..];
                        if (no_proxy_entry.len == 0) {
                            continue;
                        }
                    }

                    // Determine if entry contains a port or is an IPv6 address
                    // IPv6 addresses contain multiple colons (e.g., "::1", "2001:db8::1")
                    // Bracketed IPv6 with port: "[::1]:8080"
                    // Host with port: "localhost:8080" (single colon)
                    const colon_count = std.mem.count(u8, no_proxy_entry, ":");
                    const is_bracketed_ipv6 = strings.startsWithChar(no_proxy_entry, '[');
                    const has_port = blk: {
                        if (is_bracketed_ipv6) {
                            // Bracketed IPv6: check for "]:port" pattern
                            if (std.mem.indexOf(u8, no_proxy_entry, "]:")) |_| {
                                break :blk true;
                            }
                            break :blk false;
                        } else if (colon_count == 1) {
                            // Single colon means host:port (not IPv6)
                            break :blk true;
                        }
                        // Multiple colons without brackets = bare IPv6 literal (no port)
                        break :blk false;
                    };

                    if (has_port) {
                        // Entry has a port, do exact match against host:port
                        if (host) |h| {
                            if (strings.eqlCaseInsensitiveASCII(h, no_proxy_entry, true)) {
                                return null;
                            }
                        }
                    } else {
                        // Entry is hostname/IPv6 only, match against hostname (suffix match)
                        if (strings.endsWith(hostname.?, no_proxy_entry)) {
                            return null;
                        }
                    }
                }
            }
        }
        return http_proxy;
    }

    var did_load_ccache_path: bool = false;

    pub fn loadCCachePath(this: *Loader, fs: *Fs.FileSystem) void {
        if (did_load_ccache_path) {
            return;
        }
        did_load_ccache_path = true;
        loadCCachePathImpl(this, fs) catch {};
    }

    fn loadCCachePathImpl(this: *Loader, fs: *Fs.FileSystem) !void {

        // if they have ccache installed, put it in env variable `CMAKE_CXX_COMPILER_LAUNCHER` so
        // cmake can use it to hopefully speed things up
        var buf: bun.PathBuffer = undefined;
        const ccache_path = bun.which(
            &buf,
            this.get("PATH") orelse return,
            fs.top_level_dir,
            "ccache",
        ) orelse "";

        if (ccache_path.len > 0) {
            const cxx_gop = try this.map.getOrPutWithoutValue("CMAKE_CXX_COMPILER_LAUNCHER");
            if (!cxx_gop.found_existing) {
                cxx_gop.key_ptr.* = try this.allocator.dupe(u8, cxx_gop.key_ptr.*);
                cxx_gop.value_ptr.* = .{
                    .value = try this.allocator.dupe(u8, ccache_path),
                    .conditional = false,
                };
            }
            const c_gop = try this.map.getOrPutWithoutValue("CMAKE_C_COMPILER_LAUNCHER");
            if (!c_gop.found_existing) {
                c_gop.key_ptr.* = try this.allocator.dupe(u8, c_gop.key_ptr.*);
                c_gop.value_ptr.* = .{
                    .value = try this.allocator.dupe(u8, ccache_path),
                    .conditional = false,
                };
            }
        }
    }

    var node_path_to_use_set_once: []const u8 = "";
    pub fn loadNodeJSConfig(this: *Loader, fs: *Fs.FileSystem, override_node: []const u8) !bool {
        var buf: bun.PathBuffer = undefined;

        var node_path_to_use = override_node;
        if (node_path_to_use.len == 0) {
            if (node_path_to_use_set_once.len > 0) {
                node_path_to_use = node_path_to_use_set_once;
            } else {
                const node = this.getNodePath(fs, &buf) orelse return false;
                node_path_to_use = try fs.dirname_store.append([]const u8, bun.asByteSlice(node));
            }
        }
        node_path_to_use_set_once = node_path_to_use;
        try this.map.put("NODE", node_path_to_use);
        try this.map.put("npm_node_execpath", node_path_to_use);
        return true;
    }

    pub fn getAs(this: *const Loader, comptime T: type, key: string) ?T {
        const value = this.get(key) orelse return null;
        switch (comptime T) {
            bool => {
                if (strings.eqlComptime(value, "")) return false;
                if (strings.eqlComptime(value, "0")) return false;
                if (strings.eqlComptime(value, "NO")) return false;
                if (strings.eqlComptime(value, "OFF")) return false;
                if (strings.eqlComptime(value, "false")) return false;

                return true;
            },
            else => @compileError("Implement getAs for this type"),
        }
    }

    pub var has_no_clear_screen_cli_flag: ?bool = null;
    /// Returns whether the `BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD` env var is set to something truthy
    pub fn hasSetNoClearTerminalOnReload(this: *const Loader, default_value: bool) bool {
        return (has_no_clear_screen_cli_flag orelse this.getAs(bool, "BUN_CONFIG_NO_CLEAR_TERMINAL_ON_RELOAD")) orelse default_value;
    }

    pub fn get(this: *const Loader, key: string) ?string {
        var _key = key;
        if (_key.len > 0 and _key[0] == '$') {
            _key = key[1..];
        }

        if (_key.len == 0) return null;

        return this.map.get(_key);
    }

    pub fn getAuto(this: *const Loader, key: string) string {
        // If it's "" or "$", it's not a variable
        if (key.len < 2 or key[0] != '$') {
            return key;
        }

        return this.get(key[1..]) orelse key;
    }

    /// Load values from the environment into Define.
    ///
    /// If there is a framework, values from the framework are inserted with a
    /// **lower priority** so that users may override defaults. Unlike regular
    /// defines, environment variables are loaded as JavaScript string literals.
    ///
    /// Empty environment variables become empty strings.
    pub fn copyForDefine(
        this: *Loader,
        comptime JSONStore: type,
        to_json: *JSONStore,
        comptime StringStore: type,
        to_string: *StringStore,
        framework_defaults: api.StringMap,
        behavior: api.DotEnvBehavior,
        prefix: string,
        allocator: std.mem.Allocator,
    ) !void {
        var iter = this.map.iterator();
        var key_count: usize = 0;
        var string_map_hashes = try allocator.alloc(u64, framework_defaults.keys.len);
        defer allocator.free(string_map_hashes);
        const invalid_hash = std.math.maxInt(u64) - 1;
        @memset(string_map_hashes, invalid_hash);

        var key_buf: []u8 = "";
        // Frameworks determine an allowlist of values

        for (framework_defaults.keys, 0..) |key, i| {
            if (key.len > "process.env.".len and strings.eqlComptime(key[0.."process.env.".len], "process.env.")) {
                const hashable_segment = key["process.env.".len..];
                string_map_hashes[i] = bun.hash(hashable_segment);
            }
        }

        // We have to copy all the keys to prepend "process.env" :/
        var key_buf_len: usize = 0;
        var e_strings_to_allocate: usize = 0;

        if (behavior != .disable and behavior != .load_all_without_inlining) {
            if (behavior == .prefix) {
                bun.assert(prefix.len > 0);

                while (iter.next()) |entry| {
                    if (strings.startsWith(entry.key_ptr.*, prefix)) {
                        key_buf_len += entry.key_ptr.len;
                        key_count += 1;
                        e_strings_to_allocate += 1;
                        bun.assert(entry.key_ptr.len > 0);
                    }
                }
            } else {
                while (iter.next()) |entry| {
                    if (entry.key_ptr.len > 0) {
                        key_buf_len += entry.key_ptr.len;
                        key_count += 1;
                        e_strings_to_allocate += 1;

                        bun.assert(entry.key_ptr.len > 0);
                    }
                }
            }

            if (key_buf_len > 0) {
                iter.reset();
                key_buf = try allocator.alloc(u8, key_buf_len + key_count * "process.env.".len);
                var key_writer = std.Io.Writer.fixed(key_buf);
                const js_ast = bun.ast;

                var e_strings = try allocator.alloc(js_ast.E.String, e_strings_to_allocate * 2);
                errdefer allocator.free(e_strings);
                errdefer allocator.free(key_buf);

                if (behavior == .prefix) {
                    while (iter.next()) |entry| {
                        const value: string = entry.value_ptr.value;

                        if (strings.startsWith(entry.key_ptr.*, prefix)) {
                            key_writer.print("process.env.{s}", .{entry.key_ptr.*}) catch |err| switch (err) {
                                error.WriteFailed => unreachable, // miscalculated length of key_buf above
                            };
                            const key_str = key_writer.buffered();
                            key_writer = std.Io.Writer.fixed(key_writer.unusedCapacitySlice());

                            e_strings[0] = js_ast.E.String{
                                .data = if (value.len > 0)
                                    @as([*]u8, @ptrFromInt(@intFromPtr(value.ptr)))[0..value.len]
                                else
                                    &[_]u8{},
                            };
                            const expr_data = js_ast.Expr.Data{ .e_string = &e_strings[0] };

                            _ = try to_string.getOrPutValue(
                                key_str,
                                .init(.{
                                    .can_be_removed_if_unused = true,
                                    .call_can_be_unwrapped_if_unused = .if_unused,
                                    .value = expr_data,
                                }),
                            );
                            e_strings = e_strings[1..];
                        } else {
                            const hash = bun.hash(entry.key_ptr.*);

                            bun.assert(hash != invalid_hash);

                            if (std.mem.indexOfScalar(u64, string_map_hashes, hash)) |key_i| {
                                e_strings[0] = js_ast.E.String{
                                    .data = if (value.len > 0)
                                        @as([*]u8, @ptrFromInt(@intFromPtr(value.ptr)))[0..value.len]
                                    else
                                        &[_]u8{},
                                };

                                const expr_data = js_ast.Expr.Data{ .e_string = &e_strings[0] };

                                _ = try to_string.getOrPutValue(
                                    framework_defaults.keys[key_i],
                                    .init(.{
                                        .can_be_removed_if_unused = true,
                                        .call_can_be_unwrapped_if_unused = .if_unused,
                                        .value = expr_data,
                                    }),
                                );
                                e_strings = e_strings[1..];
                            }
                        }
                    }
                } else {
                    while (iter.next()) |entry| {
                        const value: string = entry.value_ptr.value;

                        key_writer.print("process.env.{s}", .{entry.key_ptr.*}) catch |err| switch (err) {
                            error.WriteFailed => unreachable, // miscalculated length of key_buf above
                        };
                        const key_str = key_writer.buffered();
                        key_writer = std.Io.Writer.fixed(key_writer.unusedCapacitySlice());

                        e_strings[0] = js_ast.E.String{
                            .data = if (entry.value_ptr.value.len > 0)
                                @as([*]u8, @ptrFromInt(@intFromPtr(entry.value_ptr.value.ptr)))[0..value.len]
                            else
                                &[_]u8{},
                        };

                        const expr_data = js_ast.Expr.Data{ .e_string = &e_strings[0] };

                        _ = try to_string.getOrPutValue(
                            key_str,
                            .init(.{
                                .can_be_removed_if_unused = true,
                                .call_can_be_unwrapped_if_unused = .if_unused,
                                .value = expr_data,
                            }),
                        );
                        e_strings = e_strings[1..];
                    }
                }
            }
        }

        for (framework_defaults.keys, 0..) |key, i| {
            const value = framework_defaults.values[i];

            if (!to_string.contains(key) and !to_json.contains(key)) {
                _ = try to_json.getOrPutValue(key, value);
            }
        }
    }

    pub fn init(map: *Map, allocator: std.mem.Allocator) Loader {
        return Loader{
            .map = map,
            .allocator = allocator,
            .custom_files_loaded = bun.StringArrayHashMap(logger.Source).init(allocator),
        };
    }

    pub fn loadProcess(this: *Loader) OOM!void {
        if (this.did_load_process) return;

        try this.map.map.ensureTotalCapacity(std.os.environ.len);
        for (std.os.environ) |_env| {
            var env = bun.span(_env);
            if (strings.indexOfChar(env, '=')) |i| {
                const key = env[0..i];
                const value = env[i + 1 ..];
                if (key.len > 0) {
                    try this.map.put(key, value);
                }
            } else {
                if (env.len > 0) {
                    try this.map.put(env, "");
                }
            }
        }
        this.did_load_process = true;
    }

    // mostly for tests
    pub fn loadFromString(this: *Loader, str: string, comptime overwrite: bool, comptime expand: bool) OOM!void {
        const source = &logger.Source.initPathString("test", str);
        var value_buffer = std.array_list.Managed(u8).init(this.allocator);
        defer value_buffer.deinit();
        try Parser.parse(source, this.allocator, this.map, &value_buffer, overwrite, false, expand);
        std.mem.doNotOptimizeAway(&source);
    }

    pub fn load(
        this: *Loader,
        dir: *Fs.FileSystem.DirEntry,
        env_files: []const []const u8,
        comptime suffix: DotEnvFileSuffix,
        skip_default_env: bool,
    ) !void {
        const start = std.time.nanoTimestamp();

        // Create a reusable buffer with stack fallback for parsing multiple files
        var stack_fallback = std.heap.stackFallback(4096, this.allocator);
        var value_buffer = std.array_list.Managed(u8).init(stack_fallback.get());
        defer value_buffer.deinit();

        if (env_files.len > 0) {
            try this.loadExplicitFiles(env_files, &value_buffer);
        } else {
            // Do not automatically load .env files in `bun run <script>`
            // Instead, it is the responsibility of the script's instance of `bun` to load .env,
            // so that if the script runner is NODE_ENV=development, but the script is
            // "NODE_ENV=production bun ...", there should be no development env loaded.
            //
            // See https://github.com/oven-sh/bun/issues/9635#issuecomment-2021350123
            // for more details on how this edge case works.
            if (!skip_default_env)
                try this.loadDefaultFiles(dir, suffix, &value_buffer);
        }

        if (!this.quiet) this.printLoaded(start);
    }

    fn loadExplicitFiles(
        this: *Loader,
        env_files: []const []const u8,
        value_buffer: *std.array_list.Managed(u8),
    ) !void {
        // iterate backwards, so the latest entry in the latest arg instance assumes the highest priority
        var i: usize = env_files.len;
        while (i > 0) : (i -= 1) {
            const arg_value = std.mem.trim(u8, env_files[i - 1], " ");
            if (arg_value.len > 0) { // ignore blank args
                var iter = std.mem.splitBackwardsScalar(u8, arg_value, ',');
                while (iter.next()) |file_path| {
                    if (file_path.len > 0) {
                        try this.loadEnvFileDynamic(file_path, false, value_buffer);
                        analytics.Features.dotenv += 1;
                    }
                }
            }
        }
    }

    // .env.local goes first
    // Load .env.development if development
    // Load .env.production if !development
    // .env goes last
    fn loadDefaultFiles(
        this: *Loader,
        dir: *Fs.FileSystem.DirEntry,
        comptime suffix: DotEnvFileSuffix,
        value_buffer: *std.array_list.Managed(u8),
    ) !void {
        const dir_handle: std.fs.Dir = std.fs.cwd();

        switch (comptime suffix) {
            .development => {
                if (dir.hasComptimeQuery(".env.development.local")) {
                    try this.loadEnvFile(dir_handle, ".env.development.local", false, value_buffer);
                    analytics.Features.dotenv += 1;
                }
            },
            .production => {
                if (dir.hasComptimeQuery(".env.production.local")) {
                    try this.loadEnvFile(dir_handle, ".env.production.local", false, value_buffer);
                    analytics.Features.dotenv += 1;
                }
            },
            .@"test" => {
                if (dir.hasComptimeQuery(".env.test.local")) {
                    try this.loadEnvFile(dir_handle, ".env.test.local", false, value_buffer);
                    analytics.Features.dotenv += 1;
                }
            },
        }

        if (comptime suffix != .@"test") {
            if (dir.hasComptimeQuery(".env.local")) {
                try this.loadEnvFile(dir_handle, ".env.local", false, value_buffer);
                analytics.Features.dotenv += 1;
            }
        }

        switch (comptime suffix) {
            .development => {
                if (dir.hasComptimeQuery(".env.development")) {
                    try this.loadEnvFile(dir_handle, ".env.development", false, value_buffer);
                    analytics.Features.dotenv += 1;
                }
            },
            .production => {
                if (dir.hasComptimeQuery(".env.production")) {
                    try this.loadEnvFile(dir_handle, ".env.production", false, value_buffer);
                    analytics.Features.dotenv += 1;
                }
            },
            .@"test" => {
                if (dir.hasComptimeQuery(".env.test")) {
                    try this.loadEnvFile(dir_handle, ".env.test", false, value_buffer);
                    analytics.Features.dotenv += 1;
                }
            },
        }

        if (dir.hasComptimeQuery(".env")) {
            try this.loadEnvFile(dir_handle, ".env", false, value_buffer);
            analytics.Features.dotenv += 1;
        }
    }

    pub fn printLoaded(this: *Loader, start: i128) void {
        const count =
            @as(u8, @intCast(@intFromBool(this.@".env.development.local" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.production.local" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.test.local" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.local" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.development" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.production" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env.test" != null))) +
            @as(u8, @intCast(@intFromBool(this.@".env" != null))) +
            this.custom_files_loaded.count();

        if (count == 0) return;
        const elapsed = @as(f64, @floatFromInt((std.time.nanoTimestamp() - start))) / std.time.ns_per_ms;

        const all = [_]string{
            ".env.development.local",
            ".env.production.local",
            ".env.test.local",
            ".env.local",
            ".env.development",
            ".env.production",
            ".env.test",
            ".env",
        };
        const loaded = [_]bool{
            this.@".env.development.local" != null,
            this.@".env.production.local" != null,
            this.@".env.test.local" != null,
            this.@".env.local" != null,
            this.@".env.development" != null,
            this.@".env.production" != null,
            this.@".env.test" != null,
            this.@".env" != null,
        };

        var loaded_i: u8 = 0;
        Output.printElapsed(elapsed);
        Output.prettyError(" <d>", .{});

        for (loaded, 0..) |yes, i| {
            if (yes) {
                loaded_i += 1;
                if (count == 1 or (loaded_i >= count and count > 1)) {
                    Output.prettyError("\"{s}\"", .{all[i]});
                } else {
                    Output.prettyError("\"{s}\", ", .{all[i]});
                }
            }
        }

        var iter = this.custom_files_loaded.iterator();
        while (iter.next()) |e| {
            loaded_i += 1;
            if (count == 1 or (loaded_i >= count and count > 1)) {
                Output.prettyError("\"{s}\"", .{e.key_ptr.*});
            } else {
                Output.prettyError("\"{s}\", ", .{e.key_ptr.*});
            }
        }

        Output.prettyErrorln("<r>\n", .{});
        Output.flush();
    }

    pub fn loadEnvFile(
        this: *Loader,
        dir: std.fs.Dir,
        comptime base: string,
        comptime override: bool,
        value_buffer: *std.array_list.Managed(u8),
    ) !void {
        if (@field(this, base) != null) {
            return;
        }

        var file = dir.openFile(base, .{ .mode = .read_only }) catch |err| {
            switch (err) {
                error.IsDir, error.FileNotFound => {
                    // prevent retrying
                    @field(this, base) = logger.Source.initPathString(base, "");
                    return;
                },
                error.Unexpected, error.FileBusy, error.DeviceBusy, error.AccessDenied => {
                    if (!this.quiet) {
                        Output.prettyErrorln("<r><red>{s}<r> error loading {s} file", .{ @errorName(err), base });
                    }

                    // prevent retrying
                    @field(this, base) = logger.Source.initPathString(base, "");
                    return;
                },
                else => {
                    return err;
                },
            }
        };
        defer file.close();

        const end = brk: {
            if (comptime Environment.isWindows) {
                const pos = try file.getEndPos();
                if (pos == 0) {
                    @field(this, base) = logger.Source.initPathString(base, "");
                    return;
                }

                break :brk pos;
            }

            const stat = try file.stat();

            if (stat.size == 0 or stat.kind != .file) {
                @field(this, base) = logger.Source.initPathString(base, "");
                return;
            }

            break :brk stat.size;
        };

        var buf = try this.allocator.alloc(u8, end + 1);
        errdefer this.allocator.free(buf);
        const amount_read = file.readAll(buf[0..end]) catch |err| switch (err) {
            error.Unexpected, error.SystemResources, error.OperationAborted, error.BrokenPipe, error.AccessDenied, error.IsDir => {
                if (!this.quiet) {
                    Output.prettyErrorln("<r><red>{s}<r> error loading {s} file", .{ @errorName(err), base });
                }

                // prevent retrying
                @field(this, base) = logger.Source.initPathString(base, "");
                return;
            },
            else => {
                return err;
            },
        };

        // The null byte here is mostly for debugging purposes.
        buf[end] = 0;

        const source = &logger.Source.initPathString(base, buf[0..amount_read]);

        try Parser.parse(
            source,
            this.allocator,
            this.map,
            value_buffer,
            override,
            false,
            true,
        );

        @field(this, base) = source.*;
    }

    pub fn loadEnvFileDynamic(
        this: *Loader,
        file_path: []const u8,
        comptime override: bool,
        value_buffer: *std.array_list.Managed(u8),
    ) !void {
        if (this.custom_files_loaded.contains(file_path)) {
            return;
        }

        var file = bun.openFile(file_path, .{ .mode = .read_only }) catch {
            // prevent retrying
            try this.custom_files_loaded.put(file_path, logger.Source.initPathString(file_path, ""));
            return;
        };
        defer file.close();

        const end = brk: {
            if (comptime Environment.isWindows) {
                const pos = try file.getEndPos();
                if (pos == 0) {
                    try this.custom_files_loaded.put(file_path, logger.Source.initPathString(file_path, ""));
                    return;
                }

                break :brk pos;
            }

            const stat = try file.stat();

            if (stat.size == 0 or stat.kind != .file) {
                try this.custom_files_loaded.put(file_path, logger.Source.initPathString(file_path, ""));
                return;
            }

            break :brk stat.size;
        };

        var buf = try this.allocator.alloc(u8, end + 1);
        errdefer this.allocator.free(buf);
        const amount_read = file.readAll(buf[0..end]) catch |err| switch (err) {
            error.Unexpected, error.SystemResources, error.OperationAborted, error.BrokenPipe, error.AccessDenied, error.IsDir => {
                if (!this.quiet) {
                    Output.prettyErrorln("<r><red>{s}<r> error loading {s} file", .{ @errorName(err), file_path });
                }

                // prevent retrying
                try this.custom_files_loaded.put(file_path, logger.Source.initPathString(file_path, ""));
                return;
            },
            else => {
                return err;
            },
        };

        // The null byte here is mostly for debugging purposes.
        buf[end] = 0;

        const source = &logger.Source.initPathString(file_path, buf[0..amount_read]);

        try Parser.parse(
            source,
            this.allocator,
            this.map,
            value_buffer,
            override,
            false,
            true,
        );

        try this.custom_files_loaded.put(file_path, source.*);
    }
};

const Parser = struct {
    pos: usize = 0,
    src: string,
    value_buffer: *std.array_list.Managed(u8),

    const whitespace_chars = "\t\x0B\x0C \xA0\n\r";

    fn skipLine(this: *Parser) void {
        if (strings.indexOfAny(this.src[this.pos..], "\n\r")) |i| {
            this.pos += i + 1;
        } else {
            this.pos = this.src.len;
        }
    }

    fn skipWhitespaces(this: *Parser) void {
        var i = this.pos;
        while (i < this.src.len) : (i += 1) {
            if (strings.indexOfChar(whitespace_chars, this.src[i]) == null) break;
        }
        this.pos = i;
    }

    fn parseKey(this: *Parser, comptime check_export: bool) ?string {
        if (comptime check_export) this.skipWhitespaces();
        const start = this.pos;
        var end = start;
        while (end < this.src.len) : (end += 1) {
            switch (this.src[end]) {
                'a'...'z', 'A'...'Z', '0'...'9', '_', '-', '.' => continue,
                else => break,
            }
        }
        if (end < this.src.len and start < end) {
            this.pos = end;
            this.skipWhitespaces();
            if (this.pos < this.src.len) {
                if (comptime check_export) {
                    if (end < this.pos and strings.eqlComptime(this.src[start..end], "export")) {
                        if (this.parseKey(false)) |key| return key;
                    }
                }
                switch (this.src[this.pos]) {
                    '=' => {
                        this.pos += 1;
                        return this.src[start..end];
                    },
                    ':' => {
                        const next = this.pos + 1;
                        if (next < this.src.len and strings.indexOfChar(whitespace_chars, this.src[next]) != null) {
                            this.pos += 2;
                            return this.src[start..end];
                        }
                    },
                    else => {},
                }
            }
        }
        this.pos = start;
        return null;
    }

    fn parseQuoted(this: *Parser, comptime quote: u8) !?string {
        if (comptime Environment.allow_assert) bun.assert(this.src[this.pos] == quote);
        const start = this.pos;
        this.value_buffer.clearRetainingCapacity(); // Reset the buffer
        var end = start + 1;
        while (end < this.src.len) : (end += 1) {
            switch (this.src[end]) {
                '\\' => end += 1,
                quote => {
                    end += 1;
                    this.pos = end;
                    this.skipWhitespaces();
                    if (this.pos >= this.src.len or
                        this.src[this.pos] == '#' or
                        strings.indexOfChar(this.src[end..this.pos], '\n') != null or
                        strings.indexOfChar(this.src[end..this.pos], '\r') != null)
                    {
                        var i = start;
                        while (i < end) {
                            switch (this.src[i]) {
                                '\\' => if (comptime quote == '"') {
                                    if (comptime Environment.allow_assert) bun.assert(i + 1 < end);
                                    switch (this.src[i + 1]) {
                                        'n' => {
                                            try this.value_buffer.append('\n');
                                            i += 2;
                                        },
                                        'r' => {
                                            try this.value_buffer.append('\r');
                                            i += 2;
                                        },
                                        else => {
                                            try this.value_buffer.appendSlice(this.src[i..][0..2]);
                                            i += 2;
                                        },
                                    }
                                } else {
                                    try this.value_buffer.append('\\');
                                    i += 1;
                                },
                                '\r' => {
                                    i += 1;
                                    if (i >= end or this.src[i] != '\n') {
                                        try this.value_buffer.append('\n');
                                    }
                                },
                                else => |c| {
                                    try this.value_buffer.append(c);
                                    i += 1;
                                },
                            }
                        }
                        return this.value_buffer.items;
                    }
                    this.pos = start;
                },
                else => {},
            }
        }
        return null;
    }

    fn parseValue(this: *Parser, comptime is_process: bool) OOM!string {
        const start = this.pos;
        this.skipWhitespaces();
        var end = this.pos;
        if (end >= this.src.len) return this.src[this.src.len..];
        switch (this.src[end]) {
            inline '`', '"', '\'' => |quote| {
                if (try this.parseQuoted(quote)) |value| {
                    return if (comptime is_process) value else value[1 .. value.len - 1];
                }
            },
            else => {},
        }
        end = start;
        while (end < this.src.len) : (end += 1) {
            switch (this.src[end]) {
                '#', '\r', '\n' => break,
                else => {},
            }
        }
        this.pos = end;
        return strings.trim(this.src[start..end], whitespace_chars);
    }

    fn expandValue(this: *Parser, map: *Map, value: string) OOM!?string {
        if (value.len < 2) return null;

        this.value_buffer.clearRetainingCapacity();

        var pos = value.len - 2;
        var last = value.len;
        while (true) : (pos -= 1) {
            if (value[pos] == '$') {
                if (pos > 0 and value[pos - 1] == '\\') {
                    try this.value_buffer.insertSlice(0, value[pos..last]);
                    pos -= 1;
                } else {
                    var end = if (value[pos + 1] == '{') pos + 2 else pos + 1;
                    const key_start = end;
                    while (end < value.len) : (end += 1) {
                        switch (value[end]) {
                            'a'...'z', 'A'...'Z', '0'...'9', '_' => continue,
                            else => break,
                        }
                    }
                    const lookup_value = map.get(value[key_start..end]);
                    const default_value = if (strings.hasPrefixComptime(value[end..], ":-")) brk: {
                        end += ":-".len;
                        const value_start = end;
                        while (end < value.len) : (end += 1) {
                            switch (value[end]) {
                                '}', '\\' => break,
                                else => continue,
                            }
                        }
                        break :brk value[value_start..end];
                    } else "";
                    if (end < value.len and value[end] == '}') end += 1;
                    try this.value_buffer.insertSlice(0, value[end..last]);
                    try this.value_buffer.insertSlice(0, lookup_value orelse default_value);
                }
                last = pos;
            }
            if (pos == 0) {
                if (last == value.len) return null;
                break;
            }
        }
        if (last > 0) {
            try this.value_buffer.insertSlice(0, value[0..last]);
        }
        return this.value_buffer.items;
    }

    fn _parse(
        this: *Parser,
        allocator: std.mem.Allocator,
        map: *Map,
        comptime override: bool,
        comptime is_process: bool,
        comptime expand: bool,
    ) OOM!void {
        var count = map.map.count();
        while (this.pos < this.src.len) {
            const key = this.parseKey(true) orelse {
                this.skipLine();
                continue;
            };
            const value = try this.parseValue(is_process);
            const entry = try map.map.getOrPut(key);
            if (entry.found_existing) {
                if (entry.index < count) {
                    // Allow keys defined later in the same file to override keys defined earlier
                    // https://github.com/oven-sh/bun/issues/1262
                    if (comptime !override) continue;
                } else {
                    allocator.free(entry.value_ptr.value);
                }
            }
            entry.value_ptr.* = .{
                .value = try allocator.dupe(u8, value),
                .conditional = false,
            };
        }
        if (comptime !is_process and expand) {
            var it = map.iterator();
            while (it.next()) |entry| {
                if (count > 0) {
                    count -= 1;
                } else if (try this.expandValue(map, entry.value_ptr.value)) |value| {
                    allocator.free(entry.value_ptr.value);
                    entry.value_ptr.* = .{
                        .value = try allocator.dupe(u8, value),
                        .conditional = false,
                    };
                }
            }
        }
    }

    pub fn parse(
        source: *const logger.Source,
        allocator: std.mem.Allocator,
        map: *Map,
        value_buffer: *std.array_list.Managed(u8),
        comptime override: bool,
        comptime is_process: bool,
        comptime expand: bool,
    ) OOM!void {
        // Clear the buffer before each parse to ensure no leftover data
        value_buffer.clearRetainingCapacity();
        var parser = Parser{
            .src = source.contents,
            .value_buffer = value_buffer,
        };
        try parser._parse(allocator, map, override, is_process, expand);
    }
};

pub const Map = struct {
    pub const HashTableValue = struct {
        value: string,
        conditional: bool,
    };
    // On Windows, environment variables are case-insensitive. So we use a case-insensitive hash map.
    // An issue with this exact implementation is unicode characters can technically appear in these
    // keys, and we use a simple toLowercase function that only applies to ascii, so this will make
    // some strings collide.
    pub const HashTable = (if (Environment.isWindows) bun.CaseInsensitiveASCIIStringArrayHashMap else bun.StringArrayHashMap)(HashTableValue);

    const GetOrPutResult = HashTable.GetOrPutResult;

    map: HashTable,

    pub fn createNullDelimitedEnvMap(this: *Map, arena: std.mem.Allocator) OOM![:null]?[*:0]const u8 {
        var env_map = &this.map;

        const envp_count = env_map.count();
        const envp_buf = try arena.allocSentinel(?[*:0]const u8, envp_count, null);
        {
            var it = env_map.iterator();
            var i: usize = 0;
            while (it.next()) |pair| : (i += 1) {
                const env_buf = try arena.allocSentinel(u8, pair.key_ptr.len + pair.value_ptr.value.len + 1, 0);
                bun.copy(u8, env_buf, pair.key_ptr.*);
                env_buf[pair.key_ptr.len] = '=';
                bun.copy(u8, env_buf[pair.key_ptr.len + 1 ..], pair.value_ptr.value);
                envp_buf[i] = env_buf.ptr;
            }
            if (comptime Environment.allow_assert) bun.assert(i == envp_count);
        }
        return envp_buf;
    }

    /// Returns a wrapper around the std.process.EnvMap that does not duplicate the memory of
    /// the keys and values, but instead points into the memory of the bun env map.
    ///
    /// To prevent
    pub fn stdEnvMap(this: *Map, allocator: std.mem.Allocator) OOM!StdEnvMapWrapper {
        var env_map = std.process.EnvMap.init(allocator);

        var iter = this.map.iterator();
        while (iter.next()) |entry| {
            try env_map.hash_map.put(entry.key_ptr.*, entry.value_ptr.value);
        }

        return .{ .unsafe_map = env_map };
    }

    pub const StdEnvMapWrapper = struct {
        unsafe_map: std.process.EnvMap,

        pub fn get(this: *const StdEnvMapWrapper) *const std.process.EnvMap {
            return &this.unsafe_map;
        }

        pub fn deinit(this: *StdEnvMapWrapper) void {
            this.unsafe_map.hash_map.deinit();
        }
    };

    /// Write the Windows environment block into a buffer
    /// This can be passed to CreateProcessW's lpEnvironment parameter
    pub fn writeWindowsEnvBlock(this: *Map, result: *[32767]u16) ![*]const u16 {
        var it = this.map.iterator();
        var i: usize = 0;
        while (it.next()) |pair| {
            i += bun.strings.convertUTF8toUTF16InBuffer(result[i..], pair.key_ptr.*).len;
            if (i + 7 >= result.len) return error.TooManyEnvironmentVariables;
            result[i] = '=';
            i += 1;
            i += bun.strings.convertUTF8toUTF16InBuffer(result[i..], pair.value_ptr.*.value).len;
            if (i + 5 >= result.len) return error.TooManyEnvironmentVariables;
            result[i] = 0;
            i += 1;
        }
        result[i] = 0;
        i += 1;
        result[i] = 0;
        i += 1;
        result[i] = 0;
        i += 1;
        result[i] = 0;
        i += 1;

        return result[0..].ptr;
    }

    pub fn iterator(this: *const Map) HashTable.Iterator {
        return this.map.iterator();
    }

    pub inline fn init(allocator: std.mem.Allocator) Map {
        return Map{ .map = HashTable.init(allocator) };
    }

    pub inline fn put(this: *Map, key: string, value: string) OOM!void {
        if (Environment.isWindows and Environment.allow_assert) {
            bun.assert(bun.strings.indexOfChar(key, '\x00') == null);
        }
        try this.map.put(key, .{
            .value = value,
            .conditional = false,
        });
    }

    pub fn ensureUnusedCapacity(this: *Map, additional_count: usize) OOM!void {
        return this.map.ensureUnusedCapacity(additional_count);
    }

    pub fn putAssumeCapacity(this: *Map, key: string, value: string) void {
        if (Environment.isWindows and Environment.allow_assert) {
            bun.assert(bun.strings.indexOfChar(key, '\x00') == null);
        }
        this.map.putAssumeCapacity(key, .{
            .value = value,
            .conditional = false,
        });
    }

    pub inline fn putAllocKeyAndValue(this: *Map, allocator: std.mem.Allocator, key: string, value: string) OOM!void {
        const gop = try this.map.getOrPut(key);
        gop.value_ptr.* = .{
            .value = try allocator.dupe(u8, value),
            .conditional = false,
        };
        if (!gop.found_existing) {
            gop.key_ptr.* = try allocator.dupe(u8, key);
        }
    }

    pub inline fn putAllocKey(this: *Map, allocator: std.mem.Allocator, key: string, value: string) OOM!void {
        const gop = try this.map.getOrPut(key);
        gop.value_ptr.* = .{
            .value = value,
            .conditional = false,
        };
        if (!gop.found_existing) {
            gop.key_ptr.* = try allocator.dupe(u8, key);
        }
    }

    pub inline fn putAllocValue(this: *Map, allocator: std.mem.Allocator, key: string, value: string) OOM!void {
        try this.map.put(key, .{
            .value = try allocator.dupe(u8, value),
            .conditional = false,
        });
    }

    pub inline fn getOrPutWithoutValue(this: *Map, key: string) OOM!GetOrPutResult {
        return this.map.getOrPut(key);
    }

    pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
        var iter = self.map.iterator();

        _ = try writer.write("{");
        while (iter.next()) |entry| {
            _ = try writer.write("\n    ");

            try writer.write(entry.key_ptr.*);

            _ = try writer.write(": ");

            try writer.write(entry.value_ptr.*);

            if (iter.index <= self.map.count() - 1) {
                _ = try writer.write(", ");
            }
        }

        try writer.write("\n}");
    }

    pub inline fn get(
        this: *const Map,
        key: string,
    ) ?string {
        return if (this.map.get(key)) |entry| entry.value else null;
    }

    pub inline fn putDefault(this: *Map, key: string, value: string) OOM!void {
        _ = try this.map.getOrPutValue(key, .{
            .value = value,
            .conditional = false,
        });
    }

    pub inline fn getOrPut(this: *Map, key: string, value: string) OOM!void {
        _ = try this.map.getOrPutValue(key, .{
            .value = value,
            .conditional = false,
        });
    }

    pub fn remove(this: *Map, key: string) void {
        _ = this.map.swapRemove(key);
    }

    pub fn cloneWithAllocator(this: *const Map, new_allocator: std.mem.Allocator) OOM!Map {
        return .{ .map = try this.map.cloneWithAllocator(new_allocator) };
    }
};

pub var instance: ?*Loader = null;

const string = []const u8;

const Fs = @import("./fs.zig");
const std = @import("std");
const URL = @import("./url.zig").URL;
const which = @import("./which.zig").which;

const bun = @import("bun");
const Environment = bun.Environment;
const OOM = bun.OOM;
const Output = bun.Output;
const analytics = bun.analytics;
const logger = bun.logger;
const s3 = bun.S3;
const strings = bun.strings;
const api = bun.schema.api;
