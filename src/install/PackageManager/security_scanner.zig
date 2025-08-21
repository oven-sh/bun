const PackagePath = struct {
    pkg_path: []PackageID,
    dep_path: []DependencyID,
};

pub fn performSecurityScanAfterResolution(manager: *PackageManager) !void {
    const security_scanner = manager.options.security_scanner orelse return;

    if (manager.options.dry_run or !manager.options.do.install_packages) return;
    if (manager.update_requests.len == 0) {
        Output.prettyErrorln("No update requests to scan", .{});
        return;
    }

    if (manager.options.log_level == .verbose) {
        Output.prettyErrorln("<d>[SecurityProvider]<r> Running at '{s}'", .{security_scanner});
    }
    const start_time = std.time.milliTimestamp();

    var pkg_dedupe: std.AutoArrayHashMap(PackageID, void) = .init(bun.default_allocator);
    defer pkg_dedupe.deinit();

    const QueueItem = struct {
        pkg_id: PackageID,
        dep_id: DependencyID,
        pkg_path: std.ArrayList(PackageID),
        dep_path: std.ArrayList(DependencyID),
    };
    var ids_queue: std.fifo.LinearFifo(QueueItem, .Dynamic) = .init(bun.default_allocator);
    defer ids_queue.deinit();

    var package_paths = std.AutoArrayHashMap(PackageID, PackagePath).init(manager.allocator);
    defer {
        var iter = package_paths.iterator();
        while (iter.next()) |entry| {
            manager.allocator.free(entry.value_ptr.pkg_path);
            manager.allocator.free(entry.value_ptr.dep_path);
        }
        package_paths.deinit();
    }

    const pkgs = manager.lockfile.packages.slice();
    const pkg_names = pkgs.items(.name);
    const pkg_resolutions = pkgs.items(.resolution);
    const pkg_dependencies = pkgs.items(.dependencies);

    for (manager.update_requests) |req| {
        for (0..pkgs.len) |_update_pkg_id| {
            const update_pkg_id: PackageID = @intCast(_update_pkg_id);

            if (update_pkg_id != req.package_id) {
                continue;
            }

            if (pkg_resolutions[update_pkg_id].tag != .npm) {
                continue;
            }

            var update_dep_id: DependencyID = invalid_dependency_id;
            var parent_pkg_id: PackageID = invalid_package_id;

            for (0..pkgs.len) |_pkg_id| update_dep_id: {
                const pkg_id: PackageID = @intCast(_pkg_id);

                const pkg_res = pkg_resolutions[pkg_id];

                if (pkg_res.tag != .root and pkg_res.tag != .workspace) {
                    continue;
                }

                const pkg_deps = pkg_dependencies[pkg_id];
                for (pkg_deps.begin()..pkg_deps.end()) |_dep_id| {
                    const dep_id: DependencyID = @intCast(_dep_id);

                    const dep_pkg_id = manager.lockfile.buffers.resolutions.items[dep_id];

                    if (dep_pkg_id == invalid_package_id) {
                        continue;
                    }

                    if (dep_pkg_id != update_pkg_id) {
                        continue;
                    }

                    update_dep_id = dep_id;
                    parent_pkg_id = pkg_id;
                    break :update_dep_id;
                }
            }

            if (update_dep_id == invalid_dependency_id) {
                continue;
            }

            if ((try pkg_dedupe.getOrPut(update_pkg_id)).found_existing) {
                continue;
            }

            var initial_pkg_path = std.ArrayList(PackageID).init(manager.allocator);
            // If this is a direct dependency from root, start with root package
            if (parent_pkg_id != invalid_package_id) {
                try initial_pkg_path.append(parent_pkg_id);
            }
            try initial_pkg_path.append(update_pkg_id);
            var initial_dep_path = std.ArrayList(DependencyID).init(manager.allocator);
            try initial_dep_path.append(update_dep_id);

            try ids_queue.writeItem(.{
                .pkg_id = update_pkg_id,
                .dep_id = update_dep_id,
                .pkg_path = initial_pkg_path,
                .dep_path = initial_dep_path,
            });
        }
    }

    // For new packages being added via 'bun add', we just scan the update requests directly
    // since they haven't been added to the lockfile yet

    var json_buf = std.ArrayList(u8).init(manager.allocator);
    var writer = json_buf.writer();
    defer json_buf.deinit();

    const string_buf = manager.lockfile.buffers.string_bytes.items;

    try writer.writeAll("[\n");

    var first = true;

    while (ids_queue.readItem()) |item| {
        defer item.pkg_path.deinit();
        defer item.dep_path.deinit();

        const pkg_id = item.pkg_id;
        const dep_id = item.dep_id;

        const pkg_path_copy = try manager.allocator.alloc(PackageID, item.pkg_path.items.len);
        @memcpy(pkg_path_copy, item.pkg_path.items);

        const dep_path_copy = try manager.allocator.alloc(DependencyID, item.dep_path.items.len);
        @memcpy(dep_path_copy, item.dep_path.items);

        try package_paths.put(pkg_id, .{
            .pkg_path = pkg_path_copy,
            .dep_path = dep_path_copy,
        });

        const pkg_name = pkg_names[pkg_id];
        const pkg_res = pkg_resolutions[pkg_id];
        const dep_version = manager.lockfile.buffers.dependencies.items[dep_id].version;

        if (!first) try writer.writeAll(",\n");

        try writer.print(
            \\  {{
            \\    "name": {},
            \\    "version": "{s}",
            \\    "requestedRange": {},
            \\    "tarball": {}
            \\  }}
        , .{ bun.fmt.formatJSONStringUTF8(pkg_name.slice(string_buf), .{}), pkg_res.value.npm.version.fmt(string_buf), bun.fmt.formatJSONStringUTF8(dep_version.literal.slice(string_buf), .{}), bun.fmt.formatJSONStringUTF8(pkg_res.value.npm.url.slice(string_buf), .{}) });

        first = false;

        // then go through it's dependencies and queue them up if
        // valid and first time we've seen them
        const pkg_deps = pkg_dependencies[pkg_id];

        for (pkg_deps.begin()..pkg_deps.end()) |_next_dep_id| {
            const next_dep_id: DependencyID = @intCast(_next_dep_id);

            const next_pkg_id = manager.lockfile.buffers.resolutions.items[next_dep_id];
            if (next_pkg_id == invalid_package_id) {
                continue;
            }

            const next_pkg_res = pkg_resolutions[next_pkg_id];
            if (next_pkg_res.tag != .npm) {
                continue;
            }

            if ((try pkg_dedupe.getOrPut(next_pkg_id)).found_existing) {
                continue;
            }

            var extended_pkg_path = std.ArrayList(PackageID).init(manager.allocator);
            try extended_pkg_path.appendSlice(item.pkg_path.items);
            try extended_pkg_path.append(next_pkg_id);

            var extended_dep_path = std.ArrayList(DependencyID).init(manager.allocator);
            try extended_dep_path.appendSlice(item.dep_path.items);
            try extended_dep_path.append(next_dep_id);

            try ids_queue.writeItem(.{
                .pkg_id = next_pkg_id,
                .dep_id = next_dep_id,
                .pkg_path = extended_pkg_path,
                .dep_path = extended_dep_path,
            });
        }
    }

    try writer.writeAll("\n]");

    var code_buf = std.ArrayList(u8).init(manager.allocator);
    defer code_buf.deinit();
    var code_writer = code_buf.writer();

    try code_writer.print(
        \\let scanner;
        \\const scannerModuleName = '{s}';
        \\const packages = {s};
        \\
        \\try {{
        \\  scanner = (await import(scannerModuleName)).scanner;
        \\}} catch (error) {{
        \\  const msg = `\x1b[31merror: \x1b[0mFailed to import security scanner: \x1b[1m'${{scannerModuleName}}'\x1b[0m - if you use a security scanner from npm, please run '\x1b[36mbun install\x1b[0m' before adding other packages.`;
        \\  console.error(msg);
        \\  process.exit(1);
        \\}}
        \\
        \\try {{
        \\  if (typeof scanner !== 'object' || scanner === null || typeof scanner.version !== 'string') {{
        \\    throw new Error("Security scanner must export a 'scanner' object with a version property");
        \\  }}
        \\
        \\  if (scanner.version !== '1') {{
        \\    throw new Error('Security scanner must be version 1');
        \\  }}
        \\
        \\  if (typeof scanner.scan !== 'function') {{
        \\    throw new Error('scanner.scan is not a function, got ' + typeof scanner.scan);
        \\  }}
        \\
        \\  const result = await scanner.scan({{ packages }});
        \\
        \\  if (!Array.isArray(result)) {{
        \\    throw new Error('Security scanner must return an array of advisories');
        \\  }}
        \\
        \\  const fs = require('fs');
        \\  const data = JSON.stringify({{advisories: result}});
        \\  for (let remaining = data; remaining.length > 0;) {{
        \\    const written = fs.writeSync(3, remaining);
        \\    if (written === 0) process.exit(1);
        \\    remaining = remaining.slice(written);
        \\  }}
        \\  fs.closeSync(3);
        \\
        \\  process.exit(0);
        \\}} catch (error) {{
        \\  console.error(error);
        \\  process.exit(1);
        \\}}
    , .{ security_scanner, json_buf.items });

    var scanner = SecurityScanSubprocess.new(.{
        .manager = manager,
        .code = try manager.allocator.dupe(u8, code_buf.items),
        .json_data = try manager.allocator.dupe(u8, json_buf.items),
        .ipc_data = undefined,
        .stderr_data = undefined,
    });

    defer {
        manager.allocator.free(scanner.code);
        manager.allocator.free(scanner.json_data);
        bun.destroy(scanner);
    }

    try scanner.spawn();

    var closure = struct {
        scanner: *SecurityScanSubprocess,

        pub fn isDone(this: *@This()) bool {
            return this.scanner.isDone();
        }
    }{ .scanner = scanner };

    manager.sleepUntil(&closure, &@TypeOf(closure).isDone);

    const packages_scanned = pkg_dedupe.count();
    try scanner.handleResults(&package_paths, start_time, packages_scanned, security_scanner);
}

const SecurityAdvisoryLevel = enum { fatal, warn };

const SecurityAdvisory = struct {
    level: SecurityAdvisoryLevel,
    package: []const u8,
    url: ?[]const u8,
    description: ?[]const u8,
};

pub const SecurityScanSubprocess = struct {
    manager: *PackageManager,
    code: []const u8,
    json_data: []const u8,
    process: ?*bun.spawn.Process = null,
    ipc_reader: bun.io.BufferedReader = bun.io.BufferedReader.init(@This()),
    ipc_data: std.ArrayList(u8),
    stderr_data: std.ArrayList(u8),
    has_process_exited: bool = false,
    has_received_ipc: bool = false,
    exit_status: ?bun.spawn.Status = null,
    remaining_fds: i8 = 0,

    pub const new = bun.TrivialNew(@This());

    pub fn spawn(this: *SecurityScanSubprocess) !void {
        this.ipc_data = std.ArrayList(u8).init(this.manager.allocator);
        this.stderr_data = std.ArrayList(u8).init(this.manager.allocator);
        this.ipc_reader.setParent(this);

        const pipe_result = bun.sys.pipe();
        const pipe_fds = switch (pipe_result) {
            .err => |err| {
                Output.errGeneric("Failed to create IPC pipe: {s}", .{@tagName(err.getErrno())});
                Global.exit(1);
            },
            .result => |fds| fds,
        };

        const exec_path = try bun.selfExePath();

        var argv = [_]?[*:0]const u8{
            try this.manager.allocator.dupeZ(u8, exec_path),
            "--no-install",
            "-e",
            try this.manager.allocator.dupeZ(u8, this.code),
            null,
        };
        defer {
            this.manager.allocator.free(bun.span(argv[0].?));
            this.manager.allocator.free(bun.span(argv[3].?));
        }

        const spawn_options = bun.spawn.SpawnOptions{
            .stdout = .inherit,
            .stderr = .inherit,
            .stdin = .inherit,
            .cwd = FileSystem.instance.top_level_dir,
            .extra_fds = &.{.{ .pipe = pipe_fds[1] }},
            .windows = if (Environment.isWindows) .{
                .loop = jsc.EventLoopHandle.init(&this.manager.event_loop),
            },
        };

        var spawned = try (try bun.spawn.spawnProcess(&spawn_options, @ptrCast(&argv), @ptrCast(std.os.environ.ptr))).unwrap();

        pipe_fds[1].close();

        if (comptime bun.Environment.isPosix) {
            _ = bun.sys.setNonblocking(pipe_fds[0]);
        }
        this.remaining_fds = 1;
        this.ipc_reader.flags.nonblocking = true;
        if (comptime bun.Environment.isPosix) {
            this.ipc_reader.flags.socket = false;
        }
        try this.ipc_reader.start(pipe_fds[0], true).unwrap();

        var process = spawned.toProcess(&this.manager.event_loop, false);
        this.process = process;
        process.setExitHandler(this);

        switch (process.watchOrReap()) {
            .err => |err| {
                Output.errGeneric("Failed to watch security scanner process: {}", .{err});
                Global.exit(1);
            },
            .result => {},
        }
    }

    pub fn isDone(this: *SecurityScanSubprocess) bool {
        return this.has_process_exited and this.remaining_fds == 0;
    }

    pub fn eventLoop(this: *const SecurityScanSubprocess) *jsc.AnyEventLoop {
        return &this.manager.event_loop;
    }

    pub fn loop(this: *const SecurityScanSubprocess) *bun.uws.Loop {
        return this.manager.event_loop.loop();
    }

    pub fn onReaderDone(this: *SecurityScanSubprocess) void {
        this.has_received_ipc = true;
        this.remaining_fds -= 1;
    }

    pub fn onReaderError(this: *SecurityScanSubprocess, err: bun.sys.Error) void {
        Output.errGeneric("Failed to read security scanner IPC: {}", .{err});
        this.has_received_ipc = true;
        this.remaining_fds -= 1;
    }

    pub fn onStderrChunk(this: *SecurityScanSubprocess, chunk: []const u8) void {
        this.stderr_data.appendSlice(chunk) catch bun.outOfMemory();
    }

    pub fn getReadBuffer(this: *SecurityScanSubprocess) []u8 {
        const available = this.ipc_data.unusedCapacitySlice();
        if (available.len < 4096) {
            this.ipc_data.ensureTotalCapacity(this.ipc_data.capacity + 4096) catch bun.outOfMemory();
            return this.ipc_data.unusedCapacitySlice();
        }
        return available;
    }

    pub fn onReadChunk(this: *SecurityScanSubprocess, chunk: []const u8, hasMore: bun.io.ReadState) bool {
        _ = hasMore;
        this.ipc_data.appendSlice(chunk) catch bun.outOfMemory();
        return true;
    }

    pub fn onProcessExit(this: *SecurityScanSubprocess, _: *bun.spawn.Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        this.has_process_exited = true;
        this.exit_status = status;

        if (this.remaining_fds > 0 and !this.has_received_ipc) {
            this.ipc_reader.deinit();
            this.remaining_fds = 0;
        }
    }

    pub fn handleResults(this: *SecurityScanSubprocess, package_paths: *std.AutoArrayHashMap(PackageID, PackagePath), start_time: i64, packages_scanned: usize, security_scanner: []const u8) !void {
        defer {
            this.ipc_data.deinit();
            this.stderr_data.deinit();
        }

        const status = this.exit_status orelse bun.spawn.Status{ .exited = .{ .code = 0 } };

        if (this.ipc_data.items.len == 0) {
            switch (status) {
                .exited => |exit| {
                    if (exit.code != 0) {
                        Output.errGeneric("Security scanner exited with code {d} without sending data", .{exit.code});
                    } else {
                        Output.errGeneric("Security scanner exited without sending any data", .{});
                    }
                },
                .signaled => |sig| {
                    Output.errGeneric("Security scanner terminated by signal {s} without sending data", .{@tagName(sig)});
                },
                else => {
                    Output.errGeneric("Security scanner terminated abnormally without sending data", .{});
                },
            }
            Global.exit(1);
        }

        const duration = std.time.milliTimestamp() - start_time;

        if (this.manager.options.log_level == .verbose) {
            switch (status) {
                .exited => |exit| {
                    if (exit.code == 0) {
                        Output.prettyErrorln("<d>[SecurityProvider]<r> Completed with exit code {d} [{d}ms]", .{ exit.code, duration });
                    } else {
                        Output.prettyErrorln("<d>[SecurityProvider]<r> Failed with exit code {d} [{d}ms]", .{ exit.code, duration });
                    }
                },
                .signaled => |sig| {
                    Output.prettyErrorln("<d>[SecurityProvider]<r> Terminated by signal {s} [{d}ms]", .{ @tagName(sig), duration });
                },
                else => {
                    Output.prettyErrorln("<d>[SecurityProvider]<r> Completed with unknown status [{d}ms]", .{duration});
                },
            }
        } else if (this.manager.options.log_level != .silent and duration >= 1000) {
            const maybeHourglass = if (Output.isEmojiEnabled()) "⏳" else "";
            if (packages_scanned == 1) {
                Output.prettyErrorln("<d>{s}[{s}] Scanning 1 package took {d}ms<r>", .{ maybeHourglass, security_scanner, duration });
            } else {
                Output.prettyErrorln("<d>{s}[{s}] Scanning {d} packages took {d}ms<r>", .{ maybeHourglass, security_scanner, packages_scanned, duration });
            }
        }

        try handleSecurityAdvisories(this.manager, this.ipc_data.items, package_paths);

        if (!status.isOK()) {
            switch (status) {
                .exited => |exited| {
                    if (exited.code != 0) {
                        Output.errGeneric("Security scanner failed with exit code: {d}", .{exited.code});
                        Global.exit(1);
                    }
                },
                .signaled => |signal| {
                    Output.errGeneric("Security scanner was terminated by signal: {s}", .{@tagName(signal)});
                    Global.exit(1);
                },
                else => {
                    Output.errGeneric("Security scanner failed", .{});
                    Global.exit(1);
                },
            }
        }
    }
};

fn handleSecurityAdvisories(manager: *PackageManager, ipc_data: []const u8, package_paths: *std.AutoArrayHashMap(PackageID, PackagePath)) !void {
    if (ipc_data.len == 0) return;

    const json_source = logger.Source{
        .contents = ipc_data,
        .path = bun.fs.Path.init("security-advisories.json"),
    };

    var temp_log = logger.Log.init(manager.allocator);
    defer temp_log.deinit();

    const json_expr = bun.json.parseUTF8(&json_source, &temp_log, manager.allocator) catch |err| {
        Output.errGeneric("Security scanner returned invalid JSON: {s}", .{@errorName(err)});
        if (ipc_data.len < 1000) {
            // If the response is reasonably small, show it to help debugging
            Output.errGeneric("Response: {s}", .{ipc_data});
        }
        if (temp_log.errors > 0) {
            temp_log.print(Output.errorWriter()) catch {};
        }
        Global.exit(1);
    };

    var advisories_list = std.ArrayList(SecurityAdvisory).init(manager.allocator);
    defer advisories_list.deinit();

    if (json_expr.data != .e_object) {
        Output.errGeneric("Security scanner response must be a JSON object, got: {s}", .{@tagName(json_expr.data)});
        Global.exit(1);
    }

    const obj = json_expr.data.e_object;

    const advisories_expr = obj.get("advisories") orelse {
        Output.errGeneric("Security scanner response missing required 'advisories' field", .{});
        Global.exit(1);
    };

    if (advisories_expr.data != .e_array) {
        Output.errGeneric("Security scanner 'advisories' field must be an array, got: {s}", .{@tagName(advisories_expr.data)});
        Global.exit(1);
    }

    const array = advisories_expr.data.e_array;
    for (array.items.slice(), 0..) |item, i| {
        if (item.data != .e_object) {
            Output.errGeneric("Security advisory at index {d} must be an object, got: {s}", .{ i, @tagName(item.data) });
            Global.exit(1);
        }

        const item_obj = item.data.e_object;

        const name_expr = item_obj.get("package") orelse {
            Output.errGeneric("Security advisory at index {d} missing required 'package' field", .{i});
            Global.exit(1);
        };
        const name_str = name_expr.asString(manager.allocator) orelse {
            Output.errGeneric("Security advisory at index {d} 'package' field must be a string", .{i});
            Global.exit(1);
        };
        if (name_str.len == 0) {
            Output.errGeneric("Security advisory at index {d} 'package' field cannot be empty", .{i});
            Global.exit(1);
        }

        const desc_str: ?[]const u8 = if (item_obj.get("description")) |desc_expr| blk: {
            if (desc_expr.asString(manager.allocator)) |str| break :blk str;
            if (desc_expr.data == .e_null) break :blk null;
            Output.errGeneric("Security advisory at index {d} 'description' field must be a string or null", .{i});
            Global.exit(1);
        } else null;

        const url_str: ?[]const u8 = if (item_obj.get("url")) |url_expr| blk: {
            if (url_expr.asString(manager.allocator)) |str| break :blk str;
            if (url_expr.data == .e_null) break :blk null;
            Output.errGeneric("Security advisory at index {d} 'url' field must be a string or null", .{i});
            Global.exit(1);
        } else null;

        const level_expr = item_obj.get("level") orelse {
            Output.errGeneric("Security advisory at index {d} missing required 'level' field", .{i});
            Global.exit(1);
        };
        const level_str = level_expr.asString(manager.allocator) orelse {
            Output.errGeneric("Security advisory at index {d} 'level' field must be a string", .{i});
            Global.exit(1);
        };
        const level = if (std.mem.eql(u8, level_str, "fatal"))
            SecurityAdvisoryLevel.fatal
        else if (std.mem.eql(u8, level_str, "warn"))
            SecurityAdvisoryLevel.warn
        else {
            Output.errGeneric("Security advisory at index {d} 'level' field must be 'fatal' or 'warn', got: '{s}'", .{ i, level_str });
            Global.exit(1);
        };

        const advisory = SecurityAdvisory{
            .level = level,
            .package = name_str,
            .url = url_str,
            .description = desc_str,
        };

        try advisories_list.append(advisory);
    }

    if (advisories_list.items.len > 0) {
        var has_fatal = false;
        var has_warn = false;

        for (advisories_list.items) |advisory| {
            Output.print("\n", .{});

            switch (advisory.level) {
                .fatal => {
                    has_fatal = true;
                    Output.pretty("  <red>FATAL<r>: {s}\n", .{advisory.package});
                },
                .warn => {
                    has_warn = true;
                    Output.pretty("  <yellow>WARN<r>: {s}\n", .{advisory.package});
                },
            }

            const pkgs = manager.lockfile.packages.slice();
            const pkg_names = pkgs.items(.name);
            const string_buf = manager.lockfile.buffers.string_bytes.items;

            var found_pkg_id: ?PackageID = null;
            for (pkg_names, 0..) |pkg_name, i| {
                if (std.mem.eql(u8, pkg_name.slice(string_buf), advisory.package)) {
                    found_pkg_id = @intCast(i);
                    break;
                }
            }

            if (found_pkg_id) |pkg_id| {
                if (package_paths.get(pkg_id)) |paths| {
                    if (paths.pkg_path.len > 1) {
                        Output.pretty("    <d>via ", .{});
                        for (paths.pkg_path[0 .. paths.pkg_path.len - 1], 0..) |ancestor_id, idx| {
                            if (idx > 0) Output.pretty(" › ", .{});
                            const ancestor_name = pkg_names[ancestor_id].slice(string_buf);
                            Output.pretty("{s}", .{ancestor_name});
                        }
                        Output.pretty(" › <red>{s}<r>\n", .{advisory.package});
                    } else {
                        Output.pretty("    <d>(direct dependency)<r>\n", .{});
                    }
                }
            }

            if (advisory.description) |desc| {
                if (desc.len > 0) {
                    Output.pretty("    {s}\n", .{desc});
                }
            }
            if (advisory.url) |url| {
                if (url.len > 0) {
                    Output.pretty("    <cyan>{s}<r>\n", .{url});
                }
            }
        }

        if (has_fatal) {
            Output.pretty("\n<red>bun install aborted due to fatal security advisories<r>\n", .{});
            Global.exit(1);
        } else if (has_warn) {
            const can_prompt = Output.enable_ansi_colors_stdout;

            if (can_prompt) {
                Output.pretty("\n<yellow>Security warnings found.<r> Continue anyway? [y/N] ", .{});
                Output.flush();

                var stdin = std.io.getStdIn();
                const unbuffered_reader = stdin.reader();
                var buffered = std.io.bufferedReader(unbuffered_reader);
                var reader = buffered.reader();

                const first_byte = reader.readByte() catch {
                    Output.pretty("\n<red>Installation cancelled.<r>\n", .{});
                    Global.exit(1);
                };

                const should_continue = switch (first_byte) {
                    '\n' => false,
                    '\r' => blk: {
                        const next_byte = reader.readByte() catch {
                            break :blk false;
                        };
                        break :blk next_byte == '\n' and false;
                    },
                    'y', 'Y' => blk: {
                        const next_byte = reader.readByte() catch {
                            break :blk false;
                        };
                        if (next_byte == '\n') {
                            break :blk true;
                        } else if (next_byte == '\r') {
                            const second_byte = reader.readByte() catch {
                                break :blk false;
                            };
                            break :blk second_byte == '\n';
                        }
                        break :blk false;
                    },
                    else => blk: {
                        while (reader.readByte()) |b| {
                            if (b == '\n' or b == '\r') break;
                        } else |_| {}
                        break :blk false;
                    },
                };

                if (!should_continue) {
                    Output.pretty("\n<red>Installation cancelled.<r>\n", .{});
                    Global.exit(1);
                }

                Output.pretty("\n<yellow>Continuing with installation...<r>\n\n", .{});
            } else {
                Output.pretty("\n<red>Security warnings found. Cannot prompt for confirmation (no TTY).<r>\n", .{});
                Output.pretty("<red>Installation cancelled.<r>\n", .{});
                Global.exit(1);
            }
        }
    }
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const Global = bun.Global;
const Output = bun.Output;
const jsc = bun.jsc;
const logger = bun.logger;
const FileSystem = bun.fs.FileSystem;

const DependencyID = bun.install.DependencyID;
const PackageID = bun.install.PackageID;
const PackageManager = bun.install.PackageManager;
const invalid_dependency_id = bun.install.invalid_dependency_id;
const invalid_package_id = bun.install.invalid_package_id;
