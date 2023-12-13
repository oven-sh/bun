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
const RegularExpression = bun.RegularExpression;

const sync = @import("./sync.zig");
const Api = @import("api/schema.zig").Api;
const resolve_path = @import("./resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("./bun.js/config.zig").configureTransformOptionsForBun;
const clap = @import("root").bun.clap;
const BunJS = @import("./bun_js.zig");
const Install = @import("./install/install.zig");
const bundler = bun.bundler;
const DotEnv = @import("./env_loader.zig");
const RunCommand_ = @import("./cli/run_command.zig").RunCommand;
const CreateCommand_ = @import("./cli/create_command.zig").CreateCommand;

const fs = @import("fs.zig");
const Router = @import("./router.zig");

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
                else => {
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

pub const BuildCommand = @import("./cli/build_command.zig").BuildCommand;
pub const AddCommand = @import("./cli/add_command.zig").AddCommand;
pub const CreateCommand = @import("./cli/create_command.zig").CreateCommand;
pub const CreateCommandExample = @import("./cli/create_command.zig").Example;
pub const CreateListExamplesCommand = @import("./cli/create_command.zig").CreateListExamplesCommand;
pub const DiscordCommand = @import("./cli/discord_command.zig").DiscordCommand;
pub const InstallCommand = @import("./cli/install_command.zig").InstallCommand;
pub const LinkCommand = @import("./cli/link_command.zig").LinkCommand;
pub const UnlinkCommand = @import("./cli/unlink_command.zig").UnlinkCommand;
pub const InstallCompletionsCommand = @import("./cli/install_completions_command.zig").InstallCompletionsCommand;
pub const PackageManagerCommand = @import("./cli/package_manager_command.zig").PackageManagerCommand;
pub const RemoveCommand = @import("./cli/remove_command.zig").RemoveCommand;
pub const RunCommand = @import("./cli/run_command.zig").RunCommand;
pub const ShellCompletions = @import("./cli/shell_completions.zig");
pub const UpdateCommand = @import("./cli/update_command.zig").UpdateCommand;
pub const UpgradeCommand = @import("./cli/upgrade_command.zig").UpgradeCommand;
pub const BunxCommand = @import("./cli/bunx_command.zig").BunxCommand;

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
        var file = try bun.openFileZ(&try std.os.toPosixPath(outpath), std.fs.File.OpenFlags{ .mode = .read_only });
        defer file.close();
        const size = try file.getEndPos();
        return try file.readToEndAlloc(allocator, size);
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

    const base_params_ = [_]ParamType{
        clap.parseParam("--env-file <STR>...               Load environment variables from the specified file(s)") catch unreachable,
        clap.parseParam("--cwd <STR>                       Absolute path to resolve files & entry points from. This just changes the process' cwd.") catch unreachable,
        clap.parseParam("-c, --config <PATH>?              Specify path to Bun config file. Default <d>$cwd<r>/bunfig.toml") catch unreachable,
        clap.parseParam("-h, --help                        Display this menu and exit") catch unreachable,
        clap.parseParam("<POS>...") catch unreachable,
    };

    const transpiler_params_ = [_]ParamType{
        clap.parseParam("--main-fields <STR>...            Main fields to lookup in package.json. Defaults to --target dependent") catch unreachable,
        clap.parseParam("--extension-order <STR>...        Defaults to: .tsx,.ts,.jsx,.js,.json ") catch unreachable,
        clap.parseParam("--tsconfig-override <STR>         Specify custom tsconfig.json. Default <d>$cwd<r>/tsconfig.json") catch unreachable,
        clap.parseParam("-d, --define <STR>...             Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:\"development\". Values are parsed as JSON.") catch unreachable,
        clap.parseParam("-l, --loader <STR>...             Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi") catch unreachable,
        clap.parseParam("--no-macros                       Disable macros from being executed in the bundler, transpiler and runtime") catch unreachable,
        clap.parseParam("--jsx-factory <STR>               Changes the function called when compiling JSX elements using the classic JSX runtime") catch unreachable,
        clap.parseParam("--jsx-fragment <STR>              Changes the function called when compiling JSX fragments") catch unreachable,
        clap.parseParam("--jsx-import-source <STR>         Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: \"react\"") catch unreachable,
        clap.parseParam("--jsx-runtime <STR>               \"automatic\" (default) or \"classic\"") catch unreachable,
    };
    const runtime_params_ = [_]ParamType{
        clap.parseParam("--watch                           Automatically restart the process on file change") catch unreachable,
        clap.parseParam("--hot                             Enable auto reload in the Bun runtime, test runner, or bundler") catch unreachable,
        clap.parseParam("--smol                            Use less memory, but run garbage collection more often") catch unreachable,
        clap.parseParam("-r, --preload <STR>...            Import a module before other modules are loaded") catch unreachable,
        clap.parseParam("--inspect <STR>?                  Activate Bun's debugger") catch unreachable,
        clap.parseParam("--inspect-wait <STR>?             Activate Bun's debugger, wait for a connection before executing") catch unreachable,
        clap.parseParam("--inspect-brk <STR>?              Activate Bun's debugger, set breakpoint on first line of code and wait") catch unreachable,
        clap.parseParam("--if-present                      Exit without an error if the entrypoint does not exist") catch unreachable,
        clap.parseParam("--no-install                      Disable auto install in the Bun runtime") catch unreachable,
        clap.parseParam("--install <STR>                   Configure auto-install behavior. One of \"auto\" (default, auto-installs when no node_modules), \"fallback\" (missing packages only), \"force\" (always).") catch unreachable,
        clap.parseParam("-i                                Auto-install dependencies during execution. Equivalent to --install=fallback.") catch unreachable,
        clap.parseParam("-e, --eval <STR>                  Evaluate argument as a script") catch unreachable,
        clap.parseParam("--prefer-offline                  Skip staleness checks for packages in the Bun runtime and resolve from disk") catch unreachable,
        clap.parseParam("--prefer-latest                   Use the latest matching versions of packages in the Bun runtime, always checking npm") catch unreachable,
        clap.parseParam("-p, --port <STR>                  Set the default port for Bun.serve") catch unreachable,
        clap.parseParam("-u, --origin <STR>") catch unreachable,
    };

    const auto_only_params = [_]ParamType{
        // clap.parseParam("--all") catch unreachable,
        clap.parseParam("-b, --bun                         Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)") catch unreachable,
        clap.parseParam("--silent                          Don't print the script command") catch unreachable,
        clap.parseParam("-v, --version                     Print version and exit") catch unreachable,
        clap.parseParam("--revision                        Print version with revision and exit") catch unreachable,
    };
    const auto_params = auto_only_params ++ runtime_params_ ++ transpiler_params_ ++ base_params_;

    const run_only_params = [_]ParamType{
        clap.parseParam("--silent                          Don't print the script command") catch unreachable,
        clap.parseParam("-b, --bun                         Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)") catch unreachable,
    };
    pub const run_params = run_only_params ++ runtime_params_ ++ transpiler_params_ ++ base_params_;

    const bunx_commands = [_]ParamType{
        clap.parseParam("--silent                          Don't print the script command") catch unreachable,
        clap.parseParam("-b, --bun                         Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)") catch unreachable,
    };

    const build_only_params = [_]ParamType{
        clap.parseParam("--compile                        Generate a standalone Bun executable containing your bundled code") catch unreachable,
        clap.parseParam("--watch                          Automatically restart the process on file change") catch unreachable,
        clap.parseParam("--target <STR>                   The intended execution environment for the bundle. \"browser\", \"bun\" or \"node\"") catch unreachable,
        clap.parseParam("--outdir <STR>                   Default to \"dist\" if multiple files") catch unreachable,
        clap.parseParam("--outfile <STR>                  Write to a file") catch unreachable,
        clap.parseParam("--sourcemap <STR>?               Build with sourcemaps - 'inline', 'external', or 'none'") catch unreachable,
        clap.parseParam("--format <STR>                   Specifies the module format to build to. Only \"esm\" is supported.") catch unreachable,
        clap.parseParam("--root <STR>                     Root directory used for multiple entry points") catch unreachable,
        clap.parseParam("--splitting                      Enable code splitting") catch unreachable,
        clap.parseParam("--public-path <STR>              A prefix to be appended to any import paths in bundled code") catch unreachable,
        clap.parseParam("-e, --external <STR>...          Exclude module from transpilation (can use * wildcards). ex: -e react") catch unreachable,
        clap.parseParam("--entry-naming <STR>             Customize entry point filenames. Defaults to \"[dir]/[name].[ext]\"") catch unreachable,
        clap.parseParam("--chunk-naming <STR>             Customize chunk filenames. Defaults to \"[name]-[hash].[ext]\"") catch unreachable,
        clap.parseParam("--asset-naming <STR>             Customize asset filenames. Defaults to \"[name]-[hash].[ext]\"") catch unreachable,
        clap.parseParam("--server-components              Enable React Server Components (experimental)") catch unreachable,
        clap.parseParam("--no-bundle                      Transpile file only, do not bundle") catch unreachable,
        clap.parseParam("--minify                         Enable all minification flags") catch unreachable,
        clap.parseParam("--minify-syntax                  Minify syntax and inline data") catch unreachable,
        clap.parseParam("--minify-whitespace              Minify whitespace") catch unreachable,
        clap.parseParam("--minify-identifiers             Minify identifiers") catch unreachable,
        clap.parseParam("--dump-environment-variables") catch unreachable,
    };
    pub const build_params = build_only_params ++ transpiler_params_ ++ base_params_;

    // TODO: update test completions
    const test_only_params = [_]ParamType{
        clap.parseParam("--timeout <NUMBER>               Set the per-test timeout in milliseconds, default is 5000.") catch unreachable,
        clap.parseParam("--update-snapshots               Update snapshot files") catch unreachable,
        clap.parseParam("--rerun-each <NUMBER>            Re-run each test file <NUMBER> times, helps catch certain bugs") catch unreachable,
        clap.parseParam("--only                           Only run tests that are marked with \"test.only()\"") catch unreachable,
        clap.parseParam("--todo                           Include tests that are marked with \"test.todo()\"") catch unreachable,
        clap.parseParam("--coverage                       Generate a coverage profile") catch unreachable,
        clap.parseParam("--bail <NUMBER>?                 Exit the test suite after <NUMBER> failures. If you do not specify a number, it defaults to 1.") catch unreachable,
        clap.parseParam("-t, --test-name-pattern <STR>    Run only tests with a name that matches the given regex.") catch unreachable,
    };
    pub const test_params = test_only_params ++ runtime_params_ ++ transpiler_params_ ++ base_params_;

    fn printVersionAndExit() noreturn {
        @setCold(true);
        Output.writer().writeAll(Global.package_json_version ++ "\n") catch {};
        Global.exit(0);
    }

    fn printRevisionAndExit() noreturn {
        @setCold(true);
        Output.writer().writeAll(Global.package_json_version_with_revision ++ "\n") catch {};
        Global.exit(0);
    }

    pub fn loadConfigPath(allocator: std.mem.Allocator, auto_loaded: bool, config_path: [:0]const u8, ctx: *Command.Context, comptime cmd: Command.Tag) !void {
        var config_file = switch (bun.sys.openA(config_path, std.os.O.RDONLY, 0)) {
            .result => |fd| std.fs.File{ .handle = bun.fdcast(fd) },
            .err => |err| {
                if (auto_loaded) return;
                Output.prettyErrorln("{}\nwhile opening config \"{s}\"", .{
                    err,
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
        if (bun.getenvZ("XDG_CONFIG_HOME") orelse bun.getenvZ(bun.DotEnv.home_env)) |data_dir| {
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
            @memcpy(config_buf[0..config_path_.len], config_path_);
            config_buf[config_path_.len] = 0;
            config_path = config_buf[0..config_path_.len :0];
        } else {
            if (ctx.args.absolute_working_dir == null) {
                var secondbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
                var cwd = bun.getcwd(&secondbuf) catch return;

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
        const params_to_parse = comptime cmd.params();

        var args = clap.parse(clap.Help, params_to_parse, .{
            .diagnostic = &diag,
            .allocator = allocator,
            .stop_after_positional_at = switch (cmd) {
                .RunCommand => 2,
                .AutoCommand => 1,
                else => 0,
            },
        }) catch |err| {
            // Report useful error and exit
            diag.report(Output.errorWriter(), err) catch {};
            cmd.printHelp(false);
            Global.exit(1);
        };

        const print_help = args.flag("--help");
        if (print_help) {
            cmd.printHelp(true);
            Output.flush();
            Global.exit(0);
        }

        if (cmd == .AutoCommand) {
            if (args.flag("--version")) {
                printVersionAndExit();
            }

            if (args.flag("--revision")) {
                printRevisionAndExit();
            }
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
            cwd = try bun.getcwdAlloc(allocator);
        }

        if (cmd == .TestCommand) {
            if (args.option("--timeout")) |timeout_ms| {
                if (timeout_ms.len > 0) {
                    ctx.test_options.default_timeout_ms = std.fmt.parseInt(u32, timeout_ms, 10) catch {
                        Output.prettyErrorln("<r><red>error<r>: Invalid timeout: \"{s}\"", .{timeout_ms});
                        Global.exit(1);
                    };
                }
            }

            if (!ctx.test_options.coverage.enabled) {
                ctx.test_options.coverage.enabled = args.flag("--coverage");
            }

            if (args.option("--bail")) |bail| {
                if (bail.len > 0) {
                    ctx.test_options.bail = std.fmt.parseInt(u32, bail, 10) catch |e| {
                        Output.prettyErrorln("<r><red>error<r>: --bail expects a number: {s}", .{@errorName(e)});
                        Global.exit(1);
                    };

                    if (ctx.test_options.bail == 0) {
                        Output.prettyErrorln("<r><red>error<r>: --bail expects a number greater than 0", .{});
                        Global.exit(1);
                    }
                } else {
                    ctx.test_options.bail = 1;
                }
            }
            if (args.option("--rerun-each")) |repeat_count| {
                if (repeat_count.len > 0) {
                    ctx.test_options.repeat_count = std.fmt.parseInt(u32, repeat_count, 10) catch |e| {
                        Output.prettyErrorln("<r><red>error<r>: --rerun-each expects a number: {s}", .{@errorName(e)});
                        Global.exit(1);
                    };
                }
            }
            if (args.option("--test-name-pattern")) |namePattern| {
                const regex = RegularExpression.init(bun.String.fromBytes(namePattern), RegularExpression.Flags.none) catch {
                    Output.prettyErrorln(
                        "<r><red>error<r>: --test-name-pattern expects a valid regular expression but received {}",
                        .{
                            strings.QuotedFormatter{
                                .text = namePattern,
                            },
                        },
                    );
                    Global.exit(1);
                };
                ctx.test_options.test_filter_regex = regex;
            }
            ctx.test_options.update_snapshots = args.flag("--update-snapshots");
            ctx.test_options.run_todo = args.flag("--todo");
            ctx.test_options.only = args.flag("--only");
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

        opts.tsconfig_override = if (args.option("--tsconfig-override")) |ts|
            (Arguments.readFile(allocator, cwd, ts) catch |err| fileReadError(err, Output.errorStream(), ts, "tsconfig.json"))
        else
            null;

        opts.serve = false; // TODO
        opts.main_fields = args.options("--main-fields");
        // we never actually supported inject.
        // opts.inject = args.options("--inject");
        opts.env_files = args.options("--env-file");
        opts.extension_order = args.options("--extension-order");

        ctx.passthrough = args.remaining();

        // runtime commands
        if (cmd == .AutoCommand or cmd == .RunCommand or cmd == .TestCommand) {
            const preloads = args.options("--preload");

            if (args.flag("--hot")) {
                ctx.debug.hot_reload = .hot;
            } else if (args.flag("--watch")) {
                ctx.debug.hot_reload = .watch;
                bun.auto_reload_on_crash = true;
            }

            if (args.option("--origin")) |origin| {
                opts.origin = origin;
            }

            if (args.option("--port")) |port_str| {
                opts.port = std.fmt.parseInt(u16, port_str, 10) catch return error.InvalidPort;
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

            if (ctx.preloads.len > 0 and preloads.len > 0) {
                var all = std.ArrayList(string).initCapacity(ctx.allocator, ctx.preloads.len + preloads.len) catch unreachable;
                all.appendSliceAssumeCapacity(ctx.preloads);
                all.appendSliceAssumeCapacity(preloads);
                ctx.preloads = all.items;
            } else if (preloads.len > 0) {
                ctx.preloads = preloads;
            }

            ctx.runtime_options.eval_script = args.option("--eval") orelse "";
            ctx.runtime_options.if_present = args.flag("--if-present");
            ctx.runtime_options.smol = args.flag("--smol");
            if (args.option("--inspect")) |inspect_flag| {
                ctx.runtime_options.debugger = if (inspect_flag.len == 0)
                    Command.Debugger{ .enable = .{} }
                else
                    Command.Debugger{ .enable = .{
                        .path_or_port = inspect_flag,
                    } };

                bun.JSC.RuntimeTranspilerCache.is_disabled = true;
            } else if (args.option("--inspect-wait")) |inspect_flag| {
                ctx.runtime_options.debugger = if (inspect_flag.len == 0)
                    Command.Debugger{ .enable = .{
                        .wait_for_connection = true,
                    } }
                else
                    Command.Debugger{ .enable = .{
                        .path_or_port = inspect_flag,
                        .wait_for_connection = true,
                    } };

                bun.JSC.RuntimeTranspilerCache.is_disabled = true;
            } else if (args.option("--inspect-brk")) |inspect_flag| {
                ctx.runtime_options.debugger = if (inspect_flag.len == 0)
                    Command.Debugger{ .enable = .{
                        .wait_for_connection = true,
                        .set_breakpoint_on_first_line = true,
                    } }
                else
                    Command.Debugger{ .enable = .{
                        .path_or_port = inspect_flag,
                        .wait_for_connection = true,
                        .set_breakpoint_on_first_line = true,
                    } };

                bun.JSC.RuntimeTranspilerCache.is_disabled = true;
            }
        }

        if (opts.port != null and opts.origin == null) {
            opts.origin = try std.fmt.allocPrint(allocator, "http://localhost:{d}/", .{opts.port.?});
        }

        var output_dir: ?string = null;
        var output_file: ?string = null;

        if (cmd == .BuildCommand) {
            ctx.bundler_options.transform_only = args.flag("--no-bundle");

            const minify_flag = args.flag("--minify");
            ctx.bundler_options.minify_syntax = minify_flag or args.flag("--minify-syntax");
            ctx.bundler_options.minify_whitespace = minify_flag or args.flag("--minify-whitespace");
            ctx.bundler_options.minify_identifiers = minify_flag or args.flag("--minify-identifiers");

            if (args.options("--external").len > 0) {
                var externals = try allocator.alloc([]u8, args.options("--external").len);
                for (args.options("--external"), 0..) |external, i| {
                    externals[i] = constStrToU8(external);
                }
                opts.external = externals;
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

            if (args.flag("--watch")) {
                ctx.debug.hot_reload = .watch;
                bun.auto_reload_on_crash = true;
            }

            if (args.flag("--compile")) {
                ctx.bundler_options.compile = true;
            }

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

            if (args.option("--format")) |format_str| {
                const format = options.Format.fromString(format_str) orelse {
                    Output.prettyErrorln("<r><red>error<r>: Invalid format - must be esm, cjs, or iife", .{});
                    Global.crash();
                };
                switch (format) {
                    .esm => {},
                    else => {
                        Output.prettyErrorln("<r><red>error<r>: Formats besides 'esm' are not implemented", .{});
                        Global.crash();
                    },
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
                        var out_entry = entry_points[1..];
                        for (entry_points, 0..) |entry, i| {
                            if (entry.len > 0) {
                                out_entry = out_entry[i..];
                                break;
                            }
                        }
                        entry_points = out_entry;
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
        const react_fast_refresh = true;

        if (cmd == .AutoCommand or cmd == .RunCommand) {
            ctx.debug.silent = args.flag("--silent");
            ctx.debug.run_in_bun = args.flag("--bun") or ctx.debug.run_in_bun;

            if (opts.define) |define| {
                if (define.keys.len > 0)
                    bun.JSC.RuntimeTranspilerCache.is_disabled = true;
            }
        }

        opts.resolve = Api.ResolveMode.lazy;

        if (jsx_factory != null or
            jsx_fragment != null or
            jsx_import_source != null or
            jsx_runtime != null or
            !react_fast_refresh)
        {
            var default_factory = "".*;
            var default_fragment = "".*;
            var default_import_source = "".*;
            if (opts.jsx == null) {
                opts.jsx = Api.Jsx{
                    .factory = constStrToU8(jsx_factory orelse &default_factory),
                    .fragment = constStrToU8(jsx_fragment orelse &default_fragment),
                    .import_source = constStrToU8(jsx_import_source orelse &default_import_source),
                    .runtime = if (jsx_runtime) |runtime| try resolve_jsx_runtime(runtime) else Api.JsxRuntime.automatic,
                    .development = false,
                    .react_fast_refresh = react_fast_refresh,
                };
            } else {
                opts.jsx = Api.Jsx{
                    .factory = constStrToU8(jsx_factory orelse opts.jsx.?.factory),
                    .fragment = constStrToU8(jsx_fragment orelse opts.jsx.?.fragment),
                    .import_source = constStrToU8(jsx_import_source orelse opts.jsx.?.import_source),
                    .runtime = if (jsx_runtime) |runtime| try resolve_jsx_runtime(runtime) else opts.jsx.?.runtime,
                    .development = false,
                    .react_fast_refresh = react_fast_refresh,
                };
            }
        }

        if (cmd == .BuildCommand) {
            if (opts.entry_points.len == 0 and opts.framework == null) {
                Output.prettyErrorln("<r><b>bun build <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
                Output.prettyError("<r><red>error: Missing entrypoints. What would you like to bundle?<r>\n\n", .{});
                Output.flush();
                Output.pretty("Usage:\n  <d>$<r> <b><green>bun build<r> \\<entrypoint\\> [...\\<entrypoints\\>] <cyan>[...flags]<r>  \n", .{});
                Output.pretty("\nTo see full documentation:\n  <d>$<r> <b><green>bun build<r> --help\n", .{});
                Output.flush();
                Global.exit(1);
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

        if (args.flag("--no-macros")) {
            ctx.debug.macros = .{ .disable = {} };
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
        "zod",
        "tailwindcss",
    };

    pub const packages_to_x_filler = [_]string{
        "bun-repl",
        "next",
        "vite",
        "prisma",
        "nuxi",
        "prettier",
        "eslint",
    };

    pub const packages_to_create_filler = [_]string{
        "next-app",
        "vite",
        "astro",
        "svelte",
        "elysia",
    };

    // the spacing between commands here is intentional
    pub const cli_helptext_fmt =
        \\<b>Usage:<r> <b>bun \<command\> <cyan>[...flags]<r> <b>[...args]<r>
        \\
        \\<b>Commands:<r>
        \\  <b><magenta>run<r>       <d>./my-script.ts<r>       Execute a file with Bun
        \\            <d>lint<r>                 Run a package.json script
        \\  <b><magenta>test<r>                           Run unit tests with Bun
        \\  <b><magenta>x<r>         <d>{s:<16}<r>     Execute a package binary (CLI), installing if needed <d>(bunx)<r>
        \\  <b><magenta>repl<r>                           Start a REPL session with Bun
        \\
        \\  <b><blue>install<r>                        Install dependencies for a package.json <d>(bun i)<r>
        \\  <b><blue>add<r>       <d>{s:<16}<r>     Add a dependency to package.json <d>(bun a)<r>
        \\  <b><blue>remove<r>    <d>{s:<16}<r>     Remove a dependency from package.json <d>(bun rm)<r>
        \\  <b><blue>update<r>    <d>{s:<16}<r>     Update outdated dependencies
        \\  <b><blue>link<r>      <d>[\<package\>]<r>          Register or link a local npm package
        \\  <b><blue>unlink<r>                         Unregister a local npm package
        \\  <b><blue>pm <d>\<subcommand\><r>                Additional package management utilities
        \\
        \\  <b><yellow>build<r>     <d>./a.ts ./b.jsx<r>       Bundle TypeScript & JavaScript into a single file
        \\
        \\  <b><cyan>init<r>                           Start an empty Bun project from a blank template
        \\  <b><cyan>create<r>    <d>{s:<16}<r>     Create a new project from a template <d>(bun c)<r>
        \\  <b><cyan>upgrade<r>                        Upgrade to latest version of Bun.
        \\  <d>\<command\><r> <b><cyan>--help<r>               Print help text for command.
        \\
    ;
    const cli_helptext_footer =
        \\
        \\Learn more about Bun:            <magenta>https://bun.sh/docs<r>
        \\Join our Discord community:      <blue>https://bun.sh/discord<r>
        \\
    ;

    pub fn printWithReason(comptime reason: Reason, show_all_flags: bool) void {
        var rand_state = std.rand.DefaultPrng.init(@as(u64, @intCast(@max(std.time.milliTimestamp(), 0))));
        const rand = rand_state.random();

        const package_x_i = rand.uintAtMost(usize, packages_to_x_filler.len - 1);
        const package_add_i = rand.uintAtMost(usize, packages_to_add_filler.len - 1);
        const package_remove_i = rand.uintAtMost(usize, packages_to_remove_filler.len - 1);
        const package_create_i = rand.uintAtMost(usize, packages_to_create_filler.len - 1);

        const args = .{
            packages_to_x_filler[package_x_i],
            packages_to_create_filler[package_create_i],
            packages_to_add_filler[package_add_i],
            packages_to_remove_filler[package_remove_i],
            packages_to_add_filler[(package_add_i + 1) % packages_to_add_filler.len],
        };

        switch (reason) {
            .explicit => {
                Output.pretty(
                    "<r><b><magenta>Bun<r> is a fast JavaScript runtime, package manager, bundler, and test runner. <d>(" ++
                        Global.package_json_version_with_sha ++
                        ")<r>\n\n" ++
                        cli_helptext_fmt,
                    args,
                );
                if (show_all_flags) {
                    Output.pretty("\n<b>Flags:<r>", .{});

                    const flags = Arguments.runtime_params_ ++ Arguments.auto_only_params ++ Arguments.base_params_;
                    clap.simpleHelpBunTopLevel(comptime &flags);
                    Output.pretty("\n\n(more flags in <b>bun install --help<r>, <b>bun test --help<r>, and <b>bun build --help<r>)\n", .{});
                }
                Output.pretty(cli_helptext_footer, .{});
            },
            .invalid_command => Output.prettyError(
                "<r><red>Uh-oh<r> not sure what to do with that command.\n\n" ++ cli_helptext_fmt,
                args,
            ),
        }

        Output.flush();
    }
    pub fn execWithReason(_: std.mem.Allocator, comptime reason: Reason) void {
        @setCold(true);
        printWithReason(reason, false);

        if (reason == .invalid_command) {
            std.process.exit(1);
        }
    }
};

pub const ReservedCommand = struct {
    pub fn exec(_: std.mem.Allocator) !void {
        @setCold(true);
        const command_name = bun.argv()[1];
        Output.prettyError(
            \\<r><red>Uh-oh<r>. <b><yellow>bun {s}<r> is a subcommand reserved for future use by Bun.
            \\
            \\If you were trying to run a package.json script called {s}, use <b><magenta>bun run {s}<r>.
            \\
        , .{ command_name, command_name, command_name });
        Output.flush();
        std.process.exit(1);
    }
};

const AddCompletions = @import("./cli/add_completions.zig");

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
        macros: MacroOptions = MacroOptions.unspecified,
        editor: string = "",
        package_bundle_map: bun.StringArrayHashMapUnmanaged(options.BundlePackage) = bun.StringArrayHashMapUnmanaged(options.BundlePackage){},

        test_directory: []const u8 = "",
        output_file: []const u8 = "",
    };

    pub const MacroOptions = union(enum) { unspecified: void, disable: void, map: MacroMap };

    pub const HotReload = enum {
        none,
        hot,
        watch,
    };

    pub const TestOptions = struct {
        default_timeout_ms: u32 = 5 * std.time.ms_per_s,
        update_snapshots: bool = false,
        repeat_count: u32 = 0,
        run_todo: bool = false,
        only: bool = false,
        bail: u32 = 0,
        coverage: TestCommand.CodeCoverageOptions = .{},
        test_filter_regex: ?*RegularExpression = null,
    };

    pub const Debugger = union(enum) {
        unspecified: void,
        enable: struct {
            path_or_port: []const u8 = "",
            wait_for_connection: bool = false,
            set_breakpoint_on_first_line: bool = false,
        },
    };

    pub const RuntimeOptions = struct {
        smol: bool = false,
        debugger: Debugger = .{ .unspecified = {} },
        if_present: bool = false,
        eval_script: []const u8 = "",
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
        runtime_options: RuntimeOptions = RuntimeOptions{},

        preloads: []const string = &[_]string{},
        has_loaded_global_config: bool = false,

        pub const BundlerOptions = struct {
            compile: bool = false,

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
        var args_iter = ArgsIterator{ .buf = bun.argv() };

        const argv0 = args_iter.next() orelse return .HelpCommand;

        // symlink is argv[0]
        if (strings.endsWithComptime(argv0, "bunx"))
            return .BunxCommand;

        if (strings.endsWithComptime(std.mem.span(bun.argv()[0]), "node")) {
            std.debug.print("", .{});
            @import("./deps/zig-clap/clap/streaming.zig").warn_on_unrecognized_flag = false;
        }

        if (comptime Environment.isDebug) {
            if (strings.endsWithComptime(argv0, "bunx-debug"))
                return .BunxCommand;
        }

        var next_arg = ((args_iter.next()) orelse return .AutoCommand);
        while (next_arg[0] == '-' and !(next_arg.len > 1 and next_arg[1] == 'e')) {
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
            RootCommandMatcher.case("repl") => .ReplCommand,

            RootCommandMatcher.case("i"),
            RootCommandMatcher.case("install"),
            => brk: {
                for (args_iter.buf) |arg| {
                    const span = std.mem.span(arg);
                    if (span.len > 0 and (strings.eqlComptime(span, "-g") or strings.eqlComptime(span, "--global"))) {
                        break :brk .AddCommand;
                    }
                }

                break :brk .InstallCommand;
            },
            RootCommandMatcher.case("c"), RootCommandMatcher.case("create") => .CreateCommand,

            RootCommandMatcher.case("test") => .TestCommand,

            RootCommandMatcher.case("pm") => .PackageManagerCommand,

            RootCommandMatcher.case("add"), RootCommandMatcher.case("a") => .AddCommand,

            RootCommandMatcher.case("update") => .UpdateCommand,

            RootCommandMatcher.case("r"),
            RootCommandMatcher.case("remove"),
            RootCommandMatcher.case("rm"),
            RootCommandMatcher.case("uninstall"),
            => .RemoveCommand,

            RootCommandMatcher.case("run") => .RunCommand,
            RootCommandMatcher.case("help") => .HelpCommand,

            // These are reserved for future use by Bun, so that someone
            // doing `bun deploy` to run a script doesn't accidentally break
            // when we add our actual command
            RootCommandMatcher.case("deploy") => .ReservedCommand,
            RootCommandMatcher.case("cloud") => .ReservedCommand,
            RootCommandMatcher.case("info") => .ReservedCommand,
            RootCommandMatcher.case("config") => .ReservedCommand,
            RootCommandMatcher.case("use") => .ReservedCommand,
            RootCommandMatcher.case("auth") => .ReservedCommand,
            RootCommandMatcher.case("login") => .ReservedCommand,
            RootCommandMatcher.case("logout") => .ReservedCommand,
            RootCommandMatcher.case("whoami") => .ReservedCommand,
            RootCommandMatcher.case("publish") => .ReservedCommand,
            RootCommandMatcher.case("prune") => .ReservedCommand,
            RootCommandMatcher.case("outdated") => .ReservedCommand,
            RootCommandMatcher.case("list") => .ReservedCommand,
            RootCommandMatcher.case("why") => .ReservedCommand,

            RootCommandMatcher.case("-e") => .AutoCommand,

            else => .AutoCommand,
        };
    }

    const default_completions_list = [_]string{
        "build",
        "install",
        "add",
        "run",
        "update",
        "link",
        "unlink",
        "remove",
        "create",
        "bun",
        "upgrade",
        "discord",
        "test",
        "pm",
        "x",
        "repl",
    };

    const reject_list = default_completions_list ++ [_]string{
        "build",
        "completions",
        "help",
    };

    pub fn start(allocator: std.mem.Allocator, log: *logger.Log) !void {
        if (comptime Environment.allow_assert) {
            if (bun.getenvZ("MI_VERBOSE") == null) {
                bun.Mimalloc.mi_option_set_enabled(.verbose, false);
            }
        }

        // there's a bug with openSelfExe() on Windows
        if (comptime !bun.Environment.isWindows) {
            // bun build --compile entry point
            if (try bun.StandaloneModuleGraph.fromExecutable(bun.default_allocator)) |graph| {
                var ctx = Command.Context{
                    .args = std.mem.zeroes(Api.TransformOptions),
                    .log = log,
                    .start_time = start_time,
                    .allocator = bun.default_allocator,
                };

                ctx.args.target = Api.Target.bun;
                var argv = try bun.default_allocator.alloc(string, bun.argv().len -| 1);
                if (bun.argv().len > 1) {
                    for (argv, bun.argv()[1..]) |*dest, src| {
                        dest.* = bun.span(src);
                    }
                }
                ctx.passthrough = argv;

                try @import("./bun_js.zig").Run.bootStandalone(
                    ctx,
                    graph.entryPoint().name,
                    graph,
                );
                return;
            }
        }

        const tag = which();

        switch (tag) {
            .DiscordCommand => return try DiscordCommand.exec(allocator),
            .HelpCommand => return try HelpCommand.exec(allocator),
            .ReservedCommand => return try ReservedCommand.exec(allocator),
            .InitCommand => return try InitCommand.exec(allocator, bun.argv()),
            .BuildCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .BuildCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .BuildCommand);
                try BuildCommand.exec(ctx);
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
            .UpdateCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .UpdateCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .UpdateCommand);

                try UpdateCommand.exec(ctx);
                return;
            },
            .BunxCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .BunxCommand) unreachable;
                const ctx = try Command.Context.create(allocator, log, .BunxCommand);

                try BunxCommand.exec(ctx, bun.argv()[1..]);
                return;
            },
            .ReplCommand => {
                // TODO: Put this in native code.
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .BunxCommand) unreachable;
                var ctx = try Command.Context.create(allocator, log, .BunxCommand);
                ctx.debug.run_in_bun = true; // force the same version of bun used. fixes bun-debug for example
                var args = bun.argv()[1..];
                args[0] = @constCast("bun-repl");
                try BunxCommand.exec(ctx, args);
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
                // These are templates from the legacy `bun create`
                // most of them aren't useful but these few are kinda nice.
                const HardcodedNonBunXList = bun.ComptimeStringMap(void, .{
                    .{"elysia"},
                    .{"elysia-buchta"},
                    .{"stric"},
                });

                // Create command wraps bunx
                const ctx = try Command.Context.create(allocator, log, .CreateCommand);

                var args = try std.process.argsAlloc(allocator);

                if (args.len <= 2) {
                    Command.Tag.printHelp(.CreateCommand, false);
                    Global.exit(1);
                    return;
                }

                // iterate over args
                // if --help, print help and exit
                const print_help = brk: {
                    for (bun.argv()) |arg_| {
                        const arg = bun.span(arg_);
                        if (strings.eqlComptime(arg, "--help")) {
                            break :brk true;
                        }
                    }
                    break :brk false;
                };

                var template_name_start: usize = 0;
                var positionals: [2]string = .{ "", "" };

                var positional_i: usize = 0;

                if (args.len > 2) {
                    var remainder = args[2..];
                    var remainder_i: usize = 0;
                    while (remainder_i < remainder.len and positional_i < positionals.len) : (remainder_i += 1) {
                        var slice = std.mem.trim(u8, bun.asByteSlice(remainder[remainder_i]), " \t\n;");
                        if (slice.len > 0 and !strings.hasPrefixComptime(slice, "--")) {
                            if (positional_i == 0) {
                                template_name_start = remainder_i + 2;
                            }
                            positionals[positional_i] = slice;
                            positional_i += 1;
                        }
                    }
                }

                if (print_help or
                    // "bun create --"
                    // "bun create -abc --"
                    positional_i == 0)
                {
                    Command.Tag.printHelp(.CreateCommand, true);
                    Global.exit(0);
                    return;
                }

                const template_name = positionals[0];

                // if template_name is "react"
                // print message telling user to use "bun create vite" instead
                if (strings.eqlComptime(template_name, "react")) {
                    Output.prettyErrorln(
                        \\The "react" template has been deprecated.
                        \\It is recommended to use "react-app" or "vite" instead.
                        \\
                        \\To create a project using Create React App, run
                        \\
                        \\  <d>bun create react-app<r>
                        \\
                        \\To create a React project using Vite, run
                        \\
                        \\  <d>bun create vite<r>
                        \\
                        \\Then select "React" from the list of frameworks.
                        \\
                    , .{});
                    Global.exit(1);
                    return;
                }

                // if template_name is "next"
                // print message telling user to use "bun create next-app" instead
                if (strings.eqlComptime(template_name, "next")) {
                    Output.prettyErrorln(
                        \\<yellow>warn: No template <b>create-next<r> found.
                        \\To create a project with the official Next.js scaffolding tool, run
                        \\  <b>bun create next-app <cyan>[destination]<r>
                    , .{});
                    Global.exit(1);
                    return;
                }

                const create_command_info = try CreateCommand.extractInfo(ctx);
                const template = create_command_info.template;
                var example_tag = create_command_info.example_tag;

                const use_bunx = !HardcodedNonBunXList.has(template_name) and
                    (!strings.containsComptime(template_name, "/") or
                    strings.startsWithChar(template_name, '@')) and
                    example_tag != CreateCommandExample.Tag.local_folder;

                if (use_bunx) {
                    const bunx_args = try allocator.alloc([*:0]const u8, args.len - template_name_start);
                    bunx_args[0] = try BunxCommand.addCreatePrefix(allocator, template_name);
                    for (bunx_args[1..], args[template_name_start + 1 ..]) |*dest, src| {
                        dest.* = src;
                    }

                    try BunxCommand.exec(ctx, bunx_args);
                    return;
                }

                try CreateCommand.exec(ctx, example_tag, template);
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

                if (ctx.runtime_options.eval_script.len > 0) {
                    const trigger = bun.pathLiteral("/[eval]");
                    var entry_point_buf: [bun.MAX_PATH_BYTES + trigger.len]u8 = undefined;
                    const cwd = try std.os.getcwd(&entry_point_buf);
                    @memcpy(entry_point_buf[cwd.len..][0..trigger.len], trigger);
                    try BunJS.Run.boot(ctx, entry_point_buf[0 .. cwd.len + trigger.len]);
                    return;
                }

                const extension: []const u8 = if (ctx.args.entry_points.len > 0)
                    std.fs.path.extension(ctx.args.entry_points[0])
                else
                    @as([]const u8, "");
                // KEYWORDS: open file argv argv0
                if (ctx.args.entry_points.len == 1) {
                    if (strings.eqlComptime(extension, ".lockb")) {
                        for (bun.argv()) |arg| {
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

                if (ctx.runtime_options.if_present) {
                    return;
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

                // if we get here, the command was not parsed
                // or the user just ran `bun` with no arguments
                if (ctx.positionals.len > 0) {
                    Output.warn("failed to parse command\n", .{});
                }
                Output.flush();
                try HelpCommand.exec(allocator);
            },
        }
    }

    fn maybeOpenWithBunJS(ctx: *Command.Context) bool {
        if (ctx.args.entry_points.len == 0)
            return false;

        const script_name_to_search = ctx.args.entry_points[0];

        var file_path = script_name_to_search;
        const file_: anyerror!std.fs.File = brk: {
            if (std.fs.path.isAbsoluteWindows(script_name_to_search)) {
                break :brk bun.openFile(script_name_to_search, .{ .mode = .read_only });
            } else if (!strings.hasPrefix(script_name_to_search, "..") and script_name_to_search[0] != '~') {
                const file_pathZ = brk2: {
                    @memcpy(script_name_buf[0..file_path.len], file_path);
                    script_name_buf[file_path.len] = 0;
                    break :brk2 script_name_buf[0..file_path.len :0];
                };

                break :brk bun.openFileZ(file_pathZ, .{ .mode = .read_only });
            } else {
                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const cwd = bun.getcwd(&path_buf) catch return false;
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
                break :brk bun.openFileZ(file_pathZ, .{ .mode = .read_only });
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
        UpdateCommand,
        UpgradeCommand,
        ReplCommand,
        ReservedCommand,

        pub fn params(comptime cmd: Tag) []const Arguments.ParamType {
            return &comptime switch (cmd) {
                .AutoCommand => Arguments.auto_params,
                .RunCommand => Arguments.run_params,
                .BuildCommand => Arguments.build_params,
                .TestCommand => Arguments.test_params,
                .BunxCommand => Arguments.run_params,
                else => Arguments.base_params_ ++ Arguments.runtime_params_ ++ Arguments.transpiler_params_,
            };
        }

        pub fn printHelp(comptime cmd: Tag, show_all_flags: bool) void {
            switch (cmd) {

                // these commands do not use Context
                // .DiscordCommand => return try DiscordCommand.exec(allocator),
                // .HelpCommand => return try HelpCommand.exec(allocator),
                // .ReservedCommand => return try ReservedCommand.exec(allocator),

                // these commands are implemented in install.zig
                // Command.Tag.InstallCommand => {},
                // Command.Tag.AddCommand => {},
                // Command.Tag.RemoveCommand => {},
                // Command.Tag.UpdateCommand => {},
                // Command.Tag.PackageManagerCommand => {},
                // Command.Tag.LinkCommand => {},
                // Command.Tag.UnlinkCommand => {},

                // fall back to HelpCommand.printWithReason
                Command.Tag.AutoCommand => {
                    HelpCommand.printWithReason(.explicit, show_all_flags);
                },
                Command.Tag.RunCommand => {
                    RunCommand_.printHelp(null);
                },

                .InitCommand => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun init<r> <cyan>[...flags]<r> <blue>[\<entrypoint\> ...]<r>
                        \\  Initialize a Bun project in the current directory.
                        \\  Creates a package.json, tsconfig.json, and bunfig.toml if they don't exist.
                        \\
                        \\<b>Flags<r>:
                        \\      <cyan>--help<r>             Print this menu
                        \\  <cyan>-y, --yes<r>              Accept all default options
                        \\
                        \\<b>Examples:<r>
                        \\  <b><green>bun init<r>
                        \\  <b><green>bun init <cyan>--yes<r>
                    ;

                    Output.pretty(intro_text ++ "\n", .{});
                    Output.flush();
                },

                Command.Tag.BunxCommand => {
                    Output.prettyErrorln(
                        \\<b>Usage: bunx <r><cyan>[...flags]<r> \<package\><d>[@version] [...flags and arguments]<r>
                        \\Execute an npm package executable (CLI), automatically installing into a global shared cache if not installed in node_modules.
                        \\
                        \\Flags:
                        \\  <cyan>--bun<r>      Force the command to run with Bun instead of Node.js
                        \\
                        \\Examples<d>:<r>
                        \\  <b>bunx prisma migrate<r>
                        \\  <b>bunx prettier foo.js<r>
                        \\  <b>bunx<r> <cyan>--bun<r> <b>vite dev foo.js<r>
                        \\
                    , .{});
                },
                Command.Tag.BuildCommand => {
                    const intro_text =
                        \\<b>Usage<r>:
                        \\  Transpile and bundle one or more files.
                        \\  <b><green>bun build<r> <cyan>[...flags]<r> [...entrypoints]
                    ;

                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Frontend web apps:<r>
                        \\  <b><green>bun build<r> <blue>./src/index.ts<r> <cyan>--outfile=bundle.js<r>
                        \\  <b><green>bun build<r> <blue>./index.jsx ./lib/worker.ts<r> <cyan>--minify --splitting --outdir=out<r>
                        \\
                        \\  <d>Bundle code to be run in Bun (reduces server startup time)<r>
                        \\  <b><green>bun build<r> <blue>./server.ts<r> <cyan>--target=bun --outfile=server.js<r>
                        \\
                        \\  <d>Creating a standalone executable (see https://bun.sh/docs/bundler/executables)<r>
                        \\  <b><green>bun build<r> <blue>./cli.ts<r> <cyan>--compile --outfile=my-app<r>
                        \\
                        \\A full list of flags is available at <magenta>https://bun.sh/docs/bundler<r>
                        \\
                    ;

                    Output.pretty(intro_text ++ "\n\n", .{});
                    Output.flush();
                    Output.pretty("<b>Flags:<r>", .{});
                    Output.flush();
                    clap.simpleHelp(&Arguments.build_only_params);
                    Output.pretty("\n\n" ++ outro_text, .{});
                    Output.flush();
                },
                Command.Tag.TestCommand => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun test<r> <cyan>[...flags]<r> <blue>[\<pattern\>...]<r>
                        \\  Run all matching test files and print the results to stdout
                    ;
                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Run all test files <r>
                        \\  <b><green>bun test<r>
                        \\
                        \\  <d>Run all test files with "foo" or "bar" in the file name<r>
                        \\  <b><green>bun test foo bar<r>
                        \\
                        \\  <d>Run all test files, only including tests whose names includes "baz"<r>
                        \\  <b><green>bun test<r> <cyan>--test-name-pattern<r> baz<r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/cli/test<r>
                        \\
                    ;
                    // Output.pretty("\n", .{});
                    Output.pretty(intro_text, .{});
                    Output.flush();
                    Output.pretty("\n\n<b>Flags:<r>", .{});
                    Output.flush();
                    clap.simpleHelp(&Arguments.test_only_params);
                    Output.pretty("\n\n", .{});
                    Output.pretty(outro_text, .{});
                    Output.flush();
                },
                Command.Tag.CreateCommand => {
                    const intro_text =
                        \\<b>Usage<r>:
                        \\  <b><green>bun create<r> <blue>\<template\><r> <cyan>[...flags]<r> <blue>[dest]<r>
                        \\  <b><green>bun create<r> <blue>\<username/repo\><r> <cyan>[...flags]<r> <blue>[dest]<r>
                        \\
                        \\<b>Environment variables:<r>
                        \\  <cyan>GITHUB_ACCESS_TOKEN<r>      <d>Supply a token to download code from GitHub with a higher rate limit<r>
                        \\  <cyan>GITHUB_API_DOMAIN<r>        <d>Configure custom/enterprise GitHub domain. Default "api.github.com".<r>
                        \\  <cyan>NPM_CLIENT<r>               <d>Absolute path to the npm client executable<r>
                    ;

                    const outro_text =
                        \\If given a GitHub repository name, Bun will download it and use it as a template,
                        \\otherwise it will run <b><magenta>bunx create-\<template\><r> with the given arguments.
                        \\
                        \\Learn more about creating new projects: <magenta>https://bun.sh/docs/cli/bun-create<r>
                        \\
                    ;

                    Output.pretty(intro_text, .{});
                    Output.pretty("\n\n", .{});
                    Output.pretty(outro_text, .{});
                    Output.flush();
                },
                Command.Tag.HelpCommand => {
                    HelpCommand.printWithReason(.explicit);
                },
                Command.Tag.UpgradeCommand => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun upgrade<r> <cyan>[...flags]<r>
                        \\  Upgrade Bun
                    ;
                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Install the latest stable version<r>
                        \\  <b><green>bun upgrade<r>
                        \\
                        \\  <d>Install the most recent canary version of Bun<r>
                        \\  <b><green>bun upgrade --canary<r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/installation#upgrading<r>
                        \\
                    ;
                    Output.pretty(intro_text, .{});
                    Output.pretty("\n\n", .{});
                    Output.flush();
                    Output.pretty(outro_text, .{});
                    Output.flush();
                },
                Command.Tag.ReplCommand => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun repl<r> <cyan>[...flags]<r>
                        \\  Open a Bun REPL
                        \\
                    ;

                    Output.pretty(intro_text, .{});
                    Output.flush();
                },

                Command.Tag.GetCompletionsCommand => {
                    Output.pretty("<b>Usage<r>: <b><green>bun getcompletes<r>", .{});
                    Output.flush();
                },
                Command.Tag.InstallCompletionsCommand => {
                    Output.pretty("<b>Usage<r>: <b><green>bun completions<r>", .{});
                    Output.flush();
                },
                else => {
                    HelpCommand.printWithReason(.explicit);
                },
            }
        }

        pub fn readGlobalConfig(this: Tag) bool {
            return switch (this) {
                .BunxCommand, .PackageManagerCommand, .InstallCommand, .AddCommand, .RemoveCommand, .UpdateCommand => true,
                else => false,
            };
        }

        pub fn isNPMRelated(this: Tag) bool {
            return switch (this) {
                .BunxCommand, .LinkCommand, .UnlinkCommand, .PackageManagerCommand, .InstallCommand, .AddCommand, .RemoveCommand, .UpdateCommand => true,
                else => false,
            };
        }

        pub const loads_config: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(false, .{
            .BuildCommand = true,
            .TestCommand = true,
            .InstallCommand = true,
            .AddCommand = true,
            .RemoveCommand = true,
            .UpdateCommand = true,
            .PackageManagerCommand = true,
            .BunxCommand = true,
            .AutoCommand = true,
            .RunCommand = true,
        });

        pub const always_loads_config: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(false, .{
            .BuildCommand = true,
            .TestCommand = true,
            .InstallCommand = true,
            .AddCommand = true,
            .RemoveCommand = true,
            .UpdateCommand = true,
            .PackageManagerCommand = true,
            .BunxCommand = true,
        });

        pub const uses_global_options: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(true, .{
            .CreateCommand = false,
            .InstallCommand = false,
            .AddCommand = false,
            .RemoveCommand = false,
            .UpdateCommand = false,
            .PackageManagerCommand = false,
            .LinkCommand = false,
            .UnlinkCommand = false,
            .BunxCommand = false,
        });
    };
};
