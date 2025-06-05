const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;

const std = @import("std");
const CLI = @import("../cli.zig");
const Fs = @import("../fs.zig");
const JSON = bun.JSON;
const js_ast = bun.JSAst;
const options = @import("../options.zig");
const initializeStore = @import("./create_command.zig").initializeStore;
const logger = bun.logger;
const JSPrinter = bun.js_printer;
const exists = bun.sys.exists;
const existsZ = bun.sys.existsZ;

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
            bun.windows.updateStdioModeFlags(.std_in, .{ .unset = bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT }) catch null;

        defer if (comptime Environment.isWindows) {
            if (original_mode) |mode| {
                _ = bun.c.SetConsoleMode(bun.FD.stdin().native(), mode);
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

    fn processRadioButton(label: string, comptime Choices: type) !Choices {
        const colors = Output.enable_ansi_colors;
        const choices = switch (colors) {
            inline else => |colors_comptime| comptime choices: {
                const choices_fields = bun.meta.EnumFields(Choices);
                if (choices_fields.len == 0) {
                    @compileError("Choices must be an enum type with at least one field");
                }
                var expected_value = 0;
                var choices: [choices_fields.len][]const u8 = undefined;
                for (choices_fields, 0..) |field, i| {
                    if (field.value != expected_value) {
                        @compileError("Choices must be an enum type with consecutive values starting from 0");
                    }
                    const e: Choices = @enumFromInt(field.value);
                    choices[i] = Output.prettyFmt(e.fmt(), colors_comptime);
                    expected_value += 1;
                }
                break :choices choices;
            },
        };

        // Print the question prompt
        Output.prettyln("<r><cyan>?<r> {s}<d> - Press return to submit.<r>", .{label});

        if (colors) Output.print("\x1b[?25l", .{}); // hide cursor
        defer if (colors) Output.print("\x1b[?25h", .{}); // show cursor

        var selected: Choices = .default;
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
                Output.prettyln("<r><green>✓<r> {s}<d>:<r> {s}<r>", .{ label, choices[@intFromEnum(selected)] });
            }
        }

        while (true) {
            if (!initial_draw) {
                // Move cursor up by number of choices
                Output.up(choices.len);
            }
            initial_draw = false;

            // Print options vertically
            inline for (choices, 0..) |option, i| {
                if (i == @intFromEnum(selected)) {
                    if (colors) {
                        Output.pretty("<r><cyan>❯<r>   ", .{});
                    } else {
                        Output.pretty("<r><cyan>><r>   ", .{});
                    }
                    if (colors) {
                        Output.print("\x1B[4m{s}\x1B[24m\x1B[0K\n", .{option});
                    } else {
                        Output.print("    {s}\x1B[0K\n", .{option});
                    }
                } else {
                    Output.print("    {s}\x1B[0K\n", .{option});
                }
            }
            Output.clearToEnd();

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
                        return @enumFromInt(choice);
                    }
                },
                'j' => {
                    if (@intFromEnum(selected) == choices.len - 1) {
                        selected = @enumFromInt(0);
                    } else {
                        selected = @enumFromInt(@intFromEnum(selected) + 1);
                    }
                },
                'k' => {
                    if (@intFromEnum(selected) == 0) {
                        selected = @enumFromInt(choices.len - 1);
                    } else {
                        selected = @enumFromInt(@intFromEnum(selected) - 1);
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
                            if (@intFromEnum(selected) == 0) {
                                selected = @enumFromInt(choices.len - 1);
                            } else {
                                selected = @enumFromInt(@intFromEnum(selected) - 1);
                            }
                        },
                        'B' => { // Down arrow
                            if (@intFromEnum(selected) == choices.len - 1) {
                                selected = @enumFromInt(0);
                            } else {
                                selected = @enumFromInt(@intFromEnum(selected) + 1);
                            }
                        },
                        else => {},
                    }
                },
                else => {},
            }
        }
    }

    /// `Choices` must be an enum type with the `fmt` method.
    pub fn radio(label: string, comptime Choices: type) !Choices {

        // Set raw mode to read single characters without echo
        const original_mode: if (Environment.isWindows) ?bun.windows.DWORD else void = if (comptime Environment.isWindows)
            bun.windows.updateStdioModeFlags(.std_in, .{
                // virtual terminal input enables arrow keys, processed input lets ctrl+c kill the program
                .set = bun.windows.ENABLE_VIRTUAL_TERMINAL_INPUT | bun.windows.ENABLE_PROCESSED_INPUT,
                // disabling line input sends keys immediately, disabling echo input makes sure it doesn't print to the terminal
                .unset = bun.windows.ENABLE_LINE_INPUT | bun.windows.ENABLE_ECHO_INPUT,
            }) catch null;

        if (Environment.isPosix)
            _ = Bun__ttySetMode(0, 1);

        defer {
            if (comptime Environment.isWindows) {
                if (original_mode) |mode| {
                    _ = bun.c.SetConsoleMode(
                        bun.FD.stdin().native(),
                        mode,
                    );
                }
            }
            if (Environment.isPosix) {
                _ = Bun__ttySetMode(0, 0);
            }
        }

        const selection = processRadioButton(label, Choices) catch |err| {
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

    pub fn exec(alloc: std.mem.Allocator, init_args: [][:0]const u8) !void {
        // --minimal is a special preset to create only empty package.json + tsconfig.json
        var minimal = false;
        var auto_yes = false;
        var parse_flags = true;
        var initialize_in_folder: ?[]const u8 = null;

        var template: Template = .blank;
        var prev_flag_was_react = false;
        for (init_args) |arg_| {
            const arg = bun.span(arg_);
            if (parse_flags and arg.len > 0 and arg[0] == '-') {
                if (strings.eqlComptime(arg, "--help") or strings.eqlComptime(arg, "-h")) {
                    CLI.Command.Tag.printHelp(.InitCommand, true);
                    Global.exit(0);
                } else if (strings.eqlComptime(arg, "-m") or strings.eqlComptime(arg, "--minimal")) {
                    minimal = true;
                    prev_flag_was_react = false;
                } else if (strings.eqlComptime(arg, "-y") or strings.eqlComptime(arg, "--yes")) {
                    auto_yes = true;
                    prev_flag_was_react = false;
                } else if (strings.eqlComptime(arg, "--")) {
                    parse_flags = false;
                    prev_flag_was_react = false;
                } else if (strings.eqlComptime(arg, "--react") or strings.eqlComptime(arg, "-r")) {
                    template = .react_blank;
                    prev_flag_was_react = true;
                    auto_yes = true;
                } else if ((template == .react_blank and prev_flag_was_react and strings.eqlComptime(arg, "tailwind") or strings.eqlComptime(arg, "--react=tailwind")) or strings.eqlComptime(arg, "r=tailwind")) {
                    template = .react_tailwind;
                    prev_flag_was_react = false;
                    auto_yes = true;
                } else if ((template == .react_blank and prev_flag_was_react and strings.eqlComptime(arg, "shadcn") or strings.eqlComptime(arg, "--react=shadcn")) or strings.eqlComptime(arg, "r=shadcn")) {
                    template = .react_tailwind_shadcn;
                    prev_flag_was_react = false;
                    auto_yes = true;
                } else {
                    prev_flag_was_react = false;
                }
            } else {
                if (initialize_in_folder == null) {
                    initialize_in_folder = arg;
                } else {
                    // invalid positional; ignore
                }
            }
        }

        if (initialize_in_folder) |ifdir| {
            std.fs.cwd().makePath(ifdir) catch |err| {
                Output.prettyErrorln("Failed to create directory {s}: {s}", .{ ifdir, @errorName(err) });
                Global.exit(1);
            };
            bun.sys.chdir("", ifdir).unwrap() catch |err| {
                Output.prettyErrorln("Failed to change directory to {s}: {s}", .{ ifdir, @errorName(err) });
                Global.exit(1);
            };
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

        if (fields.entry_point.len == 0 and !minimal) infer: {
            fields.entry_point = "index.ts";

            // Prefer a file named index
            const paths_to_try = [_][:0]const u8{
                "index.mts",
                "index.tsx",
                "index.ts",
                "index.jsx",
                "index.mjs",
                "index.js",
                "src/index.mts",
                "src/index.tsx",
                "src/index.ts",
                "src/index.jsx",
                "src/index.mjs",
                "src/index.js",
            };
            for (paths_to_try) |path| {
                if (existsZ(path)) {
                    fields.entry_point = path;
                    break :infer;
                }
            }

            // Find any source file
            var dir = std.fs.cwd().openDir(".", .{ .iterate = true }) catch break :infer;
            defer dir.close();
            var it = bun.DirIterator.iterate(dir, .u8);
            while (try it.next().unwrap()) |file| {
                if (file.kind != .file) continue;
                const loader = bun.options.Loader.fromString(std.fs.path.extension(file.name.slice())) orelse
                    continue;
                if (loader.isJavaScriptLike()) {
                    // If a non-index file is found, it might not be the "main"
                    // file, and a generated package.json shouldn't get this
                    // added noise.
                    fields.entry_point = "";
                    break;
                }
            }
        }

        if (!did_load_package_json) {
            fields.object = js_ast.Expr.init(
                js_ast.E.Object,
                .{},
                logger.Loc.Empty,
            ).data.e_object;
        }

        if (!auto_yes) {
            if (!did_load_package_json) {
                Output.pretty("\n", .{});

                const selected = try radio("Select a project template", enum {
                    blank,
                    react,
                    library,

                    pub const default: @This() = .blank;

                    pub fn fmt(self: @This()) []const u8 {
                        return switch (self) {
                            .blank => "<yellow>Blank<r>",
                            .react => "<cyan>React<r>",
                            .library => "<blue>Library<r>",
                        };
                    }
                });
                switch (selected) {
                    .library => {
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
                    .react => {
                        const react_selected = try radio("Select a React template", enum {
                            default,
                            tailwind,
                            shadcn_tailwind,

                            pub fn fmt(self: @This()) []const u8 {
                                return switch (self) {
                                    .default => "<blue>Default (blank)<r>",
                                    .tailwind => "<magenta>TailwindCSS<r>",
                                    .shadcn_tailwind => "<green>Shadcn + TailwindCSS<r>",
                                };
                            }
                        });

                        template = switch (react_selected) {
                            .default => .react_blank,
                            .tailwind => .react_tailwind,
                            .shadcn_tailwind => .react_tailwind_shadcn,
                        };
                    },
                    .blank => template = .blank,
                }

                try Output.writer().writeAll("\n");
                Output.flush();
            } else {
                Output.note("package.json already exists, configuring existing project", .{});
                template = .blank;
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
            write_gitignore: bool,
            write_package_json: bool,
            write_tsconfig: bool,
            write_readme: bool,
        };

        var steps = Steps{
            .write_package_json = true,
            .write_tsconfig = true,
            .write_gitignore = !minimal,
            .write_readme = !minimal,
        };

        steps.write_gitignore = steps.write_gitignore and !existsZ(".gitignore");
        steps.write_readme = steps.write_readme and !existsZ("README.md") and !existsZ("README") and !existsZ("README.txt") and !existsZ("README.mdx");

        steps.write_tsconfig = brk: {
            if (existsZ("tsconfig.json")) {
                break :brk false;
            }

            if (existsZ("jsconfig.json")) {
                break :brk false;
            }

            break :brk true;
        };

        if (!minimal) {
            if (fields.name.len > 0)
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

        var need_run_bun_install = !did_load_package_json;
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

            const needs_typescript_dependency = !minimal and brk: {
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

            need_run_bun_install = needs_dependencies or needs_dev_dependencies or needs_typescript_dependency;

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
            var fd = bun.FD.fromStdFile(package_json_file orelse try std.fs.cwd().createFileZ("package.json", .{}));
            defer fd.close();
            var buffer_writer = JSPrinter.BufferWriter.init(bun.default_allocator);
            buffer_writer.append_newline = true;
            var package_json_writer = JSPrinter.BufferPrinter.init(buffer_writer);

            _ = JSPrinter.printJSON(
                @TypeOf(&package_json_writer),
                &package_json_writer,
                js_ast.Expr{ .data = .{ .e_object = fields.object }, .loc = logger.Loc.Empty },
                &logger.Source.initEmptyFile("package.json"),
                .{ .mangled_props = null },
            ) catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                package_json_file = null;
                break :write_package_json;
            };
            const written = package_json_writer.ctx.getWritten();
            bun.sys.File.writeAll(.{ .handle = fd }, written).unwrap() catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                package_json_file = null;
                break :write_package_json;
            };
            bun.sys.ftruncate(fd, @intCast(written.len)).unwrap() catch |err| {
                Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                package_json_file = null;
                break :write_package_json;
            };
        }

        if (steps.write_gitignore) {
            Assets.create(".gitignore", .{}) catch {
                // suppressed
            };
        }

        switch (template) {
            .blank, .typescript_library => {
                if (Template.getCursorRule()) |template_file| {
                    const result = InitCommand.Assets.createNew(template_file.path, template_file.contents);
                    result catch {
                        // No big deal if this fails
                    };
                }

                if (package_json_file != null and !did_load_package_json) {
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

                if (fields.entry_point.len > 0 and !did_load_package_json) {
                    Output.pretty("\nTo get started, run:\n\n    ", .{});

                    if (strings.containsAny(" \"'", fields.entry_point)) {
                        Output.pretty("<cyan>bun run {any}<r>\n\n", .{bun.fmt.formatJSONStringLatin1(fields.entry_point)});
                    } else {
                        Output.pretty("<cyan>bun run {s}<r>\n\n", .{fields.entry_point});
                    }
                }

                Output.flush();

                if (existsZ("package.json") and need_run_bun_install) {
                    Output.prettyln("", .{});
                    var process = std.process.Child.init(
                        &.{
                            try bun.selfExePath(),
                            "install",
                        },
                        alloc,
                    );
                    process.stderr_behavior = .Inherit;
                    process.stdin_behavior = .Inherit;
                    process.stdout_behavior = .Inherit;
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
    const TemplateFile = struct {
        path: [:0]const u8,
        contents: [:0]const u8,
        can_skip_if_exists: bool = false,
    };
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
                "dev",
                "bun --hot .",
                "static",
                "bun build ./src/index.html --outdir=dist --sourcemap --target=browser --minify --define:process.env.NODE_ENV='\"production\"' --env='BUN_PUBLIC_*'",
                "build",
                "NODE_ENV=production bun .",
            },
        };

        return s;
    }

    const agent_rule = @embedFile("../init/rule.md");
    const cursor_rule = TemplateFile{ .path = ".cursor/rules/use-bun-instead-of-node-vite-npm-pnpm.mdc", .contents = agent_rule };

    fn isCursorInstalled() bool {
        // Give some way to opt-out.
        if (bun.getenvTruthy("BUN_AGENT_RULE_DISABLED")) {
            return false;
        }

        // Detect if they're currently using cursor.
        if (bun.getenvZAnyCase("CURSOR_TRACE_ID")) |env| {
            if (env.len > 0) {
                return true;
            }
        }

        if (Environment.isMac) {
            if (bun.sys.exists("/Applications/Cursor.app")) {
                return true;
            }
        }

        if (Environment.isWindows) {
            if (bun.getenvZAnyCase("USER")) |user| {
                const pathbuf = bun.PathBufferPool.get();
                defer bun.PathBufferPool.put(pathbuf);
                const path = std.fmt.bufPrintZ(pathbuf, "C:\\Users\\{s}\\AppData\\Local\\Programs\\Cursor\\Cursor.exe", .{user}) catch {
                    return false;
                };

                if (bun.sys.exists(path)) {
                    return true;
                }
            }
        }

        return false;
    }
    pub fn getCursorRule() ?*const TemplateFile {
        if (isCursorInstalled()) {
            return &cursor_rule;
        }

        return null;
    }

    const ReactBlank = struct {
        const files: []const TemplateFile = &.{
            .{ .path = "bunfig.toml", .contents = @embedFile("../init/react-app/bunfig.toml") },
            .{ .path = "package.json", .contents = @embedFile("../init/react-app/package.json") },
            .{ .path = "tsconfig.json", .contents = @embedFile("../init/react-app/tsconfig.json") },
            .{ .path = "bun-env.d.ts", .contents = @embedFile("../init/react-app/bun-env.d.ts") },
            .{ .path = "README.md", .contents = InitCommand.Assets.@"README2.md" },
            .{ .path = ".gitignore", .contents = InitCommand.Assets.@".gitignore", .can_skip_if_exists = true },
            .{ .path = "src/index.tsx", .contents = @embedFile("../init/react-app/src/index.tsx") },
            .{ .path = "src/App.tsx", .contents = @embedFile("../init/react-app/src/App.tsx") },
            .{ .path = "src/index.html", .contents = @embedFile("../init/react-app/src/index.html") },
            .{ .path = "src/index.css", .contents = @embedFile("../init/react-app/src/index.css") },
            .{ .path = "src/APITester.tsx", .contents = @embedFile("../init/react-app/src/APITester.tsx") },
            .{ .path = "src/react.svg", .contents = @embedFile("../init/react-app/src/react.svg") },
            .{ .path = "src/frontend.tsx", .contents = @embedFile("../init/react-app/src/frontend.tsx") },
            .{ .path = "src/logo.svg", .contents = @embedFile("../init/react-app/src/logo.svg") },
        };
    };

    const ReactTailwind = struct {
        const files: []const TemplateFile = &.{
            .{ .path = "bunfig.toml", .contents = @embedFile("../init/react-tailwind/bunfig.toml") },
            .{ .path = "package.json", .contents = @embedFile("../init/react-tailwind/package.json") },
            .{ .path = "tsconfig.json", .contents = @embedFile("../init/react-tailwind/tsconfig.json") },
            .{ .path = "bun-env.d.ts", .contents = @embedFile("../init/react-tailwind/bun-env.d.ts") },
            .{ .path = "README.md", .contents = InitCommand.Assets.@"README2.md" },
            .{ .path = ".gitignore", .contents = InitCommand.Assets.@".gitignore", .can_skip_if_exists = true },
            .{ .path = "src/index.tsx", .contents = @embedFile("../init/react-tailwind/src/index.tsx") },
            .{ .path = "src/App.tsx", .contents = @embedFile("../init/react-tailwind/src/App.tsx") },
            .{ .path = "src/index.html", .contents = @embedFile("../init/react-tailwind/src/index.html") },
            .{ .path = "src/index.css", .contents = @embedFile("../init/react-tailwind/src/index.css") },
            .{ .path = "src/APITester.tsx", .contents = @embedFile("../init/react-tailwind/src/APITester.tsx") },
            .{ .path = "src/react.svg", .contents = @embedFile("../init/react-tailwind/src/react.svg") },
            .{ .path = "src/frontend.tsx", .contents = @embedFile("../init/react-tailwind/src/frontend.tsx") },
            .{ .path = "src/logo.svg", .contents = @embedFile("../init/react-tailwind/src/logo.svg") },
            .{ .path = "build.ts", .contents = @embedFile("../init/react-tailwind/build.ts") },
        };
    };

    const ReactShadcn = struct {
        const files: []const TemplateFile = &.{
            .{ .path = "bunfig.toml", .contents = @embedFile("../init/react-shadcn/bunfig.toml") },
            .{ .path = "styles/globals.css", .contents = @embedFile("../init/react-shadcn/styles/globals.css") },
            .{ .path = "package.json", .contents = @embedFile("../init/react-shadcn/package.json") },
            .{ .path = "components.json", .contents = @embedFile("../init/react-shadcn/components.json") },
            .{ .path = "tsconfig.json", .contents = @embedFile("../init/react-shadcn/tsconfig.json") },
            .{ .path = "bun-env.d.ts", .contents = @embedFile("../init/react-shadcn/bun-env.d.ts") },
            .{ .path = "README.md", .contents = InitCommand.Assets.@"README2.md" },
            .{ .path = ".gitignore", .contents = InitCommand.Assets.@".gitignore", .can_skip_if_exists = true },
            .{ .path = "src/index.tsx", .contents = @embedFile("../init/react-shadcn/src/index.tsx") },
            .{ .path = "src/App.tsx", .contents = @embedFile("../init/react-shadcn/src/App.tsx") },
            .{ .path = "src/index.html", .contents = @embedFile("../init/react-shadcn/src/index.html") },
            .{ .path = "src/index.css", .contents = @embedFile("../init/react-shadcn/src/index.css") },
            .{ .path = "src/components/ui/card.tsx", .contents = @embedFile("../init/react-shadcn/src/components/ui/card.tsx") },
            .{ .path = "src/components/ui/label.tsx", .contents = @embedFile("../init/react-shadcn/src/components/ui/label.tsx") },
            .{ .path = "src/components/ui/button.tsx", .contents = @embedFile("../init/react-shadcn/src/components/ui/button.tsx") },
            .{ .path = "src/components/ui/select.tsx", .contents = @embedFile("../init/react-shadcn/src/components/ui/select.tsx") },
            .{ .path = "src/components/ui/input.tsx", .contents = @embedFile("../init/react-shadcn/src/components/ui/input.tsx") },
            .{ .path = "src/components/ui/form.tsx", .contents = @embedFile("../init/react-shadcn/src/components/ui/form.tsx") },
            .{ .path = "src/APITester.tsx", .contents = @embedFile("../init/react-shadcn/src/APITester.tsx") },
            .{ .path = "src/lib/utils.ts", .contents = @embedFile("../init/react-shadcn/src/lib/utils.ts") },
            .{ .path = "src/react.svg", .contents = @embedFile("../init/react-shadcn/src/react.svg") },
            .{ .path = "src/frontend.tsx", .contents = @embedFile("../init/react-shadcn/src/frontend.tsx") },
            .{ .path = "src/logo.svg", .contents = @embedFile("../init/react-shadcn/src/logo.svg") },
            .{ .path = "build.ts", .contents = @embedFile("../init/react-shadcn/build.ts") },
        };
    };

    pub fn files(this: Template) []const TemplateFile {
        return switch (this) {
            .react_blank => ReactBlank.files,
            .react_tailwind => ReactTailwind.files,
            .react_tailwind_shadcn => ReactShadcn.files,
            else => &.{.{ &.{}, &.{} }},
        };
    }

    pub fn @"write files and run `bun dev`"(comptime this: Template, allocator: std.mem.Allocator) !void {
        if (Template.getCursorRule()) |rule| {
            const result = InitCommand.Assets.createNew(rule.path, rule.contents);
            result catch {
                // No big deal if this fails
            };
        }

        inline for (comptime this.files()) |file| {
            const path = file.path;
            const contents = file.contents;

            const result = if (comptime strings.eqlComptime(path, "README.md"))
                InitCommand.Assets.createWithContents("README.md", contents, .{
                    .name = this.name(),
                    .bunVersion = Environment.version_string,
                })
            else
                InitCommand.Assets.createNew(path, contents);
            result catch |err| {
                if (err == error.EEXIST) {
                    Output.prettyln(" ○ <r><yellow>{s}<r> (already exists, skipping)", .{path});
                    Output.flush();
                } else {
                    Output.err(err, "failed to create file: '{s}'", .{path});
                    Global.crash();
                }
            };
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

        Output.prettyln(
            \\
            \\✨ New project configured!
            \\
            \\<b><cyan>Development<r><d> - full-stack dev server with hot reload<r>
            \\
            \\    <cyan><b>bun dev<r>
            \\
            \\<b><yellow>Static Site<r><d> - build optimized assets to disk (no backend)<r>
            \\
            \\    <yellow><b>bun run build<r>
            \\
            \\<b><green>Production<r><d> - serve a full-stack production build<r>
            \\
            \\    <green><b>bun start<r>
            \\
            \\<blue>Happy bunning! 🐇<r>
            \\
        , .{});

        Output.flush();
    }
};
