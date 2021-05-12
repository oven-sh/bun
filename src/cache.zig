usingnamespace @import("global.zig");

const js_ast = @import("./js_ast.zig");
const logger = @import("./logger.zig");
const js_parser = @import("./js_parser/js_parser.zig");
const json_parser = @import("./json_parser.zig");
const options = @import("./options.zig");
const Defines = @import("./defines.zig").Defines;
const std = @import("std");
const fs = @import("./fs.zig");

pub const Cache = struct {
    pub const Set = struct {
        js: JavaScript,
        fs: Fs,
        json: Json,

        pub fn init(allocator: *std.mem.Allocator) Set {
            return Set{
                .js = JavaScript{},
                .fs = Fs{
                    .mutex = std.Thread.Mutex{},
                    .entries = std.StringHashMap(Fs.Entry).init(allocator),
                },
                .json = Json{
                    .mutex = std.Thread.Mutex{},
                    .entries = std.StringHashMap(*Json.Entry).init(allocator),
                },
            };
        }
    };
    pub const Fs = struct {
        mutex: std.Thread.Mutex,
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

        pub fn readFile(c: *Fs, _fs: fs.FileSystem, path: string) !*Entry {
            const rfs: _fs.RealFS = _fs.fs;

            {
                const hold = c.mutex.acquire();
                defer hold.release();
                if (c.entries.get(path)) |entry| {
                    return entry;
                }
            }

            // If the file's modification key hasn't changed since it was cached, assume
            // the contents of the file are also the same and skip reading the file.
            var mod_key: ?fs.FileSystem.Implementation.ModKey = rfs.modKey(path) catch |err| {
                switch (err) {
                    error.FileNotFound, error.AccessDenied => {
                        return err;
                    },
                    else => {
                        if (isDebug) {
                            Output.printError("modkey error: {s}", .{@errorName(err)});
                        }
                        mod_key = null;
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

            const hold = c.mutex.acquire();
            defer hold.release();
            var res = c.entries.getOrPut(path, entry) catch unreachable;
            if (res.found_existing) {
                res.entry.value.deinit(c.entries.allocator);
            }

            res.entry.value = entry;
            return &en.value;
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
        mutex: std.Thread.Mutex,
        entries: std.StringHashMap(*Entry),
        pub fn init(allocator: *std.mem.Allocator) Json {
            return Json{
                .mutex = std.Thread.Mutex{},
                .entries = std.StringHashMap(Entry).init(allocator),
            };
        }
        fn parse(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: *std.mem.Allocator, is_tsconfig: bool, func: anytype) anyerror!?Expr {
            {
                const hold = cache.mutex.acquire();
                defer hold.release();
                if (cache.entries.get(source.key_path)) |entry| {
                    return entry.expr;
                }
            }

            var temp_log = logger.Log.init(allocator);
            defer {
                temp_log.appendTo(log) catch {};
            }
            const expr = func(&source, &temp_log, allocator) catch {
                null;
            };
            const entry = try allocator.create(Entry);
            entry.* = Entry{
                .is_tsconfig = is_tsconfig,
                .source = source,
                .expr = expr,
                .ok = expr != null,
            };

            const hold = cache.mutex.acquire();
            defer hold.release();
            std.debug.assert(source.key_path.len > 0); // missing key_path in source
            try cache.entries.put(source.key_path, entry);
            return entry.expr;
        }
        pub fn parseJSON(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: *std.mem.Allocator) anyerror!?Expr {
            return @call(std.builtin.CallOptions{ .modifier = .always_tail }, parse, .{ cache, log, opts, source, allocator, false, json_parser.ParseJSON });
        }

        pub fn parseTSConfig(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: *std.mem.Allocator) anyerror!?Expr {
            return @call(std.builtin.CallOptions{ .modifier = .always_tail }, parse, .{ cache, log, opts, source, allocator, true, json_parser.ParseTSConfig });
        }
    };
};
