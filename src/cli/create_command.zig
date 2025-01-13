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
const Progress = bun.Progress;

const lex = bun.js_lexer;
const logger = bun.logger;

const options = @import("../options.zig");
const js_parser = bun.js_parser;
const js_ast = bun.JSAst;
const linker = @import("../linker.zig");

const allocators = @import("../allocators.zig");
const sync = @import("../sync.zig");
const Api = @import("../api/schema.zig").Api;
const resolve_path = @import("../resolver/resolve_path.zig");
const configureTransformOptionsForBun = @import("../bun.js/config.zig").configureTransformOptionsForBun;
const Command = @import("../cli.zig").Command;

const fs = @import("../fs.zig");
const URL = @import("../url.zig").URL;
const HTTP = bun.http;

const JSON = bun.JSON;
const Archiver = bun.libarchive.Archiver;
const Zlib = @import("../zlib.zig");
const JSPrinter = bun.js_printer;
const DotEnv = @import("../env_loader.zig");
const NPMClient = @import("../which_npm_client.zig").NPMClient;
const which = @import("../which.zig").which;
const clap = bun.clap;
const Lock = bun.Mutex;
const Headers = bun.http.Headers;
const CopyFile = @import("../copy_file.zig");
var bun_path_buf: bun.PathBuffer = undefined;
const Futex = @import("../futex.zig");

const target_nextjs_version = "12.2.3";
pub var initialized_store = false;
pub fn initializeStore() void {
    if (initialized_store) return;
    initialized_store = true;
    js_ast.Expr.Data.Store.create();
    js_ast.Stmt.Data.Store.create();
}

const skip_dirs = &[_]bun.OSPathSlice{
    bun.OSPathLiteral("node_modules"),
    bun.OSPathLiteral(".git"),
};
const skip_files = &[_]bun.OSPathSlice{
    bun.OSPathLiteral("package-lock.json"),
    bun.OSPathLiteral("yarn.lock"),
    bun.OSPathLiteral("pnpm-lock.yaml"),
};

const never_conflict = &[_]string{
    "README.md",
    "gitignore",
    ".gitignore",
    ".git/",
};

const npm_task_args = &[_]string{"run"};

const UnsupportedPackages = struct {
    @"styled-jsx": bool = false,

    pub fn update(this: *UnsupportedPackages, expr: js_ast.Expr) void {
        for (expr.data.e_object.properties.slice()) |prop| {
            inline for (comptime std.meta.fieldNames(UnsupportedPackages)) |field_name| {
                if (strings.eqlComptime(prop.key.?.data.e_string.data, comptime field_name)) {
                    @field(this, field_name) = true;
                }
            }
        }
    }

    pub fn print(this: UnsupportedPackages) void {
        inline for (comptime std.meta.fieldNames(UnsupportedPackages)) |field_name| {
            if (@field(this, field_name)) {
                Output.prettyErrorln("<r><yellow>warn<r><d>:<r> <b>\"{s}\"<r> won't work in bun yet\n", .{field_name});
            }
        }
    }
};

var bun_path: ?[:0]const u8 = null;
fn execTask(allocator: std.mem.Allocator, task_: string, cwd: string, _: string, npm_client: ?NPMClient) void {
    const task = std.mem.trim(u8, task_, " \n\r\t");
    if (task.len == 0) return;

    var splitter = std.mem.split(u8, task, " ");
    var count: usize = 0;
    while (splitter.next() != null) {
        count += 1;
    }

    const npm_args = 2 * @as(usize, @intCast(@intFromBool(npm_client != null)));
    const total = count + npm_args;
    var argv = allocator.alloc(string, total) catch return;

    if (npm_client) |client| {
        argv[0] = client.bin;
        argv[1] = npm_task_args[0];
    }

    {
        var i: usize = npm_args;

        splitter = std.mem.split(u8, task, " ");
        while (splitter.next()) |split| {
            argv[i] = split;
            i += 1;
        }
    }

    if (strings.startsWith(task, "bun ")) {
        argv = argv[2..];
    }

    Output.pretty("\n<r><d>$<b>", .{});
    for (argv, 0..) |arg, i| {
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

    _ = bun.spawnSync(&.{
        .argv = argv,
        .envp = null,

        .cwd = cwd,
        .stderr = .inherit,
        .stdout = .inherit,
        .stdin = .inherit,

        .windows = if (Environment.isWindows) .{
            .loop = bun.JSC.EventLoopHandle.init(bun.JSC.MiniEventLoop.initGlobal(null)),
        } else {},
    }) catch return;
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
        return try std.fmt.bufPrint(&bufs[buf_index % 2], fmt, args);
    }

    pub fn pretty(comptime fmt: string, args: anytype) !string {
        if (Output.enable_ansi_colors) {
            return ProgressBuf.print(comptime Output.prettyFmt(fmt, true), args);
        } else {
            return ProgressBuf.print(comptime Output.prettyFmt(fmt, false), args);
        }
    }
};

const CreateOptions = struct {
    npm_client: ?NPMClient.Tag = null,
    skip_install: bool = false,
    overwrite: bool = false,
    skip_git: bool = false,
    skip_package_json: bool = false,
    positionals: []const string,
    verbose: bool = false,
    open: bool = false,

    const params = [_]clap.Param(clap.Help){
        clap.parseParam("-h, --help                     Print this menu") catch unreachable,
        clap.parseParam("--force                        Overwrite existing files") catch unreachable,
        clap.parseParam("--no-install                   Don't install node_modules") catch unreachable,
        clap.parseParam("--no-git                       Don't create a git repository") catch unreachable,
        clap.parseParam("--verbose                      Too many logs") catch unreachable,
        clap.parseParam("--no-package-json              Disable package.json transforms") catch unreachable,
        clap.parseParam("--open                         On finish, start bun & open in-browser") catch unreachable,
        clap.parseParam("<POS>...                       ") catch unreachable,
    };

    pub fn parse(ctx: Command.Context) !CreateOptions {
        Output.is_verbose = Output.isVerbose();

        var diag = clap.Diagnostic{};

        var args = clap.parse(clap.Help, &params, .{ .diagnostic = &diag, .allocator = ctx.allocator }) catch |err| {
            // Report useful error and exit
            diag.report(Output.errorWriter(), err) catch {};
            return err;
        };

        var opts = CreateOptions{ .positionals = args.positionals() };

        if (opts.positionals.len >= 1 and (strings.eqlComptime(opts.positionals[0], "c") or strings.eqlComptime(opts.positionals[0], "create"))) {
            opts.positionals = opts.positionals[1..];
        }

        opts.skip_package_json = args.flag("--no-package-json");

        opts.verbose = args.flag("--verbose") or Output.is_verbose;
        opts.open = args.flag("--open");
        opts.skip_install = args.flag("--no-install");
        opts.skip_git = args.flag("--no-git");
        opts.overwrite = args.flag("--force");

        return opts;
    }
};

const BUN_CREATE_DIR = ".bun-create";
var home_dir_buf: bun.PathBuffer = undefined;
pub const CreateCommand = struct {
    pub fn exec(ctx: Command.Context, example_tag: Example.Tag, template: []const u8) !void {
        @setCold(true);

        Global.configureAllocator(.{ .long_running = false });
        HTTP.HTTPThread.init(&.{});

        var create_options = try CreateOptions.parse(ctx);
        const positionals = create_options.positionals;

        if (positionals.len == 0) {
            return try CreateListExamplesCommand.exec(ctx);
        }

        var filesystem = try fs.FileSystem.init(null);
        var env_loader: DotEnv.Loader = brk: {
            const map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };

        env_loader.loadProcess();

        const dirname: string = brk: {
            if (positionals.len == 1) {
                break :brk std.fs.path.basename(template);
            }

            break :brk positionals[1];
        };

        const destination = try filesystem.dirname_store.append([]const u8, resolve_path.joinAbs(filesystem.top_level_dir, .auto, dirname));

        var progress = Progress{};
        progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
        var node = progress.start(try ProgressBuf.print("Loading {s}", .{template}), 0);

        // alacritty is fast
        if (env_loader.map.get("ALACRITTY_LOG") != null) {
            progress.refresh_rate_ns = std.time.ns_per_ms * 8;

            if (create_options.verbose) {
                Output.prettyErrorln("alacritty gets faster progress bars ", .{});
            }
        }

        defer {
            progress.refresh();
        }

        var package_json_contents: MutableString = undefined;
        var package_json_file: ?std.fs.File = null;

        if (create_options.verbose) {
            Output.prettyErrorln("Downloading as {s}\n", .{@tagName(example_tag)});
        }

        switch (example_tag) {
            Example.Tag.github_repository, Example.Tag.official => {
                const tarball_bytes: MutableString = switch (example_tag) {
                    .official => Example.fetch(ctx, &env_loader, template, &progress, node) catch |err| {
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
                                Global.exit(1);
                            },
                            else => {
                                node.end();
                                progress.refresh();

                                Output.prettyErrorln("\n\n", .{});

                                return err;
                            },
                        }
                    },
                    .github_repository => Example.fetchFromGitHub(ctx, &env_loader, template, &progress, node) catch |err| {
                        switch (err) {
                            error.HTTPForbidden => {
                                node.end();
                                progress.refresh();

                                Output.prettyError("\n<r><red>error:<r> GitHub returned 403. This usually means GitHub is rate limiting your requests.\nTo fix this, either:<r>  <b>A) pass a <r><cyan>GITHUB_ACCESS_TOKEN<r> environment variable to bun<r>\n  <b>B)Wait a little and try again<r>\n", .{});
                                Global.crash();
                            },

                            error.GitHubRepositoryNotFound => {
                                node.end();
                                progress.refresh();

                                Output.prettyError("\n<r><red>error:<r> <b>\"{s}\"<r> was not found on GitHub. Here are templates you can use:\n\n", .{
                                    template,
                                });
                                Output.flush();

                                const examples = try Example.fetchAllLocalAndRemote(ctx, null, &env_loader, filesystem);
                                Example.print(examples.items, dirname);
                                Global.crash();
                            },
                            else => {
                                node.end();
                                progress.refresh();

                                Output.prettyErrorln("\n\n", .{});

                                return err;
                            },
                        }
                    },
                    else => unreachable,
                };

                node.name = try ProgressBuf.print("Decompressing {s}", .{template});
                node.setCompletedItems(0);
                node.setEstimatedTotalItems(0);

                progress.refresh();

                const file_buf = try ctx.allocator.alloc(u8, 16384);

                var tarball_buf_list = std.ArrayListUnmanaged(u8){ .capacity = file_buf.len, .items = file_buf };
                var gunzip = try Zlib.ZlibReaderArrayList.init(tarball_bytes.list.items, &tarball_buf_list, ctx.allocator);
                try gunzip.readAll();
                gunzip.deinit();

                node.name = try ProgressBuf.print("Extracting {s}", .{template});
                node.setCompletedItems(0);
                node.setEstimatedTotalItems(0);

                progress.refresh();

                var pluckers: [1]Archiver.Plucker = if (!create_options.skip_package_json)
                    [1]Archiver.Plucker{try Archiver.Plucker.init(comptime strings.literal(bun.OSPathChar, "package.json"), 2048, ctx.allocator)}
                else
                    [1]Archiver.Plucker{undefined};

                var archive_context = Archiver.Context{
                    .pluckers = pluckers[0..@as(usize, @intCast(@intFromBool(!create_options.skip_package_json)))],
                    .all_files = undefined,
                    .overwrite_list = bun.StringArrayHashMap(void).init(ctx.allocator),
                };

                if (!create_options.overwrite) {
                    try Archiver.getOverwritingFileList(
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
                            "<r>\n<red>error<r><d>: <r>The directory <b><blue>{s}<r>/ contains files that could conflict:\n\n",
                            .{
                                std.fs.path.basename(destination),
                            },
                        );
                        for (archive_context.overwrite_list.keys()) |path| {
                            if (strings.endsWith(path, std.fs.path.sep_str)) {
                                Output.prettyError("<r>  <blue>{s}<r>", .{path[0 .. @max(path.len, 1) - 1]});
                                Output.prettyErrorln(std.fs.path.sep_str, .{});
                            } else {
                                Output.prettyErrorln("<r>  {s}", .{path});
                            }
                        }

                        Output.prettyErrorln("<r>\n<d>To download {s} anyway, use --force<r>", .{template});
                        Global.exit(1);
                    }
                }

                _ = try Archiver.extractToDisk(
                    tarball_buf_list.items,
                    destination,
                    &archive_context,
                    void,
                    {},
                    .{
                        .depth_to_skip = 1,
                    },
                );

                if (!create_options.skip_package_json) {
                    const plucker = pluckers[0];

                    if (plucker.found and plucker.fd != .zero) {
                        node.name = "Updating package.json";
                        progress.refresh();

                        package_json_contents = plucker.contents;
                        package_json_file = plucker.fd.asFile();
                    }
                }
            },
            .local_folder => {
                var template_parts = [_]string{template};

                node.name = "Copying files";
                progress.refresh();

                const abs_template_path = filesystem.abs(&template_parts);
                const template_dir = std.fs.openDirAbsolute(abs_template_path, .{ .iterate = true }) catch |err| {
                    node.end();
                    progress.refresh();

                    Output.prettyErrorln("<r><red>{s}<r>: opening dir {s}", .{ @errorName(err), template });
                    Global.exit(1);
                };

                std.fs.deleteTreeAbsolute(destination) catch {};
                const destination_dir__ = std.fs.cwd().makeOpenPath(destination, .{}) catch |err| {
                    node.end();

                    progress.refresh();

                    Output.prettyErrorln("<r><red>{s}<r>: creating dir {s}", .{ @errorName(err), destination });
                    Global.exit(1);
                };

                var destination_buf: if (Environment.isWindows) bun.WPathBuffer else void = undefined;
                const dst_without_trailing_slash: if (Environment.isWindows) string else void = if (comptime Environment.isWindows)
                    strings.withoutTrailingSlash(destination)
                else {};
                if (comptime Environment.isWindows) {
                    strings.copyU8IntoU16(&destination_buf, dst_without_trailing_slash);
                    destination_buf[dst_without_trailing_slash.len] = std.fs.path.sep;
                }

                var template_path_buf: if (Environment.isWindows) bun.WPathBuffer else void = undefined;
                const src_without_trailing_slash: if (Environment.isWindows) string else void = if (comptime Environment.isWindows)
                    strings.withoutTrailingSlash(abs_template_path)
                else {};
                if (comptime Environment.isWindows) {
                    strings.copyU8IntoU16(&template_path_buf, src_without_trailing_slash);
                    template_path_buf[src_without_trailing_slash.len] = std.fs.path.sep;
                }

                const destination_dir = destination_dir__;
                const Walker = @import("../walker_skippable.zig");
                var walker_ = try Walker.walk(template_dir, ctx.allocator, skip_files, skip_dirs);
                defer walker_.deinit();

                const FileCopier = struct {
                    pub fn copy(
                        destination_dir_: std.fs.Dir,
                        walker: *Walker,
                        node_: *Progress.Node,
                        progress_: *Progress,
                        dst_base_len: if (Environment.isWindows) usize else void,
                        dst_buf: if (Environment.isWindows) *bun.WPathBuffer else void,
                        src_base_len: if (Environment.isWindows) usize else void,
                        src_buf: if (Environment.isWindows) *bun.WPathBuffer else void,
                    ) !void {
                        while (try walker.next()) |entry| {
                            if (comptime Environment.isWindows) {
                                if (entry.kind != .file and entry.kind != .directory) continue;

                                @memcpy(dst_buf[dst_base_len..][0..entry.path.len], entry.path);
                                dst_buf[dst_base_len + entry.path.len] = 0;
                                const dst = dst_buf[0 .. dst_base_len + entry.path.len :0];

                                @memcpy(src_buf[src_base_len..][0..entry.path.len], entry.path);
                                src_buf[src_base_len + entry.path.len] = 0;
                                const src = src_buf[0 .. src_base_len + entry.path.len :0];

                                switch (entry.kind) {
                                    .directory => {
                                        if (bun.windows.CreateDirectoryExW(src.ptr, dst.ptr, null) == 0) {
                                            bun.MakePath.makePath(u16, destination_dir_, entry.path) catch {};
                                        }
                                    },
                                    .file => {
                                        defer node_.completeOne();
                                        if (bun.windows.CopyFileW(src.ptr, dst.ptr, 0) == bun.windows.FALSE) {
                                            if (bun.Dirname.dirname(u16, entry.path)) |entry_dirname| {
                                                bun.MakePath.makePath(u16, destination_dir_, entry_dirname) catch {};
                                                if (bun.windows.CopyFileW(src.ptr, dst.ptr, 0) != bun.windows.FALSE) {
                                                    continue;
                                                }
                                            }

                                            if (bun.windows.Win32Error.get().toSystemErrno()) |err| {
                                                Output.err(err, "failed to copy file {}", .{
                                                    bun.fmt.fmtOSPath(entry.path, .{}),
                                                });
                                            } else {
                                                Output.errGeneric("failed to copy file {}", .{
                                                    bun.fmt.fmtOSPath(entry.path, .{}),
                                                });
                                            }
                                            node_.end();
                                            progress_.refresh();
                                            Global.crash();
                                        }
                                    },
                                    else => unreachable,
                                }

                                continue;
                            }
                            if (entry.kind != .file) continue;

                            var outfile = destination_dir_.createFile(entry.path, .{}) catch brk: {
                                if (bun.Dirname.dirname(bun.OSPathChar, entry.path)) |entry_dirname| {
                                    bun.MakePath.makePath(bun.OSPathChar, destination_dir_, entry_dirname) catch {};
                                }
                                break :brk destination_dir_.createFile(entry.path, .{}) catch |err| {
                                    node_.end();
                                    progress_.refresh();
                                    Output.err(err, "failed to copy file {}", .{bun.fmt.fmtOSPath(entry.path, .{})});
                                    Global.crash();
                                };
                            };
                            defer outfile.close();
                            defer node_.completeOne();

                            var infile = try entry.dir.openFile(entry.basename, .{ .mode = .read_only });
                            defer infile.close();

                            // Assumption: you only really care about making sure something that was executable is still executable
                            switch (bun.sys.fstat(bun.toFD(infile.handle))) {
                                .err => {},
                                .result => |stat| {
                                    _ = bun.sys.fchmod(bun.toFD(outfile.handle), @intCast(stat.mode));
                                },
                            }

                            CopyFile.copyFile(infile.handle, outfile.handle).unwrap() catch |err| {
                                node_.end();
                                progress_.refresh();
                                Output.err(err, "failed to copy file {}", .{bun.fmt.fmtOSPath(entry.path, .{})});
                                Global.crash();
                            };
                        }
                    }
                };

                try FileCopier.copy(
                    destination_dir,
                    &walker_,
                    node,
                    &progress,
                    if (comptime Environment.isWindows) dst_without_trailing_slash.len + 1 else {},
                    if (comptime Environment.isWindows) &destination_buf else {},
                    if (comptime Environment.isWindows) src_without_trailing_slash.len + 1 else {},
                    if (comptime Environment.isWindows) &template_path_buf else {},
                );

                package_json_file = destination_dir.openFile("package.json", .{ .mode = .read_write }) catch null;

                read_package_json: {
                    if (package_json_file) |pkg| {
                        const size = brk: {
                            if (comptime Environment.isWindows) {
                                break :brk try pkg.getEndPos();
                            }

                            const stat = pkg.stat() catch |err| {
                                node.end();

                                progress.refresh();

                                package_json_file = null;
                                Output.prettyErrorln("Error reading package.json: <r><red>{s}", .{@errorName(err)});
                                break :read_package_json;
                            };

                            if (stat.kind != .file or stat.size == 0) {
                                package_json_file = null;
                                node.end();

                                progress.refresh();
                                break :read_package_json;
                            }

                            break :brk stat.size;
                        };

                        package_json_contents = try MutableString.init(ctx.allocator, size);
                        package_json_contents.list.expandToCapacity();

                        const prev_file_pos = if (comptime Environment.isWindows) try pkg.getPos() else 0;
                        _ = pkg.preadAll(package_json_contents.list.items, 0) catch |err| {
                            package_json_file = null;

                            node.end();

                            progress.refresh();

                            Output.prettyErrorln("Error reading package.json: <r><red>{s}", .{@errorName(err)});
                            break :read_package_json;
                        };
                        if (comptime Environment.isWindows) try pkg.seekTo(prev_file_pos);
                        // The printer doesn't truncate, so we must do so manually
                        std.posix.ftruncate(pkg.handle, 0) catch {};

                        initializeStore();
                    }
                }
            },
            else => unreachable,
        }

        node.end();
        progress.refresh();

        const is_nextjs = false;
        const is_create_react_app = false;
        const create_react_app_entry_point_path: string = "";
        var preinstall_tasks = std.mem.zeroes(std.ArrayListUnmanaged([]const u8));
        var postinstall_tasks = std.mem.zeroes(std.ArrayListUnmanaged([]const u8));
        var has_dependencies: bool = false;
        const PATH = env_loader.map.get("PATH") orelse "";

        {
            var parent_dir = try std.fs.openDirAbsolute(destination, .{});
            defer parent_dir.close();
            if (comptime Environment.isWindows) {
                parent_dir.copyFile("gitignore", parent_dir, ".gitignore", .{}) catch {};
            } else {
                std.posix.linkat(parent_dir.fd, "gitignore", parent_dir.fd, ".gitignore", 0) catch {};
            }

            std.posix.unlinkat(
                parent_dir.fd,
                "gitignore",
                0,
            ) catch {};
            std.posix.unlinkat(
                parent_dir.fd,
                ".npmignore",
                0,
            ) catch {};
        }

        var start_command: string = "bun dev";

        process_package_json: {
            if (create_options.skip_package_json) package_json_file = null;

            if (package_json_file != null) {
                initializeStore();

                var source = logger.Source.initPathString("package.json", package_json_contents.list.items);

                var package_json_expr = JSON.parseUTF8(&source, ctx.log, ctx.allocator) catch {
                    package_json_file = null;
                    break :process_package_json;
                };

                if (package_json_expr.data != .e_object) {
                    package_json_file = null;
                    break :process_package_json;
                }

                const properties_list = std.ArrayList(js_ast.G.Property).fromOwnedSlice(default_allocator, package_json_expr.data.e_object.properties.slice());

                if (ctx.log.errors > 0) {
                    try ctx.log.print(Output.errorWriter());

                    package_json_file = null;
                    break :process_package_json;
                }

                if (package_json_expr.asProperty("name")) |name_expr| {
                    if (name_expr.expr.data == .e_string) {
                        const basename = std.fs.path.basename(destination);
                        name_expr.expr.data.e_string.data = @as([*]u8, @ptrFromInt(@intFromPtr(basename.ptr)))[0..basename.len];
                    }
                }

                // const Needs = struct {
                //     bun_bun_for_nextjs: bool = false,
                //     bun_macro_relay: bool = false,
                //     bun_macro_relay_dependency: bool = false,
                //     bun_framework_next: bool = false,
                //     react_refresh: bool = false,
                // };
                // var needs = Needs{};
                // var has_relay = false;
                // var has_bun_framework_next = false;
                // var has_react_refresh = false;
                // var has_bun_macro_relay = false;
                // var has_react = false;
                // var has_react_scripts = false;

                // const Prune = struct {
                //     pub const packages = ComptimeStringMap(void, .{
                //         .{ "@parcel/babel-preset", {} },
                //         .{ "@parcel/core", {} },
                //         .{ "@swc/cli", {} },
                //         .{ "@swc/core", {} },
                //         .{ "@webpack/cli", {} },
                //         .{ "react-scripts", {} },
                //         .{ "webpack-cli", {} },
                //         .{ "webpack", {} },

                //         // one of cosmic config's imports breaks stuff
                //         .{ "cosmiconfig", {} },
                //     });
                //     pub var prune_count: u16 = 0;

                //     pub fn prune(list: []js_ast.G.Property) []js_ast.G.Property {
                //         var i: usize = 0;
                //         var out_i: usize = 0;
                //         while (i < list.len) : (i += 1) {
                //             const key = list[i].key.?.data.e_string.data;

                //             const do_prune = packages.has(key);
                //             prune_count += @as(u16, @intCast(@intFromBool(do_prune)));

                //             if (!do_prune) {
                //                 list[out_i] = list[i];
                //                 out_i += 1;
                //             }
                //         }

                //         return list[0..out_i];
                //     }
                // };

                var dev_dependencies: ?js_ast.Expr = null;
                var dependencies: ?js_ast.Expr = null;

                if (package_json_expr.asProperty("devDependencies")) |q| {
                    const property = q.expr;

                    if (property.data == .e_object and property.data.e_object.properties.len > 0) {
                        // unsupported_packages.update(property);

                        // has_react_scripts = has_react_scripts or property.hasAnyPropertyNamed(&.{"react-scripts"});
                        // has_relay = has_relay or property.hasAnyPropertyNamed(&.{ "react-relay", "relay-runtime", "babel-plugin-relay" });

                        // property.data.e_object.properties = js_ast.G.Property.List.init(Prune.prune(property.data.e_object.properties.slice()));
                        if (property.data.e_object.properties.len > 0) {
                            has_dependencies = true;
                            dev_dependencies = q.expr;

                            // has_bun_framework_next = has_bun_framework_next or property.hasAnyPropertyNamed(&.{"bun-framework-next"});
                            // has_react = has_react or property.hasAnyPropertyNamed(&.{ "react", "react-dom", "react-relay", "@emotion/react" });
                            // has_bun_macro_relay = has_bun_macro_relay or property.hasAnyPropertyNamed(&.{"bun-macro-relay"});
                            // has_react_refresh = has_react_refresh or property.hasAnyPropertyNamed(&.{"react-refresh"});
                        }
                    }
                }

                if (package_json_expr.asProperty("dependencies")) |q| {
                    const property = q.expr;

                    if (property.data == .e_object and property.data.e_object.properties.len > 0) {
                        // unsupported_packages.update(property);

                        // has_react_scripts = has_react_scripts or property.hasAnyPropertyNamed(&.{"react-scripts"});
                        // has_relay = has_relay or property.hasAnyPropertyNamed(&.{ "react-relay", "relay-runtime", "babel-plugin-relay" });
                        // property.data.e_object.properties = js_ast.G.Property.List.init(Prune.prune(property.data.e_object.properties.slice()));
                        property.data.e_object.properties = js_ast.G.Property.List.init(property.data.e_object.properties.slice());

                        if (property.data.e_object.properties.len > 0) {
                            has_dependencies = true;
                            dependencies = q.expr;

                            // if (property.asProperty("next")) |next_q| {
                            // is_nextjs = true;
                            // needs.bun_bun_for_nextjs = true;

                            // next_q.expr.data.e_string.data = @constCast(target_nextjs_version);
                            // }

                            // has_bun_framework_next = has_bun_framework_next or property.hasAnyPropertyNamed(&.{"bun-framework-next"});
                            // has_react = has_react or is_nextjs or property.hasAnyPropertyNamed(&.{ "react", "react-dom", "react-relay", "@emotion/react" });
                            // has_react_refresh = has_react_refresh or property.hasAnyPropertyNamed(&.{"react-refresh"});
                            // has_bun_macro_relay = has_bun_macro_relay or property.hasAnyPropertyNamed(&.{"bun-macro-relay"});
                        }
                    }
                }

                // needs.bun_macro_relay = !has_bun_macro_relay and has_relay;
                // needs.react_refresh = !has_react_refresh and has_react;
                // needs.bun_framework_next = is_nextjs and !has_bun_framework_next;
                // needs.bun_bun_for_nextjs = is_nextjs;
                // needs.bun_macro_relay_dependency = needs.bun_macro_relay;
                // var bun_bun_for_react_scripts = false;

                // var bun_macros_prop: ?js_ast.Expr = null;
                // var bun_prop: ?js_ast.Expr = null;
                // var bun_relay_prop: ?js_ast.Expr = null;

                // var needs_bun_prop = needs.bun_macro_relay or has_bun_macro_relay;
                // var needs_bun_macros_prop = needs_bun_prop;

                // if (needs_bun_macros_prop) {
                //     if (package_json_expr.asProperty("bun")) |bun_| {
                //         needs_bun_prop = false;
                //         bun_prop = bun_.expr;
                //         if (bun_.expr.asProperty("macros")) |macros_q| {
                //             bun_macros_prop = macros_q.expr;
                //             needs_bun_macros_prop = false;
                //             if (macros_q.expr.asProperty("react-relay")) |react_relay_q| {
                //                 bun_relay_prop = react_relay_q.expr;
                //                 needs.bun_macro_relay = react_relay_q.expr.asProperty("graphql") == null;
                //             }

                //             if (macros_q.expr.asProperty("babel-plugin-relay/macro")) |react_relay_q| {
                //                 bun_relay_prop = react_relay_q.expr;
                //                 needs.bun_macro_relay = react_relay_q.expr.asProperty("graphql") == null;
                //             }
                //         }
                //     }
                // }

                // if (Prune.prune_count > 0) {
                //     Output.prettyErrorln("<r><d>[package.json] Pruned {d} unnecessary packages<r>", .{Prune.prune_count});
                // }

                // if (create_options.verbose) {
                // if (needs.bun_macro_relay) {
                //     Output.prettyErrorln("<r><d>[package.json] Detected Relay -> added \"bun-macro-relay\"<r>", .{});
                // }

                // if (needs.react_refresh) {
                //     Output.prettyErrorln("<r><d>[package.json] Detected React -> added \"react-refresh\"<r>", .{});
                // }

                // if (needs.bun_framework_next) {
                //     Output.prettyErrorln("<r><d>[package.json] Detected Next -> added \"bun-framework-next\"<r>", .{});
                // } else if (is_nextjs) {
                //     Output.prettyErrorln("<r><d>[package.json] Detected Next.js<r>", .{});
                // }

                // }

                // var needs_to_inject_dev_dependency = needs.react_refresh or needs.bun_macro_relay;
                // var needs_to_inject_dependency = needs.bun_framework_next;

                // const dependencies_to_inject_count = @as(usize, @intCast(@intFromBool(needs.bun_framework_next)));

                // const dev_dependencies_to_inject_count = @as(usize, @intCast(@intFromBool(needs.react_refresh))) +
                //     @as(usize, @intCast(@intFromBool(needs.bun_macro_relay)));

                // const new_properties_count = @as(usize, @intCast(@intFromBool(needs_to_inject_dev_dependency and dev_dependencies == null))) +
                //     @as(usize, @intCast(@intFromBool(needs_to_inject_dependency and dependencies == null))) +
                //     @as(usize, @intCast(@intFromBool(needs_bun_prop)));

                // if (new_properties_count != 0) {
                //     try properties_list.ensureUnusedCapacity(new_properties_count);
                // }

                const E = js_ast.E;

                const InjectionPrefill = struct {
                    const dependencies_string = "dependencies";
                    const dev_dependencies_string = "devDependencies";
                    const bun_string = "bun";
                    const macros_string = "macros";
                    const bun_macros_relay_path = "bun-macro-relay";

                    pub var dependencies_e_string = E.String.init(dependencies_string);
                    pub var devDependencies_e_string = E.String.init(dev_dependencies_string);
                    pub var bun_e_string = E.String.init(bun_string);
                    pub var macros_e_string = E.String.init(macros_string);
                    pub var react_relay_string = E.String.init("react-relay");
                    pub var bun_macros_relay_path_string = E.String.init("bun-macro-relay");
                    pub var babel_plugin_relay_macro = E.String.init("babel-plugin-relay/macro");
                    pub var babel_plugin_relay_macro_js = E.String.init("babel-plugin-relay/macro.js");
                    pub var graphql_string = E.String.init("graphql");

                    var npx_react_scripts_build_str = E.String.init("npx react-scripts build");

                    pub const npx_react_scripts_build = js_ast.Expr{ .data = .{ .e_string = &npx_react_scripts_build_str }, .loc = logger.Loc.Empty };

                    var bun_macro_relay_properties = [_]js_ast.G.Property{
                        js_ast.G.Property{
                            .key = js_ast.Expr{
                                .data = .{
                                    .e_string = &graphql_string,
                                },
                                .loc = logger.Loc.Empty,
                            },
                            .value = js_ast.Expr{
                                .data = .{
                                    .e_string = &bun_macros_relay_path_string,
                                },
                                .loc = logger.Loc.Empty,
                            },
                        },
                    };

                    var bun_macro_relay_object = js_ast.E.Object{
                        .properties = undefined,
                    };

                    var bun_macros_relay_object_properties = [_]js_ast.G.Property{
                        js_ast.G.Property{
                            .key = js_ast.Expr{
                                .data = .{
                                    .e_string = &react_relay_string,
                                },
                                .loc = logger.Loc.Empty,
                            },
                            .value = js_ast.Expr{
                                .data = .{
                                    .e_object = &bun_macro_relay_object,
                                },
                                .loc = logger.Loc.Empty,
                            },
                        },
                        js_ast.G.Property{
                            .key = js_ast.Expr{
                                .data = .{
                                    .e_string = &babel_plugin_relay_macro,
                                },
                                .loc = logger.Loc.Empty,
                            },
                            .value = js_ast.Expr{
                                .data = .{
                                    .e_object = &bun_macro_relay_object,
                                },
                                .loc = logger.Loc.Empty,
                            },
                        },
                        js_ast.G.Property{
                            .key = js_ast.Expr{
                                .data = .{
                                    .e_string = &babel_plugin_relay_macro_js,
                                },
                                .loc = logger.Loc.Empty,
                            },
                            .value = js_ast.Expr{
                                .data = .{
                                    .e_object = &bun_macro_relay_object,
                                },
                                .loc = logger.Loc.Empty,
                            },
                        },
                    };

                    pub var bun_macros_relay_object = E.Object{
                        .properties = undefined,
                    };

                    var bun_macros_relay_only_object_string = js_ast.E.String.init("macros");
                    pub var bun_macros_relay_only_object_properties = [_]js_ast.G.Property{
                        js_ast.G.Property{
                            .key = js_ast.Expr{
                                .data = .{
                                    .e_string = &bun_macros_relay_only_object_string,
                                },
                                .loc = logger.Loc.Empty,
                            },
                            .value = js_ast.Expr{
                                .data = .{
                                    .e_object = &bun_macros_relay_object,
                                },
                                .loc = logger.Loc.Empty,
                            },
                        },
                    };
                    pub var bun_macros_relay_only_object = E.Object{ .properties = undefined };

                    var bun_only_macros_string = js_ast.E.String.init("bun");
                    pub var bun_only_macros_relay_property = js_ast.G.Property{
                        .key = js_ast.Expr{
                            .data = .{
                                .e_string = &bun_only_macros_string,
                            },
                            .loc = logger.Loc.Empty,
                        },
                        .value = js_ast.Expr{
                            .data = .{
                                .e_object = &bun_macros_relay_only_object,
                            },
                            .loc = logger.Loc.Empty,
                        },
                    };

                    pub var bun_framework_next_string = js_ast.E.String.init("bun-framework-next");
                    pub var bun_framework_next_version = js_ast.E.String.init("latest");
                    pub var bun_framework_next_property = js_ast.G.Property{
                        .key = js_ast.Expr{
                            .data = .{
                                .e_string = &bun_framework_next_string,
                            },
                            .loc = logger.Loc.Empty,
                        },
                        .value = js_ast.Expr{
                            .data = .{
                                .e_string = &bun_framework_next_version,
                            },
                            .loc = logger.Loc.Empty,
                        },
                    };

                    pub var bun_macro_relay_dependency_string = js_ast.E.String.init("bun-macro-relay");
                    pub var bun_macro_relay_dependency_version = js_ast.E.String.init("latest");

                    pub var bun_macro_relay_dependency = js_ast.G.Property{
                        .key = js_ast.Expr{
                            .data = .{
                                .e_string = &bun_macro_relay_dependency_string,
                            },
                            .loc = logger.Loc.Empty,
                        },
                        .value = js_ast.Expr{
                            .data = .{
                                .e_string = &bun_macro_relay_dependency_version,
                            },
                            .loc = logger.Loc.Empty,
                        },
                    };

                    pub var refresh_runtime_string = js_ast.E.String.init("react-refresh");
                    pub var refresh_runtime_version = js_ast.E.String.init("0.10.0");
                    pub var react_refresh_dependency = js_ast.G.Property{
                        .key = js_ast.Expr{
                            .data = .{
                                .e_string = &refresh_runtime_string,
                            },
                            .loc = logger.Loc.Empty,
                        },
                        .value = js_ast.Expr{
                            .data = .{
                                .e_string = &refresh_runtime_version,
                            },
                            .loc = logger.Loc.Empty,
                        },
                    };

                    pub var dev_dependencies_key = js_ast.Expr{
                        .data = .{
                            .e_string = &devDependencies_e_string,
                        },
                        .loc = logger.Loc.Empty,
                    };
                    pub var dependencies_key = js_ast.Expr{
                        .data = .{ .e_string = &dependencies_e_string },
                        .loc = logger.Loc.Empty,
                    };

                    pub const bun_bun_for_nextjs_task: string = "bun bun --use next";
                };

                InjectionPrefill.bun_macro_relay_object.properties = js_ast.G.Property.List.init(InjectionPrefill.bun_macro_relay_properties[0..]);
                InjectionPrefill.bun_macros_relay_object.properties = js_ast.G.Property.List.init(&InjectionPrefill.bun_macros_relay_object_properties);
                InjectionPrefill.bun_macros_relay_only_object.properties = js_ast.G.Property.List.init(&InjectionPrefill.bun_macros_relay_only_object_properties);

                // if (needs_to_inject_dev_dependency and dev_dependencies == null) {
                //     var e_object = try ctx.allocator.create(E.Object);

                //     e_object.* = E.Object{};

                //     const value = js_ast.Expr{ .data = .{ .e_object = e_object }, .loc = logger.Loc.Empty };
                //     properties_list.appendAssumeCapacity(js_ast.G.Property{
                //         .key = InjectionPrefill.dev_dependencies_key,
                //         .value = value,
                //     });
                //     dev_dependencies = value;
                // }

                // if (needs_to_inject_dependency and dependencies == null) {
                //     var e_object = try ctx.allocator.create(E.Object);

                //     e_object.* = E.Object{};

                //     const value = js_ast.Expr{ .data = .{ .e_object = e_object }, .loc = logger.Loc.Empty };
                //     properties_list.appendAssumeCapacity(js_ast.G.Property{
                //         .key = InjectionPrefill.dependencies_key,
                //         .value = value,
                //     });
                //     dependencies = value;
                // }

                // inject an object like this, handling each permutation of what may or may not exist:
                // {
                //    "bun": {
                //       "macros": {
                //          "react-relay": {
                //              "graphql": "bun-macro-relay"
                //          }
                //        }
                //    }
                // }
                // bun_section: {

                // "bun.macros.react-relay.graphql"
                // if (needs.bun_macro_relay and !needs_bun_prop and !needs_bun_macros_prop) {
                //     // "graphql" is the only valid one for now, so anything else in this object is invalid.
                //     bun_relay_prop.?.data.e_object = InjectionPrefill.bun_macros_relay_object.properties.ptr[0].value.?.data.e_object;
                //     needs_bun_macros_prop = false;
                //     needs_bun_prop = false;
                //     needs.bun_macro_relay = false;
                //     break :bun_section;
                // }

                // "bun.macros"
                // if (needs_bun_macros_prop and !needs_bun_prop) {
                //     var obj = bun_prop.?.data.e_object;
                //     var properties = try std.ArrayList(js_ast.G.Property).initCapacity(
                //         ctx.allocator,
                //         obj.properties.len + InjectionPrefill.bun_macros_relay_object.properties.len,
                //     );
                //     defer obj.properties.update(properties);

                //     try properties.insertSlice(0, obj.properties.slice());
                //     try properties.insertSlice(0, InjectionPrefill.bun_macros_relay_object.properties.slice());

                //     needs_bun_macros_prop = false;
                //     needs_bun_prop = false;
                //     needs.bun_macro_relay = false;
                //     break :bun_section;
                // }

                // "bun"
                // if (needs_bun_prop) {
                //     try properties_list.append(InjectionPrefill.bun_only_macros_relay_property);
                //     needs_bun_macros_prop = false;
                //     needs_bun_prop = false;
                //     needs.bun_macro_relay = false;
                //     break :bun_section;
                // }
                // }

                // if (needs_to_inject_dependency) {
                //     defer needs_to_inject_dependency = false;
                //     var obj = dependencies.?.data.e_object;
                //     var properties = try std.ArrayList(js_ast.G.Property).initCapacity(
                //         ctx.allocator,
                //         obj.properties.len + dependencies_to_inject_count,
                //     );
                //     try properties.insertSlice(0, obj.properties.slice());
                //     defer obj.properties.update(properties);
                //     if (needs.bun_framework_next) {
                //         properties.appendAssumeCapacity(InjectionPrefill.bun_framework_next_property);
                //         needs.bun_framework_next = false;
                //     }
                // }

                // if (needs_to_inject_dev_dependency) {
                //     defer needs_to_inject_dev_dependency = false;
                //     var obj = dev_dependencies.?.data.e_object;
                //     var properties = try std.ArrayList(js_ast.G.Property).initCapacity(
                //         ctx.allocator,
                //         obj.properties.len + dev_dependencies_to_inject_count,
                //     );
                //     try properties.insertSlice(0, obj.properties.slice());
                //     defer obj.properties.update(properties);
                //     if (needs.bun_macro_relay_dependency) {
                //         properties.appendAssumeCapacity(InjectionPrefill.bun_macro_relay_dependency);
                //         needs.bun_macro_relay_dependency = false;
                //     }

                //     if (needs.react_refresh) {
                //         properties.appendAssumeCapacity(InjectionPrefill.react_refresh_dependency);
                //         needs.react_refresh = false;
                //     }
                // }

                // this is a little dicey
                // The idea is:
                // Before the closing </body> tag of Create React App's public/index.html
                // Inject "<script type="module" src="/src/index.js" async></script>"
                // Only do this for create-react-app
                // Which we define as:
                // 1. has a "public/index.html"
                // 2. "react-scripts" in package.json dependencies or devDependencies
                // 3. has a src/index.{jsx,tsx,ts,mts,mcjs}
                // If at any point those expectations are not matched OR the string /src/index.js already exists in the HTML
                // don't do it!
                // if (has_react_scripts) {
                //     bail: {
                //         var public_index_html_parts = [_]string{ destination, "public/index.html" };
                //         var public_index_html_path = filesystem.absBuf(&public_index_html_parts, &bun_path_buf);

                //         const public_index_html_file = std.fs.openFileAbsolute(public_index_html_path, .{ .mode = .read_write }) catch break :bail;
                //         defer public_index_html_file.close();

                //         const file_extensions_to_try = [_]string{ ".tsx", ".ts", ".jsx", ".js", ".mts", ".mcjs" };

                //         var found_file = false;
                //         var entry_point_path: string = "";
                //         var entry_point_file_parts = [_]string{ destination, "src/index" };
                //         var entry_point_file_path_base = filesystem.absBuf(&entry_point_file_parts, &bun_path_buf);

                //         for (file_extensions_to_try) |ext| {
                //             bun.copy(u8, bun_path_buf[entry_point_file_path_base.len..], ext);
                //             entry_point_path = bun_path_buf[0 .. entry_point_file_path_base.len + ext.len];
                //             std.fs.accessAbsolute(entry_point_path, .{}) catch continue;
                //             found_file = true;
                //             break;
                //         }
                //         if (!found_file) break :bail;

                //         var public_index_file_contents = public_index_html_file.readToEndAlloc(ctx.allocator, public_index_html_file.getEndPos() catch break :bail) catch break :bail;

                //         if (std.mem.indexOf(u8, public_index_file_contents, entry_point_path[destination.len..]) != null) {
                //             break :bail;
                //         }

                //         var body_closing_tag: usize = std.mem.lastIndexOf(u8, public_index_file_contents, "</body>") orelse break :bail;

                //         var public_index_file_out = std.ArrayList(u8).initCapacity(ctx.allocator, public_index_file_contents.len) catch break :bail;
                //         var html_writer = public_index_file_out.writer();

                //         _ = html_writer.writeAll(public_index_file_contents[0..body_closing_tag]) catch break :bail;

                //         create_react_app_entry_point_path = std.fmt.allocPrint(
                //             ctx.allocator,
                //             "./{s}",

                //             .{
                //                 std.mem.trimLeft(
                //                     u8,
                //                     entry_point_path[destination.len..],
                //                     "/",
                //                 ),
                //             },
                //         ) catch break :bail;

                //         html_writer.print(
                //             "<script type=\"module\" async src=\"/{s}\"></script>\n{s}",
                //             .{
                //                 create_react_app_entry_point_path[2..],
                //                 public_index_file_contents[body_closing_tag..],
                //             },
                //         ) catch break :bail;

                //         var outfile = std.mem.replaceOwned(u8, ctx.allocator, public_index_file_out.items, "%PUBLIC_URL%", "") catch break :bail;

                //         // don't do this actually
                //         // it completely breaks when there is more than one CSS file loaded
                //         // // bonus: check for an index.css file
                //         // // inject it into the .html file statically if the file exists but isn't already in
                //         // inject_css: {
                //         //     const head_i: usize = std.mem.indexOf(u8, outfile, "<head>") orelse break :inject_css;
                //         //     if (std.mem.indexOf(u8, outfile, "/src/index.css") != null) break :inject_css;

                //         //     bun.copy(u8, bun_path_buf[destination.len + "/src/index".len ..], ".css");
                //         //     var index_css_file_path = bun_path_buf[0 .. destination.len + "/src/index.css".len];
                //         //     std.fs.accessAbsolute(index_css_file_path, .{}) catch break :inject_css;
                //         //     var list = std.ArrayList(u8).fromOwnedSlice(ctx.allocator, outfile);
                //         //     list.insertSlice(head_i + "<head>".len, "<link rel=\"stylesheet\" href=\"/src/index.css\">\n") catch break :inject_css;
                //         //     outfile =try list.toOwnedSlice();
                //         // }

                //         public_index_html_file.pwriteAll(outfile, 0) catch break :bail;
                //         std.posix.ftruncate(public_index_html_file.handle, outfile.len + 1) catch break :bail;
                //         bun_bun_for_react_scripts = true;
                //         is_create_react_app = true;
                //         Output.prettyln("<r><d>[package.json] Added entry point {s} to public/index.html", .{create_react_app_entry_point_path});
                //     }
                // }

                package_json_expr.data.e_object.is_single_line = false;

                package_json_expr.data.e_object.properties = js_ast.G.Property.List.fromList(properties_list);
                {
                    var i: usize = 0;
                    var property_i: usize = 0;
                    while (i < package_json_expr.data.e_object.properties.len) : (i += 1) {
                        const property: js_ast.G.Property = package_json_expr.data.e_object.properties.ptr[i];
                        const key = property.key.?.asString(ctx.allocator).?;

                        if (strings.eqlComptime(key, "scripts")) {
                            if (property.value.?.data == .e_object) {
                                var scripts_properties = property.value.?.data.e_object.properties.slice();

                                // if they're starting the app with "react-scripts start" or "next dev", that won't make sense
                                // if they launch with npm run start it will just be slower
                                var script_property_i: usize = 0;
                                var script_property_out_i: usize = 0;

                                while (script_property_i < scripts_properties.len) : (script_property_i += 1) {
                                    const script = scripts_properties[script_property_i].value.?.data.e_string.data;

                                    if (strings.contains(script, "react-scripts start") or
                                        strings.contains(script, "next dev") or
                                        strings.contains(script, "react-scripts eject"))
                                    {
                                        if (create_options.verbose) {
                                            Output.prettyErrorln("<r><d>[package.json] Pruned unnecessary script: {s}<r>", .{script});
                                        }

                                        continue;
                                    }

                                    if (strings.contains(script, "react-scripts build")) {
                                        scripts_properties[script_property_i].value = InjectionPrefill.npx_react_scripts_build;
                                    }

                                    scripts_properties[script_property_out_i] = scripts_properties[script_property_i];
                                    script_property_out_i += 1;
                                }

                                property.value.?.data.e_object.properties = js_ast.G.Property.List.init(scripts_properties[0..script_property_out_i]);
                            }
                        }

                        if (key.len == 0 or !strings.eqlComptime(key, "bun-create")) {
                            package_json_expr.data.e_object.properties.ptr[property_i] = property;
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
                                    const items = tasks.slice();
                                    for (items) |task| {
                                        if (task.asString(ctx.allocator)) |task_entry| {
                                            // if (needs.bun_bun_for_nextjs or bun_bun_for_react_scripts) {
                                            //     var iter = std.mem.split(u8, task_entry, " ");
                                            //     var last_was_bun = false;
                                            //     while (iter.next()) |current| {
                                            //         if (strings.eqlComptime(current, "bun")) {
                                            //             if (last_was_bun) {
                                            //                 needs.bun_bun_for_nextjs = false;
                                            //                 bun_bun_for_react_scripts = false;
                                            //                 break;
                                            //             }
                                            //             last_was_bun = true;
                                            //         }
                                            //     }
                                            // }

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
                                    for (tasks.items.slice()) |task| {
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

                        if (value.asProperty("start")) |start| {
                            if (start.expr.asString(ctx.allocator)) |start_str| {
                                if (start_str.len > 0) {
                                    start_command = start_str;
                                }
                            }
                        }
                    }
                    package_json_expr.data.e_object.properties = js_ast.G.Property.List.init(package_json_expr.data.e_object.properties.ptr[0..property_i]);
                }

                const package_json_writer = JSPrinter.NewFileWriter(package_json_file.?);

                const written = JSPrinter.printJSON(@TypeOf(package_json_writer), package_json_writer, package_json_expr, &source, .{}) catch |err| {
                    Output.prettyErrorln("package.json failed to write due to error {s}", .{@errorName(err)});
                    package_json_file = null;
                    break :process_package_json;
                };

                std.posix.ftruncate(package_json_file.?.handle, written + 1) catch {};

                // if (!create_options.skip_install) {
                //     if (needs.bun_bun_for_nextjs) {
                //         try postinstall_tasks.append(ctx.allocator, InjectionPrefill.bun_bun_for_nextjs_task);
                //     } else if (bun_bun_for_react_scripts) {
                //         try postinstall_tasks.append(ctx.allocator, try std.fmt.allocPrint(ctx.allocator, "bun bun {s}", .{create_react_app_entry_point_path}));
                //     }
                // }
            }
        }

        if (create_options.verbose) {
            Output.prettyErrorln("Has dependencies? {d}", .{@intFromBool(has_dependencies)});
        }

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
            npm_client_ = NPMClient{
                .tag = .bun,
                .bin = try bun.selfExePath(),
            };
        }

        if (npm_client_ != null and preinstall_tasks.items.len > 0) {
            for (preinstall_tasks.items) |task| {
                execTask(ctx.allocator, task, destination, PATH, npm_client_.?);
            }
        }

        if (npm_client_) |npm_client| {
            const start_time = std.time.nanoTimestamp();
            const install_args = &[_]string{ npm_client.bin, "install" };
            Output.flush();
            Output.pretty("\n<r><d>$ <b><cyan>{s}<r><d> install", .{@tagName(npm_client.tag)});

            if (install_args.len > 2) {
                for (install_args[2..]) |arg| {
                    Output.pretty(" ", .{});
                    Output.pretty("{s}", .{arg});
                }
            }

            Output.pretty("<r>\n", .{});
            Output.flush();
            defer {
                Output.printErrorln("\n", .{});
                Output.printStartEnd(start_time, std.time.nanoTimestamp());
                Output.prettyError(" <r><d>{s} install<r>\n", .{@tagName(npm_client.tag)});
                Output.flush();

                Output.print("\n", .{});
                Output.flush();
            }

            const process = try bun.spawnSync(&.{
                .argv = install_args,
                .envp = null,
                .cwd = destination,
                .stderr = .inherit,
                .stdout = .inherit,
                .stdin = .inherit,

                .windows = if (Environment.isWindows) .{
                    .loop = bun.JSC.EventLoopHandle.init(bun.JSC.MiniEventLoop.initGlobal(null)),
                } else {},
            });
            _ = try process.unwrap();
        }

        if (postinstall_tasks.items.len > 0) {
            for (postinstall_tasks.items) |task| {
                execTask(ctx.allocator, task, destination, PATH, npm_client_);
            }
        }

        if (!create_options.skip_install and !create_options.skip_git) {
            create_options.skip_git = !GitHandler.wait();
        }

        Output.printError("\n", .{});
        Output.printStartEnd(ctx.start_time, std.time.nanoTimestamp());
        Output.prettyErrorln(" <r><d>bun create {s}<r>", .{template});

        Output.flush();

        Output.pretty(
            \\
            \\<d>Come hang out in bun's Discord: https://bun.sh/discord<r>
            \\
        , .{});

        if (!create_options.skip_install) {
            Output.pretty(
                \\
                \\<r><d>-----<r>
                \\
            , .{});
            Output.flush();
        }

        // if (unsupported_packages.@"styled-jsx") {
        //     Output.prettyErrorln("\n", .{});
        //     unsupported_packages.print();
        //     Output.prettyErrorln("\n", .{});
        //     Output.flush();
        // }

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

        if (example_tag == .github_repository) {
            var display_name = template;

            if (std.mem.indexOfScalar(u8, display_name, '/')) |first_slash| {
                if (std.mem.indexOfScalar(u8, display_name[first_slash + 1 ..], '/')) |second_slash| {
                    display_name = template[0 .. first_slash + 1 + second_slash];
                }
            }

            Output.pretty(
                \\
                \\<b><green>Success!<r> <b>{s}<r> loaded into <b>{s}<r>
                \\
            , .{ display_name, std.fs.path.basename(destination) });
        } else {
            Output.pretty(
                \\
                \\<b>Created <green>{s}<r> project successfully
                \\
            , .{std.fs.path.basename(template)});
        }

        if (is_nextjs) {
            Output.pretty(
                \\
                \\<r><d>#<r> When dependencies change, run this to update node_modules.bun:
                \\
                \\  <b><cyan>bun bun --use next<r>
                \\
            , .{});
        } else if (is_create_react_app) {
            Output.pretty(
                \\
                \\<r><d>#<r> When dependencies change, run this to update node_modules.bun:
                \\
                \\  <b><cyan>bun bun {s}<r>
                \\
            , .{create_react_app_entry_point_path});
        }

        const rel_destination = filesystem.relativeTo(destination);
        const is_empty_destination = rel_destination.len == 0;

        if (is_empty_destination) {
            Output.pretty(
                \\
                \\<d>#<r><b> To get started, run:<r>
                \\
                \\  <b><cyan>{s}<r>
                \\
                \\
            , .{
                start_command,
            });
        } else {
            Output.pretty(
                \\
                \\<d>#<r><b> To get started, run:<r>
                \\
                \\  <b><cyan>cd {s}<r>
                \\  <b><cyan>{s}<r>
                \\
                \\
            , .{
                rel_destination,
                start_command,
            });
        }

        Output.flush();

        if (create_options.open) {
            if (which(&bun_path_buf, PATH, destination, "bun")) |bin| {
                var argv = [_]string{bun.asByteSlice(bin)};
                var child = std.process.Child.init(&argv, ctx.allocator);
                child.cwd = destination;
                child.stdin_behavior = .Inherit;
                child.stdout_behavior = .Inherit;
                child.stderr_behavior = .Inherit;

                const open = @import("../open.zig");
                open.openURL("http://localhost:3000/");

                try child.spawn();
                _ = child.wait() catch {};
            }
        }
    }
    pub fn extractInfo(ctx: Command.Context) !struct { example_tag: Example.Tag, template: []const u8 } {
        var example_tag = Example.Tag.unknown;
        var filesystem = try fs.FileSystem.init(null);

        const create_options = try CreateOptions.parse(ctx);
        const positionals = create_options.positionals;
        if (positionals.len == 0) {
            bun.CLI.Command.Tag.printHelp(.CreateCommand, false);
            Global.crash();
        }

        var env_loader: DotEnv.Loader = brk: {
            const map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };

        env_loader.loadProcess();

        // var unsupported_packages = UnsupportedPackages{};
        const template = brk: {
            var positional = positionals[0];

            if (!std.fs.path.isAbsolute(positional)) {
                outer: {
                    if (env_loader.map.get("BUN_CREATE_DIR")) |home_dir| {
                        var parts = [_]string{ home_dir, positional };
                        const outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                        home_dir_buf[outdir_path.len] = 0;
                        const outdir_path_ = home_dir_buf[0..outdir_path.len :0];
                        if (bun.path.hasAnyIllegalChars(outdir_path_)) break :outer;
                        std.fs.accessAbsoluteZ(outdir_path_, .{}) catch break :outer;
                        example_tag = Example.Tag.local_folder;
                        break :brk outdir_path;
                    }
                }

                outer: {
                    var parts = [_]string{ filesystem.top_level_dir, BUN_CREATE_DIR, positional };
                    const outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                    home_dir_buf[outdir_path.len] = 0;
                    const outdir_path_ = home_dir_buf[0..outdir_path.len :0];
                    if (bun.path.hasAnyIllegalChars(outdir_path_)) break :outer;
                    std.fs.accessAbsoluteZ(outdir_path_, .{}) catch break :outer;
                    example_tag = Example.Tag.local_folder;
                    break :brk outdir_path;
                }

                outer: {
                    if (env_loader.map.get("HOME")) |home_dir| {
                        var parts = [_]string{ home_dir, BUN_CREATE_DIR, positional };
                        const outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                        home_dir_buf[outdir_path.len] = 0;
                        const outdir_path_ = home_dir_buf[0..outdir_path.len :0];
                        if (bun.path.hasAnyIllegalChars(outdir_path_)) break :outer;
                        std.fs.accessAbsoluteZ(outdir_path_, .{}) catch break :outer;
                        example_tag = Example.Tag.local_folder;
                        break :brk outdir_path;
                    }
                }

                if (std.fs.path.isAbsolute(positional)) {
                    example_tag = Example.Tag.local_folder;
                    break :brk positional;
                }

                var repo_begin: usize = std.math.maxInt(usize);
                // "https://github.com/foo/bar"
                if (strings.startsWith(positional, "github.com/")) {
                    repo_begin = "github.com/".len;
                }

                if (strings.startsWith(positional, "https://github.com/")) {
                    repo_begin = "https://github.com/".len;
                }

                if (repo_begin == std.math.maxInt(usize) and positional[0] != '/') {
                    if (std.mem.indexOfScalar(u8, positional, '/')) |first_slash_index| {
                        if (std.mem.indexOfScalar(u8, positional, '/')) |last_slash_index| {
                            if (first_slash_index == last_slash_index and
                                positional[last_slash_index..].len > 0 and
                                last_slash_index > 0)
                            {
                                repo_begin = 0;
                            }
                        }
                    }
                }

                if (repo_begin != std.math.maxInt(usize)) {
                    const remainder = positional[repo_begin..];
                    if (std.mem.indexOfScalar(u8, remainder, '/')) |i| {
                        if (i > 0 and remainder[i + 1 ..].len > 0) {
                            if (std.mem.indexOfScalar(u8, remainder[i + 1 ..], '/')) |last_slash| {
                                example_tag = Example.Tag.github_repository;
                                break :brk std.mem.trim(u8, remainder[0 .. i + 1 + last_slash], "# \r\t");
                            } else {
                                example_tag = Example.Tag.github_repository;
                                break :brk std.mem.trim(u8, remainder, "# \r\t");
                            }
                        }
                    }
                }
            }
            example_tag = Example.Tag.official;
            break :brk positional;
        };
        return .{ .example_tag = example_tag, .template = template };
    }
};
const Commands = .{
    &[_]string{""},
    &[_]string{""},
    &[_]string{""},
};
const picohttp = bun.picohttp;

pub const DownloadedExample = struct {
    tarball_bytes: MutableString,
    example: Example,
};

pub const Example = struct {
    name: string,
    version: string,
    description: string,
    local: bool = false,

    pub const Tag = enum {
        unknown,
        github_repository,
        official,
        local_folder,
    };

    const examples_url: string = "https://registry.npmjs.org/bun-examples-all/latest";
    var url: URL = undefined;

    var app_name_buf: [512]u8 = undefined;
    pub fn print(examples: []const Example, default_app_name: ?string) void {
        for (examples) |example| {
            const app_name = default_app_name orelse (std.fmt.bufPrint(&app_name_buf, "./{s}-app", .{example.name[0..@min(example.name.len, 492)]}) catch unreachable);

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

    pub fn fetchAllLocalAndRemote(ctx: Command.Context, node: ?*Progress.Node, env_loader: *DotEnv.Loader, filesystem: *fs.FileSystem) !std.ArrayList(Example) {
        const remote_examples = try Example.fetchAll(ctx, env_loader, node);
        if (node) |node_| node_.end();

        var examples = std.ArrayList(Example).fromOwnedSlice(ctx.allocator, remote_examples);
        {
            var folders = [3]std.fs.Dir{
                bun.invalid_fd.asDir(),
                bun.invalid_fd.asDir(),
                bun.invalid_fd.asDir(),
            };
            if (env_loader.map.get("BUN_CREATE_DIR")) |home_dir| {
                var parts = [_]string{home_dir};
                const outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                folders[0] = std.fs.cwd().openDir(outdir_path, .{}) catch bun.invalid_fd.asDir();
            }

            {
                var parts = [_]string{ filesystem.top_level_dir, BUN_CREATE_DIR };
                const outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                folders[1] = std.fs.cwd().openDir(outdir_path, .{}) catch bun.invalid_fd.asDir();
            }

            if (env_loader.map.get(bun.DotEnv.home_env)) |home_dir| {
                var parts = [_]string{ home_dir, BUN_CREATE_DIR };
                const outdir_path = filesystem.absBuf(&parts, &home_dir_buf);
                folders[2] = std.fs.cwd().openDir(outdir_path, .{}) catch bun.invalid_fd.asDir();
            }

            // subfolders with package.json
            for (folders) |folder| {
                if (folder.fd != bun.invalid_fd.cast()) {
                    var iter = folder.iterate();

                    loop: while (iter.next() catch null) |entry_| {
                        const entry: std.fs.Dir.Entry = entry_;

                        switch (entry.kind) {
                            .directory => {
                                inline for (skip_dirs) |skip_dir| {
                                    if (strings.eqlComptime(entry.name, comptime bun.pathLiteral(skip_dir))) {
                                        continue :loop;
                                    }
                                }

                                bun.copy(u8, &home_dir_buf, entry.name);
                                home_dir_buf[entry.name.len] = std.fs.path.sep;
                                bun.copy(u8, home_dir_buf[entry.name.len + 1 ..], "package.json");
                                home_dir_buf[entry.name.len + 1 + "package.json".len] = 0;

                                const path: [:0]u8 = home_dir_buf[0 .. entry.name.len + 1 + "package.json".len :0];

                                folder.accessZ(path, .{ .mode = .read_only }) catch continue :loop;

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

    var github_repository_url_buf: [1024]u8 = undefined;
    pub fn fetchFromGitHub(
        ctx: Command.Context,
        env_loader: *DotEnv.Loader,
        name: string,
        refresher: *Progress,
        progress: *Progress.Node,
    ) !MutableString {
        const owner_i = std.mem.indexOfScalar(u8, name, '/').?;
        const owner = name[0..owner_i];
        var repository = name[owner_i + 1 ..];

        if (std.mem.indexOfScalar(u8, repository, '/')) |i| {
            repository = repository[0..i];
        }

        progress.name = try ProgressBuf.pretty("<d>[github] <b>GET<r> <blue>{s}/{s}<r>", .{ owner, repository });
        refresher.refresh();

        var github_api_domain: string = "api.github.com";
        if (env_loader.map.get("GITHUB_API_DOMAIN")) |api_domain| {
            if (api_domain.len > 0) {
                github_api_domain = api_domain;
            }
        }

        const api_url = URL.parse(
            try std.fmt.bufPrint(
                &github_repository_url_buf,
                "https://{s}/repos/{s}/{s}/tarball",
                .{ github_api_domain, owner, repository },
            ),
        );

        var header_entries: Headers.Entries = .{};
        var headers_buf: string = "";

        if (env_loader.map.get("GITHUB_TOKEN") orelse env_loader.map.get("GITHUB_ACCESS_TOKEN")) |access_token| {
            if (access_token.len > 0) {
                headers_buf = try std.fmt.allocPrint(ctx.allocator, "AuthorizationBearer {s}", .{access_token});
                try header_entries.append(
                    ctx.allocator,
                    Headers.Kv{
                        .name = Api.StringPointer{
                            .offset = 0,
                            .length = @as(u32, @intCast("Authorization".len)),
                        },
                        .value = Api.StringPointer{
                            .offset = @as(u32, @intCast("Authorization".len)),
                            .length = @as(u32, @intCast(headers_buf.len - "Authorization".len)),
                        },
                    },
                );
            }
        }

        const http_proxy: ?URL = env_loader.getHttpProxyFor(api_url);
        const mutable = try ctx.allocator.create(MutableString);
        mutable.* = try MutableString.init(ctx.allocator, 8192);

        // ensure very stable memory address
        var async_http: *HTTP.AsyncHTTP = ctx.allocator.create(HTTP.AsyncHTTP) catch unreachable;
        async_http.* = HTTP.AsyncHTTP.initSync(
            ctx.allocator,
            .GET,
            api_url,
            header_entries,
            headers_buf,
            mutable,
            "",
            http_proxy,
            null,
            HTTP.FetchRedirect.follow,
        );
        async_http.client.progress_node = progress;
        async_http.client.flags.reject_unauthorized = env_loader.getTLSRejectUnauthorized();

        const response = try async_http.sendSync();

        switch (response.status_code) {
            404 => return error.GitHubRepositoryNotFound,
            403 => return error.HTTPForbidden,
            429 => return error.HTTPTooManyRequests,
            499...599 => return error.NPMIsDown,
            200 => {},
            else => return error.HTTPError,
        }

        var is_expected_content_type = false;
        var content_type: string = "";
        for (response.headers.list) |header| {
            if (strings.eqlCaseInsensitiveASCII(header.name, "content-type", true)) {
                content_type = header.value;

                if (strings.eqlComptime(header.value, "application/x-gzip")) {
                    is_expected_content_type = true;
                    break;
                }
            }
        }

        if (!is_expected_content_type) {
            progress.end();
            refresher.refresh();

            if (content_type.len > 0) {
                Output.prettyErrorln("<r><red>error<r>: Unexpected content type from GitHub: {s}", .{content_type});
                Global.crash();
            } else {
                Output.prettyErrorln("<r><red>error<r>: Invalid response from GitHub (missing content type)", .{});
                Global.crash();
            }
        }

        if (mutable.list.items.len == 0) {
            progress.end();
            refresher.refresh();

            Output.prettyErrorln("<r><red>error<r>: Invalid response from GitHub (missing body)", .{});
            Global.crash();
        }

        return mutable.*;
    }

    pub fn fetch(ctx: Command.Context, env_loader: *DotEnv.Loader, name: string, refresher: *Progress, progress: *Progress.Node) !MutableString {
        progress.name = "Fetching package.json";
        refresher.refresh();

        var url_buf: [1024]u8 = undefined;
        var mutable = try ctx.allocator.create(MutableString);
        mutable.* = try MutableString.init(ctx.allocator, 2048);

        url = URL.parse(try std.fmt.bufPrint(&url_buf, "https://registry.npmjs.org/@bun-examples/{s}/latest", .{name}));

        var http_proxy: ?URL = env_loader.getHttpProxyFor(url);

        // ensure very stable memory address
        var async_http: *HTTP.AsyncHTTP = ctx.allocator.create(HTTP.AsyncHTTP) catch unreachable;
        async_http.* = HTTP.AsyncHTTP.initSync(
            ctx.allocator,
            .GET,
            url,
            .{},
            "",
            mutable,
            "",
            http_proxy,
            null,
            HTTP.FetchRedirect.follow,
        );
        async_http.client.progress_node = progress;
        async_http.client.flags.reject_unauthorized = env_loader.getTLSRejectUnauthorized();

        var response = try async_http.sendSync();

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
        initializeStore();
        var source = logger.Source.initPathString("package.json", mutable.list.items);
        var expr = JSON.parseUTF8(&source, ctx.log, ctx.allocator) catch |err| {
            progress.end();
            refresher.refresh();

            if (ctx.log.errors > 0) {
                try ctx.log.print(Output.errorWriter());
                Global.exit(1);
            } else {
                Output.prettyErrorln("Error parsing package: <r><red>{s}<r>", .{@errorName(err)});
                Global.exit(1);
            }
        };

        if (ctx.log.errors > 0) {
            progress.end();
            refresher.refresh();

            try ctx.log.print(Output.errorWriter());
            Global.exit(1);
        }

        const tarball_url: string = brk: {
            if (expr.asProperty("dist")) |q| {
                if (q.expr.asProperty("tarball")) |p| {
                    if (p.expr.asString(ctx.allocator)) |s| {
                        if (s.len > 0 and (strings.startsWith(s, "https://") or strings.startsWith(s, "http://"))) {
                            break :brk ctx.allocator.dupe(u8, s) catch unreachable;
                        }
                    }
                }
            }

            progress.end();
            refresher.refresh();

            Output.prettyErrorln("package.json is missing tarball url. This is an internal error!", .{});
            Global.exit(1);
        };

        progress.name = "Downloading tarball";
        refresher.refresh();

        // reuse mutable buffer
        // safe because the only thing we care about is the tarball url
        mutable.reset();

        // ensure very stable memory address
        const parsed_tarball_url = URL.parse(tarball_url);

        http_proxy = env_loader.getHttpProxyFor(parsed_tarball_url);

        async_http.* = HTTP.AsyncHTTP.initSync(
            ctx.allocator,
            .GET,
            parsed_tarball_url,
            .{},
            "",
            mutable,
            "",
            http_proxy,
            null,
            HTTP.FetchRedirect.follow,
        );
        async_http.client.progress_node = progress;
        async_http.client.flags.reject_unauthorized = env_loader.getTLSRejectUnauthorized();

        refresher.maybeRefresh();

        response = try async_http.sendSync();

        refresher.maybeRefresh();

        if (response.status_code != 200) {
            progress.end();
            refresher.refresh();
            Output.prettyErrorln("Error fetching tarball: <r><red>{d}<r>", .{response.status_code});
            Global.exit(1);
        }

        refresher.refresh();

        return mutable.*;
    }

    pub fn fetchAll(ctx: Command.Context, env_loader: *DotEnv.Loader, progress_node: ?*Progress.Node) ![]Example {
        url = URL.parse(examples_url);

        const http_proxy: ?URL = env_loader.getHttpProxyFor(url);

        var async_http: *HTTP.AsyncHTTP = ctx.allocator.create(HTTP.AsyncHTTP) catch unreachable;
        const mutable = try ctx.allocator.create(MutableString);
        mutable.* = try MutableString.init(ctx.allocator, 2048);

        async_http.* = HTTP.AsyncHTTP.initSync(
            ctx.allocator,
            .GET,
            url,
            .{},
            "",
            mutable,
            "",
            http_proxy,
            null,
            HTTP.FetchRedirect.follow,
        );
        async_http.client.flags.reject_unauthorized = env_loader.getTLSRejectUnauthorized();

        if (Output.enable_ansi_colors) {
            async_http.client.progress_node = progress_node;
        }

        const response = async_http.sendSync() catch |err| {
            switch (err) {
                error.WouldBlock => {
                    Output.prettyErrorln("Request timed out while trying to fetch examples list. Please try again", .{});
                    Global.exit(1);
                },
                else => {
                    Output.prettyErrorln("<r><red>{s}<r> while trying to fetch examples list. Please try again", .{@errorName(err)});
                    Global.exit(1);
                },
            }
        };

        if (response.status_code != 200) {
            Output.prettyErrorln("<r><red>{d}<r> fetching examples :( {s}", .{ response.status_code, mutable.list.items });
            Global.exit(1);
        }

        initializeStore();
        var source = logger.Source.initPathString("examples.json", mutable.list.items);
        const examples_object = JSON.parseUTF8(&source, ctx.log, ctx.allocator) catch |err| {
            if (ctx.log.errors > 0) {
                try ctx.log.print(Output.errorWriter());
                Global.exit(1);
            } else {
                Output.prettyErrorln("Error parsing examples: <r><red>{s}<r>", .{@errorName(err)});
                Global.exit(1);
            }
        };

        if (ctx.log.errors > 0) {
            try ctx.log.print(Output.errorWriter());
            Global.exit(1);
        }

        if (examples_object.asProperty("examples")) |q| {
            if (q.expr.data == .e_object) {
                const count = q.expr.data.e_object.properties.len;

                var list = try ctx.allocator.alloc(Example, count);
                for (q.expr.data.e_object.properties.slice(), 0..) |property, i| {
                    const name = property.key.?.data.e_string.data;
                    list[i] = Example{
                        .name = if (std.mem.indexOfScalar(u8, name, '/')) |slash|
                            name[slash + 1 ..]
                        else
                            name,
                        .version = property.value.?.asProperty("version").?.expr.data.e_string.data,
                        .description = property.value.?.asProperty("description").?.expr.data.e_string.data,
                    };
                }
                return list;
            }
        }

        Output.prettyErrorln("Corrupt examples data: expected object but received {s}", .{@tagName(examples_object.data)});
        Global.exit(1);
    }
};

pub const CreateListExamplesCommand = struct {
    pub fn exec(ctx: Command.Context) !void {
        const filesystem = try fs.FileSystem.init(null);
        var env_loader: DotEnv.Loader = brk: {
            const map = try ctx.allocator.create(DotEnv.Map);
            map.* = DotEnv.Map.init(ctx.allocator);

            break :brk DotEnv.Loader.init(map, ctx.allocator);
        };

        env_loader.loadProcess();

        var progress = Progress{};
        progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
        const node = progress.start("Fetching manifest", 0);
        progress.refresh();

        const examples = try Example.fetchAllLocalAndRemote(ctx, node, &env_loader, filesystem);
        Output.prettyln("Welcome to bun! Create a new project by pasting any of the following:\n\n", .{});
        Output.flush();

        Example.print(examples.items, null);

        Output.prettyln("<r><d>#<r> You can also paste a GitHub repository:\n\n  <b>bun create <cyan>ahfarmer/calculator calc<r>\n\n", .{});

        if (env_loader.map.get(bun.DotEnv.home_env)) |homedir| {
            Output.prettyln(
                "<d>This command is completely optional. To add a new local template, create a folder in {s}/.bun-create/. To publish a new template, git clone https://github.com/oven-sh/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>",
                .{homedir},
            );
        } else {
            Output.prettyln(
                "<d>This command is completely optional. To add a new local template, create a folder in $HOME/.bun-create/. To publish a new template, git clone https://github.com/oven-sh/bun, add a new folder to the \"examples\" folder, and submit a PR.<r>",
                .{},
            );
        }

        Output.flush();
    }
};

const GitHandler = struct {
    var success: std.atomic.Value(u32) = undefined;
    var thread: std.Thread = undefined;
    pub fn spawn(
        destination: string,
        PATH: string,
        verbose: bool,
    ) void {
        success = std.atomic.Value(u32).init(0);

        thread = std.Thread.spawn(.{}, spawnThread, .{ destination, PATH, verbose }) catch |err| {
            Output.prettyErrorln("<r><red>{s}<r>", .{@errorName(err)});
            Global.exit(1);
        };
    }

    fn spawnThread(
        destination: string,
        PATH: string,
        verbose: bool,
    ) void {
        Output.Source.configureNamedThread("git");
        defer Output.flush();
        const outcome = if (verbose)
            run(destination, PATH, true) catch false
        else
            run(destination, PATH, false) catch false;

        @fence(.acquire);
        success.store(
            if (outcome)
                1
            else
                2,
            .release,
        );
        Futex.wake(&success, 1);
    }

    pub fn wait() bool {
        @fence(.release);

        while (success.load(.acquire) == 0) {
            Futex.wait(&success, 0, 1000) catch continue;
        }

        const outcome = success.load(.acquire) == 1;
        thread.join();
        return outcome;
    }

    pub fn run(
        destination: string,
        PATH: string,
        comptime verbose: bool,
    ) !bool {
        const git_start = std.time.nanoTimestamp();

        // Not sure why...
        // But using libgit for this operation is slower than the CLI!
        // Used to have a feature flag to try it but was removed:
        // https://github.com/oven-sh/bun/commit/deafd3d0d42fb8d7ddf2b06cde2d7c7ee8bc7144
        //
        // ~/Build/throw
        // ❯ hyperfine "bun create react3 app --force --no-install" --prepare="rm -rf app"
        // Benchmark #1: bun create react3 app --force --no-install
        //   Time (mean ± σ):     974.6 ms ±   6.8 ms    [User: 170.5 ms, System: 798.3 ms]
        //   Range (min … max):   960.8 ms … 984.6 ms    10 runs
        //
        // ❯ mv /usr/local/opt/libgit2/lib/libgit2.dylib /usr/local/opt/libgit2/lib/libgit2.dylib.1
        //
        // ~/Build/throw
        // ❯ hyperfine "bun create react3 app --force --no-install" --prepare="rm -rf app"
        // Benchmark #1: bun create react3 app --force --no-install
        //   Time (mean ± σ):     306.7 ms ±   6.1 ms    [User: 31.7 ms, System: 269.8 ms]
        //   Range (min … max):   299.5 ms … 318.8 ms    10 runs

        if (which(&bun_path_buf, PATH, destination, "git")) |git| {
            const git_commands = .{
                &[_]string{ git, "init", "--quiet" },
                &[_]string{ git, "add", destination, "--ignore-errors" },
                &[_]string{ git, "commit", "-am", "Initial commit (via bun create)", "--quiet" },
            };

            if (comptime verbose) {
                Output.prettyErrorln("git backend: {s}", .{git});
            }

            // same names, just comptime known values

            inline for (comptime std.meta.fieldNames(@TypeOf(Commands))) |command_field| {
                const command: []const string = @field(git_commands, command_field);
                var process = std.process.Child.init(command, default_allocator);
                process.cwd = destination;
                process.stdin_behavior = .Inherit;
                process.stdout_behavior = .Inherit;
                process.stderr_behavior = .Inherit;

                _ = try process.spawnAndWait();
                _ = process.kill() catch {};
            }

            Output.prettyError("\n", .{});
            Output.printStartEnd(git_start, std.time.nanoTimestamp());
            Output.prettyError(" <d>git<r>\n", .{});
            return true;
        }

        return false;
    }
};
