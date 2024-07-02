const options = @import("./options.zig");
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
            var out_buffer: bun.PathBuffer = undefined;
            const dirname = std.fs.selfExeDirPath(&out_buffer) catch unreachable;
            var paths = [_]string{ dirname, BUN_ROOT, content.error_css_path };
            const file = std.fs.cwd().openFile(
                resolve_path.joinAbsString(dirname, &paths, .auto),
                .{ .mode = .read_only },
            ) catch return embedDebugFallback(
                "Missing packages/bun-error/bun-error.css. Please run \"make bun_error\"",
                content.error_css,
            );
            defer file.close();
            return file.readToEndAlloc(default_allocator, file.getEndPos() catch 0) catch unreachable;
        } else {
            return content.error_css;
        }
    }
};

pub const ReactRefresh = @embedFile("./react-refresh.js");

pub const ErrorJS = struct {
    pub inline fn sourceContent() string {
        if (comptime Environment.isDebug) {
            var out_buffer: bun.PathBuffer = undefined;
            const dirname = std.fs.selfExeDirPath(&out_buffer) catch unreachable;
            var paths = [_]string{ dirname, BUN_ROOT, content.error_js_path };
            const file = std.fs.cwd().openFile(
                resolve_path.joinAbsString(dirname, &paths, .auto),
                .{ .mode = .read_only },
            ) catch return embedDebugFallback(
                "Missing " ++ content.error_js_path ++ ". Please run \"make bun_error\"",
                content.error_js,
            );
            defer file.close();
            return file.readToEndAlloc(default_allocator, file.getEndPos() catch 0) catch unreachable;
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
            const bb_writer = bb.writer();
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
                        try writer.writeByte(alphabet_chars[@as(u6, @truncate((acc >> acc_len)))]);
                    }
                }
                if (acc_len > 0) {
                    try writer.writeByte(alphabet_chars[@as(u6, @truncate((acc << 6 - acc_len)))]);
                }
            }
        };
    };

    pub inline fn scriptContent() string {
        if (comptime Environment.isDebug) {
            const dirpath = comptime bun.Environment.base_path ++ (bun.Dirname.dirname(u8, @src().file) orelse "");
            var buf: bun.PathBuffer = undefined;
            const user = bun.getUserName(&buf) orelse "";
            const dir = std.mem.replaceOwned(
                u8,
                default_allocator,
                dirpath,
                "jarred",
                user,
            ) catch unreachable;
            const runtime_path = std.fs.path.join(default_allocator, &[_]string{ dir, "fallback.out.js" }) catch unreachable;
            const file = std.fs.openFileAbsolute(runtime_path, .{}) catch return embedDebugFallback(
                "Missing bun/src/fallback.out.js. " ++ "Please run \"make fallback_decoder\"",
                ProdSourceContent,
            );
            defer file.close();
            return file.readToEndAlloc(default_allocator, file.getEndPos() catch 0) catch unreachable;
        } else {
            return ProdSourceContent;
        }
    }
    pub const version_hash = @import("build_options").fallback_html_version;
    var version_hash_int: u32 = 0;
    pub fn versionHash() u32 {
        if (version_hash_int == 0) {
            version_hash_int = @as(u32, @truncate(std.fmt.parseInt(u64, version(), 16) catch unreachable));
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
    pub const source_code = @embedFile("./runtime.out.js");

    pub const hash = brk: {
        @setEvalBranchQuota(source_code.len * 50);
        break :brk bun.Wyhash11.hash(0, source_code);
    };
    pub fn versionHash() u32 {
        return @truncate(hash);
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

        no_macros: bool = false,

        commonjs_named_exports: bool = true,

        minify_syntax: bool = false,
        minify_identifiers: bool = false,
        dead_code_elimination: bool = true,

        set_breakpoint_on_first_line: bool = false,

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

        /// Use `import.meta.require()` instead of require()?
        /// This is only supported in Bun.
        use_import_meta_require: bool = false,

        replace_exports: ReplaceableExport.Map = .{},

        dont_bundle_twice: bool = false,

        /// This is a list of packages which even when require() is used, we will
        /// instead convert to ESM import statements.
        ///
        /// This is not normally a safe transformation.
        ///
        /// So we have a list of packages which we know are safe to do this with.
        unwrap_commonjs_packages: []const string = &.{},

        commonjs_at_runtime: bool = false,

        emit_decorator_metadata: bool = false,

        /// If true and if the source is transpiled as cjs, don't wrap the module.
        /// This is used for `--print` entry points so we can get the result.
        remove_cjs_module_wrapper: bool = false,

        runtime_transpiler_cache: ?*bun.JSC.RuntimeTranspilerCache = null,

        // TODO: make this a bitset of all unsupported features
        lower_using: bool = true,

        const hash_fields_for_runtime_transpiler = .{
            .top_level_await,
            .auto_import_jsx,
            .allow_runtime,
            .inlining,
            .commonjs_named_exports,
            .minify_syntax,
            .minify_identifiers,
            .dead_code_elimination,
            .set_breakpoint_on_first_line,
            .trim_unused_imports,
            .use_import_meta_require,
            .dont_bundle_twice,
            .commonjs_at_runtime,
            .emit_decorator_metadata,
            .lower_using,

            // note that we do not include .inject_jest_globals, as we bail out of the cache entirely if this is true
        };

        pub fn hashForRuntimeTranspiler(this: *const Features, hasher: *std.hash.Wyhash) void {
            bun.assert(this.runtime_transpiler_cache != null);

            var bools: [std.meta.fieldNames(@TypeOf(hash_fields_for_runtime_transpiler)).len]bool = undefined;
            inline for (hash_fields_for_runtime_transpiler, 0..) |field, i| {
                bools[i] = @field(this, @tagName(field));
            }

            hasher.update(std.mem.asBytes(&bools));
        }

        pub fn shouldUnwrapRequire(this: *const Features, package_name: string) bool {
            return package_name.len > 0 and strings.indexEqualAny(this.unwrap_commonjs_packages, package_name) != null;
        }

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
        __legacyDecorateClassTS: ?GeneratedSymbol = null,
        __legacyDecorateParamTS: ?GeneratedSymbol = null,
        __legacyMetadataTS: ?GeneratedSymbol = null,
        @"$$typeof": ?GeneratedSymbol = null,
        __using: ?GeneratedSymbol = null,
        __callDispose: ?GeneratedSymbol = null,

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
            "__legacyDecorateClassTS",
            "__legacyDecorateParamTS",
            "__legacyMetadataTS",
            "$$typeof",
            "__using",
            "__callDispose",
        };
        const all_sorted: [all.len]string = brk: {
            @setEvalBranchQuota(1000000);
            var list = all;
            const Sorter = struct {
                fn compare(_: void, a: []const u8, b: []const u8) bool {
                    return std.mem.order(u8, a, b) == .lt;
                }
            };
            std.sort.pdq(string, &list, {}, Sorter.compare);
            break :brk list;
        };

        /// When generating the list of runtime imports, we sort it for determinism.
        /// This is a lookup table so we don't need to resort the strings each time
        pub const all_sorted_index = brk: {
            var out: [all.len]usize = undefined;
            for (all, 0..) |name, i| {
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
                        inline 0...21 => |t| {
                            if (@field(this.runtime_imports, all[t])) |val| {
                                return Entry{ .key = t, .value = val.ref };
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
                inline 0...21 => |t| (@field(imports, all[t]) orelse return null).ref,
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
