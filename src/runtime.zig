const options = @import("./options.zig");
const bun = @import("bun");
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
const resolve_path = @import("./resolver/resolve_path.zig");
const Fs = @import("./fs.zig");
const Schema = @import("./api/schema.zig");
const Ref = @import("ast/base.zig").Ref;
const JSAst = bun.JSAst;
const content = @import("root").content;
// packages/bun-cli-*/bun
const BUN_ROOT = "../../";

const Api = Schema.Api;
fn embedDebugFallback(comptime msg: []const u8, comptime code: []const u8) []const u8 {
    const FallbackMessage = struct {
        pub var has_printed = false;
    };
    if (!FallbackMessage.has_printed) {
        FallbackMessage.has_printed = true;
        Output.debug(msg, .{});
    }

    return code;
}
pub const ErrorCSS = struct {
    pub inline fn sourceContent() string {
        if (comptime Environment.isDebug) {
            var out_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
            var dirname = std.fs.selfExeDirPath(&out_buffer) catch unreachable;
            var paths = [_]string{ dirname, BUN_ROOT, content.error_css_path };
            const file = std.fs.cwd().openFile(
                resolve_path.joinAbsString(dirname, &paths, .auto),
                .{ .mode = .read_only },
            ) catch return embedDebugFallback(
                "Missing packages/bun-error/bun-error.css. Please run \"make bun_error\"",
                content.error_css,
            );
            defer file.close();
            return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
        } else {
            return content.error_css;
        }
    }
};

pub const ReactRefresh = @embedFile("./react-refresh.js");

pub const ErrorJS = struct {
    pub inline fn sourceContent() string {
        if (comptime Environment.isDebug) {
            var out_buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
            var dirname = std.fs.selfExeDirPath(&out_buffer) catch unreachable;
            var paths = [_]string{ dirname, BUN_ROOT, content.error_js_path };
            const file = std.fs.cwd().openFile(
                resolve_path.joinAbsString(dirname, &paths, .auto),
                .{ .mode = .read_only },
            ) catch return embedDebugFallback(
                "Missing " ++ content.error_js_path ++ ". Please run \"make bun_error\"",
                content.error_js,
            );
            defer file.close();
            return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
        } else {
            return content.error_js;
        }
    }
};

pub const Fallback = struct {
    pub const ProdSourceContent = @embedFile("./fallback.out.js");
    pub const HTMLTemplate = @embedFile("./fallback.html");
    pub const HTMLBackendTemplate = @embedFile("./fallback-backend.html");

    const Base64FallbackMessage = struct {
        msg: *const Api.FallbackMessageContainer,
        allocator: std.mem.Allocator,
        pub fn format(this: Base64FallbackMessage, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
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
        if (comptime Environment.isDebug) {
            var dirpath = comptime bun.Environment.base_path ++ std.fs.path.dirname(@src().file).?;
            var env = std.process.getEnvMap(default_allocator) catch unreachable;

            const dir = std.mem.replaceOwned(
                u8,
                default_allocator,
                dirpath,
                "jarred",
                env.get("USER").?,
            ) catch unreachable;
            var runtime_path = std.fs.path.join(default_allocator, &[_]string{ dir, "fallback.out.js" }) catch unreachable;
            const file = std.fs.openFileAbsolute(runtime_path, .{}) catch return embedDebugFallback(
                "Missing bun/src/fallback.out.js. " ++ "Please run \"make fallback_decoder\"",
                ProdSourceContent,
            );
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
        allocator: std.mem.Allocator,
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

    pub fn renderBackend(
        allocator: std.mem.Allocator,
        msg: *const Api.FallbackMessageContainer,
        comptime WriterType: type,
        writer: WriterType,
    ) !void {
        const PrintArgs = struct {
            blob: Base64FallbackMessage,
            bun_error_css: string,
            bun_error: string,
            fallback: string,
            bun_error_page_css: string,
        };
        try writer.print(HTMLBackendTemplate, PrintArgs{
            .blob = Base64FallbackMessage{ .msg = msg, .allocator = allocator },
            .bun_error_css = ErrorCSS.sourceContent(),
            .bun_error = ErrorJS.sourceContent(),
            .bun_error_page_css = "",
            .fallback = scriptContent(),
        });
    }
};

pub const Runtime = struct {
    pub const ProdSourceContent = @embedFile("./runtime.out.js");
    pub const ProdSourceContentNode = @embedFile("./runtime.node.out.js");
    pub const ProdSourceContentBun = @embedFile("./runtime.bun.out.js");
    pub const ProdSourceContentWithRefresh = @embedFile("./runtime.out.refresh.js");

    pub inline fn sourceContentWithoutRefresh() string {
        if (comptime Environment.isDebug) {
            var dirpath = comptime bun.Environment.base_path ++ std.fs.path.dirname(@src().file).?;
            var env = std.process.getEnvMap(default_allocator) catch unreachable;

            const dir = std.mem.replaceOwned(
                u8,
                default_allocator,
                dirpath,
                "jarred",
                env.get("USER").?,
            ) catch unreachable;
            var runtime_path = std.fs.path.join(default_allocator, &[_]string{ dir, "runtime.out.js" }) catch unreachable;
            const file = std.fs.openFileAbsolute(runtime_path, .{}) catch return embedDebugFallback(
                "Missing bun/src/runtime.out.js. " ++ "Please run \"make runtime_js_dev\"",
                ProdSourceContent,
            );
            defer file.close();
            return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
        } else {
            return ProdSourceContent;
        }
    }

    pub inline fn sourceContent(with_refresh: bool) string {
        if (with_refresh) return sourceContentWithRefresh();
        return sourceContentWithoutRefresh();
    }

    pub inline fn sourceContentNode() string {
        return ProdSourceContentNode;
    }

    pub inline fn sourceContentBun() string {
        return ProdSourceContentBun;
    }

    pub inline fn sourceContentWithRefresh() string {
        if (comptime Environment.isDebug) {
            var dirpath = comptime bun.Environment.base_path ++ std.fs.path.dirname(@src().file).?;
            var env = std.process.getEnvMap(default_allocator) catch unreachable;

            const dir = std.mem.replaceOwned(
                u8,
                default_allocator,
                dirpath,
                "jarred",
                env.get("USER").?,
            ) catch unreachable;
            var runtime_path = std.fs.path.join(default_allocator, &[_]string{ dir, "runtime.out.refresh.js" }) catch unreachable;
            const file = std.fs.openFileAbsolute(runtime_path, .{}) catch return embedDebugFallback(
                "Missing bun/src/runtime.out.refresh.js. " ++ "Please run \"make runtime_js_dev\"",
                ProdSourceContentWithRefresh,
            );
            defer file.close();
            return file.readToEndAlloc(default_allocator, (file.stat() catch unreachable).size) catch unreachable;
        } else {
            return ProdSourceContentWithRefresh;
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

    pub inline fn version() string {
        return version_hash;
    }

    const bytecodeCacheFilename = std.fmt.comptimePrint("__runtime.{s}", .{version_hash});
    var bytecodeCacheFetcher = Fs.BytecodeCacheFetcher{};

    pub fn byteCodeCacheFile(fs: *Fs.FileSystem.RealFS) ?bun.StoredFileDescriptorType {
        return bytecodeCacheFetcher.fetch(bytecodeCacheFilename, fs);
    }

    pub const Features = struct {
        react_fast_refresh: bool = false,
        hot_module_reloading: bool = false,
        is_macro_runtime: bool = false,
        top_level_await: bool = false,
        auto_import_jsx: bool = false,
        allow_runtime: bool = true,
        inlining: bool = false,

        inject_jest_globals: bool = false,

        commonjs_named_exports: bool = true,

        /// Instead of jsx("div", {}, void 0)
        /// ->
        /// {
        ///    "type": "div",
        ///    "props": {},
        ///    "children": [],
        ///    key: void 0,
        ///   $$typeof: Symbol.for("react.element"),
        /// }
        /// See also https://github.com/babel/babel/commit/3cad2872335e2130f2ff6335027617ebbe9b5a46
        /// See also https://github.com/babel/babel/pull/2972
        /// See also https://github.com/facebook/react/issues/5138
        jsx_optimization_inline: bool = false,
        jsx_optimization_hoist: bool = false,

        trim_unused_imports: bool = false,
        should_fold_numeric_constants: bool = false,

        /// Use `import.meta.require()` instead of require()?
        /// This is only supported in Bun.
        dynamic_require: bool = false,

        replace_exports: ReplaceableExport.Map = .{},

        hoist_bun_plugin: bool = false,

        pub const ReplaceableExport = union(enum) {
            delete: void,
            replace: JSAst.Expr,
            inject: struct {
                name: string,
                value: JSAst.Expr,
            },

            pub const Map = bun.StringArrayHashMapUnmanaged(ReplaceableExport);
        };
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
        __FastRefreshRuntime: ?GeneratedSymbol = null,
        __merge: ?GeneratedSymbol = null,
        __decorateClass: ?GeneratedSymbol = null,
        __decorateParam: ?GeneratedSymbol = null,
        @"$$typeof": ?GeneratedSymbol = null,

        pub const all = [_][]const u8{
            // __HMRClient goes first
            // This is so we can call Bun.activate(true) as soon as possible
            "__HMRClient",
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
            "__FastRefreshModule",
            "__exportValue",
            "__exportDefault",
            "__FastRefreshRuntime",
            "__merge",
            "__decorateClass",
            "__decorateParam",
            "$$typeof",
        };
        const all_sorted: [all.len]string = brk: {
            var list = all;
            const Sorter = struct {
                fn compare(_: void, a: []const u8, b: []const u8) bool {
                    return std.mem.order(u8, a, b) == .lt;
                }
            };
            std.sort.sort(string, &list, void{}, Sorter.compare);
            break :brk list;
        };

        /// When generating the list of runtime imports, we sort it for determinism.
        /// This is a lookup table so we don't need to resort the strings each time
        pub const all_sorted_index = brk: {
            var out: [all.len]usize = undefined;
            inline for (all, 0..) |name, i| {
                for (all_sorted, 0..) |cmp, j| {
                    if (strings.eqlComptime(name, cmp)) {
                        out[i] = j;
                        break;
                    }
                }
            }

            break :brk out;
        };

        pub const Name = "bun:wrap";
        pub const alt_name = "bun:wrap";

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
                        14 => {
                            if (@field(this.runtime_imports, all[14])) |val| {
                                return Entry{ .key = 14, .value = val.ref };
                            }
                        },
                        15 => {
                            if (@field(this.runtime_imports, all[15])) |val| {
                                return Entry{ .key = 15, .value = val.ref };
                            }
                        },
                        16 => {
                            if (@field(this.runtime_imports, all[16])) |val| {
                                return Entry{ .key = 16, .value = val.ref };
                            }
                        },
                        17 => {
                            if (@field(this.runtime_imports, all[17])) |val| {
                                return Entry{ .key = 17, .value = val.ref };
                            }
                        },
                        18 => {
                            if (@field(this.runtime_imports, all[18])) |val| {
                                return Entry{ .key = 18, .value = val.ref };
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
                14 => (@field(imports, all[14]) orelse return null).ref,
                15 => (@field(imports, all[15]) orelse return null).ref,
                16 => (@field(imports, all[16]) orelse return null).ref,
                17 => (@field(imports, all[17]) orelse return null).ref,
                18 => (@field(imports, all[18]) orelse return null).ref,
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
