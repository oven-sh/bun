const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;

const Api = @import("../api/schema.zig").Api;
const std = @import("std");
const options = @import("../options.zig");
const cache = @import("../cache.zig");
const logger = bun.logger;
const js_ast = bun.JSAst;

const fs = @import("../fs.zig");
const resolver = @import("./resolver.zig");
const js_lexer = bun.js_lexer;
const resolve_path = @import("./resolve_path.zig");
// Assume they're not going to have hundreds of main fields or browser map
// so use an array-backed hash table instead of bucketed
const MainFieldMap = bun.StringMap;
pub const BrowserMap = bun.StringMap;
pub const MacroImportReplacementMap = bun.StringArrayHashMap(string);
pub const MacroMap = bun.StringArrayHashMapUnmanaged(MacroImportReplacementMap);

const ScriptsMap = bun.StringArrayHashMap(string);
const Semver = bun.Semver;
const Dependency = @import("../install/dependency.zig");
const String = Semver.String;
const Version = Semver.Version;
const Install = @import("../install/install.zig");
const FolderResolver = @import("../install/resolvers/folder_resolver.zig");

const Architecture = @import("../install/npm.zig").Architecture;
const OperatingSystem = @import("../install/npm.zig").OperatingSystem;
pub const DependencyMap = struct {
    map: HashMap = .{},
    source_buf: []const u8 = "",

    pub const HashMap = std.ArrayHashMapUnmanaged(
        String,
        Dependency,
        String.ArrayHashContext,
        false,
    );
};

pub const PackageJSON = struct {
    pub const LoadFramework = enum {
        none,
        development,
        production,
    };

    pub const new = bun.TrivialNew(@This());

    const node_modules_path = std.fs.path.sep_str ++ "node_modules" ++ std.fs.path.sep_str;

    pub fn nameForImport(this: *const PackageJSON, allocator: std.mem.Allocator) !string {
        if (strings.indexOf(this.source.path.text, node_modules_path)) |_| {
            return this.name;
        } else {
            const parent = this.source.path.name.dirWithTrailingSlash();
            if (strings.indexOf(parent, fs.FileSystem.instance.top_level_dir)) |i| {
                const relative_dir = parent[i + fs.FileSystem.instance.top_level_dir.len ..];
                var out_dir = try allocator.alloc(u8, relative_dir.len + 2);
                bun.copy(u8, out_dir[2..], relative_dir);
                out_dir[0..2].* = ("." ++ std.fs.path.sep_str).*;
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

    scripts: ?*ScriptsMap = null,
    config: ?*bun.StringArrayHashMap(string) = null,

    arch: Architecture = Architecture.all,
    os: OperatingSystem = OperatingSystem.all,

    package_manager_package_id: Install.PackageID = Install.invalid_package_id,
    dependencies: DependencyMap = .{},

    side_effects: SideEffects = .unspecified,

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

    exports: ?ExportsMap = null,
    imports: ?ExportsMap = null,

    pub const SideEffects = union(enum) {
        /// either `package.json` is missing "sideEffects", it is true, or some
        /// other unsupported value. Treat all files as side effects
        unspecified,
        /// "sideEffects": false
        false,
        /// "sideEffects": ["file.js", "other.js"]
        map: Map,
        // /// "sideEffects": ["side_effects/*.js"]
        // glob: TODO,

        pub const Map = std.HashMapUnmanaged(
            bun.StringHashMapUnowned.Key,
            void,
            bun.StringHashMapUnowned.Adapter,
            80,
        );

        pub fn hasSideEffects(side_effects: SideEffects, path: []const u8) bool {
            return switch (side_effects) {
                .unspecified => true,
                .false => false,
                .map => |map| map.contains(bun.StringHashMapUnowned.Key.init(path)),
            };
        }
    };

    fn loadDefineDefaults(
        env: *options.Env,
        json: *const js_ast.E.Object,
        allocator: std.mem.Allocator,
    ) !void {
        var valid_count: usize = 0;
        for (json.properties.slice()) |prop| {
            if (prop.value.?.data != .e_string) continue;
            valid_count += 1;
        }

        env.defaults.shrinkRetainingCapacity(0);
        env.defaults.ensureTotalCapacity(allocator, valid_count) catch {};

        for (json.properties.slice()) |prop| {
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
        allocator: std.mem.Allocator,
    ) void {
        var valid_count: usize = 0;
        for (json.properties.slice()) |prop| {
            if (prop.value.?.data != .e_string) continue;
            valid_count += 1;
        }

        var buffer = allocator.alloc([]const u8, valid_count * 2) catch unreachable;
        var keys = buffer[0..valid_count];
        var values = buffer[valid_count..];
        var i: usize = 0;
        for (json.properties.slice()) |prop| {
            if (prop.value.?.data != .e_string) continue;
            keys[i] = prop.key.?.data.e_string.string(allocator) catch unreachable;
            values[i] = prop.value.?.data.e_string.string(allocator) catch unreachable;
            i += 1;
        }
        framework.override_modules = Api.StringMap{ .keys = keys, .values = values };
    }

    fn loadDefineExpression(
        env: *options.Env,
        json: *const js_ast.E.Object,
        allocator: std.mem.Allocator,
    ) anyerror!void {
        for (json.properties.slice()) |prop| {
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
        allocator: std.mem.Allocator,
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
        allocator: std.mem.Allocator,
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

        if (json.get("version")) |version| {
            if (version.asString(allocator)) |str| {
                if (str.len > 0) {
                    pair.framework.version = str;
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
                            const items = array.items.slice();
                            for (items) |item| {
                                count += @intFromBool(item.data == .e_string and item.data.e_string.data.len > 0);
                            }
                            switch (count) {
                                0 => {},
                                1 => {
                                    const str = items[0].data.e_string.string(allocator) catch unreachable;
                                    if (str.len > 0) {
                                        pair.router.dir = str;
                                        pair.router.possible_dirs = &[_]string{};

                                        pair.loaded_routes = true;
                                    }
                                },
                                else => {
                                    const list = allocator.alloc(string, count) catch unreachable;

                                    var list_i: usize = 0;
                                    for (items) |item| {
                                        if (item.data == .e_string and item.data.e_string.data.len > 0) {
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
                    if (extensions_expr.expr.asArray()) |array_const| {
                        var array = array_const;
                        var valid_count: usize = 0;

                        while (array.next()) |expr| {
                            if (expr.data != .e_string) continue;
                            const e_str: *const js_ast.E.String = expr.data.e_string;
                            if (e_str.data.len == 0 or e_str.data[0] != '.') continue;
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
                                if (e_str.data.len == 0 or e_str.data[0] != '.') continue;
                                extensions[i] = e_str.data;
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
            else => @compileError("unreachable"),
        }

        if (loadFrameworkExpression(pair.framework, framework_object.expr, allocator, read_defines)) {
            pair.framework.package = package_json.nameForImport(allocator) catch unreachable;
            pair.framework.development = false;
        }
    }

    pub fn parseMacrosJSON(
        allocator: std.mem.Allocator,
        macros: js_ast.Expr,
        log: *logger.Log,
        json_source: *const logger.Source,
    ) MacroMap {
        var macro_map = MacroMap{};
        if (macros.data != .e_object) return macro_map;

        const properties = macros.data.e_object.properties.slice();

        for (properties) |property| {
            const key = property.key.?.asString(allocator) orelse continue;
            if (!resolver.isPackagePath(key)) {
                log.addRangeWarningFmt(
                    json_source,
                    json_source.rangeOfString(property.key.?.loc),
                    allocator,
                    "\"{s}\" is not a package path. \"macros\" remaps package paths to macros. Skipping.",
                    .{key},
                ) catch unreachable;
                continue;
            }

            const value = property.value.?;
            if (value.data != .e_object) {
                log.addWarningFmt(
                    json_source,
                    value.loc,
                    allocator,
                    "Invalid macro remapping in \"{s}\": expected object where the keys are import names and the value is a string path to replace",
                    .{key},
                ) catch unreachable;
                continue;
            }

            const remap_properties = value.data.e_object.properties.slice();
            if (remap_properties.len == 0) continue;

            var map = MacroImportReplacementMap.init(allocator);
            map.ensureUnusedCapacity(remap_properties.len) catch unreachable;
            for (remap_properties) |remap| {
                const import_name = remap.key.?.asString(allocator) orelse continue;
                const remap_value = remap.value.?;
                if (remap_value.data != .e_string or remap_value.data.e_string.data.len == 0) {
                    log.addWarningFmt(
                        json_source,
                        remap_value.loc,
                        allocator,
                        "Invalid macro remapping for import \"{s}\": expected string to remap to. e.g. \"graphql\": \"bun-macro-relay\" ",
                        .{import_name},
                    ) catch unreachable;
                    continue;
                }

                const remap_value_str = remap_value.data.e_string.data;

                map.putAssumeCapacityNoClobber(import_name, remap_value_str);
            }

            if (map.count() > 0) {
                macro_map.put(allocator, key, map) catch unreachable;
            }
        }

        return macro_map;
    }

    pub fn parse(
        r: *resolver.Resolver,
        input_path: string,
        dirname_fd: StoredFileDescriptorType,
        package_id: ?Install.PackageID,
        comptime include_scripts_: enum { ignore_scripts, include_scripts },
        comptime include_dependencies: enum { main, local, none },
    ) ?PackageJSON {
        const include_scripts = include_scripts_ == .include_scripts;

        // TODO: remove this extra copy
        const parts = [_]string{ input_path, "package.json" };
        const package_json_path_ = r.fs.abs(&parts);
        const package_json_path = r.fs.dirname_store.append(@TypeOf(package_json_path_), package_json_path_) catch unreachable;

        // DirInfo cache is reused globally
        // So we cannot free these
        const allocator = bun.fs_allocator;

        var entry = r.caches.fs.readFileWithAllocator(
            allocator,
            r.fs,
            package_json_path,
            dirname_fd,
            false,
            null,
        ) catch |err| {
            if (err != error.IsDir) {
                r.log.addErrorFmt(null, logger.Loc.Empty, allocator, "Cannot read file \"{s}\": {s}", .{ input_path, @errorName(err) }) catch unreachable;
            }

            return null;
        };
        defer _ = entry.closeFD();

        if (r.debug_logs) |*debug| {
            debug.addNoteFmt("The file \"{s}\" exists", .{package_json_path});
        }

        const key_path = fs.Path.init(package_json_path);

        var json_source = logger.Source.initPathString(key_path.text, entry.contents);
        json_source.path.pretty = json_source.path.text;

        const json: js_ast.Expr = (r.caches.json.parsePackageJSON(r.log, json_source, allocator, true) catch |err| {
            if (Environment.isDebug) {
                Output.printError("{s}: JSON parse error: {s}", .{ package_json_path, @errorName(err) });
            }
            return null;
        } orelse return null);

        if (json.data != .e_object) {
            // Invalid package.json in node_modules is noisy.
            // Let's just ignore it.
            allocator.free(entry.contents);
            return null;
        }

        var package_json = PackageJSON{
            .name = "",
            .version = "",
            .source = json_source,
            .module_type = .unknown,
            .browser_map = BrowserMap.init(allocator, false),
            .main_fields = MainFieldMap.init(allocator, false),
        };

        // Note: we tried rewriting this to be fewer loops over all the properties (asProperty loops over each)
        // The end result was: it's not faster! Sometimes, it's slower.
        // It's hard to say why.
        // Feels like a codegen issue.
        // or that looping over every property doesn't really matter because most package.jsons are < 20 properties
        if (json.asProperty("version")) |version_json| {
            if (version_json.expr.asString(allocator)) |version_str| {
                if (version_str.len > 0) {
                    package_json.version = allocator.dupe(u8, version_str) catch unreachable;
                }
            }
        }

        if (json.asProperty("name")) |name_json| {
            if (name_json.expr.asString(allocator)) |name_str| {
                if (name_str.len > 0) {
                    package_json.name = allocator.dupe(u8, name_str) catch unreachable;
                }
            }
        }

        if (json.asProperty("type")) |type_json| {
            if (type_json.expr.asString(allocator)) |type_str| {
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
                            allocator,
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

                if ((expr.asString(allocator))) |str| {
                    if (str.len > 0) {
                        package_json.main_fields.put(main, str) catch unreachable;
                    }
                }
            }
        }

        // Read the "browser" property, but only when targeting the browser
        if (r.opts.target == .browser) {
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
                        for (obj.properties.slice()) |*prop| {
                            const _key_str = (prop.key orelse continue).asString(allocator) orelse continue;
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
                            const key = allocator.dupe(u8, r.fs.normalize(_key_str)) catch unreachable;

                            switch (value.data) {
                                .e_string => |str| {
                                    // If this is a string, it's a replacement package
                                    package_json.browser_map.put(key, str.string(allocator) catch unreachable) catch unreachable;
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

        if (json.asProperty("exports")) |exports_prop| {
            if (ExportsMap.parse(bun.default_allocator, &json_source, r.log, exports_prop.expr, exports_prop.loc)) |exports_map| {
                package_json.exports = exports_map;
            }
        }

        if (json.asProperty("imports")) |imports_prop| {
            if (ExportsMap.parse(bun.default_allocator, &json_source, r.log, imports_prop.expr, imports_prop.loc)) |imports_map| {
                package_json.imports = imports_map;
            }
        }

        if (json.get("sideEffects")) |side_effects_field| outer: {
            if (side_effects_field.asBool()) |boolean| {
                if (!boolean)
                    package_json.side_effects = .{ .false = {} };
            } else if (side_effects_field.asArray()) |array_| {
                var array = array_;
                // TODO: switch to only storing hashes
                var map = SideEffects.Map{};
                map.ensureTotalCapacity(allocator, array.array.items.len) catch unreachable;
                while (array.next()) |item| {
                    if (item.asString(allocator)) |name| {
                        // TODO: support RegExp using JavaScriptCore <> C++ bindings
                        if (strings.containsChar(name, '*')) {
                            // https://sourcegraph.com/search?q=context:global+file:package.json+sideEffects%22:+%5B&patternType=standard&sm=1&groupBy=repo
                            // a lot of these seem to be css files which we don't care about for now anyway
                            // so we can just skip them in here
                            if (strings.eqlComptime(std.fs.path.extension(name), ".css"))
                                continue;

                            r.log.addWarning(
                                &json_source,
                                item.loc,
                                "wildcard sideEffects are not supported yet, which means this package will be deoptimized",
                            ) catch unreachable;
                            map.deinit(allocator);

                            package_json.side_effects = .{ .unspecified = {} };
                            break :outer;
                        }

                        var joined = [_]string{
                            json_source.path.name.dirWithTrailingSlash(),
                            name,
                        };

                        _ = map.getOrPutAssumeCapacity(
                            bun.StringHashMapUnowned.Key.init(r.fs.join(&joined)),
                        );
                    }
                }
                package_json.side_effects = .{ .map = map };
            }
        }

        if (comptime include_dependencies == .main or include_dependencies == .local) {
            update_dependencies: {
                if (package_id) |pkg| {
                    package_json.package_manager_package_id = pkg;
                    break :update_dependencies;
                }

                // // if there is a name & version, check if the lockfile has the package
                if (package_json.name.len > 0 and package_json.version.len > 0) {
                    if (r.package_manager) |pm| {
                        const tag = Dependency.Version.Tag.infer(package_json.version);

                        if (tag == .npm) {
                            const sliced = Semver.SlicedString.init(package_json.version, package_json.version);
                            if (Dependency.parseWithTag(
                                allocator,
                                String.init(package_json.name, package_json.name),
                                String.Builder.stringHash(package_json.name),
                                package_json.version,
                                .npm,
                                &sliced,
                                r.log,
                                pm,
                            )) |dependency_version| {
                                if (dependency_version.value.npm.version.isExact()) {
                                    if (pm.lockfile.resolvePackageFromNameAndVersion(package_json.name, dependency_version)) |resolved| {
                                        package_json.package_manager_package_id = resolved;
                                        if (resolved > 0) {
                                            break :update_dependencies;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if (json.get("cpu")) |os_field| {
                    if (os_field.asArray()) |array_const| {
                        var array = array_const;
                        var arch = Architecture.none.negatable();
                        while (array.next()) |item| {
                            if (item.asString(bun.default_allocator)) |str| {
                                arch.apply(str);
                            }
                        }

                        package_json.arch = arch.combine();
                    }
                }

                if (json.get("os")) |os_field| {
                    var tmp = os_field.asArray();
                    if (tmp) |*array| {
                        var os = OperatingSystem.none.negatable();
                        while (array.next()) |item| {
                            if (item.asString(bun.default_allocator)) |str| {
                                os.apply(str);
                            }
                        }

                        package_json.os = os.combine();
                    }
                }

                const DependencyGroup = Install.Lockfile.Package.DependencyGroup;
                const features = .{
                    .dependencies = true,
                    .dev_dependencies = include_dependencies == .main,
                    .optional_dependencies = true,
                    .peer_dependencies = false,
                };

                const dependency_groups = comptime brk: {
                    var out_groups: [
                        @as(usize, @intFromBool(features.dependencies)) +
                            @as(usize, @intFromBool(features.dev_dependencies)) +
                            @as(usize, @intFromBool(features.optional_dependencies)) +
                            @as(usize, @intFromBool(features.peer_dependencies))
                    ]DependencyGroup = undefined;
                    var out_group_i: usize = 0;
                    if (features.dependencies) {
                        out_groups[out_group_i] = DependencyGroup.dependencies;
                        out_group_i += 1;
                    }

                    if (features.dev_dependencies) {
                        out_groups[out_group_i] = DependencyGroup.dev;
                        out_group_i += 1;
                    }
                    if (features.optional_dependencies) {
                        out_groups[out_group_i] = DependencyGroup.optional;
                        out_group_i += 1;
                    }

                    if (features.peer_dependencies) {
                        out_groups[out_group_i] = DependencyGroup.peer;
                        out_group_i += 1;
                    }

                    break :brk out_groups;
                };

                var total_dependency_count: usize = 0;
                inline for (dependency_groups) |group| {
                    if (json.get(group.field)) |group_json| {
                        if (group_json.data == .e_object) {
                            total_dependency_count += group_json.data.e_object.properties.len;
                        }
                    }
                }

                if (total_dependency_count > 0) {
                    package_json.dependencies.map = DependencyMap.HashMap{};
                    package_json.dependencies.source_buf = json_source.contents;
                    const ctx = String.ArrayHashContext{
                        .arg_buf = json_source.contents,
                        .existing_buf = json_source.contents,
                    };
                    package_json.dependencies.map.ensureTotalCapacityContext(
                        allocator,
                        total_dependency_count,
                        ctx,
                    ) catch unreachable;

                    inline for (dependency_groups) |group| {
                        if (json.get(group.field)) |group_json| {
                            if (group_json.data == .e_object) {
                                var group_obj = group_json.data.e_object;
                                for (group_obj.properties.slice()) |*prop| {
                                    const name_prop = prop.key orelse continue;
                                    const name_str = name_prop.asString(allocator) orelse continue;
                                    const name_hash = String.Builder.stringHash(name_str);
                                    const name = String.init(name_str, name_str);
                                    const version_value = prop.value orelse continue;
                                    const version_str = version_value.asString(allocator) orelse continue;
                                    const sliced_str = Semver.SlicedString.init(version_str, version_str);

                                    if (Dependency.parse(
                                        allocator,
                                        name,
                                        name_hash,
                                        version_str,
                                        &sliced_str,
                                        r.log,
                                        r.package_manager,
                                    )) |dependency_version| {
                                        const dependency = Dependency{
                                            .name = name,
                                            .version = dependency_version,
                                            .name_hash = name_hash,
                                            .behavior = group.behavior,
                                        };
                                        package_json.dependencies.map.putAssumeCapacityContext(
                                            dependency.name,
                                            dependency,
                                            ctx,
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // used by `bun run`
        if (include_scripts) {
            if (json.asPropertyStringMap("scripts", allocator)) |scripts| {
                package_json.scripts = scripts;
            }
            if (json.asPropertyStringMap("config", allocator)) |config| {
                package_json.config = config;
            }
        }

        return package_json;
    }

    pub fn hashModule(this: *const PackageJSON, module: string) u32 {
        var hasher = bun.Wyhash.init(0);
        hasher.update(std.mem.asBytes(&this.hash));
        hasher.update(module);

        return @as(u32, @truncate(hasher.final()));
    }
};

pub const ExportsMap = struct {
    root: Entry,
    exports_range: logger.Range = logger.Range.None,
    property_key_loc: logger.Loc,

    pub fn parse(allocator: std.mem.Allocator, source: *const logger.Source, log: *logger.Log, json: js_ast.Expr, property_key_loc: logger.Loc) ?ExportsMap {
        var visitor = Visitor{ .allocator = allocator, .source = source, .log = log };

        const root = visitor.visit(json);

        if (root.data == .null) {
            return null;
        }

        return ExportsMap{
            .root = root,
            .exports_range = source.rangeOfString(json.loc),
            .property_key_loc = property_key_loc,
        };
    }

    pub const Visitor = struct {
        allocator: std.mem.Allocator,
        source: *const logger.Source,
        log: *logger.Log,

        pub fn visit(this: Visitor, expr: js_ast.Expr) Entry {
            var first_token: logger.Range = logger.Range.None;

            switch (expr.data) {
                .e_null => {
                    return Entry{ .first_token = js_lexer.rangeOfIdentifier(this.source, expr.loc), .data = .{ .null = {} } };
                },
                .e_string => |str| {
                    return Entry{
                        .data = .{
                            .string = str.slice(this.allocator),
                        },
                        .first_token = this.source.rangeOfString(expr.loc),
                    };
                },
                .e_array => |e_array| {
                    const array = this.allocator.alloc(Entry, e_array.items.len) catch unreachable;
                    for (e_array.items.slice(), array) |item, *dest| {
                        dest.* = this.visit(item);
                    }
                    return Entry{
                        .data = .{
                            .array = array,
                        },
                        .first_token = logger.Range{ .loc = expr.loc, .len = 1 },
                    };
                },
                .e_object => |e_obj| {
                    var map_data = Entry.Data.Map.List{};
                    map_data.ensureTotalCapacity(this.allocator, e_obj.*.properties.len) catch unreachable;
                    map_data.len = e_obj.*.properties.len;
                    var expansion_keys = this.allocator.alloc(Entry.Data.Map.MapEntry, e_obj.*.properties.len) catch unreachable;
                    var expansion_key_i: usize = 0;
                    var map_data_slices = map_data.slice();
                    var map_data_keys = map_data_slices.items(.key);
                    var map_data_ranges = map_data_slices.items(.key_range);
                    var map_data_entries = map_data_slices.items(.value);
                    var is_conditional_sugar = false;
                    first_token.loc = expr.loc;
                    first_token.len = 1;
                    for (e_obj.properties.slice(), 0..) |prop, i| {
                        const key: string = prop.key.?.data.e_string.slice(this.allocator);
                        const key_range: logger.Range = this.source.rangeOfString(prop.key.?.loc);

                        // If exports is an Object with both a key starting with "." and a key
                        // not starting with ".", throw an Invalid Package Configuration error.
                        const cur_is_conditional_sugar = !strings.startsWithChar(key, '.');
                        if (i == 0) {
                            is_conditional_sugar = cur_is_conditional_sugar;
                        } else if (is_conditional_sugar != cur_is_conditional_sugar) {
                            const prev_key_range = map_data_ranges[i - 1];
                            const prev_key = map_data_keys[i - 1];
                            this.log.addRangeWarningFmtWithNote(
                                this.source,
                                key_range,
                                this.allocator,
                                "This object cannot contain keys that both start with \".\" and don't start with \".\"",
                                .{},
                                "The previous key \"{s}\" is incompatible with the current key \"{s}\"",
                                .{ prev_key, key },
                                prev_key_range,
                            ) catch unreachable;
                            map_data.deinit(this.allocator);
                            this.allocator.free(expansion_keys);
                            return Entry{
                                .data = .{ .invalid = {} },
                                .first_token = first_token,
                            };
                        }

                        map_data_keys[i] = key;
                        map_data_ranges[i] = key_range;
                        map_data_entries[i] = this.visit(prop.value.?);

                        // safe to use "/" on windows. exports in package.json does not use "\\"
                        if (strings.endsWithComptime(key, "/") or strings.containsChar(key, '*')) {
                            expansion_keys[expansion_key_i] = Entry.Data.Map.MapEntry{
                                .value = map_data_entries[i],
                                .key = key,
                                .key_range = key_range,
                            };
                            expansion_key_i += 1;
                        }
                    }

                    // this leaks a lil, but it's fine.
                    expansion_keys = expansion_keys[0..expansion_key_i];

                    // Let expansionKeys be the list of keys of matchObj either ending in "/"
                    // or containing only a single "*", sorted by the sorting function
                    // PATTERN_KEY_COMPARE which orders in descending order of specificity.
                    const GlobLengthSorter: type = strings.NewGlobLengthSorter(Entry.Data.Map.MapEntry, "key");
                    const sorter = GlobLengthSorter{};
                    std.sort.pdq(Entry.Data.Map.MapEntry, expansion_keys, sorter, GlobLengthSorter.lessThan);

                    return Entry{
                        .data = .{
                            .map = Entry.Data.Map{
                                .list = map_data,
                                .expansion_keys = expansion_keys,
                            },
                        },
                        .first_token = first_token,
                    };
                },
                .e_boolean => {
                    first_token = js_lexer.rangeOfIdentifier(this.source, expr.loc);
                },
                .e_number => {
                    // TODO: range of number
                    first_token.loc = expr.loc;
                    first_token.len = 1;
                },
                else => {
                    first_token.loc = expr.loc;
                },
            }

            this.log.addRangeWarning(this.source, first_token, "This value must be a string, an object, an array, or null") catch unreachable;
            return Entry{
                .data = .{ .invalid = {} },
                .first_token = first_token,
            };
        }
    };

    pub const Entry = struct {
        first_token: logger.Range,
        data: Data,

        pub const Data = union(Tag) {
            invalid: void,
            null: void,
            boolean: bool,
            string: string,
            array: []const Entry,
            map: Map,

            pub const Tag = enum {
                invalid,
                null,
                boolean,
                string,
                array,
                map,
            };

            pub const Map = struct {
                // This is not a std.ArrayHashMap because we also store the key_range which is a little weird
                pub const List = std.MultiArrayList(MapEntry);
                expansion_keys: []MapEntry,
                list: List,

                pub const MapEntry = struct {
                    key: string,
                    key_range: logger.Range,
                    value: Entry,
                };
            };
        };

        pub fn keysStartWithDot(this: *const Entry) bool {
            return this.data == .map and this.data.map.list.len > 0 and strings.startsWithChar(this.data.map.list.items(.key)[0], '.');
        }

        pub fn valueForKey(this: *const Entry, key_: string) ?Entry {
            switch (this.data) {
                .map => {
                    var slice = this.data.map.list.slice();
                    const keys = slice.items(.key);
                    for (keys, 0..) |key, i| {
                        if (strings.eql(key, key_)) {
                            return slice.items(.value)[i];
                        }
                    }

                    return null;
                },
                else => {
                    return null;
                },
            }
        }
    };
};

pub const ESModule = struct {
    pub const ConditionsMap = bun.StringArrayHashMap(void);

    debug_logs: ?*resolver.DebugLogs = null,
    conditions: ConditionsMap,
    allocator: std.mem.Allocator,
    module_type: *options.ModuleType = undefined,

    pub const Resolution = struct {
        status: Status = Status.Undefined,
        path: string = "",
        debug: Debug = Debug{},

        pub const Debug = struct {
            // This is the range of the token to use for error messages
            token: logger.Range = logger.Range.None,
            // If the status is "UndefinedNoConditionsMatch", this is the set of
            // conditions that didn't match. This information is used for error messages.
            unmatched_conditions: []string = &[_]string{},
        };
    };

    pub const Status = enum {
        Undefined,
        UndefinedNoConditionsMatch, // A more friendly error message for when no conditions are matched
        Null,
        Exact,
        ExactEndsWithStar,
        Inexact, // This means we may need to try CommonJS-style extension suffixes

        /// Module specifier is an invalid URL, package name or package subpath specifier.
        InvalidModuleSpecifier,

        /// package.json configuration is invalid or contains an invalid configuration.
        InvalidPackageConfiguration,

        /// Package exports or imports define a target module for the package that is an invalid type or string target.
        InvalidPackageTarget,

        /// Package exports do not define or permit a target subpath in the package for the given module.
        PackagePathNotExported,

        /// The package or module requested does not exist.
        ModuleNotFound,

        /// The user just needs to add the missing extension
        ModuleNotFoundMissingExtension,

        /// The resolved path corresponds to a directory, which is not a supported target for module imports.
        UnsupportedDirectoryImport,

        /// The user just needs to add the missing "/index.js" suffix
        UnsupportedDirectoryImportMissingIndex,

        /// When a package path is explicitly set to null, that means it's not exported.
        PackagePathDisabled,

        // The internal #import specifier was not found
        PackageImportNotDefined,

        PackageResolve,

        pub inline fn isUndefined(this: Status) bool {
            return switch (this) {
                .Undefined, .UndefinedNoConditionsMatch => true,
                else => false,
            };
        }
    };

    pub const Package = struct {
        name: string,
        version: string = "",
        subpath: string,

        pub const External = struct {
            name: Semver.String = .{},
            version: Semver.String = .{},
            subpath: Semver.String = .{},
        };

        pub fn count(this: Package, builder: *Semver.String.Builder) void {
            builder.count(this.name);
            builder.count(this.version);
            builder.count(this.subpath);
        }

        pub fn clone(this: Package, builder: *Semver.String.Builder) External {
            return .{
                .name = builder.appendUTF8WithoutPool(Semver.String, this.name, 0),
                .version = builder.appendUTF8WithoutPool(Semver.String, this.version, 0),
                .subpath = builder.appendUTF8WithoutPool(Semver.String, this.subpath, 0),
            };
        }

        pub fn toExternal(this: Package, buffer: []const u8) External {
            return .{
                .name = Semver.String.init(buffer, this.name),
                .version = Semver.String.init(buffer, this.version),
                .subpath = Semver.String.init(buffer, this.subpath),
            };
        }

        pub fn withAutoVersion(this: Package) Package {
            if (this.version.len == 0) {
                return .{
                    .name = this.name,
                    .subpath = this.subpath,
                    .version = "latest",
                };
            }

            return this;
        }

        pub fn parseName(specifier: string) ?string {
            var slash = strings.indexOfCharNeg(specifier, '/');
            if (!strings.startsWithChar(specifier, '@')) {
                slash = if (slash == -1) @as(i32, @intCast(specifier.len)) else slash;
                return specifier[0..@as(usize, @intCast(slash))];
            } else {
                if (slash == -1) return null;

                const slash2 = strings.indexOfChar(specifier[@as(usize, @intCast(slash)) + 1 ..], '/') orelse
                    specifier[@as(u32, @intCast(slash + 1))..].len;
                return specifier[0 .. @as(usize, @intCast(slash + 1)) + slash2];
            }
        }

        pub fn parseVersion(specifier_after_name: string) ?string {
            if (strings.indexOfChar(specifier_after_name, '/')) |slash| {
                // "foo@/bar" is not a valid specifier\
                // "foo@/"   is not a valid specifier
                // "foo/@/bar" is not a valid specifier
                // "foo@1/bar" is a valid specifier
                // "foo@^123.2.3+ba-ab/bar" is a valid specifier
                //      ^^^^^^^^^^^^^^
                //    this is the version

                const remainder = specifier_after_name[0..slash];
                if (remainder.len > 0 and remainder[0] == '@') {
                    return remainder[1..];
                }

                return remainder;
            }

            return null;
        }

        pub fn parse(specifier: string, subpath_buf: []u8) ?Package {
            if (specifier.len == 0) return null;
            var package = Package{ .name = parseName(specifier) orelse return null, .subpath = "" };

            if (strings.startsWith(package.name, ".") or strings.indexAnyComptime(package.name, "\\%") != null)
                return null;

            const offset: usize = if (package.name.len == 0 or package.name[0] != '@') 0 else 1;
            if (strings.indexOfChar(specifier[offset..], '@')) |at| {
                package.version = parseVersion(specifier[offset..][at..]) orelse "";
                if (package.version.len == 0) {
                    package.version = specifier[offset..][at..];
                    if (package.version.len > 0 and package.version[0] == '@') {
                        package.version = package.version[1..];
                    }
                }
                package.name = specifier[0 .. at + offset];

                parseSubpath(&package.subpath, specifier[@min(package.name.len + package.version.len + 1, specifier.len)..], subpath_buf);
            } else {
                parseSubpath(&package.subpath, specifier[package.name.len..], subpath_buf);
            }

            return package;
        }

        pub fn parseSubpath(subpath: *[]const u8, specifier: string, subpath_buf: []u8) void {
            subpath_buf[0] = '.';
            bun.copy(u8, subpath_buf[1..], specifier);
            subpath.* = subpath_buf[0 .. specifier.len + 1];
        }
    };

    const ReverseKind = enum { exact, pattern, prefix };
    pub const ReverseResolution = struct {
        subpath: string = "",
        token: logger.Range = logger.Range.None,
    };
    const invalid_percent_chars = [_]string{
        "%2f",
        "%2F",
        "%5c",
        "%5C",
    };

    threadlocal var resolved_path_buf_percent: bun.PathBuffer = undefined;
    pub fn resolve(r: *const ESModule, package_url: string, subpath: string, exports: ExportsMap.Entry) Resolution {
        return finalize(
            r.resolveExports(package_url, subpath, exports),
        );
    }

    pub fn resolveImports(r: *const ESModule, specifier: string, imports: ExportsMap.Entry) Resolution {
        if (imports.data != .map) {
            return .{
                .status = .InvalidPackageConfiguration,
                .debug = .{
                    .token = logger.Range.None,
                },
            };
        }

        const result = r.resolveImportsExports(
            specifier,
            imports,
            true,
            "/",
        );

        switch (result.status) {
            .Undefined, .Null => {
                return .{ .status = .PackageImportNotDefined, .debug = .{ .token = result.debug.token } };
            },
            else => {
                return finalize(result);
            },
        }
    }

    pub fn finalize(result_: Resolution) Resolution {
        var result = result_;
        if (result.status != .Exact and result.status != .ExactEndsWithStar and result.status != .Inexact) {
            return result;
        }

        // If resolved contains any percent encodings of "/" or "\" ("%2f" and "%5C"
        // respectively), then throw an Invalid Module Specifier error.
        const PercentEncoding = @import("../url.zig").PercentEncoding;
        var fbs = std.io.fixedBufferStream(&resolved_path_buf_percent);
        var writer = fbs.writer();
        const len = PercentEncoding.decode(@TypeOf(&writer), &writer, result.path) catch return Resolution{
            .status = .InvalidModuleSpecifier,
            .path = result.path,
            .debug = result.debug,
        };

        const resolved_path = resolved_path_buf_percent[0..len];

        var found: string = "";
        if (strings.contains(resolved_path, invalid_percent_chars[0])) {
            found = invalid_percent_chars[0];
        } else if (strings.contains(resolved_path, invalid_percent_chars[1])) {
            found = invalid_percent_chars[1];
        } else if (strings.contains(resolved_path, invalid_percent_chars[2])) {
            found = invalid_percent_chars[2];
        } else if (strings.contains(resolved_path, invalid_percent_chars[3])) {
            found = invalid_percent_chars[3];
        }

        if (found.len != 0) {
            return Resolution{ .status = .InvalidModuleSpecifier, .path = result.path, .debug = result.debug };
        }

        // If resolved is a directory, throw an Unsupported Directory Import error.
        if (strings.endsWithAnyComptime(resolved_path, "/\\")) {
            return Resolution{ .status = .UnsupportedDirectoryImport, .path = result.path, .debug = result.debug };
        }

        result.path = resolved_path;
        return result;
    }

    fn resolveExports(
        r: *const ESModule,
        package_url: string,
        subpath: string,
        exports: ExportsMap.Entry,
    ) Resolution {
        if (exports.data == .invalid) {
            if (r.debug_logs) |logs| {
                logs.addNote("Invalid package configuration");
            }

            return Resolution{ .status = .InvalidPackageConfiguration, .debug = .{ .token = exports.first_token } };
        }

        if (strings.eqlComptime(subpath, ".")) {
            var main_export = ExportsMap.Entry{ .data = .{ .null = {} }, .first_token = logger.Range.None };
            if (switch (exports.data) {
                .string,
                .array,
                => true,
                .map => !exports.keysStartWithDot(),
                else => false,
            }) {
                main_export = exports;
            } else if (exports.data == .map) {
                if (exports.valueForKey(".")) |value| {
                    main_export = value;
                }
            }

            if (main_export.data != .null) {
                const result = r.resolveTarget(package_url, main_export, "", false, false);
                if (result.status != .Null and result.status != .Undefined) {
                    return result;
                }
            }
        } else if (exports.data == .map and exports.keysStartWithDot()) {
            const result = r.resolveImportsExports(subpath, exports, false, package_url);
            if (result.status != .Null and result.status != .Undefined) {
                return result;
            }

            if (result.status == .Null) {
                return Resolution{ .status = .PackagePathDisabled, .debug = .{ .token = exports.first_token } };
            }
        }

        if (r.debug_logs) |logs| {
            logs.addNoteFmt("The path \"{s}\" was not exported", .{subpath});
        }

        return Resolution{ .status = .PackagePathNotExported, .debug = .{ .token = exports.first_token } };
    }

    fn resolveImportsExports(
        r: *const ESModule,
        match_key: string,
        match_obj: ExportsMap.Entry,
        is_imports: bool,
        package_url: string,
    ) Resolution {
        if (r.debug_logs) |logs| {
            logs.addNoteFmt("Checking object path map for \"{s}\"", .{match_key});
        }

        // If matchKey is a key of matchObj and does not end in "/" or contain "*", then
        if (!strings.endsWithChar(match_key, '/') and !strings.containsChar(match_key, '*')) {
            if (match_obj.valueForKey(match_key)) |target| {
                if (r.debug_logs) |log| {
                    log.addNoteFmt("Found \"{s}\"", .{match_key});
                }

                return r.resolveTarget(package_url, target, "", is_imports, false);
            }
        }

        if (match_obj.data == .map) {
            const expansion_keys = match_obj.data.map.expansion_keys;
            for (expansion_keys) |expansion| {

                // If expansionKey contains "*", set patternBase to the substring of
                // expansionKey up to but excluding the first "*" character
                if (strings.indexOfChar(expansion.key, '*')) |star| {
                    const pattern_base = expansion.key[0..star];
                    // If patternBase is not null and matchKey starts with but is not equal
                    // to patternBase, then
                    if (strings.startsWith(match_key, pattern_base)) {
                        // Let patternTrailer be the substring of expansionKey from the index
                        // after the first "*" character.
                        const pattern_trailer = expansion.key[star + 1 ..];

                        // If patternTrailer has zero length, or if matchKey ends with
                        // patternTrailer and the length of matchKey is greater than or
                        // equal to the length of expansionKey, then
                        if (pattern_trailer.len == 0 or (strings.endsWith(match_key, pattern_trailer) and match_key.len >= expansion.key.len)) {
                            const target = expansion.value;
                            const subpath = match_key[pattern_base.len .. match_key.len - pattern_trailer.len];
                            if (r.debug_logs) |log| {
                                log.addNoteFmt("The key \"{s}\" matched with \"{s}\" left over", .{ expansion.key, subpath });
                            }
                            return r.resolveTarget(package_url, target, subpath, is_imports, true);
                        }
                    }
                } else {
                    // Otherwise if patternBase is null and matchKey starts with
                    // expansionKey, then
                    if (strings.startsWith(match_key, expansion.key)) {
                        const target = expansion.value;
                        const subpath = match_key[expansion.key.len..];
                        if (r.debug_logs) |log| {
                            log.addNoteFmt("The key \"{s}\" matched with \"{s}\" left over", .{ expansion.key, subpath });
                        }
                        var result = r.resolveTarget(package_url, target, subpath, is_imports, false);
                        if (result.status == .Exact or result.status == .ExactEndsWithStar) {
                            // Return the object { resolved, exact: false }.
                            result.status = .Inexact;
                        }
                        return result;
                    }
                }

                if (r.debug_logs) |log| {
                    log.addNoteFmt("The key \"{s}\" did not match", .{expansion.key});
                }
            }
        }

        if (r.debug_logs) |log| {
            log.addNoteFmt("No keys matched \"{s}\"", .{match_key});
        }

        return Resolution{
            .status = .Null,
            .debug = .{ .token = match_obj.first_token },
        };
    }

    threadlocal var resolve_target_buf: bun.PathBuffer = undefined;
    threadlocal var resolve_target_buf2: bun.PathBuffer = undefined;
    fn resolveTarget(
        r: *const ESModule,
        package_url: string,
        target: ExportsMap.Entry,
        subpath: string,
        internal: bool,
        comptime pattern: bool,
    ) Resolution {
        switch (target.data) {
            .string => |str| {
                if (r.debug_logs) |log| {
                    log.addNoteFmt("Checking path \"{s}\" against target \"{s}\"", .{ subpath, str });
                    log.increaseIndent();
                }
                defer {
                    if (r.debug_logs) |log| {
                        log.decreaseIndent();
                    }
                }

                // If pattern is false, subpath has non-zero length and target
                // does not end with "/", throw an Invalid Module Specifier error.
                if (comptime !pattern) {
                    if (subpath.len > 0 and !strings.endsWithChar(str, '/')) {
                        if (r.debug_logs) |log| {
                            log.addNoteFmt("The target \"{s}\" is invalid because it doesn't end with a \"/\"", .{str});
                        }

                        return Resolution{ .path = str, .status = .InvalidModuleSpecifier, .debug = .{ .token = target.first_token } };
                    }
                }

                // If target does not start with "./", then...
                if (!strings.startsWith(str, "./")) {
                    if (r.debug_logs) |log| {
                        log.addNoteFmt("The target \"{s}\" is invalid because it doesn't start with a \"./\"", .{str});
                    }

                    if (internal and !strings.hasPrefixComptime(str, "../") and !strings.hasPrefix(str, "/")) {
                        if (comptime pattern) {
                            // Return the URL resolution of resolvedTarget with every instance of "*" replaced with subpath.
                            const len = std.mem.replacementSize(u8, str, "*", subpath);
                            _ = std.mem.replace(u8, str, "*", subpath, &resolve_target_buf2);
                            const result = resolve_target_buf2[0..len];
                            if (r.debug_logs) |log| {
                                log.addNoteFmt("Subsituted \"{s}\" for \"*\" in \".{s}\" to get \".{s}\" ", .{ subpath, str, result });
                            }

                            return Resolution{ .path = result, .status = .PackageResolve, .debug = .{ .token = target.first_token } };
                        } else {
                            const parts2 = [_]string{ str, subpath };
                            const result = resolve_path.joinStringBuf(&resolve_target_buf2, parts2, .auto);
                            if (r.debug_logs) |log| {
                                log.addNoteFmt("Resolved \".{s}\" to \".{s}\"", .{ str, result });
                            }

                            return Resolution{ .path = result, .status = .PackageResolve, .debug = .{ .token = target.first_token } };
                        }
                    }

                    return Resolution{ .path = str, .status = .InvalidPackageTarget, .debug = .{ .token = target.first_token } };
                }

                // If target split on "/" or "\" contains any ".", ".." or "node_modules"
                // segments after the first segment, throw an Invalid Package Target error.
                if (findInvalidSegment(str)) |invalid| {
                    if (r.debug_logs) |log| {
                        log.addNoteFmt("The target \"{s}\" is invalid because it contains an invalid segment \"{s}\"", .{ str, invalid });
                    }

                    return Resolution{ .path = str, .status = .InvalidPackageTarget, .debug = .{ .token = target.first_token } };
                }

                // Let resolvedTarget be the URL resolution of the concatenation of packageURL and target.
                const parts = [_]string{ package_url, str };
                const resolved_target = resolve_path.joinStringBuf(&resolve_target_buf, parts, .auto);

                // If target split on "/" or "\" contains any ".", ".." or "node_modules"
                // segments after the first segment, throw an Invalid Package Target error.
                if (findInvalidSegment(resolved_target)) |invalid| {
                    if (r.debug_logs) |log| {
                        log.addNoteFmt("The target \"{s}\" is invalid because it contains an invalid segment \"{s}\"", .{ str, invalid });
                    }

                    return Resolution{ .path = str, .status = .InvalidModuleSpecifier, .debug = .{ .token = target.first_token } };
                }

                if (comptime pattern) {
                    // Return the URL resolution of resolvedTarget with every instance of "*" replaced with subpath.
                    const len = std.mem.replacementSize(u8, resolved_target, "*", subpath);
                    _ = std.mem.replace(u8, resolved_target, "*", subpath, &resolve_target_buf2);
                    const result = resolve_target_buf2[0..len];
                    if (r.debug_logs) |log| {
                        log.addNoteFmt("Substituted \"{s}\" for \"*\" in \".{s}\" to get \".{s}\" ", .{ subpath, resolved_target, result });
                    }

                    const status: Status = if (strings.endsWithCharOrIsZeroLength(result, '*') and strings.indexOfChar(result, '*').? == result.len - 1)
                        .ExactEndsWithStar
                    else
                        .Exact;
                    return Resolution{ .path = result, .status = status, .debug = .{ .token = target.first_token } };
                } else {
                    const parts2 = [_]string{ package_url, str, subpath };
                    const result = resolve_path.joinStringBuf(&resolve_target_buf2, parts2, .auto);
                    if (r.debug_logs) |log| {
                        log.addNoteFmt("Substituted \"{s}\" for \"*\" in \".{s}\" to get \".{s}\" ", .{ subpath, resolved_target, result });
                    }

                    return Resolution{ .path = result, .status = .Exact, .debug = .{ .token = target.first_token } };
                }
            },
            .map => |object| {
                var did_find_map_entry = false;
                var last_map_entry_i: usize = 0;

                const slice = object.list.slice();
                const keys = slice.items(.key);
                for (keys, 0..) |key, i| {
                    if (r.conditions.contains(key)) {
                        if (r.debug_logs) |log| {
                            log.addNoteFmt("The key \"{s}\" matched", .{key});
                        }

                        const prev_module_type = r.module_type.*;
                        var result = r.resolveTarget(package_url, slice.items(.value)[i], subpath, internal, pattern);
                        if (result.status.isUndefined()) {
                            did_find_map_entry = true;
                            last_map_entry_i = i;
                            r.module_type.* = prev_module_type;
                            continue;
                        }

                        if (strings.eqlComptime(key, "import")) {
                            r.module_type.* = .esm;
                        }

                        if (strings.eqlComptime(key, "require")) {
                            r.module_type.* = .cjs;
                        }

                        return result;
                    }

                    if (r.debug_logs) |log| {
                        log.addNoteFmt("The key \"{s}\" did not match", .{key});
                    }
                }

                if (r.debug_logs) |log| {
                    log.addNoteFmt("No keys matched", .{});
                }

                var return_target = target;
                // ALGORITHM DEVIATION: Provide a friendly error message if no conditions matched
                if (keys.len > 0 and !target.keysStartWithDot()) {
                    var last_map_entry = ExportsMap.Entry.Data.Map.MapEntry{
                        .key = keys[last_map_entry_i],
                        .value = slice.items(.value)[last_map_entry_i],
                        // key_range is unused, so we don't need to pull up the array for it.
                        .key_range = logger.Range.None,
                    };
                    if (did_find_map_entry and
                        last_map_entry.value.data == .map and
                        last_map_entry.value.data.map.list.len > 0 and
                        !last_map_entry.value.keysStartWithDot())
                    {
                        // If a top-level condition did match but no sub-condition matched,
                        // complain about the sub-condition instead of the top-level condition.
                        // This leads to a less confusing error message. For example:
                        //
                        //   "exports": {
                        //     "node": {
                        //       "require": "./dist/bwip-js-node.js"
                        //     }
                        //   },
                        //
                        // We want the warning to say this:
                        //
                        //   note: None of the conditions provided ("require") match any of the
                        //         currently active conditions ("default", "import", "node")
                        //   14 |       "node": {
                        //      |               ^
                        //
                        // We don't want the warning to say this:
                        //
                        //   note: None of the conditions provided ("browser", "electron", "node")
                        //         match any of the currently active conditions ("default", "import", "node")
                        //   7 |   "exports": {
                        //     |              ^
                        //
                        // More information: https://github.com/evanw/esbuild/issues/1484
                        return_target = last_map_entry.value;
                    }

                    return Resolution{
                        .path = "",
                        .status = .UndefinedNoConditionsMatch,
                        .debug = .{
                            .token = target.first_token,
                            .unmatched_conditions = return_target.data.map.list.items(.key),
                        },
                    };
                }

                return Resolution{
                    .path = "",
                    .status = .UndefinedNoConditionsMatch,
                    .debug = .{ .token = target.first_token },
                };
            },
            .array => |array| {
                if (array.len == 0) {
                    if (r.debug_logs) |log| {
                        log.addNoteFmt("The path \"{s}\" is an empty array", .{subpath});
                    }

                    return Resolution{ .path = "", .status = .Null, .debug = .{ .token = target.first_token } };
                }

                var last_exception = Status.Undefined;
                var last_debug = Resolution.Debug{ .token = target.first_token };

                for (array) |targetValue| {
                    // Let resolved be the result, continuing the loop on any Invalid Package Target error.
                    const prev_module_type = r.module_type.*;
                    const result = r.resolveTarget(package_url, targetValue, subpath, internal, pattern);
                    if (result.status == .InvalidPackageTarget or result.status == .Null) {
                        last_debug = result.debug;
                        last_exception = result.status;
                    }

                    if (result.status.isUndefined()) {
                        r.module_type.* = prev_module_type;
                        continue;
                    }

                    return result;
                }

                return Resolution{ .path = "", .status = last_exception, .debug = last_debug };
            },
            .null => {
                if (r.debug_logs) |log| {
                    log.addNoteFmt("The path \"{s}\" is null", .{subpath});
                }

                return Resolution{ .path = "", .status = .Null, .debug = .{ .token = target.first_token } };
            },
            else => {},
        }

        if (r.debug_logs) |logs| {
            logs.addNoteFmt("Invalid package target for path \"{s}\"", .{subpath});
        }

        return Resolution{ .status = .InvalidPackageTarget, .debug = .{ .token = target.first_token } };
    }

    fn resolveExportsReverse(
        r: *const ESModule,
        query: string,
        root: ExportsMap.Entry,
    ) ?ReverseResolution {
        if (root.data == .map and root.keysStartWithDot()) {
            if (r.resolveImportsExportsReverse(query, root)) |res| {
                return res;
            }
        }

        return null;
    }

    fn resolveImportsExportsReverse(
        r: *const ESModule,
        query: string,
        match_obj: ExportsMap.Entry,
    ) ?ReverseResolution {
        if (match_obj.data != .map) return null;
        const map = match_obj.data.map;

        if (!strings.endsWithCharOrIsZeroLength(query, "*")) {
            var slices = map.list.slice();
            const keys = slices.items(.key);
            const values = slices.items(.value);
            for (keys, 0..) |key, i| {
                if (r.resolveTargetReverse(query, key, values[i], .exact)) |result| {
                    return result;
                }
            }
        }

        for (map.expansion_keys) |expansion| {
            if (strings.endsWithCharOrIsZeroLength(expansion.key, '*')) {
                if (r.resolveTargetReverse(query, expansion.key, expansion.value, .pattern)) |result| {
                    return result;
                }
            }

            if (r.resolveTargetReverse(query, expansion.key, expansion.value, .reverse)) |result| {
                return result;
            }
        }
    }

    threadlocal var resolve_target_reverse_prefix_buf: bun.PathBuffer = undefined;
    threadlocal var resolve_target_reverse_prefix_buf2: bun.PathBuffer = undefined;

    fn resolveTargetReverse(
        r: *const ESModule,
        query: string,
        key: string,
        target: ExportsMap.Entry,
        comptime kind: ReverseKind,
    ) ?ReverseResolution {
        switch (target.data) {
            .string => |str| {
                switch (comptime kind) {
                    .exact => {
                        if (strings.eql(query, str)) {
                            return ReverseResolution{ .subpath = str, .token = target.first_token };
                        }
                    },
                    .prefix => {
                        if (strings.startsWith(query, str)) {
                            return ReverseResolution{
                                .subpath = std.fmt.bufPrint(&resolve_target_reverse_prefix_buf, "{s}{s}", .{ key, query[str.len..] }) catch unreachable,
                                .token = target.first_token,
                            };
                        }
                    },
                    .pattern => {
                        const key_without_trailing_star = std.mem.trimRight(u8, key, "*");

                        const star = strings.indexOfChar(str, '*') orelse {
                            // Handle the case of no "*"
                            if (strings.eql(query, str)) {
                                return ReverseResolution{ .subpath = key_without_trailing_star, .token = target.first_token };
                            }
                            return null;
                        };

                        // Only support tracing through a single "*"
                        const prefix = str[0..star];
                        const suffix = str[star + 1 ..];
                        if (strings.startsWith(query, prefix) and !strings.containsChar(suffix, '*')) {
                            const after_prefix = query[prefix.len..];
                            if (strings.endsWith(after_prefix, suffix)) {
                                const star_data = after_prefix[0 .. after_prefix.len - suffix.len];
                                return ReverseResolution{
                                    .subpath = std.fmt.bufPrint(
                                        &resolve_target_reverse_prefix_buf2,
                                        "{s}{s}",
                                        .{
                                            key_without_trailing_star,
                                            star_data,
                                        },
                                    ) catch unreachable,
                                    .token = target.first_token,
                                };
                            }
                        }
                    },
                }
            },
            .map => |map| {
                const slice = map.list.slice();
                const keys = slice.items(.key);
                for (keys, 0..) |map_key, i| {
                    if (r.conditions.contains(map_key)) {
                        if (r.resolveTargetReverse(query, key, slice.items(.value)[i], kind)) |result| {
                            if (strings.eqlComptime(map_key, "import")) {
                                r.module_type.* = .esm;
                            } else if (strings.eqlComptime(map_key, "require")) {
                                r.module_type.* = .cjs;
                            }

                            return result;
                        }
                    }
                }
            },

            .array => |array| {
                for (array) |target_value| {
                    if (r.resolveTargetReverse(query, key, target_value, kind)) |result| {
                        return result;
                    }
                }
            },

            else => {},
        }

        return null;
    }
};

fn findInvalidSegment(path_: string) ?string {
    const slash = strings.indexAnyComptime(path_, "/\\") orelse return "";
    var path = path_[slash + 1 ..];

    while (path.len > 0) {
        var segment = path;
        if (strings.indexAnyComptime(path, "/\\")) |new_slash| {
            segment = path[0..new_slash];
            path = path[new_slash + 1 ..];
        } else {
            path = "";
        }

        switch (segment.len) {
            1 => {
                if (strings.eqlComptimeIgnoreLen(segment, ".")) return segment;
            },
            2 => {
                if (strings.eqlComptimeIgnoreLen(segment, "..")) return segment;
            },
            "node_modules".len => {
                if (strings.eqlComptimeIgnoreLen(segment, "node_modules")) return segment;
            },
            else => {},
        }
    }

    return null;
}
