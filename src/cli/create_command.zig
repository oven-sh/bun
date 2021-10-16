usingnamespace @import("../global.zig");
const std = @import("std");

const lex = @import("../js_lexer.zig");
const logger = @import("../logger.zig");
const alloc = @import("../alloc.zig");
const options = @import("../options.zig");
const js_parser = @import("../js_parser.zig");
const js_ast = @import("../js_ast.zig");
const linker = @import("../linker.zig");
usingnamespace @import("../ast/base.zig");
usingnamespace @import("../defines.zig");
const panicky = @import("../panic_handler.zig");
const allocators = @import("../allocators.zig");
const sync = @import(".././sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../javascript/jsc/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;
const bundler = @import("../bundler.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const fs = @import("../fs.zig");
const URL = @import("../query_string_map.zig").URL;
const HTTPClient = @import("../http_client.zig");
const ParseJSON = @import("../json_parser.zig").ParseJSON;
const Archive = @import("../libarchive/libarchive.zig").Archive;
const Zlib = @import("../zlib.zig");
const JSPrinter = @import("../js_printer.zig");
const DotEnv = @import("../env_loader.zig");
const NPMClient = @import("../which_npm_client.zig").NPMClient;
const which = @import("../which.zig").which;
const clap = @import("clap");
const Lock = @import("../lock.zig").Lock;

const CopyFile = @import("../copy_file.zig");
var bun_path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

// the standard library function for this returns false when statically linking
fn getSelfExeSharedLibPaths(allocator: *std.mem.Allocator) error{OutOfMemory}![][:0]u8 {
    const List = std.ArrayList([:0]u8);
    const os = std.os;
    const Allocator = std.mem.Allocator;
    const builtin = std.builtin;
    const mem = std.mem;

    switch (builtin.os.tag) {
        .linux,
        .freebsd,
        .netbsd,
        .dragonfly,
        .openbsd,
        => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice();
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }
            try os.dl_iterate_phdr(&paths, error{OutOfMemory}, struct {
                fn callback(info: *os.dl_phdr_info, size: usize, list: *List) !void {
                    _ = size;
                    const name = info.dlpi_name orelse return;
                    if (name[0] == '/') {
                        const item = try list.allocator.dupeZ(u8, mem.spanZ(name));
                        errdefer list.allocator.free(item);
                        try list.append(item);
                    }
                }
            }.callback);
            return paths.toOwnedSlice();
        },
        .macos, .ios, .watchos, .tvos => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice();
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }
            const img_count = std.c._dyld_image_count();
            var i: u32 = 0;
            while (i < img_count) : (i += 1) {
                const name = std.c._dyld_get_image_name(i);
                const item = try allocator.dupeZ(u8, mem.spanZ(name));
                errdefer allocator.free(item);
                try paths.append(item);
            }
            return paths.toOwnedSlice();
        },
        // revisit if Haiku implements dl_iterat_phdr (https://dev.haiku-os.org/ticket/15743)
        .haiku => {
            var paths = List.init(allocator);
            errdefer {
                const slice = paths.toOwnedSlice();
                for (slice) |item| {
                    allocator.free(item);
                }
                allocator.free(slice);
            }

            var b = "/boot/system/runtime_loader";
            const item = try allocator.dupeZ(u8, mem.spanZ(b));
            errdefer allocator.free(item);
            try paths.append(item);

            return paths.toOwnedSlice();
        },
        else => @compileError("getSelfExeSharedLibPaths unimplemented for this target"),
    }
}

const skip_dirs = &[_]string{ "node_modules", ".git" };
const skip_files = &[_]string{
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
};

const never_conflict = &[_]string{
    "README.md",
    "gitignore",
    ".gitignore",
    ".git/",
};

const npm_task_args = &[_]string{
    "exec",
};

var bun_path: ?[:0]const u8 = null;
fn execTask(allocator: *std.mem.Allocator, task_: string, cwd: string, PATH: string, npm_client: NPMClient) void {
    const task = std.mem.trim(u8, task_, " \n\r\t");
    if (task.len == 0) return;

    var splitter = std.mem.split(u8, task, " ");
    var count: usize = 0;
    while (splitter.next() != null) {
        count += 1;
    }

    const npm_args = 2;
    const total = count + npm_args;
    var argv = allocator.alloc(string, total) catch return;
    defer allocator.free(argv);

    argv[0] = npm_client.bin;
    argv[1] = npm_task_args[0];

    {
        var i: usize = 2;

        splitter = std.mem.split(u8, task, " ");
        while (splitter.next()) |split| {
            argv[i] = split;
            i += 1;
        }
    }

    if (strings.startsWith(task, "bun ")) {
        // TODO: use self exe
        if (bun_path orelse which(&bun_path_buf, PATH, cwd, "bun")) |bun_path_| {
            bun_path = bun_path_;
            argv = argv[npm_args..];
            argv[0] = std.mem.span(bun_path_);
        }
    }

    Output.pretty("\n<r><d>$<b>", .{});
    for (argv) |arg, i| {
        if (i > argv.len - 1) {
            Output.print(" {s} ", .{arg});
        } else {
            Output.print(" {s}", .{arg});
        }
    }
    Output.pretty("<r>", .{});
    Output.print("\n", .{});
    Output.flush();

    Output.disableBuffering();
    defer Output.enableBuffering();

    var proc = std.ChildProcess.init(argv, allocator) catch return;
    defer proc.deinit();
    proc.stdin_behavior = .Inherit;
    proc.stdout_behavior = .Inherit;
    proc.stderr_behavior = .Inherit;
    proc.cwd = cwd;
    _ = proc.spawnAndWait() catch undefined;
}

// We don't want to allocate memory each time
// But we cannot print over an existing buffer or weird stuff will happen
// so we keep two and switch between them
pub const ProgressBuf = struct {
    var bufs: [2][1024]u8 = [2][1024]u8{
        @as([1024]u8, undefined),
        @as([1024]u8, undefined),
    };

    var buf_index: usize = 0;

    pub fn print(comptime fmt: string, args: anytype) !string {
        buf_index += 1;
        return try std.fmt.bufPrint(std.mem.span(&bufs[buf_index % 2]), fmt, args);
    }
};

const CreateOptions = struct {
    npm_client: ?NPMClient.Tag = null,
    skip_install: bool = false,
    overwrite: bool = false,
    skip_git: bool = false,
    verbose: bool = false,

    const params = [_]clap.Param(clap.Help){
        clap.parseParam("--help                     Print this menu") catch unreachable,
        clap.parseParam("--npm                      Use npm for tasks & install") catch unreachable,
        clap.parseParam("--yarn                     Use yarn for tasks & install") catch unreachable,
        clap.parseParam("--pnpm                     Use pnpm for tasks & install") catch unreachable,
        clap.parseParam("--force                    Overwrite existing files") catch unreachable,
        clap.parseParam("--no-install               Don't install node_modules") catch unreachable,
        clap.parseParam("--no-git                   Don't create a git repository") catch unreachable,
        clap.parseParam("--verbose                  Too many logs") catch unreachable,
        clap.parseParam("<POS>...                   ") catch unreachable,
    };

    pub fn parse(allocator: *std.mem.Allocator, comptime print_flags_only: bool) !CreateOptions {
        var diag = clap.Diagnostic{};

        var args = clap.parse(clap.Help, &params, .{ .diagnostic = &diag, .allocator = allocator }) catch |err| {
            // Report useful error and exit
            diag.report(Output.errorWriter(), err) catch {};
            return err;
        };

        if (args.flag("--help") or comptime print_flags_only) {
            if (comptime print_flags_only) {
                clap.help(Output.writer(), params[1..]) catch {};
                return undefined;
            }

            Output.prettyln("<r><b>bun create<r> flags:\n", .{});
            Output.flush();
            clap.help(Output.writer(), params[1..]) catch {};
            Output.flush();
            std.os.exit(0);
        }

        var opts = CreateOptions{};
        if (args.flag("--npm")) {
            opts.npm_client = NPMClient.Tag.npm;
        }

        if (args.flag("--yarn")) {
            opts.npm_client = NPMClient.Tag.yarn;
        }

        if (args.flag("--pnpm")) {
            opts.npm_client = NPMClient.Tag.pnpm;
        }

        opts.verbose = args.flag("--verbose");
        opts.skip_install = args.flag("--no-install");
        opts.skip_git = args.flag("--no-git");
        opts.overwrite = args.flag("--force");

        return opts;
    }
};

const BUN_CREATE_DIR = ".bun-create";
var home_dir_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
pub const CreateCommand = struct {
    var client: HTTPClient = undefined;

    pub fn exec(ctx: Command.Context, positionals: []const []const u8) !void {
        var create_options = try CreateOptions.parse(ctx.allocator, false);

        var filesystem = try fs.FileSystem.init1(ctx.allocator, null);
        var env_loader: DotEnv.Loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };

        env_loader.loadProcess();

        const template = brk: {
            var positional = positionals[0];

            if (!std.fs.path.isAbsolute(positional)) {
                outer: {
                    if (env_loader.map.get("BUN_CREATE_DIR")) |home_dir| {
                        var parts = [_]string{ home_dir, positional };
                        var outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                        home_dir_buf[outdir_path.len] = 0;
                        var outdir_path_ = home_dir_buf[0..outdir_path.len :0];
                        std.fs.accessAbsoluteZ(outdir_path_, .{}) catch break :outer;
                        if (create_options.verbose) {
                            Output.prettyErrorln("reading from {s}", .{outdir_path});
                        }
                        break :brk outdir_path;
                    }
                }

                outer: {
                    var parts = [_]string{ filesystem.top_level_dir, BUN_CREATE_DIR, positional };
                    var outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                    home_dir_buf[outdir_path.len] = 0;
                    var outdir_path_ = home_dir_buf[0..outdir_path.len :0];
                    std.fs.accessAbsoluteZ(outdir_path_, .{}) catch break :outer;
                    if (create_options.verbose) {
                        Output.prettyErrorln("reading from {s}", .{outdir_path});
                    }
                    break :brk outdir_path;
                }

                outer: {
                    if (env_loader.map.get("HOME")) |home_dir| {
                        var parts = [_]string{ home_dir, BUN_CREATE_DIR, positional };
                        var outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                        home_dir_buf[outdir_path.len] = 0;
                        var outdir_path_ = home_dir_buf[0..outdir_path.len :0];
                        std.fs.accessAbsoluteZ(outdir_path_, .{}) catch break :outer;
                        if (create_options.verbose) {
                            Output.prettyErrorln("reading from {s}", .{outdir_path});
                        }
                        break :brk outdir_path;
                    }
                }
            }

            break :brk positional;
        };
        const dirname = positionals[1];
        var filename_writer = filesystem.dirname_store;
        const destination = try filesystem.dirname_store.append([]const u8, resolve_path.joinAbs(filesystem.top_level_dir, .auto, dirname));

        var progress = std.Progress{};
        var node = try progress.start(try ProgressBuf.print("Loading {s}", .{template}), 0);
        progress.supports_ansi_escape_codes = Output.enable_ansi_colors;

        // alacritty is fast
        if (env_loader.map.get("ALACRITTY_LOG") != null) {
            progress.refresh_rate_ns = std.time.ns_per_ms * 8;

            if (create_options.verbose) {
                Output.prettyErrorln("your using alacritty", .{});
            }
        }

        defer {
            progress.refresh();
        }

        var package_json_contents: MutableString = undefined;
        var package_json_file: std.fs.File = undefined;

        const is_remote_template = !std.fs.path.isAbsolute(template);

        if (create_options.verbose) {
            Output.prettyErrorln("is_remote_template {d}", .{@boolToInt(is_remote_template)});
        }

        if (is_remote_template) {
            var tarball_bytes: MutableString = Example.fetch(ctx, template, &progress, node) catch |err| {
                switch (err) {
                    error.HTTPForbidden, error.ExampleNotFound => {
                        node.end();
                        progress.refresh();

                        Output.prettyError("\n<r><red>error:<r> <b>\"{s}\"<r> was not found. Here are templates you can use:\n\n", .{
                            template,
                        });
                        Output.flush();

                        const examples = try Example.fetchAllLocalAndRemote(ctx, null, &env_loader, filesystem);
                        Example.print(examples.items, dirname);
                        Output.flush();
                        std.os.exit(1);
                    },
                    else => {
                        return err;
                    },
                }
            };

            node.name = try ProgressBuf.print("Decompressing {s}", .{template});
            node.setCompletedItems(0);
            node.setEstimatedTotalItems(0);

            progress.refresh();

            var file_buf = try ctx.allocator.alloc(u8, 16384);

            var tarball_buf_list = std.ArrayListUnmanaged(u8){ .capacity = file_buf.len, .items = file_buf };
            var gunzip = try Zlib.ZlibReaderArrayList.init(tarball_bytes.list.items, &tarball_buf_list, ctx.allocator);
            try gunzip.readAll();
            gunzip.deinit();

            node.name = try ProgressBuf.print("Extracting {s}", .{template});
            node.setCompletedItems(0);
            node.setEstimatedTotalItems(0);

            progress.refresh();

            var pluckers = [_]Archive.Plucker{
                try Archive.Plucker.init("package.json", 2048, ctx.allocator),
                try Archive.Plucker.init("GETTING_STARTED", 512, ctx.allocator),
            };

            var archive_context = Archive.Context{
                .pluckers = &pluckers,
                .all_files = undefined,
                .overwrite_list = std.StringArrayHashMap(void).init(ctx.allocator),
            };

            if (!create_options.overwrite) {
                try Archive.getOverwritingFileList(
                    tarball_buf_list.items,
                    destination,
                    &archive_context,
                    @TypeOf(filesystem.dirname_store),
                    filesystem.dirname_store,
                    1,
                );

                inline for (never_conflict) |never_conflict_path| {
                    _ = archive_context.overwrite_list.swapRemove(never_conflict_path);
                }

                if (archive_context.overwrite_list.count() > 0) {
                    node.end();
                    progress.refresh();

                    // Thank you create-react-app for this copy (and idea)
                    Output.prettyErrorln(
                        "<r><red>error<r><d>: <r>The directory <b><blue>{s}<r>/ contains files that could conflict:\n\n",
                        .{
                            std.fs.path.basename(destination),
                        },
                    );
                    for (archive_context.overwrite_list.keys()) |path| {
                        if (strings.endsWith(path, std.fs.path.sep_str)) {
                            Output.prettyError("<r>  <blue>{s}<r>", .{path[0 .. std.math.max(path.len, 1) - 1]});
                            Output.prettyErrorln(std.fs.path.sep_str, .{});
                        } else {
                            Output.prettyErrorln("<r>  {s}", .{path});
                        }
                    }
                    Output.flush();
                    std.os.exit(1);
                }
            }

            const extracted_file_count = try Archive.extractToDisk(
                tarball_buf_list.items,
                destination,
                &archive_context,
                void,
                void{},
                1,
                false,
                false,
            );

            var plucker = pluckers[0];

            if (!plucker.found or plucker.fd == 0) {
                node.end();

                Output.prettyErrorln("package.json not found. This package is corrupt. Please try again or file an issue if it keeps happening.", .{});
                Output.flush();
                std.os.exit(1);
            }

            node.name = "Updating package.json";
            progress.refresh();

            package_json_contents = plucker.contents;
            package_json_file = std.fs.File{ .handle = plucker.fd };
        } else {
            var template_parts = [_]string{template};

            node.name = "Copying files";
            progress.refresh();

            const template_dir = std.fs.openDirAbsolute(filesystem.abs(&template_parts), .{ .iterate = true }) catch |err| {
                node.end();
                progress.refresh();

                Output.prettyErrorln("<r><red>{s}<r>: opening dir {s}", .{ @errorName(err), template });
                Output.flush();
                std.os.exit(1);
            };

            std.fs.deleteTreeAbsolute(destination) catch {};
            const destination_dir = std.fs.cwd().makeOpenPath(destination, .{ .iterate = true }) catch |err| {
                node.end();

                progress.refresh();

                Output.prettyErrorln("<r><red>{s}<r>: creating dir {s}", .{ @errorName(err), destination });
                Output.flush();
                std.os.exit(1);
            };

            const Walker = @import("../walker_skippable.zig");
            var walker_ = try Walker.walk(template_dir, ctx.allocator, skip_files, skip_dirs);
            defer walker_.deinit();

            var count: usize = 0;

            const FileCopier = struct {
                pub fn copy(
                    destination_dir_: std.fs.Dir,
                    walker: *Walker,
                    node_: *std.Progress.Node,
                    progress_: *std.Progress,
                ) !void {
                    while (try walker.next()) |entry| {
                        // TODO: make this not walk these folders entirely
                        // rather than checking each file path.....
                        if (entry.kind != .File) continue;

                        var outfile = destination_dir_.createFile(entry.path, .{}) catch brk: {
                            if (std.fs.path.dirname(entry.path)) |entry_dirname| {
                                destination_dir_.makePath(entry_dirname) catch {};
                            }
                            break :brk destination_dir_.createFile(entry.path, .{}) catch |err| {
                                node_.end();

                                progress_.refresh();

                                Output.prettyErrorln("<r><red>{s}<r>: copying file {s}", .{ @errorName(err), entry.path });
                                Output.flush();
                                std.os.exit(1);
                            };
                        };
                        defer outfile.close();
                        defer node_.completeOne();

                        var infile = try entry.dir.openFile(entry.basename, .{ .read = true });
                        defer infile.close();

                        // Assumption: you only really care about making sure something that was executable is still executable
                        const stat = infile.stat() catch continue;
                        _ = C.fchmod(outfile.handle, stat.mode);

                        CopyFile.copy(infile.handle, outfile.handle) catch {
                            entry.dir.copyFile(entry.basename, destination_dir_, entry.path, .{}) catch |err| {
                                node_.end();

                                progress_.refresh();

                                Output.prettyErrorln("<r><red>{s}<r>: copying file {s}", .{ @errorName(err), entry.path });
                                Output.flush();
                                std.os.exit(1);
                            };
                        };
                    }
                }
            };

            try FileCopier.copy(destination_dir, &walker_, node, &progress);

            package_json_file = destination_dir.openFile("package.json", .{ .read = true, .write = true }) catch |err| {
                node.end();

                progress.refresh();

                Output.prettyErrorln("Failed to open package.json due to error <r><red>{s}", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            };
            const stat = package_json_file.stat() catch |err| {
                node.end();

                progress.refresh();

                Output.prettyErrorln("Failed to stat package.json due to error <r><red>{s}", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            };

            if (stat.kind != .File or stat.size == 0) {
                node.end();

                progress.refresh();

                Output.prettyErrorln("package.json must be a file with content", .{});
                Output.flush();
                std.os.exit(1);
            }
            package_json_contents = try MutableString.init(ctx.allocator, stat.size);
            package_json_contents.list.expandToCapacity();

            _ = package_json_file.preadAll(package_json_contents.list.items, 0) catch |err| {
                node.end();

                progress.refresh();

                Output.prettyErrorln("Error reading package.json: <r><red>{s}", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            };
            // The printer doesn't truncate, so we must do so manually
            std.os.ftruncate(package_json_file.handle, 0) catch {};

            js_ast.Expr.Data.Store.create(default_allocator);
            js_ast.Stmt.Data.Store.create(default_allocator);
        }

        node.end();
        progress.refresh();

        var source = logger.Source.initPathString("package.json", package_json_contents.list.items);
        var package_json_expr = ParseJSON(&source, ctx.log, ctx.allocator) catch |err| {
            Output.prettyErrorln("package.json failed to parse with error: {s}", .{@errorName(err)});
            Output.flush();
            std.os.exit(1);
        };

        if (ctx.log.errors > 0) {
            if (Output.enable_ansi_colors) {
                try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
            } else {
                try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
            }

            Output.flush();
            std.os.exit(1);
        }

        if (package_json_expr.asProperty("name")) |name_expr| {
            if (name_expr.expr.data != .e_string) {
                Output.prettyErrorln("package.json failed to parse correctly. its missing a name. it shouldnt be missing a name.", .{});
                Output.flush();
                std.os.exit(1);
            }

            var basename = std.fs.path.basename(destination);
            name_expr.expr.data.e_string.utf8 = @intToPtr([*]u8, @ptrToInt(basename.ptr))[0..basename.len];
        } else {
            Output.prettyErrorln("package.json failed to parse correctly. its missing a name. it shouldnt be missing a name.", .{});
            Output.flush();
            std.os.exit(1);
        }

        package_json_expr.data.e_object.is_single_line = false;

        var preinstall_tasks = std.mem.zeroes(std.ArrayListUnmanaged([]const u8));
        var postinstall_tasks = std.mem.zeroes(std.ArrayListUnmanaged([]const u8));

        var has_dependencies: bool = false;

        {
            var i: usize = 0;
            var property_i: usize = 0;
            while (i < package_json_expr.data.e_object.properties.len) : (i += 1) {
                const property = package_json_expr.data.e_object.properties[i];
                const key = property.key.?.asString(ctx.allocator).?;

                has_dependencies = has_dependencies or
                    ((strings.eqlComptime(key, "dependencies") or
                    strings.eqlComptime(key, "devDependencies") or
                    std.mem.indexOf(u8, key, "optionalDependencies") != null or
                    strings.eqlComptime(key, "peerDependencies")) and
                    (property.value.?.data == .e_object and property.value.?.data.e_object.properties.len > 0));

                if (key.len == 0 or !strings.eqlComptime(key, "bun-create")) {
                    package_json_expr.data.e_object.properties[property_i] = property;
                    property_i += 1;
                    continue;
                }

                var value = property.value.?;
                if (value.asProperty("postinstall")) |postinstall| {
                    switch (postinstall.expr.data) {
                        .e_string => |single_task| {
                            try postinstall_tasks.append(
                                ctx.allocator,
                                try single_task.string(ctx.allocator),
                            );
                        },
                        .e_array => |tasks| {
                            for (tasks.items) |task| {
                                if (task.asString(ctx.allocator)) |task_entry| {
                                    try postinstall_tasks.append(
                                        ctx.allocator,
                                        task_entry,
                                    );
                                }
                            }
                        },
                        else => {},
                    }
                }

                if (value.asProperty("preinstall")) |preinstall| {
                    switch (preinstall.expr.data) {
                        .e_string => |single_task| {
                            try preinstall_tasks.append(
                                ctx.allocator,
                                try single_task.string(ctx.allocator),
                            );
                        },
                        .e_array => |tasks| {
                            for (tasks.items) |task| {
                                if (task.asString(ctx.allocator)) |task_entry| {
                                    try preinstall_tasks.append(
                                        ctx.allocator,
                                        task_entry,
                                    );
                                }
                            }
                        },
                        else => {},
                    }
                }
            }
            package_json_expr.data.e_object.properties = package_json_expr.data.e_object.properties[0..property_i];
        }

        if (create_options.verbose) {
            Output.prettyErrorln("Has dependencies? {d}", .{@boolToInt(has_dependencies)});
        }

        var package_json_writer = JSPrinter.NewFileWriter(package_json_file);

        _ = JSPrinter.printJSON(@TypeOf(package_json_writer), package_json_writer, package_json_expr, &source) catch |err| {
            Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
            Output.flush();
            std.os.exit(1);
        };

        {
            var parent_dir = try std.fs.openDirAbsolute(destination, .{});
            defer parent_dir.close();
            std.os.linkat(parent_dir.fd, "gitignore", parent_dir.fd, ".gitignore", 0) catch {};
            std.os.unlinkat(
                parent_dir.fd,
                "gitignore",
                0,
            ) catch {};
            std.os.unlinkat(
                parent_dir.fd,
                ".npmignore",
                0,
            ) catch {};
        }

        const PATH = env_loader.map.get("PATH") orelse "";

        var npm_client_: ?NPMClient = null;
        create_options.skip_install = create_options.skip_install or !has_dependencies;

        if (!create_options.skip_git) {
            if (!create_options.skip_install) {
                GitHandler.spawn(destination, PATH, create_options.verbose);
            } else {
                if (create_options.verbose) {
                    create_options.skip_git = GitHandler.run(destination, PATH, true) catch false;
                } else {
                    create_options.skip_git = GitHandler.run(destination, PATH, false) catch false;
                }
            }
        }

        if (!create_options.skip_install) {
            if (env_loader.map.get("NPM_CLIENT")) |npm_client_bin| {
                npm_client_ = NPMClient{ .tag = .npm, .bin = npm_client_bin };
            } else if (PATH.len > 0) {
                var realpath_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

                if (create_options.npm_client) |tag| {
                    if (which(&realpath_buf, PATH, destination, @tagName(tag))) |bin| {
                        npm_client_ = NPMClient{ .tag = tag, .bin = try ctx.allocator.dupe(u8, bin) };
                    }
                } else if (try NPMClient.detect(ctx.allocator, &realpath_buf, PATH, destination, true)) |npmclient| {
                    npm_client_ = NPMClient{
                        .bin = try ctx.allocator.dupe(u8, npmclient.bin),
                        .tag = npmclient.tag,
                    };
                }
            }
        }

        if (npm_client_ != null and preinstall_tasks.items.len > 0) {
            for (preinstall_tasks.items) |task, i| {
                execTask(ctx.allocator, task, destination, PATH, npm_client_.?);
            }
        }

        if (npm_client_) |npm_client| {
            const start_time = std.time.nanoTimestamp();
            const install_args_ = [_]string{ npm_client.bin, "install", "--loglevel=error", "--no-fund", "--no-audit" };
            const len: usize = switch (npm_client.tag) {
                .npm => install_args_.len,
                else => 2,
            };

            const install_args = install_args_[0..len];
            Output.flush();
            Output.pretty("\n<r><d>$ <b><cyan>{s}<r><d> install", .{@tagName(npm_client.tag)});
            var writer = Output.writer();

            if (install_args.len > 2) {
                for (install_args[2..]) |arg| {
                    Output.pretty(" ", .{});
                    Output.pretty("{s}", .{arg});
                }
            }

            Output.pretty("<r>\n", .{});
            Output.flush();

            var process = try std.ChildProcess.init(install_args, ctx.allocator);
            process.cwd = destination;

            defer {
                Output.printErrorln("\n", .{});
                Output.printStartEnd(start_time, std.time.nanoTimestamp());
                Output.prettyError(" <r><d>{s} install<r>\n", .{@tagName(npm_client.tag)});
                Output.flush();

                Output.print("\n", .{});
                Output.flush();
            }
            defer process.deinit();

            var term = try process.spawnAndWait();

            _ = process.kill() catch undefined;
        } else if (!create_options.skip_install) {
            progress.log("Failed to detect npm client. Tried pnpm, yarn, and npm.\n", .{});
        }

        if (npm_client_ != null and !create_options.skip_install and postinstall_tasks.items.len > 0) {
            for (postinstall_tasks.items) |task, i| {
                execTask(ctx.allocator, task, destination, PATH, npm_client_.?);
            }
        }

        if (!create_options.skip_install and !create_options.skip_git) {
            create_options.skip_git = !GitHandler.wait();
        }

        Output.printError("\n", .{});
        Output.printStartEnd(ctx.start_time, std.time.nanoTimestamp());
        Output.prettyErrorln(" <r><d>bun create {s}<r>", .{template});
        Output.flush();

        if (!create_options.skip_install) {
            Output.pretty(
                \\
                \\<r><d>-----<r>
                \\
            , .{});
        }

        if (!create_options.skip_git and !create_options.skip_install) {
            Output.pretty(
                \\
                \\<d>A local git repository was created for you and dependencies were installed automatically.<r>
                \\
            , .{});
        } else if (!create_options.skip_git) {
            Output.pretty(
                \\
                \\<d>A local git repository was created for you.<r>
                \\
            , .{});
        } else if (!create_options.skip_install) {
            Output.pretty(
                \\
                \\<d>Dependencies were installed automatically.<r>
                \\
            , .{});
        }

        Output.pretty(
            \\
            \\<b>Created <green>{s}<r> project successfully
            \\
            \\<d>#<r><b> To get started, run:<r>
            \\
            \\  <b><cyan>cd {s}<r>
            \\  <b><cyan>bun<r>
            \\
        , .{
            std.fs.path.basename(template),
            filesystem.relativeTo(destination),
        });

        Output.flush();
    }
};
const Commands = .{
    &[_]string{""},
    &[_]string{""},
    &[_]string{""},
};
const picohttp = @import("picohttp");

const PackageDownloadThread = struct {
    thread: std.Thread,
    client: HTTPClient,
    tarball_url: string,
    allocator: *std.mem.Allocator,
    buffer: MutableString,
    done: std.atomic.Atomic(u32),
    response: picohttp.Response = undefined,

    pub fn threadHandler(this: *PackageDownloadThread) !void {
        this.done.store(0, .Release);
        this.response = try this.client.send("", &this.buffer);
        this.done.store(1, .Release);
        std.Thread.Futex.wake(&this.done, 1);
    }

    pub fn spawn(allocator: *std.mem.Allocator, tarball_url: string, progress_node: *std.Progress.Node) !*PackageDownloadThread {
        var download = try allocator.create(PackageDownloadThread);
        download.* = PackageDownloadThread{
            .allocator = allocator,
            .client = HTTPClient.init(allocator, .GET, URL.parse(tarball_url), .{}, ""),
            .tarball_url = tarball_url,
            .buffer = try MutableString.init(allocator, 1024),
            .done = std.atomic.Atomic(u32).init(0),
            .thread = undefined,
        };

        if (Output.enable_ansi_colors) {
            download.client.progress_node = progress_node;
        }

        download.thread = try std.Thread.spawn(.{}, threadHandler, .{download});

        return download;
    }
};

pub const DownloadedExample = struct {
    tarball_bytes: MutableString,
    example: Example,
};

pub const Example = struct {
    name: string,
    version: string,
    description: string,
    local: bool = false,

    var client: HTTPClient = undefined;
    const examples_url: string = "https://registry.npmjs.org/bun-examples-all/latest";
    var url: URL = undefined;
    pub const timeout: u32 = 6000;

    var app_name_buf: [512]u8 = undefined;
    pub fn print(examples: []const Example, default_app_name: ?string) void {
        for (examples) |example, i| {
            var app_name = default_app_name orelse (std.fmt.bufPrint(&app_name_buf, "./{s}-app", .{example.name[0..std.math.min(example.name.len, 492)]}) catch unreachable);

            if (example.description.len > 0) {
                Output.pretty("  <r># {s}<r>\n  <b>bun create <cyan>{s}<r><b> {s}<r>\n<d>  \n\n", .{
                    example.description,
                    example.name,
                    app_name,
                });
            } else {
                Output.pretty("  <r><b>bun create <cyan>{s}<r><b> {s}<r>\n\n", .{
                    example.name,
                    app_name,
                });
            }
        }
    }

    pub fn fetchAllLocalAndRemote(ctx: Command.Context, node: ?*std.Progress.Node, env_loader: *DotEnv.Loader, filesystem: *fs.FileSystem) !std.ArrayList(Example) {
        const remote_examples = try Example.fetchAll(ctx, node);
        if (node) |node_| node_.end();

        var examples = std.ArrayList(Example).fromOwnedSlice(ctx.allocator, remote_examples);
        {
            var folders = [3]std.fs.Dir{ std.fs.Dir{ .fd = 0 }, std.fs.Dir{ .fd = 0 }, std.fs.Dir{ .fd = 0 } };
            if (env_loader.map.get("BUN_CREATE_DIR")) |home_dir| {
                var parts = [_]string{home_dir};
                var outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                folders[0] = std.fs.openDirAbsolute(outdir_path, .{ .iterate = true }) catch std.fs.Dir{ .fd = 0 };
            }

            {
                var parts = [_]string{ filesystem.top_level_dir, BUN_CREATE_DIR };
                var outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                folders[1] = std.fs.openDirAbsolute(outdir_path, .{ .iterate = true }) catch std.fs.Dir{ .fd = 0 };
            }

            if (env_loader.map.get("HOME")) |home_dir| {
                var parts = [_]string{ home_dir, BUN_CREATE_DIR };
                var outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                folders[2] = std.fs.openDirAbsolute(outdir_path, .{ .iterate = true }) catch std.fs.Dir{ .fd = 0 };
            }

            // subfolders with package.json
            for (folders) |folder_| {
                if (folder_.fd != 0) {
                    const folder: std.fs.Dir = folder_;
                    var iter = folder.iterate();

                    loop: while (iter.next() catch null) |entry_| {
                        const entry: std.fs.Dir.Entry = entry_;

                        switch (entry.kind) {
                            .Directory => {
                                inline for (skip_dirs) |skip_dir| {
                                    if (strings.eqlComptime(entry.name, skip_dir)) {
                                        continue :loop;
                                    }
                                }

                                std.mem.copy(u8, &home_dir_buf, entry.name);
                                home_dir_buf[entry.name.len] = std.fs.path.sep;
                                std.mem.copy(u8, home_dir_buf[entry.name.len + 1 ..], "package.json");
                                home_dir_buf[entry.name.len + 1 + "package.json".len] = 0;

                                var path: [:0]u8 = home_dir_buf[0 .. entry.name.len + 1 + "package.json".len :0];

                                folder.accessZ(path, .{
                                    .read = true,
                                }) catch continue :loop;

                                try examples.append(
                                    Example{
                                        .name = try filesystem.filename_store.append(@TypeOf(entry.name), entry.name),
                                        .version = "",
                                        .local = true,
                                        .description = "",
                                    },
                                );
                                continue :loop;
                            },
                            else => continue,
                        }
                    }
                }
            }
        }

        return examples;
    }

    pub fn fetch(ctx: Command.Context, name: string, refresher: *std.Progress, progress: *std.Progress.Node) !MutableString {
        progress.name = "Fetching package.json";
        refresher.refresh();

        const example_start = std.time.nanoTimestamp();
        var url_buf: [1024]u8 = undefined;
        var mutable = try MutableString.init(ctx.allocator, 2048);

        url = URL.parse(try std.fmt.bufPrint(&url_buf, "https://registry.npmjs.org/@bun-examples/{s}/latest", .{name}));
        client = HTTPClient.init(ctx.allocator, .GET, url, .{}, "");
        client.timeout = timeout;
        client.progress_node = progress;
        var response = try client.send("", &mutable);

        switch (response.status_code) {
            404 => return error.ExampleNotFound,
            403 => return error.HTTPForbidden,
            429 => return error.HTTPTooManyRequests,
            499...599 => return error.NPMIsDown,
            200 => {},
            else => return error.HTTPError,
        }

        progress.name = "Parsing package.json";
        refresher.refresh();
        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);

        var source = logger.Source.initPathString("package.json", mutable.list.items);
        var expr = ParseJSON(&source, ctx.log, ctx.allocator) catch |err| {
            progress.end();
            refresher.refresh();

            if (ctx.log.errors > 0) {
                if (Output.enable_ansi_colors) {
                    try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                } else {
                    try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                }
                Output.flush();
                std.os.exit(1);
            } else {
                Output.prettyErrorln("Error parsing package: <r><red>{s}<r>", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            }
        };

        if (ctx.log.errors > 0) {
            progress.end();
            refresher.refresh();

            if (Output.enable_ansi_colors) {
                try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
            } else {
                try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
            }
            Output.flush();
            std.os.exit(1);
        }

        const tarball_url: string = brk: {
            if (expr.asProperty("dist")) |q| {
                if (q.expr.asProperty("tarball")) |p| {
                    if (p.expr.asString(ctx.allocator)) |s| {
                        if (s.len > 0 and (strings.startsWith(s, "https://") or strings.startsWith(s, "http://"))) {
                            break :brk s;
                        }
                    }
                }
            }

            progress.end();
            refresher.refresh();

            Output.prettyErrorln("package.json is missing tarball url. This is an internal error!", .{});
            Output.flush();
            std.os.exit(1);
        };

        progress.name = "Downloading tarball";
        refresher.refresh();

        var thread: *PackageDownloadThread = try PackageDownloadThread.spawn(ctx.allocator, tarball_url, progress);
        refresher.maybeRefresh();

        while (thread.done.load(.Acquire) == 0) {
            std.Thread.Futex.wait(&thread.done, 1, std.time.ns_per_ms * 10000) catch {};
        }

        refresher.maybeRefresh();

        if (thread.response.status_code != 200) {
            progress.end();
            refresher.refresh();
            Output.prettyErrorln("Error fetching tarball: <r><red>{d}<r>", .{thread.response.status_code});
            Output.flush();
            std.os.exit(1);
        }

        refresher.refresh();
        thread.thread.join();

        return thread.buffer;
    }

    pub fn fetchAll(ctx: Command.Context, progress_node: ?*std.Progress.Node) ![]Example {
        url = URL.parse(examples_url);
        client = HTTPClient.init(ctx.allocator, .GET, url, .{}, "");
        client.timeout = timeout;

        if (Output.enable_ansi_colors) {
            client.progress_node = progress_node;
        }

        var mutable: MutableString = try MutableString.init(ctx.allocator, 1024);
        var response = client.send("", &mutable) catch |err| {
            switch (err) {
                error.WouldBlock => {
                    Output.prettyErrorln("Request timed out while trying to fetch examples list. Please try again", .{});
                    Output.flush();
                    std.os.exit(1);
                },
                else => {
                    Output.prettyErrorln("<r><red>{s}<r> while trying to fetch examples list. Please try again", .{@errorName(err)});
                    Output.flush();
                    std.os.exit(1);
                },
            }
        };

        if (response.status_code != 200) {
            Output.prettyErrorln("<r><red>{d}<r> fetching examples :( {s}", .{ response.status_code, mutable.list.items });
            Output.flush();
            std.os.exit(1);
        }

        js_ast.Expr.Data.Store.create(default_allocator);
        js_ast.Stmt.Data.Store.create(default_allocator);
        var source = logger.Source.initPathString("examples.json", mutable.list.items);
        const examples_object = ParseJSON(&source, ctx.log, ctx.allocator) catch |err| {
            if (ctx.log.errors > 0) {
                if (Output.enable_ansi_colors) {
                    try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
                } else {
                    try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
                }
                std.os.exit(1);
                Output.flush();
            } else {
                Output.prettyErrorln("Error parsing examples: <r><red>{s}<r>", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            }
        };

        if (ctx.log.errors > 0) {
            if (Output.enable_ansi_colors) {
                try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), true);
            } else {
                try ctx.log.printForLogLevelWithEnableAnsiColors(Output.errorWriter(), false);
            }
            Output.flush();
            std.os.exit(1);
        }

        if (examples_object.asProperty("examples")) |q| {
            if (q.expr.data == .e_object) {
                var count: usize = 0;
                for (q.expr.data.e_object.properties) |property| {
                    count += 1;
                }

                var list = try ctx.allocator.alloc(Example, count);
                for (q.expr.data.e_object.properties) |property, i| {
                    const name = property.key.?.data.e_string.utf8;
                    list[i] = Example{
                        .name = if (std.mem.indexOfScalar(u8, name, '/')) |slash|
                            name[slash + 1 ..]
                        else
                            name,
                        .version = property.value.?.asProperty("version").?.expr.data.e_string.utf8,
                        .description = property.value.?.asProperty("description").?.expr.data.e_string.utf8,
                    };
                }
                return list;
            }
        }

        Output.prettyErrorln("Corrupt examples data: expected object but received {s}", .{@tagName(examples_object.data)});
        Output.flush();
        std.os.exit(1);
    }
};

pub const CreateListExamplesCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        var filesystem = try fs.FileSystem.init1(ctx.allocator, null);
        var env_loader: DotEnv.Loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };

        env_loader.loadProcess();

        const time = std.time.nanoTimestamp();
        var progress = std.Progress{};
        var node = try progress.start("Fetching manifest", 0);
        progress.refresh();

        const examples = try Example.fetchAllLocalAndRemote(ctx, node, &env_loader, filesystem);
        Output.printStartEnd(time, std.time.nanoTimestamp());
        Output.prettyln(" <d>Fetched manifest<r>", .{});
        Output.prettyln("Welcome to Bun! Create a new project by pasting any of the following:\n\n", .{});
        Output.flush();

        Example.print(examples.items, null);

        if (env_loader.map.get("HOME")) |homedir| {
            Output.prettyln(
                "<d>This command is completely optional. To add a new local template, create a folder in {s}/.bun-create/. To publish a new template, git clone https://github.com/jarred-sumner/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>",
                .{homedir},
            );
        } else {
            Output.prettyln(
                "<d>This command is completely optional. To add a new local template, create a folder in $HOME/.bun-create/. To publish a new template, git clone https://github.com/jarred-sumner/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>",
                .{},
            );
        }

        Output.flush();
    }
};

const GitHandler = struct {
    var success: std.atomic.Atomic(u32) = undefined;
    var thread: std.Thread = undefined;
    pub fn spawn(
        destination: string,
        PATH: string,
        verbose: bool,
    ) void {
        success = std.atomic.Atomic(u32).init(0);

        thread = std.Thread.spawn(.{}, spawnThread, .{ destination, PATH, verbose }) catch |err| {
            Output.prettyErrorln("<r><red>{s}<r>", .{@errorName(err)});
            Output.flush();
            std.os.exit(1);
        };
    }

    fn spawnThread(
        destination: string,
        PATH: string,
        verbose: bool,
    ) void {
        Output.Source.configureThread();
        std.Thread.setName(thread, "git") catch {};
        defer Output.flush();
        const outcome = if (verbose)
            run(destination, PATH, true) catch false
        else
            run(destination, PATH, false) catch false;

        @fence(.Acquire);
        success.store(
            if (outcome)
                1
            else
                2,
            .Release,
        );
        std.Thread.Futex.wake(&success, 1);
    }

    pub fn wait() bool {
        @fence(.Release);

        while (success.load(.Acquire) == 0) {
            std.Thread.Futex.wait(&success, 0, 1000) catch continue;
        }

        const outcome = success.load(.Acquire) == 1;
        thread.join();
        return outcome;
    }

    pub fn run(
        destination: string,
        PATH: string,
        comptime verbose: bool,
    ) !bool {
        const git_start = std.time.nanoTimestamp();

        // This feature flag is disabled.
        // using libgit2 is slower than the CLI.
        // [481.00ms] git
        // [89.00ms] git
        // if (comptime FeatureFlags.use_libgit2) {
        // }

        if (which(&bun_path_buf, PATH, destination, "git")) |git| {
            const git_commands = .{
                &[_]string{ std.mem.span(git), "init", "--quiet" },
                &[_]string{ std.mem.span(git), "add", destination, "--ignore-errors" },
                &[_]string{ std.mem.span(git), "commit", "-am", "\"Initial commit (via bun create)\"", "--quiet" },
            };

            if (comptime verbose) {
                Output.prettyErrorln("git backend: {s}", .{git});
            }

            // same names, just comptime known values

            inline for (comptime std.meta.fieldNames(@TypeOf(Commands))) |command_field| {
                const command: []const string = @field(git_commands, command_field);
                var process = try std.ChildProcess.init(command, default_allocator);
                process.cwd = destination;
                process.stdin_behavior = .Inherit;
                process.stdout_behavior = .Inherit;
                process.stderr_behavior = .Inherit;
                defer process.deinit();

                var term = try process.spawnAndWait();
                _ = process.kill() catch undefined;
            }

            Output.prettyError("\n", .{});
            Output.printStartEnd(git_start, std.time.nanoTimestamp());
            Output.prettyError(" <d>git<r>\n", .{});
            return true;
        }

        return false;
    }
};
