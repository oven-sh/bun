const options = @import("./options.zig");
usingnamespace @import("ast/base.zig");
usingnamespace @import("global.zig");
const std = @import("std");
const resolve_path = @import("./resolver/resolve_path.zig");
const Fs = @import("./fs.zig");
const Schema = @import("./api/schema.zig");

// packages/bun-cli-*/bin/bun
const BUN_ROOT = "../../../";

const Api = Schema.Api;

pub const ErrorCSS = struct {
    const ErrorCSSPath = "packages/bun-error/dist/bun-error.css";
    const ErrorCSSPathDev = "packages/bun-error/bun-error.css";

    pub const ProdSourceContent = @embedFile("../" ++ ErrorCSSPath);

    pub fn sourceContent() string {
        if (comptime isDebug) {
            var env = std.process.getEnvMap(default_allocator) catch unreachable;
            var out_buffer: [std.fs.MAX_PATH_BYTES]u8 = undefined;
            var dirname = std.fs.selfExeDirPath(&out_buffer) catch unreachable;
            var paths = [_]string{ dirname, BUN_ROOT, ErrorCSSPathDev };
            const file = std.fs.cwd().openFile(
                resolve_path.joinAbsString(dirname, std.mem.span(&paths), .auto),
                .{
                    .read = true,
                },
            ) catch unreachable;
            defer file.close();
            return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
        } else {
            return ProdSourceContent;
        }
    }
};

pub const ErrorJS = struct {
    const ErrorJSPath = "packages/bun-error/dist/index.js";

    pub const ProdSourceContent = @embedFile("../" ++ ErrorJSPath);

    pub fn sourceContent() string {
        if (comptime isDebug) {
            var env = std.process.getEnvMap(default_allocator) catch unreachable;
            var out_buffer: [std.fs.MAX_PATH_BYTES]u8 = undefined;
            var dirname = std.fs.selfExeDirPath(&out_buffer) catch unreachable;
            var paths = [_]string{ dirname, BUN_ROOT, ErrorJSPath };
            const file = std.fs.cwd().openFile(
                resolve_path.joinAbsString(dirname, std.mem.span(&paths), .auto),
                .{
                    .read = true,
                },
            ) catch unreachable;
            defer file.close();
            return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
        } else {
            return ProdSourceContent;
        }
    }
};

pub const Fallback = struct {
    pub const ProdSourceContent = @embedFile("./fallback.out.js");
    pub const HTMLTemplate = @embedFile("./fallback.html");

    const Base64FallbackMessage = struct {
        msg: *const Api.FallbackMessageContainer,
        allocator: *std.mem.Allocator,
        pub fn format(this: Base64FallbackMessage, comptime fmt: []const u8, opts_: std.fmt.FormatOptions, writer: anytype) !void {
            var bb = std.ArrayList(u8).init(this.allocator);
            defer bb.deinit();
            var bb_writer = bb.writer();
            const Encoder = Schema.Writer(@TypeOf(bb_writer));
            var encoder = Encoder.init(bb_writer);
            this.msg.encode(&encoder) catch {};

            Base64Encoder.encode(bb.items, @TypeOf(writer), writer) catch {};
        }

        pub const Base64Encoder = struct {
            const alphabet_chars = std.base64.standard_alphabet_chars;

            pub fn encode(source: []const u8, comptime Writer: type, writer: Writer) !void {
                var acc: u12 = 0;
                var acc_len: u4 = 0;
                for (source) |v| {
                    acc = (acc << 8) + v;
                    acc_len += 8;
                    while (acc_len >= 6) {
                        acc_len -= 6;
                        try writer.writeByte(alphabet_chars[@truncate(u6, (acc >> acc_len))]);
                    }
                }
                if (acc_len > 0) {
                    try writer.writeByte(alphabet_chars[@truncate(u6, (acc << 6 - acc_len))]);
                }
            }
        };
    };

    pub inline fn scriptContent() string {
        if (comptime isDebug) {
            var dirpath = std.fs.path.dirname(@src().file).?;
            var env = std.process.getEnvMap(default_allocator) catch unreachable;

            const dir = std.mem.replaceOwned(
                u8,
                default_allocator,
                dirpath,
                "jarred",
                env.get("USER").?,
            ) catch unreachable;
            var runtime_path = std.fs.path.join(default_allocator, &[_]string{ dir, "fallback.out.js" }) catch unreachable;
            const file = std.fs.openFileAbsolute(runtime_path, .{}) catch unreachable;
            defer file.close();
            return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
        } else {
            return ProdSourceContent;
        }
    }
    pub const version_hash = @embedFile("./fallback.version");
    var version_hash_int: u32 = 0;
    pub fn versionHash() u32 {
        if (version_hash_int == 0) {
            version_hash_int = @truncate(u32, std.fmt.parseInt(u64, version(), 16) catch unreachable);
        }
        return version_hash_int;
    }

    pub fn version() string {
        return version_hash;
    }

    pub fn render(
        allocator: *std.mem.Allocator,
        msg: *const Api.FallbackMessageContainer,
        preload: string,
        entry_point: string,
        comptime WriterType: type,
        writer: WriterType,
    ) !void {
        const PrintArgs = struct {
            blob: Base64FallbackMessage,
            preload: string,
            fallback: string,
            entry_point: string,
        };
        try writer.print(HTMLTemplate, PrintArgs{
            .blob = Base64FallbackMessage{ .msg = msg, .allocator = allocator },
            .preload = preload,
            .fallback = scriptContent(),
            .entry_point = entry_point,
        });
    }
};

pub const Runtime = struct {
    pub const ProdSourceContent = @embedFile("./runtime.out.js");

    pub fn sourceContent() string {
        if (comptime isDebug) {
            var dirpath = std.fs.path.dirname(@src().file).?;
            var env = std.process.getEnvMap(default_allocator) catch unreachable;

            const dir = std.mem.replaceOwned(
                u8,
                default_allocator,
                dirpath,
                "jarred",
                env.get("USER").?,
            ) catch unreachable;
            var runtime_path = std.fs.path.join(default_allocator, &[_]string{ dir, "runtime.out.js" }) catch unreachable;
            const file = std.fs.openFileAbsolute(runtime_path, .{}) catch unreachable;
            defer file.close();
            return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
        } else {
            return ProdSourceContent;
        }
    }
    pub const version_hash = @embedFile("./runtime.version");
    var version_hash_int: u32 = 0;
    pub fn versionHash() u32 {
        if (version_hash_int == 0) {
            version_hash_int = @truncate(u32, std.fmt.parseInt(u64, version(), 16) catch unreachable);
        }
        return version_hash_int;
    }

    pub fn version() string {
        return version_hash;
    }

    const bytecodeCacheFilename = std.fmt.comptimePrint("__runtime.{s}", .{version_hash});
    var bytecodeCacheFetcher = Fs.BytecodeCacheFetcher{};

    pub fn byteCodeCacheFile(fs: *Fs.FileSystem.RealFS) ?StoredFileDescriptorType {
        return bytecodeCacheFetcher.fetch(bytecodeCacheFilename, fs);
    }

    pub const Features = struct {
        react_fast_refresh: bool = false,
        hot_module_reloading: bool = false,
        hot_module_reloading_entry: bool = false,
        keep_names_for_arrow_functions: bool = true,
        is_macro_runtime: bool = false,
        top_level_await: bool = false,
    };

    pub const Names = struct {
        pub const ActivateFunction = "activate";
    };

    pub const GeneratedSymbol = struct {
        primary: Ref,
        backup: Ref,
        ref: Ref,
    };

    // If you change this, remember to update "runtime.footer.js" and rebuild the runtime.js
    pub const Imports = struct {
        __name: ?GeneratedSymbol = null,
        __toModule: ?GeneratedSymbol = null,
        __cJS2eSM: ?GeneratedSymbol = null,
        __require: ?GeneratedSymbol = null,
        __export: ?GeneratedSymbol = null,
        __reExport: ?GeneratedSymbol = null,
        __load: ?GeneratedSymbol = null,
        @"$$m": ?GeneratedSymbol = null,
        @"$$lzy": ?GeneratedSymbol = null,
        __HMRModule: ?GeneratedSymbol = null,
        __HMRClient: ?GeneratedSymbol = null,
        __FastRefreshModule: ?GeneratedSymbol = null,
        __exportValue: ?GeneratedSymbol = null,
        __exportDefault: ?GeneratedSymbol = null,

        pub const all = [_][]const u8{
            "__name",
            "__toModule",
            "__require",
            "__cJS2eSM",
            "__export",
            "__reExport",
            "__load",
            "$$m",
            "$$lzy",
            "__HMRModule",
            "__HMRClient",
            "__FastRefreshModule",
            "__exportValue",
            "__exportDefault",
        };
        pub const Name = "<RUNTIME";
        pub const alt_name = "__runtime.js";

        pub const Iterator = struct {
            i: usize = 0,

            runtime_imports: *Imports,

            const Entry = struct {
                key: u16,
                value: Ref,
            };

            pub fn next(this: *Iterator) ?Entry {
                while (this.i < all.len) {
                    defer this.i += 1;

                    switch (this.i) {
                        0 => {
                            if (@field(this.runtime_imports, all[0])) |val| {
                                return Entry{ .key = 0, .value = val.ref };
                            }
                        },
                        1 => {
                            if (@field(this.runtime_imports, all[1])) |val| {
                                return Entry{ .key = 1, .value = val.ref };
                            }
                        },
                        2 => {
                            if (@field(this.runtime_imports, all[2])) |val| {
                                return Entry{ .key = 2, .value = val.ref };
                            }
                        },
                        3 => {
                            if (@field(this.runtime_imports, all[3])) |val| {
                                return Entry{ .key = 3, .value = val.ref };
                            }
                        },
                        4 => {
                            if (@field(this.runtime_imports, all[4])) |val| {
                                return Entry{ .key = 4, .value = val.ref };
                            }
                        },
                        5 => {
                            if (@field(this.runtime_imports, all[5])) |val| {
                                return Entry{ .key = 5, .value = val.ref };
                            }
                        },
                        6 => {
                            if (@field(this.runtime_imports, all[6])) |val| {
                                return Entry{ .key = 6, .value = val.ref };
                            }
                        },
                        7 => {
                            if (@field(this.runtime_imports, all[7])) |val| {
                                return Entry{ .key = 7, .value = val.ref };
                            }
                        },
                        8 => {
                            if (@field(this.runtime_imports, all[8])) |val| {
                                return Entry{ .key = 8, .value = val.ref };
                            }
                        },
                        9 => {
                            if (@field(this.runtime_imports, all[9])) |val| {
                                return Entry{ .key = 9, .value = val.ref };
                            }
                        },
                        10 => {
                            if (@field(this.runtime_imports, all[10])) |val| {
                                return Entry{ .key = 10, .value = val.ref };
                            }
                        },
                        11 => {
                            if (@field(this.runtime_imports, all[11])) |val| {
                                return Entry{ .key = 11, .value = val.ref };
                            }
                        },
                        12 => {
                            if (@field(this.runtime_imports, all[12])) |val| {
                                return Entry{ .key = 12, .value = val.ref };
                            }
                        },
                        13 => {
                            if (@field(this.runtime_imports, all[13])) |val| {
                                return Entry{ .key = 13, .value = val.ref };
                            }
                        },
                        else => {
                            return null;
                        },
                    }
                }

                return null;
            }
        };

        pub fn iter(imports: *Imports) Iterator {
            return Iterator{ .runtime_imports = imports };
        }

        pub fn contains(imports: *const Imports, comptime key: string) bool {
            return @field(imports, key) != null;
        }

        pub fn hasAny(imports: *const Imports) bool {
            inline for (all) |field| {
                if (@field(imports, field) != null) {
                    return true;
                }
            }

            return false;
        }

        pub fn put(imports: *Imports, comptime key: string, generated_symbol: GeneratedSymbol) void {
            @field(imports, key) = generated_symbol;
        }

        pub fn at(
            imports: *Imports,
            comptime key: string,
        ) ?Ref {
            return (@field(imports, key) orelse return null).ref;
        }

        pub fn get(
            imports: *const Imports,
            key: anytype,
        ) ?Ref {
            return switch (key) {
                0 => (@field(imports, all[0]) orelse return null).ref,
                1 => (@field(imports, all[1]) orelse return null).ref,
                2 => (@field(imports, all[2]) orelse return null).ref,
                3 => (@field(imports, all[3]) orelse return null).ref,
                4 => (@field(imports, all[4]) orelse return null).ref,
                5 => (@field(imports, all[5]) orelse return null).ref,
                6 => (@field(imports, all[6]) orelse return null).ref,
                7 => (@field(imports, all[7]) orelse return null).ref,
                8 => (@field(imports, all[8]) orelse return null).ref,
                9 => (@field(imports, all[9]) orelse return null).ref,
                10 => (@field(imports, all[10]) orelse return null).ref,
                11 => (@field(imports, all[11]) orelse return null).ref,
                12 => (@field(imports, all[12]) orelse return null).ref,
                13 => (@field(imports, all[13]) orelse return null).ref,
                else => null,
            };
        }

        pub fn count(imports: *const Imports) usize {
            var i: usize = 0;

            inline for (all) |field| {
                if (@field(imports, field) != null) {
                    i += 1;
                }
            }

            return i;
        }
    };
};
