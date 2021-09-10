usingnamespace @import("../global.zig");
const Api = @import("../api/schema.zig").Api;
const std = @import("std");
const options = @import("../options.zig");
const cache = @import("../cache.zig");
const logger = @import("../logger.zig");
const js_ast = @import("../js_ast.zig");
const alloc = @import("../alloc.zig");
const fs = @import("../fs.zig");
const resolver = @import("./resolver.zig");

// Assume they're not going to have hundreds of main fields or browser map
// so use an array-backed hash table instead of bucketed
const MainFieldMap = std.StringArrayHashMap(string);
const BrowserMap = std.StringArrayHashMap(string);
threadlocal var hashy: [2048]u8 = undefined;

pub const PackageJSON = struct {
    pub const LoadFramework = enum {
        none,
        development,
        production,
    };

    const node_modules_path = std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str;
    pub fn nameForImport(this: *const PackageJSON, allocator: *std.mem.Allocator) !string {
        if (strings.indexOf(this.source.path.text, node_modules_path)) |_| {
            return this.name;
        } else {
            const parent = this.source.path.name.dirWithTrailingSlash();
            if (strings.indexOf(parent, fs.FileSystem.instance.top_level_dir)) |i| {
                const relative_dir = parent[i + fs.FileSystem.instance.top_level_dir.len ..];
                var out_dir = try allocator.alloc(u8, relative_dir.len + 2);
                std.mem.copy(u8, out_dir[2..], relative_dir);
                out_dir[0] = '.';
                out_dir[1] = '/';
                return out_dir;
            }

            return this.name;
        }
    }

    pub const FrameworkRouterPair = struct {
        framework: *options.Framework,
        router: *options.RouteConfig,
        loaded_routes: bool = false,
    };

    name: string = "",
    source: logger.Source,
    main_fields: MainFieldMap,
    module_type: options.ModuleType,
    version: string = "",
    hash: u32 = 0xDEADBEEF,

    // Present if the "browser" field is present. This field is intended to be
    // used by bundlers and lets you redirect the paths of certain 3rd-party
    // modules that don't work in the browser to other modules that shim that
    // functionality. That way you don't have to rewrite the code for those 3rd-
    // party modules. For example, you might remap the native "util" node module
    // to something like https://www.npmjs.com/package/util so it works in the
    // browser.
    //
    // This field contains a mapping of absolute paths to absolute paths. Mapping
    // to an empty path indicates that the module is disabled. As far as I can
    // tell, the official spec is an abandoned GitHub repo hosted by a user account:
    // https://github.com/defunctzombie/package-browser-field-spec. The npm docs
    // say almost nothing: https://docs.npmjs.com/files/package.json.
    //
    // Note that the non-package "browser" map has to be checked twice to match
    // Webpack's behavior: once before resolution and once after resolution. It
    // leads to some unintuitive failure cases that we must emulate around missing
    // file extensions:
    //
    // * Given the mapping "./no-ext": "./no-ext-browser.js" the query "./no-ext"
    //   should match but the query "./no-ext.js" should NOT match.
    //
    // * Given the mapping "./ext.js": "./ext-browser.js" the query "./ext.js"
    //   should match and the query "./ext" should ALSO match.
    //
    browser_map: BrowserMap,

    pub inline fn isAppPackage(this: *const PackageJSON) bool {
        return this.hash == 0xDEADBEEF;
    }

    fn loadDefineDefaults(
        env: *options.Env,
        json: *const js_ast.E.Object,
        allocator: *std.mem.Allocator,
    ) !void {
        var valid_count: usize = 0;
        for (json.properties) |prop| {
            if (prop.value.?.data != .e_string) continue;
            valid_count += 1;
        }

        env.defaults.shrinkRetainingCapacity(0);
        env.defaults.ensureTotalCapacity(allocator, valid_count) catch {};

        for (json.properties) |prop| {
            if (prop.value.?.data != .e_string) continue;
            env.defaults.appendAssumeCapacity(.{
                .key = prop.key.?.data.e_string.string(allocator) catch unreachable,
                .value = prop.value.?.data.e_string.string(allocator) catch unreachable,
            });
        }
    }

    fn loadOverrides(
        framework: *options.Framework,
        json: *const js_ast.E.Object,
        allocator: *std.mem.Allocator,
    ) void {
        var valid_count: usize = 0;
        for (json.properties) |prop| {
            if (prop.value.?.data != .e_string) continue;
            valid_count += 1;
        }

        var buffer = allocator.alloc([]const u8, valid_count * 2) catch unreachable;
        var keys = buffer[0 .. buffer.len / 2];
        var values = buffer[keys.len..];
        var i: usize = 0;
        for (json.properties) |prop| {
            if (prop.value.?.data != .e_string) continue;
            keys[i] = prop.key.?.data.e_string.string(allocator) catch unreachable;
            values[i] = prop.value.?.data.e_string.string(allocator) catch unreachable;
        }
        framework.override_modules = Api.StringMap{ .keys = keys, .values = values };
    }

    fn loadDefineExpression(
        env: *options.Env,
        json: *const js_ast.E.Object,
        allocator: *std.mem.Allocator,
    ) anyerror!void {
        for (json.properties) |prop| {
            switch (prop.key.?.data) {
                .e_string => |e_str| {
                    const str = e_str.string(allocator) catch "";

                    if (strings.eqlComptime(str, "defaults")) {
                        switch (prop.value.?.data) {
                            .e_object => |obj| {
                                try loadDefineDefaults(env, obj, allocator);
                            },
                            else => {
                                env.defaults.shrinkRetainingCapacity(0);
                            },
                        }
                    } else if (strings.eqlComptime(str, ".env")) {
                        switch (prop.value.?.data) {
                            .e_string => |value_str| {
                                env.setBehaviorFromPrefix(value_str.string(allocator) catch "");
                            },
                            else => {
                                env.behavior = .disable;
                                env.prefix = "";
                            },
                        }
                    }
                },
                else => continue,
            }
        }
    }

    fn loadFrameworkExpression(
        framework: *options.Framework,
        json: js_ast.Expr,
        allocator: *std.mem.Allocator,
        comptime read_define: bool,
    ) bool {
        if (json.asProperty("client")) |client| {
            if (client.expr.asString(allocator)) |str| {
                if (str.len > 0) {
                    framework.client.path = str;
                    framework.client.kind = .client;
                }
            }
        }

        if (json.asProperty("fallback")) |client| {
            if (client.expr.asString(allocator)) |str| {
                if (str.len > 0) {
                    framework.fallback.path = str;
                    framework.fallback.kind = .fallback;
                }
            }
        }

        if (json.asProperty("css")) |css_prop| {
            if (css_prop.expr.asString(allocator)) |str| {
                if (strings.eqlComptime(str, "onimportcss")) {
                    framework.client_css_in_js = .facade_onimportcss;
                } else {
                    framework.client_css_in_js = .facade;
                }
            }
        }

        if (json.asProperty("override")) |override| {
            if (override.expr.data == .e_object) {
                loadOverrides(framework, override.expr.data.e_object, allocator);
            }
        }

        if (comptime read_define) {
            if (json.asProperty("define")) |defines| {
                var skip_fallback = false;
                if (defines.expr.asProperty("client")) |client| {
                    if (client.expr.data == .e_object) {
                        const object = client.expr.data.e_object;
                        framework.client.env = options.Env.init(
                            allocator,
                        );

                        loadDefineExpression(&framework.client.env, object, allocator) catch {};
                        framework.fallback.env = framework.client.env;
                        skip_fallback = true;
                    }
                }

                if (!skip_fallback) {
                    if (defines.expr.asProperty("fallback")) |client| {
                        if (client.expr.data == .e_object) {
                            const object = client.expr.data.e_object;
                            framework.fallback.env = options.Env.init(
                                allocator,
                            );

                            loadDefineExpression(&framework.fallback.env, object, allocator) catch {};
                        }
                    }
                }

                if (defines.expr.asProperty("server")) |server| {
                    if (server.expr.data == .e_object) {
                        const object = server.expr.data.e_object;
                        framework.server.env = options.Env.init(
                            allocator,
                        );

                        loadDefineExpression(&framework.server.env, object, allocator) catch {};
                    }
                }
            }
        }

        if (json.asProperty("server")) |server| {
            if (server.expr.asString(allocator)) |str| {
                if (str.len > 0) {
                    framework.server.path = str;
                    framework.server.kind = .server;
                }
            }
        }

        return framework.client.isEnabled() or framework.server.isEnabled() or framework.fallback.isEnabled();
    }

    pub fn loadFrameworkWithPreference(
        package_json: *const PackageJSON,
        pair: *FrameworkRouterPair,
        json: js_ast.Expr,
        allocator: *std.mem.Allocator,
        comptime read_defines: bool,
        comptime load_framework: LoadFramework,
    ) void {
        const framework_object = json.asProperty("framework") orelse return;

        if (framework_object.expr.asProperty("displayName")) |name| {
            if (name.expr.asString(allocator)) |str| {
                if (str.len > 0) {
                    pair.framework.display_name = str;
                }
            }
        }

        if (framework_object.expr.asProperty("static")) |static_prop| {
            if (static_prop.expr.asString(allocator)) |str| {
                if (str.len > 0) {
                    pair.router.static_dir = str;
                    pair.router.static_dir_enabled = true;
                }
            }
        }

        if (framework_object.expr.asProperty("assetPrefix")) |asset_prefix| {
            if (asset_prefix.expr.asString(allocator)) |_str| {
                const str = std.mem.trimRight(u8, _str, " ");
                if (str.len > 0) {
                    pair.router.asset_prefix_path = str;
                }
            }
        }

        if (!pair.router.routes_enabled) {
            if (framework_object.expr.asProperty("router")) |router| {
                if (router.expr.asProperty("dir")) |route_dir| {
                    switch (route_dir.expr.data) {
                        .e_string => |estr| {
                            const str = estr.string(allocator) catch unreachable;
                            if (str.len > 0) {
                                pair.router.dir = str;
                                pair.router.possible_dirs = &[_]string{};

                                pair.loaded_routes = true;
                            }
                        },
                        .e_array => |array| {
                            var count: usize = 0;
                            for (array.items) |item| {
                                count += @boolToInt(item.data == .e_string and item.data.e_string.utf8.len > 0);
                            }
                            switch (count) {
                                0 => {},
                                1 => {
                                    const str = array.items[0].data.e_string.string(allocator) catch unreachable;
                                    if (str.len > 0) {
                                        pair.router.dir = str;
                                        pair.router.possible_dirs = &[_]string{};

                                        pair.loaded_routes = true;
                                    }
                                },
                                else => {
                                    const list = allocator.alloc(string, count) catch unreachable;

                                    var list_i: usize = 0;
                                    for (array.items) |item| {
                                        if (item.data == .e_string and item.data.e_string.utf8.len > 0) {
                                            list[list_i] = item.data.e_string.string(allocator) catch unreachable;
                                            list_i += 1;
                                        }
                                    }

                                    pair.router.dir = list[0];
                                    pair.router.possible_dirs = list;

                                    pair.loaded_routes = true;
                                },
                            }
                        },
                        else => {},
                    }
                }

                if (router.expr.asProperty("extensions")) |extensions_expr| {
                    if (extensions_expr.expr.asArray()) |*array| {
                        const count = array.array.items.len;
                        var valid_count: usize = 0;

                        while (array.next()) |expr| {
                            if (expr.data != .e_string) continue;
                            const e_str: *const js_ast.E.String = expr.data.e_string;
                            if (e_str.utf8.len == 0 or e_str.utf8[0] != '.') continue;
                            valid_count += 1;
                        }

                        if (valid_count > 0) {
                            var extensions = allocator.alloc(string, valid_count) catch unreachable;
                            array.index = 0;
                            var i: usize = 0;

                            // We don't need to allocate the strings because we keep the package.json source string in memory
                            while (array.next()) |expr| {
                                if (expr.data != .e_string) continue;
                                const e_str: *const js_ast.E.String = expr.data.e_string;
                                if (e_str.utf8.len == 0 or e_str.utf8[0] != '.') continue;
                                extensions[i] = e_str.utf8;
                                i += 1;
                            }
                        }
                    }
                }
            }
        }

        switch (comptime load_framework) {
            .development => {
                if (framework_object.expr.asProperty("development")) |env| {
                    if (loadFrameworkExpression(pair.framework, env.expr, allocator, read_defines)) {
                        pair.framework.package = package_json.nameForImport(allocator) catch unreachable;
                        pair.framework.development = true;
                        if (env.expr.asProperty("static")) |static_prop| {
                            if (static_prop.expr.asString(allocator)) |str| {
                                if (str.len > 0) {
                                    pair.router.static_dir = str;
                                    pair.router.static_dir_enabled = true;
                                }
                            }
                        }

                        return;
                    }
                }
            },
            .production => {
                if (framework_object.expr.asProperty("production")) |env| {
                    if (loadFrameworkExpression(pair.framework, env.expr, allocator, read_defines)) {
                        pair.framework.package = package_json.nameForImport(allocator) catch unreachable;
                        pair.framework.development = false;

                        if (env.expr.asProperty("static")) |static_prop| {
                            if (static_prop.expr.asString(allocator)) |str| {
                                if (str.len > 0) {
                                    pair.router.static_dir = str;
                                    pair.router.static_dir_enabled = true;
                                }
                            }
                        }

                        return;
                    }
                }
            },
            else => unreachable,
        }

        if (loadFrameworkExpression(pair.framework, framework_object.expr, allocator, read_defines)) {
            pair.framework.package = package_json.nameForImport(allocator) catch unreachable;
            pair.framework.development = false;
        }
    }

    pub fn parse(
        comptime ResolverType: type,
        r: *ResolverType,
        input_path: string,
        dirname_fd: StoredFileDescriptorType,
        comptime generate_hash: bool,
    ) ?PackageJSON {

        // TODO: remove this extra copy
        const parts = [_]string{ input_path, "package.json" };
        const package_json_path_ = r.fs.abs(&parts);
        const package_json_path = r.fs.dirname_store.append(@TypeOf(package_json_path_), package_json_path_) catch unreachable;

        const entry = r.caches.fs.readFile(
            r.fs,
            package_json_path,
            dirname_fd,
            false,
            null,
        ) catch |err| {
            if (err != error.IsDir) {
                r.log.addErrorFmt(null, logger.Loc.Empty, r.allocator, "Cannot read file \"{s}\": {s}", .{ r.prettyPath(fs.Path.init(input_path)), @errorName(err) }) catch unreachable;
            }

            return null;
        };

        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("The file \"{s}\" exists", .{package_json_path}) catch unreachable;
        }

        const key_path = fs.Path.init(package_json_path);

        var json_source = logger.Source.initPathString(key_path.text, entry.contents);
        json_source.path.pretty = r.prettyPath(json_source.path);

        const json: js_ast.Expr = (r.caches.json.parseJSON(r.log, json_source, r.allocator) catch |err| {
            if (isDebug) {
                Output.printError("{s}: JSON parse error: {s}", .{ package_json_path, @errorName(err) });
            }
            return null;
        } orelse return null);

        var package_json = PackageJSON{
            .name = "",
            .version = "",
            .hash = 0xDEADBEEF,
            .source = json_source,
            .module_type = .unknown,
            .browser_map = BrowserMap.init(r.allocator),
            .main_fields = MainFieldMap.init(r.allocator),
        };

        if (json.asProperty("version")) |version_json| {
            if (version_json.expr.asString(r.allocator)) |version_str| {
                if (version_str.len > 0) {
                    package_json.version = r.allocator.dupe(u8, version_str) catch unreachable;
                }
            }
        }

        if (json.asProperty("name")) |version_json| {
            if (version_json.expr.asString(r.allocator)) |version_str| {
                if (version_str.len > 0) {
                    package_json.name = r.allocator.dupe(u8, version_str) catch unreachable;
                }
            }
        }

        if (json.asProperty("type")) |type_json| {
            if (type_json.expr.asString(r.allocator)) |type_str| {
                switch (options.ModuleType.List.get(type_str) orelse options.ModuleType.unknown) {
                    .cjs => {
                        package_json.module_type = .cjs;
                    },
                    .esm => {
                        package_json.module_type = .esm;
                    },
                    .unknown => {
                        r.log.addRangeWarningFmt(
                            &json_source,
                            json_source.rangeOfString(type_json.loc),
                            r.allocator,
                            "\"{s}\" is not a valid value for \"type\" field (must be either \"commonjs\" or \"module\")",
                            .{type_str},
                        ) catch unreachable;
                    },
                }
            } else {
                r.log.addWarning(&json_source, type_json.loc, "The value for \"type\" must be a string") catch unreachable;
            }
        }

        // Read the "main" fields
        for (r.opts.main_fields) |main| {
            if (json.asProperty(main)) |main_json| {
                const expr: js_ast.Expr = main_json.expr;

                if ((expr.asString(r.allocator))) |str| {
                    if (str.len > 0) {
                        package_json.main_fields.put(main, r.allocator.dupe(u8, str) catch unreachable) catch unreachable;
                    }
                }
            }
        }

        // Read the "browser" property, but only when targeting the browser
        if (r.opts.platform.supportsBrowserField()) {
            // We both want the ability to have the option of CJS vs. ESM and the
            // option of having node vs. browser. The way to do this is to use the
            // object literal form of the "browser" field like this:
            //
            //   "main": "dist/index.node.cjs.js",
            //   "module": "dist/index.node.esm.js",
            //   "browser": {
            //     "./dist/index.node.cjs.js": "./dist/index.browser.cjs.js",
            //     "./dist/index.node.esm.js": "./dist/index.browser.esm.js"
            //   },
            //
            if (json.asProperty("browser")) |browser_prop| {
                switch (browser_prop.expr.data) {
                    .e_object => |obj| {
                        // The value is an object

                        // Remap all files in the browser field
                        for (obj.properties) |*prop| {
                            var _key_str = (prop.key orelse continue).asString(r.allocator) orelse continue;
                            const value: js_ast.Expr = prop.value orelse continue;

                            // Normalize the path so we can compare against it without getting
                            // confused by "./". There is no distinction between package paths and
                            // relative paths for these values because some tools (i.e. Browserify)
                            // don't make such a distinction.
                            //
                            // This leads to weird things like a mapping for "./foo" matching an
                            // import of "foo", but that's actually not a bug. Or arguably it's a
                            // bug in Browserify but we have to replicate this bug because packages
                            // do this in the wild.
                            const key = r.allocator.dupe(u8, r.fs.normalize(_key_str)) catch unreachable;

                            switch (value.data) {
                                .e_string => |str| {
                                    // If this is a string, it's a replacement package
                                    package_json.browser_map.put(key, str.string(r.allocator) catch unreachable) catch unreachable;
                                },
                                .e_boolean => |boolean| {
                                    if (!boolean.value) {
                                        package_json.browser_map.put(key, "") catch unreachable;
                                    }
                                },
                                else => {
                                    r.log.addWarning(&json_source, value.loc, "Each \"browser\" mapping must be a string or boolean") catch unreachable;
                                },
                            }
                        }
                    },
                    else => {},
                }
            }
        }

        // TODO: side effects
        // TODO: exports map

        if (generate_hash) {
            if (package_json.name.len > 0 and package_json.version.len > 0) {
                std.mem.set(u8, &hashy, 0);
                var used: usize = 0;
                std.mem.copy(u8, &hashy, package_json.name);
                used = package_json.name.len;

                hashy[used] = '@';
                used += 1;
                std.mem.copy(u8, hashy[used..], package_json.version);
                used += package_json.version.len;

                package_json.hash = std.hash.Murmur3_32.hash(hashy[0..used]);
            }
        }

        return package_json;
    }

    pub fn hashModule(this: *const PackageJSON, module: string) u32 {
        var hasher = std.hash.Wyhash.init(0);
        hasher.update(std.mem.asBytes(&this.hash));
        hasher.update(module);

        return @truncate(u32, hasher.final());
    }
};
