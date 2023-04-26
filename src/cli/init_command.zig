const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const open = @import("../open.zig");
const CLI = @import("../cli.zig");
const Fs = @import("../fs.zig");
const ParseJSON = @import("../json_parser.zig").ParseJSONUTF8;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const linker = @import("../linker.zig");
const options = @import("../options.zig");
const initializeStore = @import("./create_command.zig").initializeStore;
const lex = bun.js_lexer;
const logger = @import("root").bun.logger;
const JSPrinter = bun.js_printer;

fn exists(path: anytype) bool {
    if (@TypeOf(path) == [:0]const u8 or @TypeOf(path) == [:0]u8) {
        if (std.os.accessZ(path, 0)) {
            return true;
        } else |_| {
            return false;
        }
    } else {
        if (std.os.access(path, 0)) {
            return true;
        } else |_| {
            return false;
        }
    }
}
pub const InitCommand = struct {
    fn prompt(
        alloc: std.mem.Allocator,
        comptime label: string,
        default: []const u8,
        _: bool,
    ) ![]const u8 {
        Output.pretty(label, .{});
        if (default.len > 0) {
            Output.pretty("<d>({s}):<r> ", .{default});
        }

        Output.flush();

        const input = try std.io.getStdIn().reader().readUntilDelimiterAlloc(alloc, '\n', 1024);
        if (input.len > 0) {
            return input;
        } else {
            return default;
        }
    }

    const default_gitignore = @embedFile("gitignore-for-init");
    const default_tsconfig = @embedFile("tsconfig-for-init.json");
    const README = @embedFile("README-for-init.md");

    // TODO: unicode case folding
    fn normalizePackageName(allocator: std.mem.Allocator, input: []const u8) ![]const u8 {
        // toLowerCase
        const needs_normalize = brk: {
            for (input) |c| {
                if ((std.ascii.isUpper(c)) or c == ' ' or c == '"' or c == '\'') {
                    break :brk true;
                }
            }
            break :brk false;
        };

        if (!needs_normalize) {
            return input;
        }

        var new = try allocator.alloc(u8, input.len);
        for (input, 0..) |c, i| {
            if (c == ' ' or c == '"' or c == '\'') {
                new[i] = '-';
            } else {
                new[i] = std.ascii.toLower(c);
            }
        }

        return new;
    }

    const PackageJSONFields = struct {
        name: string = "project",
        type: string = "module",
        object: *js_ast.E.Object = undefined,
        entry_point: string = "",
    };

    pub fn exec(alloc: std.mem.Allocator, argv: [][*:0]u8) !void {
        var fs = try Fs.FileSystem.init(null);
        const pathname = Fs.PathName.init(fs.topLevelDirWithoutTrailingSlash());
        const destination_dir = std.fs.cwd();

        var fields = PackageJSONFields{};

        var package_json_file = destination_dir.openFile("package.json", .{ .mode = .read_write }) catch null;
        var package_json_contents: MutableString = MutableString.initEmpty(alloc);
        initializeStore();
        read_package_json: {
            if (package_json_file) |pkg| {
                const stat = pkg.stat() catch break :read_package_json;

                if (stat.kind != .File or stat.size == 0) {
                    break :read_package_json;
                }
                package_json_contents = try MutableString.init(alloc, stat.size);
                package_json_contents.list.expandToCapacity();

                _ = pkg.preadAll(package_json_contents.list.items, 0) catch {
                    package_json_file = null;
                    break :read_package_json;
                };
            }
        }

        fields.name = brk: {
            if (normalizePackageName(alloc, if (pathname.filename.len > 0) pathname.filename else "")) |name| {
                if (name.len > 0) {
                    break :brk name;
                }
            } else |_| {}

            break :brk "project";
        };
        var did_load_package_json = false;
        if (package_json_contents.list.items.len > 0) {
            process_package_json: {
                var source = logger.Source.initPathString("package.json", package_json_contents.list.items);
                var log = logger.Log.init(alloc);
                var package_json_expr = ParseJSON(&source, &log, alloc) catch {
                    package_json_file = null;
                    break :process_package_json;
                };

                if (package_json_expr.data != .e_object) {
                    package_json_file = null;
                    break :process_package_json;
                }

                fields.object = package_json_expr.data.e_object;

                if (package_json_expr.get("name")) |name| {
                    if (name.asString(alloc)) |str| {
                        fields.name = str;
                    }
                }

                if (package_json_expr.get("module") orelse package_json_expr.get("main")) |name| {
                    if (name.asString(alloc)) |str| {
                        fields.entry_point = str;
                    }
                }

                did_load_package_json = true;
            }
        }

        if (fields.entry_point.len == 0) {
            infer: {
                const paths_to_try = [_][:0]const u8{
                    @as([:0]const u8, "index.mts"),
                    @as([:0]const u8, "index.tsx"),
                    @as([:0]const u8, "index.ts"),
                    @as([:0]const u8, "index.jsx"),
                    @as([:0]const u8, "index.mjs"),
                    @as([:0]const u8, "index.js"),
                };

                for (paths_to_try) |path| {
                    if (exists(path)) {
                        fields.entry_point = bun.asByteSlice(path);
                        break :infer;
                    }
                }

                fields.entry_point = "index.ts";
            }
        }

        if (!did_load_package_json) {
            fields.object = js_ast.Expr.init(
                js_ast.E.Object,
                .{},
                logger.Loc.Empty,
            ).data.e_object;
        }

        const auto_yes = brk: {
            for (argv) |arg_| {
                const arg = bun.span(arg_);
                if (strings.eqlComptime(arg, "-y") or strings.eqlComptime(arg, "--yes")) {
                    break :brk true;
                }
            }
            break :brk false;
        };

        if (!auto_yes) {
            Output.prettyln("<r><b>bun init<r> helps you get started with a minimal project and tries to guess sensible defaults. <d>Press ^C anytime to quit<r>\n\n", .{});
            Output.flush();

            fields.name = try normalizePackageName(alloc, try prompt(
                alloc,
                "<r><cyan>package name<r> ",
                fields.name,
                Output.enable_ansi_colors_stdout,
            ));
            fields.entry_point = try prompt(
                alloc,
                "<r><cyan>entry point<r> ",
                fields.entry_point,
                Output.enable_ansi_colors_stdout,
            );
            try Output.writer().writeAll("\n");
            Output.flush();
        }

        const Steps = struct {
            write_gitignore: bool = true,
            write_package_json: bool = true,
            write_tsconfig: bool = true,
            write_readme: bool = true,
        };

        var steps = Steps{};

        steps.write_gitignore = brk: {
            if (exists(".gitignore")) {
                break :brk false;
            }

            break :brk true;
        };

        steps.write_readme = !exists("README.md") and !exists("README") and !exists("README.txt") and !exists("README.mdx");

        steps.write_tsconfig = brk: {
            if (exists("tsconfig.json")) {
                break :brk false;
            }

            if (exists("jsconfig.json")) {
                break :brk false;
            }

            break :brk true;
        };

        {
            try fields.object.putString(alloc, "name", fields.name);
            if (fields.entry_point.len > 0) {
                if (fields.object.hasProperty("module")) {
                    try fields.object.putString(alloc, "module", fields.entry_point);
                    try fields.object.putString(alloc, "type", "module");
                } else if (fields.object.hasProperty("main")) {
                    try fields.object.putString(alloc, "main", fields.entry_point);
                } else {
                    try fields.object.putString(alloc, "module", fields.entry_point);
                    try fields.object.putString(alloc, "type", "module");
                }
            }

            const needs_dev_dependencies = brk: {
                if (fields.object.get("devDependencies")) |deps| {
                    if (deps.hasAnyPropertyNamed(&.{"bun-types"})) {
                        break :brk false;
                    }
                }

                break :brk true;
            };

            const needs_typescript_dependency = brk: {
                if (fields.object.get("devDependencies")) |deps| {
                    if (deps.hasAnyPropertyNamed(&.{"typescript"})) {
                        break :brk false;
                    }
                }

                if (fields.object.get("peerDependencies")) |deps| {
                    if (deps.hasAnyPropertyNamed(&.{"typescript"})) {
                        break :brk false;
                    }
                }

                break :brk true;
            };

            if (needs_dev_dependencies) {
                var dev_dependencies = fields.object.get("devDependencies") orelse js_ast.Expr.init(js_ast.E.Object, js_ast.E.Object{}, logger.Loc.Empty);
                const version = comptime brk: {
                    var base = Global.version;
                    base.patch = 0;
                    break :brk base;
                };

                try dev_dependencies.data.e_object.putString(alloc, "bun-types", comptime std.fmt.comptimePrint("^{any}", .{version.fmt("")}));
                try fields.object.put(alloc, "devDependencies", dev_dependencies);
            }

            if (needs_typescript_dependency) {
                var peer_dependencies = fields.object.get("peer_dependencies") orelse js_ast.Expr.init(js_ast.E.Object, js_ast.E.Object{}, logger.Loc.Empty);
                try peer_dependencies.data.e_object.putString(alloc, "typescript", "^5.0.0");
                try fields.object.put(alloc, "peerDependencies", peer_dependencies);
            }
        }

        write_package_json: {
            if (package_json_file == null) {
                package_json_file = try std.fs.cwd().createFileZ("package.json", .{});
            }
            var package_json_writer = JSPrinter.NewFileWriter(package_json_file.?);

            const written = JSPrinter.printJSON(
                @TypeOf(package_json_writer),
                package_json_writer,
                js_ast.Expr{ .data = .{ .e_object = fields.object }, .loc = logger.Loc.Empty },
                &logger.Source.initEmptyFile("package.json"),
            ) catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                package_json_file = null;
                break :write_package_json;
            };

            std.os.ftruncate(package_json_file.?.handle, written + 1) catch {};
            package_json_file.?.close();
        }

        if (package_json_file != null) {
            Output.prettyln("<r><green>Done!<r> A package.json file was saved in the current directory.", .{});
        }

        if (fields.entry_point.len > 0 and !exists(fields.entry_point)) {
            var entry = try std.fs.cwd().createFile(fields.entry_point, .{ .truncate = true });
            entry.writeAll("console.log(\"Hello via Bun!\");") catch {};
            entry.close();
            Output.prettyln(" + <r><d>{s}<r>", .{fields.entry_point});
            Output.flush();
        }

        if (steps.write_gitignore) {
            brk: {
                var file = std.fs.cwd().createFileZ(".gitignore", .{ .truncate = true }) catch break :brk;
                defer file.close();
                file.writeAll(default_gitignore) catch break :brk;
                Output.prettyln(" + <r><d>.gitignore<r>", .{});
                Output.flush();
            }
        }

        if (steps.write_tsconfig) {
            brk: {
                const extname = std.fs.path.extension(fields.entry_point);
                const loader = options.defaultLoaders.get(extname) orelse options.Loader.ts;
                const filename = if (loader.isTypeScript())
                    "tsconfig.json"
                else
                    "jsconfig.json";
                var file = std.fs.cwd().createFileZ(filename, .{ .truncate = true }) catch break :brk;
                defer file.close();
                file.writeAll(default_tsconfig) catch break :brk;
                Output.prettyln(" + <r><d>{s}<r><d> (for editor auto-complete)<r>", .{filename});
                Output.flush();
            }
        }

        if (steps.write_readme) {
            brk: {
                const filename = "README.md";
                var file = std.fs.cwd().createFileZ(filename, .{ .truncate = true }) catch break :brk;
                defer file.close();
                file.writer().print(README, .{
                    .name = fields.name,
                    .bunVersion = Global.version.fmt(""),
                    .entryPoint = fields.entry_point,
                }) catch break :brk;
                Output.prettyln(" + <r><d>{s}<r>", .{filename});
                Output.flush();
            }
        }

        if (fields.entry_point.len > 0) {
            Output.prettyln("\nTo get started, run:", .{});
            if (strings.containsAny(
                " \"'",
                fields.entry_point,
            )) {
                Output.prettyln("  <r><cyan>bun run {any}<r>", .{JSPrinter.formatJSONString(fields.entry_point)});
            } else {
                Output.prettyln("  <r><cyan>bun run {s}<r>", .{fields.entry_point});
            }
        }

        Output.flush();

        if (exists("package.json")) {
            var process = std.ChildProcess.init(
                &.{
                    try std.fs.selfExePathAlloc(alloc),
                    "install",
                },
                alloc,
            );
            process.stderr_behavior = .Pipe;
            process.stdin_behavior = .Pipe;
            process.stdout_behavior = .Pipe;
            _ = try process.spawnAndWait();
        }
    }
};
