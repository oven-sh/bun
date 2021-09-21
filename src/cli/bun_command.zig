const std = @import("std");
const Command = @import("../cli.zig").Command;
usingnamespace @import("../global.zig");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const json_parser = @import("../json_parser.zig");
const js_printer = @import("../js_printer.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
usingnamespace @import("../ast/base.zig");
usingnamespace @import("../defines.zig");
const panicky = @import("../panic_handler.zig");
const sync = @import(".././sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import(".././resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import(".././javascript/jsc/config.zig").configureTransformOptionsForBun;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const DotEnv = @import("../env_loader.zig");

const fs = @import("../fs.zig");
const Router = @import("../router.zig");

var wait_group: sync.WaitGroup = undefined;
const ServerBundleGeneratorThread = struct {
    inline fn _generate(
        logs: *logger.Log,
        env_loader_: *DotEnv.Loader,
        allocator_: *std.mem.Allocator,
        transform_args: Api.TransformOptions,
        _filepath: [*:0]const u8,
        server_conf: Api.LoadedFramework,
        route_conf_: ?Api.LoadedRouteConfig,
        router: ?Router,
    ) !void {
        var server_bundler = try bundler.ServeBundler.init(
            allocator_,
            logs,
            try configureTransformOptionsForBun(allocator_, transform_args),
            null,
            env_loader_,
        );
        server_bundler.options.jsx.supports_fast_refresh = false;
        server_bundler.configureLinker();
        server_bundler.router = router;
        server_bundler.configureDefines() catch |err| {
            Output.prettyErrorln("<r><red>{s}<r> loading --define or .env values for node_modules.server.bun\n", .{@errorName(err)});
            return err;
        };

        _ = try bundler.ServeBundler.GenerateNodeModuleBundle.generate(
            &server_bundler,
            allocator_,
            server_conf,
            route_conf_,
            _filepath,
        );
        std.mem.doNotOptimizeAway(&server_bundler);
    }
    pub fn generate(
        logs: *logger.Log,
        env_loader_: *DotEnv.Loader,
        transform_args: Api.TransformOptions,
        _filepath: [*:0]const u8,
        server_conf: Api.LoadedFramework,
        route_conf_: ?Api.LoadedRouteConfig,
        router: ?Router,
    ) void {
        if (FeatureFlags.parallel_bun) {
            try alloc.setup(default_allocator);
            var stdout_ = std.io.getStdOut();
            var stderr_ = std.io.getStdErr();
            var output_source = Output.Source.init(stdout_, stderr_);
            Output.Source.set(&output_source);
        }

        defer Output.flush();
        defer {
            if (FeatureFlags.parallel_bun) {
                wait_group.done();
            }
        }

        _generate(logs, env_loader_, default_allocator, transform_args, _filepath, server_conf, route_conf_, router) catch return;
    }
};

pub const BunCommand = struct {
    pub fn exec(
        ctx: Command.Context,
    ) !void {
        var allocator = ctx.allocator;
        var log = ctx.log;

        var this_bundler = try bundler.ServeBundler.init(allocator, log, ctx.args, null, null);
        this_bundler.configureLinker();
        var filepath: [*:0]const u8 = "node_modules.bun";
        var server_bundle_filepath: [*:0]const u8 = "node_modules.server.bun";
        try this_bundler.configureRouter(true);

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
        wait_group = sync.WaitGroup.init();
        var server_bundler_generator_thread: ?std.Thread = null;
        var generated_server = false;
        if (this_bundler.options.framework) |*framework| {
            if (framework.toAPI(allocator, this_bundler.fs.top_level_dir) catch null) |_server_conf| {
                if (FeatureFlags.parallel_bun) {
                    wait_group.add();
                    server_bundler_generator_thread = try std.Thread.spawn(
                        .{},
                        ServerBundleGeneratorThread.generate,
                        .{
                            log,
                            env_loader,
                            ctx.args,
                            server_bundle_filepath,
                            _server_conf,
                            loaded_route_config,
                            this_bundler.router,
                        },
                    );
                    generated_server = true;
                } else {
                    ServerBundleGeneratorThread.generate(
                        log,
                        env_loader,
                        ctx.args,
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
        }

        defer {
            if (server_bundler_generator_thread) |thread| {
                thread.join();
            }
        }

        {
            // Always generate the client-only bundle
            // we can revisit this decision if people ask
            var node_modules_ = try bundler.ServeBundler.GenerateNodeModuleBundle.generate(
                &this_bundler,
                allocator,
                loaded_framework,
                loaded_route_config,
                filepath,
            );

            if (server_bundler_generator_thread) |thread| {
                wait_group.wait();
            }

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
                    Output.prettyln(indent ++ "<d>{d:6}ms elapsed", .{@intCast(u32, elapsed)});

                    if (generated_server) {
                        Output.prettyln(indent ++ "<r>Saved to ./{s}, ./{s}", .{ filepath, server_bundle_filepath });
                    } else {
                        Output.prettyln(indent ++ "<r>Saved to ./{s}", .{filepath});
                    }

                    try log.printForLogLevel(Output.errorWriter());
                }
            } else {
                try log.printForLogLevel(Output.errorWriter());
            }
        }
    }
};
