usingnamespace @import("global.zig");

const js_ast = @import("./js_ast.zig");
const logger = @import("./logger.zig");
const js_parser = @import("./js_parser/js_parser.zig");
const json_parser = @import("./json_parser.zig");
const options = @import("./options.zig");
const Define = @import("./defines.zig").Define;
const std = @import("std");
const fs = @import("./fs.zig");
const sync = @import("sync.zig");
const Mutex = @import("./lock.zig").Lock;

const import_record = @import("./import_record.zig");
const ImportRecord = import_record.ImportRecord;

pub const FsCacheEntry = struct {
    contents: string,
    fd: StoredFileDescriptorType = 0,
    // Null means its not usable
    mod_key: ?fs.FileSystem.Implementation.ModKey = null,

    pub fn deinit(entry: *FsCacheEntry, allocator: *std.mem.Allocator) void {
        if (entry.contents.len > 0) {
            allocator.free(entry.contents);
            entry.contents = "";
        }
    }
};

pub fn NewCache(comptime cache_files: bool) type {
    return struct {
        pub const Set = struct {
            js: JavaScript,
            fs: Fs,
            json: Json,

            pub fn init(allocator: *std.mem.Allocator) Set {
                return Set{
                    .js = JavaScript.init(allocator),
                    .fs = Fs{
                        .mutex = Mutex.init(),
                        .entries = std.StringHashMap(Fs.Entry).init(allocator),
                        .shared_buffer = MutableString.init(allocator, 0) catch unreachable,
                    },
                    .json = Json{
                        .mutex = Mutex.init(),
                        .entries = std.StringHashMap(*Json.Entry).init(allocator),
                    },
                };
            }
        };
        pub const Fs = struct {
            const Entry = FsCacheEntry;

            mutex: Mutex,
            entries: std.StringHashMap(Entry),
            shared_buffer: MutableString,

            pub fn deinit(c: *Fs) void {
                var iter = c.entries.iterator();
                while (iter.next()) |entry| {
                    entry.value.deinit(c.entries.allocator);
                }
                c.entries.deinit();
            }

            pub fn readFileShared(
                c: *Fs,
                _fs: *fs.FileSystem,
                path: string,
                dirname_fd: StoredFileDescriptorType,
                _file_handle: ?StoredFileDescriptorType,
                shared: *MutableString,
            ) !Entry {
                var rfs = _fs.fs;

                if (comptime cache_files) {
                    {
                        c.mutex.lock();
                        defer c.mutex.unlock();
                        if (c.entries.get(path)) |entry| {
                            return entry;
                        }
                    }
                }

                var file_handle: std.fs.File = if (_file_handle) |__file| std.fs.File{ .handle = __file } else undefined;

                if (_file_handle == null) {
                    if (FeatureFlags.store_file_descriptors and dirname_fd > 0) {
                        file_handle = try std.fs.Dir.openFile(std.fs.Dir{ .fd = dirname_fd }, std.fs.path.basename(path), .{ .read = true });
                    } else {
                        file_handle = try std.fs.openFileAbsolute(path, .{ .read = true });
                    }
                }

                defer {
                    if (rfs.needToCloseFiles() and _file_handle == null) {
                        file_handle.close();
                    }
                }

                // If the file's modification key hasn't changed since it was cached, assume
                // the contents of the file are also the same and skip reading the file.
                var mod_key: ?fs.FileSystem.Implementation.ModKey = rfs.modKeyWithFile(path, file_handle) catch |err| handler: {
                    switch (err) {
                        error.FileNotFound, error.AccessDenied => {
                            return err;
                        },
                        else => {
                            if (isDebug) {
                                Output.printError("modkey error: {s}", .{@errorName(err)});
                            }
                            break :handler null;
                        },
                    }
                };

                var file: fs.File = undefined;
                if (mod_key) |modk| {
                    file = rfs.readFileWithHandle(path, modk.size, file_handle, true, shared) catch |err| {
                        if (isDebug) {
                            Output.printError("{s}: readFile error -- {s}", .{ path, @errorName(err) });
                        }
                        return err;
                    };
                } else {
                    file = rfs.readFileWithHandle(path, null, file_handle, true, shared) catch |err| {
                        if (isDebug) {
                            Output.printError("{s}: readFile error -- {s}", .{ path, @errorName(err) });
                        }
                        return err;
                    };
                }

                const entry = Entry{
                    .contents = file.contents,
                    .mod_key = mod_key,
                    .fd = if (FeatureFlags.store_file_descriptors) file_handle.handle else 0,
                };

                if (comptime cache_files) {
                    c.mutex.lock();
                    defer c.mutex.unlock();
                    var res = c.entries.getOrPut(path) catch unreachable;

                    if (res.found_existing) {
                        res.value_ptr.*.deinit(c.entries.allocator);
                    }
                    res.value_ptr.* = entry;
                    return res.value_ptr.*;
                } else {
                    return entry;
                }
            }

            pub fn readFile(
                c: *Fs,
                _fs: *fs.FileSystem,
                path: string,
                dirname_fd: StoredFileDescriptorType,
                comptime use_shared_buffer: bool,
                _file_handle: ?StoredFileDescriptorType,
            ) !Entry {
                var rfs = _fs.fs;

                if (comptime cache_files) {
                    {
                        c.mutex.lock();
                        defer c.mutex.unlock();
                        if (c.entries.get(path)) |entry| {
                            return entry;
                        }
                    }
                }

                var file_handle: std.fs.File = if (_file_handle) |__file| std.fs.File{ .handle = __file } else undefined;

                if (_file_handle == null) {
                    if (FeatureFlags.store_file_descriptors and dirname_fd > 0) {
                        file_handle = std.fs.Dir.openFile(std.fs.Dir{ .fd = dirname_fd }, std.fs.path.basename(path), .{ .read = true }) catch |err| brk: {
                            switch (err) {
                                error.FileNotFound => {
                                    const handle = try std.fs.openFileAbsolute(path, .{ .read = true });
                                    Output.prettyErrorln(
                                        "<r><d>Internal error: directory mismatch for directory \"{s}\", fd {d}<r>. You don't need to do anything, but this indicates a bug.",
                                        .{ path, dirname_fd },
                                    );
                                    break :brk handle;
                                },
                                else => return err,
                            }
                        };
                    } else {
                        file_handle = try std.fs.openFileAbsolute(path, .{ .read = true });
                    }
                }

                defer {
                    if (rfs.needToCloseFiles() and _file_handle == null) {
                        file_handle.close();
                    }
                }

                // If the file's modification key hasn't changed since it was cached, assume
                // the contents of the file are also the same and skip reading the file.
                var mod_key: ?fs.FileSystem.Implementation.ModKey = rfs.modKeyWithFile(path, file_handle) catch |err| handler: {
                    switch (err) {
                        error.FileNotFound, error.AccessDenied => {
                            return err;
                        },
                        else => {
                            if (isDebug) {
                                Output.printError("modkey error: {s}", .{@errorName(err)});
                            }
                            break :handler null;
                        },
                    }
                };

                var file: fs.File = undefined;
                if (mod_key) |modk| {
                    file = rfs.readFileWithHandle(path, modk.size, file_handle, use_shared_buffer, &c.shared_buffer) catch |err| {
                        if (isDebug) {
                            Output.printError("{s}: readFile error -- {s}", .{ path, @errorName(err) });
                        }
                        return err;
                    };
                } else {
                    file = rfs.readFileWithHandle(path, null, file_handle, use_shared_buffer, &c.shared_buffer) catch |err| {
                        if (isDebug) {
                            Output.printError("{s}: readFile error -- {s}", .{ path, @errorName(err) });
                        }
                        return err;
                    };
                }

                const entry = Entry{
                    .contents = file.contents,
                    .mod_key = mod_key,
                    .fd = if (FeatureFlags.store_file_descriptors) file_handle.handle else 0,
                };

                if (comptime cache_files) {
                    c.mutex.lock();
                    defer c.mutex.unlock();
                    var res = c.entries.getOrPut(path) catch unreachable;

                    if (res.found_existing) {
                        res.value_ptr.*.deinit(c.entries.allocator);
                    }
                    res.value_ptr.* = entry;
                    return res.value_ptr.*;
                } else {
                    return entry;
                }
            }
        };

        pub const Css = struct {
            pub const Entry = struct {};
            pub const Result = struct {
                ok: bool,
                value: void,
            };
            pub fn parse(cache: *@This(), log: *logger.Log, source: logger.Source) !Result {
                Global.notimpl();
            }
        };

        pub const JavaScript = struct {
            mutex: Mutex,
            entries: std.StringHashMap(Result),

            pub const Result = js_ast.Result;

            pub fn init(allocator: *std.mem.Allocator) JavaScript {
                return JavaScript{ .mutex = Mutex.init(), .entries = std.StringHashMap(Result).init(allocator) };
            }
            // For now, we're not going to cache JavaScript ASTs.
            // It's probably only relevant when bundling for production.
            pub fn parse(
                cache: *@This(),
                allocator: *std.mem.Allocator,
                opts: js_parser.Parser.Options,
                defines: *Define,
                log: *logger.Log,
                source: *const logger.Source,
            ) anyerror!?js_ast.Ast {
                var temp_log = logger.Log.init(allocator);
                defer temp_log.appendToMaybeRecycled(log, source) catch {};
                var parser = js_parser.Parser.init(opts, &temp_log, source, defines, allocator) catch |err| {
                    return null;
                };

                const result = try parser.parse();

                return if (result.ok) result.ast else null;
            }

            pub fn scan(
                cache: *@This(),
                allocator: *std.mem.Allocator,
                scan_pass_result: *js_parser.ScanPassResult,
                opts: js_parser.Parser.Options,
                defines: *Define,
                log: *logger.Log,
                source: *const logger.Source,
            ) anyerror!void {
                var temp_log = logger.Log.init(allocator);
                defer temp_log.appendToMaybeRecycled(log, source) catch {};

                var parser = js_parser.Parser.init(opts, &temp_log, source, defines, allocator) catch |err| {
                    return;
                };

                return try parser.scanImports(scan_pass_result);
            }
        };

        pub const Json = struct {
            pub const Entry = struct {
                is_tsconfig: bool = false,
                source: logger.Source,
                expr: ?js_ast.Expr = null,
                ok: bool = false,
                // msgs: []logger.Msg,
            };
            mutex: Mutex,
            entries: std.StringHashMap(*Entry),
            pub fn init(allocator: *std.mem.Allocator) Json {
                return Json{
                    .mutex = Mutex.init(),
                    .entries = std.StringHashMap(Entry).init(allocator),
                };
            }
            fn parse(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: *std.mem.Allocator, is_tsconfig: bool, func: anytype) anyerror!?js_ast.Expr {
                var temp_log = logger.Log.init(allocator);
                defer {
                    temp_log.appendTo(log) catch {};
                }
                return func(&source, &temp_log, allocator) catch handler: {
                    break :handler null;
                };
            }
            pub fn parseJSON(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: *std.mem.Allocator) anyerror!?js_ast.Expr {
                return try parse(cache, log, source, allocator, false, json_parser.ParseJSON);
            }

            pub fn parseTSConfig(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: *std.mem.Allocator) anyerror!?js_ast.Expr {
                return try parse(cache, log, source, allocator, true, json_parser.ParseTSConfig);
            }
        };
    };
}

pub const Cache = NewCache(true);
pub const ServeCache = NewCache(false);
