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
usingnamespace @import("global.zig");
const panicky = @import("panic_handler.zig");
pub const MainPanicHandler = panicky.NewPanicHandler(panicky.default_panic);
const Api = @import("api/schema.zig").Api;
const resolve_path = @import("./resolver/resolve_path.zig");
const clap = @import("clap");
const bundler = @import("bundler.zig");
const fs = @import("fs.zig");
const NodeModuleBundle = @import("./node_module_bundle.zig").NodeModuleBundle;
const js = @import("javascript/jsc/bindings/bindings.zig");
usingnamespace @import("javascript/jsc/javascript.zig");
const allocators = @import("allocators.zig");
pub fn panic(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace) noreturn {
    if (MainPanicHandler.Singleton) |singleton| {
        MainPanicHandler.handle_panic(msg, error_return_trace);
    } else {
        panicky.default_panic(msg, error_return_trace);
    }
}

pub const JSGlobalObject = struct {};

const constStrToU8 = allocators.constStrToU8;
pub fn main() anyerror!void {
    // The memory allocator makes a massive difference.
    // std.heap.raw_c_allocator and std.heap.c_allocator perform similarly.
    // std.heap.GeneralPurposeAllocator makes this about 3x _slower_ than esbuild.
    // var root_alloc = std.heap.ArenaAllocator.init(std.heap.raw_c_allocator);
    // var root_alloc_ = &root_alloc.allocator;
    try alloc.setup(std.heap.c_allocator);
    var stdout = std.io.getStdOut();
    // var stdout = std.io.bufferedWriter(stdout_file.writer());
    var stderr = std.io.getStdErr();
    // var stderr = std.io.bufferedWriter(stderr_file.writer());
    var output_source = Output.Source.init(stdout, stderr);
    // defer stdout.flush() catch {};
    // defer stderr.flush() catch {};
    Output.Source.set(&output_source);
    Output.enable_ansi_colors = stderr.isTty();
    defer Output.flush();
    try Cli.start(
        std.heap.c_allocator,
        stdout,
        stderr,
    );
}

pub const Cli = struct {
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

        pub fn parse(allocator: *std.mem.Allocator, stdout: anytype, stderr: anytype) !Api.TransformOptions {
            @setEvalBranchQuota(9999);
            const params = comptime [_]clap.Param(clap.Help){
                clap.parseParam("-h, --help                        Display this help and exit.              ") catch unreachable,
                clap.parseParam("-r, --resolve <STR>               Determine import/require behavior. \"disable\" ignores. \"dev\" bundles node_modules and builds everything else as independent entry points") catch unreachable,
                clap.parseParam("-d, --define <STR>...             Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:development") catch unreachable,
                clap.parseParam("-l, --loader <STR>...             Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: jsx, js, json, tsx (not implemented yet), ts (not implemented yet), css (not implemented yet)") catch unreachable,
                clap.parseParam("-o, --outdir <STR>                Save output to directory (default: \"out\" if none provided and multiple entry points passed)") catch unreachable,
                clap.parseParam("-e, --external <STR>...           Exclude module from transpilation (can use * wildcards). ex: -e react") catch unreachable,
                clap.parseParam("-i, --inject <STR>...             Inject module at the top of every file") catch unreachable,
                clap.parseParam("--cwd <STR>                       Absolute path to resolve entry points from. Defaults to cwd") catch unreachable,
                clap.parseParam("--public-url <STR>                Rewrite import paths to start with --public-url. Useful for web browsers.") catch unreachable,
                clap.parseParam("--serve                           Start a local dev server. This also sets resolve to \"lazy\".") catch unreachable,
                clap.parseParam("--public-dir <STR>                Top-level directory for .html files, fonts, images, or anything external. Only relevant with --serve. Defaults to \"<cwd>/public\", to match create-react-app and Next.js") catch unreachable,
                clap.parseParam("--jsx-factory <STR>               Changes the function called when compiling JSX elements using the classic JSX runtime") catch unreachable,
                clap.parseParam("--jsx-fragment <STR>              Changes the function called when compiling JSX fragments using the classic JSX runtime") catch unreachable,
                clap.parseParam("--jsx-import-source <STR>         Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: \"react\"") catch unreachable,
                clap.parseParam("--jsx-runtime <STR>               \"automatic\" (default) or \"classic\"") catch unreachable,
                clap.parseParam("--jsx-production                  Use jsx instead of jsxDEV (default) for the automatic runtime") catch unreachable,
                clap.parseParam("--extension-order <STR>...        defaults to: .tsx,.ts,.jsx,.js,.json ") catch unreachable,
                clap.parseParam("--disable-react-fast-refresh      Disable React Fast Refresh. Enabled if --serve is set and --jsx-production is not set. Otherwise, it's a noop.") catch unreachable,
                clap.parseParam("--tsconfig-override <STR>         Load tsconfig from path instead of cwd/tsconfig.json") catch unreachable,
                clap.parseParam("--platform <STR>                  \"browser\" or \"node\". Defaults to \"browser\"") catch unreachable,
                clap.parseParam("--main-fields <STR>...            Main fields to lookup in package.json. Defaults to --platform dependent") catch unreachable,
                clap.parseParam("--scan                            Instead of bundling or transpiling, print a list of every file imported by an entry point, recursively") catch unreachable,
                clap.parseParam("--new-jsb                         Generate a new node_modules.jsb file from node_modules and entry point(s)") catch unreachable,
                clap.parseParam("--jsb <STR>                       Use a Speedy JavaScript Bundle (default: \"./node_modules.jsb\" if exists)") catch unreachable,
                // clap.parseParam("--no-jsb                          Use a Speedy JavaScript Bundle (default: \"./node_modules.jsb\" if exists)") catch unreachable,
                clap.parseParam("<POS>...                          Entry points to use") catch unreachable,
            };

            var diag = clap.Diagnostic{};

            var args = clap.parse(clap.Help, &params, .{ .diagnostic = &diag }) catch |err| {
                // Report useful error and exit
                diag.report(stderr.writer(), err) catch {};
                return err;
            };

            if (args.flag("--help")) {
                try clap.help(stderr.writer(), &params);
                std.process.exit(1);
            }

            var cwd_paths = [_]string{args.option("--cwd") orelse try std.process.getCwdAlloc(allocator)};
            var cwd = try std.fs.path.resolve(allocator, &cwd_paths);
            var tsconfig_override = if (args.option("--tsconfig-override")) |ts| (Arguments.readFile(allocator, cwd, ts) catch |err| fileReadError(err, stderr, ts, "tsconfig.json")) else null;
            var public_url = args.option("--public-url");
            var defines_tuple = try DefineColonList.resolve(allocator, args.options("--define"));
            var loader_tuple = try LoaderColonList.resolve(allocator, args.options("--define"));

            var define_keys = defines_tuple.keys;
            var define_values = defines_tuple.values;
            var loader_keys = loader_tuple.keys;
            var loader_values = loader_tuple.values;
            var entry_points = args.positionals();
            var inject = args.options("--inject");
            var output_dir = args.option("--outdir");
            const serve = false;

            var write = entry_points.len > 1 or output_dir != null;
            if (write and output_dir == null) {
                var _paths = [_]string{ cwd, "out" };
                output_dir = try std.fs.path.resolve(allocator, &_paths);
            }
            var externals = std.mem.zeroes([][]u8);
            if (args.options("--external").len > 0) {
                externals = try allocator.alloc([]u8, args.options("--external").len);
                for (args.options("--external")) |external, i| {
                    externals[i] = constStrToU8(external);
                }
            }

            var jsx_factory = args.option("--jsx-factory");
            var jsx_fragment = args.option("--jsx-fragment");
            var jsx_import_source = args.option("--jsx-import-source");
            var jsx_runtime = args.option("--jsx-runtime");
            var jsx_production = args.flag("--jsx-production");
            var react_fast_refresh = false;

            if (serve or args.flag("--new-jsb")) {
                react_fast_refresh = true;
                if (args.flag("--disable-react-fast-refresh") or jsx_production) {
                    react_fast_refresh = false;
                }
            }

            var main_fields = args.options("--main-fields");

            var node_modules_bundle_path = args.option("--jsb") orelse brk: {
                if (args.flag("--new-jsb")) {
                    break :brk null;
                }

                const node_modules_bundle_path_absolute = resolve_path.joinAbs(cwd, .auto, "node_modules.jsb");
                std.fs.accessAbsolute(node_modules_bundle_path_absolute, .{}) catch |err| {
                    break :brk null;
                };

                break :brk node_modules_bundle_path_absolute;
            };

            if (node_modules_bundle_path != null) {
                node_modules_bundle_path = try std.fs.realpathAlloc(allocator, node_modules_bundle_path.?);
            }

            if (args.flag("--new-jsb")) {
                node_modules_bundle_path = null;
            }

            const PlatformMatcher = strings.ExactSizeMatcher(8);
            const ResoveMatcher = strings.ExactSizeMatcher(8);

            var resolve = Api.ResolveMode.lazy;
            if (args.option("--resolve")) |_resolve| {
                switch (PlatformMatcher.match(_resolve)) {
                    PlatformMatcher.case("disable") => {
                        resolve = Api.ResolveMode.disable;
                    },
                    PlatformMatcher.case("bundle") => {
                        resolve = Api.ResolveMode.bundle;
                    },
                    PlatformMatcher.case("dev") => {
                        resolve = Api.ResolveMode.dev;
                    },
                    PlatformMatcher.case("lazy") => {
                        resolve = Api.ResolveMode.lazy;
                    },
                    else => {
                        diag.name.long = "--resolve";
                        diag.arg = _resolve;
                        try diag.report(stderr.writer(), error.InvalidResolveOption);
                        std.process.exit(1);
                    },
                }
            }

            var platform: ?Api.Platform = null;

            if (args.option("--platform")) |_platform| {
                switch (PlatformMatcher.match(_platform)) {
                    PlatformMatcher.case("browser") => {
                        platform = Api.Platform.browser;
                    },
                    PlatformMatcher.case("node") => {
                        platform = Api.Platform.node;
                    },
                    else => {
                        diag.name.long = "--platform";
                        diag.arg = _platform;
                        try diag.report(stderr.writer(), error.InvalidPlatform);
                        std.process.exit(1);
                    },
                }
            }

            var jsx: ?Api.Jsx = null;
            if (jsx_factory != null or
                jsx_fragment != null or
                jsx_import_source != null or
                jsx_runtime != null or
                jsx_production or react_fast_refresh)
            {
                var default_factory = "".*;
                var default_fragment = "".*;
                var default_import_source = "".*;
                jsx = Api.Jsx{
                    .factory = constStrToU8(jsx_factory orelse &default_factory),
                    .fragment = constStrToU8(jsx_fragment orelse &default_fragment),
                    .import_source = constStrToU8(jsx_import_source orelse &default_import_source),
                    .runtime = if (jsx_runtime != null) try resolve_jsx_runtime(jsx_runtime.?) else Api.JsxRuntime.automatic,
                    .development = !jsx_production,
                    .react_fast_refresh = react_fast_refresh,
                };
            }

            if (entry_points.len == 0) {
                try clap.help(stderr.writer(), &params);
                try diag.report(stderr.writer(), error.MissingEntryPoint);
                std.process.exit(1);
            }

            return Api.TransformOptions{
                .jsx = jsx,
                .output_dir = output_dir,
                .resolve = resolve,
                .external = externals,
                .absolute_working_dir = cwd,
                .tsconfig_override = tsconfig_override,
                .public_url = public_url,
                .define = .{
                    .keys = define_keys,
                    .values = define_values,
                },
                .loaders = .{
                    .extensions = loader_keys,
                    .loaders = loader_values,
                },
                .node_modules_bundle_path = node_modules_bundle_path,
                .public_dir = if (args.option("--public-dir")) |public_dir| allocator.dupe(u8, public_dir) catch unreachable else null,
                .write = write,
                .platform = .speedy,
                .serve = serve,
                .inject = inject,
                .entry_points = entry_points,
                .extension_order = args.options("--extension-order"),
                .main_fields = args.options("--main-fields"),
                .only_scan_dependencies = if (args.flag("--scan")) Api.ScanDependencyMode.all else Api.ScanDependencyMode._none,
                .generate_node_module_bundle = if (args.flag("--new-jsb")) true else false,
            };
        }
    };
    pub fn resolve_jsx_runtime(str: string) !Api.JsxRuntime {
        if (strings.eql(str, "automatic")) {
            return Api.JsxRuntime.automatic;
        } else if (strings.eql(str, "fallback")) {
            return Api.JsxRuntime.classic;
        } else {
            return error.InvalidJSXRuntime;
        }
    }
    pub fn printScanResults(scan_results: bundler.ScanResult.Summary, allocator: *std.mem.Allocator) !void {
        var stdout = std.io.getStdOut();
        const print_start = std.time.nanoTimestamp();
        try std.json.stringify(scan_results.list(), .{}, stdout.writer());
        Output.printError("\nJSON printing took: {d}\n", .{std.time.nanoTimestamp() - print_start});
    }
    pub fn startTransform(allocator: *std.mem.Allocator, args: Api.TransformOptions, log: *logger.Log) anyerror!void {}
    const StringS = struct {
        pub const src = "var headers = new Headers(); headers.set(\"hey\", \"hi\"); console.log(headers.get(\"hey\")); \"HELLO\";";
    };

    pub fn start(allocator: *std.mem.Allocator, stdout: anytype, stderr: anytype) anyerror!void {
        const start_time = std.time.nanoTimestamp();
        var log = logger.Log.init(allocator);
        var panicker = MainPanicHandler.init(&log);
        MainPanicHandler.Singleton = &panicker;

        var args = try Arguments.parse(alloc.static, stdout, stderr);
        // var serve_bundler = try bundler.ServeBundler.init(allocator, &log, args);
        // var res = try serve_bundler.buildFile(&log, allocator, args.entry_points[0], std.fs.path.extension(args.entry_points[0]));

        // var results = try bundler.Bundler.bundle(allocator, &log, args);
        // var file = results.output_files[0];
        var vm = try VirtualMachine.init(allocator, args, null, &log);
        // var resolved_entry_point = try vm.bundler.resolver.resolve(
        //     vm.bundler.fs.top_level_dir,
        //     vm.bundler.normalizeEntryPointPath(vm.bundler.options.entry_points[0]),
        //     .entry_point,
        // );

        var exception = js.JSValue.jsUndefined();
        var result = js.JSModuleLoader.evaluate(
            vm.global,
            StringS.src,
            StringS.src.len,
            "/hi.js",
            "/hi.js".len,
            js.JSValue.jsUndefined(),
            @ptrCast([*]js.JSValue, &exception),
        );

        if (!exception.isUndefined()) {
            var str = exception.toWTFString(vm.global);
            var slice = str.slice();
            _ = Output.errorWriter().write(slice) catch 0;
        }
    }
};

pub const JavaScript = struct {};
