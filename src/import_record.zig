const fs = @import("fs.zig");
const logger = @import("bun").logger;
const std = @import("std");
const Ref = @import("ast/base.zig").Ref;
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

    internal,

    pub const Label = std.EnumArray(ImportKind, []const u8);
    pub const all_labels: Label = brk: {
        var labels = Label.initFill("internal");
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

    source_index: Ref.Int = std.math.maxInt(Ref.Int),

    print_mode: PrintMode = .normal,

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
    handles_import_errors: bool = false,

    is_internal: bool = false,

    /// This tells the printer that we should print as export var $moduleID = ...
    /// Instead of using the path.
    is_bundled: bool = false,

    /// Sometimes the parser creates an import record and decides it isn't needed.
    /// For example, TypeScript code may have import statements that later turn
    /// out to be type-only imports after analyzing the whole file.
    is_unused: bool = false,

    /// If this is true, the import contains syntax like "* as ns". This is used
    /// to determine whether modules that have no exports need to be wrapped in a
    /// CommonJS wrapper or not.
    contains_import_star: bool = false,

    /// If this is true, the import contains an import for the alias "default",
    /// either via the "import x from" or "import {default as x} from" syntax.
    contains_default_alias: bool = false,

    /// If true, this "export * from 'path'" statement is evaluated at run-time by
    /// calling the "__reExport()" helper function
    calls_run_time_re_export_fn: bool = false,

    /// Tell the printer to use runtime code to resolve this import/export
    do_commonjs_transform_in_printer: bool = false,

    /// True for require calls like this: "try { require() } catch {}". In this
    /// case we shouldn't generate an error if the path could not be resolved.
    is_inside_try_body: bool = false,

    /// If true, this was originally written as a bare "import 'file'" statement
    was_originally_bare_import: bool = false,

    was_originally_require: bool = false,

    /// If a macro used <import>, it will be tracked here.
    was_injected_by_macro: bool = false,

    kind: ImportKind,

    tag: Tag = Tag.none,

    /// Tell the printer to print the record as "foo:my-path" instead of "path"
    /// where "foo" is the namespace
    ///
    /// Used to prevent running resolve plugins multiple times for the same path
    print_namespace_in_path: bool = false,

    pub const Tag = enum {
        none,
        react_refresh,
        jsx_import,
        jsx_classic,
        bun,
        bun_test,
        hardcoded,
    };

    pub const PrintMode = enum {
        normal,
        import_path,
        css,
        napi_module,
    };
};
