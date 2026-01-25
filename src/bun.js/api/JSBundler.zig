const debug = bun.Output.scoped(.Transpiler, .visible);

pub const JSBundler = struct {
    const OwnedString = bun.MutableString;

    /// A map of file paths to their in-memory contents.
    /// This allows bundling with virtual files that may not exist on disk.
    pub const FileMap = struct {
        map: bun.StringHashMapUnmanaged(jsc.Node.BlobOrStringOrBuffer) = .empty,

        pub fn deinitAndUnprotect(self: *FileMap) void {
            var iter = self.map.iterator();
            while (iter.next()) |entry| {
                entry.value_ptr.deinitAndUnprotect();
                bun.default_allocator.free(entry.key_ptr.*);
            }
            self.map.deinit(bun.default_allocator);
        }

        /// Resolve a specifier against the file map.
        /// Returns the contents if the specifier exactly matches a key in the map,
        /// or if the specifier is a relative path that, when joined with a source
        /// directory, matches a key in the map.
        pub fn get(self: *const FileMap, specifier: []const u8) ?[]const u8 {
            if (self.map.count() == 0) return null;

            if (comptime !bun.Environment.isWindows) {
                const entry = self.map.get(specifier) orelse return null;
                return entry.slice();
            }

            // Normalize backslashes to forward slashes for consistent lookup
            // Map keys are stored with forward slashes (normalized in fromJS)
            const buf = bun.path_buffer_pool.get();
            defer bun.path_buffer_pool.put(buf);
            const normalized = bun.path.pathToPosixBuf(u8, specifier, buf);
            const entry = self.map.get(normalized) orelse return null;
            return entry.slice();
        }

        /// Check if the file map contains a given specifier.
        pub fn contains(self: *const FileMap, specifier: []const u8) bool {
            if (self.map.count() == 0) return false;

            if (comptime !bun.Environment.isWindows) {
                return self.map.contains(specifier);
            }

            // Normalize backslashes to forward slashes for consistent lookup
            const buf = bun.path_buffer_pool.get();
            defer bun.path_buffer_pool.put(buf);
            const normalized = bun.path.pathToPosixBuf(u8, specifier, buf);
            return self.map.contains(normalized);
        }

        /// Returns a resolver Result for a file in the map, or null if not found.
        /// This creates a minimal Result that can be used by the bundler.
        ///
        /// source_file: The path of the importing file (may be relative or absolute)
        /// specifier: The import specifier (e.g., "./utils.js" or "/lib.js")
        pub fn resolve(self: *const FileMap, source_file: []const u8, specifier: []const u8) ?_resolver.Result {
            // Fast path: if the map is empty, return immediately
            if (self.map.count() == 0) return null;

            // Check if the specifier is directly in the map
            // Must use getKey to return the map's owned key, not the parameter
            if (comptime !bun.Environment.isWindows) {
                if (self.map.getKey(specifier)) |key| {
                    return _resolver.Result{
                        .path_pair = .{
                            .primary = Fs.Path.initWithNamespace(key, "file"),
                        },
                        .module_type = .unknown,
                    };
                }
            } else {
                const buf = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(buf);
                const normalized_specifier = bun.path.pathToPosixBuf(u8, specifier, buf);

                if (self.map.getKey(normalized_specifier)) |key| {
                    return _resolver.Result{
                        .path_pair = .{
                            .primary = Fs.Path.initWithNamespace(key, "file"),
                        },
                        .module_type = .unknown,
                    };
                }
            }

            // Also try with source directory joined for relative specifiers
            // Check for relative specifiers (not starting with / and not Windows absolute like C:/)
            if (specifier.len > 0 and specifier[0] != '/' and
                !(specifier.len >= 3 and specifier[1] == ':' and (specifier[2] == '/' or specifier[2] == '\\')))
            {
                // First, ensure source_file is absolute. It may be relative (e.g., "../../Windows/Temp/...")
                // on Windows when the bundler stores paths relative to cwd.
                const abs_source_buf = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(abs_source_buf);
                const abs_source_file = if (isAbsolutePath(source_file))
                    source_file
                else
                    Fs.FileSystem.instance.absBuf(&.{source_file}, abs_source_buf);

                // Normalize source_file to use forward slashes (for Windows compatibility)
                // On Windows, source_file may have backslashes from the real filesystem
                // Use pathToPosixBuf which always converts \ to / regardless of platform
                const source_file_buf = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(source_file_buf);
                const normalized_source_file = bun.path.pathToPosixBuf(u8, abs_source_file, source_file_buf);

                // Extract directory from source_file using posix path handling
                // For "/entry.js", we want "/"; for "/src/index.js", we want "/src/"
                // For "C:/foo/bar.js", we want "C:/foo"
                const buf = bun.path_buffer_pool.get();
                defer bun.path_buffer_pool.put(buf);
                const source_dir = bun.path.dirname(normalized_source_file, .posix);
                // If dirname returns empty but path starts with drive letter, extract the drive + root
                const effective_source_dir = if (source_dir.len == 0)
                    (if (normalized_source_file.len >= 3 and normalized_source_file[1] == ':' and normalized_source_file[2] == '/')
                        normalized_source_file[0..3] // "C:/"
                    else if (normalized_source_file.len > 0 and normalized_source_file[0] == '/')
                        "/"
                    else
                        Fs.FileSystem.instance.top_level_dir)
                else
                    source_dir;
                // Use .loose to preserve Windows drive letters, then normalize in-place on Windows
                const joined_len = bun.path.joinAbsStringBuf(effective_source_dir, buf, &.{specifier}, .loose).len;
                if (bun.Environment.isWindows) {
                    bun.path.platformToPosixInPlace(u8, buf[0..joined_len]);
                }
                const joined = buf[0..joined_len];
                // Must use getKey to return the map's owned key, not the temporary buffer
                if (self.map.getKey(joined)) |key| {
                    return _resolver.Result{
                        .path_pair = .{
                            .primary = Fs.Path.initWithNamespace(key, "file"),
                        },
                        .module_type = .unknown,
                    };
                }
            }

            return null;
        }

        /// Check if a path is absolute (works for both posix and Windows paths)
        fn isAbsolutePath(path: []const u8) bool {
            if (path.len == 0) return false;
            // Posix absolute path
            if (path[0] == '/') return true;
            // Windows absolute path with drive letter (e.g., "C:\..." or "C:/...")
            if (path.len >= 3 and path[1] == ':' and (path[2] == '/' or path[2] == '\\')) {
                return switch (path[0]) {
                    'a'...'z', 'A'...'Z' => true,
                    else => false,
                };
            }
            // Windows UNC path (e.g., "\\server\share")
            if (path.len >= 2 and path[0] == '\\' and path[1] == '\\') return true;
            return false;
        }

        /// Parse the files option from JavaScript.
        /// Expected format: Record<string, string | Blob | File | TypedArray | ArrayBuffer>
        /// Uses async parsing for cross-thread safety since bundler runs on a separate thread.
        pub fn fromJS(globalThis: *jsc.JSGlobalObject, files_value: jsc.JSValue) JSError!FileMap {
            var self = FileMap{
                .map = .empty,
            };
            errdefer self.deinitAndUnprotect();

            const files_obj = files_value.getObject() orelse {
                return globalThis.throwInvalidArguments("Expected files to be an object", .{});
            };

            var files_iter = try jsc.JSPropertyIterator(.{
                .skip_empty_name = true,
                .include_value = true,
            }).init(globalThis, files_obj);
            defer files_iter.deinit();

            try self.map.ensureTotalCapacity(bun.default_allocator, @intCast(files_iter.len));

            while (try files_iter.next()) |prop| {
                const property_value = files_iter.value;

                // Parse the value as BlobOrStringOrBuffer using async mode for thread safety
                var blob_or_string = try jsc.Node.BlobOrStringOrBuffer.fromJSAsync(globalThis, bun.default_allocator, property_value) orelse {
                    return globalThis.throwInvalidArguments("Expected file content to be a string, Blob, File, TypedArray, or ArrayBuffer", .{});
                };
                errdefer blob_or_string.deinitAndUnprotect();

                // Clone the key since we need to own it
                const key = try prop.toOwnedSlice(bun.default_allocator);

                // Normalize backslashes to forward slashes for cross-platform consistency
                // This ensures Windows paths like "C:\foo\bar.js" become "C:/foo/bar.js"
                // Use dangerouslyConvertPathToPosixInPlace which always converts \ to /
                // (uses sep_windows constant, not sep which varies by target)
                bun.path.dangerouslyConvertPathToPosixInPlace(u8, key);

                self.map.putAssumeCapacity(key, blob_or_string);
            }

            return self;
        }
    };

    pub const Config = struct {
        target: Target = Target.browser,
        entry_points: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        hot: bool = false,
        react_fast_refresh: bool = false,
        define: bun.StringMap = bun.StringMap.init(bun.default_allocator, false),
        loaders: ?api.LoaderMap = null,
        dir: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        outdir: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        rootdir: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        serve: Serve = .{},
        jsx: api.Jsx = .{
            .factory = "",
            .fragment = "",
            .runtime = .automatic,
            .import_source = "",
            .development = true, // Default to development mode like old Pragma
        },
        force_node_env: options.BundleOptions.ForceNodeEnv = .unspecified,
        code_splitting: bool = false,
        minify: Minify = .{},
        no_macros: bool = false,
        ignore_dce_annotations: bool = false,
        emit_dce_annotations: ?bool = null,
        names: Names = .{},
        external: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        source_map: options.SourceMapOption = .none,
        public_path: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        conditions: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        packages: options.PackagesOption = .bundle,
        format: options.Format = .esm,
        bytecode: bool = false,
        banner: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        footer: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        css_chunking: bool = false,
        drop: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        features: bun.StringSet = bun.StringSet.init(bun.default_allocator),
        has_any_on_before_parse: bool = false,
        throw_on_error: bool = true,
        env_behavior: api.DotEnvBehavior = .disable,
        env_prefix: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        tsconfig_override: OwnedString = OwnedString.initEmpty(bun.default_allocator),
        compile: ?CompileOptions = null,
        /// In-memory files that can be used as entrypoints or imported.
        /// These files do not need to exist on disk.
        files: FileMap = .{},
        metafile: bool = false,

        pub const CompileOptions = struct {
            compile_target: CompileTarget = .{},
            exec_argv: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            executable_path: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            windows_hide_console: bool = false,
            windows_icon_path: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            windows_title: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            windows_publisher: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            windows_version: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            windows_description: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            windows_copyright: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            outfile: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            autoload_dotenv: bool = true,
            autoload_bunfig: bool = true,
            autoload_tsconfig: bool = false,
            autoload_package_json: bool = false,

            pub fn fromJS(globalThis: *jsc.JSGlobalObject, config: jsc.JSValue, allocator: std.mem.Allocator, compile_target: ?CompileTarget) JSError!?CompileOptions {
                var this = CompileOptions{
                    .exec_argv = OwnedString.initEmpty(allocator),
                    .executable_path = OwnedString.initEmpty(allocator),
                    .windows_icon_path = OwnedString.initEmpty(allocator),
                    .windows_title = OwnedString.initEmpty(allocator),
                    .windows_publisher = OwnedString.initEmpty(allocator),
                    .windows_version = OwnedString.initEmpty(allocator),
                    .windows_description = OwnedString.initEmpty(allocator),
                    .windows_copyright = OwnedString.initEmpty(allocator),
                    .outfile = OwnedString.initEmpty(allocator),
                    .compile_target = compile_target orelse .{},
                };
                errdefer this.deinit();

                const object = brk: {
                    const compile_value = try config.getTruthy(globalThis, "compile") orelse return null;

                    if (compile_value.isBoolean()) {
                        if (compile_value == .false) {
                            return null;
                        }
                        return this;
                    } else if (compile_value.isString()) {
                        this.compile_target = try CompileTarget.fromJS(globalThis, compile_value);
                        return this;
                    } else if (compile_value.isObject()) {
                        break :brk compile_value;
                    } else {
                        return globalThis.throwInvalidArguments("Expected compile to be a boolean or string or options object", .{});
                    }
                };

                if (try object.getOwn(globalThis, "target")) |target| {
                    this.compile_target = try CompileTarget.fromJS(globalThis, target);
                }

                if (try object.getOwnArray(globalThis, "execArgv")) |exec_argv| {
                    var iter = try exec_argv.arrayIterator(globalThis);
                    var is_first = true;
                    while (try iter.next()) |arg| {
                        var slice = try arg.toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        if (is_first) {
                            is_first = false;
                            try this.exec_argv.appendSlice(slice.slice());
                        } else {
                            try this.exec_argv.appendChar(' ');
                            try this.exec_argv.appendSlice(slice.slice());
                        }
                    }
                }

                if (try object.getOwn(globalThis, "executablePath")) |executable_path| {
                    var slice = try executable_path.toSlice(globalThis, bun.default_allocator);
                    defer slice.deinit();
                    if (bun.sys.existsAtType(bun.FD.cwd(), slice.slice()).unwrapOr(.directory) != .file) {
                        return globalThis.throwInvalidArguments("executablePath must be a valid path to a Bun executable", .{});
                    }

                    try this.executable_path.appendSliceExact(slice.slice());
                }

                if (try object.getOwnTruthy(globalThis, "windows")) |windows| {
                    if (!windows.isObject()) {
                        return globalThis.throwInvalidArguments("windows must be an object", .{});
                    }

                    if (try windows.getOwn(globalThis, "hideConsole")) |hide_console| {
                        this.windows_hide_console = hide_console.toBoolean();
                    }

                    if (try windows.getOwn(globalThis, "icon")) |windows_icon_path| {
                        var slice = try windows_icon_path.toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        if (bun.sys.existsAtType(bun.FD.cwd(), slice.slice()).unwrapOr(.directory) != .file) {
                            return globalThis.throwInvalidArguments("windows.icon must be a valid path to an ico file", .{});
                        }

                        try this.windows_icon_path.appendSliceExact(slice.slice());
                    }

                    if (try windows.getOwn(globalThis, "title")) |windows_title| {
                        var slice = try windows_title.toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        try this.windows_title.appendSliceExact(slice.slice());
                    }

                    if (try windows.getOwn(globalThis, "publisher")) |windows_publisher| {
                        var slice = try windows_publisher.toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        try this.windows_publisher.appendSliceExact(slice.slice());
                    }

                    if (try windows.getOwn(globalThis, "version")) |windows_version| {
                        var slice = try windows_version.toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        try this.windows_version.appendSliceExact(slice.slice());
                    }

                    if (try windows.getOwn(globalThis, "description")) |windows_description| {
                        var slice = try windows_description.toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        try this.windows_description.appendSliceExact(slice.slice());
                    }

                    if (try windows.getOwn(globalThis, "copyright")) |windows_copyright| {
                        var slice = try windows_copyright.toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        try this.windows_copyright.appendSliceExact(slice.slice());
                    }
                }

                if (try object.getOwn(globalThis, "outfile")) |outfile| {
                    var slice = try outfile.toSlice(globalThis, bun.default_allocator);
                    defer slice.deinit();
                    try this.outfile.appendSliceExact(slice.slice());
                }

                if (try object.getBooleanLoose(globalThis, "autoloadDotenv")) |autoload_dotenv| {
                    this.autoload_dotenv = autoload_dotenv;
                }

                if (try object.getBooleanLoose(globalThis, "autoloadBunfig")) |autoload_bunfig| {
                    this.autoload_bunfig = autoload_bunfig;
                }

                if (try object.getBooleanLoose(globalThis, "autoloadTsconfig")) |autoload_tsconfig| {
                    this.autoload_tsconfig = autoload_tsconfig;
                }

                if (try object.getBooleanLoose(globalThis, "autoloadPackageJson")) |autoload_package_json| {
                    this.autoload_package_json = autoload_package_json;
                }

                return this;
            }

            pub fn deinit(this: *CompileOptions) void {
                this.exec_argv.deinit();
                this.executable_path.deinit();
                this.windows_icon_path.deinit();
                this.windows_title.deinit();
                this.windows_publisher.deinit();
                this.windows_version.deinit();
                this.windows_description.deinit();
                this.windows_copyright.deinit();
                this.outfile.deinit();
            }
        };

        pub const List = bun.StringArrayHashMapUnmanaged(Config);

        pub fn fromJS(globalThis: *jsc.JSGlobalObject, config: jsc.JSValue, plugins: *?*Plugin, allocator: std.mem.Allocator) JSError!Config {
            var this = Config{
                .entry_points = bun.StringSet.init(allocator),
                .external = bun.StringSet.init(allocator),
                .define = bun.StringMap.init(allocator, true),
                .dir = OwnedString.initEmpty(allocator),
                .outdir = OwnedString.initEmpty(allocator),
                .rootdir = OwnedString.initEmpty(allocator),
                .names = .{
                    .owned_entry_point = OwnedString.initEmpty(allocator),
                    .owned_chunk = OwnedString.initEmpty(allocator),
                    .owned_asset = OwnedString.initEmpty(allocator),
                },
            };
            errdefer this.deinit(allocator);
            errdefer if (plugins.*) |plugin| plugin.deinit();

            var did_set_target = false;
            if (try config.getOptional(globalThis, "target", ZigString.Slice)) |slice| {
                defer slice.deinit();
                if (strings.hasPrefixComptime(slice.slice(), "bun-")) {
                    this.compile = .{
                        .compile_target = try CompileTarget.fromSlice(globalThis, slice.slice()),
                        .exec_argv = OwnedString.initEmpty(allocator),
                        .executable_path = OwnedString.initEmpty(allocator),
                        .windows_icon_path = OwnedString.initEmpty(allocator),
                        .windows_title = OwnedString.initEmpty(allocator),
                        .windows_publisher = OwnedString.initEmpty(allocator),
                        .windows_version = OwnedString.initEmpty(allocator),
                        .windows_description = OwnedString.initEmpty(allocator),
                        .windows_copyright = OwnedString.initEmpty(allocator),
                        .outfile = OwnedString.initEmpty(allocator),
                    };
                    this.target = .bun;
                    did_set_target = true;
                } else {
                    this.target = options.Target.Map.get(slice.slice()) orelse {
                        return globalThis.throwInvalidArguments("Expected target to be one of 'browser', 'node', 'bun', 'macro', or 'bun-<target>', got {s}", .{slice.slice()});
                    };
                    did_set_target = true;
                }
            }

            // Plugins must be resolved first as they are allowed to mutate the config JSValue
            if (try config.getArray(globalThis, "plugins")) |array| {
                const length = try array.getLength(globalThis);
                var iter = try array.arrayIterator(globalThis);
                var onstart_promise_array: JSValue = .js_undefined;
                var i: usize = 0;
                while (try iter.next()) |plugin| : (i += 1) {
                    if (!plugin.isObject()) {
                        return globalThis.throwInvalidArguments("Expected plugin to be an object", .{});
                    }

                    if (try plugin.getOptional(globalThis, "name", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (slice.len == 0) {
                            return globalThis.throwInvalidArguments("Expected plugin to have a non-empty name", .{});
                        }
                    } else {
                        return globalThis.throwInvalidArguments("Expected plugin to have a name", .{});
                    }

                    const function = try plugin.getFunction(globalThis, "setup") orelse {
                        return globalThis.throwInvalidArguments("Expected plugin to have a setup() function", .{});
                    };

                    var bun_plugins: *Plugin = plugins.* orelse brk: {
                        plugins.* = Plugin.create(
                            globalThis,
                            switch (this.target) {
                                .bun, .bun_macro => jsc.JSGlobalObject.BunPluginTarget.bun,
                                .node => jsc.JSGlobalObject.BunPluginTarget.node,
                                else => .browser,
                            },
                        );
                        break :brk plugins.*.?;
                    };

                    const is_last = i == length - 1;
                    var plugin_result = try bun_plugins.addPlugin(function, config, onstart_promise_array, is_last, false);

                    if (!plugin_result.isEmptyOrUndefinedOrNull()) {
                        if (plugin_result.asAnyPromise()) |promise| {
                            promise.setHandled(globalThis.vm());
                            globalThis.bunVM().waitForPromise(promise);
                            switch (promise.unwrap(globalThis.vm(), .mark_handled)) {
                                .pending => unreachable,
                                .fulfilled => |val| {
                                    plugin_result = val;
                                },
                                .rejected => |err| {
                                    return globalThis.throwValue(err);
                                },
                            }
                        }
                    }

                    if (plugin_result.toError()) |err| {
                        return globalThis.throwValue(err);
                    } else if (globalThis.hasException()) {
                        return error.JSError;
                    }

                    onstart_promise_array = plugin_result;
                }
            }

            if (try config.getBooleanLoose(globalThis, "macros")) |macros_flag| {
                this.no_macros = !macros_flag;
            }

            if (try config.getBooleanLoose(globalThis, "bytecode")) |bytecode| {
                this.bytecode = bytecode;

                if (bytecode) {
                    // Default to CJS for bytecode, since esm doesn't really work yet.
                    this.format = .cjs;
                    if (did_set_target and this.target != .bun and this.bytecode) {
                        return globalThis.throwInvalidArguments("target must be 'bun' when bytecode is true", .{});
                    }
                    this.target = .bun;
                }
            }

            if (try config.getBooleanLoose(globalThis, "reactFastRefresh")) |react_fast_refresh| {
                this.react_fast_refresh = react_fast_refresh;
            }

            var has_out_dir = false;
            if (try config.getOptional(globalThis, "outdir", ZigString.Slice)) |slice| {
                defer slice.deinit();
                try this.outdir.appendSliceExact(slice.slice());
                has_out_dir = true;
            }

            if (try config.getOptional(globalThis, "banner", ZigString.Slice)) |slice| {
                defer slice.deinit();
                try this.banner.appendSliceExact(slice.slice());
            }

            if (try config.getOptional(globalThis, "footer", ZigString.Slice)) |slice| {
                defer slice.deinit();
                try this.footer.appendSliceExact(slice.slice());
            }

            if (try config.getTruthy(globalThis, "sourcemap")) |source_map_js| {
                if (source_map_js.isBoolean()) {
                    if (source_map_js == .true) {
                        this.source_map = if (has_out_dir)
                            .linked
                        else
                            .@"inline";
                    }
                } else if (!source_map_js.isEmptyOrUndefinedOrNull()) {
                    this.source_map = try source_map_js.toEnum(
                        globalThis,
                        "sourcemap",
                        options.SourceMapOption,
                    );
                }
            }

            if (try config.get(globalThis, "env")) |env| {
                if (!env.isUndefined()) {
                    if (env == .null or env == .false or (env.isNumber() and env.asNumber() == 0)) {
                        this.env_behavior = .disable;
                    } else if (env == .true or (env.isNumber() and env.asNumber() == 1)) {
                        this.env_behavior = .load_all;
                    } else if (env.isString()) {
                        const slice = try env.toSlice(globalThis, bun.default_allocator);
                        defer slice.deinit();
                        if (strings.eqlComptime(slice.slice(), "inline")) {
                            this.env_behavior = .load_all;
                        } else if (strings.eqlComptime(slice.slice(), "disable")) {
                            this.env_behavior = .disable;
                        } else if (strings.indexOfChar(slice.slice(), '*')) |asterisk| {
                            if (asterisk > 0) {
                                this.env_behavior = .prefix;
                                try this.env_prefix.appendSliceExact(slice.slice()[0..asterisk]);
                            } else {
                                this.env_behavior = .load_all;
                            }
                        } else {
                            return globalThis.throwInvalidArguments("env must be 'inline', 'disable', or a string with a '*' character", .{});
                        }
                    } else {
                        return globalThis.throwInvalidArguments("env must be 'inline', 'disable', or a string with a '*' character", .{});
                    }
                }
            }

            if (try config.getOptionalEnum(globalThis, "packages", options.PackagesOption)) |packages| {
                this.packages = packages;
            }

            // Parse JSX configuration
            if (try config.getTruthy(globalThis, "jsx")) |jsx_value| {
                if (!jsx_value.isObject()) {
                    return globalThis.throwInvalidArguments("jsx must be an object", .{});
                }

                if (try jsx_value.getOptional(globalThis, "runtime", ZigString.Slice)) |slice| {
                    defer slice.deinit();
                    var str_lower: [128]u8 = undefined;
                    const len = @min(slice.len, str_lower.len);
                    _ = strings.copyLowercase(slice.slice()[0..len], str_lower[0..len]);
                    if (options.JSX.RuntimeMap.get(str_lower[0..len])) |runtime| {
                        this.jsx.runtime = runtime.runtime;
                        if (runtime.development) |dev| {
                            this.jsx.development = dev;
                        }
                    } else {
                        return globalThis.throwInvalidArguments("Invalid jsx.runtime: '{s}'. Must be one of: 'classic', 'automatic', 'react', 'react-jsx', or 'react-jsxdev'", .{slice.slice()});
                    }
                }

                if (try jsx_value.getOptional(globalThis, "factory", ZigString.Slice)) |slice| {
                    defer slice.deinit();
                    this.jsx.factory = try allocator.dupe(u8, slice.slice());
                }

                if (try jsx_value.getOptional(globalThis, "fragment", ZigString.Slice)) |slice| {
                    defer slice.deinit();
                    this.jsx.fragment = try allocator.dupe(u8, slice.slice());
                }

                if (try jsx_value.getOptional(globalThis, "importSource", ZigString.Slice)) |slice| {
                    defer slice.deinit();
                    this.jsx.import_source = try allocator.dupe(u8, slice.slice());
                }

                if (try jsx_value.getBooleanLoose(globalThis, "development")) |dev| {
                    this.jsx.development = dev;
                }

                if (try jsx_value.getBooleanLoose(globalThis, "sideEffects")) |val| {
                    this.jsx.side_effects = val;
                }
            }

            if (try config.getOptionalEnum(globalThis, "format", options.Format)) |format| {
                this.format = format;

                if (this.bytecode and format != .cjs) {
                    return globalThis.throwInvalidArguments("format must be 'cjs' when bytecode is true. Eventually we'll add esm support as well.", .{});
                }
            }

            if (try config.getBooleanLoose(globalThis, "splitting")) |hot| {
                this.code_splitting = hot;
            }

            if (try config.getTruthy(globalThis, "minify")) |minify| {
                if (minify.isBoolean()) {
                    const value = minify.toBoolean();
                    this.minify.whitespace = value;
                    this.minify.syntax = value;
                    this.minify.identifiers = value;
                } else if (minify.isObject()) {
                    if (try minify.getBooleanLoose(globalThis, "whitespace")) |whitespace| {
                        this.minify.whitespace = whitespace;
                    }
                    if (try minify.getBooleanLoose(globalThis, "syntax")) |syntax| {
                        this.minify.syntax = syntax;
                    }
                    if (try minify.getBooleanLoose(globalThis, "identifiers")) |syntax| {
                        this.minify.identifiers = syntax;
                    }
                    if (try minify.getBooleanLoose(globalThis, "keepNames")) |keep_names| {
                        this.minify.keep_names = keep_names;
                    }
                } else {
                    return globalThis.throwInvalidArguments("Expected minify to be a boolean or an object", .{});
                }
            }

            if (try config.getArray(globalThis, "entrypoints") orelse try config.getArray(globalThis, "entryPoints")) |entry_points| {
                var iter = try entry_points.arrayIterator(globalThis);
                while (try iter.next()) |entry_point| {
                    var slice = try entry_point.toSliceOrNull(globalThis);
                    defer slice.deinit();
                    try this.entry_points.insert(slice.slice());
                }
            } else {
                return globalThis.throwInvalidArguments("Expected entrypoints to be an array of strings", .{});
            }

            // Parse the files option for in-memory files
            if (try config.getOwnObject(globalThis, "files")) |files_obj| {
                this.files = try FileMap.fromJS(globalThis, files_obj.toJS());
            }

            if (try config.getBooleanLoose(globalThis, "emitDCEAnnotations")) |flag| {
                this.emit_dce_annotations = flag;
            }

            if (try config.getBooleanLoose(globalThis, "ignoreDCEAnnotations")) |flag| {
                this.ignore_dce_annotations = flag;
            }

            if (try config.getTruthy(globalThis, "conditions")) |conditions_value| {
                if (conditions_value.isString()) {
                    var slice = try conditions_value.toSliceOrNull(globalThis);
                    defer slice.deinit();
                    try this.conditions.insert(slice.slice());
                } else if (conditions_value.jsType().isArray()) {
                    var iter = try conditions_value.arrayIterator(globalThis);
                    while (try iter.next()) |entry_point| {
                        var slice = try entry_point.toSliceOrNull(globalThis);
                        defer slice.deinit();
                        try this.conditions.insert(slice.slice());
                    }
                } else {
                    return globalThis.throwInvalidArguments("Expected conditions to be an array of strings", .{});
                }
            }

            {
                const path: ZigString.Slice = brk: {
                    if (try config.getOptional(globalThis, "root", ZigString.Slice)) |slice| {
                        break :brk slice;
                    }

                    const entry_points = this.entry_points.keys();

                    // Check if all entry points are in the FileMap - if so, use cwd
                    if (this.files.map.count() > 0) {
                        var all_in_filemap = true;
                        for (entry_points) |ep| {
                            if (!this.files.contains(ep)) {
                                all_in_filemap = false;
                                break;
                            }
                        }
                        if (all_in_filemap) {
                            break :brk ZigString.Slice.fromUTF8NeverFree(".");
                        }
                    }

                    if (entry_points.len == 1) {
                        break :brk ZigString.Slice.fromUTF8NeverFree(std.fs.path.dirname(entry_points[0]) orelse ".");
                    }

                    break :brk ZigString.Slice.fromUTF8NeverFree(resolve_path.getIfExistsLongestCommonPath(entry_points) orelse ".");
                };

                defer path.deinit();

                var dir = bun.FD.fromStdDir(std.fs.cwd().openDir(path.slice(), .{}) catch |err| {
                    return globalThis.throwPretty("{s}: failed to open root directory: {s}", .{ @errorName(err), path.slice() });
                });
                defer dir.close();

                var rootdir_buf: bun.PathBuffer = undefined;
                const rootdir = dir.getFdPath(&rootdir_buf) catch |err| {
                    return globalThis.throwPretty("{s}: failed to get full root directory path: {s}", .{ @errorName(err), path.slice() });
                };
                try this.rootdir.appendSliceExact(rootdir);
            }

            if (try config.getOwnArray(globalThis, "external")) |externals| {
                var iter = try externals.arrayIterator(globalThis);
                while (try iter.next()) |entry_point| {
                    var slice = try entry_point.toSliceOrNull(globalThis);
                    defer slice.deinit();
                    try this.external.insert(slice.slice());
                }
            }

            if (try config.getOwnArray(globalThis, "drop")) |drops| {
                var iter = try drops.arrayIterator(globalThis);
                while (try iter.next()) |entry| {
                    var slice = try entry.toSliceOrNull(globalThis);
                    defer slice.deinit();
                    try this.drop.insert(slice.slice());
                }
            }

            if (try config.getOwnArray(globalThis, "features")) |features| {
                var iter = try features.arrayIterator(globalThis);
                while (try iter.next()) |entry| {
                    var slice = try entry.toSliceOrNull(globalThis);
                    defer slice.deinit();
                    try this.features.insert(slice.slice());
                }
            }

            // if (try config.getOptional(globalThis, "dir", ZigString.Slice)) |slice| {
            //     defer slice.deinit();
            //     this.appendSliceExact(slice.slice()) catch unreachable;
            // } else {
            //     this.appendSliceExact(globalThis.bunVM().transpiler.fs.top_level_dir) catch unreachable;
            // }

            if (try config.getOptional(globalThis, "publicPath", ZigString.Slice)) |slice| {
                defer slice.deinit();
                try this.public_path.appendSliceExact(slice.slice());
            }

            if (try config.getTruthy(globalThis, "naming")) |naming| {
                if (naming.isString()) {
                    if (try config.getOptional(globalThis, "naming", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            try this.names.owned_entry_point.appendSliceExact("./");
                        }
                        try this.names.owned_entry_point.appendSliceExact(slice.slice());
                        this.names.entry_point.data = this.names.owned_entry_point.list.items;
                    }
                } else if (naming.isObject()) {
                    if (try naming.getOptional(globalThis, "entry", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            try this.names.owned_entry_point.appendSliceExact("./");
                        }
                        try this.names.owned_entry_point.appendSliceExact(slice.slice());
                        this.names.entry_point.data = this.names.owned_entry_point.list.items;
                    }

                    if (try naming.getOptional(globalThis, "chunk", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            try this.names.owned_chunk.appendSliceExact("./");
                        }
                        try this.names.owned_chunk.appendSliceExact(slice.slice());
                        this.names.chunk.data = this.names.owned_chunk.list.items;
                    }

                    if (try naming.getOptional(globalThis, "asset", ZigString.Slice)) |slice| {
                        defer slice.deinit();
                        if (!strings.hasPrefixComptime(slice.slice(), "./")) {
                            try this.names.owned_asset.appendSliceExact("./");
                        }
                        try this.names.owned_asset.appendSliceExact(slice.slice());
                        this.names.asset.data = this.names.owned_asset.list.items;
                    }
                } else {
                    return globalThis.throwInvalidArguments("Expected naming to be a string or an object", .{});
                }
            }

            if (try config.getOwnObject(globalThis, "define")) |define| {
                var define_iter = try jsc.JSPropertyIterator(.{
                    .skip_empty_name = true,
                    .include_value = true,
                }).init(globalThis, define);
                defer define_iter.deinit();

                while (try define_iter.next()) |prop| {
                    const property_value = define_iter.value;
                    const value_type = property_value.jsType();

                    if (!value_type.isStringLike()) {
                        return globalThis.throwInvalidArguments("define \"{f}\" must be a JSON string", .{prop});
                    }

                    var val = jsc.ZigString.init("");
                    try property_value.toZigString(&val, globalThis);
                    if (val.len == 0) {
                        val = jsc.ZigString.fromUTF8("\"\"");
                    }

                    const key = try prop.toOwnedSlice(bun.default_allocator);

                    // value is always cloned
                    const value = val.toSlice(bun.default_allocator);
                    defer value.deinit();

                    // .insert clones the value, but not the key
                    try this.define.insert(key, value.slice());
                }
            }

            if (try config.getOwnObject(globalThis, "loader")) |loaders| {
                var loader_iter = try jsc.JSPropertyIterator(.{
                    .skip_empty_name = true,
                    .include_value = true,
                }).init(globalThis, loaders);
                defer loader_iter.deinit();

                var loader_names = try allocator.alloc(string, loader_iter.len);
                errdefer allocator.free(loader_names);
                var loader_values = try allocator.alloc(api.Loader, loader_iter.len);
                errdefer allocator.free(loader_values);

                while (try loader_iter.next()) |prop| {
                    if (!prop.hasPrefixComptime(".") or prop.length() < 2) {
                        return globalThis.throwInvalidArguments("loader property names must be file extensions, such as '.txt'", .{});
                    }

                    loader_values[loader_iter.i] = try loader_iter.value.toEnumFromMap(
                        globalThis,
                        "loader",
                        api.Loader,
                        options.Loader.api_names,
                    );
                    loader_names[loader_iter.i] = try prop.toOwnedSlice(bun.default_allocator);
                }

                this.loaders = api.LoaderMap{
                    .extensions = loader_names,
                    .loaders = loader_values,
                };
            }

            if (try config.getBooleanStrict(globalThis, "throw")) |flag| {
                this.throw_on_error = flag;
            }

            if (try config.getBooleanLoose(globalThis, "metafile")) |flag| {
                this.metafile = flag;
            }

            if (try CompileOptions.fromJS(
                globalThis,
                config,
                bun.default_allocator,
                if (this.compile) |*compile| compile.compile_target else null,
            )) |compile| {
                this.compile = compile;
            }

            if (this.compile) |*compile| {
                this.target = .bun;

                const define_keys = compile.compile_target.defineKeys();
                const define_values = compile.compile_target.defineValues();
                for (define_keys, define_values) |key, value| {
                    try this.define.insert(key, value);
                }

                const base_public_path = bun.StandaloneModuleGraph.targetBasePublicPath(this.compile.?.compile_target.os, "root/");
                try this.public_path.append(base_public_path);

                // When using --compile, only `external` sourcemaps work, as we do not
                // look at the source map comment. Override any other sourcemap type.
                if (this.source_map != .none) {
                    this.source_map = .external;
                }

                if (compile.outfile.isEmpty()) {
                    const entry_point = this.entry_points.keys()[0];
                    var outfile = std.fs.path.basename(entry_point);
                    const ext = std.fs.path.extension(outfile);
                    if (ext.len > 0) {
                        outfile = outfile[0 .. outfile.len - ext.len];
                    }

                    if (strings.eqlComptime(outfile, "index")) {
                        outfile = std.fs.path.basename(std.fs.path.dirname(entry_point) orelse "index");
                    }

                    if (strings.eqlComptime(outfile, "bun")) {
                        outfile = std.fs.path.basename(std.fs.path.dirname(entry_point) orelse "bun");
                    }

                    // If argv[0] is "bun" or "bunx", we don't check if the binary is standalone
                    if (strings.eqlComptime(outfile, "bun") or strings.eqlComptime(outfile, "bunx")) {
                        return globalThis.throwInvalidArguments("cannot use compile with an output file named 'bun' because bun won't realize it's a standalone executable. Please choose a different name for compile.outfile", .{});
                    }

                    try compile.outfile.appendSliceExact(outfile);
                }
            }

            return this;
        }

        pub const Names = struct {
            owned_entry_point: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            entry_point: options.PathTemplate = options.PathTemplate.file,
            owned_chunk: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            chunk: options.PathTemplate = options.PathTemplate.chunk,

            owned_asset: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            asset: options.PathTemplate = options.PathTemplate.asset,

            pub fn deinit(self: *Names) void {
                self.owned_entry_point.deinit();
                self.owned_chunk.deinit();
                self.owned_asset.deinit();
            }
        };

        pub const Minify = struct {
            whitespace: bool = false,
            identifiers: bool = false,
            syntax: bool = false,
            keep_names: bool = false,
        };

        pub const Serve = struct {
            handler_path: OwnedString = OwnedString.initEmpty(bun.default_allocator),
            prefix: OwnedString = OwnedString.initEmpty(bun.default_allocator),

            pub fn deinit(self: *Serve, allocator: std.mem.Allocator) void {
                _ = allocator;
                self.handler_path.deinit();
                self.prefix.deinit();
            }
        };

        pub fn deinit(self: *Config, allocator: std.mem.Allocator) void {
            self.entry_points.deinit();
            self.external.deinit();
            self.define.deinit();
            self.dir.deinit();
            self.serve.deinit(allocator);
            if (self.loaders) |loaders| {
                for (loaders.extensions) |ext| {
                    bun.default_allocator.free(ext);
                }
                bun.default_allocator.free(loaders.loaders);
                bun.default_allocator.free(loaders.extensions);
            }
            // Free JSX allocated strings
            if (self.jsx.factory.len > 0) {
                allocator.free(self.jsx.factory);
                self.jsx.factory = "";
            }
            if (self.jsx.fragment.len > 0) {
                allocator.free(self.jsx.fragment);
                self.jsx.fragment = "";
            }
            if (self.jsx.import_source.len > 0) {
                allocator.free(self.jsx.import_source);
                self.jsx.import_source = "";
            }
            self.names.deinit();
            self.outdir.deinit();
            self.rootdir.deinit();
            self.public_path.deinit();
            self.conditions.deinit();
            self.drop.deinit();
            self.features.deinit();
            self.banner.deinit();
            if (self.compile) |*compile| {
                compile.deinit();
            }
            self.env_prefix.deinit();
            self.footer.deinit();
            self.tsconfig_override.deinit();
            self.files.deinitAndUnprotect();
        }
    };

    fn build(
        globalThis: *jsc.JSGlobalObject,
        arguments: []const jsc.JSValue,
    ) bun.JSError!jsc.JSValue {
        if (arguments.len == 0 or !arguments[0].isObject()) {
            return globalThis.throwInvalidArguments("Expected a config object to be passed to Bun.build", .{});
        }

        const vm = globalThis.bunVM();

        // Detect and prevent calling Bun.build from within a macro during bundling.
        // This would cause a deadlock because:
        // 1. The bundler thread (singleton) is processing the outer Bun.build
        // 2. During parsing, it encounters a macro and evaluates it
        // 3. The macro calls Bun.build, which tries to enqueue to the same singleton thread
        // 4. The singleton thread is blocked waiting for the macro to complete -> deadlock
        if (vm.macro_mode) {
            return globalThis.throw(
                \\Bun.build cannot be called from within a macro during bundling.
                \\
                \\This would cause a deadlock because the bundler is waiting for the macro to complete,
                \\but the macro's Bun.build call is waiting for the bundler.
                \\
                \\To bundle code at compile time in a macro, use Bun.spawnSync to invoke the CLI:
                \\  const result = Bun.spawnSync(["bun", "build", entrypoint, "--format=esm"]);
            ,
                .{},
            );
        }

        var plugins: ?*Plugin = null;
        const config = try Config.fromJS(globalThis, arguments[0], &plugins, bun.default_allocator);

        return bun.BundleV2.generateFromJavaScript(
            config,
            plugins,
            globalThis,
            vm.eventLoop(),
            bun.default_allocator,
        );
    }

    /// `Bun.build(config)`
    pub fn buildFn(
        globalThis: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        const arguments = callframe.arguments_old(1);
        return build(globalThis, arguments.slice());
    }

    pub const Resolve = struct {
        bv2: *BundleV2,
        import_record: MiniImportRecord,
        value: Value,

        js_task: jsc.AnyTask,
        task: jsc.AnyEventLoop.Task,

        pub const MiniImportRecord = struct {
            kind: bun.ImportKind,
            source_file: string = "",
            namespace: string = "",
            specifier: string = "",
            importer_source_index: u32,
            import_record_index: u32 = 0,
            range: logger.Range = logger.Range.None,
            original_target: Target,

            // pub inline fn loader(_: *const MiniImportRecord) ?options.Loader {
            //     return null;
            // }
        };

        pub fn init(bv2: *bun.BundleV2, record: MiniImportRecord) Resolve {
            return .{
                .bv2 = bv2,
                .import_record = record,
                .value = .pending,

                .task = undefined,
                .js_task = undefined,
            };
        }

        pub const Value = union(enum) {
            err: logger.Msg,
            success: struct {
                path: []const u8 = "",
                namespace: []const u8 = "",
                external: bool = false,

                pub fn deinit(this: *@This()) void {
                    bun.default_allocator.free(this.path);
                    bun.default_allocator.free(this.namespace);
                }
            },
            no_match,
            pending,
            consumed,

            pub fn consume(this: *Value) Value {
                const result = this.*;
                this.* = .{ .consumed = {} };
                return result;
            }

            pub fn deinit(this: *Resolve.Value) void {
                switch (this.*) {
                    .success => |*success| {
                        success.deinit();
                    },
                    .err => |*err| {
                        err.deinit(bun.default_allocator);
                    },
                    .no_match, .pending, .consumed => {},
                }
                this.* = .{ .consumed = {} };
            }
        };

        pub fn deinit(this: *Resolve) void {
            this.value.deinit();
            bun.default_allocator.destroy(this);
        }

        const AnyTask = jsc.AnyTask.New(@This(), runOnJSThread);

        pub fn dispatch(this: *Resolve) void {
            this.js_task = AnyTask.init(this);
            this.bv2.jsLoopForPlugins().enqueueTaskConcurrent(jsc.ConcurrentTask.create(this.js_task.task()));
        }

        pub fn runOnJSThread(this: *Resolve) void {
            this.bv2.plugins.?.matchOnResolve(
                this.import_record.specifier,
                this.import_record.namespace,
                this.import_record.source_file,
                this,
                this.import_record.kind,
            );
        }

        export fn JSBundlerPlugin__onResolveAsync(
            resolve: *Resolve,
            _: *anyopaque,
            path_value: JSValue,
            namespace_value: JSValue,
            external_value: JSValue,
        ) void {
            if (path_value.isEmptyOrUndefinedOrNull() or namespace_value.isEmptyOrUndefinedOrNull()) {
                resolve.value = .{ .no_match = {} };
            } else {
                const global = resolve.bv2.plugins.?.globalObject();
                const path = path_value.toSliceCloneWithAllocator(global, bun.default_allocator) catch @panic("Unexpected: path is not a string");
                const namespace = namespace_value.toSliceCloneWithAllocator(global, bun.default_allocator) catch @panic("Unexpected: namespace is not a string");
                resolve.value = .{
                    .success = .{
                        .path = path.slice(),
                        .namespace = namespace.slice(),
                        .external = external_value.to(bool),
                    },
                };
            }

            resolve.bv2.onResolveAsync(resolve);
        }

        comptime {
            _ = JSBundlerPlugin__onResolveAsync;
        }
    };

    const DeferredTask = bun.bundle_v2.DeferredTask;

    pub const Load = struct {
        bv2: *BundleV2,

        source_index: Index,
        default_loader: options.Loader,
        path: []const u8,
        namespace: []const u8,

        value: Value,
        js_task: jsc.AnyTask,
        task: jsc.AnyEventLoop.Task,
        parse_task: *bun.ParseTask,
        /// Faster path: skip the extra threadpool dispatch when the file is not found
        was_file: bool,
        /// Defer may only be called once
        called_defer: bool,

        const debug_deferred = bun.Output.scoped(.BUNDLER_DEFERRED, .hidden);

        pub fn init(bv2: *bun.BundleV2, parse: *bun.bundle_v2.ParseTask) Load {
            return .{
                .bv2 = bv2,
                .parse_task = parse,
                .source_index = parse.source_index,
                .default_loader = parse.path.loader(&bv2.transpiler.options.loaders) orelse .js,
                .value = .pending,
                .path = parse.path.text,
                .namespace = parse.path.namespace,
                .was_file = false,
                .called_defer = false,
                .task = undefined,
                .js_task = undefined,
            };
        }

        pub fn bakeGraph(load: *const Load) bun.bake.Graph {
            return load.parse_task.known_target.bakeGraph();
        }

        pub const Value = union(enum) {
            err: logger.Msg,
            success: struct {
                source_code: []const u8 = "",
                loader: options.Loader = .file,
            },
            pending,
            no_match,
            /// The value has been de-initialized or left over from `consume()`
            consumed,

            pub fn deinit(this: *Value) void {
                switch (this.*) {
                    .success => |success| {
                        bun.default_allocator.free(success.source_code);
                    },
                    .err => |*err| {
                        err.deinit(bun.default_allocator);
                    },
                    .no_match, .pending, .consumed => {},
                }
                this.* = .{ .consumed = {} };
            }

            /// Moves the value, replacing the original with `.consumed`. It is
            /// safe to `deinit()` the consumed value, but the memory in `err`
            /// and `success` must be freed by the caller.
            pub fn consume(this: *Value) Value {
                const result = this.*;
                this.* = .{ .consumed = {} };
                return result;
            }
        };

        pub fn deinit(this: *Load) void {
            debug("Deinit Load(0{x}, {s})", .{ @intFromPtr(this), this.path });
            this.value.deinit();
        }

        const AnyTask = jsc.AnyTask.New(@This(), runOnJSThread);

        pub fn runOnJSThread(load: *Load) void {
            load.bv2.plugins.?.matchOnLoad(
                load.path,
                load.namespace,
                load,
                load.default_loader,
                load.bakeGraph() != .client,
            );
        }

        pub fn dispatch(this: *Load) void {
            this.js_task = AnyTask.init(this);
            const concurrent_task = jsc.ConcurrentTask.createFrom(&this.js_task);
            this.bv2.jsLoopForPlugins().enqueueTaskConcurrent(concurrent_task);
        }

        export fn JSBundlerPlugin__onDefer(load: *Load, global: *jsc.JSGlobalObject) JSValue {
            return jsc.toJSHostCall(global, @src(), Load.onDefer, .{ load, global });
        }
        fn onDefer(this: *Load, globalObject: *jsc.JSGlobalObject) bun.JSError!JSValue {
            if (this.called_defer) {
                return globalObject.throw("Can't call .defer() more than once within an onLoad plugin", .{});
            }
            this.called_defer = true;

            debug_deferred("JSBundlerPlugin__onDefer(0x{x}, {s})", .{ @intFromPtr(this), this.path });

            // Notify the bundler thread about the deferral. This will decrement
            // the pending item counter and increment the deferred counter.
            switch (this.parse_task.ctx.loop().*) {
                .js => |jsc_event_loop| {
                    jsc_event_loop.enqueueTaskConcurrent(jsc.ConcurrentTask.fromCallback(this.parse_task.ctx, BundleV2.onNotifyDefer));
                },
                .mini => |*mini| {
                    mini.enqueueTaskConcurrentWithExtraCtx(
                        Load,
                        BundleV2,
                        this,
                        BundleV2.onNotifyDeferMini,
                        .task,
                    );
                },
            }

            return this.bv2.plugins.?.appendDeferPromise();
        }

        export fn JSBundlerPlugin__onLoadAsync(
            this: *Load,
            _: *anyopaque,
            source_code_value: JSValue,
            loader_as_int: JSValue,
        ) void {
            jsc.markBinding(@src());
            if (source_code_value.isEmptyOrUndefinedOrNull() or loader_as_int.isEmptyOrUndefinedOrNull()) {
                this.value = .{ .no_match = {} };

                if (this.was_file) {
                    // Faster path: skip the extra threadpool dispatch
                    this.bv2.graph.pool.worker_pool.schedule(bun.ThreadPool.Batch.from(&this.parse_task.task));
                    this.deinit();
                    return;
                }
            } else {
                const loader: api.Loader = @enumFromInt(loader_as_int.to(u8));
                const global = this.bv2.plugins.?.globalObject();
                const source_code = jsc.Node.StringOrBuffer.fromJSToOwnedSlice(global, source_code_value, bun.default_allocator) catch |err| {
                    switch (err) {
                        error.OutOfMemory => {
                            bun.outOfMemory();
                        },
                        error.JSError => {},
                        error.JSTerminated => {},
                    }

                    @panic("Unexpected: source_code is not a string");
                };
                this.value = .{
                    .success = .{
                        .loader = options.Loader.fromAPI(loader),
                        .source_code = source_code,
                    },
                };
            }

            this.bv2.onLoadAsync(this);
        }

        comptime {
            _ = JSBundlerPlugin__onLoadAsync;
        }
    };

    pub const Plugin = opaque {
        extern fn JSBundlerPlugin__create(*jsc.JSGlobalObject, jsc.JSGlobalObject.BunPluginTarget) *Plugin;
        pub fn create(global: *jsc.JSGlobalObject, target: jsc.JSGlobalObject.BunPluginTarget) *Plugin {
            jsc.markBinding(@src());
            const plugin = JSBundlerPlugin__create(global, target);
            jsc.JSValue.fromCell(plugin).protect();
            return plugin;
        }

        extern fn JSBundlerPlugin__callOnBeforeParsePlugins(
            *Plugin,
            bun_context: *anyopaque,
            namespace: *const String,
            path: *const String,
            on_before_parse_args: ?*anyopaque,
            on_before_parse_result: ?*anyopaque,
            should_continue: *i32,
        ) i32;

        pub fn callOnBeforeParsePlugins(this: *Plugin, ctx: *anyopaque, namespace: *const String, path: *const String, on_before_parse_args: ?*anyopaque, on_before_parse_result: ?*anyopaque, should_continue: *i32) i32 {
            return JSBundlerPlugin__callOnBeforeParsePlugins(this, ctx, namespace, path, on_before_parse_args, on_before_parse_result, should_continue);
        }

        extern fn JSBundlerPlugin__hasOnBeforeParsePlugins(*Plugin) i32;
        pub fn hasOnBeforeParsePlugins(this: *Plugin) bool {
            return JSBundlerPlugin__hasOnBeforeParsePlugins(this) != 0;
        }

        extern fn JSBundlerPlugin__tombstone(*Plugin) void;
        extern fn JSBundlerPlugin__runOnEndCallbacks(*Plugin, jsc.JSValue, jsc.JSValue, jsc.JSValue) jsc.JSValue;

        pub fn runOnEndCallbacks(this: *Plugin, globalThis: *jsc.JSGlobalObject, build_promise: *jsc.JSPromise, build_result: jsc.JSValue, rejection: bun.JSError!jsc.JSValue) bun.JSError!jsc.JSValue {
            jsc.markBinding(@src());

            const rejection_value = rejection catch |err| switch (err) {
                error.OutOfMemory => globalThis.createOutOfMemoryError(),
                error.JSError => globalThis.takeError(err),
                error.JSTerminated => return error.JSTerminated,
            };

            var scope: jsc.TopExceptionScope = undefined;
            scope.init(globalThis, @src());
            defer scope.deinit();

            const value = JSBundlerPlugin__runOnEndCallbacks(
                this,
                build_promise.asValue(globalThis),
                build_result,
                rejection_value,
            );

            try scope.returnIfException();

            return value;
        }

        pub fn deinit(this: *Plugin) void {
            jsc.markBinding(@src());
            JSBundlerPlugin__tombstone(this);
            jsc.JSValue.fromCell(this).unprotect();
        }

        extern fn JSBundlerPlugin__globalObject(*Plugin) *jsc.JSGlobalObject;
        pub const globalObject = JSBundlerPlugin__globalObject;

        extern fn JSBundlerPlugin__anyMatches(
            *Plugin,
            namespaceString: *const String,
            path: *const String,
            bool,
        ) bool;

        extern fn JSBundlerPlugin__matchOnLoad(
            *Plugin,
            namespaceString: *const String,
            path: *const String,
            context: *anyopaque,
            u8,
            bool,
        ) void;

        extern fn JSBundlerPlugin__matchOnResolve(
            *Plugin,
            namespaceString: *const String,
            path: *const String,
            importer: *const String,
            context: *anyopaque,
            u8,
        ) void;

        extern fn JSBundlerPlugin__drainDeferred(*Plugin, rejected: bool) void;
        extern fn JSBundlerPlugin__appendDeferPromise(*Plugin) JSValue;
        pub const appendDeferPromise = JSBundlerPlugin__appendDeferPromise;

        pub fn hasAnyMatches(
            this: *Plugin,
            path: *const Fs.Path,
            is_onLoad: bool,
        ) bool {
            jsc.markBinding(@src());
            const tracer = bun.perf.trace("JSBundler.hasAnyMatches");
            defer tracer.end();

            const namespace_string = if (path.isFile())
                bun.String.empty
            else
                bun.String.cloneUTF8(path.namespace);
            const path_string = bun.String.cloneUTF8(path.text);
            defer namespace_string.deref();
            defer path_string.deref();
            return JSBundlerPlugin__anyMatches(this, &namespace_string, &path_string, is_onLoad);
        }

        pub fn matchOnLoad(
            this: *Plugin,
            path: []const u8,
            namespace: []const u8,
            context: *anyopaque,
            default_loader: options.Loader,
            is_server_side: bool,
        ) void {
            jsc.markBinding(@src());
            const tracer = bun.perf.trace("JSBundler.matchOnLoad");
            defer tracer.end();
            debug("JSBundler.matchOnLoad(0x{x}, {s}, {s})", .{ @intFromPtr(this), namespace, path });
            const namespace_string = if (namespace.len == 0)
                bun.String.static("file")
            else
                bun.String.cloneUTF8(namespace);
            const path_string = bun.String.cloneUTF8(path);
            defer namespace_string.deref();
            defer path_string.deref();
            JSBundlerPlugin__matchOnLoad(this, &namespace_string, &path_string, context, @intFromEnum(default_loader), is_server_side);
        }

        pub fn matchOnResolve(
            this: *Plugin,
            path: []const u8,
            namespace: []const u8,
            importer: []const u8,
            context: *anyopaque,
            import_record_kind: bun.ImportKind,
        ) void {
            jsc.markBinding(@src());
            const tracer = bun.perf.trace("JSBundler.matchOnResolve");
            defer tracer.end();
            const namespace_string = if (strings.eqlComptime(namespace, "file"))
                bun.String.empty
            else
                bun.String.cloneUTF8(namespace);
            const path_string = bun.String.cloneUTF8(path);
            const importer_string = bun.String.cloneUTF8(importer);
            defer namespace_string.deref();
            defer path_string.deref();
            defer importer_string.deref();
            JSBundlerPlugin__matchOnResolve(this, &namespace_string, &path_string, &importer_string, context, @intFromEnum(import_record_kind));
        }

        pub fn addPlugin(
            this: *Plugin,
            object: jsc.JSValue,
            config: jsc.JSValue,
            onstart_promises_array: jsc.JSValue,
            is_last: bool,
            is_bake: bool,
        ) !JSValue {
            jsc.markBinding(@src());
            const tracer = bun.perf.trace("JSBundler.addPlugin");
            defer tracer.end();
            return bun.jsc.fromJSHostCall(globalObject(this), @src(), JSBundlerPlugin__runSetupFunction, .{
                this,
                object,
                config,
                onstart_promises_array,
                JSValue.jsBoolean(is_last),
                JSValue.jsBoolean(is_bake),
            });
        }

        pub fn drainDeferred(this: *Plugin, rejected: bool) bun.JSError!void {
            return bun.jsc.fromJSHostCallGeneric(this.globalObject(), @src(), JSBundlerPlugin__drainDeferred, .{ this, rejected });
        }

        pub fn setConfig(this: *Plugin, config: *anyopaque) void {
            jsc.markBinding(@src());
            JSBundlerPlugin__setConfig(this, config);
        }

        extern fn JSBundlerPlugin__setConfig(*Plugin, *anyopaque) void;

        extern fn JSBundlerPlugin__runSetupFunction(
            *Plugin,
            jsc.JSValue,
            jsc.JSValue,
            jsc.JSValue,
            jsc.JSValue,
            jsc.JSValue,
        ) JSValue;

        pub export fn JSBundlerPlugin__addError(
            ctx: *anyopaque,
            plugin: *Plugin,
            exception: JSValue,
            which: JSValue,
        ) void {
            switch (which.to(i32)) {
                0 => {
                    const resolve: *JSBundler.Resolve = bun.cast(*Resolve, ctx);
                    resolve.value = .{
                        .err = logger.Msg.fromJS(
                            bun.default_allocator,
                            plugin.globalObject(),
                            resolve.import_record.source_file,
                            exception,
                        ) catch |err| switch (err) {
                            error.OutOfMemory => bun.outOfMemory(),
                            error.JSError, error.JSTerminated => {
                                plugin.globalObject().reportActiveExceptionAsUnhandled(err);
                                return;
                            },
                        },
                    };
                    resolve.bv2.onResolveAsync(resolve);
                },
                1 => {
                    const load: *Load = bun.cast(*Load, ctx);
                    load.value = .{
                        .err = logger.Msg.fromJS(
                            bun.default_allocator,
                            plugin.globalObject(),
                            load.path,
                            exception,
                        ) catch |err| switch (err) {
                            error.OutOfMemory => bun.outOfMemory(),
                            error.JSError, error.JSTerminated => {
                                plugin.globalObject().reportActiveExceptionAsUnhandled(err);
                                return;
                            },
                        },
                    };
                    load.bv2.onLoadAsync(load);
                },
                else => @panic("invalid error type"),
            }
        }
    };
};

pub const BuildArtifact = struct {
    pub const js = jsc.Codegen.JSBuildArtifact;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    blob: jsc.WebCore.Blob,
    loader: options.Loader = .file,
    path: []const u8 = "",
    hash: u64 = std.math.maxInt(u64),
    output_kind: OutputKind,
    sourcemap: jsc.Strong.Optional = .empty,

    pub const OutputKind = enum {
        chunk,
        asset,
        @"entry-point",
        sourcemap,
        bytecode,

        pub fn isFileInStandaloneMode(this: OutputKind) bool {
            return this != .sourcemap and this != .bytecode;
        }
    };

    pub fn deinit(this: *BuildArtifact) void {
        this.blob.deinit();
        this.sourcemap.deinit();

        bun.default_allocator.free(this.path);
    }

    pub fn getText(
        this: *BuildArtifact,
        globalThis: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        return @call(bun.callmod_inline, Blob.getText, .{ &this.blob, globalThis, callframe });
    }

    pub fn getJSON(
        this: *BuildArtifact,
        globalThis: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        return @call(bun.callmod_inline, Blob.getJSON, .{ &this.blob, globalThis, callframe });
    }
    pub fn getArrayBuffer(
        this: *BuildArtifact,
        globalThis: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!JSValue {
        return @call(bun.callmod_inline, Blob.getArrayBuffer, .{ &this.blob, globalThis, callframe });
    }
    pub fn getSlice(
        this: *BuildArtifact,
        globalThis: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!jsc.JSValue {
        return @call(bun.callmod_inline, Blob.getSlice, .{ &this.blob, globalThis, callframe });
    }
    pub fn getType(
        this: *BuildArtifact,
        globalThis: *jsc.JSGlobalObject,
    ) JSValue {
        return @call(bun.callmod_inline, Blob.getType, .{ &this.blob, globalThis });
    }

    pub fn getStream(
        this: *BuildArtifact,
        globalThis: *jsc.JSGlobalObject,
        callframe: *jsc.CallFrame,
    ) bun.JSError!JSValue {
        return @call(bun.callmod_inline, Blob.getStream, .{
            &this.blob,
            globalThis,
            callframe,
        });
    }

    pub fn getPath(
        this: *BuildArtifact,
        globalThis: *jsc.JSGlobalObject,
    ) JSValue {
        return ZigString.fromUTF8(this.path).toJS(globalThis);
    }

    pub fn getLoader(
        this: *BuildArtifact,
        globalThis: *jsc.JSGlobalObject,
    ) JSValue {
        return ZigString.fromUTF8(@tagName(this.loader)).toJS(globalThis);
    }

    pub fn getHash(
        this: *BuildArtifact,
        globalThis: *jsc.JSGlobalObject,
    ) JSValue {
        var buf: [512]u8 = undefined;
        const out = std.fmt.bufPrint(&buf, "{f}", .{bun.fmt.truncatedHash32(this.hash)}) catch @panic("Unexpected");
        return ZigString.init(out).toJS(globalThis);
    }

    pub fn getSize(this: *BuildArtifact, globalObject: *jsc.JSGlobalObject) JSValue {
        return @call(bun.callmod_inline, Blob.getSize, .{ &this.blob, globalObject });
    }

    pub fn getMimeType(this: *BuildArtifact, globalObject: *jsc.JSGlobalObject) JSValue {
        return @call(bun.callmod_inline, Blob.getType, .{ &this.blob, globalObject });
    }

    pub fn getOutputKind(this: *BuildArtifact, globalObject: *jsc.JSGlobalObject) JSValue {
        return ZigString.init(@tagName(this.output_kind)).toJS(globalObject);
    }

    pub fn getSourceMap(this: *BuildArtifact, _: *jsc.JSGlobalObject) JSValue {
        if (this.sourcemap.get()) |value| {
            return value;
        }

        return jsc.JSValue.jsNull();
    }

    pub fn finalize(this: *BuildArtifact) callconv(.c) void {
        this.deinit();

        bun.default_allocator.destroy(this);
    }

    pub fn writeFormat(this: *BuildArtifact, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        const Writer = @TypeOf(writer);

        try writer.writeAll(comptime Output.prettyFmt("<r>BuildArtifact ", enable_ansi_colors));

        try writer.print(comptime Output.prettyFmt("(<blue>{s}<r>) {{\n", enable_ansi_colors), .{@tagName(this.output_kind)});

        {
            formatter.indent += 1;

            defer formatter.indent -= 1;
            try formatter.writeIndent(Writer, writer);
            try writer.print(
                comptime Output.prettyFmt(
                    "<r>path<r>: <green>\"{s}\"<r>",
                    enable_ansi_colors,
                ),
                .{this.path},
            );
            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            try writer.print(
                comptime Output.prettyFmt(
                    "<r>loader<r>: <green>\"{s}\"<r>",
                    enable_ansi_colors,
                ),
                .{@tagName(this.loader)},
            );

            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);

            try writer.print(
                comptime Output.prettyFmt(
                    "<r>kind<r>: <green>\"{s}\"<r>",
                    enable_ansi_colors,
                ),
                .{@tagName(this.output_kind)},
            );

            if (this.hash != 0) {
                formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
                try writer.writeAll("\n");

                try formatter.writeIndent(Writer, writer);
                try writer.print(
                    comptime Output.prettyFmt(
                        "<r>hash<r>: <green>\"{f}\"<r>",
                        enable_ansi_colors,
                    ),
                    .{bun.fmt.truncatedHash32(this.hash)},
                );
            }

            formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
            try writer.writeAll("\n");

            try formatter.writeIndent(Writer, writer);
            formatter.resetLine();
            try this.blob.writeFormat(Formatter, formatter, writer, enable_ansi_colors);

            if (this.output_kind != .sourcemap) {
                formatter.printComma(Writer, writer, enable_ansi_colors) catch unreachable;
                try writer.writeAll("\n");
                try formatter.writeIndent(Writer, writer);
                try writer.writeAll(
                    comptime Output.prettyFmt(
                        "<r>sourcemap<r>: ",
                        enable_ansi_colors,
                    ),
                );

                if (this.sourcemap.get()) |sourcemap_value| {
                    if (sourcemap_value.as(BuildArtifact)) |sourcemap| {
                        try sourcemap.writeFormat(Formatter, formatter, writer, enable_ansi_colors);
                    } else {
                        try writer.writeAll(
                            comptime Output.prettyFmt(
                                "<yellow>null<r>",
                                enable_ansi_colors,
                            ),
                        );
                    }
                } else {
                    try writer.writeAll(
                        comptime Output.prettyFmt(
                            "<yellow>null<r>",
                            enable_ansi_colors,
                        ),
                    );
                }
            }
        }
        try writer.writeAll("\n");
        try formatter.writeIndent(Writer, writer);
        try writer.writeAll("}");
        formatter.resetLine();
    }
};

const string = []const u8;

const CompileTarget = @import("../../compile_target.zig");
const Fs = @import("../../fs.zig");
const _resolver = @import("../../resolver/resolver.zig");
const resolve_path = @import("../../resolver/resolve_path.zig");
const std = @import("std");

const options = @import("../../options.zig");
const Loader = options.Loader;
const Target = options.Target;

const bun = @import("bun");
const JSError = bun.JSError;
const Output = bun.Output;
const String = bun.String;
const Transpiler = bun.transpiler;
const WebCore = bun.webcore;
const logger = bun.logger;
const strings = bun.strings;
const BundleV2 = bun.bundle_v2.BundleV2;
const Index = bun.ast.Index;
const api = bun.schema.api;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;
const ZigString = jsc.ZigString;
const Blob = jsc.WebCore.Blob;
