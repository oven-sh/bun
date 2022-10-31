const std = @import("std");
const bun = @import("./global.zig");
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
const logger = @import("./logger.zig");
const js_ast = @import("./js_ast.zig");
const js_lexer = @import("./js_lexer.zig");
const Defines = @import("./defines.zig");
const ConditionsMap = @import("./resolver/package_json.zig").ESModule.ConditionsMap;
const Api = @import("./api/schema.zig").Api;
const Npm = @import("./install/npm.zig");
const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
const resolver = @import("./resolver/resolver.zig");
pub const MacroImportReplacementMap = std.StringArrayHashMap(string);
pub const MacroMap = std.StringArrayHashMapUnmanaged(MacroImportReplacementMap);
pub const BundlePackageOverride = std.StringArrayHashMapUnmanaged(options.BundleOverride);
const LoaderMap = std.StringArrayHashMapUnmanaged(options.Loader);
const Analytics = @import("./analytics.zig");
const JSONParser = @import("./json_parser.zig");
const Command = @import("cli.zig").Command;
const TOML = @import("./toml/toml_parser.zig").TOML;

// TODO: replace Api.TransformOptions with Bunfig
pub const Bunfig = struct {
    pub const OfflineMode = enum {
        online,
        offline,
    };
    pub const Prefer = bun.ComptimeStringMap(OfflineMode, .{
        &.{ "offline", OfflineMode.offline },
        &.{ "online", OfflineMode.online },
    });

    const Parser = struct {
        json: js_ast.Expr,
        source: *const logger.Source,
        log: *logger.Log,
        allocator: std.mem.Allocator,
        bunfig: *Api.TransformOptions,
        ctx: *Command.Context,

        fn addError(this: *Parser, loc: logger.Loc, comptime text: string) !void {
            this.log.addError(this.source, loc, text) catch unreachable;
            return error.@"Invalid Bunfig";
        }

        fn parseRegistry(this: *Parser, expr: js_ast.Expr) !Api.NpmRegistry {
            var registry = std.mem.zeroes(Api.NpmRegistry);

            switch (expr.data) {
                .e_string => |str| {
                    const url = URL.parse(str.data);
                    // Token
                    if (url.username.len == 0 and url.password.len > 0) {
                        registry.token = url.password;
                        registry.url = try std.fmt.allocPrint(this.allocator, "{s}://{s}/{s}", .{ url.displayProtocol(), url.displayHostname(), std.mem.trimLeft(u8, url.pathname, "/") });
                    } else if (url.username.len > 0 and url.password.len > 0) {
                        registry.username = url.username;
                        registry.password = url.password;
                        registry.url = try std.fmt.allocPrint(this.allocator, "{s}://{s}/{s}", .{ url.displayProtocol(), url.displayHostname(), std.mem.trimLeft(u8, url.pathname, "/") });
                    } else {
                        registry.url = url.href;
                    }
                },
                .e_object => |obj| {
                    if (obj.get("url")) |url| {
                        try this.expect(url, .e_string);
                        registry.url = url.data.e_string.data;
                    }

                    if (obj.get("username")) |username| {
                        try this.expect(username, .e_string);
                        registry.username = username.data.e_string.data;
                    }

                    if (obj.get("password")) |password| {
                        try this.expect(password, .e_string);
                        registry.password = password.data.e_string.data;
                    }

                    if (obj.get("token")) |token| {
                        try this.expect(token, .e_string);
                        registry.token = token.data.e_string.data;
                    }
                },
                else => {
                    try this.addError(expr.loc, "Expected registry to be a URL string or an object");
                },
            }

            return registry;
        }

        fn loadLogLevel(this: *Parser, expr: js_ast.Expr) !void {
            try this.expect(expr, .e_string);
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

        pub fn parse(this: *Parser, comptime cmd: Command.Tag) !void {
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
                try this.expect(expr, .e_string);
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
            }

            if (comptime cmd == .DevCommand or cmd == .AutoCommand) {
                if (json.get("dev")) |expr| {
                    if (expr.get("disableBunJS")) |disable| {
                        this.ctx.debug.fallback_only = disable.asBool() orelse false;
                    }

                    if (expr.get("logLevel")) |expr2| {
                        try this.loadLogLevel(expr2);
                    }

                    if (expr.get("port")) |port| {
                        try this.expect(port, .e_number);
                        this.bunfig.port = port.data.e_number.toU16();
                        if (this.bunfig.port.? == 0) {
                            this.bunfig.port = 3000;
                        }
                    }
                }
            }

            if (comptime cmd.isNPMRelated() or cmd == .RunCommand or cmd == .AutoCommand) {
                if (json.get("install")) |_bun| {
                    var install: *Api.BunInstall = this.ctx.install orelse brk: {
                        var install_ = try this.allocator.create(Api.BunInstall);
                        install_.* = std.mem.zeroes(Api.BunInstall);
                        this.ctx.install = install_;
                        break :brk install_;
                    };

                    if (json.get("auto")) |auto_install_expr| {
                        try this.expect(auto_install_expr, .e_boolean);
                        this.ctx.debug.auto_install_setting = auto_install_expr.asBool();
                    }

                    if (json.get("prefer")) |prefer_expr| {
                        try this.expect(prefer_expr, .e_string);

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
                        var registry_map = install.scoped orelse std.mem.zeroes(Api.NpmRegistryMap);
                        try this.expect(scopes, .e_object);
                        const count = scopes.data.e_object.properties.len + registry_map.registries.len;

                        var registries = try std.ArrayListUnmanaged(Api.NpmRegistry).initCapacity(this.allocator, count);
                        registries.appendSliceAssumeCapacity(registry_map.registries);

                        var names = try std.ArrayListUnmanaged(string).initCapacity(this.allocator, count);
                        names.appendSliceAssumeCapacity(registry_map.scopes);

                        for (scopes.data.e_object.properties.slice()) |prop| {
                            const name_ = prop.key.?.asString(this.allocator) orelse continue;
                            const value = prop.value orelse continue;
                            if (name_.len == 0) continue;
                            const name = if (name_[0] == '@') name_[1..] else name_;
                            var index = names.items.len;
                            for (names.items) |comparator, i| {
                                if (strings.eql(name, comparator)) {
                                    index = i;
                                    break;
                                }
                            }

                            if (index == names.items.len) {
                                names.items.len += 1;
                                registries.items.len += 1;
                            }
                            names.items[index] = name;
                            registries.items[index] = try this.parseRegistry(value);
                        }

                        registry_map.registries = registries.items;
                        registry_map.scopes = names.items;
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

                    if (_bun.get("lockfile")) |lockfile_expr| {
                        if (lockfile_expr.get("print")) |lockfile| {
                            try this.expect(lockfile, .e_string);
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
            }

            if (json.get("bundle")) |_bun| {
                if (comptime cmd == .DevCommand or cmd == .BuildCommand or cmd == .RunCommand or cmd == .AutoCommand or cmd == .BunCommand) {
                    if (_bun.get("saveTo")) |file| {
                        try this.expect(file, .e_string);
                        this.bunfig.node_modules_bundle_path = try file.data.e_string.string(allocator);
                    }

                    if (_bun.get("outdir")) |dir| {
                        try this.expect(dir, .e_string);
                        this.bunfig.output_dir = try dir.data.e_string.string(allocator);
                    }
                }

                if (comptime cmd == .BunCommand) {
                    if (_bun.get("logLevel")) |expr2| {
                        try this.loadLogLevel(expr2);
                    }

                    if (_bun.get("entryPoints")) |entryPoints| {
                        try this.expect(entryPoints, .e_array);
                        const items = entryPoints.data.e_array.items.slice();
                        var names = try this.allocator.alloc(string, items.len);
                        for (items) |item, i| {
                            try this.expect(item, .e_string);
                            names[i] = try item.data.e_string.string(allocator);
                        }
                        this.bunfig.entry_points = names;
                    }

                    if (_bun.get("packages")) |expr| {
                        try this.expect(expr, .e_object);
                        var valid_count: usize = 0;
                        Analytics.Features.always_bundle = true;

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
                    .factory = bun.constStrToU8(jsx_factory),
                    .fragment = bun.constStrToU8(jsx_fragment),
                    .import_source = bun.constStrToU8(jsx_import_source),
                    .runtime = jsx_runtime,
                    .development = jsx_dev,
                    .react_fast_refresh = false,
                };
            } else {
                var jsx: *Api.Jsx = &this.bunfig.jsx.?;
                if (jsx_factory.len > 0) {
                    jsx.factory = bun.constStrToU8(jsx_factory);
                }
                if (jsx_fragment.len > 0) {
                    jsx.fragment = bun.constStrToU8(jsx_fragment);
                }
                if (jsx_import_source.len > 0) {
                    jsx.import_source = bun.constStrToU8(jsx_import_source);
                }
                jsx.runtime = jsx_runtime;
                jsx.development = jsx_dev;
            }

            switch (comptime cmd) {
                .AutoCommand, .DevCommand, .BuildCommand, .BunCommand => {
                    if (json.get("publicDir")) |public_dir| {
                        try this.expect(public_dir, .e_string);
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
                // technical debt
                this.ctx.debug.macros = PackageJSON.parseMacrosJSON(allocator, expr, this.log, this.source);
                Analytics.Features.macros = true;
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

                        for (array.items.slice()) |item, i| {
                            try this.expect(item, .e_string);
                            externals[i] = try item.data.e_string.string(allocator);
                        }

                        this.bunfig.external = externals;
                    },
                    else => try this.addError(expr.loc, "Expected string or array"),
                }
            }

            if (json.get("framework")) |expr| {
                try this.expect(expr, .e_string);
                this.bunfig.framework = Api.FrameworkConfig{
                    .package = expr.asString(allocator).?,
                };
            }

            if (json.get("loader")) |expr| {
                try this.expect(expr, .e_object);
                const properties = expr.data.e_object.properties.slice();
                var loader_names = try this.allocator.alloc(string, properties.len);
                var loader_values = try this.allocator.alloc(Api.Loader, properties.len);

                for (properties) |item, i| {
                    var key = item.key.?.asString(allocator).?;
                    if (key.len == 0) continue;
                    if (key[0] != '.') {
                        try this.addError(item.key.?.loc, "file extension must start with a dot");
                    }
                    var value = item.value.?;
                    try this.expect(value, .e_string);

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

            Analytics.Features.bunfig = true;
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

    pub fn parse(allocator: std.mem.Allocator, source: logger.Source, ctx: *Command.Context, comptime cmd: Command.Tag) !void {
        const log_count = ctx.log.errors + ctx.log.warnings;

        var expr = if (strings.eqlComptime(source.path.name.ext[1..], "toml")) TOML.parse(&source, ctx.log, allocator) catch |err| {
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
