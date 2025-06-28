pub const ImportWatcher = union(enum) {
    none: void,
    hot: *Watcher,
    watch: *Watcher,

    pub fn start(this: ImportWatcher) !void {
        switch (this) {
            inline .hot => |w| try w.start(),
            inline .watch => |w| try w.start(),
            else => {},
        }
    }

    pub inline fn watchlist(this: ImportWatcher) Watcher.WatchList {
        return switch (this) {
            inline .hot, .watch => |w| w.watchlist,
            else => .{},
        };
    }

    pub inline fn indexOf(this: ImportWatcher, hash: Watcher.HashType) ?u32 {
        return switch (this) {
            inline .hot, .watch => |w| w.indexOf(hash),
            else => null,
        };
    }

    pub inline fn addFile(
        this: ImportWatcher,
        fd: bun.FD,
        file_path: string,
        hash: Watcher.HashType,
        loader: options.Loader,
        dir_fd: bun.FD,
        package_json: ?*bun.PackageJSON,
        comptime copy_file_path: bool,
    ) bun.JSC.Maybe(void) {
        return switch (this) {
            inline .hot, .watch => |watcher| watcher.addFile(
                fd,
                file_path,
                hash,
                loader,
                dir_fd,
                package_json,
                copy_file_path,
            ),
            .none => .{ .result = {} },
        };
    }
};

pub const HotReloader = NewHotReloader(VirtualMachine, JSC.EventLoop, false);
pub const WatchReloader = NewHotReloader(VirtualMachine, JSC.EventLoop, true);

extern fn BunDebugger__willHotReload() void;

pub fn NewHotReloader(comptime Ctx: type, comptime EventLoopType: type, comptime reload_immediately: bool) type {
    return struct {
        const Reloader = @This();

        ctx: *Ctx,
        verbose: bool = false,
        pending_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

        tombstones: bun.StringHashMapUnmanaged(*bun.fs.FileSystem.RealFS.EntriesOption) = .{},

        pub fn init(ctx: *Ctx, fs: *bun.fs.FileSystem, verbose: bool, clear_screen_flag: bool) *Watcher {
            const reloader = bun.default_allocator.create(Reloader) catch bun.outOfMemory();
            reloader.* = .{
                .ctx = ctx,
                .verbose = Environment.enable_logs or verbose,
            };

            clear_screen = clear_screen_flag;
            const watcher = Watcher.init(Reloader, reloader, fs, bun.default_allocator) catch |err| {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                Output.panic("Failed to enable File Watcher: {s}", .{@errorName(err)});
            };
            watcher.start() catch |err| {
                bun.handleErrorReturnTrace(err, @errorReturnTrace());
                Output.panic("Failed to start File Watcher: {s}", .{@errorName(err)});
            };
            return watcher;
        }

        fn debug(comptime fmt: string, args: anytype) void {
            if (Environment.enable_logs) {
                Output.scoped(.hot_reloader, false)(fmt, args);
            } else {
                Output.prettyErrorln("<cyan>watcher<r><d>:<r> " ++ fmt, args);
            }
        }

        pub fn eventLoop(this: @This()) *EventLoopType {
            return this.ctx.eventLoop();
        }

        pub fn enqueueTaskConcurrent(this: @This(), task: *JSC.ConcurrentTask) void {
            if (comptime reload_immediately)
                unreachable;

            this.eventLoop().enqueueTaskConcurrent(task);
        }

        pub var clear_screen = false;

        pub const Task = struct {
            count: u8 = 0,
            hashes: [8]u32,
            paths: if (Ctx == bun.bake.DevServer) [8][]const u8 else void,
            /// Left uninitialized until .enqueue
            concurrent_task: JSC.ConcurrentTask,
            reloader: *Reloader,

            pub fn initEmpty(reloader: *Reloader) Task {
                return .{
                    .reloader = reloader,

                    .hashes = [_]u32{0} ** 8,
                    .paths = if (Ctx == bun.bake.DevServer) [_][]const u8{&.{}} ** 8,
                    .count = 0,
                    .concurrent_task = undefined,
                };
            }

            pub fn append(this: *Task, id: u32) void {
                if (this.count == 8) {
                    this.enqueue();
                    this.count = 0;
                }

                this.hashes[this.count] = id;
                this.count += 1;
            }

            pub fn run(this: *Task) void {
                // Since we rely on the event loop for hot reloads, there can be
                // a delay before the next reload begins. In the time between the
                // last reload and the next one, we shouldn't schedule any more
                // hot reloads. Since we reload literally everything, we don't
                // need to worry about missing any changes.
                //
                // Note that we set the count _before_ we reload, so that if we
                // get another hot reload request while we're reloading, we'll
                // still enqueue it.
                while (this.reloader.pending_count.swap(0, .monotonic) > 0) {
                    this.reloader.ctx.reload(this);
                }
            }

            pub fn enqueue(this: *Task) void {
                JSC.markBinding(@src());
                if (this.count == 0)
                    return;

                if (comptime reload_immediately) {
                    Output.flush();
                    if (comptime Ctx == ImportWatcher) {
                        if (this.reloader.ctx.rare_data) |rare|
                            rare.closeAllListenSocketsForWatchMode();
                    }
                    bun.reloadProcess(bun.default_allocator, clear_screen, false);
                    unreachable;
                }

                _ = this.reloader.pending_count.fetchAdd(1, .monotonic);

                BunDebugger__willHotReload();
                const that = bun.new(Task, .{
                    .reloader = this.reloader,
                    .count = this.count,
                    .paths = this.paths,
                    .hashes = this.hashes,
                    .concurrent_task = undefined,
                });
                that.concurrent_task = .{ .task = JSC.Task.init(that), .auto_delete = false };
                that.reloader.enqueueTaskConcurrent(&that.concurrent_task);
                this.count = 0;
            }

            pub fn deinit(this: *Task) void {
                bun.destroy(this);
            }
        };

        pub fn enableHotModuleReloading(this: *Ctx) void {
            if (comptime @TypeOf(this.bun_watcher) == ImportWatcher) {
                if (this.bun_watcher != .none)
                    return;
            } else {
                if (this.bun_watcher != null)
                    return;
            }

            var reloader = bun.default_allocator.create(Reloader) catch bun.outOfMemory();
            reloader.* = .{
                .ctx = this,
                .verbose = Environment.enable_logs or if (@hasField(Ctx, "log")) this.log.level.atLeast(.info) else false,
            };

            if (comptime @TypeOf(this.bun_watcher) == ImportWatcher) {
                this.bun_watcher = if (reload_immediately)
                    .{ .watch = Watcher.init(
                        Reloader,
                        reloader,
                        this.transpiler.fs,
                        bun.default_allocator,
                    ) catch |err| {
                        bun.handleErrorReturnTrace(err, @errorReturnTrace());
                        Output.panic("Failed to enable File Watcher: {s}", .{@errorName(err)});
                    } }
                else
                    .{ .hot = Watcher.init(
                        Reloader,
                        reloader,
                        this.transpiler.fs,
                        bun.default_allocator,
                    ) catch |err| {
                        bun.handleErrorReturnTrace(err, @errorReturnTrace());
                        Output.panic("Failed to enable File Watcher: {s}", .{@errorName(err)});
                    } };

                if (reload_immediately) {
                    this.transpiler.resolver.watcher = bun.resolver.ResolveWatcher(*Watcher, Watcher.onMaybeWatchDirectory).init(this.bun_watcher.watch);
                } else {
                    this.transpiler.resolver.watcher = bun.resolver.ResolveWatcher(*Watcher, Watcher.onMaybeWatchDirectory).init(this.bun_watcher.hot);
                }
            } else {
                this.bun_watcher = Watcher.init(
                    Reloader,
                    reloader,
                    this.transpiler.fs,
                    bun.default_allocator,
                ) catch |err| {
                    bun.handleErrorReturnTrace(err, @errorReturnTrace());
                    Output.panic("Failed to enable File Watcher: {s}", .{@errorName(err)});
                };
                this.transpiler.resolver.watcher = bun.resolver.ResolveWatcher(*Watcher, Watcher.onMaybeWatchDirectory).init(this.bun_watcher.?);
            }

            clear_screen = !this.transpiler.env.hasSetNoClearTerminalOnReload(!Output.enable_ansi_colors);

            reloader.getContext().start() catch @panic("Failed to start File Watcher");
        }

        fn putTombstone(this: *@This(), key: []const u8, value: *bun.fs.FileSystem.RealFS.EntriesOption) void {
            this.tombstones.put(bun.default_allocator, key, value) catch unreachable;
        }

        fn getTombstone(this: *@This(), key: []const u8) ?*bun.fs.FileSystem.RealFS.EntriesOption {
            return this.tombstones.get(key);
        }

        pub fn onError(
            _: *@This(),
            err: bun.sys.Error,
        ) void {
            Output.err(@as(bun.sys.E, @enumFromInt(err.errno)), "Watcher crashed", .{});
            if (bun.Environment.isDebug) {
                @panic("Watcher crash");
            }
        }

        pub fn getContext(this: *@This()) *Watcher {
            if (comptime @TypeOf(this.ctx.bun_watcher) == ImportWatcher) {
                if (reload_immediately) {
                    return this.ctx.bun_watcher.watch;
                } else {
                    return this.ctx.bun_watcher.hot;
                }
            } else if (@typeInfo(@TypeOf(this.ctx.bun_watcher)) == .optional) {
                return this.ctx.bun_watcher.?;
            } else {
                return this.ctx.bun_watcher;
            }
        }

        pub noinline fn onFileUpdate(
            this: *@This(),
            events: []Watcher.WatchEvent,
            changed_files: []?[:0]u8,
            watchlist: Watcher.WatchList,
        ) void {
            const slice = watchlist.slice();
            const file_paths = slice.items(.file_path);
            const counts = slice.items(.count);
            const kinds = slice.items(.kind);
            const hashes = slice.items(.hash);
            const parents = slice.items(.parent_hash);
            const file_descriptors = slice.items(.fd);
            const ctx = this.getContext();
            defer ctx.flushEvictions();
            defer Output.flush();

            const fs: *Fs.FileSystem = &Fs.FileSystem.instance;
            const rfs: *Fs.FileSystem.RealFS = &fs.fs;
            var _on_file_update_path_buf: bun.PathBuffer = undefined;
            var current_task = Task.initEmpty(this);
            defer current_task.enqueue();

            for (events) |event| {
                const file_path = file_paths[event.index];
                const update_count = counts[event.index] + 1;
                counts[event.index] = update_count;
                const kind = kinds[event.index];

                // so it's consistent with the rest
                // if we use .extname we might run into an issue with whether or not the "." is included.
                // const path = Fs.PathName.init(file_path);
                const current_hash = hashes[event.index];

                switch (kind) {
                    .file => {
                        if (event.op.delete or event.op.rename) {
                            ctx.removeAtIndex(
                                event.index,
                                0,
                                &.{},
                                .file,
                            );
                        }

                        if (this.verbose)
                            debug("File changed: {s}", .{fs.relativeTo(file_path)});

                        if (event.op.write or event.op.delete or event.op.rename) {
                            current_task.append(current_hash);
                        }

                        // TODO: delete events?
                    },
                    .directory => {
                        if (comptime Environment.isWindows) {
                            // on windows we receive file events for all items affected by a directory change
                            // so we only need to clear the directory cache. all other effects will be handled
                            // by the file events
                            _ = this.ctx.bustDirCache(strings.withoutTrailingSlashWindowsPath(file_path));
                            continue;
                        }
                        var affected_buf: [128][]const u8 = undefined;
                        var entries_option: ?*Fs.FileSystem.RealFS.EntriesOption = null;

                        const affected = brk: {
                            if (comptime Environment.isMac) {
                                if (rfs.entries.get(file_path)) |existing| {
                                    this.putTombstone(file_path, existing);
                                    entries_option = existing;
                                } else if (this.getTombstone(file_path)) |existing| {
                                    entries_option = existing;
                                }

                                var affected_i: usize = 0;

                                // if a file descriptor is stale, we need to close it
                                if (event.op.delete and entries_option != null) {
                                    for (parents, 0..) |parent_hash, entry_id| {
                                        if (parent_hash == current_hash) {
                                            const affected_path = file_paths[entry_id];
                                            const was_deleted = check: {
                                                std.posix.access(affected_path, std.posix.F_OK) catch break :check true;
                                                break :check false;
                                            };
                                            if (!was_deleted) continue;

                                            affected_buf[affected_i] = affected_path[file_path.len..];
                                            affected_i += 1;
                                            if (affected_i >= affected_buf.len) break;
                                        }
                                    }
                                }

                                break :brk affected_buf[0..affected_i];
                            }

                            break :brk event.names(changed_files);
                        };

                        if (affected.len > 0 and !Environment.isMac) {
                            if (rfs.entries.get(file_path)) |existing| {
                                this.putTombstone(file_path, existing);
                                entries_option = existing;
                            } else if (this.getTombstone(file_path)) |existing| {
                                entries_option = existing;
                            }
                        }

                        _ = this.ctx.bustDirCache(strings.withoutTrailingSlashWindowsPath(file_path));

                        if (entries_option) |dir_ent| {
                            var last_file_hash: Watcher.HashType = std.math.maxInt(Watcher.HashType);

                            for (affected) |changed_name_| {
                                const changed_name: []const u8 = if (comptime Environment.isMac)
                                    changed_name_
                                else
                                    bun.asByteSlice(changed_name_.?);
                                if (changed_name.len == 0 or changed_name[0] == '~' or changed_name[0] == '.') continue;

                                const loader = (this.ctx.getLoaders().get(Fs.PathName.init(changed_name).ext) orelse .file);
                                var prev_entry_id: usize = std.math.maxInt(usize);
                                if (loader != .file) {
                                    var path_string: bun.PathString = undefined;
                                    var file_hash: Watcher.HashType = last_file_hash;
                                    const abs_path: string = brk: {
                                        if (dir_ent.entries.get(@as([]const u8, @ptrCast(changed_name)))) |file_ent| {
                                            // reset the file descriptor
                                            file_ent.entry.cache.fd = .invalid;
                                            file_ent.entry.need_stat = true;
                                            path_string = file_ent.entry.abs_path;
                                            file_hash = Watcher.getHash(path_string.slice());
                                            for (hashes, 0..) |hash, entry_id| {
                                                if (hash == file_hash) {
                                                    if (file_descriptors[entry_id].isValid()) {
                                                        if (prev_entry_id != entry_id) {
                                                            current_task.append(hashes[entry_id]);
                                                            ctx.removeAtIndex(
                                                                @as(u16, @truncate(entry_id)),
                                                                0,
                                                                &.{},
                                                                .file,
                                                            );
                                                        }
                                                    }

                                                    prev_entry_id = entry_id;
                                                    break;
                                                }
                                            }

                                            break :brk path_string.slice();
                                        } else {
                                            const file_path_without_trailing_slash = std.mem.trimRight(u8, file_path, std.fs.path.sep_str);
                                            @memcpy(_on_file_update_path_buf[0..file_path_without_trailing_slash.len], file_path_without_trailing_slash);
                                            _on_file_update_path_buf[file_path_without_trailing_slash.len] = std.fs.path.sep;

                                            @memcpy(_on_file_update_path_buf[file_path_without_trailing_slash.len..][0..changed_name.len], changed_name);
                                            const path_slice = _on_file_update_path_buf[0 .. file_path_without_trailing_slash.len + changed_name.len + 1];
                                            file_hash = Watcher.getHash(path_slice);
                                            break :brk path_slice;
                                        }
                                    };

                                    // skip consecutive duplicates
                                    if (last_file_hash == file_hash) continue;
                                    last_file_hash = file_hash;

                                    if (this.verbose)
                                        debug("File change: {s}", .{fs.relativeTo(abs_path)});
                                }
                            }
                        }

                        if (this.verbose) {
                            debug("Dir change: {s}", .{fs.relativeTo(file_path)});
                        }
                    },
                }
            }
        }
    };
}

const std = @import("std");
const bun = @import("bun");
const string = []const u8;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const options = bun.options;
const JSC = bun.JSC;
const MarkedArrayBuffer = bun.jsc.MarkedArrayBuffer;
const VirtualMachine = JSC.VirtualMachine;
const Watcher = bun.Watcher;
pub const Buffer = MarkedArrayBuffer;
const Fs = bun.fs;
