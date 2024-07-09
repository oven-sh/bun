const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const URL = @import("./url.zig").URL;
const C = bun.C;
const options = @import("./options.zig");
const logger = bun.logger;
const js_ast = bun.JSAst;
const js_lexer = bun.js_lexer;
const Defines = @import("./defines.zig");
const ConditionsMap = @import("./resolver/package_json.zig").ESModule.ConditionsMap;
const Api = @import("./api/schema.zig").Api;
const Npm = @import("./install/npm.zig");
const PackageManager = @import("./install/install.zig").PackageManager;
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
const resolver = @import("./resolver/resolver.zig");
const TestCommand = @import("./cli/test_command.zig").TestCommand;
pub const MacroImportReplacementMap = bun.StringArrayHashMap(string);
pub const MacroMap = bun.StringArrayHashMapUnmanaged(MacroImportReplacementMap);
pub const BundlePackageOverride = bun.StringArrayHashMapUnmanaged(options.BundleOverride);
const LoaderMap = bun.StringArrayHashMapUnmanaged(options.Loader);
const JSONParser = bun.JSON;
const Command = @import("cli.zig").Command;
const TOML = @import("./toml/toml_parser.zig").TOML;

// TODO: replace Api.TransformOptions with Bunfig
pub const Bunfig = struct {
    pub const OfflineMode = enum {
        online,
        latest,
        offline,
    };
    pub const Prefer = bun.ComptimeStringMap(OfflineMode, .{
        &.{ "offline", OfflineMode.offline },
        &.{ "latest", OfflineMode.latest },
        &.{ "online", OfflineMode.online },
    });

    pub const Parser = struct {
        json: js_ast.Expr,
        source: *const logger.Source,
        log: *logger.Log,
        allocator: std.mem.Allocator,
        bunfig: *Api.TransformOptions,
        ctx: Command.Context,

        fn addError(this: *Parser, loc: logger.Loc, comptime text: string) !void {
            this.log.addError(this.source, loc, text) catch unreachable;
            return error.@"Invalid Bunfig";
        }

        fn addErrorFormat(this: *Parser, loc: logger.Loc, allocator: std.mem.Allocator, comptime text: string, args: anytype) !void {
            this.log.addErrorFmt(this.source, loc, allocator, text, args) catch unreachable;
            return error.@"Invalid Bunfig";
        }

        fn parseRegistryURLString(this: *Parser, str: *js_ast.E.String) !Api.NpmRegistry {
            const url = URL.parse(str.data);
            var registry = std.mem.zeroes(Api.NpmRegistry);

            // Token
            if (url.username.len == 0 and url.password.len > 0) {
                registry.token = url.password;
                registry.url = try std.fmt.allocPrint(this.allocator, "{s}://{}/{s}/", .{ url.displayProtocol(), url.displayHost(), std.mem.trim(u8, url.pathname, "/") });
            } else if (url.username.len > 0 and url.password.len > 0) {
                registry.username = url.username;
                registry.password = url.password;

                registry.url = try std.fmt.allocPrint(this.allocator, "{s}://{}/{s}/", .{ url.displayProtocol(), url.displayHost(), std.mem.trim(u8, url.pathname, "/") });
            } else {
                // Do not include a trailing slash. There might be parameters at the end.
                registry.url = url.href;
            }

            return registry;
        }

        fn parseRegistryObject(this: *Parser, obj: *js_ast.E.Object) !Api.NpmRegistry {
            var registry = std.mem.zeroes(Api.NpmRegistry);

            if (obj.get("url")) |url| {
                try this.expectString(url);
                const href = url.asString(this.allocator).?;
                // Do not include a trailing slash. There might be parameters at the end.
                registry.url = href;
            }

            if (obj.get("username")) |username| {
                try this.expectString(username);
                registry.username = username.asString(this.allocator).?;
            }

            if (obj.get("password")) |password| {
                try this.expectString(password);
                registry.password = password.asString(this.allocator).?;
            }

            if (obj.get("token")) |token| {
                try this.expectString(token);
                registry.token = token.asString(this.allocator).?;
            }

            return registry;
        }

        fn parseRegistry(this: *Parser, expr: js_ast.Expr) !Api.NpmRegistry {
            switch (expr.data) {
                .e_string => |str| {
                    return this.parseRegistryURLString(str);
                },
                .e_object => |obj| {
                    return this.parseRegistryObject(obj);
                },
                else => {
                    try this.addError(expr.loc, "Expected registry to be a URL string or an object");
                    return std.mem.zeroes(Api.NpmRegistry);
                },
            }
        }

        fn loadLogLevel(this: *Parser, expr: js_ast.Expr) !void {
            try this.expectString(expr);
            const Matcher = strings.ExactSizeMatcher(8);

            this.bunfig.log_level = switch (Matcher.match(expr.asString(this.allocator).?)) {
                Matcher.case("debug") => Api.MessageLevel.debug,
                Matcher.case("error") => Api.MessageLevel.err,
                Matcher.case("warn") => Api.MessageLevel.warn,
                Matcher.case("info") => Api.MessageLevel.info,
                else => {
                    try this.addError(expr.loc, "Invalid log level, must be one of debug, error, or warn");
                    unreachable;
                },
            };
        }

        fn loadPreload(
            this: *Parser,
            allocator: std.mem.Allocator,
            expr: js_ast.Expr,
        ) !void {
            if (expr.asArray()) |array_| {
                var array = array_;
                var preloads = try std.ArrayList(string).initCapacity(allocator, array.array.items.len);
                errdefer preloads.deinit();
                while (array.next()) |item| {
                    try this.expectString(item);
                    if (item.data.e_string.len() > 0)
                        preloads.appendAssumeCapacity(try item.data.e_string.string(allocator));
                }
                this.ctx.preloads = preloads.items;
            } else if (expr.data == .e_string) {
                if (expr.data.e_string.len() > 0) {
                    var preloads = try allocator.alloc(string, 1);
                    preloads[0] = try expr.data.e_string.string(allocator);
                    this.ctx.preloads = preloads;
                }
            } else if (expr.data != .e_null) {
                try this.addError(expr.loc, "Expected preload to be an array");
            }
        }

        pub fn parse(this: *Parser, comptime cmd: Command.Tag) !void {
            bun.analytics.Features.bunfig += 1;

            const json = this.json;
            var allocator = this.allocator;

            if (json.data != .e_object) {
                try this.addError(json.loc, "bunfig expects an object { } at the root");
            }

            if (json.get("logLevel")) |expr| {
                try this.loadLogLevel(expr);
            }

            if (json.get("define")) |expr| {
                try this.expect(expr, .e_object);
                var valid_count: usize = 0;
                const properties = expr.data.e_object.properties.slice();
                for (properties) |prop| {
                    if (prop.value.?.data != .e_string) continue;
                    valid_count += 1;
                }
                var buffer = allocator.alloc([]const u8, valid_count * 2) catch unreachable;
                var keys = buffer[0..valid_count];
                var values = buffer[valid_count..];
                var i: usize = 0;
                for (properties) |prop| {
                    if (prop.value.?.data != .e_string) continue;
                    keys[i] = prop.key.?.data.e_string.string(allocator) catch unreachable;
                    values[i] = prop.value.?.data.e_string.string(allocator) catch unreachable;
                    i += 1;
                }
                this.bunfig.define = Api.StringMap{
                    .keys = keys,
                    .values = values,
                };
            }

            if (json.get("origin")) |expr| {
                try this.expectString(expr);
                this.bunfig.origin = try expr.data.e_string.string(allocator);
            }

            if (comptime cmd == .RunCommand or cmd == .AutoCommand) {
                if (json.get("serve")) |expr| {
                    if (expr.get("port")) |port| {
                        try this.expect(port, .e_number);
                        this.bunfig.port = port.data.e_number.toU16();
                        if (this.bunfig.port.? == 0) {
                            this.bunfig.port = 3000;
                        }
                    }
                }

                if (json.get("preload")) |expr| {
                    try this.loadPreload(allocator, expr);
                }

                if (json.get("telemetry")) |expr| {
                    try this.expect(expr, .e_boolean);
                    bun.analytics.enabled = if (expr.data.e_boolean.value) .yes else .no;
                }
            }

            if (comptime cmd == .RunCommand or cmd == .AutoCommand) {
                if (json.get("smol")) |expr| {
                    try this.expect(expr, .e_boolean);
                    this.ctx.runtime_options.smol = expr.data.e_boolean.value;
                }
            }

            if (comptime cmd == .TestCommand) {
                if (json.get("test")) |test_| {
                    if (test_.get("root")) |root| {
                        this.ctx.debug.test_directory = root.asString(this.allocator) orelse "";
                    }

                    if (test_.get("preload")) |expr| {
                        try this.loadPreload(allocator, expr);
                    }

                    if (test_.get("smol")) |expr| {
                        try this.expect(expr, .e_boolean);
                        this.ctx.runtime_options.smol = expr.data.e_boolean.value;
                    }

                    if (test_.get("coverage")) |expr| {
                        try this.expect(expr, .e_boolean);
                        this.ctx.test_options.coverage.enabled = expr.data.e_boolean.value;
                    }

                    if (test_.get("coverageReporter")) |expr| brk: {
                        this.ctx.test_options.coverage.reporters = .{ .text = false, .lcov = false };
                        if (expr.data == .e_string) {
                            const item_str = expr.asString(bun.default_allocator) orelse "";
                            if (bun.strings.eqlComptime(item_str, "text")) {
                                this.ctx.test_options.coverage.reporters.text = true;
                            } else if (bun.strings.eqlComptime(item_str, "lcov")) {
                                this.ctx.test_options.coverage.reporters.lcov = true;
                            } else {
                                try this.addErrorFormat(expr.loc, allocator, "Invalid coverage reporter \"{s}\"", .{item_str});
                            }

                            break :brk;
                        }

                        try this.expect(expr, .e_array);
                        const items = expr.data.e_array.items.slice();
                        for (items) |item| {
                            try this.expectString(item);
                            const item_str = item.asString(bun.default_allocator) orelse "";
                            if (bun.strings.eqlComptime(item_str, "text")) {
                                this.ctx.test_options.coverage.reporters.text = true;
                            } else if (bun.strings.eqlComptime(item_str, "lcov")) {
                                this.ctx.test_options.coverage.reporters.lcov = true;
                            } else {
                                try this.addErrorFormat(item.loc, allocator, "Invalid coverage reporter \"{s}\"", .{item_str});
                            }
                        }
                    }

                    if (test_.get("coverageDir")) |expr| {
                        try this.expectString(expr);
                        this.ctx.test_options.coverage.reports_directory = try expr.data.e_string.string(allocator);
                    }

                    if (test_.get("coverageThreshold")) |expr| outer: {
                        if (expr.data == .e_number) {
                            this.ctx.test_options.coverage.fractions.functions = expr.data.e_number.value;
                            this.ctx.test_options.coverage.fractions.lines = expr.data.e_number.value;
                            this.ctx.test_options.coverage.fractions.stmts = expr.data.e_number.value;
                            this.ctx.test_options.coverage.fail_on_low_coverage = true;
                            break :outer;
                        }

                        try this.expect(expr, .e_object);
                        if (expr.get("functions")) |functions| {
                            try this.expect(functions, .e_number);
                            this.ctx.test_options.coverage.fractions.functions = functions.data.e_number.value;
                            this.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }

                        if (expr.get("lines")) |lines| {
                            try this.expect(lines, .e_number);
                            this.ctx.test_options.coverage.fractions.lines = lines.data.e_number.value;
                            this.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }

                        if (expr.get("statements")) |stmts| {
                            try this.expect(stmts, .e_number);
                            this.ctx.test_options.coverage.fractions.stmts = stmts.data.e_number.value;
                            this.ctx.test_options.coverage.fail_on_low_coverage = true;
                        }
                    }

                    // This mostly exists for debugging.
                    if (test_.get("coverageIgnoreSourcemaps")) |expr| {
                        try this.expect(expr, .e_boolean);
                        this.ctx.test_options.coverage.ignore_sourcemap = expr.data.e_boolean.value;
                    }

                    if (test_.get("coverageSkipTestFiles")) |expr| {
                        try this.expect(expr, .e_boolean);
                        this.ctx.test_options.coverage.skip_test_files = expr.data.e_boolean.value;
                    }
                }
            }

            if (comptime cmd.isNPMRelated() or cmd == .RunCommand or cmd == .AutoCommand) {
                if (json.get("install")) |_bun| {
                    var install: *Api.BunInstall = this.ctx.install orelse brk: {
                        const install_ = try this.allocator.create(Api.BunInstall);
                        install_.* = std.mem.zeroes(Api.BunInstall);
                        this.ctx.install = install_;
                        break :brk install_;
                    };

                    if (_bun.get("auto")) |auto_install_expr| {
                        if (auto_install_expr.data == .e_string) {
                            this.ctx.debug.global_cache = options.GlobalCache.Map.get(auto_install_expr.asString(this.allocator) orelse "") orelse {
                                try this.addError(auto_install_expr.loc, "Invalid auto install setting, must be one of true, false, or \"force\" \"fallback\" \"disable\"");
                                return;
                            };
                        } else if (auto_install_expr.data == .e_boolean) {
                            this.ctx.debug.global_cache = if (auto_install_expr.asBool().?)
                                options.GlobalCache.allow_install
                            else
                                options.GlobalCache.disable;
                        } else {
                            try this.addError(auto_install_expr.loc, "Invalid auto install setting, must be one of true, false, or \"force\" \"fallback\" \"disable\"");
                            return;
                        }
                    }

                    if (_bun.get("exact")) |exact| {
                        if (exact.asBool()) |value| {
                            install.exact = value;
                        }
                    }

                    if (_bun.get("prefer")) |prefer_expr| {
                        try this.expectString(prefer_expr);

                        if (Prefer.get(prefer_expr.asString(bun.default_allocator) orelse "")) |setting| {
                            this.ctx.debug.offline_mode_setting = setting;
                        } else {
                            try this.addError(prefer_expr.loc, "Invalid prefer setting, must be one of online or offline");
                        }
                    }

                    if (_bun.get("registry")) |registry| {
                        install.default_registry = try this.parseRegistry(registry);
                    }

                    if (_bun.get("scopes")) |scopes| {
                        var registry_map = install.scoped orelse Api.NpmRegistryMap{};
                        try this.expect(scopes, .e_object);

                        try registry_map.scopes.ensureUnusedCapacity(this.allocator, scopes.data.e_object.properties.len);

                        for (scopes.data.e_object.properties.slice()) |prop| {
                            const name_ = prop.key.?.asString(this.allocator) orelse continue;
                            const value = prop.value orelse continue;
                            if (name_.len == 0) continue;
                            const name = if (name_[0] == '@') name_[1..] else name_;
                            const registry = try this.parseRegistry(value);
                            try registry_map.scopes.put(this.allocator, name, registry);
                        }

                        install.scoped = registry_map;
                    }

                    if (_bun.get("dryRun")) |dry_run| {
                        if (dry_run.asBool()) |value| {
                            install.dry_run = value;
                        }
                    }

                    if (_bun.get("production")) |production| {
                        if (production.asBool()) |value| {
                            install.production = value;
                        }
                    }

                    if (_bun.get("frozenLockfile")) |frozen_lockfile| {
                        if (frozen_lockfile.asBool()) |value| {
                            install.frozen_lockfile = value;
                        }
                    }

                    if (_bun.get("concurrentScripts")) |jobs| {
                        if (jobs.data == .e_number) {
                            install.concurrent_scripts = jobs.data.e_number.toU32();
                            if (install.concurrent_scripts.? == 0) install.concurrent_scripts = null;
                        }
                    }

                    if (_bun.get("lockfile")) |lockfile_expr| {
                        if (lockfile_expr.get("print")) |lockfile| {
                            try this.expectString(lockfile);
                            if (lockfile.asString(this.allocator)) |value| {
                                if (!(strings.eqlComptime(value, "bun"))) {
                                    if (!strings.eqlComptime(value, "yarn")) {
                                        try this.addError(lockfile.loc, "Invalid lockfile format, only 'yarn' output is implemented");
                                    }

                                    install.save_yarn_lockfile = true;
                                }
                            }
                        }

                        if (lockfile_expr.get("save")) |lockfile| {
                            if (lockfile.asBool()) |value| {
                                install.save_lockfile = value;
                            }
                        }

                        if (lockfile_expr.get("path")) |lockfile| {
                            if (lockfile.asString(allocator)) |value| {
                                install.lockfile_path = value;
                            }
                        }

                        if (lockfile_expr.get("savePath")) |lockfile| {
                            if (lockfile.asString(allocator)) |value| {
                                install.save_lockfile_path = value;
                            }
                        }
                    }

                    if (_bun.get("optional")) |optional| {
                        if (optional.asBool()) |value| {
                            install.save_optional = value;
                        }
                    }

                    if (_bun.get("peer")) |optional| {
                        if (optional.asBool()) |value| {
                            install.save_peer = value;
                        }
                    }

                    if (_bun.get("dev")) |optional| {
                        if (optional.asBool()) |value| {
                            install.save_dev = value;
                        }
                    }

                    if (_bun.get("globalDir")) |dir| {
                        if (dir.asString(allocator)) |value| {
                            install.global_dir = value;
                        }
                    }

                    if (_bun.get("globalBinDir")) |dir| {
                        if (dir.asString(allocator)) |value| {
                            install.global_bin_dir = value;
                        }
                    }

                    if (_bun.get("logLevel")) |expr| {
                        try this.loadLogLevel(expr);
                    }

                    if (_bun.get("cache")) |cache| {
                        load: {
                            if (cache.asBool()) |value| {
                                if (!value) {
                                    install.disable_cache = true;
                                    install.disable_manifest_cache = true;
                                }

                                break :load;
                            }

                            if (cache.asString(allocator)) |value| {
                                install.cache_directory = value;
                                break :load;
                            }

                            if (cache.data == .e_object) {
                                if (cache.get("disable")) |disable| {
                                    if (disable.asBool()) |value| {
                                        install.disable_cache = value;
                                    }
                                }

                                if (cache.get("disableManifest")) |disable| {
                                    if (disable.asBool()) |value| {
                                        install.disable_manifest_cache = value;
                                    }
                                }

                                if (cache.get("dir")) |directory| {
                                    if (directory.asString(allocator)) |value| {
                                        install.cache_directory = value;
                                    }
                                }
                            }
                        }
                    }
                }

                if (json.get("run")) |run_expr| {
                    if (run_expr.get("silent")) |silent| {
                        if (silent.asBool()) |value| {
                            this.ctx.debug.silent = value;
                        } else {
                            try this.addError(silent.loc, "Expected boolean");
                        }
                    }

                    if (run_expr.get("shell")) |shell| {
                        if (shell.asString(allocator)) |value| {
                            if (strings.eqlComptime(value, "bun")) {
                                this.ctx.debug.use_system_shell = false;
                            } else if (strings.eqlComptime(value, "system")) {
                                this.ctx.debug.use_system_shell = true;
                            } else {
                                try this.addError(shell.loc, "Invalid shell, only 'bun' and 'system' are supported");
                            }
                        } else {
                            try this.addError(shell.loc, "Expected string");
                        }
                    }

                    if (run_expr.get("bun")) |bun_flag| {
                        if (bun_flag.asBool()) |value| {
                            this.ctx.debug.run_in_bun = value;
                        } else {
                            try this.addError(bun_flag.loc, "Expected boolean");
                        }
                    }
                }
            }

            if (json.get("bundle")) |_bun| {
                if (comptime cmd == .BuildCommand or cmd == .RunCommand or cmd == .AutoCommand or cmd == .BuildCommand) {
                    if (_bun.get("outdir")) |dir| {
                        try this.expectString(dir);
                        this.bunfig.output_dir = try dir.data.e_string.string(allocator);
                    }
                }

                if (comptime cmd == .BuildCommand) {
                    if (_bun.get("logLevel")) |expr2| {
                        try this.loadLogLevel(expr2);
                    }

                    if (_bun.get("entryPoints")) |entryPoints| {
                        try this.expect(entryPoints, .e_array);
                        const items = entryPoints.data.e_array.items.slice();
                        var names = try this.allocator.alloc(string, items.len);
                        for (items, 0..) |item, i| {
                            try this.expectString(item);
                            names[i] = try item.data.e_string.string(allocator);
                        }
                        this.bunfig.entry_points = names;
                    }

                    if (_bun.get("packages")) |expr| {
                        try this.expect(expr, .e_object);
                        var valid_count: usize = 0;

                        const object = expr.data.e_object;
                        const properties = object.properties.slice();
                        for (properties) |prop| {
                            if (prop.value.?.data != .e_boolean) continue;
                            valid_count += 1;
                        }

                        try this.ctx.debug.package_bundle_map.ensureTotalCapacity(allocator, valid_count);

                        for (properties) |prop| {
                            if (prop.value.?.data != .e_boolean) continue;

                            const path = try prop.key.?.data.e_string.string(allocator);

                            if (!resolver.isPackagePath(path)) {
                                try this.addError(prop.key.?.loc, "Expected package name");
                            }

                            this.ctx.debug.package_bundle_map.putAssumeCapacity(path, switch (prop.value.?.asBool() orelse false) {
                                true => options.BundlePackage.always,
                                false => options.BundlePackage.never,
                            });
                        }
                    }
                }
            }

            var jsx_factory: string = "";
            var jsx_fragment: string = "";
            var jsx_import_source: string = "";
            var jsx_runtime = Api.JsxRuntime.automatic;
            var jsx_dev = true;

            if (json.get("jsx")) |expr| {
                if (expr.asString(allocator)) |value| {
                    if (strings.eqlComptime(value, "react")) {
                        jsx_runtime = Api.JsxRuntime.classic;
                    } else if (strings.eqlComptime(value, "solid")) {
                        jsx_runtime = Api.JsxRuntime.solid;
                    } else if (strings.eqlComptime(value, "react-jsx")) {
                        jsx_runtime = Api.JsxRuntime.automatic;
                        jsx_dev = false;
                    } else if (strings.eqlComptime(value, "react-jsxDEV")) {
                        jsx_runtime = Api.JsxRuntime.automatic;
                        jsx_dev = true;
                    } else {
                        try this.addError(expr.loc, "Invalid jsx runtime, only 'react', 'solid', 'react-jsx', and 'react-jsxDEV' are supported");
                    }
                }
            }

            if (json.get("jsxImportSource")) |expr| {
                if (expr.asString(allocator)) |value| {
                    jsx_import_source = try allocator.dupe(u8, value);
                }
            }

            if (json.get("jsxFragment")) |expr| {
                if (expr.asString(allocator)) |value| {
                    jsx_fragment = try allocator.dupe(u8, value);
                }
            }

            if (json.get("jsxFactory")) |expr| {
                if (expr.asString(allocator)) |value| {
                    jsx_factory = try allocator.dupe(u8, value);
                }
            }

            if (this.bunfig.jsx == null) {
                this.bunfig.jsx = Api.Jsx{
                    .factory = @constCast(jsx_factory),
                    .fragment = @constCast(jsx_fragment),
                    .import_source = @constCast(jsx_import_source),
                    .runtime = jsx_runtime,
                    .development = jsx_dev,
                    .react_fast_refresh = false,
                };
            } else {
                var jsx: *Api.Jsx = &this.bunfig.jsx.?;
                if (jsx_factory.len > 0) {
                    jsx.factory = jsx_factory;
                }
                if (jsx_fragment.len > 0) {
                    jsx.fragment = jsx_fragment;
                }
                if (jsx_import_source.len > 0) {
                    jsx.import_source = jsx_import_source;
                }
                jsx.runtime = jsx_runtime;
                jsx.development = jsx_dev;
            }

            switch (comptime cmd) {
                .AutoCommand, .BuildCommand => {
                    if (json.get("publicDir")) |public_dir| {
                        try this.expectString(public_dir);
                        this.bunfig.router = Api.RouteConfig{
                            .extensions = &.{},
                            .dir = &.{},
                            .static_dir = try public_dir.data.e_string.string(allocator),
                        };
                    }
                },
                else => {},
            }

            if (json.get("debug")) |expr| {
                if (expr.get("editor")) |editor| {
                    if (editor.asString(allocator)) |value| {
                        this.ctx.debug.editor = value;
                    }
                }
            }

            if (json.get("macros")) |expr| {
                if (expr.data == .e_boolean) {
                    if (expr.data.e_boolean.value == false) {
                        this.ctx.debug.macros = .{ .disable = {} };
                    }
                } else {
                    this.ctx.debug.macros = .{ .map = PackageJSON.parseMacrosJSON(allocator, expr, this.log, this.source) };
                }
                bun.analytics.Features.macros += 1;
            }

            if (json.get("external")) |expr| {
                switch (expr.data) {
                    .e_string => |str| {
                        var externals = try allocator.alloc(string, 1);
                        externals[0] = try str.string(allocator);
                        this.bunfig.external = externals;
                    },
                    .e_array => |array| {
                        var externals = try allocator.alloc(string, array.items.len);

                        for (array.items.slice(), 0..) |item, i| {
                            try this.expectString(item);
                            externals[i] = try item.data.e_string.string(allocator);
                        }

                        this.bunfig.external = externals;
                    },
                    else => try this.addError(expr.loc, "Expected string or array"),
                }
            }

            if (json.get("framework")) |expr| {
                try this.expectString(expr);
                this.bunfig.framework = Api.FrameworkConfig{
                    .package = expr.asString(allocator).?,
                };
            }

            if (json.get("loader")) |expr| {
                try this.expect(expr, .e_object);
                const properties = expr.data.e_object.properties.slice();
                var loader_names = try this.allocator.alloc(string, properties.len);
                var loader_values = try this.allocator.alloc(Api.Loader, properties.len);

                for (properties, 0..) |item, i| {
                    const key = item.key.?.asString(allocator).?;
                    if (key.len == 0) continue;
                    if (key[0] != '.') {
                        try this.addError(item.key.?.loc, "file extension for loader must start with a '.'");
                    }
                    var value = item.value.?;
                    try this.expectString(value);

                    const loader = options.Loader.fromString(value.asString(allocator).?) orelse {
                        try this.addError(value.loc, "Invalid loader");
                        unreachable;
                    };

                    loader_names[i] = key;
                    loader_values[i] = loader.toAPI();
                }
                this.bunfig.loaders = Api.LoaderMap{
                    .extensions = loader_names,
                    .loaders = loader_values,
                };
            }
        }

        pub fn expectString(this: *Parser, expr: js_ast.Expr) !void {
            switch (expr.data) {
                .e_string, .e_utf8_string => {},
                else => {
                    this.log.addErrorFmt(this.source, expr.loc, this.allocator, "expected string but received {}", .{
                        @as(js_ast.Expr.Tag, expr.data),
                    }) catch unreachable;
                    return error.@"Invalid Bunfig";
                },
            }
        }

        pub fn expect(this: *Parser, expr: js_ast.Expr, token: js_ast.Expr.Tag) !void {
            if (@as(js_ast.Expr.Tag, expr.data) != token) {
                this.log.addErrorFmt(this.source, expr.loc, this.allocator, "expected {} but received {}", .{
                    token,
                    @as(js_ast.Expr.Tag, expr.data),
                }) catch unreachable;
                return error.@"Invalid Bunfig";
            }
        }
    };

    pub fn parse(allocator: std.mem.Allocator, source: logger.Source, ctx: Command.Context, comptime cmd: Command.Tag) !void {
        const log_count = ctx.log.errors + ctx.log.warnings;

        const expr = if (strings.eqlComptime(source.path.name.ext[1..], "toml")) TOML.parse(&source, ctx.log, allocator) catch |err| {
            if (ctx.log.errors + ctx.log.warnings == log_count) {
                ctx.log.addErrorFmt(&source, logger.Loc.Empty, allocator, "Failed to parse", .{}) catch unreachable;
            }
            return err;
        } else JSONParser.ParseTSConfig(&source, ctx.log, allocator) catch |err| {
            if (ctx.log.errors + ctx.log.warnings == log_count) {
                ctx.log.addErrorFmt(&source, logger.Loc.Empty, allocator, "Failed to parse", .{}) catch unreachable;
            }
            return err;
        };

        var parser = Parser{
            .json = expr,
            .log = ctx.log,
            .allocator = allocator,
            .source = &source,
            .bunfig = &ctx.args,
            .ctx = ctx,
        };
        try parser.parse(cmd);
    }
};
