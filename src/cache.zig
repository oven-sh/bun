const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const FeatureFlags = bun.FeatureFlags;
const default_allocator = bun.default_allocator;

const js_ast = bun.JSAst;
const logger = bun.logger;
const js_parser = bun.js_parser;
const json_parser = bun.JSON;
const Define = @import("./defines.zig").Define;
const std = @import("std");
const fs = @import("./fs.zig");

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
        fd: StoredFileDescriptorType,
        /// When `contents` comes from a native plugin, this field is populated
        /// with information on how to free it.
        external_free_function: ExternalFreeFunction = .none,

        pub const ExternalFreeFunction = struct {
            ctx: ?*anyopaque,
            function: ?*const fn (?*anyopaque) callconv(.C) void,

            pub const none: ExternalFreeFunction = .{ .ctx = null, .function = null };

            pub fn call(this: *const @This()) void {
                if (this.function) |func| {
                    func(this.ctx);
                }
            }
        };

        pub fn deinit(entry: *Entry, allocator: std.mem.Allocator) void {
            if (entry.external_free_function.function) |func| {
                func(entry.external_free_function.ctx);
            } else if (entry.contents.len > 0) {
                allocator.free(entry.contents);
                entry.contents = "";
            }
        }

        pub fn closeFD(entry: *Entry) ?bun.sys.Error {
            if (entry.fd.isValid()) {
                defer entry.fd = .invalid;
                return entry.fd.closeAllowingBadFileDescriptor(@returnAddress());
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
        cached_file_descriptor: ?StoredFileDescriptorType,
        shared: *MutableString,
    ) !Entry {
        var rfs = _fs.fs;

        const file_handle: std.fs.File = if (cached_file_descriptor) |fd| handle: {
            const handle = std.fs.File{ .handle = fd };
            try handle.seekTo(0);
            break :handle handle;
        } else try std.fs.openFileAbsoluteZ(path, .{ .mode = .read_only });

        defer {
            if (rfs.needToCloseFiles() and cached_file_descriptor == null) {
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

        var file_handle: std.fs.File = if (_file_handle) |__file| __file.stdFile() else undefined;

        if (_file_handle == null) {
            if (FeatureFlags.store_file_descriptors and dirname_fd.isValid()) {
                file_handle = (bun.sys.openatA(dirname_fd, std.fs.path.basename(path), bun.O.RDONLY, 0).unwrap() catch |err| brk: {
                    switch (err) {
                        error.ENOENT => {
                            const handle = try bun.openFile(path, .{ .mode = .read_only });
                            Output.prettyErrorln(
                                "<r><d>Internal error: directory mismatch for directory \"{s}\", fd {}<r>. You don't need to do anything, but this indicates a bug.",
                                .{ path, dirname_fd },
                            );
                            break :brk bun.FD.fromStdFile(handle);
                        },
                        else => return err,
                    }
                }).stdFile();
            } else {
                file_handle = try bun.openFile(path, .{ .mode = .read_only });
            }
        } else {
            try file_handle.seekTo(0);
        }

        if (comptime !Environment.isWindows) // skip on Windows because NTCreateFile will do it.
            debug("openat({}, {s}) = {}", .{ dirname_fd, path, bun.FD.fromStdFile(file_handle) });

        const will_close = rfs.needToCloseFiles() and _file_handle == null;
        defer {
            if (will_close) {
                debug("readFileWithAllocator close({d})", .{file_handle.handle});
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
            .fd = if (FeatureFlags.store_file_descriptors and !will_close) .fromStdFile(file_handle) else bun.invalid_fd,
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
        temp_log.level = log.level;
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
    fn parse(_: *@This(), log: *logger.Log, source: *const logger.Source, allocator: std.mem.Allocator, comptime func: anytype, comptime force_utf8: bool) anyerror!?js_ast.Expr {
        var temp_log = logger.Log.init(allocator);
        defer {
            temp_log.appendToMaybeRecycled(log, source) catch {};
        }
        return func(source, &temp_log, allocator, force_utf8) catch handler: {
            break :handler null;
        };
    }
    pub fn parseJSON(cache: *@This(), log: *logger.Log, source: *const logger.Source, allocator: std.mem.Allocator, mode: enum { json, jsonc }, comptime force_utf8: bool) anyerror!?js_ast.Expr {
        // tsconfig.* and jsconfig.* files are JSON files, but they are not valid JSON files.
        // They are JSON files with comments and trailing commas.
        // Sometimes tooling expects this to work.
        if (mode == .jsonc) {
            return try parse(cache, log, source, allocator, json_parser.parseTSConfig, force_utf8);
        }

        return try parse(cache, log, source, allocator, json_parser.parse, force_utf8);
    }

    pub fn parsePackageJSON(cache: *@This(), log: *logger.Log, source: *const logger.Source, allocator: std.mem.Allocator, comptime force_utf8: bool) anyerror!?js_ast.Expr {
        return try parse(cache, log, source, allocator, json_parser.parseTSConfig, force_utf8);
    }

    pub fn parseTSConfig(cache: *@This(), log: *logger.Log, source: *const logger.Source, allocator: std.mem.Allocator) anyerror!?js_ast.Expr {
        return try parse(cache, log, source, allocator, json_parser.parseTSConfig, true);
    }
};
