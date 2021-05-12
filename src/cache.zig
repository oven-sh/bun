usingnamespace @import("global.zig");

const js_ast = @import("./js_ast.zig");
const logger = @import("./logger.zig");
const js_parser = @import("./js_parser/js_parser.zig");
const json_parser = @import("./json_parser.zig");
const options = @import("./options.zig");
const Defines = @import("./defines.zig").Defines;
const std = @import("std");
const fs = @import("./fs.zig");
const sync = @import("sync.zig");
const Mutex = sync.Mutex;

pub const Cache = struct {
    pub const Set = struct {
        js: JavaScript,
        fs: Fs,
        json: Json,

        pub fn init(allocator: *std.mem.Allocator) Set {
            return Set{
                .js = JavaScript{},
                .fs = Fs{
                    .mutex = Mutex.init(),
                    .entries = std.StringHashMap(Fs.Entry).init(allocator),
                },
                .json = Json{
                    .mutex = Mutex.init(),
                    .entries = std.StringHashMap(*Json.Entry).init(allocator),
                },
            };
        }
    };
    pub const Fs = struct {
        mutex: Mutex,
        entries: std.StringHashMap(Entry),

        pub const Entry = struct {
            contents: string,
            // Null means its not usable
            mod_key: ?fs.FileSystem.Implementation.ModKey = null,

            pub fn deinit(entry: *Entry, allocator: *std.mem.Allocator) void {
                if (entry.contents.len > 0) {
                    allocator.free(entry.contents);
                    entry.contents = "";
                }
            }
        };

        pub fn deinit(c: *Fs) void {
            var iter = c.entries.iterator();
            while (iter.next()) |entry| {
                entry.value.deinit(c.entries.allocator);
            }
            c.entries.deinit();
        }

        pub fn readFile(c: *Fs, _fs: *fs.FileSystem, path: string) !Entry {
            var rfs = _fs.fs;

            {
                c.mutex.lock();
                defer c.mutex.unlock();
                if (c.entries.get(path)) |entry| {
                    return entry;
                }
            }

            // If the file's modification key hasn't changed since it was cached, assume
            // the contents of the file are also the same and skip reading the file.
            var mod_key: ?fs.FileSystem.Implementation.ModKey = rfs.modKey(path) catch |err| handler: {
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

            const size = if (mod_key != null) mod_key.?.size else null;
            const file = rfs.readFile(path, size) catch |err| {
                if (isDebug) {
                    Output.printError("{s}: readFile error -- {s}", .{ path, @errorName(err) });
                }
                return err;
            };

            const entry = Entry{
                .contents = file.contents,
                .mod_key = mod_key,
            };

            c.mutex.lock();
            defer c.mutex.unlock();
            var res = c.entries.getOrPut(path) catch unreachable;

            if (res.found_existing) {
                res.entry.value.deinit(c.entries.allocator);
            }

            res.entry.value = entry;
            return res.entry.value;
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
        pub const Entry = struct {
            ast: js_ast.Ast,
            source: logger.Source,
            ok: bool,
            msgs: []logger.Msg,
        };
        pub const Result = js_ast.Result;
        // For now, we're not going to cache JavaScript ASTs.
        // It's probably only relevant when bundling for production.
        pub fn parse(cache: *@This(), allocator: *std.mem.Allocator, opts: options.TransformOptions, defines: Defines, log: *logger.Log, source: logger.Source) anyerror!?js_ast.Ast {
            var temp_log = logger.Log.init(allocator);
            defer temp_log.deinit();

            var parser = js_parser.Parser.init(opts, temp_log, &source, defines, allocator) catch |err| {
                temp_log.appendTo(log) catch {};
                return null;
            };
            const result = parser.parse() catch |err| {
                temp_log.appendTo(log) catch {};
                return null;
            };

            temp_log.appendTo(log) catch {};
            return if (result.ok) result.ast else null;
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
            {
                cache.mutex.lock();
                defer cache.mutex.unlock();
                if (cache.entries.get(source.key_path.text)) |entry| {
                    return entry.expr;
                }
            }

            var temp_log = logger.Log.init(allocator);
            defer {
                temp_log.appendTo(log) catch {};
            }
            const expr = func(&source, &temp_log, allocator) catch handler: {
                break :handler null;
            };
            const entry = try allocator.create(Entry);
            entry.* = Entry{
                .is_tsconfig = is_tsconfig,
                .source = source,
                .expr = expr,
                .ok = expr != null,
            };

            cache.mutex.lock();
            defer cache.mutex.unlock();
            std.debug.assert(source.key_path.text.len > 0); // missing key_path in source
            try cache.entries.put(source.key_path.text, entry);
            return entry.expr;
        }
        pub fn parseJSON(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: *std.mem.Allocator) anyerror!?js_ast.Expr {
            return @call(std.builtin.CallOptions{ .modifier = .always_tail }, parse, .{ cache, log, source, allocator, false, json_parser.ParseJSON });
        }

        pub fn parseTSConfig(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: *std.mem.Allocator) anyerror!?js_ast.Expr {
            return @call(std.builtin.CallOptions{ .modifier = .always_tail }, parse, .{ cache, log, source, allocator, true, json_parser.ParseTSConfig });
        }
    };
};
