const std = @import("std");
const _global = @import("./global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const URL = @import("./query_string_map.zig").URL;
const C = _global.C;
const options = @import("./options.zig");
const logger = @import("./logger.zig");
const cache = @import("./cache.zig");
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

        pub fn parse(this: *Parser, comptime cmd: Command.Tag) !void {
            const json = this.json;
            var allocator = this.allocator;

            if (json.data != .e_object) {
                try this.addError(json.loc, "bunfig expects an object { } at the root");
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

            if (comptime cmd == .DevCommand or cmd == .AutoCommand) {
                if (json.get("dev")) |expr| {
                    if (expr.get("disableBunJS")) |disable| {
                        this.ctx.debug.fallback_only = disable.asBool() orelse false;
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

            if (json.get("bundle")) |bun| {
                if (comptime cmd == .DevCommand or cmd == .BuildCommand or cmd == .RunCommand or cmd == .AutoCommand or cmd == .BunCommand) {
                    if (bun.get("saveTo")) |file| {
                        try this.expect(file, .e_string);
                        this.bunfig.node_modules_bundle_path = try file.data.e_string.string(allocator);
                    }
                }

                if (comptime cmd == .BunCommand) {
                    if (bun.get("entryPoints")) |entryPoints| {
                        try this.expect(entryPoints, .e_array);
                        const items = entryPoints.data.e_array.items.slice();
                        var names = try this.allocator.alloc(string, items.len);
                        for (items) |item, i| {
                            try this.expect(item, .e_string);
                            names[i] = try item.data.e_string.string(allocator);
                        }
                        this.bunfig.entry_points = names;
                    }

                    if (bun.get("packages")) |expr| {
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

            switch (comptime cmd) {
                .AutoCommand, .DevCommand, .BuildCommand, .BunCommand => {
                    if (json.get("publicDir")) |public_dir| {
                        try this.expect(public_dir, .e_string);
                        this.bunfig.router = Api.RouteConfig{ .extensions = &.{}, .dir = &.{}, .static_dir = try public_dir.data.e_string.string(allocator) };
                    }
                },
                else => {},
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

            if (json.get("logLevel")) |expr| {
                try this.expect(expr, .e_string);
                const Matcher = strings.ExactSizeMatcher(8);

                this.bunfig.log_level = switch (Matcher.match(expr.asString(allocator).?)) {
                    Matcher.case("debug") => Api.MessageLevel.debug,
                    Matcher.case("error") => Api.MessageLevel.err,
                    Matcher.case("warn") => Api.MessageLevel.warn,
                    else => {
                        try this.addError(expr.loc, "Invalid log level, must be one of debug, error, or warn");
                        unreachable;
                    },
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
