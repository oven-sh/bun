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

var bun_path_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;
var bun_path: ?[:0]const u8 = null;
fn execTask(allocator: *std.mem.Allocator, task_: string, cwd: string, PATH: string, npm_client: NPMClient) void {
    const task = std.mem.trim(u8, task_, " \n\r\t");
    if (task.len == 0) return;

    var splitter = std.mem.split(u8, task, " ");
    var count: usize = 0;
    while (splitter.next() != null) {
        count += 1;
    }

    var argv = allocator.alloc(string, count + 2) catch return;
    defer allocator.free(argv);

    argv[0] = npm_client.bin;
    argv[1] = "exec";
    {
        var i: usize = 2;
        splitter = std.mem.split(u8, task, " ");
        while (splitter.next()) |split| {
            argv[i] = split;
            i += 1;
        }
    }

    if (strings.startsWith(task, "bun ")) {
        if (bun_path orelse which(&bun_path_buf, PATH, cwd, "bun")) |bun_path_| {
            bun_path = bun_path_;
            argv = argv[2..];
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

const CreateOptions = struct {
    npm_client: ?NPMClient.Tag = null,
    skip_install: bool = false,
    overwrite: bool = false,
    skip_git: bool = false,

    const params = [_]clap.Param(clap.Help){
        clap.parseParam("--help                     Print this menu") catch unreachable,
        clap.parseParam("--npm                      Use npm for tasks & install") catch unreachable,
        clap.parseParam("--yarn                     Use yarn for tasks & install") catch unreachable,
        clap.parseParam("--pnpm                     Use pnpm for tasks & install") catch unreachable,
        clap.parseParam("--force                    Overwrite existing files") catch unreachable,
        clap.parseParam("--no-install               Don't install node_modules") catch unreachable,
        clap.parseParam("--no-git                   Don't create a git repository") catch unreachable,
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

        if (args.flag("--no-install")) {
            opts.skip_install = true;
        }

        if (args.flag("--no-git")) {
            opts.skip_git = true;
        }

        if (args.flag("--force")) {
            opts.overwrite = true;
        }

        return opts;
    }
};

pub const CreateCommand = struct {
    var client: HTTPClient = undefined;
    var extracting_name_buf: [1024]u8 = undefined;
    pub fn exec(ctx: Command.Context, positionals: []const []const u8) !void {
        var create_options = try CreateOptions.parse(ctx.allocator, false);

        var filesystem = try fs.FileSystem.init1(ctx.allocator, null);
        var env_loader: DotEnv.Loader = brk: {
            var map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };

        env_loader.loadProcess();

        const template = positionals[0];
        const dirname = positionals[1];
        var filename_writer = filesystem.dirname_store;
        const destination = try filesystem.dirname_store.append([]const u8, resolve_path.joinAbs(filesystem.top_level_dir, .auto, dirname));

        var progress = std.Progress{};

        var node_ = try progress.start(try std.fmt.bufPrint(&extracting_name_buf, "Loading {s}", .{template}), 0);
        progress.supports_ansi_escape_codes = Output.enable_ansi_colors;
        var node = node_.start("Downloading", 0);

        // alacritty is fast
        if (env_loader.map.get("ALACRITTY_LOG") != null) {
            progress.refresh_rate_ns = std.time.ns_per_ms * 8;
        }

        defer {
            progress.root.end();
            progress.refresh();
        }

        var package_json_contents: MutableString = undefined;
        var package_json_file: std.fs.File = undefined;

        if (!std.fs.path.isAbsolute(template)) {
            var tarball_bytes: MutableString = try Example.fetch(ctx, template, &progress, &node);

            node.end();

            node = progress.root.start(try std.fmt.bufPrint(&extracting_name_buf, "Decompressing {s}", .{template}), 0);
            node.setCompletedItems(0);
            node.setEstimatedTotalItems(0);
            node.activate();
            progress.refresh();

            var file_buf = try ctx.allocator.alloc(u8, 16384);

            var tarball_buf_list = std.ArrayListUnmanaged(u8){ .capacity = file_buf.len, .items = file_buf };
            var gunzip = try Zlib.ZlibReaderArrayList.init(tarball_bytes.list.items, &tarball_buf_list, ctx.allocator);
            try gunzip.readAll();
            gunzip.deinit();

            node.end();

            node = progress.root.start(try std.fmt.bufPrint(&extracting_name_buf, "Extracting {s}", .{template}), 0);
            node.setCompletedItems(0);
            node.setEstimatedTotalItems(0);
            node.activate();
            progress.refresh();

            var pluckers = [_]Archive.Plucker{
                try Archive.Plucker.init("package.json", 2048, ctx.allocator),
                try Archive.Plucker.init("GETTING_STARTED", 512, ctx.allocator),
            };

            var archive_context = Archive.Context{
                .pluckers = &pluckers,
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

                if (archive_context.overwrite_list.count() > 0) {
                    node.end();
                    progress.root.end();
                    progress.refresh();

                    // Thank you create-react-app for this copy (and idea)
                    Output.prettyErrorln(
                        "<r><red>error<r><d>: <r>The directory <b><green>{s}<r> contains files that could conflict:",
                        .{
                            std.fs.path.basename(destination),
                        },
                    );
                    for (archive_context.overwrite_list.keys()) |path| {
                        if (strings.endsWith(path, std.fs.path.sep_str)) {
                            Output.prettyErrorln("<r>  <cyan>{s}<r>", .{path});
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
                1,
                false,
            );

            var plucker = pluckers[0];

            if (!plucker.found or plucker.fd == 0) {
                node.end();
                progress.root.end();
                Output.prettyErrorln("package.json not found. This package is corrupt. Please try again or file an issue if it keeps happening.", .{});
                Output.flush();
                std.os.exit(1);
            }

            node.end();
            node = progress.root.start(try std.fmt.bufPrint(&extracting_name_buf, "Updating package.json", .{}), 0);

            node.activate();
            progress.refresh();

            package_json_contents = plucker.contents;
            package_json_file = std.fs.File{ .handle = plucker.fd };
        } else {
            const template_dir = std.fs.openDirAbsolute(template, .{ .iterate = true }) catch |err| {
                node.end();
                progress.root.end();
                progress.refresh();

                Output.prettyErrorln("<r><red>{s}<r>: opening dir {s}", .{ @errorName(err), template });
                Output.flush();
                std.os.exit(1);
            };

            std.fs.deleteTreeAbsolute(destination) catch {};
            const destination_dir = std.fs.cwd().makeOpenPath(destination, .{ .iterate = true }) catch |err| {
                node.end();
                progress.root.end();
                progress.refresh();

                Output.prettyErrorln("<r><red>{s}<r>: creating dir {s}", .{ @errorName(err), destination });
                Output.flush();
                std.os.exit(1);
            };

            var walker = try template_dir.walk(ctx.allocator);
            defer walker.deinit();
            while (try walker.next()) |entry| {
                // TODO: make this not walk these folders entirely
                // rather than checking each file path.....
                if (entry.kind != .File or
                    std.mem.indexOf(u8, entry.path, "node_modules") != null or
                    std.mem.indexOf(u8, entry.path, ".git") != null) continue;

                entry.dir.copyFile(entry.basename, destination_dir, entry.path, .{}) catch {
                    if (std.fs.path.dirname(entry.path)) |entry_dirname| {
                        destination_dir.makePath(entry_dirname) catch {};
                    }
                    entry.dir.copyFile(entry.basename, destination_dir, entry.path, .{}) catch |err| {
                        node.end();
                        progress.root.end();
                        progress.refresh();

                        Output.prettyErrorln("<r><red>{s}<r>: copying file {s}", .{ @errorName(err), entry.path });
                        Output.flush();
                        std.os.exit(1);
                    };
                };
            }

            package_json_file = destination_dir.openFile("package.json", .{ .read = true, .write = true }) catch |err| {
                node.end();
                progress.root.end();
                progress.refresh();

                Output.prettyErrorln("Failed to open package.json due to error <r><red>{s}", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            };
            const stat = package_json_file.stat() catch |err| {
                node.end();
                progress.root.end();
                progress.refresh();

                Output.prettyErrorln("Failed to stat package.json due to error <r><red>{s}", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            };

            if (stat.kind != .File or stat.size == 0) {
                node.end();
                progress.root.end();
                progress.refresh();

                Output.prettyErrorln("package.json must be a file with content", .{});
                Output.flush();
                std.os.exit(1);
            }
            package_json_contents = try MutableString.init(ctx.allocator, stat.size);
            package_json_contents.inflate(package_json_file.readAll(package_json_contents.list.items) catch |err| {
                node.end();
                progress.root.end();
                progress.refresh();

                Output.prettyErrorln("Error reading package.json: <r><red>{s}", .{@errorName(err)});
                Output.flush();
                std.os.exit(1);
            }) catch unreachable;
        }

        var source = logger.Source.initPathString("package.json", package_json_contents.list.items);
        var package_json_expr = ParseJSON(&source, ctx.log, ctx.allocator) catch |err| {
            node.end();
            progress.root.end();
            progress.refresh();

            Output.prettyErrorln("package.json failed to parse with error: {s}", .{@errorName(err)});
            Output.flush();
            std.os.exit(1);
        };

        if (ctx.log.errors > 0) {
            node.end();

            progress.refresh();

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
                node.end();
                progress.root.end();

                progress.refresh();

                Output.prettyErrorln("package.json failed to parse correctly. its missing a name. it shouldnt be missing a name.", .{});
                Output.flush();
                std.os.exit(1);
            }

            var basename = std.fs.path.basename(destination);
            name_expr.expr.data.e_string.utf8 = @intToPtr([*]u8, @ptrToInt(basename.ptr))[0..basename.len];
        } else {
            node.end();
            progress.root.end();

            progress.refresh();

            Output.prettyErrorln("package.json failed to parse correctly. its missing a name. it shouldnt be missing a name.", .{});
            Output.flush();
            std.os.exit(1);
        }

        package_json_expr.data.e_object.is_single_line = false;

        var preinstall_tasks = std.mem.zeroes(std.ArrayListUnmanaged([]const u8));
        var postinstall_tasks = std.mem.zeroes(std.ArrayListUnmanaged([]const u8));

        {
            var i: usize = 0;
            var property_i: usize = 0;
            while (i < package_json_expr.data.e_object.properties.len) : (i += 1) {
                const property = package_json_expr.data.e_object.properties[i];
                const key = property.key.?.asString(ctx.allocator).?;

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
        }

        node.name = "Saving package.json";
        progress.maybeRefresh();

        var package_json_writer = JSPrinter.NewFileWriter(package_json_file);

        _ = JSPrinter.printJSON(@TypeOf(package_json_writer), package_json_writer, package_json_expr, &source) catch |err| {
            Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
            Output.flush();
            std.os.exit(1);
        };

        const PATH = env_loader.map.get("PATH") orelse "";

        var npm_client_: ?NPMClient = null;

        if (!create_options.skip_install) {
            if (env_loader.map.get("NPM_CLIENT")) |npm_client_bin| {
                npm_client_ = NPMClient{ .tag = .npm, .bin = npm_client_bin };
            } else if (PATH.len > 0) {
                var realpath_buf: [std.fs.MAX_PATH_BYTES]u8 = undefined;

                if (create_options.npm_client) |tag| {
                    if (which(&realpath_buf, PATH, filesystem.top_level_dir, @tagName(tag))) |bin| {
                        npm_client_ = NPMClient{ .tag = tag, .bin = try ctx.allocator.dupe(u8, bin) };
                    }
                } else if (try NPMClient.detect(ctx.allocator, &realpath_buf, PATH, filesystem.top_level_dir, true)) |npmclient| {
                    npm_client_ = NPMClient{
                        .bin = try ctx.allocator.dupe(u8, npmclient.bin),
                        .tag = npmclient.tag,
                    };
                }
            }
        }

        if (npm_client_ != null and preinstall_tasks.items.len > 0) {
            node.end();
            node = progress.root.start("Running pre-install tasks", preinstall_tasks.items.len);
            node.setCompletedItems(0);
            progress.refresh();

            for (preinstall_tasks.items) |task, i| {
                execTask(ctx.allocator, task, destination, PATH, npm_client_.?);

                node.setCompletedItems(i);
                progress.refresh();
            }
        }

        node.end();

        if (npm_client_) |npm_client| {
            const start_time = std.time.nanoTimestamp();
            var install_args = [_]string{ npm_client.bin, "install" };
            Output.printError("\n", .{});
            Output.flush();

            Output.prettyln("\n<r><d>$ <b><cyan>{s}<r><d> install<r>", .{@tagName(npm_client.tag)});
            Output.flush();

            var process = try std.ChildProcess.init(&install_args, ctx.allocator);
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

        progress.refresh();

        if (npm_client_ != null and !create_options.skip_install and postinstall_tasks.items.len > 0) {
            node.end();
            node = progress.root.start("Running post-install tasks", postinstall_tasks.items.len);
            node.setCompletedItems(0);
            progress.refresh();

            for (postinstall_tasks.items) |task, i| {
                execTask(ctx.allocator, task, destination, PATH, npm_client_.?);

                node.setCompletedItems(i);
                progress.refresh();
            }
        }

        var parent_dir = try std.fs.openDirAbsolute(destination, .{});
        std.os.linkat(parent_dir.fd, "gitignore", parent_dir.fd, ".gitignore", 0) catch {};
        std.os.unlinkat(
            parent_dir.fd,
            "gitignore",
            0,
        ) catch {};
        parent_dir.close();

        if (!create_options.skip_git) {
            if (which(&bun_path_buf, PATH, destination, "git")) |git| {
                const git_commands = .{
                    &[_]string{ std.mem.span(git), "init", "--quiet" },
                    &[_]string{ std.mem.span(git), "add", "-A", destination, "--ignore-errors" },
                    &[_]string{ std.mem.span(git), "commit", "-am", "\"Initial Commit\"", "--quiet" },
                };
                // same names, just comptime known values

                inline for (comptime std.meta.fieldNames(@TypeOf(Commands))) |command_field| {
                    const command: []const string = @field(git_commands, command_field);
                    var process = try std.ChildProcess.init(command, ctx.allocator);
                    process.cwd = destination;
                    process.stdin_behavior = .Inherit;
                    process.stdout_behavior = .Inherit;
                    process.stderr_behavior = .Inherit;
                    defer process.deinit();

                    var term = try process.spawnAndWait();
                    _ = process.kill() catch undefined;
                }
            }
        }

        Output.printError("\n", .{});
        Output.printStartEnd(ctx.start_time, std.time.nanoTimestamp());
        Output.prettyErrorln(" <r><d>bun create {s}<r>", .{template});
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

    pub fn spawn(allocator: *std.mem.Allocator, tarball_url: string) !*PackageDownloadThread {
        var download = try allocator.create(PackageDownloadThread);
        download.* = PackageDownloadThread{
            .allocator = allocator,
            .client = HTTPClient.init(allocator, .GET, URL.parse(tarball_url), .{}, ""),
            .tarball_url = tarball_url,
            .buffer = try MutableString.init(allocator, 1024),
            .done = std.atomic.Atomic(u32).init(0),
            .thread = undefined,
        };

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

    var client: HTTPClient = undefined;
    const examples_url: string = "https://registry.npmjs.org/bun-examples-all/latest";
    var url: URL = undefined;
    pub const timeout: u32 = 6000;

    pub fn print(examples: []const Example) void {
        for (examples) |example, i| {
            var app_name = example.name;

            if (example.description.len > 0) {
                Output.pretty("  <r># {s}<r>\n  <b>bun create <cyan>{s}<r><b> ./{s}-app<r>\n<d>  \n\n", .{
                    example.description,
                    example.name,
                    app_name,
                });
            } else {
                Output.pretty("  <r><b>bun create <cyan>{s}<r><b> ./{s}-app<r>\n\n", .{
                    example.name,
                    app_name,
                });
            }
        }
    }

    pub fn fetchFromDisk(ctx: Command.Context, absolute_path: string, refresher: *std.Progress, progress: *std.Progress.Node) !MutableString {
        progress.name = "Reading local package";
        refresher.refresh();

        var package = try std.fs.openFileAbsolute(absolute_path, .{ .read = true });
        var stat = try package.stat();
        if (stat.kind != .File) {
            progress.end();
            Output.prettyErrorln("<r>{s} is not a file", .{absolute_path});
            Output.flush();
            std.os.exit(1);
        }

        if (stat.size == 0) {
            progress.end();
            Output.prettyErrorln("<r>{s} is an empty file", .{absolute_path});
            Output.flush();
            std.os.exit(1);
        }

        var mutable_string = try MutableString.init(ctx.allocator, stat.size);
        mutable_string.list.expandToCapacity();
        var bytes = try package.readAll(mutable_string.list.items);
        try mutable_string.inflate(bytes);
        return mutable_string;
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

        var thread: *PackageDownloadThread = try PackageDownloadThread.spawn(ctx.allocator, tarball_url);

        std.Thread.Futex.wait(&thread.done, 1, std.time.ns_per_ms * 100) catch {};

        progress.setEstimatedTotalItems(thread.client.body_size);
        progress.setCompletedItems(thread.client.read_count);
        refresher.maybeRefresh();
        if (thread.done.load(.Acquire) == 0) {
            while (true) {
                std.Thread.Futex.wait(&thread.done, 1, std.time.ns_per_ms * 100) catch {};
                progress.setEstimatedTotalItems(thread.client.body_size);
                progress.setCompletedItems(thread.client.read_count);
                refresher.maybeRefresh();
                if (thread.done.load(.Acquire) == 1) {
                    break;
                }
            }
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

    pub fn fetchAll(ctx: Command.Context) ![]const Example {
        url = URL.parse(examples_url);
        client = HTTPClient.init(ctx.allocator, .GET, url, .{}, "");
        client.timeout = timeout;
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
        const time = std.time.nanoTimestamp();
        const examples = try Example.fetchAll(ctx);
        Output.printStartEnd(time, std.time.nanoTimestamp());
        Output.prettyln(" <d>Fetched examples<r>", .{});

        Output.prettyln("Welcome to Bun! Create a new project by pasting any of the following:\n\n", .{});
        Output.flush();

        Example.print(examples);

        _ = try CreateOptions.parse(ctx.allocator, true);

        Output.pretty("<d>To add a new template, git clone https://github.com/jarred-sumner/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>", .{});
        Output.flush();
    }
};
