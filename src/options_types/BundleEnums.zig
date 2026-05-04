//! Pure enum/struct option types extracted from `bundler/options.zig` so
//! `cli/` and other tiers can reference them without depending on `bundler/`.
//! Aliased back at original locations — call sites unchanged.

pub const Format = enum {
    /// ES module format
    /// This is the default format
    esm,

    /// Immediately-invoked function expression
    /// (function(){
    ///     ...
    /// })();
    iife,

    /// CommonJS
    cjs,

    /// Bake uses a special module format for Hot-module-reloading. It includes a
    /// runtime payload, sourced from src/bake/hmr-runtime-{side}.ts.
    ///
    /// ((unloadedModuleRegistry, config) => {
    ///   ... runtime code ...
    /// })({
    ///   "module1.ts": ...,
    ///   "module2.ts": ...,
    /// }, { ...metadata... });
    internal_bake_dev,

    pub fn keepES6ImportExportSyntax(this: Format) bool {
        return this == .esm;
    }

    pub inline fn isESM(this: Format) bool {
        return this == .esm;
    }

    pub inline fn isAlwaysStrictMode(this: Format) bool {
        return this == .esm;
    }

    pub const Map = bun.ComptimeStringMap(Format, .{
        .{ "esm", .esm },
        .{ "cjs", .cjs },
        .{ "iife", .iife },

        // TODO: Disable this outside of debug builds
        .{ "internal_bake_dev", .internal_bake_dev },
    });

    pub const fromJS = @import("../bundler_jsc/options_jsc.zig").formatFromJS;

    pub fn fromString(slice: []const u8) ?Format {
        return Map.getWithEql(slice, bun.strings.eqlComptime);
    }
};

pub const WindowsOptions = struct {
    hide_console: bool = false,
    icon: ?[]const u8 = null,
    title: ?[]const u8 = null,
    publisher: ?[]const u8 = null,
    version: ?[]const u8 = null,
    description: ?[]const u8 = null,
    copyright: ?[]const u8 = null,
};

pub const BundlePackage = enum {
    always,
    never,

    pub const Map = bun.StringArrayHashMapUnmanaged(BundlePackage);
};

const bun = @import("bun");
