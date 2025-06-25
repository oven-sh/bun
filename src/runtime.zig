const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;

const std = @import("std");
const Schema = @import("./api/schema.zig");
const Ref = @import("ast/base.zig").Ref;
const JSAst = bun.JSAst;

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

pub const Fallback = struct {
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

    pub inline fn errorJS() string {
        return if (Environment.codegen_embed)
            @embedFile("bun-error/index.js")
        else
            bun.runtimeEmbedFile(.codegen, "bun-error/index.js");
    }

    pub inline fn errorCSS() string {
        return if (Environment.codegen_embed)
            @embedFile("bun-error/bun-error.css")
        else
            bun.runtimeEmbedFile(.codegen, "bun-error/bun-error.css");
    }

    pub inline fn fallbackDecoderJS() string {
        return if (Environment.codegen_embed)
            @embedFile("fallback-decoder.js")
        else
            bun.runtimeEmbedFile(.codegen, "fallback-decoder.js");
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
            .fallback = fallbackDecoderJS(),
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
            .bun_error_css = errorCSS(),
            .bun_error = errorJS(),
            .bun_error_page_css = "",
            .fallback = fallbackDecoderJS(),
        });
    }
};

pub const Runtime = struct {
    pub fn sourceCode() string {
        return if (Environment.codegen_embed)
            @embedFile("runtime.out.js")
        else
            bun.runtimeEmbedFile(.codegen, "runtime.out.js");
    }

    pub fn versionHash() u32 {
        const hash = bun.Wyhash11.hash(0, sourceCode());
        return @truncate(hash);
    }

    pub const Features = struct {
        /// Enable the React Fast Refresh transform. What this does exactly
        /// is documented in js_parser, search for `const ReactRefresh`
        react_fast_refresh: bool = false,
        /// `hot_module_reloading` is specific to if we are using bun.bake.DevServer.
        /// It can be enabled on the command line with --format=internal_bake_dev
        ///
        /// Standalone usage of this flag / usage of this flag
        /// without '--format' set is an unsupported use case.
        hot_module_reloading: bool = false,
        /// Control how the parser handles server components and server functions.
        server_components: ServerComponentsMode = .none,

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

        trim_unused_imports: bool = false,

        /// Allow runtime usage of require(), converting `require` into `__require`
        auto_polyfill_require: bool = false,

        replace_exports: ReplaceableExport.Map = .{},

        /// Scan for '// @bun' at the top of this file, halting a parse if it is
        /// seen. This is used in `bun run` after a `bun build --target=bun`,
        /// and you know the contents is already correct.
        ///
        /// This comment must never be used manually.
        dont_bundle_twice: bool = false,

        /// This is a list of packages which even when require() is used, we will
        /// instead convert to ESM import statements.
        ///
        /// This is not normally a safe transformation.
        ///
        /// So we have a list of packages which we know are safe to do this with.
        unwrap_commonjs_packages: []const string = &.{},

        commonjs_at_runtime: bool = false,
        unwrap_commonjs_to_esm: bool = false,

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

        pub const ServerComponentsMode = enum {
            /// Server components is disabled, strings "use client" and "use server" mean nothing.
            none,
            /// This is a server-side file outside of the SSR graph, but not a "use server" file.
            /// - Handle functions with "use server", creating secret exports for them.
            wrap_anon_server_functions,
            /// This is a "use client" file on the server, and separate_ssr_graph is off.
            /// - Wrap all exports in a call to `registerClientReference`
            /// - Ban "use server" functions???
            wrap_exports_for_client_reference,
            /// This is a "use server" file on the server
            /// - Wrap all exports in a call to `registerServerReference`
            /// - Ban "use server" functions, since this directive is already applied.
            wrap_exports_for_server_reference,
            /// This is a client side file.
            /// - Ban "use server" functions since it is on the client-side
            client_side,

            pub fn wrapsExports(mode: ServerComponentsMode) bool {
                return switch (mode) {
                    .wrap_exports_for_client_reference,
                    .wrap_exports_for_server_reference,
                    => true,
                    else => false,
                };
            }
        };
    };

    pub const Names = struct {
        pub const ActivateFunction = "activate";
    };

    // If you change this, remember to update "runtime.js"
    pub const Imports = struct {
        __name: ?Ref = null,
        __require: ?Ref = null,
        __export: ?Ref = null,
        __reExport: ?Ref = null,
        __exportValue: ?Ref = null,
        __exportDefault: ?Ref = null,
        // __refreshRuntime: ?GeneratedSymbol = null,
        // __refreshSig: ?GeneratedSymbol = null, // $RefreshSig$
        __merge: ?Ref = null,
        __legacyDecorateClassTS: ?Ref = null,
        __legacyDecorateParamTS: ?Ref = null,
        __legacyMetadataTS: ?Ref = null,
        @"$$typeof": ?Ref = null,
        __using: ?Ref = null,
        __callDispose: ?Ref = null,
        __jsonParse: ?Ref = null,

        pub const all = [_][]const u8{
            "__name",
            "__require",
            "__export",
            "__reExport",
            "__exportValue",
            "__exportDefault",
            "__merge",
            "__legacyDecorateClassTS",
            "__legacyDecorateParamTS",
            "__legacyMetadataTS",
            "$$typeof",
            "__using",
            "__callDispose",
            "__jsonParse",
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
                        inline 0...all.len - 1 => |t| {
                            if (@field(this.runtime_imports, all[t])) |val| {
                                return Entry{ .key = t, .value = val };
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
            return .{ .runtime_imports = imports };
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

        pub fn put(imports: *Imports, comptime key: string, ref: Ref) void {
            @field(imports, key) = ref;
        }

        pub fn at(
            imports: *Imports,
            comptime key: string,
        ) ?Ref {
            return (@field(imports, key) orelse return null);
        }

        pub fn get(
            imports: *const Imports,
            key: anytype,
        ) ?Ref {
            return switch (key) {
                inline 0...all.len - 1 => |t| (@field(imports, all[t]) orelse return null),
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
