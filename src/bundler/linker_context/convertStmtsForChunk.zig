/// Code we ultimately include in the bundle is potentially wrapped
///
/// In that case, we do a final pass over the statements list to figure out
/// where it needs to go in the wrapper, following the syntax of the output
/// format ESM import and export statements to always be top-level, so they
/// can never be inside the wrapper.
///
///      prefix - outer
///      ...
///      var init_foo = __esm(() => {
///          prefix - inner
///          ...
///          suffix - inenr
///      });
///      ...
///      suffix - outer
///
/// Keep in mind that we may need to wrap ES modules in some cases too
/// Consider:
///   import * as foo from 'bar';
///   foo[computedProperty]
///
/// In that case, when bundling, we still need to preserve that module
/// namespace object (foo) because we cannot know what they are going to
/// attempt to access statically
pub fn convertStmtsForChunk(
    c: *LinkerContext,
    source_index: u32,
    stmts: *StmtList,
    part_stmts: []const js_ast.Stmt,
    chunk: *Chunk,
    allocator: std.mem.Allocator,
    wrap: WrapKind,
    ast: *const JSAst,
) !void {
    const shouldExtractESMStmtsForWrap = wrap != .none;
    const shouldStripExports = c.options.mode != .passthrough or c.graph.files.items(.entry_point_kind)[source_index] != .none;

    const flags = c.graph.meta.items(.flags);
    const output_format = c.options.output_format;

    // If this file is a CommonJS entry point, double-write re-exports to the
    // external CommonJS "module.exports" object in addition to our internal ESM
    // export namespace object. The difference between these two objects is that
    // our internal one must not have the "__esModule" marker while the external
    // one must have the "__esModule" marker. This is done because an ES module
    // importing itself should not see the "__esModule" marker but a CommonJS module
    // importing us should see the "__esModule" marker.
    var module_exports_for_export: ?Expr = null;
    if (output_format == .cjs and chunk.isEntryPoint()) {
        module_exports_for_export = Expr.allocate(
            allocator,
            E.Dot,
            E.Dot{
                .target = Expr.allocate(
                    allocator,
                    E.Identifier,
                    E.Identifier{
                        .ref = c.unbound_module_ref,
                    },
                    Logger.Loc.Empty,
                ),
                .name = "exports",
                .name_loc = Logger.Loc.Empty,
            },
            Logger.Loc.Empty,
        );
    }

    for (part_stmts) |stmt_| {
        var stmt = stmt_;
        process_stmt: {
            switch (stmt.data) {
                .s_import => |s| {
                    // "import * as ns from 'path'"
                    // "import {foo} from 'path'"
                    if (try c.shouldRemoveImportExportStmt(
                        stmts,
                        stmt.loc,
                        s.namespace_ref,
                        s.import_record_index,
                        allocator,
                        ast,
                    )) {
                        continue;
                    }

                    // Make sure these don't end up in the wrapper closure
                    if (shouldExtractESMStmtsForWrap) {
                        try stmts.append(.outside_wrapper_prefix, stmt);
                        continue;
                    }
                },
                .s_export_star => |s| {
                    // "export * as ns from 'path'"
                    if (s.alias) |alias| {
                        if (try c.shouldRemoveImportExportStmt(
                            stmts,
                            stmt.loc,
                            s.namespace_ref,
                            s.import_record_index,
                            allocator,
                            ast,
                        )) {
                            continue;
                        }

                        if (shouldStripExports) {
                            // Turn this statement into "import * as ns from 'path'"
                            stmt = Stmt.alloc(
                                S.Import,
                                S.Import{
                                    .namespace_ref = s.namespace_ref,
                                    .import_record_index = s.import_record_index,
                                    .star_name_loc = alias.loc,
                                },
                                stmt.loc,
                            );
                        }

                        // Make sure these don't end up in the wrapper closure
                        if (shouldExtractESMStmtsForWrap) {
                            try stmts.append(.outside_wrapper_prefix, stmt);
                            continue;
                        }

                        break :process_stmt;
                    }

                    // "export * from 'path'"
                    if (!shouldStripExports) {
                        break :process_stmt;
                    }

                    const record = ast.import_records.at(s.import_record_index);

                    // Is this export star evaluated at run time?
                    if (!record.source_index.isValid() and c.options.output_format.keepES6ImportExportSyntax()) {
                        if (record.flags.calls_runtime_re_export_fn) {
                            // Turn this statement into "import * as ns from 'path'"
                            stmt = Stmt.alloc(
                                S.Import,
                                S.Import{
                                    .namespace_ref = s.namespace_ref,
                                    .import_record_index = s.import_record_index,
                                    .star_name_loc = stmt.loc,
                                },
                                stmt.loc,
                            );

                            // Prefix this module with "__reExport(exports, ns, module.exports)"
                            const export_star_ref = c.runtimeFunction("__reExport");
                            var args = try allocator.alloc(Expr, 2 + @as(usize, @intFromBool(module_exports_for_export != null)));
                            args[0..2].* = .{
                                Expr.init(
                                    E.Identifier,
                                    E.Identifier{
                                        .ref = ast.exports_ref,
                                    },
                                    stmt.loc,
                                ),
                                Expr.init(
                                    E.Identifier,
                                    E.Identifier{
                                        .ref = s.namespace_ref,
                                    },
                                    stmt.loc,
                                ),
                            };

                            if (module_exports_for_export) |mod| {
                                args[3] = mod;
                            }

                            try stmts.inside_wrapper_prefix.appendNonDependency(
                                Stmt.alloc(
                                    S.SExpr,
                                    S.SExpr{
                                        .value = Expr.allocate(
                                            allocator,
                                            E.Call,
                                            E.Call{
                                                .target = Expr.allocate(
                                                    allocator,
                                                    E.Identifier,
                                                    E.Identifier{
                                                        .ref = export_star_ref,
                                                    },
                                                    stmt.loc,
                                                ),
                                                .args = bun.BabyList(Expr).fromOwnedSlice(args),
                                            },
                                            stmt.loc,
                                        ),
                                    },
                                    stmt.loc,
                                ),
                            );

                            // Make sure these don't end up in the wrapper closure
                            if (shouldExtractESMStmtsForWrap) {
                                try stmts.append(.outside_wrapper_prefix, stmt);
                                continue;
                            }
                        }
                    } else {
                        if (record.source_index.isValid()) {
                            const flag = flags[record.source_index.get()];
                            const wrapper_ref = c.graph.ast.items(.wrapper_ref)[record.source_index.get()];
                            if (flag.wrap == .esm and wrapper_ref.isValid()) {
                                try stmts.inside_wrapper_prefix.appendNonDependency(
                                    Stmt.alloc(S.SExpr, .{
                                        .value = Expr.init(E.Call, .{
                                            .target = Expr.init(
                                                E.Identifier,
                                                E.Identifier{
                                                    .ref = wrapper_ref,
                                                },
                                                stmt.loc,
                                            ),
                                        }, stmt.loc),
                                    }, stmt.loc),
                                );
                            }
                        }

                        if (record.flags.calls_runtime_re_export_fn) {
                            const target: Expr = brk: {
                                if (record.source_index.isValid() and c.graph.ast.items(.exports_kind)[record.source_index.get()].isESMWithDynamicFallback()) {
                                    // Prefix this module with "__reExport(exports, otherExports, module.exports)"
                                    break :brk Expr.initIdentifier(c.graph.ast.items(.exports_ref)[record.source_index.get()], stmt.loc);
                                }

                                break :brk Expr.init(
                                    E.RequireString,
                                    E.RequireString{
                                        .import_record_index = s.import_record_index,
                                    },
                                    stmt.loc,
                                );
                            };

                            // Prefix this module with "__reExport(exports, require(path), module.exports)"
                            const export_star_ref = c.runtimeFunction("__reExport");
                            var args = try allocator.alloc(Expr, 2 + @as(usize, @intFromBool(module_exports_for_export != null)));
                            args[0..2].* = .{
                                Expr.init(
                                    E.Identifier,
                                    E.Identifier{
                                        .ref = ast.exports_ref,
                                    },
                                    stmt.loc,
                                ),
                                target,
                            };

                            if (module_exports_for_export) |mod| {
                                args[2] = mod;
                            }

                            try stmts.inside_wrapper_prefix.appendNonDependency(
                                Stmt.alloc(
                                    S.SExpr,
                                    S.SExpr{
                                        .value = Expr.init(
                                            E.Call,
                                            E.Call{
                                                .target = Expr.init(
                                                    E.Identifier,
                                                    E.Identifier{
                                                        .ref = export_star_ref,
                                                    },
                                                    stmt.loc,
                                                ),
                                                .args = js_ast.ExprNodeList.fromOwnedSlice(args),
                                            },
                                            stmt.loc,
                                        ),
                                    },
                                    stmt.loc,
                                ),
                            );
                        }

                        // Remove the export star statement
                        continue;
                    }
                },

                .s_export_from => |s| {
                    // "export {foo} from 'path'"
                    if (try c.shouldRemoveImportExportStmt(
                        stmts,
                        stmt.loc,
                        s.namespace_ref,
                        s.import_record_index,
                        allocator,
                        ast,
                    )) {
                        continue;
                    }

                    if (shouldStripExports) {
                        // Turn this statement into "import {foo} from 'path'"
                        // TODO: is this allocation necessary?
                        const items = allocator.alloc(js_ast.ClauseItem, s.items.len) catch unreachable;
                        for (s.items, items) |src, *dest| {
                            dest.* = .{
                                .alias = src.original_name,
                                .alias_loc = src.alias_loc,
                                .name = src.name,
                            };
                        }

                        stmt = Stmt.alloc(
                            S.Import,
                            S.Import{
                                .items = items,
                                .import_record_index = s.import_record_index,
                                .namespace_ref = s.namespace_ref,
                                .is_single_line = s.is_single_line,
                            },
                            stmt.loc,
                        );
                    }

                    // Make sure these don't end up in the wrapper closure
                    if (shouldExtractESMStmtsForWrap) {
                        try stmts.append(.outside_wrapper_prefix, stmt);
                        continue;
                    }
                },

                .s_export_clause => {
                    // "export {foo}"

                    if (shouldStripExports) {
                        // Remove export statements entirely
                        continue;
                    }

                    // Make sure these don't end up in the wrapper closure
                    if (shouldExtractESMStmtsForWrap) {
                        try stmts.append(.outside_wrapper_prefix, stmt);
                        continue;
                    }
                },

                .s_function => |s| {
                    // Strip the "export" keyword while bundling
                    if (shouldStripExports and s.func.flags.contains(.is_export)) {
                        // Be c areful to not modify the original statement
                        stmt = Stmt.alloc(
                            S.Function,
                            S.Function{
                                .func = s.func,
                            },
                            stmt.loc,
                        );
                        stmt.data.s_function.func.flags.remove(.is_export);
                    }
                },

                .s_class => |s| {
                    // Strip the "export" keyword while bundling
                    if (shouldStripExports and s.is_export) {
                        // Be careful to not modify the original statement
                        stmt = Stmt.alloc(
                            S.Class,
                            S.Class{
                                .class = s.class,
                                .is_export = false,
                            },
                            stmt.loc,
                        );
                    }
                },

                .s_local => |s| {
                    // Strip the "export" keyword while bundling
                    if (shouldStripExports and s.is_export) {
                        // Be careful to not modify the original statement
                        stmt = Stmt.alloc(
                            S.Local,
                            s.*,
                            stmt.loc,
                        );
                        stmt.data.s_local.is_export = false;
                    } else if (FeatureFlags.unwrap_commonjs_to_esm and s.was_commonjs_export and wrap == .cjs) {
                        bun.assert(stmt.data.s_local.decls.len == 1);
                        const decl = stmt.data.s_local.decls.ptr[0];
                        if (decl.value) |decl_value| {
                            stmt = Stmt.alloc(
                                S.SExpr,
                                S.SExpr{
                                    .value = Expr.init(
                                        E.Binary,
                                        E.Binary{
                                            .op = .bin_assign,
                                            .left = Expr.init(
                                                E.CommonJSExportIdentifier,
                                                E.CommonJSExportIdentifier{
                                                    .ref = decl.binding.data.b_identifier.ref,
                                                },
                                                decl.binding.loc,
                                            ),
                                            .right = decl_value,
                                        },
                                        stmt.loc,
                                    ),
                                },
                                stmt.loc,
                            );
                        } else {
                            continue;
                        }
                    }
                },

                .s_export_default => |s| {
                    // "export default foo"

                    if (shouldStripExports) {
                        switch (s.value) {
                            .stmt => |stmt2| {
                                switch (stmt2.data) {
                                    .s_expr => |s2| {
                                        // "export default foo;" => "var default = foo;"
                                        stmt = Stmt.alloc(
                                            S.Local,
                                            S.Local{
                                                .decls = try G.Decl.List.fromSlice(
                                                    allocator,
                                                    &.{
                                                        .{
                                                            .binding = Binding.alloc(
                                                                allocator,
                                                                B.Identifier{
                                                                    .ref = s.default_name.ref.?,
                                                                },
                                                                s2.value.loc,
                                                            ),
                                                            .value = s2.value,
                                                        },
                                                    },
                                                ),
                                            },
                                            stmt.loc,
                                        );
                                    },
                                    .s_function => |s2| {
                                        // "export default function() {}" => "function default() {}"
                                        // "export default function foo() {}" => "function foo() {}"

                                        // Be careful to not modify the original statement
                                        stmt = Stmt.alloc(
                                            S.Function,
                                            S.Function{
                                                .func = s2.func,
                                            },
                                            stmt.loc,
                                        );
                                        stmt.data.s_function.func.name = s.default_name;
                                    },

                                    .s_class => |s2| {
                                        // "export default class {}" => "class default {}"
                                        // "export default class foo {}" => "class foo {}"

                                        // Be careful to not modify the original statement
                                        stmt = Stmt.alloc(
                                            S.Class,
                                            S.Class{
                                                .class = s2.class,
                                                .is_export = false,
                                            },
                                            stmt.loc,
                                        );
                                        stmt.data.s_class.class.class_name = s.default_name;
                                    },

                                    else => bun.unreachablePanic(
                                        "Unexpected type in source file {s}",
                                        .{
                                            c.parse_graph.input_files.get(c.graph.files.get(source_index).input_file.get()).source.path.text,
                                        },
                                    ),
                                }
                            },
                            .expr => |e| {
                                stmt = Stmt.alloc(
                                    S.Local,
                                    S.Local{
                                        .decls = try G.Decl.List.fromSlice(
                                            allocator,
                                            &.{
                                                .{
                                                    .binding = Binding.alloc(
                                                        allocator,
                                                        B.Identifier{
                                                            .ref = s.default_name.ref.?,
                                                        },
                                                        e.loc,
                                                    ),
                                                    .value = e,
                                                },
                                            },
                                        ),
                                    },
                                    stmt.loc,
                                );
                            },
                        }
                    }
                },

                else => {},
            }
        }

        try stmts.append(.inside_wrapper_suffix, stmt);
    }
}

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const std = @import("std");

const bun = @import("bun");
const BabyList = bun.BabyList;
const FeatureFlags = bun.FeatureFlags;

const js_ast = bun.ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const G = js_ast.G;
const JSAst = js_ast.BundledAst;
const S = js_ast.S;
const Stmt = js_ast.Stmt;

const bundler = bun.bundle_v2;
const Chunk = bundler.Chunk;
const WrapKind = bundler.WrapKind;

const LinkerContext = bun.bundle_v2.LinkerContext;
const StmtList = LinkerContext.StmtList;

const Logger = bun.logger;
const Loc = Logger.Loc;
