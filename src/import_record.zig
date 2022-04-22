const fs = @import("fs.zig");
const logger = @import("logger.zig");
const std = @import("std");
const Ref = @import("ast/base.zig").Ref;
const Index = @import("ast/base.zig").Index;
const Api = @import("./api/schema.zig").Api;

pub const ImportKind = enum(u8) {

    // An entry point provided by the user
    entry_point,

    // An ES6 import or re-export statement
    stmt,

    // A call to "require()"
    require,

    // An "import()" expression with a string argument
    dynamic,

    /// A call to "require.resolve()"
    require_resolve,

    /// A CSS "@import" rule
    at,

    /// A CSS "@import" rule with import conditions
    at_conditional,

    /// A CSS "url(...)" token
    url,

    pub const Label = std.EnumArray(ImportKind, []const u8);
    pub const all_labels: Label = brk: {
        var labels = Label.initFill("");
        labels.set(ImportKind.entry_point, "entry-point");
        labels.set(ImportKind.stmt, "import-statement");
        labels.set(ImportKind.require, "require-call");
        labels.set(ImportKind.dynamic, "dynamic-import");
        labels.set(ImportKind.require_resolve, "require-resolve");
        labels.set(ImportKind.at, "import-rule");
        labels.set(ImportKind.url, "url-token");
        break :brk labels;
    };

    pub inline fn label(this: ImportKind) []const u8 {
        return all_labels.get(this);
    }

    pub inline fn isCommonJS(this: ImportKind) bool {
        return switch (this) {
            .require, .require_resolve => true,
            else => false,
        };
    }

    pub fn jsonStringify(self: @This(), options: anytype, writer: anytype) !void {
        return try std.json.stringify(@tagName(self), options, writer);
    }

    pub fn isFromCSS(k: ImportKind) bool {
        return k == .at_conditional or k == .at or k == .url;
    }

    pub fn toAPI(k: ImportKind) Api.ImportKind {
        return switch (k) {
            ImportKind.entry_point => Api.ImportKind.entry_point,
            ImportKind.stmt => Api.ImportKind.stmt,
            ImportKind.require => Api.ImportKind.require,
            ImportKind.dynamic => Api.ImportKind.dynamic,
            ImportKind.require_resolve => Api.ImportKind.require_resolve,
            ImportKind.at => Api.ImportKind.at,
            ImportKind.url => Api.ImportKind.url,
            else => Api.ImportKind.internal,
        };
    }
};

pub const ImportRecord = struct {
    range: logger.Range,
    path: fs.Path,

    /// 0 is invalid
    module_id: u32 = 0,

    source_index: Index = Index.invalid,

    print_mode: PrintMode = .normal,

    kind: ImportKind,

    tag: Tag = Tag.none,

    flags: Flags.Set = Flags.None,

    pub inline fn set(this: *ImportRecord, flag: Flags, value: bool) void {
        this.flags.setPresent(flag, value);
    }

    pub inline fn enable(this: *ImportRecord, flag: Flags) void {
        this.set(flag, true);
    }

    /// True for the following cases:
    ///
    ///   `try { require('x') } catch { handle }`
    ///   `try { await import('x') } catch { handle }`
    ///   `try { require.resolve('x') } catch { handle }`
    ///   `import('x').catch(handle)`
    ///   `import('x').then(_, handle)`
    ///
    /// In these cases we shouldn't generate an error if the path could not be
    /// resolved.
    pub inline fn handles_import_errors(this: *const ImportRecord) bool {
        return this.flags.contains(.handles_import_errors);
    }

    /// Sometimes the parser creates an import record and decides it isn't needed.
    /// For example, TypeScript code may have import statements that later turn
    /// out to be type-only imports after analyzing the whole file.
    pub inline fn is_unused(this: *const ImportRecord) bool {
        return this.flags.contains(.is_unused);
    }

    /// If this is true, the import contains syntax like "* as ns". This is used
    /// to determine whether modules that have no exports need to be wrapped in a
    /// CommonJS wrapper or not.
    pub inline fn contains_import_star(this: *const ImportRecord) bool {
        return this.flags.contains(.contains_import_star);
    }

    /// If this is true, the import contains an import for the alias "default",
    /// either via the "import x from" or "import {default as x} from" syntax.
    pub inline fn contains_default_alias(this: *const ImportRecord) bool {
        return this.flags.contains(.contains_default_alias);
    }

    /// If true, this "export * from 'path'" statement is evaluated at run-time by
    /// calling the "__reExport()" helper function
    pub inline fn calls_runtime_re_export_fn(this: *const ImportRecord) bool {
        return this.flags.contains(.calls_runtime_re_export_fn);
    }
    /// If true, this calls require() at runtime
    pub inline fn calls_runtime_require(this: *const ImportRecord) bool {
        return this.flags.contains(.calls_runtime_require);
    }

    /// Tell the printer to wrap this call to "require()" in "__toModule(...)"
    pub inline fn wrap_with_to_module(this: *const ImportRecord) bool {
        return this.flags.contains(.wrap_with_to_module);
    }

    /// Tell the printer to wrap this call to "toESM()" in "__toESM(...)"
    pub inline fn wrap_with_to_esm(this: *const ImportRecord) bool {
        return this.flags.contains(.wrap_with_to_esm);
    }

    // If this is true, the import contains an import for the alias "__esModule",
    // via the "import {__esModule} from" syntax.
    pub inline fn contains_es_module_alias(this: *const ImportRecord) bool {
        return this.flags.contains(.contains_es_module_alias);
    }

    /// If true, this was originally written as a bare "import 'file'" statement
    pub inline fn was_originally_bare_import(this: *const ImportRecord) bool {
        return this.flags.contains(.was_originally_bare_import);
    }
    pub inline fn was_originally_require(this: *const ImportRecord) bool {
        return this.flags.contains(.was_originally_require);
    }

    pub const Flags = enum {
        /// True for the following cases:
        ///
        ///   try { require('x') } catch { handle }
        ///   try { await import('x') } catch { handle }
        ///   try { require.resolve('x') } catch { handle }
        ///   import('x').catch(handle)
        ///   import('x').then(_, handle)
        ///
        /// In these cases we shouldn't generate an error if the path could not be
        /// resolved.
        handles_import_errors,

        /// Sometimes the parser creates an import record and decides it isn't needed.
        /// For example, TypeScript code may have import statements that later turn
        /// out to be type-only imports after analyzing the whole file.
        is_unused,

        /// If this is true, the import contains syntax like "* as ns". This is used
        /// to determine whether modules that have no exports need to be wrapped in a
        /// CommonJS wrapper or not.
        contains_import_star,

        /// If this is true, the import contains an import for the alias "default",
        /// either via the "import x from" or "import {default as x} from" syntax.
        contains_default_alias,

        // If this is true, the import contains an import for the alias "__esModule",
        // via the "import {__esModule} from" syntax.
        contains_es_module_alias,

        /// If true, this "export * from 'path'" statement is evaluated at run-time by
        /// calling the "__reExport()" helper function
        calls_runtime_re_export_fn,

        /// If true, this calls require() at runtime
        calls_runtime_require,

        /// Tell the printer to wrap this call to "require()" in "__toModule(...)"
        wrap_with_to_module,

        /// Tell the printer to wrap this call to "toESM()" in "__toESM(...)"
        wrap_with_to_esm,

        /// If true, this was originally written as a bare "import 'file'" statement
        was_originally_bare_import,

        was_originally_require,

        pub const None = Set{};
        pub const Fields = std.enums.EnumFieldStruct(Flags, bool, false);
        pub const Set = std.enums.EnumSet(Flags);
    };

    pub inline fn isRuntime(this: *const ImportRecord) bool {
        return this.tag.isRuntime();
    }

    pub inline fn isInternal(this: *const ImportRecord) bool {
        return this.tag.isInternal();
    }

    pub inline fn isBundled(this: *const ImportRecord) bool {
        return this.module_id > 0;
    }

    pub const List = @import("./baby_list.zig").BabyList(ImportRecord);

    pub const Tag = enum(u3) {
        none,
        /// JSX auto-import for React Fast Refresh
        react_refresh,
        /// JSX auto-import for jsxDEV or jsx
        jsx_import,
        /// JSX auto-import for Fragment or createElement
        jsx_classic,
        /// Uses the `bun` import specifier
        ///     import {foo} from "bun";
        bun,
        /// Uses the `bun:test` import specifier
        ///     import {expect} from "bun:test";
        bun_test,
        runtime,
        /// A macro: import specifier OR a macro import
        macro,

        pub inline fn isRuntime(this: Tag) bool {
            return this == .runtime;
        }

        pub inline fn isInternal(this: Tag) bool {
            return @enumToInt(this) >= @enumToInt(Tag.runtime);
        }
    };

    pub const PrintMode = enum {
        normal,
        import_path,
        css,
    };
};
