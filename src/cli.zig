const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const constStrToU8 = bun.constStrToU8;
const FeatureFlags = bun.FeatureFlags;
const C = bun.C;
const root = @import("root");
const std = @import("std");
const lex = bun.js_lexer;
const logger = @import("root").bun.logger;
const options = @import("options.zig");
const js_parser = bun.js_parser;
const json_parser = bun.JSON;
const js_printer = bun.js_printer;
const js_ast = bun.JSAst;
const linker = @import("linker.zig");

const sync = @import("./sync.zig");
const Api = @import("api/schema.zig").Api;
const resolve_path = @import("./resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("./bun.js/config.zig").configureTransformOptionsForBun;
const clap = @import("root").bun.clap;
const BunJS = @import("./bun_js.zig");
const Install = @import("./install/install.zig");
const bundler = bun.bundler;
const DotEnv = @import("./env_loader.zig");

const fs = @import("fs.zig");
const Router = @import("./router.zig");

const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;

const MacroMap = @import("./resolver/package_json.zig").MacroMap;
const TestCommand = @import("./cli/test_command.zig").TestCommand;
const Reporter = @import("./report.zig");
pub var start_time: i128 = undefined;
const Bunfig = @import("./bunfig.zig").Bunfig;

pub const Cli = struct {
    var wait_group: sync.WaitGroup = undefined;
    var log_: logger.Log = undefined;
    pub fn startTransform(_: std.mem.Allocator, _: Api.TransformOptions, _: *logger.Log) anyerror!void {}
    pub fn start(allocator: std.mem.Allocator, _: anytype, _: anytype, comptime MainPanicHandler: type) void {
        start_time = std.time.nanoTimestamp();
        log_ = logger.Log.init(allocator);

        var log = &log_;

        var panicker = MainPanicHandler.init(log);
        MainPanicHandler.Singleton = &panicker;

        Command.start(allocator, log) catch |err| {
            switch (err) {
                error.MissingEntryPoint => {
                    Output.prettyErrorln("<r><red>MissingEntryPoint<r> what do you want to build?\n\n<d>Example:\n\n<r>  <b><cyan>bun build ./src/index.ts<r>\n\n  <b><cyan>bun build --minify --outdir=out ./index.jsx ./lib/worker.ts<r>\n", .{});
                    Global.exit(1);
                },
                else => {
                    // Always dump the logs
                    if (Output.enable_ansi_colors_stderr) {
                        log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
                    } else {
                        log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
                    }

                    Reporter.globalError(err, @errorReturnTrace());
                },
            }
        };
    }

    pub var cmd: ?Command.Tag = null;
};

const LoaderMatcher = strings.ExactSizeMatcher(4);
const ColonListType = @import("./cli/colon_list_type.zig").ColonListType;
pub const LoaderColonList = ColonListType(Api.Loader, Arguments.loader_resolver);
pub const DefineColonList = ColonListType(string, Arguments.noop_resolver);
fn invalidTarget(diag: *clap.Diagnostic, _target: []const u8) noreturn {
    @setCold(true);
    diag.name.long = "--target";
    diag.arg = _target;
    diag.report(Output.errorWriter(), error.InvalidTarget) catch {};
    std.process.exit(1);
}
pub const Arguments = struct {
    pub fn loader_resolver(in: string) !Api.Loader {
        const option_loader = options.Loader.fromString(in) orelse return error.InvalidLoader;
        return option_loader.toAPI();
    }

    pub fn noop_resolver(in: string) !string {
        return in;
    }

    pub fn fileReadError(err: anyerror, stderr: anytype, filename: string, kind: string) noreturn {
        stderr.writer().print("Error reading file \"{s}\" for {s}: {s}", .{ filename, kind, @errorName(err) }) catch {};
        std.process.exit(1);
    }

    pub fn readFile(
        allocator: std.mem.Allocator,
        cwd: string,
        filename: string,
    ) ![]u8 {
        var paths = [_]string{ cwd, filename };
        const outpath = try std.fs.path.resolve(allocator, &paths);
        defer allocator.free(outpath);
        var file = try std.fs.openFileAbsolute(outpath, std.fs.File.OpenFlags{ .mode = .read_only });
        defer file.close();
        const stats = try file.stat();
        return try file.readToEndAlloc(allocator, stats.size);
    }

    pub fn resolve_jsx_runtime(str: string) !Api.JsxRuntime {
        if (strings.eqlComptime(str, "automatic")) {
            return Api.JsxRuntime.automatic;
        } else if (strings.eqlComptime(str, "fallback") or strings.eqlComptime(str, "classic")) {
            return Api.JsxRuntime.classic;
        } else if (strings.eqlComptime(str, "solid")) {
            return Api.JsxRuntime.solid;
        } else {
            return error.InvalidJSXRuntime;
        }
    }

    pub const ParamType = clap.Param(clap.Help);

    const shared_public_params = [_]ParamType{
        clap.parseParam("-h, --help                        Display this help and exit.") catch unreachable,
        clap.parseParam("-b, --bun                         Force a script or package to use Bun.js instead of Node.js (via symlinking node)") catch unreachable,
        clap.parseParam("--cwd <STR>                       Absolute path to resolve files & entry points from. This just changes the process' cwd.") catch unreachable,
        clap.parseParam("-c, --config <PATH>?              Config file to load bun from (e.g. -c bunfig.toml") catch unreachable,
        clap.parseParam("--extension-order <STR>...        Defaults to: .tsx,.ts,.jsx,.js,.json ") catch unreachable,
        clap.parseParam("--jsx-factory <STR>               Changes the function called when compiling JSX elements using the classic JSX runtime") catch unreachable,
        clap.parseParam("--jsx-fragment <STR>              Changes the function called when compiling JSX fragments") catch unreachable,
        clap.parseParam("--jsx-import-source <STR>         Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: \"react\"") catch unreachable,
        clap.parseParam("--jsx-production                  Use jsx instead of jsxDEV (default) for the automatic runtime") catch unreachable,
        clap.parseParam("--jsx-runtime <STR>               \"automatic\" (default) or \"classic\"") catch unreachable,
        clap.parseParam("-r, --preload <STR>...            Import a module before other modules are loaded") catch unreachable,
        clap.parseParam("--main-fields <STR>...            Main fields to lookup in package.json. Defaults to --target dependent") catch unreachable,
        clap.parseParam("--no-summary                      Don't print a summary (when generating .bun)") catch unreachable,
        clap.parseParam("-v, --version                     Print version and exit") catch unreachable,
        clap.parseParam("--tsconfig-override <STR>         Load tsconfig from path instead of cwd/tsconfig.json") catch unreachable,
        clap.parseParam("-d, --define <STR>...             Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:\"development\". Values are parsed as JSON.") catch unreachable,
        clap.parseParam("-e, --external <STR>...           Exclude module from transpilation (can use * wildcards). ex: -e react") catch unreachable,
        clap.parseParam("-l, --loader <STR>...             Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi") catch unreachable,
        clap.parseParam("-u, --origin <STR>                Rewrite import URLs to start with --origin. Default: \"\"") catch unreachable,
        clap.parseParam("-p, --port <STR>                  Port to serve bun's dev server on. Default: \"3000\"") catch unreachable,
        clap.parseParam("--minify                          Minify (experimental)") catch unreachable,
        clap.parseParam("--minify-syntax                   Minify syntax and inline data (experimental)") catch unreachable,
        clap.parseParam("--minify-whitespace               Minify whitespace (experimental)") catch unreachable,
        clap.parseParam("--minify-identifiers              Minify identifiers") catch unreachable,
        clap.parseParam("--target <STR>                    The intended execution environment for the bundle. \"browser\", \"bun\" or \"node\"") catch unreachable,
        clap.parseParam("<POS>...                          ") catch unreachable,
    };

    // note: we are keeping --port and --origin as it can be reused for bun
    // build and elsewhere
    pub const not_bun_dev_flags = [_]ParamType{
        clap.parseParam("--hot                             Enable auto reload in bun's JavaScript runtime") catch unreachable,
        clap.parseParam("--watch                           Automatically restart bun's JavaScript runtime on file change") catch unreachable,
        clap.parseParam("--no-install                      Disable auto install in bun's JavaScript runtime") catch unreachable,
        clap.parseParam("-i                                Automatically install dependencies and use global cache in bun's runtime, equivalent to --install=fallback") catch unreachable,
        clap.parseParam("--install <STR>                   Install dependencies automatically when no node_modules are present, default: \"auto\". \"force\" to ignore node_modules, fallback to install any missing") catch unreachable,
        clap.parseParam("--prefer-offline                  Skip staleness checks for packages in bun's JavaScript runtime and resolve from disk") catch unreachable,
        clap.parseParam("--prefer-latest                   Use the latest matching versions of packages in bun's JavaScript runtime, always checking npm") catch unreachable,
        clap.parseParam("--silent                          Don't repeat the command for bun run") catch unreachable,
    };

    const public_params = shared_public_params ++ not_bun_dev_flags;

    const debug_params = [_]ParamType{
        clap.parseParam("--dump-environment-variables    Dump environment variables from .env and process as JSON and quit. Useful for debugging") catch unreachable,
        clap.parseParam("--dump-limits                   Dump system limits. Useful for debugging") catch unreachable,
    };

    pub const dev_params = [_]ParamType{
        clap.parseParam("--disable-bun.js                  Disable bun.js from loading in the dev server") catch unreachable,
        clap.parseParam("--disable-react-fast-refresh      Disable React Fast Refresh") catch unreachable,
        clap.parseParam("--bunfile <STR>                   Use a .bun file (default: node_modules.bun)") catch unreachable,
        clap.parseParam("--server-bunfile <STR>            Use a .server.bun file (default: node_modules.server.bun)") catch unreachable,
        clap.parseParam("--public-dir <STR>                Top-level directory for .html files, fonts or anything external. Defaults to \"<cwd>/public\", to match create-react-app and Next.js") catch unreachable,
        clap.parseParam("--disable-hmr                     Disable Hot Module Reloading (disables fast refresh too) in bun dev") catch unreachable,
        clap.parseParam("--use <STR>                       Choose a framework, e.g. \"--use next\". It checks first for a package named \"bun-framework-packagename\" and then \"packagename\".") catch unreachable,
    } ++ shared_public_params ++ debug_params;

    pub const params = public_params ++ debug_params;

    const build_only_params = [_]ParamType{
        clap.parseParam("--outdir <STR>                   Default to \"dist\" if multiple files") catch unreachable,
        clap.parseParam("--outfile <STR>                  Write to a file") catch unreachable,
        clap.parseParam("--root <STR>                     Root directory used for multiple entry points") catch unreachable,
        clap.parseParam("--splitting                      Enable code splitting") catch unreachable,
        // clap.parseParam("--manifest <STR>                 Write JSON manifest") catch unreachable,
        // clap.parseParam("--public-path <STR>              A prefix to be appended to any import paths in bundled code") catch unreachable,
        clap.parseParam("--sourcemap <STR>?               Build with sourcemaps - 'inline', 'external', or 'none'") catch unreachable,
        clap.parseParam("--entry-naming <STR>             Customize entry point filenames. Defaults to \"[dir]/[name].[ext]\"") catch unreachable,
        clap.parseParam("--chunk-naming <STR>             Customize chunk filenames. Defaults to \"[name]-[hash].[ext]\"") catch unreachable,
        clap.parseParam("--asset-naming <STR>             Customize asset filenames. Defaults to \"[name]-[hash].[ext]\"") catch unreachable,
        clap.parseParam("--server-components              Enable React Server Components (experimental)") catch unreachable,
        clap.parseParam("--transform                      Single file transform, do not bundle") catch unreachable,
    };

    // TODO: update test completions
    const test_only_params = [_]ParamType{
        clap.parseParam("--update-snapshots               Update snapshot files") catch unreachable,
        clap.parseParam("--rerun-each <NUMBER>            Re-run each test file <NUMBER> times, helps catch certain bugs") catch unreachable,
    };

    const build_params_public = public_params ++ build_only_params;
    pub const build_params = build_params_public ++ debug_params;
    pub const test_params = params ++ test_only_params;

    fn printVersionAndExit() noreturn {
        @setCold(true);
        Output.writer().writeAll(Global.package_json_version ++ "\n") catch {};
        Global.exit(0);
    }

    pub fn loadConfigPath(allocator: std.mem.Allocator, auto_loaded: bool, config_path: [:0]const u8, ctx: *Command.Context, comptime cmd: Command.Tag) !void {
        var config_file = std.fs.File{
            .handle = std.os.openZ(config_path, std.os.O.RDONLY, 0) catch |err| {
                if (auto_loaded) return;
                Output.prettyErrorln("<r><red>error<r>: {s} opening config \"{s}\"", .{
                    @errorName(err),
                    config_path,
                });
                Global.exit(1);
            },
        };
        defer config_file.close();
        var contents = config_file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch |err| {
            if (auto_loaded) return;
            Output.prettyErrorln("<r><red>error<r>: {s} reading config \"{s}\"", .{
                @errorName(err),
                config_path,
            });
            Global.exit(1);
        };

        js_ast.Stmt.Data.Store.create(allocator);
        js_ast.Expr.Data.Store.create(allocator);
        defer {
            js_ast.Stmt.Data.Store.reset();
            js_ast.Expr.Data.Store.reset();
        }
        var original_level = ctx.log.level;
        defer {
            ctx.log.level = original_level;
        }
        ctx.log.level = logger.Log.Level.warn;
        try Bunfig.parse(allocator, logger.Source.initPathString(bun.asByteSlice(config_path), contents), ctx, cmd);
    }

    fn getHomeConfigPath(buf: *[bun.MAX_PATH_BYTES]u8) ?[:0]const u8 {
        if (bun.getenvZ("XDG_CONFIG_HOME") orelse bun.getenvZ("HOME")) |data_dir| {
            var paths = [_]string{".bunfig.toml"};
            return resolve_path.joinAbsStringBufZ(data_dir, buf, &paths, .auto);
        }

        return null;
    }
    pub fn loadConfig(allocator: std.mem.Allocator, user_config_path_: ?string, ctx: *Command.Context, comptime cmd: Command.Tag) !void {
        var config_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        if (comptime cmd.readGlobalConfig()) {
            if (!ctx.has_loaded_global_config) {
                ctx.has_loaded_global_config = true;

                if (getHomeConfigPath(&config_buf)) |path| {
                    try loadConfigPath(allocator, true, path, ctx, comptime cmd);
                }
            }
        }

        var config_path_: []const u8 = user_config_path_ orelse "";

        var auto_loaded: bool = false;
        if (config_path_.len == 0 and (user_config_path_ != null or
            Command.Tag.always_loads_config.get(cmd) or
            (cmd == .AutoCommand and
            // "bun"
            (ctx.positionals.len == 0 or
            // "bun file.js"
            ctx.positionals.len > 0 and options.defaultLoaders.has(std.fs.path.extension(ctx.positionals[0]))))))
        {
            config_path_ = "bunfig.toml";
            auto_loaded = true;
        }

        if (config_path_.len == 0) {
            return;
        }
        defer ctx.debug.loaded_bunfig = true;
        var config_path: [:0]u8 = undefined;
        if (config_path_[0] == '/') {
            @memcpy(&config_buf, config_path_.ptr, config_path_.len);
            config_buf[config_path_.len] = 0;
            config_path = config_buf[0..config_path_.len :0];
        } else {
            if (ctx.args.absolute_working_dir == null) {
                var secondbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var cwd = std.os.getcwd(&secondbuf) catch return;
                ctx.args.absolute_working_dir = try allocator.dupe(u8, cwd);
            }
            var parts = [_]string{ ctx.args.absolute_working_dir.?, config_path_ };
            config_path_ = resolve_path.joinAbsStringBuf(
                ctx.args.absolute_working_dir.?,
                &config_buf,
                &parts,
                .auto,
            );
            config_buf[config_path_.len] = 0;
            config_path = config_buf[0..config_path_.len :0];
        }

        try loadConfigPath(allocator, auto_loaded, config_path, ctx, comptime cmd);
    }

    pub fn loadConfigWithCmdArgs(
        comptime cmd: Command.Tag,
        allocator: std.mem.Allocator,
        args: clap.Args(clap.Help, cmd.params()),
        ctx: *Command.Context,
    ) !void {
        return try loadConfig(allocator, args.option("--config"), ctx, comptime cmd);
    }

    pub fn parse(allocator: std.mem.Allocator, ctx: *Command.Context, comptime cmd: Command.Tag) !Api.TransformOptions {
        var diag = clap.Diagnostic{};
        const params_to_use = comptime cmd.params();

        var args = clap.parse(clap.Help, params_to_use, .{
            .diagnostic = &diag,
            .allocator = allocator,
            .stop_after_positional_at = if (cmd == .RunCommand) 2 else if (cmd == .AutoCommand)
                1
            else
                0,
        }) catch |err| {
            // Report useful error and exit
            clap.help(Output.errorWriter(), params_to_use) catch {};
            Output.errorWriter().writeAll("\n") catch {};
            diag.report(Output.errorWriter(), err) catch {};
            Global.exit(1);
        };

        if (args.flag("--version")) {
            printVersionAndExit();
        }

        var cwd: []u8 = undefined;
        if (args.option("--cwd")) |cwd_| {
            cwd = brk: {
                var outbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const out = std.os.realpath(cwd_, &outbuf) catch |err| {
                    Output.prettyErrorln("error resolving --cwd: {s}", .{@errorName(err)});
                    Global.exit(1);
                };
                break :brk try allocator.dupe(u8, out);
            };
        } else {
            cwd = try std.process.getCwdAlloc(allocator);
        }

        if (cmd == .TestCommand) {
            ctx.test_options.update_snapshots = args.flag("--update-snapshots");
            if (args.option("--rerun-each")) |repeat_count| {
                if (repeat_count.len > 0) {
                    ctx.test_options.repeat_count = std.fmt.parseInt(u32, repeat_count, 10) catch |e| {
                        Output.prettyErrorln("--rerun-each expects a number: {s}", .{@errorName(e)});
                        Global.exit(1);
                    };
                }
            }
        }

        ctx.args.absolute_working_dir = cwd;
        ctx.positionals = args.positionals();

        if (comptime Command.Tag.loads_config.get(cmd)) {
            try loadConfigWithCmdArgs(cmd, allocator, args, ctx);
        }

        var opts: Api.TransformOptions = ctx.args;

        var defines_tuple = try DefineColonList.resolve(allocator, args.options("--define"));

        if (defines_tuple.keys.len > 0) {
            opts.define = .{
                .keys = defines_tuple.keys,
                .values = defines_tuple.values,
            };
        }

        var loader_tuple = try LoaderColonList.resolve(allocator, args.options("--loader"));

        if (loader_tuple.keys.len > 0) {
            opts.loaders = .{
                .extensions = loader_tuple.keys,
                .loaders = loader_tuple.values,
            };
        }

        if (args.options("--external").len > 0) {
            var externals = try allocator.alloc([]u8, args.options("--external").len);
            for (args.options("--external"), 0..) |external, i| {
                externals[i] = constStrToU8(external);
            }
            opts.external = externals;
        }

        opts.tsconfig_override = if (args.option("--tsconfig-override")) |ts|
            (Arguments.readFile(allocator, cwd, ts) catch |err| fileReadError(err, Output.errorStream(), ts, "tsconfig.json"))
        else
            null;

        if (args.option("--origin")) |origin| {
            opts.origin = origin;
        }

        if (args.option("--port")) |port_str| {
            opts.port = std.fmt.parseInt(u16, port_str, 10) catch return error.InvalidPort;
        }
        opts.serve = cmd == .DevCommand;
        opts.main_fields = args.options("--main-fields");
        // we never actually supported inject.
        // opts.inject = args.options("--inject");
        opts.extension_order = args.options("--extension-order");

        ctx.passthrough = args.remaining();

        opts.no_summary = args.flag("--no-summary");

        if (cmd != .DevCommand) {
            const preloads = args.options("--preload");
            if (ctx.preloads.len > 0 and preloads.len > 0) {
                var all = std.ArrayList(string).initCapacity(ctx.allocator, ctx.preloads.len + preloads.len) catch unreachable;
                all.appendSliceAssumeCapacity(ctx.preloads);
                all.appendSliceAssumeCapacity(preloads);
                ctx.preloads = all.items;
            } else if (preloads.len > 0) {
                ctx.preloads = preloads;
            }
        }

        if (opts.port != null and opts.origin == null) {
            opts.origin = try std.fmt.allocPrint(allocator, "http://localhost:{d}/", .{opts.port.?});
        }

        const print_help = args.flag("--help");
        if (print_help) {
            const params_len = if (cmd == .BuildCommand) build_params_public.len else public_params.len;
            clap.help(Output.writer(), params_to_use[0..params_len]) catch {};
            Output.prettyln("\n-------\n\n", .{});
            Output.flush();
            HelpCommand.printWithReason(.explicit);
            Global.exit(0);
        }

        ctx.debug.dump_environment_variables = args.flag("--dump-environment-variables");
        ctx.debug.dump_limits = args.flag("--dump-limits");

        // var output_dir = args.option("--outdir");
        var output_dir: ?string = null;
        const production = false;
        var output_file: ?string = null;

        const minify_flag = args.flag("--minify");
        ctx.bundler_options.minify_syntax = minify_flag or args.flag("--minify-syntax");
        ctx.bundler_options.minify_whitespace = minify_flag or args.flag("--minify-whitespace");
        ctx.bundler_options.minify_identifiers = minify_flag or args.flag("--minify-identifiers");

        if (cmd == .BuildCommand) {
            ctx.bundler_options.transform_only = args.flag("--transform");

            if (args.option("--outdir")) |outdir| {
                if (outdir.len > 0) {
                    ctx.bundler_options.outdir = outdir;
                }
            } else if (args.option("--outfile")) |outfile| {
                if (outfile.len > 0) {
                    ctx.bundler_options.outfile = outfile;
                }
            }

            if (args.option("--root")) |root_dir| {
                if (root_dir.len > 0) {
                    ctx.bundler_options.root_dir = root_dir;
                }
            }

            if (args.flag("--splitting")) {
                ctx.bundler_options.code_splitting = true;
            }

            if (args.option("--entry-naming")) |entry_naming| {
                ctx.bundler_options.entry_naming = try strings.concat(allocator, &.{ "./", entry_naming });
            }

            if (args.option("--chunk-naming")) |chunk_naming| {
                ctx.bundler_options.chunk_naming = try strings.concat(allocator, &.{ "./", chunk_naming });
            }

            if (args.option("--asset-naming")) |asset_naming| {
                ctx.bundler_options.asset_naming = try strings.concat(allocator, &.{ "./", asset_naming });
            }

            if (comptime FeatureFlags.react_server_components) {
                if (args.flag("--server-components")) {
                    ctx.bundler_options.react_server_components = true;
                }
            }

            if (args.option("--sourcemap")) |setting| {
                if (setting.len == 0 or strings.eqlComptime(setting, "inline")) {
                    opts.source_map = Api.SourceMapMode.inline_into_file;
                } else if (strings.eqlComptime(setting, "none")) {
                    opts.source_map = Api.SourceMapMode._none;
                } else if (strings.eqlComptime(setting, "external")) {
                    opts.source_map = Api.SourceMapMode.external;
                } else {
                    Output.prettyErrorln("<r><red>error<r>: Invalid sourcemap setting: \"{s}\"", .{setting});
                    Global.crash();
                }
            }
        }

        if (opts.entry_points.len == 0) {
            var entry_points = ctx.positionals;

            switch (comptime cmd) {
                .BuildCommand => {
                    if (entry_points.len > 0 and (strings.eqlComptime(
                        entry_points[0],
                        "build",
                    ) or strings.eqlComptime(entry_points[0], "bun"))) {
                        entry_points = entry_points[1..];
                    }
                },
                .DevCommand => {
                    if (entry_points.len > 0 and (strings.eqlComptime(
                        entry_points[0],
                        "dev",
                    ) or strings.eqlComptime(
                        entry_points[0],
                        "d",
                    ))) {
                        entry_points = entry_points[1..];
                    }
                },
                .RunCommand => {
                    if (entry_points.len > 0 and (strings.eqlComptime(
                        entry_points[0],
                        "run",
                    ) or strings.eqlComptime(
                        entry_points[0],
                        "r",
                    ))) {
                        entry_points = entry_points[1..];
                    }
                },
                else => {},
            }

            opts.entry_points = entry_points;
        }

        var jsx_factory = args.option("--jsx-factory");
        var jsx_fragment = args.option("--jsx-fragment");
        var jsx_import_source = args.option("--jsx-import-source");
        var jsx_runtime = args.option("--jsx-runtime");
        var jsx_production = args.flag("--jsx-production");
        const react_fast_refresh = switch (comptime cmd) {
            .DevCommand => !(args.flag("--disable-react-fast-refresh") or jsx_production),
            else => true,
        };

        if (comptime cmd == .DevCommand) {
            ctx.debug.fallback_only = ctx.debug.fallback_only or args.flag("--disable-bun.js");
            opts.disable_hmr = args.flag("--disable-hmr");
            if (args.option("--public-dir")) |public_dir| {
                if (public_dir.len > 0) {
                    opts.router = Api.RouteConfig{ .extensions = &.{}, .dir = &.{}, .static_dir = public_dir };
                }
            }

            opts.node_modules_bundle_path = args.option("--bunfile") orelse opts.node_modules_bundle_path orelse brk: {
                const node_modules_bundle_path_absolute = resolve_path.joinAbs(cwd, .auto, "node_modules.bun");

                break :brk std.fs.realpathAlloc(allocator, node_modules_bundle_path_absolute) catch null;
            };

            opts.node_modules_bundle_path_server = args.option("--server-bunfile") orelse opts.node_modules_bundle_path_server orelse brk: {
                const node_modules_bundle_path_absolute = resolve_path.joinAbs(cwd, .auto, "node_modules.server.bun");

                break :brk std.fs.realpathAlloc(allocator, node_modules_bundle_path_absolute) catch null;
            };

            if (args.option("--use")) |entry| {
                opts.framework = Api.FrameworkConfig{
                    .package = entry,
                    .development = !production,
                };
            }
        } else {
            if (args.flag("--hot")) {
                ctx.debug.hot_reload = .hot;
            } else if (args.flag("--watch")) {
                ctx.debug.hot_reload = .watch;
                bun.auto_reload_on_crash = true;
            }

            ctx.debug.offline_mode_setting = if (args.flag("--prefer-offline"))
                Bunfig.OfflineMode.offline
            else if (args.flag("--prefer-latest"))
                Bunfig.OfflineMode.latest
            else
                Bunfig.OfflineMode.online;

            if (args.flag("--no-install")) {
                ctx.debug.global_cache = .disable;
            } else if (args.flag("-i")) {
                ctx.debug.global_cache = .fallback;
            } else if (args.option("--install")) |enum_value| {
                // -i=auto --install=force, --install=disable
                if (options.GlobalCache.Map.get(enum_value)) |result| {
                    ctx.debug.global_cache = result;
                    // -i, --install
                } else if (enum_value.len == 0) {
                    ctx.debug.global_cache = options.GlobalCache.force;
                } else {
                    Output.prettyErrorln("Invalid value for --install: \"{s}\". Must be either \"auto\", \"fallback\", \"force\", or \"disable\"\n", .{enum_value});
                    Global.exit(1);
                }
            }

            ctx.debug.silent = args.flag("--silent");
        }

        // const ResolveMatcher = strings.ExactSizeMatcher(8);

        opts.resolve = Api.ResolveMode.lazy;

        switch (comptime cmd) {
            .BuildCommand => {
                // if (args.option("--resolve")) |_resolve| {
                //     switch (ResolveMatcher.match(_resolve)) {
                //         ResolveMatcher.case("disable") => {
                //             opts.resolve = Api.ResolveMode.disable;
                //         },
                //         ResolveMatcher.case("bundle") => {
                //             opts.resolve = Api.ResolveMode.bundle;
                //         },
                //         ResolveMatcher.case("dev") => {
                //             opts.resolve = Api.ResolveMode.dev;
                //         },
                //         ResolveMatcher.case("lazy") => {
                //             opts.resolve = Api.ResolveMode.lazy;
                //         },
                //         else => {
                //             diag.name.long = "--resolve";
                //             diag.arg = _resolve;
                //             try diag.report(Output.errorWriter(), error.InvalidResolveOption);
                //             std.process.exit(1);
                //         },
                //     }
                // }
            },
            else => {},
        }

        const TargetMatcher = strings.ExactSizeMatcher(8);

        if (args.option("--target")) |_target| {
            opts.target = opts.target orelse switch (TargetMatcher.match(_target)) {
                TargetMatcher.case("browser") => Api.Target.browser,
                TargetMatcher.case("node") => Api.Target.node,
                TargetMatcher.case("macro") => if (cmd == .BuildCommand) Api.Target.bun_macro else Api.Target.bun,
                TargetMatcher.case("bun") => Api.Target.bun,
                else => invalidTarget(&diag, _target),
            };

            ctx.debug.run_in_bun = opts.target.? == .bun;
        }

        ctx.debug.run_in_bun = args.flag("--bun") or ctx.debug.run_in_bun;

        if (jsx_factory != null or
            jsx_fragment != null or
            jsx_import_source != null or
            jsx_runtime != null or
            jsx_production or !react_fast_refresh)
        {
            var default_factory = "".*;
            var default_fragment = "".*;
            var default_import_source = "".*;
            if (opts.jsx == null) {
                opts.jsx = Api.Jsx{
                    .factory = constStrToU8(jsx_factory orelse &default_factory),
                    .fragment = constStrToU8(jsx_fragment orelse &default_fragment),
                    .import_source = constStrToU8(jsx_import_source orelse &default_import_source),
                    .runtime = if (jsx_runtime != null) try resolve_jsx_runtime(jsx_runtime.?) else Api.JsxRuntime.automatic,
                    .development = !jsx_production,
                    .react_fast_refresh = react_fast_refresh,
                };
            } else {
                opts.jsx = Api.Jsx{
                    .factory = constStrToU8(jsx_factory orelse opts.jsx.?.factory),
                    .fragment = constStrToU8(jsx_fragment orelse opts.jsx.?.fragment),
                    .import_source = constStrToU8(jsx_import_source orelse opts.jsx.?.import_source),
                    .runtime = if (jsx_runtime != null) try resolve_jsx_runtime(jsx_runtime.?) else opts.jsx.?.runtime,
                    .development = !jsx_production,
                    .react_fast_refresh = react_fast_refresh,
                };
            }
        }

        if (cmd == .BuildCommand) {
            if (opts.entry_points.len == 0 and opts.framework == null and opts.node_modules_bundle_path == null) {
                return error.MissingEntryPoint;
            }
        }

        if (opts.log_level) |log_level| {
            logger.Log.default_log_level = switch (log_level) {
                .debug => logger.Log.Level.debug,
                .err => logger.Log.Level.err,
                .warn => logger.Log.Level.warn,
                else => logger.Log.Level.err,
            };
            ctx.log.level = logger.Log.default_log_level;
        }

        opts.output_dir = output_dir;
        if (output_file != null)
            ctx.debug.output_file = output_file.?;

        return opts;
    }
};

const AutoCommand = struct {
    pub fn exec(allocator: std.mem.Allocator) !void {
        try HelpCommand.execWithReason(allocator, .invalid_command);
    }
};
const InitCommand = @import("./cli/init_command.zig").InitCommand;

pub const HelpCommand = struct {
    pub fn exec(allocator: std.mem.Allocator) !void {
        @setCold(true);
        execWithReason(allocator, .explicit);
    }

    pub const Reason = enum {
        explicit,
        invalid_command,
    };

    // someone will get mad at me for this
    pub const packages_to_remove_filler = [_]string{
        "moment",
        "underscore",
        "jquery",
        "backbone",
        "redux",
        "browserify",
        "webpack",
        "left-pad",
        "is-array",
        "babel-core",
        "@parcel/core",
    };

    pub const packages_to_add_filler = [_]string{
        "elysia",
        "@shumai/shumai",
        "hono",
        "react",
        "lyra",
        "@remix-run/dev",
        "@evan/duckdb",
        "@zarfjs/zarf",
    };

    pub fn printWithReason(comptime reason: Reason) void {
        // the spacing between commands here is intentional
        const fmt =
            \\>  <r><b><magenta>run<r>       <d>./my-script.ts<r>        Run JavaScript with bun, a package.json script, or a bin
            \\>  <b><magenta>build<r>     <d>./a.ts ./b.jsx<r>        Bundle TypeScript & JavaScript into a single file
            \\>  <b><green>x<r>         <d>bun-repl<r>              Install and execute a package bin <d>(bunx)<r>
            \\
            \\>  <b><cyan>init<r>                            Start an empty Bun project from a blank template
            \\>  <b><cyan>create<r>    <d>next ./app<r>            Create a new project from a template <d>(bun c)<r>
            \\>  <b><green>install<r>                         Install dependencies for a package.json <d>(bun i)<r>
            \\>  <b><blue>add<r>       <d>{s:<16}<r>      Add a dependency to package.json <d>(bun a)<r>
            \\>  <b><blue>link<r>                            Link an npm package globally
            \\>  remove<r>    <d>{s:<16}<r>      Remove a dependency from package.json <d>(bun rm)<r>
            \\>  unlink<r>                          Globally unlink an npm package
            \\>  pm<r>                              More commands for managing packages
            \\
            \\>  <b><green>dev<r>       <d>./a.ts ./b.jsx<r>        Start a bun (frontend) Dev Server
            \\
            \\>  <b><blue>upgrade<r>                         Get the latest version of bun
            \\>  <b><d>completions<r>                     Install shell completions for tab-completion
            \\>  <b><d>discord<r>                         Open bun's Discord server
            \\>  <b><d>help<r>                            Print this help menu
            \\
        ;

        var rand_state = std.rand.DefaultPrng.init(@intCast(u64, @max(std.time.milliTimestamp(), 0)));
        const rand = rand_state.random();
        const package_add_i = rand.uintAtMost(usize, packages_to_add_filler.len - 1);
        const package_remove_i = rand.uintAtMost(usize, packages_to_remove_filler.len - 1);

        const args = .{
            packages_to_add_filler[package_add_i],
            packages_to_remove_filler[package_remove_i],
        };

        switch (reason) {
            .explicit => Output.pretty(
                "<r><b><magenta>bun<r>: a fast bundler, transpiler, JavaScript Runtime and package manager for web software.\n\n" ++ fmt,
                args,
            ),
            .invalid_command => Output.prettyError(
                "<r><red>Uh-oh<r> not sure what to do with that command.\n\n" ++ fmt,
                args,
            ),
        }

        Output.flush();
    }
    pub fn execWithReason(_: std.mem.Allocator, comptime reason: Reason) void {
        @setCold(true);
        printWithReason(reason);

        if (reason == .invalid_command) {
            std.process.exit(1);
        }
    }
};

const AddCompletions = @import("./cli/add_completions.zig");

pub const PrintBundleCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        @setCold(true);

        const entry_point = ctx.args.entry_points[0];
        var out_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
        var stdout = std.io.getStdOut();

        var input = try std.fs.openFileAbsolute(try std.os.realpath(entry_point, &out_buffer), .{ .mode = .read_only });
        const params = comptime [_]Arguments.ParamType{
            clap.parseParam("--summary  Peek inside the .bun") catch unreachable,
        };

        var jsBundleArgs = clap.parse(clap.Help, &params, .{ .allocator = ctx.allocator }) catch {
            try NodeModuleBundle.printBundle(std.fs.File, input, @TypeOf(stdout), stdout);
            return;
        };

        if (jsBundleArgs.flag("--summary")) {
            NodeModuleBundle.printSummaryFromDisk(std.fs.File, input, @TypeOf(stdout), stdout, ctx.allocator) catch {};
            return;
        }

        try NodeModuleBundle.printBundle(std.fs.File, input, @TypeOf(stdout), stdout);
    }
};

pub const Command = struct {
    var script_name_buf: [bun.MAX_PATH_BYTES]u8 = undefined;

    pub const DebugOptions = struct {
        dump_environment_variables: bool = false,
        dump_limits: bool = false,
        fallback_only: bool = false,
        silent: bool = false,
        hot_reload: HotReload = HotReload.none,
        global_cache: options.GlobalCache = .auto,
        offline_mode_setting: ?Bunfig.OfflineMode = null,
        run_in_bun: bool = false,
        loaded_bunfig: bool = false,

        // technical debt
        macros: ?MacroMap = null,
        editor: string = "",
        package_bundle_map: bun.StringArrayHashMapUnmanaged(options.BundlePackage) = bun.StringArrayHashMapUnmanaged(options.BundlePackage){},

        test_directory: []const u8 = "",
        output_file: []const u8 = "",
    };

    pub const HotReload = enum {
        none,
        hot,
        watch,
    };

    pub const TestOptions = struct {
        update_snapshots: bool = false,
        repeat_count: u32 = 0,
    };

    pub const Context = struct {
        start_time: i128,
        args: Api.TransformOptions,
        log: *logger.Log,
        allocator: std.mem.Allocator,
        positionals: []const string = &[_]string{},
        passthrough: []const string = &[_]string{},
        install: ?*Api.BunInstall = null,

        debug: DebugOptions = DebugOptions{},
        test_options: TestOptions = TestOptions{},
        bundler_options: BundlerOptions = BundlerOptions{},

        preloads: []const string = &[_]string{},
        has_loaded_global_config: bool = false,

        pub const BundlerOptions = struct {
            outdir: []const u8 = "",
            outfile: []const u8 = "",
            root_dir: []const u8 = "",
            entry_naming: []const u8 = "[dir]/[name].[ext]",
            chunk_naming: []const u8 = "./[name]-[hash].[ext]",
            asset_naming: []const u8 = "./[name]-[hash].[ext]",
            react_server_components: bool = false,
            code_splitting: bool = false,
            transform_only: bool = false,
            minify_syntax: bool = false,
            minify_whitespace: bool = false,
            minify_identifiers: bool = false,
        };

        const _ctx = Command.Context{
            .args = std.mem.zeroes(Api.TransformOptions),
            .log = undefined,
            .start_time = 0,
            .allocator = undefined,
        };

        pub fn create(allocator: std.mem.Allocator, log: *logger.Log, comptime command: Command.Tag) anyerror!Context {
            Cli.cmd = command;
            var ctx = _ctx;
            ctx.log = log;
            ctx.start_time = start_time;
            ctx.allocator = allocator;

            if (comptime Command.Tag.uses_global_options.get(command)) {
                ctx.args = try Arguments.parse(allocator, &ctx, command);
            }

            return ctx;
        }
    };

    // std.process.args allocates!
    const ArgsIterator = struct {
        buf: [][*:0]u8 = undefined,
        i: u32 = 0,

        pub fn next(this: *ArgsIterator) ?[]const u8 {
            if (this.buf.len <= this.i) {
                return null;
            }
            const i = this.i;
            this.i += 1;
            return std.mem.span(this.buf[i]);
        }

        pub fn skip(this: *ArgsIterator) bool {
            return this.next() != null;
        }
    };

    pub fn which() Tag {
        var args_iter = ArgsIterator{ .buf = std.os.argv };
        // first one is the executable name

        const argv0 = args_iter.next() orelse return .HelpCommand;

        // symlink is argv[0]
        if (strings.endsWithComptime(argv0, "bunx"))
            return .BunxCommand;

        if (comptime Environment.isDebug) {
            if (strings.endsWithComptime(argv0, "bunx-debug"))
                return .BunxCommand;
        }

        var next_arg = ((args_iter.next()) orelse return .AutoCommand);
        while (next_arg[0] == '-') {
            next_arg = ((args_iter.next()) orelse return .AutoCommand);
        }

        const first_arg_name = next_arg;
        const RootCommandMatcher = strings.ExactSizeMatcher(16);

        return switch (RootCommandMatcher.match(first_arg_name)) {
            RootCommandMatcher.case("init") => .InitCommand,
            RootCommandMatcher.case("build"), RootCommandMatcher.case("bun") => .BuildCommand,
            RootCommandMatcher.case("discord") => .DiscordCommand,
            RootCommandMatcher.case("upgrade") => .UpgradeCommand,
            RootCommandMatcher.case("completions") => .InstallCompletionsCommand,
            RootCommandMatcher.case("getcompletes") => .GetCompletionsCommand,
            RootCommandMatcher.case("link") => .LinkCommand,
            RootCommandMatcher.case("unlink") => .UnlinkCommand,
            RootCommandMatcher.case("x") => .BunxCommand,

            RootCommandMatcher.case("i"), RootCommandMatcher.case("install") => brk: {
                for (args_iter.buf) |arg| {
                    const span = std.mem.span(arg);
                    if (span.len > 0 and (strings.eqlComptime(span, "-g") or strings.eqlComptime(span, "--global"))) {
                        break :brk Command.Tag.AddCommand;
                    }
                }

                break :brk Command.Tag.InstallCommand;
            },
            RootCommandMatcher.case("c"), RootCommandMatcher.case("create") => .CreateCommand,

            RootCommandMatcher.case(TestCommand.name), RootCommandMatcher.case(TestCommand.old_name) => .TestCommand,

            RootCommandMatcher.case("pm") => .PackageManagerCommand,

            RootCommandMatcher.case("add"), RootCommandMatcher.case("update"), RootCommandMatcher.case("a") => .AddCommand,
            RootCommandMatcher.case("r"), RootCommandMatcher.case("remove"), RootCommandMatcher.case("rm"), RootCommandMatcher.case("uninstall") => .RemoveCommand,

            RootCommandMatcher.case("run") => .RunCommand,
            RootCommandMatcher.case("d"), RootCommandMatcher.case("dev") => .DevCommand,

            RootCommandMatcher.case("help") => .HelpCommand,
            else => .AutoCommand,
        };
    }

    const default_completions_list = [_]string{
        // "build",
        "install",
        "add",
        "run",
        "link",
        "unlink",
        "remove",
        "dev",
        "create",
        "bun",
        "upgrade",
        "discord",
        "pm",
        "x",
    };

    const reject_list = default_completions_list ++ [_]string{
        "build",
        "completions",
        "help",
    };

    pub fn start(allocator: std.mem.Allocator, log: *logger.Log) !void {
        const BuildCommand = @import("./cli/build_command.zig").BuildCommand;

        const AddCommand = @import("./cli/add_command.zig").AddCommand;
        const CreateCommand = @import("./cli/create_command.zig").CreateCommand;
        const CreateListExamplesCommand = @import("./cli/create_command.zig").CreateListExamplesCommand;
        const DevCommand = @import("./cli/dev_command.zig").DevCommand;
        const DiscordCommand = @import("./cli/discord_command.zig").DiscordCommand;
        const InstallCommand = @import("./cli/install_command.zig").InstallCommand;
        const LinkCommand = @import("./cli/link_command.zig").LinkCommand;
        const UnlinkCommand = @import("./cli/unlink_command.zig").UnlinkCommand;
        const InstallCompletionsCommand = @import("./cli/install_completions_command.zig").InstallCompletionsCommand;
        const PackageManagerCommand = @import("./cli/package_manager_command.zig").PackageManagerCommand;
        const RemoveCommand = @import("./cli/remove_command.zig").RemoveCommand;
        const RunCommand = @import("./cli/run_command.zig").RunCommand;
        const ShellCompletions = @import("./cli/shell_completions.zig");

        const UpgradeCommand = @import("./cli/upgrade_command.zig").UpgradeCommand;
        const BunxCommand = @import("./cli/bunx_command.zig").BunxCommand;

        if (comptime bun.fast_debug_build_mode) {
            // _ = AddCommand;
            // _ = BuildCommand;
            // _ = CreateCommand;
            _ = CreateListExamplesCommand;
            // _ = DevCommand;
            // _ = InstallCommand;
            // _ = LinkCommand;
            // _ = UnlinkCommand;
            // _ = InstallCompletionsCommand;
            // _ = PackageManagerCommand;
            // _ = RemoveCommand;
            // _ = RunCommand;
            // _ = ShellCompletions;
            // _ = TestCommand;
            // _ = UpgradeCommand;
            // _ = BunxCommand;
        }

        const tag = which();

        switch (tag) {
            .DiscordCommand => return try DiscordCommand.exec(allocator),
            .HelpCommand => return try HelpCommand.exec(allocator),
            .InitCommand => return try InitCommand.exec(allocator, std.os.argv),
            else => {},
        }

        switch (tag) {
            .BuildCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .BuildCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .BuildCommand);

                try BuildCommand.exec(ctx);
            },
            .DevCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .DevCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .DevCommand);

                try DevCommand.exec(ctx);
            },
            .InstallCompletionsCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .InstallCompletionsCommand) unreachable;
                try InstallCompletionsCommand.exec(allocator);
                return;
            },
            .InstallCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .InstallCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .InstallCommand);

                try InstallCommand.exec(ctx);
                return;
            },
            .AddCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .AddCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .AddCommand);

                try AddCommand.exec(ctx);
                return;
            },
            .BunxCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .BunxCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .BunxCommand);

                try BunxCommand.exec(ctx);
                return;
            },
            .RemoveCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .RemoveCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .RemoveCommand);

                try RemoveCommand.exec(ctx);
                return;
            },
            .LinkCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .LinkCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .LinkCommand);

                try LinkCommand.exec(ctx);
                return;
            },
            .UnlinkCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .UnlinkCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .UnlinkCommand);

                try UnlinkCommand.exec(ctx);
                return;
            },
            .PackageManagerCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .PackageManagerCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .PackageManagerCommand);

                try PackageManagerCommand.exec(ctx);
                return;
            },
            .TestCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .TestCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .TestCommand);

                try TestCommand.exec(ctx);
                return;
            },
            .GetCompletionsCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .GetCompletionsCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .GetCompletionsCommand);
                var filter = ctx.positionals;

                for (filter, 0..) |item, i| {
                    if (strings.eqlComptime(item, "getcompletes")) {
                        if (i + 1 < filter.len) {
                            filter = filter[i + 1 ..];
                        } else {
                            filter = &[_]string{};
                        }

                        break;
                    }
                }
                var prefilled_completions: [AddCompletions.biggest_list]string = undefined;
                var completions = ShellCompletions{};

                if (filter.len == 0) {
                    completions = try RunCommand.completions(ctx, &default_completions_list, &reject_list, .all);
                } else if (strings.eqlComptime(filter[0], "s")) {
                    completions = try RunCommand.completions(ctx, null, &reject_list, .script);
                } else if (strings.eqlComptime(filter[0], "i")) {
                    completions = try RunCommand.completions(ctx, &default_completions_list, &reject_list, .script_exclude);
                } else if (strings.eqlComptime(filter[0], "b")) {
                    completions = try RunCommand.completions(ctx, null, &reject_list, .bin);
                } else if (strings.eqlComptime(filter[0], "r")) {
                    completions = try RunCommand.completions(ctx, null, &reject_list, .all);
                } else if (strings.eqlComptime(filter[0], "g")) {
                    completions = try RunCommand.completions(ctx, null, &reject_list, .all_plus_bun_js);
                } else if (strings.eqlComptime(filter[0], "j")) {
                    completions = try RunCommand.completions(ctx, null, &reject_list, .bun_js);
                } else if (strings.eqlComptime(filter[0], "z")) {
                    completions = try RunCommand.completions(ctx, null, &reject_list, .script_and_descriptions);
                } else if (strings.eqlComptime(filter[0], "a")) {
                    const FirstLetter = AddCompletions.FirstLetter;
                    const index = AddCompletions.index;

                    outer: {
                        if (filter.len > 1) {
                            const first_letter: FirstLetter = switch (filter[1][0]) {
                                'a' => FirstLetter.a,
                                'b' => FirstLetter.b,
                                'c' => FirstLetter.c,
                                'd' => FirstLetter.d,
                                'e' => FirstLetter.e,
                                'f' => FirstLetter.f,
                                'g' => FirstLetter.g,
                                'h' => FirstLetter.h,
                                'i' => FirstLetter.i,
                                'j' => FirstLetter.j,
                                'k' => FirstLetter.k,
                                'l' => FirstLetter.l,
                                'm' => FirstLetter.m,
                                'n' => FirstLetter.n,
                                'o' => FirstLetter.o,
                                'p' => FirstLetter.p,
                                'q' => FirstLetter.q,
                                'r' => FirstLetter.r,
                                's' => FirstLetter.s,
                                't' => FirstLetter.t,
                                'u' => FirstLetter.u,
                                'v' => FirstLetter.v,
                                'w' => FirstLetter.w,
                                'x' => FirstLetter.x,
                                'y' => FirstLetter.y,
                                'z' => FirstLetter.z,
                                else => break :outer,
                            };
                            const results = index.get(first_letter);

                            var prefilled_i: usize = 0;
                            for (results) |cur| {
                                if (cur.len == 0 or !strings.hasPrefix(cur, filter[1])) continue;
                                prefilled_completions[prefilled_i] = cur;
                                prefilled_i += 1;
                                if (prefilled_i >= prefilled_completions.len) break;
                            }
                            completions.commands = prefilled_completions[0..prefilled_i];
                        }
                    }
                }
                completions.print();

                return;
            },
            .CreateCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .CreateCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .CreateCommand);
                var positionals: [2]string = undefined;
                var positional_i: usize = 0;

                var args = try std.process.argsAlloc(allocator);

                if (args.len > 2) {
                    var remainder = args[2..];
                    var remainder_i: usize = 0;
                    while (remainder_i < remainder.len and positional_i < positionals.len) : (remainder_i += 1) {
                        var slice = std.mem.trim(u8, bun.asByteSlice(remainder[remainder_i]), " \t\n;");
                        if (slice.len > 0) {
                            positionals[positional_i] = slice;
                            positional_i += 1;
                        }
                    }
                }
                var positionals_ = positionals[0..positional_i];

                try CreateCommand.exec(ctx, positionals_);
                return;
            },
            .RunCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .RunCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .RunCommand);
                if (ctx.positionals.len > 0) {
                    if (try RunCommand.exec(ctx, false, true)) {
                        return;
                    }

                    Global.exit(1);
                }
            },
            .UpgradeCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .UpgradeCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .UpgradeCommand);
                try UpgradeCommand.exec(ctx);
                return;
            },
            .AutoCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .AutoCommand) unreachable;
                var ctx = Command.Context.create(allocator, log, .AutoCommand) catch |e| {
                    switch (e) {
                        error.MissingEntryPoint => {
                            HelpCommand.execWithReason(allocator, .explicit);
                            return;
                        },
                        else => {
                            return e;
                        },
                    }
                };

                const extension: []const u8 = if (ctx.args.entry_points.len > 0)
                    std.fs.path.extension(ctx.args.entry_points[0])
                else
                    @as([]const u8, "");
                // KEYWORDS: open file argv argv0
                if (ctx.args.entry_points.len == 1) {
                    if (strings.eqlComptime(extension, ".bun")) {
                        try PrintBundleCommand.exec(ctx);
                        return;
                    }

                    if (strings.eqlComptime(extension, ".lockb")) {
                        for (std.os.argv) |arg| {
                            if (strings.eqlComptime(std.mem.span(arg), "--hash")) {
                                try PackageManagerCommand.printHash(ctx, ctx.args.entry_points[0]);
                                return;
                            }
                        }

                        try Install.Lockfile.Printer.print(
                            ctx.allocator,
                            ctx.log,
                            ctx.args.entry_points[0],
                            .yarn,
                        );

                        return;
                    }
                }

                var was_js_like = false;
                // If we start bun with:
                // 1. `bun foo.js`, assume it's a JavaScript file.
                // 2. `bun /absolute/path/to/bin/foo` assume its a JavaScript file.
                //                                  ^ no file extension
                //
                // #!/usr/bin/env bun
                // will pass us an absolute path to the script.
                // This means a non-standard file extension will not work, but that is better than the current state
                // which is file extension-less doesn't work
                const default_loader = options.defaultLoaders.get(extension) orelse brk: {
                    if (extension.len == 0 and ctx.args.entry_points.len > 0 and ctx.args.entry_points[0].len > 0 and std.fs.path.isAbsolute(ctx.args.entry_points[0])) {
                        break :brk options.Loader.js;
                    }

                    if (extension.len > 0) {
                        if (!ctx.debug.loaded_bunfig) {
                            try bun.CLI.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", &ctx, .RunCommand);
                        }

                        if (ctx.preloads.len > 0)
                            break :brk options.Loader.js;
                    }

                    break :brk null;
                };

                const force_using_bun = ctx.debug.run_in_bun;
                var did_check = false;
                if (default_loader) |loader| {
                    if (loader.canBeRunByBun()) {
                        was_js_like = true;
                        if (maybeOpenWithBunJS(&ctx)) {
                            return;
                        }
                        did_check = true;
                    }
                }

                if (force_using_bun and !did_check) {
                    if (maybeOpenWithBunJS(&ctx)) {
                        return;
                    }
                }

                if (ctx.positionals.len > 0 and extension.len == 0) {
                    if (try RunCommand.exec(ctx, true, false)) {
                        return;
                    }

                    Output.prettyErrorln("<r><red>error<r><d>:<r> script not found \"<b>{s}<r>\"", .{
                        ctx.positionals[0],
                    });

                    Global.exit(1);
                }

                if (was_js_like) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> module not found \"<b>{s}<r>\"", .{
                        ctx.positionals[0],
                    });
                    Global.exit(1);
                } else if (ctx.positionals.len > 0) {
                    Output.prettyErrorln("<r><red>error<r><d>:<r> file not found \"<b>{s}<r>\"", .{
                        ctx.positionals[0],
                    });
                    Global.exit(1);
                }

                try HelpCommand.exec(allocator);
            },
            else => unreachable,
        }
    }

    fn maybeOpenWithBunJS(ctx: *Command.Context) bool {
        if (ctx.args.entry_points.len == 0)
            return false;

        const script_name_to_search = ctx.args.entry_points[0];

        var file_path = script_name_to_search;
        const file_: std.fs.File.OpenError!std.fs.File = brk: {
            if (script_name_to_search[0] == std.fs.path.sep) {
                break :brk std.fs.openFileAbsolute(script_name_to_search, .{ .mode = .read_only });
            } else if (!strings.hasPrefix(script_name_to_search, "..") and script_name_to_search[0] != '~') {
                const file_pathZ = brk2: {
                    if (!strings.hasPrefix(file_path, "./")) {
                        script_name_buf[0..2].* = "./".*;
                        @memcpy(script_name_buf[2..], file_path.ptr, file_path.len);
                        script_name_buf[file_path.len + 2] = 0;
                        break :brk2 script_name_buf[0 .. file_path.len + 2 :0];
                    } else {
                        @memcpy(&script_name_buf, file_path.ptr, file_path.len);
                        script_name_buf[file_path.len] = 0;
                        break :brk2 script_name_buf[0..file_path.len :0];
                    }
                };

                break :brk std.fs.cwd().openFileZ(file_pathZ, .{ .mode = .read_only });
            } else {
                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const cwd = std.os.getcwd(&path_buf) catch return false;
                path_buf[cwd.len] = std.fs.path.sep;
                var parts = [_]string{script_name_to_search};
                file_path = resolve_path.joinAbsStringBuf(
                    path_buf[0 .. cwd.len + 1],
                    &script_name_buf,
                    &parts,
                    .auto,
                );
                if (file_path.len == 0) return false;
                script_name_buf[file_path.len] = 0;
                var file_pathZ = script_name_buf[0..file_path.len :0];
                break :brk std.fs.openFileAbsoluteZ(file_pathZ, .{ .mode = .read_only });
            }
        };

        const file = file_ catch return false;

        Global.configureAllocator(.{ .long_running = true });

        // the case where this doesn't work is if the script name on disk doesn't end with a known JS-like file extension
        var absolute_script_path = bun.getFdPath(file.handle, &script_name_buf) catch return false;

        if (!ctx.debug.loaded_bunfig) {
            bun.CLI.Arguments.loadConfigPath(ctx.allocator, true, "bunfig.toml", ctx, .RunCommand) catch {};
        }

        BunJS.Run.boot(
            ctx.*,
            file,
            absolute_script_path,
        ) catch |err| {
            if (Output.enable_ansi_colors) {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true) catch {};
            } else {
                ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false) catch {};
            }

            Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{
                std.fs.path.basename(file_path),
                @errorName(err),
            });
            Global.exit(1);
        };
        return true;
    }

    pub const Tag = enum {
        AddCommand,
        AutoCommand,
        BuildCommand,
        BunxCommand,
        CreateCommand,
        DevCommand,
        DiscordCommand,
        GetCompletionsCommand,
        HelpCommand,
        InitCommand,
        InstallCommand,
        InstallCompletionsCommand,
        LinkCommand,
        PackageManagerCommand,
        RemoveCommand,
        RunCommand,
        TestCommand,
        UnlinkCommand,
        UpgradeCommand,

        pub fn params(comptime cmd: Tag) []const Arguments.ParamType {
            return &comptime switch (cmd) {
                Command.Tag.BuildCommand => Arguments.build_params,
                Command.Tag.TestCommand => Arguments.test_params,
                Command.Tag.DevCommand => Arguments.dev_params,
                else => Arguments.params,
            };
        }

        pub fn readGlobalConfig(this: Tag) bool {
            return switch (this) {
                .BunxCommand, .PackageManagerCommand, .InstallCommand, .AddCommand, .RemoveCommand => true,
                else => false,
            };
        }

        pub fn isNPMRelated(this: Tag) bool {
            return switch (this) {
                .BunxCommand, .LinkCommand, .UnlinkCommand, .PackageManagerCommand, .InstallCommand, .AddCommand, .RemoveCommand => true,
                else => false,
            };
        }

        pub const loads_config: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(false, .{
            .BuildCommand = true,
            .DevCommand = true,
            .TestCommand = true,
            .InstallCommand = true,
            .AddCommand = true,
            .RemoveCommand = true,
            .PackageManagerCommand = true,
            .BunxCommand = true,
            .AutoCommand = true,
            .RunCommand = true,
        });

        pub const always_loads_config: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(false, .{
            .BuildCommand = true,
            .DevCommand = true,
            .TestCommand = true,
            .InstallCommand = true,
            .AddCommand = true,
            .RemoveCommand = true,
            .PackageManagerCommand = true,
            .BunxCommand = true,
        });

        pub const uses_global_options: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(true, .{
            .CreateCommand = false,
            .InstallCommand = false,
            .AddCommand = false,
            .RemoveCommand = false,
            .PackageManagerCommand = false,
            .LinkCommand = false,
            .UnlinkCommand = false,
            .BunxCommand = false,
        });
    };
};
