const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const FeatureFlags = bun.FeatureFlags;
const default_allocator = bun.default_allocator;
const C = bun.C;

const js_ast = bun.JSAst;
const logger = @import("root").bun.logger;
const js_parser = bun.js_parser;
const json_parser = bun.JSON;
const options = @import("./options.zig");
const Define = @import("./defines.zig").Define;
const std = @import("std");
const fs = @import("./fs.zig");
const sync = @import("sync.zig");
const Mutex = @import("./lock.zig").Lock;

const import_record = @import("./import_record.zig");

const ImportRecord = import_record.ImportRecord;

pub const Set = struct {
    js: JavaScript,
    fs: Fs,
    json: Json,

    pub fn init(allocator: std.mem.Allocator) Set {
        return Set{
            .js = JavaScript.init(allocator),
            .fs = Fs{
                .shared_buffer = MutableString.init(allocator, 0) catch unreachable,
                .macro_shared_buffer = MutableString.init(allocator, 0) catch unreachable,
            },
            .json = Json{},
        };
    }
};
const debug = Output.scoped(.fs, false);
pub const Fs = struct {
    pub const Entry = struct {
        contents: string,
        fd: StoredFileDescriptorType = bun.invalid_fd,

        pub fn deinit(entry: *Entry, allocator: std.mem.Allocator) void {
            if (entry.contents.len > 0) {
                allocator.free(entry.contents);
                entry.contents = "";
            }
        }

        pub fn closeFD(entry: *Entry) ?bun.sys.Error {
            if (entry.fd != bun.invalid_fd) {
                defer {
                    entry.fd = bun.invalid_fd;
                }
                return bun.sys.close(entry.fd);
            }
            return null;
        }
    };

    shared_buffer: MutableString,
    macro_shared_buffer: MutableString,

    use_alternate_source_cache: bool = false,
    stream: bool = false,

    // When we are in a macro, the shared buffer may be in use by the in-progress macro.
    // so we have to dynamically switch it out.
    pub inline fn sharedBuffer(this: *Fs) *MutableString {
        return if (!this.use_alternate_source_cache)
            &this.shared_buffer
        else
            &this.macro_shared_buffer;
    }

    /// When we need to suspend/resume something that has pointers into the shared buffer, we need to
    /// switch out the shared buffer so that it is not in use
    /// The caller must
    pub fn resetSharedBuffer(this: *Fs, buffer: *MutableString) void {
        if (buffer == &this.shared_buffer) {
            this.shared_buffer = MutableString.initEmpty(bun.default_allocator);
        } else if (buffer == &this.macro_shared_buffer) {
            this.macro_shared_buffer = MutableString.initEmpty(bun.default_allocator);
        } else {
            bun.unreachablePanic("resetSharedBuffer: invalid buffer", .{});
        }
    }

    pub fn deinit(c: *Fs) void {
        var iter = c.entries.iterator();
        while (iter.next()) |entry| {
            entry.value.deinit(c.entries.allocator);
        }
        c.entries.deinit();
    }

    pub fn readFileShared(
        this: *Fs,
        _fs: *fs.FileSystem,
        path: [:0]const u8,
        _: StoredFileDescriptorType,
        _file_handle: ?StoredFileDescriptorType,
        shared: *MutableString,
    ) !Entry {
        var rfs = _fs.fs;

        const file_handle: std.fs.File = if (_file_handle) |__file|
            std.fs.File{ .handle = __file }
        else
            try std.fs.openFileAbsoluteZ(path, .{ .mode = .read_only });

        defer {
            if (rfs.needToCloseFiles() and _file_handle == null) {
                file_handle.close();
            }
        }

        const file = if (this.stream)
            rfs.readFileWithHandle(path, null, file_handle, true, shared, true) catch |err| {
                if (comptime Environment.isDebug) {
                    Output.printError("{s}: readFile error -- {s}", .{ path, @errorName(err) });
                }
                return err;
            }
        else
            rfs.readFileWithHandle(path, null, file_handle, true, shared, false) catch |err| {
                if (comptime Environment.isDebug) {
                    Output.printError("{s}: readFile error -- {s}", .{ path, @errorName(err) });
                }
                return err;
            };

        return Entry{
            .contents = file.contents,
            .fd = if (FeatureFlags.store_file_descriptors) file_handle.handle else 0,
        };
    }

    pub fn readFile(
        c: *Fs,
        _fs: *fs.FileSystem,
        path: string,
        dirname_fd: StoredFileDescriptorType,
        comptime use_shared_buffer: bool,
        _file_handle: ?StoredFileDescriptorType,
    ) !Entry {
        return c.readFileWithAllocator(bun.fs_allocator, _fs, path, dirname_fd, use_shared_buffer, _file_handle);
    }

    pub fn readFileWithAllocator(
        c: *Fs,
        allocator: std.mem.Allocator,
        _fs: *fs.FileSystem,
        path: string,
        dirname_fd: StoredFileDescriptorType,
        comptime use_shared_buffer: bool,
        _file_handle: ?StoredFileDescriptorType,
    ) !Entry {
        var rfs = _fs.fs;

        var file_handle: std.fs.File = if (_file_handle) |__file| std.fs.File{ .handle = bun.fdcast(__file) } else undefined;

        if (_file_handle == null) {
            if (FeatureFlags.store_file_descriptors and dirname_fd != bun.invalid_fd and dirname_fd > 0) {
                file_handle = std.fs.Dir.openFile(std.fs.Dir{ .fd = dirname_fd }, std.fs.path.basename(path), .{ .mode = .read_only }) catch |err| brk: {
                    switch (err) {
                        error.FileNotFound => {
                            const handle = try std.fs.openFileAbsolute(path, .{ .mode = .read_only });
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
                file_handle = try std.fs.cwd().openFile(path, .{ .mode = .read_only });
            }
        }

        debug("openat({d}, {s}) = {d}", .{ dirname_fd, path, file_handle.handle });

        const will_close = rfs.needToCloseFiles() and _file_handle == null;
        defer {
            if (will_close) {
                debug("close({d})", .{file_handle.handle});
                file_handle.close();
            }
        }

        const file = if (c.stream)
            rfs.readFileWithHandleAndAllocator(allocator, path, null, file_handle, use_shared_buffer, c.sharedBuffer(), true) catch |err| {
                if (Environment.isDebug) {
                    Output.printError("{s}: readFile error -- {s}", .{ path, @errorName(err) });
                }
                return err;
            }
        else
            rfs.readFileWithHandleAndAllocator(allocator, path, null, file_handle, use_shared_buffer, c.sharedBuffer(), false) catch |err| {
                if (Environment.isDebug) {
                    Output.printError("{s}: readFile error -- {s}", .{ path, @errorName(err) });
                }
                return err;
            };

        return Entry{
            .contents = file.contents,
            .fd = if (FeatureFlags.store_file_descriptors and !will_close) file_handle.handle else bun.invalid_fd,
        };
    }
};

pub const Css = struct {
    pub const Entry = struct {};
    pub const Result = struct {
        ok: bool,
        value: void,
    };
    pub fn parse(_: *@This(), _: *logger.Log, _: logger.Source) !Result {
        Global.notimpl();
    }
};

pub const JavaScript = struct {
    pub const Result = js_ast.Result;

    pub fn init(_: std.mem.Allocator) JavaScript {
        return JavaScript{};
    }
    // For now, we're not going to cache JavaScript ASTs.
    // It's probably only relevant when bundling for production.
    pub fn parse(
        _: *const @This(),
        allocator: std.mem.Allocator,
        opts: js_parser.Parser.Options,
        defines: *Define,
        log: *logger.Log,
        source: *const logger.Source,
    ) anyerror!?js_ast.Result {
        var temp_log = logger.Log.init(allocator);
        var parser = js_parser.Parser.init(opts, &temp_log, source, defines, allocator) catch {
            temp_log.appendToMaybeRecycled(log, source) catch {};
            return null;
        };

        const result = parser.parse() catch |err| {
            if (temp_log.errors == 0) {
                log.addRangeError(source, parser.lexer.range(), @errorName(err)) catch unreachable;
            }

            temp_log.appendToMaybeRecycled(log, source) catch {};
            return null;
        };

        temp_log.appendToMaybeRecycled(log, source) catch {};
        return result;
    }

    pub fn scan(
        _: *@This(),
        allocator: std.mem.Allocator,
        scan_pass_result: *js_parser.ScanPassResult,
        opts: js_parser.Parser.Options,
        defines: *Define,
        log: *logger.Log,
        source: *const logger.Source,
    ) anyerror!void {
        if (strings.trim(source.contents, "\n\t\r ").len == 0) {
            return;
        }

        var temp_log = logger.Log.init(allocator);
        defer temp_log.appendToMaybeRecycled(log, source) catch {};

        var parser = js_parser.Parser.init(opts, &temp_log, source, defines, allocator) catch return;

        return try parser.scanImports(scan_pass_result);
    }
};

pub const Json = struct {
    pub fn init(_: std.mem.Allocator) Json {
        return Json{};
    }
    fn parse(_: *@This(), log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator, comptime func: anytype) anyerror!?js_ast.Expr {
        var temp_log = logger.Log.init(allocator);
        defer {
            temp_log.appendToMaybeRecycled(log, &source) catch {};
        }
        return func(&source, &temp_log, allocator) catch handler: {
            break :handler null;
        };
    }
    pub fn parseJSON(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator) anyerror!?js_ast.Expr {
        // tsconfig.* and jsconfig.* files are JSON files, but they are not valid JSON files.
        // They are JSON files with comments and trailing commas.
        // Sometimes tooling expects this to work.
        if (source.path.isJSONCFile()) {
            return try parse(cache, log, source, allocator, json_parser.ParseTSConfig);
        }

        return try parse(cache, log, source, allocator, json_parser.ParseJSON);
    }

    pub fn parseTSConfig(cache: *@This(), log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator) anyerror!?js_ast.Expr {
        return try parse(cache, log, source, allocator, json_parser.ParseTSConfig);
    }
};
