usingnamespace @import("global.zig");
usingnamespace @import("./http.zig");

const std = @import("std");
const lex = @import("js_lexer.zig");
const logger = @import("logger.zig");
const alloc = @import("alloc.zig");
const options = @import("options.zig");
const js_parser = @import("js_parser.zig");
const json_parser = @import("json_parser.zig");
const js_printer = @import("js_printer.zig");
const js_ast = @import("js_ast.zig");
const linker = @import("linker.zig");
usingnamespace @import("ast/base.zig");
usingnamespace @import("defines.zig");
const panicky = @import("panic_handler.zig");
const sync = @import("./sync.zig");
const Api = @import("api/schema.zig").Api;
const resolve_path = @import("./resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("./javascript/jsc/config.zig").configureTransformOptionsForBun;
const clap = @import("clap");

const bundler = @import("bundler.zig");
const DotEnv = @import("./env_loader.zig");

const fs = @import("fs.zig");
const Router = @import("./router.zig");

const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;

const BunCommand = @import("./cli/bun_command.zig").BunCommand;
const DevCommand = @import("./cli/dev_command.zig").DevCommand;
const DiscordCommand = @import("./cli/discord_command.zig").DiscordCommand;
const BuildCommand = @import("./cli/build_command.zig").BuildCommand;
const RunCommand = @import("./cli/run_command.zig").RunCommand;

var start_time: i128 = undefined;

pub const Cli = struct {
    var wait_group: sync.WaitGroup = undefined;
    pub fn startTransform(allocator: *std.mem.Allocator, args: Api.TransformOptions, log: *logger.Log) anyerror!void {}
    pub fn start(allocator: *std.mem.Allocator, stdout: anytype, stderr: anytype, comptime MainPanicHandler: type) anyerror!void {
        start_time = std.time.nanoTimestamp();
        var log = try allocator.create(logger.Log);
        log.* = logger.Log.init(allocator);
        var panicker = MainPanicHandler.init(log);
        MainPanicHandler.Singleton = &panicker;

        try Command.start(allocator, log);
    }
};

const LoaderMatcher = strings.ExactSizeMatcher(4);
pub fn ColonListType(comptime t: type, value_resolver: anytype) type {
    return struct {
        pub fn init(allocator: *std.mem.Allocator, count: usize) !@This() {
            var keys = try allocator.alloc(string, count);
            var values = try allocator.alloc(t, count);

            return @This(){ .keys = keys, .values = values };
        }
        keys: []string,
        values: []t,

        pub fn load(self: *@This(), input: []const string) !void {
            for (input) |str, i| {
                // Support either ":" or "=" as the separator, preferring whichever is first.
                // ":" is less confusing IMO because that syntax is used with flags
                // but "=" is what esbuild uses and I want this to be somewhat familiar for people using esbuild
                const midpoint = std.math.min(strings.indexOfChar(str, ':') orelse std.math.maxInt(usize), strings.indexOfChar(str, '=') orelse std.math.maxInt(usize));
                if (midpoint == std.math.maxInt(usize)) {
                    return error.InvalidSeparator;
                }

                self.keys[i] = str[0..midpoint];
                self.values[i] = try value_resolver(str[midpoint + 1 .. str.len]);
            }
        }

        pub fn resolve(allocator: *std.mem.Allocator, input: []const string) !@This() {
            var list = try init(allocator, input.len);
            try list.load(input);
            return list;
        }
    };
}
pub const LoaderColonList = ColonListType(Api.Loader, Arguments.loader_resolver);
pub const DefineColonList = ColonListType(string, Arguments.noop_resolver);

pub const Arguments = struct {
    pub fn loader_resolver(in: string) !Api.Loader {
        const Matcher = strings.ExactSizeMatcher(4);
        switch (Matcher.match(in)) {
            Matcher.case("jsx") => return Api.Loader.jsx,
            Matcher.case("js") => return Api.Loader.js,
            Matcher.case("ts") => return Api.Loader.ts,
            Matcher.case("tsx") => return Api.Loader.tsx,
            Matcher.case("css") => return Api.Loader.css,
            Matcher.case("file") => return Api.Loader.file,
            Matcher.case("json") => return Api.Loader.json,
            else => {
                return error.InvalidLoader;
            },
        }
    }

    pub fn noop_resolver(in: string) !string {
        return in;
    }

    pub fn fileReadError(err: anyerror, stderr: anytype, filename: string, kind: string) noreturn {
        stderr.writer().print("Error reading file \"{s}\" for {s}: {s}", .{ filename, kind, @errorName(err) }) catch {};
        std.process.exit(1);
    }

    pub fn readFile(
        allocator: *std.mem.Allocator,
        cwd: string,
        filename: string,
    ) ![]u8 {
        var paths = [_]string{ cwd, filename };
        const outpath = try std.fs.path.resolve(allocator, &paths);
        defer allocator.free(outpath);
        var file = try std.fs.openFileAbsolute(outpath, std.fs.File.OpenFlags{ .read = true, .write = false });
        defer file.close();
        const stats = try file.stat();
        return try file.readToEndAlloc(allocator, stats.size);
    }

    pub fn resolve_jsx_runtime(str: string) !Api.JsxRuntime {
        if (strings.eqlComptime(str, "automatic")) {
            return Api.JsxRuntime.automatic;
        } else if (strings.eqlComptime(str, "fallback")) {
            return Api.JsxRuntime.classic;
        } else {
            return error.InvalidJSXRuntime;
        }
    }

    pub const ParamType = clap.Param(clap.Help);

    const params: [26]ParamType = brk: {
        @setEvalBranchQuota(9999);
        break :brk [_]ParamType{
            clap.parseParam("--use <STR>                       Choose a framework, e.g. \"--use next\". It checks first for a package named \"bun-framework-packagename\" and then \"packagename\".") catch unreachable,
            clap.parseParam("--bunfile <STR>                   Use a .bun file (default: node_modules.bun)") catch unreachable,
            clap.parseParam("--server-bunfile <STR>            Use a .server.bun file (default: node_modules.server.bun)") catch unreachable,
            clap.parseParam("--cwd <STR>                       Absolute path to resolve files & entry points from. This just changes the process' cwd.") catch unreachable,
            clap.parseParam("--disable-react-fast-refresh      Disable React Fast Refresh") catch unreachable,
            clap.parseParam("--extension-order <STR>...        defaults to: .tsx,.ts,.jsx,.js,.json ") catch unreachable,
            clap.parseParam("--jsx-factory <STR>               Changes the function called when compiling JSX elements using the classic JSX runtime") catch unreachable,
            clap.parseParam("--jsx-fragment <STR>              Changes the function called when compiling JSX fragments using the classic JSX runtime") catch unreachable,
            clap.parseParam("--jsx-import-source <STR>         Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: \"react\"") catch unreachable,
            clap.parseParam("--jsx-production                  Use jsx instead of jsxDEV (default) for the automatic runtime") catch unreachable,
            clap.parseParam("--jsx-runtime <STR>               \"automatic\" (default) or \"classic\"") catch unreachable,
            clap.parseParam("--main-fields <STR>...            Main fields to lookup in package.json. Defaults to --platform dependent") catch unreachable,
            clap.parseParam("--no-summary                      Don't print a summary (when generating .bun") catch unreachable,
            clap.parseParam("--origin <STR>                    Rewrite import paths to start with --origin. Default: \"/\"") catch unreachable,
            clap.parseParam("--platform <STR>                  \"browser\" or \"node\". Defaults to \"browser\"") catch unreachable,
            clap.parseParam("--production                      [not implemented] generate production code") catch unreachable,
            clap.parseParam("--static-dir <STR>                Top-level directory for .html files, fonts or anything external. Defaults to \"<cwd>/public\", to match create-react-app and Next.js") catch unreachable,
            clap.parseParam("--tsconfig-override <STR>         Load tsconfig from path instead of cwd/tsconfig.json") catch unreachable,
            clap.parseParam("-d, --define <STR>...             Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:development") catch unreachable,
            clap.parseParam("-e, --external <STR>...           Exclude module from transpilation (can use * wildcards). ex: -e react") catch unreachable,
            clap.parseParam("-h, --help                        Display this help and exit.              ") catch unreachable,
            clap.parseParam("-i, --inject <STR>...             Inject module at the top of every file") catch unreachable,
            clap.parseParam("-l, --loader <STR>...             Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: jsx, js, json, tsx (not implemented yet), ts (not implemented yet), css (not implemented yet)") catch unreachable,
            clap.parseParam("-o, --outdir <STR>                Save output to directory (default: \"out\" if none provided and multiple entry points passed)") catch unreachable,
            clap.parseParam("-r, --resolve <STR>               Determine import/require behavior. \"disable\" ignores. \"dev\" bundles node_modules and builds everything else as independent entry points") catch unreachable,

            clap.parseParam("<POS>...                          ") catch unreachable,
        };
    };

    pub fn parse(allocator: *std.mem.Allocator, comptime cmd: Command.Tag) !Api.TransformOptions {
        var diag = clap.Diagnostic{};

        var args = clap.parse(clap.Help, &params, .{ .diagnostic = &diag }) catch |err| {
            // Report useful error and exit
            diag.report(Output.errorWriter(), err) catch {};
            return err;
        };

        var cwd_paths = [_]string{args.option("--cwd") orelse try std.process.getCwdAlloc(allocator)};
        var cwd = try std.fs.path.resolve(allocator, &cwd_paths);

        var defines_tuple = try DefineColonList.resolve(allocator, args.options("--define"));
        var loader_tuple = try LoaderColonList.resolve(allocator, args.options("--define"));
        var externals = std.mem.zeroes([][]u8);
        if (args.options("--external").len > 0) {
            externals = try allocator.alloc([]u8, args.options("--external").len);
            for (args.options("--external")) |external, i| {
                externals[i] = constStrToU8(external);
            }
        }

        var opts = Api.TransformOptions{
            .tsconfig_override = if (args.option("--tsconfig-override")) |ts| (Arguments.readFile(allocator, cwd, ts) catch |err| fileReadError(err, Output.errorStream(), ts, "tsconfig.json")) else null,
            .external = externals,
            .absolute_working_dir = cwd,
            .origin = args.option("--origin"),
            .define = .{
                .keys = defines_tuple.keys,
                .values = defines_tuple.values,
            },
            .loaders = .{
                .extensions = loader_tuple.keys,
                .loaders = loader_tuple.values,
            },

            .serve = cmd == .DevCommand,
            .main_fields = args.options("--main-fields"),
            .generate_node_module_bundle = cmd == .BunCommand,
            .inject = args.options("--inject"),
            .extension_order = args.options("--extension-order"),
            .entry_points = undefined,
            .no_summary = args.flag("--no-summary"),
        };

        const print_help = args.flag("--help");
        if (print_help) {
            clap.help(Output.errorWriter(), &params) catch {};
            std.os.exit(0);
        }

        var output_dir = args.option("--outdir");

        var define_keys = defines_tuple.keys;
        var define_values = defines_tuple.values;
        var loader_keys = loader_tuple.keys;
        var loader_values = loader_tuple.values;
        var entry_points = args.positionals();

        switch (comptime cmd) {
            .BunCommand => {
                if (entry_points.len > 0 and (strings.eqlComptime(
                    entry_points[0],
                    "bun",
                ))) {
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
            .BuildCommand => {
                if (entry_points.len > 0 and (strings.eqlComptime(
                    entry_points[0],
                    "build",
                ) or strings.eqlComptime(
                    entry_points[0],
                    "b",
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

        const production = args.flag("--production");

        var write = entry_points.len > 1 or output_dir != null;
        if (write and output_dir == null) {
            var _paths = [_]string{ cwd, "out" };
            output_dir = try std.fs.path.resolve(allocator, &_paths);
        }
        opts.write = write;
        opts.entry_points = entry_points;

        var jsx_factory = args.option("--jsx-factory");
        var jsx_fragment = args.option("--jsx-fragment");
        var jsx_import_source = args.option("--jsx-import-source");
        var jsx_runtime = args.option("--jsx-runtime");
        var jsx_production = args.flag("--jsx-production") or production;
        const react_fast_refresh = switch (comptime cmd) {
            .BunCommand, .DevCommand => !(args.flag("--disable-react-fast-refresh") or jsx_production),
            else => true,
        };

        opts.node_modules_bundle_path = args.option("--bunfile") orelse brk: {
            const node_modules_bundle_path_absolute = resolve_path.joinAbs(cwd, .auto, "node_modules.bun");

            break :brk std.fs.realpathAlloc(allocator, node_modules_bundle_path_absolute) catch null;
        };

        opts.node_modules_bundle_path_server = args.option("--server-bunfile") orelse brk: {
            const node_modules_bundle_path_absolute = resolve_path.joinAbs(cwd, .auto, "node_modules.server.bun");

            break :brk std.fs.realpathAlloc(allocator, node_modules_bundle_path_absolute) catch null;
        };

        switch (comptime cmd) {
            .DevCommand, .BuildCommand => {
                if (args.option("--static-dir")) |public_dir| {
                    opts.router = Api.RouteConfig{ .extensions = &.{}, .dir = &.{}, .static_dir = public_dir };
                }
            },
            else => {},
        }

        const ResolveMatcher = strings.ExactSizeMatcher(8);

        opts.resolve = Api.ResolveMode.lazy;

        switch (comptime cmd) {
            .BuildCommand => {
                if (args.option("--resolve")) |_resolve| {
                    switch (ResolveMatcher.match(_resolve)) {
                        ResolveMatcher.case("disable") => {
                            opts.resolve = Api.ResolveMode.disable;
                        },
                        ResolveMatcher.case("bundle") => {
                            opts.resolve = Api.ResolveMode.bundle;
                        },
                        ResolveMatcher.case("dev") => {
                            opts.resolve = Api.ResolveMode.dev;
                        },
                        ResolveMatcher.case("lazy") => {
                            opts.resolve = Api.ResolveMode.lazy;
                        },
                        else => {
                            diag.name.long = "--resolve";
                            diag.arg = _resolve;
                            try diag.report(Output.errorWriter(), error.InvalidResolveOption);
                            std.process.exit(1);
                        },
                    }
                }
            },
            else => {},
        }

        const PlatformMatcher = strings.ExactSizeMatcher(8);

        if (args.option("--platform")) |_platform| {
            switch (PlatformMatcher.match(_platform)) {
                PlatformMatcher.case("browser") => {
                    opts.platform = Api.Platform.browser;
                },
                PlatformMatcher.case("node") => {
                    opts.platform = Api.Platform.node;
                },
                else => {
                    diag.name.long = "--platform";
                    diag.arg = _platform;
                    try diag.report(Output.errorWriter(), error.InvalidPlatform);
                    std.process.exit(1);
                },
            }
        }

        if (jsx_factory != null or
            jsx_fragment != null or
            jsx_import_source != null or
            jsx_runtime != null or
            jsx_production or react_fast_refresh)
        {
            var default_factory = "".*;
            var default_fragment = "".*;
            var default_import_source = "".*;
            opts.jsx = Api.Jsx{
                .factory = constStrToU8(jsx_factory orelse &default_factory),
                .fragment = constStrToU8(jsx_fragment orelse &default_fragment),
                .import_source = constStrToU8(jsx_import_source orelse &default_import_source),
                .runtime = if (jsx_runtime != null) try resolve_jsx_runtime(jsx_runtime.?) else Api.JsxRuntime.automatic,
                .development = !jsx_production,
                .react_fast_refresh = react_fast_refresh,
            };
        }

        if (args.option("--use")) |entry| {
            opts.framework = Api.FrameworkConfig{
                .package = entry,
                .development = !production,
            };
        }

        if (entry_points.len == 0 and opts.framework == null and opts.node_modules_bundle_path == null) {
            return error.MissingEntryPoint;
        }

        opts.output_dir = output_dir;
        return opts;
    }
};

const AutoCommand = struct {
    pub fn exec(allocator: *std.mem.Allocator) !void {
        try HelpCommand.execWithReason(allocator, .invalid_command);
    }
};
const InitCommand = struct {
    pub fn exec(allocator: *std.mem.Allocator) !void {}
};
const HelpCommand = struct {
    pub fn exec(allocator: *std.mem.Allocator) !void {
        @setCold(true);
        execWithReason(allocator, .explicit);
    }

    pub const Reason = enum {
        explicit,
        invalid_command,
    };
    pub fn execWithReason(allocator: *std.mem.Allocator, comptime reason: Reason) void {
        @setCold(true);
        var cwd_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        const cwd = std.os.getcwd(&cwd_buf) catch unreachable;
        const dirname = std.fs.path.basename(cwd);
        const fmt =
            \\> <r> <b><white>init<r>                           Setup Bun in \"{s}\"
            \\> <r> <b><green>dev    <r><d>  ./a.ts ./b.jsx<r>        Start a Bun Dev Server
            \\<d>*<r> <b><cyan>build  <r><d>  ./a.ts ./b.jsx<r>        Make JavaScript-like code runnable & bundle CSS
            \\> <r> <b><magenta>bun    <r><d>  ./a.ts ./b.jsx<r>        Bundle dependencies of input files into a <r><magenta>.bun<r>
            \\> <r> <green>run    <r><d>  ./a.ts        <r>        Run a JavaScript-like file with Bun.js
            \\> <r> <b><blue>discord<r>                        Open Bun's Discord server
            \\> <r> <b><d>help      <r>                     Print this help menu
            \\
        ;

        switch (reason) {
            .explicit => Output.pretty("Bun: a fast bundler & transpiler for web software.\n\n" ++ fmt, .{dirname}),
            .invalid_command => Output.prettyError("<r><red>Uh-oh<r> not sure what to do with that command.\n\n" ++ fmt, .{dirname}),
        }

        Output.flush();

        if (reason == .invalid_command) {
            std.process.exit(1);
        }
    }
};

pub const PrintBundleCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const entry_point = ctx.args.entry_points[0];
        var out_buffer: [std.fs.MAX_PATH_BYTES]u8 = undefined;
        var stdout = std.io.getStdOut();

        var input = try std.fs.openFileAbsolute(try std.os.realpath(ctx.args.entry_points[0], &out_buffer), .{ .read = true });
        const params = comptime [_]Arguments.ParamType{
            clap.parseParam("--summary  Peek inside the .bun") catch unreachable,
        };

        var jsBundleArgs = clap.parse(clap.Help, &params, .{ .allocator = ctx.allocator }) catch |err| {
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
    pub const Context = struct {
        start_time: i128,
        args: Api.TransformOptions = std.mem.zeroes(Api.TransformOptions),
        log: *logger.Log,
        allocator: *std.mem.Allocator,

        pub fn create(allocator: *std.mem.Allocator, log: *logger.Log, comptime command: Command.Tag) !Context {
            return Command.Context{
                .args = try Arguments.parse(allocator, command),
                .log = log,
                .start_time = start_time,
                .allocator = allocator,
            };
        }
    };

    pub fn which(allocator: *std.mem.Allocator) Tag {
        var args_iter = std.process.args();
        // first one is the executable name
        const skipped = args_iter.skip();

        if (!skipped) {
            return .AutoCommand;
        }

        const next_arg = (args_iter.next(allocator) orelse return .AutoCommand) catch unreachable;

        const first_arg_name = std.mem.span(next_arg);
        const RootCommandMatcher = strings.ExactSizeMatcher(8);

        return switch (RootCommandMatcher.match(first_arg_name)) {
            RootCommandMatcher.case("init") => .InitCommand,
            RootCommandMatcher.case("bun") => .BunCommand,
            RootCommandMatcher.case("discord") => .DiscordCommand,

            RootCommandMatcher.case("b"), RootCommandMatcher.case("build") => .BuildCommand,
            RootCommandMatcher.case("r"), RootCommandMatcher.case("run") => .RunCommand,
            RootCommandMatcher.case("d"), RootCommandMatcher.case("dev") => .DevCommand,

            RootCommandMatcher.case("help") => .HelpCommand,
            else => .AutoCommand,
        };
    }

    pub fn start(allocator: *std.mem.Allocator, log: *logger.Log) !void {
        const tag = which(allocator);
        switch (tag) {
            .DiscordCommand => return try DiscordCommand.exec(allocator),
            .HelpCommand => return try HelpCommand.exec(allocator),
            .InitCommand => return try InitCommand.exec(allocator),
            else => {},
        }

        switch (tag) {
            .BunCommand => {
                const ctx = try Command.Context.create(allocator, log, .BunCommand);

                try BunCommand.exec(ctx);
            },
            .DevCommand => {
                const ctx = try Command.Context.create(allocator, log, .DevCommand);

                try DevCommand.exec(ctx);
            },
            .BuildCommand => {
                const ctx = try Command.Context.create(allocator, log, .BuildCommand);

                try BuildCommand.exec(ctx);
            },
            .RunCommand => {
                const ctx = try Command.Context.create(allocator, log, .RunCommand);

                try RunCommand.exec(ctx);
            },
            .AutoCommand => {
                const ctx = Command.Context.create(allocator, log, .AutoCommand) catch |e| {
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

                if (ctx.args.entry_points.len == 1 and
                    std.mem.endsWith(u8, ctx.args.entry_points[0], ".bun"))
                {
                    try PrintBundleCommand.exec(ctx);
                    return;
                }

                try BuildCommand.exec(ctx);
            },
            else => unreachable,
        }
    }

    pub const Tag = enum {
        InitCommand,
        BunCommand,
        DevCommand,
        DiscordCommand,
        BuildCommand,
        RunCommand,
        AutoCommand,
        HelpCommand,
    };
};
