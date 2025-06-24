const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const default_allocator = bun.default_allocator;

const std = @import("std");
const logger = bun.logger;
const options = @import("options.zig");
const RegularExpression = bun.RegularExpression;
const File = bun.sys.File;

const debug = Output.scoped(.CLI, true);

const sync = @import("./sync.zig");
const Api = @import("api/schema.zig").Api;
const clap = bun.clap;
const BunJS = @import("./bun_js.zig");
const Install = @import("./install/install.zig");
const RunCommand_ = @import("./cli/run_command.zig").RunCommand;
const FilterRun = @import("./cli/filter_run.zig");

const fs = @import("fs.zig");

const MacroMap = @import("./resolver/package_json.zig").MacroMap;
const TestCommand = @import("./cli/test_command.zig").TestCommand;
pub var start_time: i128 = undefined;
const Bunfig = @import("./bunfig.zig").Bunfig;

pub var Bun__Node__ProcessTitle: ?string = null;

pub const Cli = struct {
    pub const CompileTarget = @import("./compile_target.zig");
    var wait_group: sync.WaitGroup = undefined;
    pub var log_: logger.Log = undefined;
    pub fn startTransform(_: std.mem.Allocator, _: Api.TransformOptions, _: *logger.Log) anyerror!void {}
    pub fn start(allocator: std.mem.Allocator) void {
        is_main_thread = true;
        start_time = std.time.nanoTimestamp();
        log_ = logger.Log.init(allocator);

        var log = &log_;

        // var panicker = MainPanicHandler.init(log);
        // MainPanicHandler.Singleton = &panicker;
        Command.start(allocator, log) catch |err| {
            log.print(Output.errorWriter()) catch {};

            bun.crash_handler.handleRootError(err, @errorReturnTrace());
        };
    }

    pub var cmd: ?Command.Tag = null;
    pub threadlocal var is_main_thread: bool = false;
};

pub const debug_flags = if (Environment.show_crash_trace) struct {
    pub var resolve_breakpoints: []const []const u8 = &.{};
    pub var print_breakpoints: []const []const u8 = &.{};

    pub fn hasResolveBreakpoint(str: []const u8) bool {
        for (resolve_breakpoints) |bp| {
            if (strings.contains(str, bp)) {
                return true;
            }
        }
        return false;
    }

    pub fn hasPrintBreakpoint(path: fs.Path) bool {
        for (print_breakpoints) |bp| {
            if (strings.contains(path.pretty, bp)) {
                return true;
            }
            if (strings.contains(path.text, bp)) {
                return true;
            }
        }
        return false;
    }
} else @compileError("Do not access this namespace in a release build");

const ColonListType = @import("./cli/colon_list_type.zig").ColonListType;
pub const LoaderColonList = ColonListType(Api.Loader, Arguments.loader_resolver);
pub const DefineColonList = ColonListType(string, Arguments.noop_resolver);
pub fn invalidTarget(diag: *clap.Diagnostic, _target: []const u8) noreturn {
    @branchHint(.cold);
    diag.name.long = "target";
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
pub const ExecCommand = @import("./cli/exec_command.zig").ExecCommand;
pub const PatchCommand = @import("./cli/patch_command.zig").PatchCommand;
pub const PatchCommitCommand = @import("./cli/patch_commit_command.zig").PatchCommitCommand;
pub const OutdatedCommand = @import("./cli/outdated_command.zig").OutdatedCommand;
pub const PublishCommand = @import("./cli/publish_command.zig").PublishCommand;
pub const PackCommand = @import("./cli/pack_command.zig").PackCommand;
pub const AuditCommand = @import("./cli/audit_command.zig").AuditCommand;
pub const InitCommand = @import("./cli/init_command.zig").InitCommand;

const PackageManager = Install.PackageManager;
const PmViewCommand = @import("./cli/pm_view_command.zig");

pub const Arguments = @import("./cli/Arguments.zig");

const AutoCommand = struct {
    pub fn exec(allocator: std.mem.Allocator) !void {
        try HelpCommand.execWithReason(allocator, .invalid_command);
    }
};

pub const HelpCommand = struct {
    pub fn exec(allocator: std.mem.Allocator) !void {
        @branchHint(.cold);
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
        \\  <b><magenta>exec<r>                           Run a shell script directly with Bun
        \\
        \\  <b><blue>install<r>                        Install dependencies for a package.json <d>(bun i)<r>
        \\  <b><blue>add<r>       <d>{s:<16}<r>     Add a dependency to package.json <d>(bun a)<r>
        \\  <b><blue>remove<r>    <d>{s:<16}<r>     Remove a dependency from package.json <d>(bun rm)<r>
        \\  <b><blue>update<r>    <d>{s:<16}<r>     Update outdated dependencies
        \\  <b><blue>audit<r>                          Check installed packages for vulnerabilities
        \\  <b><blue>outdated<r>                       Display latest versions of outdated dependencies
        \\  <b><blue>link<r>      <d>[\<package\>]<r>          Register or link a local npm package
        \\  <b><blue>unlink<r>                         Unregister a local npm package
        \\  <b><blue>publish<r>                        Publish a package to the npm registry
        \\  <b><blue>patch <d>\<pkg\><r>                    Prepare a package for patching
        \\  <b><blue>pm <d>\<subcommand\><r>                Additional package management utilities
        \\  <b><blue>info<r>      <d>{s:<16}<r>     Display package metadata from the registry
        \\
        \\  <b><yellow>build<r>     <d>./a.ts ./b.jsx<r>       Bundle TypeScript & JavaScript into a single file
        \\
        \\  <b><cyan>init<r>                           Start an empty Bun project from a built-in template
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
        var rand_state = std.Random.DefaultPrng.init(@as(u64, @intCast(@max(std.time.milliTimestamp(), 0))));
        const rand = rand_state.random();

        const package_x_i = rand.uintAtMost(usize, packages_to_x_filler.len - 1);
        const package_add_i = rand.uintAtMost(usize, packages_to_add_filler.len - 1);
        const package_remove_i = rand.uintAtMost(usize, packages_to_remove_filler.len - 1);
        const package_create_i = rand.uintAtMost(usize, packages_to_create_filler.len - 1);

        const args = .{
            packages_to_x_filler[package_x_i],
            packages_to_add_filler[package_add_i],
            packages_to_remove_filler[package_remove_i],
            packages_to_add_filler[(package_add_i + 1) % packages_to_add_filler.len],
            packages_to_add_filler[(package_add_i + 2) % packages_to_add_filler.len],
            packages_to_create_filler[package_create_i],
        };

        switch (reason) {
            .explicit => {
                Output.pretty(
                    "<r><b><magenta>Bun<r> is a fast JavaScript runtime, package manager, bundler, and test runner. <d>(" ++
                        Global.package_json_version_with_revision ++
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
        @branchHint(.cold);
        printWithReason(reason, false);

        if (reason == .invalid_command) {
            Global.exit(1);
        }
        Global.exit(0);
    }
};

pub const ReservedCommand = struct {
    pub fn exec(_: std.mem.Allocator) !void {
        @branchHint(.cold);
        const command_name = for (bun.argv[1..]) |arg| {
            if (arg.len > 1 and arg[0] == '-') continue;
            break arg;
        } else bun.argv[1];
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

/// This is set `true` during `Command.which()` if argv0 is "node", in which the CLI is going
/// to pretend to be node.js by always choosing RunCommand with a relative filepath.
///
/// Examples of how this differs from bun alone:
/// - `node build`               -> `bun run ./build`
/// - `node scripts/postinstall` -> `bun run ./scripts/postinstall`
pub var pretend_to_be_node = false;

/// This is set `true` during `Command.which()` if argv0 is "bunx"
pub var is_bunx_exe = false;

pub const Command = struct {
    pub fn get() Context {
        return global_cli_ctx;
    }

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
        /// Disables using bun.shell.Interpreter for `bun run`, instead spawning cmd.exe
        use_system_shell: bool = !bun.Environment.isWindows,

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

        file_reporter: ?TestCommand.FileReporter = null,
        reporter_outfile: ?[]const u8 = null,
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
        redis_preconnect: bool = false,
        eval: struct {
            script: []const u8 = "",
            eval_and_print: bool = false,
        } = .{},
        preconnect: []const []const u8 = &[_][]const u8{},
        dns_result_order: []const u8 = "verbatim",
        /// `--expose-gc` makes `globalThis.gc()` available. Added for Node
        /// compatibility.
        expose_gc: bool = false,
        preserve_symlinks_main: bool = false,
    };

    var global_cli_ctx: Context = undefined;
    var context_data: ContextData = undefined;

    pub const init = ContextData.create;

    pub const ContextData = struct {
        start_time: i128,
        args: Api.TransformOptions,
        log: *logger.Log,
        allocator: std.mem.Allocator,
        positionals: []const string = &.{},
        passthrough: []const string = &.{},
        install: ?*Api.BunInstall = null,

        debug: DebugOptions = .{},
        test_options: TestOptions = .{},
        bundler_options: BundlerOptions = .{},
        runtime_options: RuntimeOptions = .{},

        filters: []const []const u8 = &.{},

        preloads: []const string = &.{},
        has_loaded_global_config: bool = false,

        pub const BundlerOptions = struct {
            outdir: []const u8 = "",
            outfile: []const u8 = "",
            root_dir: []const u8 = "",
            public_path: []const u8 = "",
            entry_naming: []const u8 = "[dir]/[name].[ext]",
            chunk_naming: []const u8 = "./[name]-[hash].[ext]",
            asset_naming: []const u8 = "./[name]-[hash].[ext]",
            server_components: bool = false,
            react_fast_refresh: bool = false,
            code_splitting: bool = false,
            transform_only: bool = false,
            inline_entrypoint_import_meta_main: bool = false,
            minify_syntax: bool = false,
            minify_whitespace: bool = false,
            minify_identifiers: bool = false,
            ignore_dce_annotations: bool = false,
            emit_dce_annotations: bool = true,
            output_format: options.Format = .esm,
            bytecode: bool = false,
            banner: []const u8 = "",
            footer: []const u8 = "",
            css_chunking: bool = false,

            bake: bool = false,
            bake_debug_dump_server: bool = false,
            bake_debug_disable_minify: bool = false,

            production: bool = false,

            env_behavior: Api.DotEnvBehavior = .disable,
            env_prefix: []const u8 = "",
            elide_lines: ?usize = null,
            // Compile options
            compile: bool = false,
            compile_target: Cli.CompileTarget = .{},
            windows_hide_console: bool = false,
            windows_icon: ?[]const u8 = null,
        };

        pub fn create(allocator: std.mem.Allocator, log: *logger.Log, comptime command: Command.Tag) anyerror!Context {
            Cli.cmd = command;
            context_data = .{
                .args = std.mem.zeroes(Api.TransformOptions),
                .log = log,
                .start_time = start_time,
                .allocator = allocator,
            };
            global_cli_ctx = &context_data;

            if (comptime Command.Tag.uses_global_options.get(command)) {
                global_cli_ctx.args = try Arguments.parse(allocator, global_cli_ctx, command);
            }

            if (comptime Environment.isWindows) {
                if (global_cli_ctx.debug.hot_reload == .watch) {
                    if (!bun.windows.isWatcherChild()) {
                        // this is noreturn
                        bun.windows.becomeWatcherManager(allocator);
                    } else {
                        bun.auto_reload_on_crash = true;
                    }
                }
            }

            return global_cli_ctx;
        }
    };
    pub const Context = *ContextData;

    // std.process.args allocates!
    const ArgsIterator = struct {
        buf: [][:0]const u8,
        i: u32 = 0,

        pub fn next(this: *ArgsIterator) ?[]const u8 {
            if (this.buf.len <= this.i) {
                return null;
            }
            const i = this.i;
            this.i += 1;
            return this.buf[i];
        }

        pub fn skip(this: *ArgsIterator) bool {
            return this.next() != null;
        }
    };

    pub fn isBunX(argv0: []const u8) bool {
        if (Environment.isWindows) {
            return strings.endsWithComptime(argv0, "bunx.exe") or strings.endsWithComptime(argv0, "bunx");
        }
        return strings.endsWithComptime(argv0, "bunx");
    }

    pub fn isNode(argv0: []const u8) bool {
        if (Environment.isWindows) {
            return strings.endsWithComptime(argv0, "node.exe") or strings.endsWithComptime(argv0, "node");
        }
        return strings.endsWithComptime(argv0, "node");
    }

    pub fn which() Tag {
        var args_iter = ArgsIterator{ .buf = bun.argv };

        const argv0 = args_iter.next() orelse return .HelpCommand;

        if (isBunX(argv0)) {
            // if we are bunx, but NOT a symlink to bun. when we run `<self> install`, we dont
            // want to recursively run bunx. so this check lets us peek back into bun install.
            if (args_iter.next()) |next| {
                if (bun.strings.eqlComptime(next, "add") and bun.getRuntimeFeatureFlag(.BUN_INTERNAL_BUNX_INSTALL)) {
                    return .AddCommand;
                } else if (bun.strings.eqlComptime(next, "exec") and bun.getRuntimeFeatureFlag(.BUN_INTERNAL_BUNX_INSTALL)) {
                    return .ExecCommand;
                }
            }

            is_bunx_exe = true;
            return .BunxCommand;
        }

        if (isNode(argv0)) {
            @import("./deps/zig-clap/clap/streaming.zig").warn_on_unrecognized_flag = false;
            pretend_to_be_node = true;
            return .RunAsNodeCommand;
        }

        var next_arg = ((args_iter.next()) orelse return .AutoCommand);
        while (next_arg.len > 0 and next_arg[0] == '-' and !(next_arg.len > 1 and next_arg[1] == 'e')) {
            next_arg = ((args_iter.next()) orelse return .AutoCommand);
        }

        const first_arg_name = next_arg;
        const RootCommandMatcher = strings.ExactSizeMatcher(12);

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
                    if (arg.len > 0 and (strings.eqlComptime(arg, "-g") or strings.eqlComptime(arg, "--global"))) {
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
            RootCommandMatcher.case("patch") => .PatchCommand,
            RootCommandMatcher.case("patch-commit") => .PatchCommitCommand,

            RootCommandMatcher.case("r"),
            RootCommandMatcher.case("remove"),
            RootCommandMatcher.case("rm"),
            RootCommandMatcher.case("uninstall"),
            => .RemoveCommand,

            RootCommandMatcher.case("run") => .RunCommand,
            RootCommandMatcher.case("help") => .HelpCommand,

            RootCommandMatcher.case("exec") => .ExecCommand,

            RootCommandMatcher.case("outdated") => .OutdatedCommand,
            RootCommandMatcher.case("publish") => .PublishCommand,
            RootCommandMatcher.case("audit") => .AuditCommand,
            RootCommandMatcher.case("info") => .InfoCommand,

            // These are reserved for future use by Bun, so that someone
            // doing `bun deploy` to run a script doesn't accidentally break
            // when we add our actual command
            RootCommandMatcher.case("deploy") => .ReservedCommand,
            RootCommandMatcher.case("cloud") => .ReservedCommand,
            RootCommandMatcher.case("config") => .ReservedCommand,
            RootCommandMatcher.case("use") => .ReservedCommand,
            RootCommandMatcher.case("auth") => .ReservedCommand,
            RootCommandMatcher.case("login") => .ReservedCommand,
            RootCommandMatcher.case("logout") => .ReservedCommand,
            RootCommandMatcher.case("whoami") => .ReservedCommand,
            RootCommandMatcher.case("prune") => .ReservedCommand,
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
        "info",
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

        // bun build --compile entry point
        if (!bun.getRuntimeFeatureFlag(.BUN_BE_BUN)) {
            if (try bun.StandaloneModuleGraph.fromExecutable(bun.default_allocator)) |graph| {
                context_data = .{
                    .args = std.mem.zeroes(Api.TransformOptions),
                    .log = log,
                    .start_time = start_time,
                    .allocator = bun.default_allocator,
                };
                global_cli_ctx = &context_data;
                var ctx = global_cli_ctx;

                ctx.args.target = Api.Target.bun;
                if (bun.argv.len > 1) {
                    ctx.passthrough = bun.argv[1..];
                } else {
                    ctx.passthrough = &[_]string{};
                }

                try @import("./bun_js.zig").Run.bootStandalone(
                    ctx,
                    graph.entryPoint().name,
                    graph,
                );
                return;
            }
        }

        debug("argv: [{s}]", .{bun.fmt.fmtSlice(bun.argv, ", ")});

        const tag = which();

        switch (tag) {
            .DiscordCommand => return try DiscordCommand.exec(allocator),
            .HelpCommand => return try HelpCommand.exec(allocator),
            .ReservedCommand => return try ReservedCommand.exec(allocator),
            .InitCommand => return try InitCommand.exec(allocator, bun.argv[@min(2, bun.argv.len)..]),
            .InfoCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .InfoCommand) unreachable;

                // Parse arguments manually since the standard flow doesn't work for standalone commands
                const cli = try PackageManager.CommandLineArguments.parse(allocator, .info);
                const ctx = try Command.init(allocator, log, .InfoCommand);
                const pm, _ = try PackageManager.init(
                    ctx,
                    cli,
                    PackageManager.Subcommand.info,
                );

                // Handle arguments correctly for standalone info command
                var package_name: []const u8 = "";
                var property_path: ?[]const u8 = null;

                // Find non-flag arguments starting from argv[2] (after "bun info")
                var arg_idx: usize = 2;
                var found_package = false;

                while (arg_idx < bun.argv.len) : (arg_idx += 1) {
                    const arg = bun.argv[arg_idx];

                    // Skip flags
                    if (arg.len > 0 and arg[0] == '-') {
                        continue;
                    }

                    if (!found_package) {
                        package_name = arg;
                        found_package = true;
                    } else {
                        property_path = arg;
                        break;
                    }
                }

                try PmViewCommand.view(allocator, pm, package_name, property_path, cli.json_output);
                return;
            },
            .BuildCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .BuildCommand) unreachable;
                const ctx = try Command.init(allocator, log, .BuildCommand);
                try BuildCommand.exec(ctx, null);
            },
            .InstallCompletionsCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .InstallCompletionsCommand) unreachable;
                try InstallCompletionsCommand.exec(allocator);
                return;
            },
            .InstallCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .InstallCommand) unreachable;
                const ctx = try Command.init(allocator, log, .InstallCommand);

                try InstallCommand.exec(ctx);
                return;
            },
            .AddCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .AddCommand) unreachable;
                const ctx = try Command.init(allocator, log, .AddCommand);

                try AddCommand.exec(ctx);
                return;
            },
            .UpdateCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .UpdateCommand) unreachable;
                const ctx = try Command.init(allocator, log, .UpdateCommand);

                try UpdateCommand.exec(ctx);
                return;
            },
            .PatchCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .PatchCommand) unreachable;
                const ctx = try Command.init(allocator, log, .PatchCommand);

                try PatchCommand.exec(ctx);
                return;
            },
            .PatchCommitCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .PatchCommitCommand) unreachable;
                const ctx = try Command.init(allocator, log, .PatchCommitCommand);

                try PatchCommitCommand.exec(ctx);
                return;
            },
            .OutdatedCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .OutdatedCommand) unreachable;
                const ctx = try Command.init(allocator, log, .OutdatedCommand);

                try OutdatedCommand.exec(ctx);
                return;
            },
            .PublishCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .PublishCommand) unreachable;
                const ctx = try Command.init(allocator, log, .PublishCommand);

                try PublishCommand.exec(ctx);
                return;
            },
            .AuditCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .AuditCommand) unreachable;
                const ctx = try Command.init(allocator, log, .AuditCommand);

                try AuditCommand.exec(ctx);
                unreachable;
            },
            .BunxCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .BunxCommand) unreachable;
                const ctx = try Command.init(allocator, log, .BunxCommand);

                try BunxCommand.exec(ctx, bun.argv[if (is_bunx_exe) 0 else 1..]);
                return;
            },
            .ReplCommand => {
                // TODO: Put this in native code.
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .BunxCommand) unreachable;
                var ctx = try Command.init(allocator, log, .BunxCommand);
                ctx.debug.run_in_bun = true; // force the same version of bun used. fixes bun-debug for example
                var args = bun.argv[0..];
                args[1] = "bun-repl";
                try BunxCommand.exec(ctx, args);
                return;
            },
            .RemoveCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .RemoveCommand) unreachable;
                const ctx = try Command.init(allocator, log, .RemoveCommand);

                try RemoveCommand.exec(ctx);
                return;
            },
            .LinkCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .LinkCommand) unreachable;
                const ctx = try Command.init(allocator, log, .LinkCommand);

                try LinkCommand.exec(ctx);
                return;
            },
            .UnlinkCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .UnlinkCommand) unreachable;
                const ctx = try Command.init(allocator, log, .UnlinkCommand);

                try UnlinkCommand.exec(ctx);
                return;
            },
            .PackageManagerCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .PackageManagerCommand) unreachable;
                const ctx = try Command.init(allocator, log, .PackageManagerCommand);

                // const maybe_subcommand, const maybe_arg = PackageManagerCommand.which(command_index);
                // if (maybe_subcommand) |subcommand| {
                //     return switch (subcommand) {
                //         inline else => |tag| try PackageManagerCommand.exec(ctx, tag),
                //     };
                // }

                // PackageManagerCommand.printHelp();

                // if (maybe_arg) |arg| {
                //     Output.errGeneric("\"{s}\" unknown command", .{arg});
                //     Global.crash();
                // }

                try PackageManagerCommand.exec(ctx);
                return;
            },
            .TestCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .TestCommand) unreachable;
                const ctx = try Command.init(allocator, log, .TestCommand);

                try TestCommand.exec(ctx);
                return;
            },
            .GetCompletionsCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .GetCompletionsCommand) unreachable;
                const ctx = try Command.init(allocator, log, .GetCompletionsCommand);
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

                    outer: {
                        if (filter.len > 1 and filter[1].len > 0) {
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
                            AddCompletions.init(bun.default_allocator) catch bun.outOfMemory();
                            const results = AddCompletions.getPackages(first_letter);

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
                const ctx = try Command.init(allocator, log, .CreateCommand);

                var args = try std.process.argsAlloc(allocator);

                if (args.len <= 2) {
                    Command.Tag.printHelp(.CreateCommand, false);
                    Global.exit(1);
                    return;
                }

                var template_name_start: usize = 0;
                var positionals: [2]string = .{ "", "" };
                var positional_i: usize = 0;

                var dash_dash_bun = false;
                var print_help = false;
                if (args.len > 2) {
                    const remainder = args[1..];
                    var remainder_i: usize = 0;
                    while (remainder_i < remainder.len and positional_i < positionals.len) : (remainder_i += 1) {
                        const slice = std.mem.trim(u8, bun.asByteSlice(remainder[remainder_i]), " \t\n");
                        if (slice.len > 0) {
                            if (!strings.hasPrefixComptime(slice, "--")) {
                                if (positional_i == 1) {
                                    template_name_start = remainder_i + 2;
                                }
                                positionals[positional_i] = slice;
                                positional_i += 1;
                            }
                            if (slice[0] == '-') {
                                if (strings.eqlComptime(slice, "--bun")) {
                                    dash_dash_bun = true;
                                } else if (strings.eqlComptime(slice, "--help") or strings.eqlComptime(slice, "-h")) {
                                    print_help = true;
                                }
                            }
                        }
                    }
                }

                if (print_help or
                    // "bun create --"
                    // "bun create -abc --"
                    positional_i == 0 or
                    positionals[1].len == 0)
                {
                    Command.Tag.printHelp(.CreateCommand, true);
                    Global.exit(0);
                    return;
                }

                const template_name = positionals[1];

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
                const example_tag = create_command_info.example_tag;

                const use_bunx = !HardcodedNonBunXList.has(template_name) and
                    (!strings.containsComptime(template_name, "/") or
                        strings.startsWithChar(template_name, '@')) and
                    example_tag != CreateCommandExample.Tag.local_folder;

                if (use_bunx) {
                    const bunx_args = try allocator.alloc([:0]const u8, 2 + args.len - template_name_start + @intFromBool(dash_dash_bun));
                    bunx_args[0] = "bunx";
                    if (dash_dash_bun) {
                        bunx_args[1] = "--bun";
                    }
                    bunx_args[1 + @as(usize, @intFromBool(dash_dash_bun))] = try BunxCommand.addCreatePrefix(allocator, template_name);
                    for (bunx_args[2 + @as(usize, @intFromBool(dash_dash_bun)) ..], args[template_name_start..]) |*dest, src| {
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
                const ctx = try Command.init(allocator, log, .RunCommand);
                ctx.args.target = .bun;

                if (ctx.filters.len > 0) {
                    FilterRun.runScriptsWithFilter(ctx) catch |err| {
                        Output.prettyErrorln("<r><red>error<r>: {s}", .{@errorName(err)});
                        Global.exit(1);
                    };
                }

                if (ctx.positionals.len > 0) {
                    if (try RunCommand.exec(ctx, .{ .bin_dirs_only = false, .log_errors = true, .allow_fast_run_for_extensions = false })) {
                        return;
                    }

                    Global.exit(1);
                }
            },
            .RunAsNodeCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .RunAsNodeCommand) unreachable;
                const ctx = try Command.init(allocator, log, .RunAsNodeCommand);
                bun.assert(pretend_to_be_node);
                try RunCommand.execAsIfNode(ctx);
            },
            .UpgradeCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .UpgradeCommand) unreachable;
                const ctx = try Command.init(allocator, log, .UpgradeCommand);
                try UpgradeCommand.exec(ctx);
                return;
            },
            .AutoCommand => {
                if (comptime bun.fast_debug_build_mode and bun.fast_debug_build_cmd != .AutoCommand) unreachable;

                const ctx = Command.init(allocator, log, .AutoCommand) catch |e| {
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
                ctx.args.target = .bun;

                if (ctx.filters.len > 0) {
                    FilterRun.runScriptsWithFilter(ctx) catch |err| {
                        Output.prettyErrorln("<r><red>error<r>: {s}", .{@errorName(err)});
                        Global.exit(1);
                    };
                }

                if (ctx.runtime_options.eval.script.len > 0) {
                    const trigger = bun.pathLiteral("/[eval]");
                    var entry_point_buf: [bun.MAX_PATH_BYTES + trigger.len]u8 = undefined;
                    const cwd = try std.posix.getcwd(&entry_point_buf);
                    @memcpy(entry_point_buf[cwd.len..][0..trigger.len], trigger);
                    ctx.passthrough = try std.mem.concat(ctx.allocator, []const u8, &.{ ctx.positionals, ctx.passthrough });
                    try BunJS.Run.boot(ctx, entry_point_buf[0 .. cwd.len + trigger.len], null);
                    return;
                }

                const extension: []const u8 = if (ctx.args.entry_points.len > 0)
                    std.fs.path.extension(ctx.args.entry_points[0])
                else
                    @as([]const u8, "");
                // KEYWORDS: open file argv argv0
                if (ctx.args.entry_points.len == 1) {
                    if (strings.eqlComptime(extension, ".lockb")) {
                        for (bun.argv) |arg| {
                            if (strings.eqlComptime(arg, "--hash")) {
                                var path_buf: bun.PathBuffer = undefined;
                                @memcpy(path_buf[0..ctx.args.entry_points[0].len], ctx.args.entry_points[0]);
                                path_buf[ctx.args.entry_points[0].len] = 0;
                                const lockfile_path = path_buf[0..ctx.args.entry_points[0].len :0];
                                const file = File.open(lockfile_path, bun.O.RDONLY, 0).unwrap() catch |err| {
                                    Output.err(err, "failed to open lockfile", .{});
                                    Global.crash();
                                };
                                try PackageManagerCommand.printHash(ctx, file);
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

                if (ctx.positionals.len > 0) {
                    if (ctx.filters.len > 0) {
                        Output.prettyln("<r><yellow>warn<r>: Filters are ignored for auto command", .{});
                    }
                    if (try RunCommand.exec(ctx, .{ .bin_dirs_only = true, .log_errors = !ctx.runtime_options.if_present, .allow_fast_run_for_extensions = true })) {
                        return;
                    }
                    return;
                }

                Output.flush();
                try HelpCommand.exec(allocator);
            },
            .ExecCommand => {
                const ctx = try Command.init(allocator, log, .ExecCommand);

                if (ctx.positionals.len > 1) {
                    try ExecCommand.exec(ctx);
                } else Tag.printHelp(.ExecCommand, true);
            },
        }
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
        InfoCommand,
        InstallCommand,
        InstallCompletionsCommand,
        LinkCommand,
        PackageManagerCommand,
        RemoveCommand,
        RunCommand,
        RunAsNodeCommand, // arg0 == 'node'
        TestCommand,
        UnlinkCommand,
        UpdateCommand,
        UpgradeCommand,
        ReplCommand,
        ReservedCommand,
        ExecCommand,
        PatchCommand,
        PatchCommitCommand,
        OutdatedCommand,
        PublishCommand,
        AuditCommand,

        /// Used by crash reports.
        ///
        /// This must be kept in sync with https://github.com/oven-sh/bun.report/blob/62601d8aafb9c0d29554dfc3f8854044ec04d367/backend/remap.ts#L10
        pub fn char(this: Tag) u8 {
            return switch (this) {
                .AddCommand => 'I',
                .AutoCommand => 'a',
                .BuildCommand => 'b',
                .BunxCommand => 'B',
                .CreateCommand => 'c',
                .DiscordCommand => 'D',
                .GetCompletionsCommand => 'g',
                .HelpCommand => 'h',
                .InitCommand => 'j',
                .InfoCommand => 'v',
                .InstallCommand => 'i',
                .InstallCompletionsCommand => 'C',
                .LinkCommand => 'l',
                .PackageManagerCommand => 'P',
                .RemoveCommand => 'R',
                .RunCommand => 'r',
                .RunAsNodeCommand => 'n',
                .TestCommand => 't',
                .UnlinkCommand => 'U',
                .UpdateCommand => 'u',
                .UpgradeCommand => 'p',
                .ReplCommand => 'G',
                .ReservedCommand => 'w',
                .ExecCommand => 'e',
                .PatchCommand => 'x',
                .PatchCommitCommand => 'z',
                .OutdatedCommand => 'o',
                .PublishCommand => 'k',
                .AuditCommand => 'A',
            };
        }

        pub fn params(comptime cmd: Tag) []const Arguments.ParamType {
            return comptime &switch (cmd) {
                .AutoCommand => Arguments.auto_params,
                .RunCommand, .RunAsNodeCommand => Arguments.run_params,
                .BuildCommand => Arguments.build_params,
                .TestCommand => Arguments.test_params,
                .BunxCommand => Arguments.run_params,
                else => Arguments.base_params_ ++ Arguments.runtime_params_ ++ Arguments.transpiler_params_,
            };
        }

        pub fn printHelp(comptime cmd: Tag, show_all_flags: bool) void {
            switch (cmd) {

                // the output of --help uses the following syntax highlighting
                // template: <b>Usage<r>: <b><green>bun <command><r> <cyan>[flags]<r> <blue>[arguments]<r>
                // use [foo] for multiple arguments or flags for foo.
                // use <bar> to emphasize 'bar'

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
                .RunCommand, .RunAsNodeCommand => {
                    RunCommand_.printHelp(null);
                },

                .InitCommand => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun init<r> <cyan>[flags]<r> <blue>[\<folder\>]<r>
                        \\  Initialize a Bun project in the current directory.
                        \\  Creates a package.json, tsconfig.json, and bunfig.toml if they don't exist.
                        \\
                        \\<b>Flags<r>:
                        \\      <cyan>--help<r>             Print this menu
                        \\  <cyan>-y, --yes<r>              Accept all default options
                        \\  <cyan>-m, --minimal<r>          Only initialize type definitions
                        \\  <cyan>-r, --react<r>            Initialize a React project
                        \\      <cyan>--react=tailwind<r>   Initialize a React project with TailwindCSS
                        \\      <cyan>--react=shadcn<r>     Initialize a React project with @shadcn/ui and TailwindCSS
                        \\
                        \\<b>Examples:<r>
                        \\  <b><green>bun init<r>
                        \\  <b><green>bun init<r> <cyan>--yes<r>
                        \\  <b><green>bun init<r> <cyan>--react<r>
                        \\  <b><green>bun init<r> <cyan>--react=tailwind<r> <blue>my-app<r>
                    ;

                    Output.pretty(intro_text ++ "\n", .{});
                    Output.flush();
                },

                Command.Tag.BunxCommand => {
                    Output.prettyErrorln(
                        \\<b>Usage<r>: <b><green>bunx<r> <cyan>[flags]<r> <blue>\<package\><r><d>\<@version\><r> [flags and arguments for the package]<r>
                        \\Execute an npm package executable (CLI), automatically installing into a global shared cache if not installed in node_modules.
                        \\
                        \\Flags:
                        \\  <cyan>--bun<r>      Force the command to run with Bun instead of Node.js
                        \\
                        \\Examples<d>:<r>
                        \\  <b><green>bunx<r> <blue>prisma<r> migrate<r>
                        \\  <b><green>bunx<r> <blue>prettier<r> foo.js<r>
                        \\  <b><green>bunx<r> <cyan>--bun<r> <blue>vite<r> dev foo.js<r>
                        \\
                    , .{});
                },
                Command.Tag.BuildCommand => {
                    const intro_text =
                        \\<b>Usage<r>:
                        \\  Transpile and bundle one or more files.
                        \\  <b><green>bun build<r> <cyan>[flags]<r> <blue>\<entrypoint\><r>
                    ;

                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Frontend web apps:<r>
                        \\  <b><green>bun build<r> <cyan>--outfile=bundle.js<r> <blue>./src/index.ts<r>
                        \\  <b><green>bun build<r> <cyan>--minify --splitting --outdir=out<r> <blue>./index.jsx ./lib/worker.ts<r>
                        \\
                        \\  <d>Bundle code to be run in Bun (reduces server startup time)<r>
                        \\  <b><green>bun build<r> <cyan>--target=bun --outfile=server.js<r> <blue>./server.ts<r>
                        \\
                        \\  <d>Creating a standalone executable (see https://bun.sh/docs/bundler/executables)<r>
                        \\  <b><green>bun build<r> <cyan>--compile --outfile=my-app<r> <blue>./cli.ts<r>
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
                        \\<b>Usage<r>: <b><green>bun test<r> <cyan>[flags]<r> <blue>[\<patterns\>]<r>
                        \\  Run all matching test files and print the results to stdout
                    ;
                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Run all test files<r>
                        \\  <b><green>bun test<r>
                        \\
                        \\  <d>Run all test files with "foo" or "bar" in the file name<r>
                        \\  <b><green>bun test<r> <blue>foo bar<r>
                        \\
                        \\  <d>Run all test files, only including tests whose names includes "baz"<r>
                        \\  <b><green>bun test<r> <cyan>--test-name-pattern<r> <blue>baz<r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/cli/test<r>
                        \\
                    ;

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
                        \\<b>Usage<r><d>:<r>
                        \\  <b><green>bun create<r> <magenta>\<MyReactComponent.(jsx|tsx)\><r> 
                        \\  <b><green>bun create<r> <magenta>\<template\><r> <cyan>[...flags]<r> <blue>dest<r> 
                        \\  <b><green>bun create<r> <magenta>\<github-org/repo\><r> <cyan>[...flags]<r> <blue>dest<r>
                        \\
                        \\<b>Environment variables<r><d>:<r>
                        \\  <cyan>GITHUB_TOKEN<r>         <d>Supply a token to download code from GitHub with a higher rate limit<r>
                        \\  <cyan>GITHUB_API_DOMAIN<r>    <d>Configure custom/enterprise GitHub domain. Default "api.github.com"<r>
                        \\  <cyan>NPM_CLIENT<r>           <d>Absolute path to the npm client executable<r>
                        \\  <cyan>BUN_CREATE_DIR<r>       <d>Custom path for global templates (default: $HOME/.bun-create)<r>
                    ;

                    const outro_text =
                        \\<b>React Component Projects<r><d>:<r>
                        \\  • Turn an existing React component into a complete frontend dev environment
                        \\  • Automatically starts a hot-reloading dev server
                        \\  • Auto-detects & configures TailwindCSS and shadcn/ui
                        \\
                        \\  <b><magenta>bun create \<MyReactComponent.(jsx|tsx)\><r>
                        \\
                        \\<b>Templates<r><d>:<r>
                        \\  • NPM: Runs <b><magenta>bunx create-\<template\><r> with given arguments
                        \\  • GitHub: Downloads repository contents as template
                        \\  • Local: Uses templates from $HOME/.bun-create/\<name\> or ./.bun-create/\<name\>
                        \\
                        \\Learn more: <magenta>https://bun.sh/docs/cli/bun-create<r>
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
                        \\<b>Usage<r>: <b><green>bun upgrade<r> <cyan>[flags]<r>
                        \\  Upgrade Bun
                    ;
                    const outro_text =
                        \\<b>Examples:<r>
                        \\  <d>Install the latest {s} version<r>
                        \\  <b><green>bun upgrade<r>
                        \\
                        \\  <d>{s}<r>
                        \\  <b><green>bun upgrade<r> <cyan>--{s}<r>
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/installation#upgrading<r>
                        \\
                    ;

                    const args = comptime switch (Environment.is_canary) {
                        true => .{ "canary", "Switch from the canary version back to the latest stable release", "stable" },
                        false => .{ "stable", "Install the most recent canary version of Bun", "canary" },
                    };

                    Output.pretty(intro_text, .{});
                    Output.pretty("\n\n", .{});
                    Output.flush();
                    Output.pretty(outro_text, args);
                    Output.flush();
                },
                Command.Tag.ReplCommand => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun repl<r> <cyan>[flags]<r>
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
                Command.Tag.PatchCommand => {
                    Install.PackageManager.CommandLineArguments.printHelp(.patch);
                },
                Command.Tag.PatchCommitCommand => {
                    Install.PackageManager.CommandLineArguments.printHelp(.@"patch-commit");
                },
                Command.Tag.ExecCommand => {
                    Output.pretty(
                        \\<b>Usage: bun exec <r><cyan>\<script\><r>
                        \\
                        \\Execute a shell script directly from Bun.
                        \\
                        \\<b><red>Note<r>: If executing this from a shell, make sure to escape the string!
                        \\
                        \\<b>Examples<d>:<r>
                        \\  <b>bun exec "echo hi"<r>
                        \\  <b>bun exec "echo \"hey friends\"!"<r>
                        \\
                    , .{});
                    Output.flush();
                },
                .OutdatedCommand, .PublishCommand, .AuditCommand => {
                    Install.PackageManager.CommandLineArguments.printHelp(switch (cmd) {
                        .OutdatedCommand => .outdated,
                        .PublishCommand => .publish,
                        .AuditCommand => .audit,
                    });
                },
                .InfoCommand => {
                    const intro_text =
                        \\<b>Usage<r>: <b><green>bun info<r> <cyan>[flags]<r> <blue>\<package\><r><d>\<@version\><r> <blue>[property path]<r>
                        \\  Display package metadata from the registry.
                        \\
                        \\<b>Examples:<r>
                        \\  <d>View basic information about a package<r>
                        \\  <b><green>bun info<r> <blue>react<r>
                        \\
                        \\  <d>View specific version<r>
                        \\  <b><green>bun info<r> <blue>react@18.0.0<r>
                        \\
                        \\  <d>View specific property<r>
                        \\  <b><green>bun info<r> <blue>react<r> version
                        \\  <b><green>bun info<r> <blue>react<r> dependencies
                        \\  <b><green>bun info<r> <blue>react<r> versions
                        \\
                        \\Full documentation is available at <magenta>https://bun.sh/docs/cli/info<r>
                        \\
                    ;

                    Output.pretty(intro_text, .{});
                    Output.flush();
                },
                else => {
                    HelpCommand.printWithReason(.explicit);
                },
            }
        }

        pub fn readGlobalConfig(this: Tag) bool {
            return switch (this) {
                .BunxCommand,
                .PackageManagerCommand,
                .InstallCommand,
                .AddCommand,
                .RemoveCommand,
                .UpdateCommand,
                .PatchCommand,
                .PatchCommitCommand,
                .OutdatedCommand,
                .PublishCommand,
                .AuditCommand,
                => true,
                else => false,
            };
        }

        pub fn isNPMRelated(this: Tag) bool {
            return switch (this) {
                .BunxCommand,
                .LinkCommand,
                .UnlinkCommand,
                .PackageManagerCommand,
                .InstallCommand,
                .AddCommand,
                .RemoveCommand,
                .UpdateCommand,
                .PatchCommand,
                .PatchCommitCommand,
                .OutdatedCommand,
                .PublishCommand,
                .AuditCommand,
                => true,
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
            .PatchCommand = true,
            .PatchCommitCommand = true,
            .PackageManagerCommand = true,
            .BunxCommand = true,
            .AutoCommand = true,
            .RunCommand = true,
            .RunAsNodeCommand = true,
            .OutdatedCommand = true,
            .PublishCommand = true,
            .AuditCommand = true,
        });

        pub const always_loads_config: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(false, .{
            .BuildCommand = true,
            .TestCommand = true,
            .InstallCommand = true,
            .AddCommand = true,
            .RemoveCommand = true,
            .UpdateCommand = true,
            .PatchCommand = true,
            .PatchCommitCommand = true,
            .PackageManagerCommand = true,
            .BunxCommand = true,
            .OutdatedCommand = true,
            .PublishCommand = true,
            .AuditCommand = true,
        });

        pub const uses_global_options: std.EnumArray(Tag, bool) = std.EnumArray(Tag, bool).initDefault(true, .{
            .AddCommand = false,
            .AuditCommand = false,
            .BunxCommand = false,
            .CreateCommand = false,
            .InfoCommand = false,
            .InstallCommand = false,
            .LinkCommand = false,
            .OutdatedCommand = false,
            .PackageManagerCommand = false,
            .PatchCommand = false,
            .PatchCommitCommand = false,
            .PublishCommand = false,
            .RemoveCommand = false,
            .UnlinkCommand = false,
            .UpdateCommand = false,
        });
    };
};

pub fn printVersionAndExit() noreturn {
    @branchHint(.cold);
    Output.writer().writeAll(Global.package_json_version ++ "\n") catch {};
    Global.exit(0);
}

pub fn printRevisionAndExit() noreturn {
    @branchHint(.cold);
    Output.writer().writeAll(Global.package_json_version_with_revision ++ "\n") catch {};
    Global.exit(0);
}
