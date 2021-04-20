const fs = @import("fs.zig");
const logger = @import("logger.zig");

pub const ImportKind = enum(u8) {

    // An entry point provided by the user
    entry_point,

    // An ES6 import or re-export statement
    stmt,

    // A call to "require()"
    require,

    // An "import()" expression with a string argument
    dynamic,

    // A call to "require.resolve()"
    require_resolve,

    // A CSS "@import" rule
    at,

    // A CSS "@import" rule with import conditions
    at_conditional,

    // A CSS "url(...)" token
    url,
};

pub const ImportRecord = struct {
    range: logger.Range,
    path: fs.Path,

    // Sometimes the parser creates an import record and decides it isn't needed.
    // For example, TypeScript code may have import statements that later turn
    // out to be type-only imports after analyzing the whole file.
    is_unused: bool,

    // If this is true, the import contains syntax like "* as ns". This is used
    // to determine whether modules that have no exports need to be wrapped in a
    // CommonJS wrapper or not.
    contains_import_star: bool,

    // If this is true, the import contains an import for the alias "default",
    // either via the "import x from" or "import {default as x} from" syntax.
    contains_default_alias: bool,

    // If true, this "export * from 'path'" statement is evaluated at run-time by
    // calling the "__reExport()" helper function
    calls_run_time_re_export_fn: bool,

    // Tell the printer to wrap this call to "require()" in "__toModule(...)"
    wrap_with_to_module: bool,

    // True for require calls like this: "try { require() } catch {}". In this
    // case we shouldn't generate an error if the path could not be resolved.
    is_inside_try_body: bool,

    // If true, this was originally written as a bare "import 'file'" statement
    was_originally_bare_import: bool,

    kind: ImportKind,
};
