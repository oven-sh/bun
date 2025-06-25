const Arguments = @This();

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
    var file = try bun.openFileZ(&try std.posix.toPosixPath(outpath), std.fs.File.OpenFlags{ .mode = .read_only });
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

pub const base_params_ = (if (Environment.show_crash_trace) debug_params else [_]ParamType{}) ++ [_]ParamType{
    clap.parseParam("--env-file <STR>...               Load environment variables from the specified file(s)") catch unreachable,
    clap.parseParam("--cwd <STR>                       Absolute path to resolve files & entry points from. This just changes the process' cwd.") catch unreachable,
    clap.parseParam("-c, --config <PATH>?              Specify path to Bun config file. Default <d>$cwd<r>/bunfig.toml") catch unreachable,
    clap.parseParam("-h, --help                        Display this menu and exit") catch unreachable,
} ++ (if (builtin.have_error_return_tracing) [_]ParamType{
    // This will print more error return traces, as a debug aid
    clap.parseParam("--verbose-error-trace             Dump error return traces") catch unreachable,
} else [_]ParamType{}) ++ [_]ParamType{
    clap.parseParam("<POS>...") catch unreachable,
};

const debug_params = [_]ParamType{
    clap.parseParam("--breakpoint-resolve <STR>...     DEBUG MODE: breakpoint when resolving something that includes this string") catch unreachable,
    clap.parseParam("--breakpoint-print <STR>...       DEBUG MODE: breakpoint when printing something that includes this string") catch unreachable,
};

pub const transpiler_params_ = [_]ParamType{
    clap.parseParam("--main-fields <STR>...             Main fields to lookup in package.json. Defaults to --target dependent") catch unreachable,
    clap.parseParam("--preserve-symlinks               Preserve symlinks when resolving files") catch unreachable,
    clap.parseParam("--preserve-symlinks-main          Preserve symlinks when resolving the main entry point") catch unreachable,
    clap.parseParam("--extension-order <STR>...        Defaults to: .tsx,.ts,.jsx,.js,.json ") catch unreachable,
    clap.parseParam("--tsconfig-override <STR>          Specify custom tsconfig.json. Default <d>$cwd<r>/tsconfig.json") catch unreachable,
    clap.parseParam("-d, --define <STR>...              Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:\"development\". Values are parsed as JSON.") catch unreachable,
    clap.parseParam("--drop <STR>...                   Remove function calls, e.g. --drop=console removes all console.* calls.") catch unreachable,
    clap.parseParam("-l, --loader <STR>...             Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi") catch unreachable,
    clap.parseParam("--no-macros                       Disable macros from being executed in the bundler, transpiler and runtime") catch unreachable,
    clap.parseParam("--jsx-factory <STR>               Changes the function called when compiling JSX elements using the classic JSX runtime") catch unreachable,
    clap.parseParam("--jsx-fragment <STR>              Changes the function called when compiling JSX fragments") catch unreachable,
    clap.parseParam("--jsx-import-source <STR>         Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: \"react\"") catch unreachable,
    clap.parseParam("--jsx-runtime <STR>               \"automatic\" (default) or \"classic\"") catch unreachable,
    clap.parseParam("--ignore-dce-annotations          Ignore tree-shaking annotations such as @__PURE__") catch unreachable,
};
pub const runtime_params_ = [_]ParamType{
    clap.parseParam("--watch                           Automatically restart the process on file change") catch unreachable,
    clap.parseParam("--hot                             Enable auto reload in the Bun runtime, test runner, or bundler") catch unreachable,
    clap.parseParam("--no-clear-screen                 Disable clearing the terminal screen on reload when --hot or --watch is enabled") catch unreachable,
    clap.parseParam("--smol                            Use less memory, but run garbage collection more often") catch unreachable,
    clap.parseParam("-r, --preload <STR>...            Import a module before other modules are loaded") catch unreachable,
    clap.parseParam("--require <STR>...                Alias of --preload, for Node.js compatibility") catch unreachable,
    clap.parseParam("--import <STR>...                 Alias of --preload, for Node.js compatibility") catch unreachable,
    clap.parseParam("--inspect <STR>?                  Activate Bun's debugger") catch unreachable,
    clap.parseParam("--inspect-wait <STR>?             Activate Bun's debugger, wait for a connection before executing") catch unreachable,
    clap.parseParam("--inspect-brk <STR>?              Activate Bun's debugger, set breakpoint on first line of code and wait") catch unreachable,
    clap.parseParam("--if-present                      Exit without an error if the entrypoint does not exist") catch unreachable,
    clap.parseParam("--no-install                      Disable auto install in the Bun runtime") catch unreachable,
    clap.parseParam("--install <STR>                   Configure auto-install behavior. One of \"auto\" (default, auto-installs when no node_modules), \"fallback\" (missing packages only), \"force\" (always).") catch unreachable,
    clap.parseParam("-i                                Auto-install dependencies during execution. Equivalent to --install=fallback.") catch unreachable,
    clap.parseParam("-e, --eval <STR>                  Evaluate argument as a script") catch unreachable,
    clap.parseParam("-p, --print <STR>                 Evaluate argument as a script and print the result") catch unreachable,
    clap.parseParam("--prefer-offline                  Skip staleness checks for packages in the Bun runtime and resolve from disk") catch unreachable,
    clap.parseParam("--prefer-latest                   Use the latest matching versions of packages in the Bun runtime, always checking npm") catch unreachable,
    clap.parseParam("--port <STR>                      Set the default port for Bun.serve") catch unreachable,
    clap.parseParam("-u, --origin <STR>") catch unreachable,
    clap.parseParam("--conditions <STR>...             Pass custom conditions to resolve") catch unreachable,
    clap.parseParam("--fetch-preconnect <STR>...       Preconnect to a URL while code is loading") catch unreachable,
    clap.parseParam("--max-http-header-size <INT>      Set the maximum size of HTTP headers in bytes. Default is 16KiB") catch unreachable,
    clap.parseParam("--dns-result-order <STR>          Set the default order of DNS lookup results. Valid orders: verbatim (default), ipv4first, ipv6first") catch unreachable,
    clap.parseParam("--expose-gc                       Expose gc() on the global object. Has no effect on Bun.gc().") catch unreachable,
    clap.parseParam("--no-deprecation                  Suppress all reporting of the custom deprecation.") catch unreachable,
    clap.parseParam("--throw-deprecation               Determine whether or not deprecation warnings result in errors.") catch unreachable,
    clap.parseParam("--title <STR>                     Set the process title") catch unreachable,
    clap.parseParam("--zero-fill-buffers                Boolean to force Buffer.allocUnsafe(size) to be zero-filled.") catch unreachable,
    clap.parseParam("--redis-preconnect                Preconnect to $REDIS_URL at startup") catch unreachable,
    clap.parseParam("--no-addons                       Throw an error if process.dlopen is called, and disable export condition \"node-addons\"") catch unreachable,
    clap.parseParam("--unhandled-rejections <STR>      One of \"strict\", \"throw\", \"warn\", \"none\", or \"warn-with-error-code\"") catch unreachable,
};

pub const auto_or_run_params = [_]ParamType{
    clap.parseParam("-F, --filter <STR>...             Run a script in all workspace packages matching the pattern") catch unreachable,
    clap.parseParam("-b, --bun                         Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)") catch unreachable,
    clap.parseParam("--shell <STR>                     Control the shell used for package.json scripts. Supports either 'bun' or 'system'") catch unreachable,
};

pub const auto_only_params = [_]ParamType{
    // clap.parseParam("--all") catch unreachable,
    clap.parseParam("--silent                          Don't print the script command") catch unreachable,
    clap.parseParam("--elide-lines <NUMBER>            Number of lines of script output shown when using --filter (default: 10). Set to 0 to show all lines.") catch unreachable,
    clap.parseParam("-v, --version                     Print version and exit") catch unreachable,
    clap.parseParam("--revision                        Print version with revision and exit") catch unreachable,
} ++ auto_or_run_params;
pub const auto_params = auto_only_params ++ runtime_params_ ++ transpiler_params_ ++ base_params_;

pub const run_only_params = [_]ParamType{
    clap.parseParam("--silent                          Don't print the script command") catch unreachable,
    clap.parseParam("--elide-lines <NUMBER>            Number of lines of script output shown when using --filter (default: 10). Set to 0 to show all lines.") catch unreachable,
} ++ auto_or_run_params;
pub const run_params = run_only_params ++ runtime_params_ ++ transpiler_params_ ++ base_params_;

pub const bunx_commands = [_]ParamType{
    clap.parseParam("-b, --bun                         Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)") catch unreachable,
} ++ auto_only_params;

pub const build_only_params = [_]ParamType{
    clap.parseParam("--production                     Set NODE_ENV=production and enable minification") catch unreachable,
    clap.parseParam("--compile                        Generate a standalone Bun executable containing your bundled code. Implies --production") catch unreachable,
    clap.parseParam("--bytecode                       Use a bytecode cache") catch unreachable,
    clap.parseParam("--watch                          Automatically restart the process on file change") catch unreachable,
    clap.parseParam("--no-clear-screen                Disable clearing the terminal screen on reload when --watch is enabled") catch unreachable,
    clap.parseParam("--target <STR>                   The intended execution environment for the bundle. \"browser\", \"bun\" or \"node\"") catch unreachable,
    clap.parseParam("--outdir <STR>                   Default to \"dist\" if multiple files") catch unreachable,
    clap.parseParam("--outfile <STR>                  Write to a file") catch unreachable,
    clap.parseParam("--sourcemap <STR>?               Build with sourcemaps - 'linked', 'inline', 'external', or 'none'") catch unreachable,
    clap.parseParam("--banner <STR>                   Add a banner to the bundled output such as \"use client\"; for a bundle being used with RSCs") catch unreachable,
    clap.parseParam("--footer <STR>                   Add a footer to the bundled output such as // built with bun!") catch unreachable,
    clap.parseParam("--format <STR>                   Specifies the module format to build to. \"esm\", \"cjs\" and \"iife\" are supported. Defaults to \"esm\".") catch unreachable,
    clap.parseParam("--root <STR>                     Root directory used for multiple entry points") catch unreachable,
    clap.parseParam("--splitting                      Enable code splitting") catch unreachable,
    clap.parseParam("--public-path <STR>              A prefix to be appended to any import paths in bundled code") catch unreachable,
    clap.parseParam("-e, --external <STR>...          Exclude module from transpilation (can use * wildcards). ex: -e react") catch unreachable,
    clap.parseParam("--packages <STR>                 Add dependencies to bundle or keep them external. \"external\", \"bundle\" is supported. Defaults to \"bundle\".") catch unreachable,
    clap.parseParam("--entry-naming <STR>             Customize entry point filenames. Defaults to \"[dir]/[name].[ext]\"") catch unreachable,
    clap.parseParam("--chunk-naming <STR>             Customize chunk filenames. Defaults to \"[name]-[hash].[ext]\"") catch unreachable,
    clap.parseParam("--asset-naming <STR>             Customize asset filenames. Defaults to \"[name]-[hash].[ext]\"") catch unreachable,
    clap.parseParam("--react-fast-refresh             Enable React Fast Refresh transform (does not emit hot-module code, use this for testing)") catch unreachable,
    clap.parseParam("--no-bundle                      Transpile file only, do not bundle") catch unreachable,
    clap.parseParam("--emit-dce-annotations           Re-emit DCE annotations in bundles. Enabled by default unless --minify-whitespace is passed.") catch unreachable,
    clap.parseParam("--minify                         Enable all minification flags") catch unreachable,
    clap.parseParam("--minify-syntax                  Minify syntax and inline data") catch unreachable,
    clap.parseParam("--minify-whitespace              Minify whitespace") catch unreachable,
    clap.parseParam("--minify-identifiers             Minify identifiers") catch unreachable,
    clap.parseParam("--css-chunking                   Chunk CSS files together to reduce duplicated CSS loaded in a browser. Only has an effect when multiple entrypoints import CSS") catch unreachable,
    clap.parseParam("--dump-environment-variables") catch unreachable,
    clap.parseParam("--conditions <STR>...            Pass custom conditions to resolve") catch unreachable,
    clap.parseParam("--app                            (EXPERIMENTAL) Build a web app for production using Bun Bake.") catch unreachable,
    clap.parseParam("--server-components              (EXPERIMENTAL) Enable server components") catch unreachable,
    clap.parseParam("--env <inline|prefix*|disable>   Inline environment variables into the bundle as process.env.${name}. Defaults to 'disable'. To inline environment variables matching a prefix, use my prefix like 'FOO_PUBLIC_*'.") catch unreachable,
    clap.parseParam("--windows-hide-console           When using --compile targeting Windows, prevent a Command prompt from opening alongside the executable") catch unreachable,
    clap.parseParam("--windows-icon <STR>             When using --compile targeting Windows, assign an executable icon") catch unreachable,
} ++ if (FeatureFlags.bake_debugging_features) [_]ParamType{
    clap.parseParam("--debug-dump-server-files        When --app is set, dump all server files to disk even when building statically") catch unreachable,
    clap.parseParam("--debug-no-minify                When --app is set, do not minify anything") catch unreachable,
} else .{};
pub const build_params = build_only_params ++ transpiler_params_ ++ base_params_;

// TODO: update test completions
pub const test_only_params = [_]ParamType{
    clap.parseParam("--timeout <NUMBER>               Set the per-test timeout in milliseconds, default is 5000.") catch unreachable,
    clap.parseParam("-u, --update-snapshots           Update snapshot files") catch unreachable,
    clap.parseParam("--rerun-each <NUMBER>            Re-run each test file <NUMBER> times, helps catch certain bugs") catch unreachable,
    clap.parseParam("--only                           Only run tests that are marked with \"test.only()\"") catch unreachable,
    clap.parseParam("--todo                           Include tests that are marked with \"test.todo()\"") catch unreachable,
    clap.parseParam("--coverage                       Generate a coverage profile") catch unreachable,
    clap.parseParam("--coverage-reporter <STR>...     Report coverage in 'text' and/or 'lcov'. Defaults to 'text'.") catch unreachable,
    clap.parseParam("--coverage-dir <STR>             Directory for coverage files. Defaults to 'coverage'.") catch unreachable,
    clap.parseParam("--bail <NUMBER>?                 Exit the test suite after <NUMBER> failures. If you do not specify a number, it defaults to 1.") catch unreachable,
    clap.parseParam("-t, --test-name-pattern <STR>    Run only tests with a name that matches the given regex.") catch unreachable,
    clap.parseParam("--reporter <STR>                 Specify the test reporter. Currently --reporter=junit is the only supported format.") catch unreachable,
    clap.parseParam("--reporter-outfile <STR>         The output file used for the format from --reporter.") catch unreachable,
};
pub const test_params = test_only_params ++ runtime_params_ ++ transpiler_params_ ++ base_params_;

pub fn loadConfigPath(allocator: std.mem.Allocator, auto_loaded: bool, config_path: [:0]const u8, ctx: Command.Context, comptime cmd: Command.Tag) !void {
    var config_file = switch (bun.sys.openA(config_path, bun.O.RDONLY, 0)) {
        .result => |fd| fd.stdFile(),
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
    const contents = config_file.readToEndAlloc(allocator, std.math.maxInt(usize)) catch |err| {
        if (auto_loaded) return;
        Output.prettyErrorln("<r><red>error<r>: {s} reading config \"{s}\"", .{
            @errorName(err),
            config_path,
        });
        Global.exit(1);
    };

    js_ast.Stmt.Data.Store.create();
    js_ast.Expr.Data.Store.create();
    defer {
        js_ast.Stmt.Data.Store.reset();
        js_ast.Expr.Data.Store.reset();
    }
    const original_level = ctx.log.level;
    defer {
        ctx.log.level = original_level;
    }
    ctx.log.level = logger.Log.Level.warn;
    try Bunfig.parse(allocator, &logger.Source.initPathString(bun.asByteSlice(config_path), contents), ctx, cmd);
}

fn getHomeConfigPath(buf: *bun.PathBuffer) ?[:0]const u8 {
    if (bun.getenvZ("XDG_CONFIG_HOME") orelse bun.getenvZ(bun.DotEnv.home_env)) |data_dir| {
        var paths = [_]string{".bunfig.toml"};
        return resolve_path.joinAbsStringBufZ(data_dir, buf, &paths, .auto);
    }

    return null;
}
pub fn loadConfig(allocator: std.mem.Allocator, user_config_path_: ?string, ctx: Command.Context, comptime cmd: Command.Tag) OOM!void {
    var config_buf: bun.PathBuffer = undefined;
    if (comptime cmd.readGlobalConfig()) {
        if (!ctx.has_loaded_global_config) {
            ctx.has_loaded_global_config = true;

            if (getHomeConfigPath(&config_buf)) |path| {
                loadConfigPath(allocator, true, path, ctx, comptime cmd) catch |err| {
                    if (ctx.log.hasAny()) {
                        ctx.log.print(Output.errorWriter()) catch {};
                    }
                    if (ctx.log.hasAny()) Output.printError("\n", .{});
                    Output.err(err, "failed to load bunfig", .{});
                    Global.crash();
                };
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
            var secondbuf: bun.PathBuffer = undefined;
            const cwd = bun.getcwd(&secondbuf) catch return;

            ctx.args.absolute_working_dir = try allocator.dupeZ(u8, cwd);
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

    loadConfigPath(allocator, auto_loaded, config_path, ctx, comptime cmd) catch |err| {
        if (ctx.log.hasAny()) {
            ctx.log.print(Output.errorWriter()) catch {};
        }
        if (ctx.log.hasAny()) Output.printError("\n", .{});
        Output.err(err, "failed to load bunfig", .{});
        Global.crash();
    };
}

pub fn loadConfigWithCmdArgs(
    comptime cmd: Command.Tag,
    allocator: std.mem.Allocator,
    args: clap.Args(clap.Help, cmd.params()),
    ctx: Command.Context,
) OOM!void {
    return try loadConfig(allocator, args.option("--config"), ctx, comptime cmd);
}

pub fn parse(allocator: std.mem.Allocator, ctx: Command.Context, comptime cmd: Command.Tag) !Api.TransformOptions {
    var diag = clap.Diagnostic{};
    const params_to_parse = comptime cmd.params();

    var args = clap.parse(clap.Help, params_to_parse, .{
        .diagnostic = &diag,
        .allocator = allocator,
        .stop_after_positional_at = switch (cmd) {
            .RunCommand => 2,
            .AutoCommand, .RunAsNodeCommand => 1,
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

    if (builtin.have_error_return_tracing) {
        if (args.flag("--verbose-error-trace")) {
            bun.crash_handler.verbose_error_trace = true;
        }
    }

    var cwd: [:0]u8 = undefined;
    if (args.option("--cwd")) |cwd_arg| {
        cwd = brk: {
            var outbuf: bun.PathBuffer = undefined;
            const out = bun.path.joinAbs(try bun.getcwd(&outbuf), .loose, cwd_arg);
            bun.sys.chdir("", out).unwrap() catch |err| {
                Output.err(err, "Could not change directory to \"{s}\"\n", .{cwd_arg});
                Global.exit(1);
            };
            break :brk try allocator.dupeZ(u8, out);
        };
    } else {
        cwd = try bun.getcwdAlloc(allocator);
    }

    if (cmd == .RunCommand or cmd == .AutoCommand) {
        ctx.filters = args.options("--filter");

        if (args.option("--elide-lines")) |elide_lines| {
            if (elide_lines.len > 0) {
                ctx.bundler_options.elide_lines = std.fmt.parseInt(usize, elide_lines, 10) catch {
                    Output.prettyErrorln("<r><red>error<r>: Invalid elide-lines: \"{s}\"", .{elide_lines});
                    Global.exit(1);
                };
            }
        }
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

        if (args.options("--coverage-reporter").len > 0) {
            ctx.test_options.coverage.reporters = .{ .text = false, .lcov = false };
            for (args.options("--coverage-reporter")) |reporter| {
                if (bun.strings.eqlComptime(reporter, "text")) {
                    ctx.test_options.coverage.reporters.text = true;
                } else if (bun.strings.eqlComptime(reporter, "lcov")) {
                    ctx.test_options.coverage.reporters.lcov = true;
                } else {
                    Output.prettyErrorln("<r><red>error<r>: --coverage-reporter received invalid reporter: \"{s}\"", .{reporter});
                    Global.exit(1);
                }
            }
        }

        if (args.option("--reporter-outfile")) |reporter_outfile| {
            ctx.test_options.reporter_outfile = reporter_outfile;
        }

        if (args.option("--reporter")) |reporter| {
            if (strings.eqlComptime(reporter, "junit")) {
                if (ctx.test_options.reporter_outfile == null) {
                    Output.errGeneric("--reporter=junit expects an output file from --reporter-outfile", .{});
                    Global.crash();
                }
                ctx.test_options.file_reporter = .junit;
            } else {
                Output.errGeneric("unrecognized reporter format: '{s}'. Currently, only 'junit' is supported", .{reporter});
                Global.crash();
            }
        }

        if (args.option("--coverage-dir")) |dir| {
            ctx.test_options.coverage.reports_directory = dir;
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
                        bun.fmt.QuotedFormatter{
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

    const defines_tuple = try DefineColonList.resolve(allocator, args.options("--define"));

    if (defines_tuple.keys.len > 0) {
        opts.define = .{
            .keys = defines_tuple.keys,
            .values = defines_tuple.values,
        };
    }

    opts.drop = args.options("--drop");

    // Node added a `--loader` flag (that's kinda like `--register`). It's
    // completely different from ours.
    const loader_tuple = if (cmd != .RunAsNodeCommand)
        try LoaderColonList.resolve(allocator, args.options("--loader"))
    else
        .{ .keys = &[_]u8{}, .values = &[_]Api.Loader{} };

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

    opts.main_fields = args.options("--main-fields");
    // we never actually supported inject.
    // opts.inject = args.options("--inject");
    opts.env_files = args.options("--env-file");
    opts.extension_order = args.options("--extension-order");

    if (args.flag("--preserve-symlinks")) {
        opts.preserve_symlinks = true;
    }
    if (args.flag("--preserve-symlinks-main")) {
        ctx.runtime_options.preserve_symlinks_main = true;
    }

    ctx.passthrough = args.remaining();

    if (cmd == .AutoCommand or cmd == .RunCommand or cmd == .BuildCommand or cmd == .TestCommand) {
        if (args.options("--conditions").len > 0) {
            opts.conditions = args.options("--conditions");
        }
    }

    // runtime commands
    if (cmd == .AutoCommand or cmd == .RunCommand or cmd == .TestCommand or cmd == .RunAsNodeCommand) {
        {
            const preloads = args.options("--preload");
            const preloads2 = args.options("--require");
            const preloads3 = args.options("--import");
            const preload4 = bun.getenvZ("BUN_INSPECT_PRELOAD");

            const total_preloads = ctx.preloads.len + preloads.len + preloads2.len + preloads3.len + (if (preload4 != null) @as(usize, 1) else @as(usize, 0));
            if (total_preloads > 0) {
                var all = std.ArrayList(string).initCapacity(ctx.allocator, total_preloads) catch unreachable;
                if (ctx.preloads.len > 0) all.appendSliceAssumeCapacity(ctx.preloads);
                if (preloads.len > 0) all.appendSliceAssumeCapacity(preloads);
                if (preloads2.len > 0) all.appendSliceAssumeCapacity(preloads2);
                if (preloads3.len > 0) all.appendSliceAssumeCapacity(preloads3);
                if (preload4) |p| all.appendAssumeCapacity(p);
                ctx.preloads = all.items;
            }
        }

        if (args.flag("--hot")) {
            ctx.debug.hot_reload = .hot;
            if (args.flag("--no-clear-screen")) {
                bun.DotEnv.Loader.has_no_clear_screen_cli_flag = true;
            }
        } else if (args.flag("--watch")) {
            ctx.debug.hot_reload = .watch;

            // Windows applies this to the watcher child process.
            // The parent process is unable to re-launch itself
            if (!bun.Environment.isWindows)
                bun.auto_reload_on_crash = true;

            if (args.flag("--no-clear-screen")) {
                bun.DotEnv.Loader.has_no_clear_screen_cli_flag = true;
            }
        }

        if (args.option("--origin")) |origin| {
            opts.origin = origin;
        }

        if (args.flag("--redis-preconnect")) {
            ctx.runtime_options.redis_preconnect = true;
        }

        if (args.flag("--no-addons")) {
            // used for disabling process.dlopen and
            // for disabling export condition "node-addons"
            opts.allow_addons = false;
        }

        if (args.option("--unhandled-rejections")) |unhandled_rejections| {
            opts.unhandled_rejections = Api.UnhandledRejections.map.get(unhandled_rejections) orelse {
                Output.errGeneric("Invalid value for --unhandled-rejections: \"{s}\". Must be one of \"strict\", \"throw\", \"warn\", \"none\", \"warn-with-error-code\"\n", .{unhandled_rejections});
                Global.exit(1);
            };
        }

        if (args.option("--port")) |port_str| {
            if (comptime cmd == .RunAsNodeCommand) {
                // TODO: prevent `node --port <script>` from working
                ctx.runtime_options.eval.script = port_str;
                ctx.runtime_options.eval.eval_and_print = true;
            } else {
                opts.port = std.fmt.parseInt(u16, port_str, 10) catch {
                    Output.errFmt(
                        bun.fmt.outOfRange(port_str, .{
                            .field_name = "--port",
                            .min = 0,
                            .max = std.math.maxInt(u16),
                        }),
                    );
                    Output.note("To evaluate TypeScript here, use 'bun --print'", .{});
                    Global.exit(1);
                };
            }
        }

        if (args.option("--max-http-header-size")) |size_str| {
            const size = std.fmt.parseInt(usize, size_str, 10) catch {
                Output.errGeneric("Invalid value for --max-http-header-size: \"{s}\". Must be a positive integer\n", .{size_str});
                Global.exit(1);
            };
            if (size == 0) {
                bun.http.max_http_header_size = 1024 * 1024 * 1024;
            } else {
                bun.http.max_http_header_size = size;
            }
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
                Output.errGeneric("Invalid value for --install: \"{s}\". Must be either \"auto\", \"fallback\", \"force\", or \"disable\"\n", .{enum_value});
                Global.exit(1);
            }
        }

        if (args.option("--print")) |script| {
            ctx.runtime_options.eval.script = script;
            ctx.runtime_options.eval.eval_and_print = true;
        } else if (args.option("--eval")) |script| {
            ctx.runtime_options.eval.script = script;
        }
        ctx.runtime_options.if_present = args.flag("--if-present");
        ctx.runtime_options.smol = args.flag("--smol");
        ctx.runtime_options.preconnect = args.options("--fetch-preconnect");
        ctx.runtime_options.expose_gc = args.flag("--expose-gc");

        if (args.option("--dns-result-order")) |order| {
            ctx.runtime_options.dns_result_order = order;
        }

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

        if (args.flag("--no-deprecation")) {
            Bun__Node__ProcessNoDeprecation = true;
        }
        if (args.flag("--throw-deprecation")) {
            Bun__Node__ProcessThrowDeprecation = true;
        }
        if (args.option("--title")) |title| {
            CLI.Bun__Node__ProcessTitle = title;
        }
        if (args.flag("--zero-fill-buffers")) {
            Bun__Node__ZeroFillBuffers = true;
        }
    }

    if (opts.port != null and opts.origin == null) {
        opts.origin = try std.fmt.allocPrint(allocator, "http://localhost:{d}/", .{opts.port.?});
    }

    const output_dir: ?string = null;
    const output_file: ?string = null;

    ctx.bundler_options.ignore_dce_annotations = args.flag("--ignore-dce-annotations");

    if (cmd == .BuildCommand) {
        ctx.bundler_options.transform_only = args.flag("--no-bundle");
        ctx.bundler_options.bytecode = args.flag("--bytecode");

        const production = args.flag("--production");

        if (args.flag("--app")) {
            if (!bun.FeatureFlags.bake()) {
                Output.errGeneric("To use the experimental \"--app\" option, upgrade to the canary build of bun via \"bun upgrade --canary\"", .{});
                Global.crash();
            }

            ctx.bundler_options.bake = true;
            ctx.bundler_options.bake_debug_dump_server = bun.FeatureFlags.bake_debugging_features and
                args.flag("--debug-dump-server-files");
            ctx.bundler_options.bake_debug_disable_minify = bun.FeatureFlags.bake_debugging_features and
                args.flag("--debug-no-minify");
        }

        // TODO: support --format=esm
        if (ctx.bundler_options.bytecode) {
            ctx.bundler_options.output_format = .cjs;
            ctx.args.target = .bun;
        }

        if (args.option("--public-path")) |public_path| {
            ctx.bundler_options.public_path = public_path;
        }

        if (args.option("--banner")) |banner| {
            ctx.bundler_options.banner = banner;
        }

        if (args.option("--footer")) |footer| {
            ctx.bundler_options.footer = footer;
        }

        const minify_flag = args.flag("--minify") or production;
        ctx.bundler_options.minify_syntax = minify_flag or args.flag("--minify-syntax");
        ctx.bundler_options.minify_whitespace = minify_flag or args.flag("--minify-whitespace");
        ctx.bundler_options.minify_identifiers = minify_flag or args.flag("--minify-identifiers");

        ctx.bundler_options.css_chunking = args.flag("--css-chunking");

        ctx.bundler_options.emit_dce_annotations = args.flag("--emit-dce-annotations") or
            !ctx.bundler_options.minify_whitespace;

        if (args.options("--external").len > 0) {
            var externals = try allocator.alloc([]const u8, args.options("--external").len);
            for (args.options("--external"), 0..) |external, i| {
                externals[i] = external;
            }
            opts.external = externals;
        }

        if (args.option("--packages")) |packages| {
            if (strings.eqlComptime(packages, "bundle")) {
                opts.packages = .bundle;
            } else if (strings.eqlComptime(packages, "external")) {
                opts.packages = .external;
            } else {
                Output.prettyErrorln("<r><red>error<r>: Invalid packages setting: \"{s}\"", .{packages});
                Global.crash();
            }
        }

        if (args.option("--env")) |env| {
            if (strings.indexOfChar(env, '*')) |asterisk| {
                if (asterisk == 0) {
                    ctx.bundler_options.env_behavior = .load_all;
                } else {
                    ctx.bundler_options.env_behavior = .prefix;
                    ctx.bundler_options.env_prefix = env[0..asterisk];
                }
            } else if (strings.eqlComptime(env, "inline") or strings.eqlComptime(env, "1")) {
                ctx.bundler_options.env_behavior = .load_all;
            } else if (strings.eqlComptime(env, "disable") or strings.eqlComptime(env, "0")) {
                ctx.bundler_options.env_behavior = .load_all_without_inlining;
            } else {
                Output.prettyErrorln("<r><red>error<r>: Expected 'env' to be 'inline', 'disable', or a prefix with a '*' character", .{});
                Global.crash();
            }
        }

        const TargetMatcher = strings.ExactSizeMatcher(8);
        if (args.option("--target")) |_target| brk: {
            if (comptime cmd == .BuildCommand) {
                if (args.flag("--compile")) {
                    if (_target.len > 4 and strings.hasPrefixComptime(_target, "bun-")) {
                        ctx.bundler_options.compile_target = CLI.Cli.CompileTarget.from(_target[3..]);
                        if (!ctx.bundler_options.compile_target.isSupported()) {
                            Output.errGeneric("Unsupported compile target: {}\n", .{ctx.bundler_options.compile_target});
                            Global.exit(1);
                        }
                        opts.target = .bun;
                        break :brk;
                    }
                }
            }

            opts.target = opts.target orelse switch (TargetMatcher.match(_target)) {
                TargetMatcher.case("browser") => Api.Target.browser,
                TargetMatcher.case("node") => Api.Target.node,
                TargetMatcher.case("macro") => if (cmd == .BuildCommand) Api.Target.bun_macro else Api.Target.bun,
                TargetMatcher.case("bun") => Api.Target.bun,
                else => CLI.invalidTarget(&diag, _target),
            };

            if (opts.target.? == .bun) {
                ctx.debug.run_in_bun = opts.target.? == .bun;
            } else {
                if (ctx.bundler_options.bytecode) {
                    Output.errGeneric("target must be 'bun' when bytecode is true. Received: {s}", .{@tagName(opts.target.?)});
                    Global.exit(1);
                }

                if (ctx.bundler_options.bake) {
                    Output.errGeneric("target must be 'bun' when using --app. Received: {s}", .{@tagName(opts.target.?)});
                }
            }
        }

        if (args.flag("--watch")) {
            ctx.debug.hot_reload = .watch;
            bun.auto_reload_on_crash = true;

            if (args.flag("--no-clear-screen")) {
                bun.DotEnv.Loader.has_no_clear_screen_cli_flag = true;
            }
        }

        if (args.flag("--compile")) {
            ctx.bundler_options.compile = true;
            ctx.bundler_options.inline_entrypoint_import_meta_main = true;
        }

        if (args.flag("--windows-hide-console")) {
            // --windows-hide-console technically doesnt depend on WinAPI, but since since --windows-icon
            // does, all of these customization options have been gated to windows-only
            if (!Environment.isWindows) {
                Output.errGeneric("Using --windows-hide-console is only available when compiling on Windows", .{});
                Global.crash();
            }
            if (!ctx.bundler_options.compile) {
                Output.errGeneric("--windows-hide-console requires --compile", .{});
                Global.crash();
            }
            ctx.bundler_options.windows_hide_console = true;
        }
        if (args.option("--windows-icon")) |path| {
            if (!Environment.isWindows) {
                Output.errGeneric("Using --windows-icon is only available when compiling on Windows", .{});
                Global.crash();
            }
            if (!ctx.bundler_options.compile) {
                Output.errGeneric("--windows-icon requires --compile", .{});
                Global.crash();
            }
            ctx.bundler_options.windows_icon = path;
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
                Output.errGeneric("Invalid format - must be esm, cjs, or iife", .{});
                Global.crash();
            };

            switch (format) {
                .internal_bake_dev => {
                    bun.Output.warn("--format={s} is for debugging only, and may experience breaking changes at any moment", .{format_str});
                    bun.Output.flush();
                },
                .cjs => {
                    if (ctx.args.target == null) {
                        ctx.args.target = .node;
                    }
                },
                else => {},
            }

            ctx.bundler_options.output_format = format;
            if (format != .cjs and ctx.bundler_options.bytecode) {
                Output.errGeneric("format must be 'cjs' when bytecode is true. Eventually we'll add esm support as well.", .{});
                Global.exit(1);
            }
        }

        if (args.flag("--splitting")) {
            ctx.bundler_options.code_splitting = true;
        }

        if (args.option("--entry-naming")) |entry_naming| {
            ctx.bundler_options.entry_naming = try strings.concat(allocator, &.{ "./", bun.strings.removeLeadingDotSlash(entry_naming) });
        }

        if (args.option("--chunk-naming")) |chunk_naming| {
            ctx.bundler_options.chunk_naming = try strings.concat(allocator, &.{ "./", bun.strings.removeLeadingDotSlash(chunk_naming) });
        }

        if (args.option("--asset-naming")) |asset_naming| {
            ctx.bundler_options.asset_naming = try strings.concat(allocator, &.{ "./", bun.strings.removeLeadingDotSlash(asset_naming) });
        }

        if (args.flag("--server-components")) {
            ctx.bundler_options.server_components = true;
            if (opts.target) |target| {
                if (!bun.options.Target.from(target).isServerSide()) {
                    bun.Output.errGeneric("Cannot use client-side --target={s} with --server-components", .{@tagName(target)});
                    Global.crash();
                } else {
                    opts.target = .bun;
                }
            }
        }

        if (args.flag("--react-fast-refresh")) {
            ctx.bundler_options.react_fast_refresh = true;
        }

        if (args.option("--sourcemap")) |setting| {
            if (setting.len == 0) {
                // In the future, Bun is going to make this default to .linked
                opts.source_map = .linked;
            } else if (strings.eqlComptime(setting, "inline")) {
                opts.source_map = .@"inline";
            } else if (strings.eqlComptime(setting, "none")) {
                opts.source_map = .none;
            } else if (strings.eqlComptime(setting, "external")) {
                opts.source_map = .external;
            } else if (strings.eqlComptime(setting, "linked")) {
                opts.source_map = .linked;
            } else {
                Output.prettyErrorln("<r><red>error<r>: Invalid sourcemap setting: \"{s}\"", .{setting});
                Global.crash();
            }

            // when using --compile, only `external` works, as we do not
            // look at the source map comment. so after we validate the
            // user's choice was in the list, we secretly override it
            if (ctx.bundler_options.compile) {
                opts.source_map = .external;
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

    const jsx_factory = args.option("--jsx-factory");
    const jsx_fragment = args.option("--jsx-fragment");
    const jsx_import_source = args.option("--jsx-import-source");
    const jsx_runtime = args.option("--jsx-runtime");

    if (cmd == .AutoCommand or cmd == .RunCommand) {
        // "run.silent" in bunfig.toml
        if (args.flag("--silent")) {
            ctx.debug.silent = true;
        }

        if (args.option("--elide-lines")) |elide_lines| {
            if (elide_lines.len > 0) {
                ctx.bundler_options.elide_lines = std.fmt.parseInt(usize, elide_lines, 10) catch {
                    Output.prettyErrorln("<r><red>error<r>: Invalid elide-lines: \"{s}\"", .{elide_lines});
                    Global.exit(1);
                };
            }
        }

        if (opts.define) |define| {
            if (define.keys.len > 0)
                bun.JSC.RuntimeTranspilerCache.is_disabled = true;
        }
    }

    if (cmd == .RunCommand or cmd == .AutoCommand or cmd == .BunxCommand) {
        // "run.bun" in bunfig.toml
        if (args.flag("--bun")) {
            ctx.debug.run_in_bun = true;
        }
    }

    opts.resolve = Api.ResolveMode.lazy;

    if (jsx_factory != null or
        jsx_fragment != null or
        jsx_import_source != null or
        jsx_runtime != null)
    {
        var default_factory = "".*;
        var default_fragment = "".*;
        var default_import_source = "".*;
        if (opts.jsx == null) {
            opts.jsx = Api.Jsx{
                .factory = (jsx_factory orelse &default_factory),
                .fragment = (jsx_fragment orelse &default_fragment),
                .import_source = (jsx_import_source orelse &default_import_source),
                .runtime = if (jsx_runtime) |runtime| try resolve_jsx_runtime(runtime) else Api.JsxRuntime.automatic,
                .development = false,
            };
        } else {
            opts.jsx = Api.Jsx{
                .factory = (jsx_factory orelse opts.jsx.?.factory),
                .fragment = (jsx_fragment orelse opts.jsx.?.fragment),
                .import_source = (jsx_import_source orelse opts.jsx.?.import_source),
                .runtime = if (jsx_runtime) |runtime| try resolve_jsx_runtime(runtime) else opts.jsx.?.runtime,
                .development = false,
            };
        }
    }

    if (cmd == .BuildCommand) {
        if (opts.entry_points.len == 0 and !ctx.bundler_options.bake) {
            Output.prettyln("<r><b>bun build <r><d>v" ++ Global.package_json_version_with_sha ++ "<r>", .{});
            Output.pretty("<r><red>error: Missing entrypoints. What would you like to bundle?<r>\n\n", .{});
            Output.flush();
            Output.pretty("Usage:\n  <d>$<r> <b><green>bun build<r> \\<entrypoint\\> [...\\<entrypoints\\>] <cyan>[...flags]<r>  \n", .{});
            Output.pretty("\nTo see full documentation:\n  <d>$<r> <b><green>bun build<r> --help\n", .{});
            Output.flush();
            Global.exit(1);
        }

        if (args.flag("--production")) {
            const any_html = for (opts.entry_points) |entry_point| {
                if (strings.hasSuffixComptime(entry_point, ".html")) {
                    break true;
                }
            } else false;
            if (any_html) {
                ctx.bundler_options.css_chunking = true;
            }

            ctx.bundler_options.production = true;
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

    if (cmd == .RunCommand or cmd == .AutoCommand) {
        if (args.option("--shell")) |shell| {
            if (strings.eqlComptime(shell, "bun")) {
                ctx.debug.use_system_shell = false;
            } else if (strings.eqlComptime(shell, "system")) {
                ctx.debug.use_system_shell = true;
            } else {
                Output.errGeneric("Expected --shell to be one of 'bun' or 'system'. Received: \"{s}\"", .{shell});
                Global.exit(1);
            }
        }
    }

    if (Environment.show_crash_trace) {
        debug_flags.resolve_breakpoints = args.options("--breakpoint-resolve");
        debug_flags.print_breakpoints = args.options("--breakpoint-print");
    }

    return opts;
}

export var Bun__Node__ZeroFillBuffers = false;
export var Bun__Node__ProcessNoDeprecation = false;
export var Bun__Node__ProcessThrowDeprecation = false;

const bun = @import("bun");
const std = @import("std");
const Environment = bun.Environment;
const Api = bun.Schema.Api;
const logger = bun.logger;
const strings = bun.strings;
const string = bun.string;
const clap = bun.clap;
const builtin = @import("builtin");
const FeatureFlags = bun.FeatureFlags;
const Command = CLI.Command;
const Output = bun.Output;
const Global = bun.Global;
const debug_flags = CLI.debug_flags;
const js_ast = bun.js_ast;
const resolve_path = bun.path;
const Bunfig = bun.Bunfig;
const OOM = bun.OOM;
const options = bun.options;
const printVersionAndExit = CLI.printVersionAndExit;
const printRevisionAndExit = CLI.printRevisionAndExit;
const CLI = bun.CLI;
const RegularExpression = bun.RegularExpression;
const DefineColonList = CLI.DefineColonList;
const LoaderColonList = CLI.LoaderColonList;
