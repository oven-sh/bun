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
const SourceFileProjectGenerator = @import("../create/SourceFileProjectGenerator.zig");

pub const InitCommand = struct {
    pub fn prompt(
        alloc: std.mem.Allocator,
        comptime label: string,
        default: []const u8,
    ) ![:0]const u8 {
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

        var input: std.ArrayList(u8) = .init(alloc);
        try bun.Output.buffered_stdin.reader().readUntilDelimiterArrayList(&input, '\n', 1024);

        if (strings.endsWithChar(input.items, '\r')) {
            _ = input.pop();
        }
        if (input.items.len > 0) {
            try input.append(0);
            return input.items[0 .. input.items.len - 1 :0];
        } else {
            input.clearRetainingCapacity();
            try input.appendSlice(default);
            try input.append(0);
            return input.items[0 .. input.items.len - 1 :0];
        }
    }

    extern fn Bun__ttySetMode(fd: i32, mode: i32) i32;

    fn processRadioButton(
        label: string,
        comptime choices: []const []const u8,
        comptime choices_uncolored: []const []const u8,
        default_value: usize,
        comptime colors: bool,
    ) !usize {
        // Print the question prompt
        if (colors) {
            Output.prettyln("<r><cyan>?<r> {s}<d> - Press return to submit.<r>", .{label});
        } else {
            Output.prettyln("<r><cyan>?<r> {s}<d> - Press return to submit.<r>", .{label});
        }

        var selected = default_value;
        var initial_draw = true;
        var reprint_menu = true;
        errdefer reprint_menu = false;
        defer {
            if (!initial_draw) {
                // Move cursor up to prompt line
                Output.up(choices.len + 1);
            }

            // Clear from cursor to end of screen
            Output.clearToEnd();

            if (reprint_menu) {
                // Print final selection
                if (colors) {
                    Output.prettyln("<r><cyan>?<r> {s} <d>› {s}<r>", .{ label, choices[selected] });
                } else {
                    Output.prettyln("<r><cyan>?<r> {s} <d>> {s}<r>", .{ label, choices_uncolored[selected] });
                }
            }
        }

        while (true) {
            if (!initial_draw) {
                // Move cursor up by number of choices
                Output.up(choices.len);
            }
            initial_draw = false;

            // Clear from cursor to end of screen
            Output.clearToEnd();

            // Print options vertically
            inline for (choices, choices_uncolored, 0..) |option_colored, option_uncolored, i| {
                const option = if (colors) option_colored else option_uncolored;
                if (i == selected) {
                    if (colors) {
                        Output.pretty("<r><cyan>❯<r>   ", .{});
                    } else {
                        Output.pretty("<r><cyan>><r>   ", .{});
                    }
                    if (colors) {
                        Output.print("\x1B[4m" ++ option ++ "\x1B[24m\n", .{});
                    } else {
                        Output.print("    " ++ option ++ "\n", .{});
                    }
                } else {
                    Output.print("    " ++ option ++ "\n", .{});
                }
            }

            Output.flush();

            // Read a single character
            const byte = std.io.getStdIn().reader().readByte() catch return selected;

            switch (byte) {
                '\n', '\r' => {
                    return selected;
                },
                3, 4 => return error.EndOfStream, // ctrl+c, ctrl+d
                '1'...'9' => {
                    const choice = byte - '1';
                    if (choice < choices.len) {
                        return choice;
                    }
                },
                'j' => {
                    if (selected == choices.len - 1) {
                        selected = 0;
                    } else {
                        selected += 1;
                    }
                },
                'k' => {
                    if (selected == 0) {
                        selected = choices.len - 1;
                    } else {
                        selected -= 1;
                    }
                },
                27 => { // ESC sequence
                    // Return immediately on plain ESC
                    const next = std.io.getStdIn().reader().readByte() catch return error.EndOfStream;
                    if (next != '[') return error.EndOfStream;

                    // Read arrow key
                    const arrow = std.io.getStdIn().reader().readByte() catch return error.EndOfStream;
                    switch (arrow) {
                        'A' => { // Up arrow
                            if (selected == 0) {
                                selected = choices.len - 1;
                            } else {
                                selected -= 1;
                            }
                        },
                        'B' => { // Down arrow
                            if (selected == choices.len - 1) {
                                selected = 0;
                            } else {
                                selected += 1;
                            }
                        },
                        else => {},
                    }
                },
                else => {},
            }
        }
    }

    pub fn radio(
        label: string,
        comptime choices: []const []const u8,
        comptime choices_uncolored: []const []const u8,
        default_value: usize,
        comptime colors: bool,
    ) !usize {

        // Set raw mode to read single characters without echo
        const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
            bun.win32.unsetStdioModeFlags(0, bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT) catch null;

        if (Environment.isPosix)
            _ = Bun__ttySetMode(0, 1);

        defer {
            if (comptime Environment.isWindows) {
                if (original_mode) |mode| {
                    _ = bun.windows.SetConsoleMode(
                        bun.win32.STDIN_FD.cast(),
                        mode,
                    );
                }
            }
            if (Environment.isPosix) {
                _ = Bun__ttySetMode(0, 0);
            }
        }

        const selection = processRadioButton(label, choices, choices_uncolored, default_value, colors) catch |err| {
            if (err == error.EndOfStream) {
                Output.flush();
                // Add an "x" cancelled
                Output.prettyln("\n<r><red>x<r> Cancelled", .{});
                Global.exit(0);
            }

            return err;
        };

        Output.flush();

        return selection;
    }

    const Assets = struct {
        // "known" assets
        const @".gitignore" = @embedFile("init/gitignore.default");
        const @"tsconfig.json" = @embedFile("init/tsconfig.default.json");
        const @"README.md" = @embedFile("init/README.default.md");
        const @"README2.md" = @embedFile("init/README2.default.md");

        /// Create a new asset file, overriding anything that already exists. Known
        /// assets will have their contents pre-populated; otherwise the file will be empty.
        fn create(comptime asset_name: []const u8, args: anytype) !void {
            const is_template = comptime (@TypeOf(args) != @TypeOf(null)) and @typeInfo(@TypeOf(args)).@"struct".fields.len > 0;
            return createFull(asset_name, asset_name, "", is_template, args);
        }

        pub fn createWithContents(comptime asset_name: []const u8, comptime contents: []const u8, args: anytype) !void {
            const is_template = comptime (@TypeOf(args) != @TypeOf(null)) and @typeInfo(@TypeOf(args)).@"struct".fields.len > 0;
            return createFullWithContents(asset_name, contents, "", is_template, args);
        }

        fn createNew(filename: [:0]const u8, contents: []const u8) !void {
            const file = try bun.sys.File.makeOpen(filename, bun.O.CREAT | bun.O.EXCL | bun.O.WRONLY, 0o666).unwrap();
            defer file.close();

            try file.writeAll(contents).unwrap();

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
                Output.prettyln(" + <r><d>{s}{s}<r>", .{ filename, message_suffix });
                Output.flush();
            } else {
                @compileError("missing asset: " ++ asset_name);
            }
        }

        fn createFullWithContents(
            /// name of asset file to create
            filename: []const u8,
            comptime contents: []const u8,
            /// optionally add a suffix to the end of the `+ filename` message. Must have a leading space.
            comptime message_suffix: []const u8,
            /// Treat the asset as a format string, using `args` to populate it. Only applies to known assets.
            comptime is_template: bool,
            /// Format arguments
            args: anytype,
        ) !void {
            var file = try std.fs.cwd().createFile(filename, .{ .truncate = true });
            defer file.close();

            if (comptime is_template) {
                try file.writer().print(contents, args);
            } else {
                try file.writeAll(contents);
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
        entry_point: stringZ = "",
        private: bool = true,
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
                    if (try name.asStringZ(alloc)) |str| {
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
                        fields.entry_point = path;
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

        var template: Template = .blank;

        if (!auto_yes) {
            if (!did_load_package_json) {
                Output.pretty("\n", .{});

                const choices = &[_][]const u8{
                    "TypeScript",
                    "React",
                    "TypeScript Library",
                };
                const choices_colored = &[_][]const u8{
                    comptime Output.prettyFmt("<blue>TypeScript<r> <d>(blank)<r>", true),
                    comptime Output.prettyFmt("<cyan>React<r>", true),
                    comptime Output.prettyFmt("<blue>TypeScript<r> <d>(library)<r>", true),
                };

                const selected = switch (Output.enable_ansi_colors_stdout) {
                    inline else => |colors| try radio(
                        "Select a project",
                        choices_colored,
                        choices,
                        0,
                        colors,
                    ),
                };

                switch (selected) {
                    2 => {
                        template = .typescript_library;
                        fields.name = prompt(
                            alloc,
                            "<r><cyan>package name<r> ",
                            fields.name,
                        ) catch |err| {
                            if (err == error.EndOfStream) return;
                            return err;
                        };
                        fields.name = try normalizePackageName(alloc, fields.name);
                        fields.entry_point = prompt(
                            alloc,
                            "<r><cyan>entry point<r> ",
                            fields.entry_point,
                        ) catch |err| {
                            if (err == error.EndOfStream) return;
                            return err;
                        };
                        fields.private = false;
                    },
                    1 => {
                        const react_choices = &[_][]const u8{
                            "Default (blank)",
                            "Tailwind CSS",
                            "Shadcn UI + Tailwind CSS",
                        };
                        const react_choices_colored = &[_][]const u8{
                            "Default (blank)",
                            // <magenta>Tailwind CSS
                            "\x1B[36mTailwind CSS\x1B[39m",
                            // <green>Shadcn + Tailwind CSS
                            "\x1B[32mshadcn + Tailwind CSS\x1B[39m\x1B[0m",
                        };

                        const react_selected = switch (Output.enable_ansi_colors_stdout) {
                            inline else => |colors| try radio(
                                "Select a React template",
                                react_choices_colored,
                                react_choices,
                                0,
                                colors,
                            ),
                        };

                        switch (react_selected) {
                            0 => {
                                template = .react_blank;
                            },
                            1 => {
                                template = .react_tailwind;
                            },
                            2 => {
                                template = .react_tailwind_shadcn;
                            },
                            else => unreachable,
                        }
                    },
                    0 => {
                        template = .blank;
                    },
                    else => unreachable,
                }

                try Output.writer().writeAll("\n");
                Output.flush();
            } else {
                Output.errGeneric("A package.json already exists here", .{});
                Global.crash();
            }
        }

        switch (template) {
            inline .react_blank, .react_tailwind, .react_tailwind_shadcn => |t| {
                try t.@"write files and run `bun dev`"(alloc);
                return;
            },
            else => {},
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

            if (fields.private) {
                try fields.object.put(alloc, "private", js_ast.Expr.init(js_ast.E.Boolean, .{ .value = true }, logger.Loc.Empty));
            }
        }
        {
            const all_dependencies = template.dependencies();
            const dependencies = all_dependencies.dependencies;
            const dev_dependencies = all_dependencies.devDependencies;
            var needed_dependencies = bun.bit_set.IntegerBitSet(64).initEmpty();
            var needed_dev_dependencies = bun.bit_set.IntegerBitSet(64).initEmpty();
            needed_dependencies.setRangeValue(.{ .start = 0, .end = dependencies.len }, true);
            needed_dev_dependencies.setRangeValue(.{ .start = 0, .end = dev_dependencies.len }, true);

            const needs_dependencies = brk: {
                if (fields.object.get("dependencies")) |deps| {
                    for (dependencies, 0..) |*dep, i| {
                        if (deps.get(dep.name) != null) {
                            needed_dependencies.unset(i);
                        }
                    }
                }

                break :brk needed_dependencies.count() > 0;
            };

            const needs_dev_dependencies = brk: {
                if (fields.object.get("devDependencies")) |deps| {
                    for (dev_dependencies, 0..) |*dep, i| {
                        if (deps.get(dep.name) != null) {
                            needed_dev_dependencies.unset(i);
                        }
                    }
                }

                break :brk needed_dev_dependencies.count() > 0;
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

            if (needs_dependencies) {
                var dependencies_object = fields.object.get("dependencies") orelse js_ast.Expr.init(js_ast.E.Object, js_ast.E.Object{}, logger.Loc.Empty);
                var iter = needed_dependencies.iterator(.{ .kind = .set });
                while (iter.next()) |index| {
                    const dep = dependencies[index];
                    try dependencies_object.data.e_object.putString(alloc, dep.name, dep.version);
                }
                try fields.object.put(alloc, "dependencies", dependencies_object);
            }

            if (needs_dev_dependencies) {
                var object = fields.object.get("devDependencies") orelse js_ast.Expr.init(js_ast.E.Object, js_ast.E.Object{}, logger.Loc.Empty);
                var iter = needed_dev_dependencies.iterator(.{ .kind = .set });
                while (iter.next()) |index| {
                    const dep = dev_dependencies[index];
                    try object.data.e_object.putString(alloc, dep.name, dep.version);
                }
                try fields.object.put(alloc, "devDependencies", object);
            }

            if (needs_typescript_dependency) {
                var peer_dependencies = fields.object.get("peerDependencies") orelse js_ast.Expr.init(js_ast.E.Object, js_ast.E.Object{}, logger.Loc.Empty);
                try peer_dependencies.data.e_object.putString(alloc, "typescript", "^5");
                try fields.object.put(alloc, "peerDependencies", peer_dependencies);
            }
        }

        if (template.isReact()) {
            try template.writeToPackageJson(alloc, &fields);
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

        if (steps.write_gitignore) {
            Assets.create(".gitignore", .{}) catch {
                // suppressed
            };
        }

        switch (template) {
            .blank, .typescript_library => {
                if (package_json_file != null) {
                    Output.prettyln(" + <r><d>package.json<r>", .{});
                    Output.flush();
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
                    Output.pretty("\nTo get started, run:\n\n\t", .{});
                    if (strings.containsAny(
                        " \"'",
                        fields.entry_point,
                    )) {
                        Output.prettyln("<cyan>bun run {any}<r>", .{bun.fmt.formatJSONStringLatin1(fields.entry_point)});
                    } else {
                        Output.prettyln("<cyan>bun run {s}<r>", .{fields.entry_point});
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
            },
            else => {},
        }
    }
};

const DependencyNeeded = struct {
    name: []const u8,
    version: []const u8,
};

const DependencyGroup = struct {
    dependencies: []const DependencyNeeded,
    devDependencies: []const DependencyNeeded,

    pub const blank = DependencyGroup{
        .dependencies = &[_]DependencyNeeded{},
        .devDependencies = &[_]DependencyNeeded{
            .{ .name = "@types/bun", .version = "latest" },
        },
    };

    pub const react = DependencyGroup{
        .dependencies = &[_]DependencyNeeded{
            .{ .name = "react", .version = "^19" },
            .{ .name = "react-dom", .version = "^19" },
        },
        .devDependencies = &[_]DependencyNeeded{
            .{ .name = "@types/react", .version = "^19" },
            .{ .name = "@types/react-dom", .version = "^19" },
        } ++ blank.devDependencies[0..1].*,
    };

    pub const tailwind = DependencyGroup{
        .dependencies = &[_]DependencyNeeded{
            .{ .name = "tailwindcss", .version = "^4" },
        } ++ react.dependencies[0..react.dependencies.len].*,
        .devDependencies = &[_]DependencyNeeded{
            .{ .name = "bun-plugin-tailwind", .version = "latest" },
        } ++ react.devDependencies[0..react.devDependencies.len].*,
    };

    pub const shadcn = DependencyGroup{
        .dependencies = &[_]DependencyNeeded{
            .{ .name = "tailwindcss-animate", .version = "latest" },
            .{ .name = "class-variance-authority", .version = "latest" },
            .{ .name = "clsx", .version = "latest" },
            .{ .name = "tailwind-merge", .version = "latest" },
        } ++ tailwind.dependencies[0..tailwind.dependencies.len].*,
        .devDependencies = &[_]DependencyNeeded{} ++ tailwind.devDependencies[0..tailwind.devDependencies.len].*,
    };
};

const Template = enum {
    blank,
    react_blank,
    react_tailwind,
    react_tailwind_shadcn,
    typescript_library,
    pub fn shouldUseSourceFileProjectGenerator(this: Template) bool {
        return switch (this) {
            .blank, .typescript_library => false,
            else => true,
        };
    }
    pub fn isReact(this: Template) bool {
        return switch (this) {
            .react_blank, .react_tailwind, .react_tailwind_shadcn => true,
            else => false,
        };
    }
    pub fn writeToPackageJson(this: Template, alloc: std.mem.Allocator, fields: *InitCommand.PackageJSONFields) !void {
        const Rope = js_ast.E.Object.Rope;
        fields.name = this.name();
        const key = try alloc.create(Rope);
        key.* = Rope{
            .head = js_ast.Expr.init(js_ast.E.String, js_ast.E.String{ .data = "scripts" }, logger.Loc.Empty),
            .next = null,
        };
        var scripts_json = try fields.object.getOrPutObject(key, alloc);
        const the_scripts = this.scripts();
        var i: usize = 0;
        while (i < the_scripts.len) : (i += 2) {
            const script_name = the_scripts[i];
            const script_command = the_scripts[i + 1];

            try scripts_json.data.e_object.putString(alloc, script_name, script_command);
        }
    }
    pub fn dependencies(this: Template) DependencyGroup {
        return switch (this) {
            .blank => DependencyGroup.blank,
            .react_blank => DependencyGroup.react,
            .react_tailwind => DependencyGroup.tailwind,
            .react_tailwind_shadcn => DependencyGroup.shadcn,
            .typescript_library => DependencyGroup.blank,
        };
    }
    pub fn name(this: Template) []const u8 {
        return switch (this) {
            .blank => "bun-blank-template",
            .typescript_library => "bun-typescript-library-template",
            .react_blank => "bun-react-template",
            .react_tailwind => "bun-react-tailwind-template",
            .react_tailwind_shadcn => "bun-react-tailwind-shadcn-template",
        };
    }
    pub fn scripts(this: Template) []const []const u8 {
        const s: []const []const u8 = switch (this) {
            .blank, .typescript_library => &.{},
            .react_tailwind, .react_tailwind_shadcn => &.{
                "dev",   "bun './**/*.html'",
                "build", "bun 'REPLACE_ME_WITH_YOUR_APP_FILE_NAME.build.ts'",
            },
            .react_blank => &.{
                "dev",    "bun ./src/",
                "static", "bun build ./src/index.html --outdir=dist --sourcemap=linked --target=browser --minify --define:process.env.NODE_ENV='\"production\"' --env='BUN_PUBLIC_*'",
            },
        };

        return s;
    }

    const ReactBlank = struct {
        const files: []const struct { [:0]const u8, [:0]const u8 } = &.{
            .{ "bunfig.toml", @embedFile("../create/projects/react-app/bunfig.toml") },
            .{ "package.json", @embedFile("../create/projects/react-app/package.json") },
            .{ "tsconfig.json", @embedFile("../create/projects/react-app/tsconfig.json") },
            .{ "README.md", InitCommand.Assets.@"README2.md" },
            .{ ".gitignore", InitCommand.Assets.@".gitignore" },
            .{ "src/index.tsx", @embedFile("../create/projects/react-app/src/index.tsx") },
            .{ "src/App.tsx", @embedFile("../create/projects/react-app/src/App.tsx") },
            .{ "src/index.html", @embedFile("../create/projects/react-app/src/index.html") },
            .{ "src/index.css", @embedFile("../create/projects/react-app/src/index.css") },
            .{ "src/APITester.tsx", @embedFile("../create/projects/react-app/src/APITester.tsx") },
            .{ "src/react.svg", @embedFile("../create/projects/react-app/src/react.svg") },
            .{ "src/frontend.tsx", @embedFile("../create/projects/react-app/src/frontend.tsx") },
            .{ "src/logo.svg", @embedFile("../create/projects/react-app/src/logo.svg") },
        };
    };

    const ReactTailwind = struct {
        const files: []const struct { [:0]const u8, [:0]const u8 } = &.{
            .{ "bunfig.toml", @embedFile("../create/projects/react-tailwind/bunfig.toml") },
            .{ "package.json", @embedFile("../create/projects/react-tailwind/package.json") },
            .{ "tsconfig.json", @embedFile("../create/projects/react-tailwind/tsconfig.json") },
            .{ "README.md", InitCommand.Assets.@"README2.md" },
            .{ ".gitignore", InitCommand.Assets.@".gitignore" },
            .{ "src/index.tsx", @embedFile("../create/projects/react-tailwind/src/index.tsx") },
            .{ "src/App.tsx", @embedFile("../create/projects/react-tailwind/src/App.tsx") },
            .{ "src/index.html", @embedFile("../create/projects/react-tailwind/src/index.html") },
            .{ "src/index.css", @embedFile("../create/projects/react-tailwind/src/index.css") },
            .{ "src/APITester.tsx", @embedFile("../create/projects/react-tailwind/src/APITester.tsx") },
            .{ "src/react.svg", @embedFile("../create/projects/react-tailwind/src/react.svg") },
            .{ "src/frontend.tsx", @embedFile("../create/projects/react-tailwind/src/frontend.tsx") },
            .{ "src/logo.svg", @embedFile("../create/projects/react-tailwind/src/logo.svg") },
        };
    };

    const ReactShadcn = struct {
        const files: []const struct { [:0]const u8, [:0]const u8 } = &.{
            .{ "bunfig.toml", @embedFile("../create/projects/react-shadcn/bunfig.toml") },
            .{ "styles/globals.css", @embedFile("../create/projects/react-shadcn/styles/globals.css") },
            .{ "package.json", @embedFile("../create/projects/react-shadcn/package.json") },
            .{ "components.json", @embedFile("../create/projects/react-shadcn/components.json") },
            .{ "tsconfig.json", @embedFile("../create/projects/react-shadcn/tsconfig.json") },
            .{ "README.md", InitCommand.Assets.@"README2.md" },
            .{ ".gitignore", InitCommand.Assets.@".gitignore" },
            .{ "src/index.tsx", @embedFile("../create/projects/react-shadcn/src/index.tsx") },
            .{ "src/App.tsx", @embedFile("../create/projects/react-shadcn/src/App.tsx") },
            .{ "src/index.html", @embedFile("../create/projects/react-shadcn/src/index.html") },
            .{ "src/types.d.ts", @embedFile("../create/projects/react-shadcn/src/types.d.ts") },
            .{ "src/index.css", @embedFile("../create/projects/react-shadcn/src/index.css") },
            .{ "src/components/ui/card.tsx", @embedFile("../create/projects/react-shadcn/src/components/ui/card.tsx") },
            .{ "src/components/ui/label.tsx", @embedFile("../create/projects/react-shadcn/src/components/ui/label.tsx") },
            .{ "src/components/ui/button.tsx", @embedFile("../create/projects/react-shadcn/src/components/ui/button.tsx") },
            .{ "src/components/ui/select.tsx", @embedFile("../create/projects/react-shadcn/src/components/ui/select.tsx") },
            .{ "src/components/ui/input.tsx", @embedFile("../create/projects/react-shadcn/src/components/ui/input.tsx") },
            .{ "src/components/ui/form.tsx", @embedFile("../create/projects/react-shadcn/src/components/ui/form.tsx") },
            .{ "src/APITester.tsx", @embedFile("../create/projects/react-shadcn/src/APITester.tsx") },
            .{ "src/lib/utils.ts", @embedFile("../create/projects/react-shadcn/src/lib/utils.ts") },
            .{ "src/react.svg", @embedFile("../create/projects/react-shadcn/src/react.svg") },
            .{ "src/frontend.tsx", @embedFile("../create/projects/react-shadcn/src/frontend.tsx") },
            .{ "src/logo.svg", @embedFile("../create/projects/react-shadcn/src/logo.svg") },
        };
    };

    pub fn files(this: Template) []const struct { [:0]const u8, []const u8 } {
        return switch (this) {
            .react_blank => ReactBlank.files,
            .react_tailwind => ReactTailwind.files,
            .react_tailwind_shadcn => ReactTailwind.files,
            else => &.{.{ &.{}, &.{} }},
        };
    }

    pub fn @"write files and run `bun dev`"(comptime this: Template, allocator: std.mem.Allocator) !void {
        inline for (comptime this.files()) |file| {
            const path, const contents = file;

            if (comptime strings.eqlComptime(path, "README.md")) {
                InitCommand.Assets.createWithContents("README.md", contents, .{
                    .name = this.name(),
                    .bunVersion = Environment.version_string,
                }) catch |err| {
                    if (err == error.EEXISTS) {
                        Output.errGeneric("'{s}' already exists", .{path});
                    } else {
                        Output.err(err, "failed to create file: '{s}'", .{path});
                    }
                    Global.crash();
                };
            } else {
                InitCommand.Assets.createNew(path, contents) catch |err| {
                    if (err == error.EEXISTS) {
                        Output.errGeneric("'{s}' already exists", .{path});
                    } else {
                        Output.err(err, "failed to create file: '{s}'", .{path});
                    }
                    Global.crash();
                };
            }
        }

        Output.pretty("\n", .{});
        Output.flush();

        var install = std.process.Child.init(
            &.{
                try bun.selfExePath(),
                "install",
            },
            allocator,
        );
        install.stderr_behavior = .Inherit;
        install.stdin_behavior = .Ignore;
        install.stdout_behavior = .Inherit;

        _ = try install.spawnAndWait();

        Output.prettyln("\nTo get started, run:\n\n\t<cyan>bun dev<r>", .{});
        Output.prettyln("\nTo run for production:\n\n\t<cyan>bun start<r>\n\n", .{});

        Output.flush();

        var process = std.process.Child.init(
            &.{
                try bun.selfExePath(),
                "dev",
            },
            allocator,
        );
        process.stderr_behavior = .Inherit;
        process.stdin_behavior = .Inherit;
        process.stdout_behavior = .Inherit;

        _ = try process.spawnAndWait();
    }
};
