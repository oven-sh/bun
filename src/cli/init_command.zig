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
const JSON = bun.JSON;
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const linker = @import("../linker.zig");
const options = @import("../options.zig");
const initializeStore = @import("./create_command.zig").initializeStore;
const lex = bun.js_lexer;
const logger = bun.logger;
const JSPrinter = bun.js_printer;
const exists = bun.sys.exists;
const existsZ = bun.sys.existsZ;

// make terminal input raw
fn setRawInput(b: bool) !void {
    if (comptime Environment.isWindows) {
        const ENABLE_ECHO_INPUT: u32 = 0x0004;
        const ENABLE_LINE_INPUT: u32 = 0x0002;

        const handle = std.io.getStdIn().handle;
        var flags: u32 = undefined;
        if (std.windows.kernel32.GetConsoleMode(handle, &flags) == 0) return error.NotATerminal;
        if (b) {
            flags &= ~(ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT);
        } else {
            flags |= ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT;
        }

        std.debug.assert(std.windows.kernel32.SetConsoleMode(handle, flags) != 0);
    } else {
        var t: std.posix.termios = try std.posix.tcgetattr(std.posix.STDIN_FILENO);

        t.lflag.ECHO = !b;
        t.lflag.ICANON = !b;
        t.lflag.FLUSHO = true;
        try std.posix.tcsetattr(std.posix.STDIN_FILENO, .NOW, t);
    }
}

// Convert string to PascalCase
fn toPascalCase(allocator: std.mem.Allocator, input: []const u8) ![]const u8 {
    var result = try allocator.alloc(u8, input.len);
    var output_index: usize = 0;
    var capitalize_next = true;

    for (input) |c| {
        if (c == '-' or c == '_' or c == ' ') {
            capitalize_next = true;
            continue;
        }

        if (capitalize_next) {
            if (c >= 'a' and c <= 'z') {
                result[output_index] = c - 32;
            } else {
                result[output_index] = c;
            }
            capitalize_next = false;
        } else {
            result[output_index] = c;
        }
        output_index += 1;
    }

    return result[0..output_index];
}

pub const InitCommand = struct {
    pub fn prompt(
        alloc: std.mem.Allocator,
        comptime label: string,
        default: []const u8,
    ) ![]const u8 {
        Output.pretty(label, .{});
        if (default.len > 0) {
            Output.pretty("<d>({s}):<r> ", .{default});
        }

        Output.flush();

        // unset `ENABLE_VIRTUAL_TERMINAL_INPUT` on windows. This prevents backspace from
        // deleting the entire line
        const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
            bun.win32.unsetStdioModeFlags(0, bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT) catch null;

        defer if (comptime Environment.isWindows) {
            if (original_mode) |mode| {
                _ = bun.windows.SetConsoleMode(bun.win32.STDIN_FD.cast(), mode);
            }
        };

        var input = try bun.Output.buffered_stdin.reader().readUntilDelimiterAlloc(alloc, '\n', 1024);
        if (strings.endsWithChar(input, '\r')) {
            input = input[0 .. input.len - 1];
        }
        if (input.len > 0) {
            return input;
        } else {
            return default;
        }
    }

    pub fn promptBool(
        _: std.mem.Allocator,
        comptime label: []const u8,
        default: bool,
    ) !bool {
        Output.prettyln(label, .{});
        Output.flush();

        const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
            bun.win32.unsetStdioModeFlags(0, bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT) catch null;

        defer if (comptime Environment.isWindows) {
            if (original_mode) |mode| {
                _ = bun.windows.SetConsoleMode(bun.win32.STDIN_FD.cast(), mode);
            }
        };

        Output.flush();
        try setRawInput(true);
        defer setRawInput(false) catch unreachable;
        const reader = std.io.getStdIn().reader();
        const val: bool = brk: {
            var selected = default;

            while (true) {
                Output.pretty("\r\x1B[K", .{});
                if (selected) {
                    Output.pretty("<r><green>●<r> Yes <d>/ ○ No<r>", .{});
                } else {
                    Output.pretty("<r><d>○ Yes / <r><green>●<r> No<r>", .{});
                }
                Output.pretty("\x1B", .{});

                Output.flush();
                const byte = try reader.readByte();

                switch (byte) {
                    'y', 'Y' => break :brk true,
                    'n', 'N' => break :brk false,
                    '\r', '\n' => break :brk selected,
                    '\x1b' => {
                        const seq_byte = try reader.readByte();
                        if (seq_byte != '[') continue;
                        const arrow = try reader.readByte();
                        switch (arrow) {
                            'C' => selected = false, // left arrow
                            'D' => selected = true, // right arrow
                            else => {},
                        }
                    },

                    else => continue,
                }
            }
        };

        Output.pretty("\r\x1B[A\r\x1B[K", .{});
        Output.pretty(label, .{});
        Output.pretty(" {s}\n", .{if (val) "yes" else "no"});
        Output.flush();

        return val;
    }

    pub fn promptSelect(
        comptime label: []const u8,
        opts: []const []const u8,
        default: usize,
    ) !usize {
        Output.prettyln(label, .{});
        for (0..opts.len) |_| {
            Output.prettyln("", .{});
        }
        Output.flush();

        const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
            bun.win32.unsetStdioModeFlags(0, bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT) catch null;

        defer if (comptime Environment.isWindows) {
            if (original_mode) |mode| {
                _ = bun.windows.SetConsoleMode(bun.win32.STDIN_FD.cast(), mode);
            }
        };

        Output.flush();
        try setRawInput(true);
        defer setRawInput(false) catch unreachable;

        const reader = std.io.getStdIn().reader();
        const val: usize = brk: {
            var selected = default;

            while (true) {
                for (0..opts.len) |_| {
                    Output.pretty("\x1B[A", .{});
                }

                for (opts, 0..) |option, i| {
                    if (i == selected) {
                        Output.prettyln("<r><green>●<r> {s}", .{option});
                    } else {
                        Output.prettyln("<r><d>○ {s}<r>", .{option});
                    }
                }
                Output.pretty("\x1B[J", .{});
                Output.flush();

                const byte = try reader.readByte();

                switch (byte) {
                    '\r', '\n' => break :brk selected,
                    '\x1b' => {
                        const seq_byte = try reader.readByte();
                        if (seq_byte != '[') continue;
                        const arrow = try reader.readByte();
                        switch (arrow) {
                            'A' => { // Up arrow
                                if (selected > 0) selected -= 1;
                            },
                            'B' => { // Down arrow
                                if (selected < opts.len - 1) selected += 1;
                            },
                            else => continue,
                        }
                    },
                    else => continue,
                }
            }
        };

        for (0..opts.len + 1) |_| {
            Output.pretty("\x1B[A", .{});
        }
        Output.pretty(label, .{});
        Output.prettyln(" {s}", .{opts[val]});
        Output.prettyln("\x1B[J\x1B[A", .{});
        Output.prettyln("\x1B[J\x1B[A", .{});
        Output.flush();

        return val;
    }

    const Assets = struct {
        // "known" assets
        const @".gitignore" = @embedFile("init/gitignore.default");
        const @"tsconfig.json" = @embedFile("init/tsconfig.default.json");
        const @"README.md" = @embedFile("init/README.default.md");

        /// Create a new asset file, overriding anything that already exists. Known
        /// assets will have their contents pre-populated; otherwise the file will be empty.
        fn create(comptime asset_name: []const u8, args: anytype) !void {
            const is_template = comptime (@TypeOf(args) != @TypeOf(null)) and @typeInfo(@TypeOf(args)).@"struct".fields.len > 0;
            return createFull(asset_name, asset_name, "", is_template, args);
        }

        fn createNew(filename: []const u8, contents: []const u8) !void {
            var file = try std.fs.cwd().createFile(filename, .{ .truncate = true });
            defer file.close();
            try file.writeAll(contents);

            Output.prettyln(" + <r><d>{s}<r>", .{filename});
            Output.flush();
        }

        fn createFull(
            /// name of possibly-existing asset
            comptime asset_name: []const u8,
            /// name of asset file to create
            filename: []const u8,
            /// optionally add a suffix to the end of the `+ filename` message. Must have a leading space.
            comptime message_suffix: []const u8,
            /// Treat the asset as a format string, using `args` to populate it. Only applies to known assets.
            comptime is_template: bool,
            /// Format arguments
            args: anytype,
        ) !void {
            var file = try std.fs.cwd().createFile(filename, .{ .truncate = true });
            defer file.close();

            // Write contents of known assets to the new file. Template assets get formatted.
            if (comptime @hasDecl(Assets, asset_name)) {
                const asset = @field(Assets, asset_name);
                if (comptime is_template) {
                    try file.writer().print(asset, args);
                } else {
                    try file.writeAll(asset);
                }
            }

            Output.prettyln(" + <r><d>{s}{s}<r>", .{ filename, message_suffix });
            Output.flush();
        }
    };

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

    pub fn exec(alloc: std.mem.Allocator, argv: [][:0]const u8) !void {
        const print_help = brk: {
            for (argv) |arg| {
                if (strings.eqlComptime(arg, "--help") or strings.eqlComptime(arg, "-h")) {
                    break :brk true;
                }
            }
            break :brk false;
        };

        if (print_help) {
            CLI.Command.Tag.printHelp(.InitCommand, true);
            Global.exit(0);
        }

        var fs = try Fs.FileSystem.init(null);
        const pathname = Fs.PathName.init(fs.topLevelDirWithoutTrailingSlash());
        const destination_dir = std.fs.cwd();

        var fields = PackageJSONFields{};

        var package_json_file = destination_dir.openFile("package.json", .{ .mode = .read_write }) catch null;
        var package_json_contents: MutableString = MutableString.initEmpty(alloc);
        initializeStore();
        read_package_json: {
            if (package_json_file) |pkg| {
                const size = brk: {
                    if (comptime bun.Environment.isWindows) {
                        const end = pkg.getEndPos() catch break :read_package_json;
                        if (end == 0) {
                            break :read_package_json;
                        }

                        break :brk end;
                    }
                    const stat = pkg.stat() catch break :read_package_json;

                    if (stat.kind != .file or stat.size == 0) {
                        break :read_package_json;
                    }

                    break :brk stat.size;
                };

                package_json_contents = try MutableString.init(alloc, size);
                package_json_contents.list.expandToCapacity();

                const prev_file_pos = if (comptime Environment.isWindows) try pkg.getPos() else 0;
                _ = pkg.preadAll(package_json_contents.list.items, 0) catch {
                    package_json_file = null;
                    break :read_package_json;
                };
                if (comptime Environment.isWindows) try pkg.seekTo(prev_file_pos);
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
                var package_json_expr = JSON.parsePackageJSONUTF8(&source, &log, alloc) catch {
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
                    if (existsZ(path)) {
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

        const auto_yes = Output.stdout_descriptor_type != .terminal or brk: {
            for (argv) |arg_| {
                const arg = bun.span(arg_);
                if (strings.eqlComptime(arg, "-y") or strings.eqlComptime(arg, "--yes")) {
                    break :brk true;
                }
            }
            break :brk false;
        };

        if (!auto_yes) {
            if (!did_load_package_json) {
                Output.prettyln("<r><b>bun init<r> helps you get started with a minimal project and tries to guess sensible defaults. <d>Press ^C anytime to quit<r>\n\n", .{});
                Output.flush();

                const name = prompt(
                    alloc,
                    "<r><cyan>package name<r> ",
                    fields.name,
                ) catch |err| {
                    if (err == error.EndOfStream) return;
                    return err;
                };

                fields.name = try normalizePackageName(alloc, name);

                const template_options = [_][]const u8{
                    "TypeScript (default)",
                    "React + TypeScript",
                    "React + TypeScript + Tailwind + shadcn/ui",
                };

                const selected = promptSelect("<r><cyan>template:<r>", &template_options, 0) catch |err| {
                    if (err == error.EndOfStream) return;
                    return err;
                };

                const FullstackTemplate = enum {
                    base_typescript,
                    react_typescript,
                    react_typescript_tailwind_shadcn,
                };
                // // Set appropriate entry point based on selection
                const fullstack_template: FullstackTemplate = switch (selected) {
                    0 => .base_typescript,
                    1 => .react_typescript,
                    2 => .react_typescript_tailwind_shadcn,
                    else => unreachable,
                };

                if (fullstack_template == .base_typescript) {
                    fields.entry_point = prompt(
                        alloc,
                        "<r><cyan>entry point<r> ",
                        fields.entry_point,
                    ) catch |err| {
                        if (err == error.EndOfStream) return;
                        return err;
                    };
                } else {
                    fields.entry_point = "src/App.tsx";

                    var dependencies = SourceFileProjectGenerator.Dependencies.init(alloc);
                    defer dependencies.deinit();

                    try dependencies.dev_deps.append("@types/bun@latest");
                    try dependencies.dev_deps.append("typescript@^5.0.0");

                    try SourceFileProjectGenerator.generateFromOptions(.{
                        .tailwind = true,
                        .shadcn = if (fullstack_template == .react_typescript_tailwind_shadcn) bun.StringSet.init(alloc) else null,
                        .dependencies = dependencies,
                    }, fields.entry_point, "App");

                    return;
                }

                try Output.writer().writeAll("\n");
                Output.flush();
            } else {
                Output.prettyln("A package.json was found here.", .{});
            }
        }

        const Steps = struct {
            write_gitignore: bool = true,
            write_package_json: bool = true,
            write_tsconfig: bool = true,
            write_readme: bool = true,
        };

        var steps = Steps{};

        steps.write_gitignore = !existsZ(".gitignore");

        steps.write_readme = !existsZ("README.md") and !existsZ("README") and !existsZ("README.txt") and !existsZ("README.mdx");

        steps.write_tsconfig = brk: {
            if (existsZ("tsconfig.json")) {
                break :brk false;
            }

            if (existsZ("jsconfig.json")) {
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
                try dev_dependencies.data.e_object.putString(alloc, "@types/bun", "latest");
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
            const package_json_writer = JSPrinter.NewFileWriter(package_json_file.?);

            const written = JSPrinter.printJSON(
                @TypeOf(package_json_writer),
                package_json_writer,
                js_ast.Expr{ .data = .{ .e_object = fields.object }, .loc = logger.Loc.Empty },
                &logger.Source.initEmptyFile("package.json"),
                .{},
            ) catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                package_json_file = null;
                break :write_package_json;
            };

            std.posix.ftruncate(package_json_file.?.handle, written + 1) catch {};
            package_json_file.?.close();
        }

        if (package_json_file != null) {
            Output.prettyln("<r><green>Done!<r> A package.json file was saved in the current directory.", .{});
        }

        if (fields.entry_point.len > 0 and !exists(fields.entry_point)) {
            const cwd = std.fs.cwd();
            if (std.fs.path.dirname(fields.entry_point)) |dirname| {
                if (!strings.eqlComptime(dirname, ".")) {
                    cwd.makePath(dirname) catch {};
                }
            }

            Assets.createNew(fields.entry_point, "console.log(\"Hello via Bun!\");") catch {
                // suppress
            };
        }

        if (steps.write_gitignore) {
            Assets.create(".gitignore", .{}) catch {
                // suppressed
            };
        }

        if (steps.write_tsconfig) {
            brk: {
                const extname = std.fs.path.extension(fields.entry_point);
                const loader = options.defaultLoaders.get(extname) orelse options.Loader.ts;
                const filename = if (loader.isTypeScript())
                    "tsconfig.json"
                else
                    "jsconfig.json";
                Assets.createFull("tsconfig.json", filename, " (for editor autocomplete)", false, .{}) catch break :brk;
            }
        }

        if (steps.write_readme) {
            Assets.create("README.md", .{
                .name = fields.name,
                .bunVersion = Environment.version_string,
                .entryPoint = fields.entry_point,
            }) catch {
                // suppressed
            };
        }

        if (fields.entry_point.len > 0) {
            Output.prettyln("\nTo get started, run:", .{});
            if (strings.containsAny(
                " \"'",
                fields.entry_point,
            )) {
                Output.prettyln("  <r><cyan>bun run {any}<r>", .{bun.fmt.formatJSONStringLatin1(fields.entry_point)});
            } else {
                Output.prettyln("  <r><cyan>bun run {s}<r>", .{fields.entry_point});
            }
        }

        Output.flush();

        if (existsZ("package.json")) {
            var process = std.process.Child.init(
                &.{
                    try bun.selfExePath(),
                    "install",
                },
                alloc,
            );
            process.stderr_behavior = .Ignore;
            process.stdin_behavior = .Ignore;
            process.stdout_behavior = .Ignore;
            _ = try process.spawnAndWait();
        }
    }
};

const SourceFileProjectGenerator = @import("../create/SourceFileProjectGenerator.zig");
