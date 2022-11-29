const std = @import("std");
const Command = @import("../cli.zig").Command;
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

const lex = @import("../js_lexer.zig");
const logger = @import("bun").logger;

const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");

const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const GenerateNodeModuleBundle = @import("../bundler/generate_node_modules_bundle.zig");
const DotEnv = @import("../env_loader.zig");

const fs = @import("../fs.zig");
const Router = @import("../router.zig");

var estimated_input_lines_of_code_: usize = undefined;
const ServerBundleGeneratorThread = struct {
    inline fn _generate(
        logs: *logger.Log,
        env_loader_: *DotEnv.Loader,
        allocator_: std.mem.Allocator,
        ctx: Command.Context,
        _filepath: [*:0]const u8,
        server_conf: Api.LoadedFramework,
        route_conf_: ?Api.LoadedRouteConfig,
        router: ?Router,
    ) !void {
        var server_bundler = try bundler.Bundler.init(
            allocator_,
            logs,
            try configureTransformOptionsForBun(allocator_, ctx.args),
            null,
            env_loader_,
        );
        server_bundler.configureLinker();
        server_bundler.options.jsx.supports_fast_refresh = false;

        server_bundler.router = router;
        server_bundler.configureDefines() catch |err| {
            Output.prettyErrorln("<r><red>{s}<r> loading --define or .env values for node_modules.server.bun\n", .{@errorName(err)});
            return err;
        };

        if (ctx.debug.macros) |macros| {
            server_bundler.options.macro_remap = macros;
        }

        var estimated_input_lines_of_code: usize = 0;
        _ = try GenerateNodeModuleBundle.generate(
            &server_bundler,
            allocator_,
            server_conf,
            route_conf_,
            _filepath,
            &estimated_input_lines_of_code,
            ctx.debug.package_bundle_map,
        );
        std.mem.doNotOptimizeAway(&server_bundler);
    }
    pub fn generate(
        logs: *logger.Log,
        env_loader_: *DotEnv.Loader,
        ctx: Command.Context,
        _filepath: [*:0]const u8,
        server_conf: Api.LoadedFramework,
        route_conf_: ?Api.LoadedRouteConfig,
        router: ?Router,
    ) void {
        defer Output.flush();

        _generate(logs, env_loader_, default_allocator, ctx, _filepath, server_conf, route_conf_, router) catch return;
    }
};

pub const BunCommand = struct {
    pub fn exec(
        ctx: Command.Context,
    ) !void {
        Global.configureAllocator(.{ .long_running = true });
        var allocator = ctx.allocator;
        var log = ctx.log;
        estimated_input_lines_of_code_ = 0;

        var this_bundler = try bundler.Bundler.init(allocator, log, ctx.args, null, null);
        this_bundler.configureLinker();
        var filepath: [*:0]const u8 = "node_modules.bun";
        var server_bundle_filepath: [*:0]const u8 = "node_modules.server.bun";

        // This step is optional
        // If it fails for any reason, ignore it and continue bundling
        // This is partially a workaround for the 'error.MissingRoutesDir' error
        this_bundler.configureRouter(true) catch {
            this_bundler.options.routes.routes_enabled = false;
            this_bundler.options.framework = null;
            if (this_bundler.router) |*router| {
                router.config.routes_enabled = false;
                router.config.single_page_app_routing = false;
                router.config.static_dir_enabled = false;
                this_bundler.router = null;
            }
            this_bundler.options.node_modules_bundle = null;
            this_bundler.options.node_modules_bundle_pretty_path = "";
            this_bundler.options.node_modules_bundle_url = "";
        };

        if (ctx.debug.macros) |macros| {
            this_bundler.options.macro_remap = macros;
        }

        var loaded_route_config: ?Api.LoadedRouteConfig = brk: {
            if (this_bundler.options.routes.routes_enabled) {
                break :brk this_bundler.options.routes.toAPI();
            }
            break :brk null;
        };
        var loaded_framework: ?Api.LoadedFramework = brk: {
            if (this_bundler.options.framework) |*conf| {
                break :brk try conf.toAPI(allocator, this_bundler.fs.top_level_dir);
            }
            break :brk null;
        };
        var env_loader = this_bundler.env;

        if (ctx.debug.dump_environment_variables) {
            this_bundler.dumpEnvironmentVariables();
            return;
        }

        if (ctx.debug.dump_limits) {
            fs.FileSystem.printLimits();
            Global.exit(0);
            return;
        }

        var generated_server = false;
        if (this_bundler.options.framework) |*framework| {
            if (framework.toAPI(allocator, this_bundler.fs.top_level_dir) catch null) |_server_conf| {
                ServerBundleGeneratorThread.generate(
                    log,
                    env_loader,
                    ctx,
                    server_bundle_filepath,
                    _server_conf,
                    loaded_route_config,
                    this_bundler.router,
                );
                generated_server = true;

                if (log.msgs.items.len > 0) {
                    try log.printForLogLevel(Output.errorWriter());
                    log.* = logger.Log.init(allocator);
                    Output.flush();
                }
            }
        }

        {

            // Always generate the client-only bundle
            // we can revisit this decision if people ask
            var node_modules_ = try GenerateNodeModuleBundle.generate(
                &this_bundler,
                allocator,
                loaded_framework,
                loaded_route_config,
                filepath,
                &estimated_input_lines_of_code_,
                ctx.debug.package_bundle_map,
            );

            const estimated_input_lines_of_code = estimated_input_lines_of_code_;

            if (node_modules_) |node_modules| {
                if (log.errors > 0) {
                    try log.printForLogLevel(Output.errorWriter());
                } else {
                    var elapsed = @divTrunc(std.time.nanoTimestamp() - ctx.start_time, @as(i128, std.time.ns_per_ms));
                    const print_summary = !(ctx.args.no_summary orelse false);
                    if (print_summary) {
                        var bundle = NodeModuleBundle.init(node_modules, allocator);
                        bundle.printSummary();
                    }
                    const indent = comptime " ";

                    switch (estimated_input_lines_of_code) {
                        0...99999 => {
                            if (generated_server) {
                                Output.prettyln(indent ++ "<d>{d:<5} LOC parsed x2", .{estimated_input_lines_of_code});
                            } else {
                                Output.prettyln(indent ++ "<d>{d:<5} LOC parsed", .{estimated_input_lines_of_code});
                            }
                        },
                        else => {
                            const formatted_loc: f32 = @floatCast(f32, @intToFloat(f128, estimated_input_lines_of_code) / 1000);
                            if (generated_server) {
                                Output.prettyln(indent ++ "<d>{d:<5.2}k LOC parsed x2", .{formatted_loc});
                            } else {
                                Output.prettyln(indent ++ "<d>{d:<5.2}k LOC parsed", .{
                                    formatted_loc,
                                });
                            }
                        },
                    }

                    Output.prettyln(indent ++ "<d>{d:6}ms elapsed", .{@intCast(u32, elapsed)});

                    if (generated_server) {
                        Output.prettyln(indent ++ "<r>Saved to ./{s}, ./{s}", .{ filepath, server_bundle_filepath });
                    } else {
                        Output.prettyln(indent ++ "<r>Saved to ./{s}", .{filepath});
                    }

                    Output.flush();

                    try log.printForLogLevel(Output.errorWriter());
                }
            } else {
                try log.printForLogLevel(Output.errorWriter());
            }
        }
    }
};
