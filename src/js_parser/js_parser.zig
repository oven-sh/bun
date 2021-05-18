usingnamespace @import("imports.zig");

const TemplatePartTuple = std.meta.Tuple(&[_]type{ []E.TemplatePart, logger.Loc });
const ScopeOrderList = std.ArrayListUnmanaged(?ScopeOrder);

var panic_buffer = std.mem.zeroes([32 * 1024]u8);
var panic_stream = std.io.fixedBufferStream(&panic_buffer);

pub fn ExpressionTransposer(comptime ctx: type, visitor: fn (ptr: *ctx, arg: Expr, state: anytype) Expr) type {
    return struct {
        context: *Context,

        pub fn init(c: *Context) @This() {
            return @This(){
                .context = c,
            };
        }

        pub fn maybeTransposeIf(self: *@This(), arg: Expr, state: anytype) Expr {
            switch (arg.data) {
                .e_if => |ex| {
                    ex.yes = self.maybeTransposeIf(ex.yes, state);
                    ex.no = self.maybeTransposeIf(ex.no, state);
                    return arg;
                },
                else => {
                    return visitor(self.context, arg, state);
                },
            }
        }
        pub const Context = ctx;
    };
}

pub fn locAfterOp(e: E.Binary) logger.Loc {
    if (e.left.loc.start < e.right.loc.start) {
        return e.right.loc;
    } else {
        // handle the case when we have transposed the operands
        return e.left.loc;
    }
}

pub const ImportScanner = struct {
    stmts: []Stmt = &([_]Stmt{}),
    kept_import_equals: bool = false,
    removed_import_equals: bool = false,
    pub fn scan(p: *P, stmts: []Stmt) !ImportScanner {
        var scanner = ImportScanner{};
        var stmts_end: usize = 0;

        for (stmts) |_stmt| {
            // zls needs the hint, it seems.
            const stmt: Stmt = _stmt;
            switch (stmt.data) {
                .s_import => |st| {
                    var record: ImportRecord = p.import_records.items[st.import_record_index];

                    // The official TypeScript compiler always removes unused imported
                    // symbols. However, we deliberately deviate from the official
                    // TypeScript compiler's behavior doing this in a specific scenario:
                    // we are not bundling, symbol renaming is off, and the tsconfig.json
                    // "importsNotUsedAsValues" setting is present and is not set to
                    // "remove".
                    //
                    // This exists to support the use case of compiling partial modules for
                    // compile-to-JavaScript languages such as Svelte. These languages try
                    // to reference imports in ways that are impossible for esbuild to know
                    // about when esbuild is only given a partial module to compile. Here
                    // is an example of some Svelte code that might use esbuild to convert
                    // TypeScript to JavaScript:
                    //
                    //   <script lang="ts">
                    //     import Counter from './Counter.svelte';
                    //     export let name: string = 'world';
                    //   </script>
                    //   <main>
                    //     <h1>Hello {name}!</h1>
                    //     <Counter />
                    //   </main>
                    //
                    // Tools that use esbuild to compile TypeScript code inside a Svelte
                    // file like this only give esbuild the contents of the <script> tag.
                    // These tools work around this missing import problem when using the
                    // official TypeScript compiler by hacking the TypeScript AST to
                    // remove the "unused import" flags. This isn't possible in esbuild
                    // because esbuild deliberately does not expose an AST manipulation
                    // API for performance reasons.
                    //
                    // We deviate from the TypeScript compiler's behavior in this specific
                    // case because doing so is useful for these compile-to-JavaScript
                    // languages and is benign in other cases. The rationale is as follows:
                    //
                    //   * If "importsNotUsedAsValues" is absent or set to "remove", then
                    //     we don't know if these imports are values or types. It's not
                    //     safe to keep them because if they are types, the missing imports
                    //     will cause run-time failures because there will be no matching
                    //     exports. It's only safe keep imports if "importsNotUsedAsValues"
                    //     is set to "preserve" or "error" because then we can assume that
                    //     none of the imports are types (since the TypeScript compiler
                    //     would generate an error in that case).
                    //
                    //   * If we're bundling, then we know we aren't being used to compile
                    //     a partial module. The parser is seeing the entire code for the
                    //     module so it's safe to remove unused imports. And also we don't
                    //     want the linker to generate errors about missing imports if the
                    //     imported file is also in the bundle.
                    //
                    //   * If identifier minification is enabled, then using esbuild as a
                    //     partial-module transform library wouldn't work anyway because
                    //     the names wouldn't match. And that means we're minifying so the
                    //     user is expecting the output to be as small as possible. So we
                    //     should omit unused imports.
                    //
                    // const keep_unused_imports = !p.options.trim_unused_imports;
                    var did_remove_star_loc = false;
                    const keep_unused_imports = true;

                    // TypeScript always trims unused imports. This is important for
                    // correctness since some imports might be fake (only in the type
                    // system and used for type-only imports).
                    if (!keep_unused_imports) {
                        var found_imports = false;
                        var is_unused_in_typescript = false;

                        if (st.default_name) |default_name| {
                            found_imports = true;
                            var symbol = p.symbols.items[default_name.ref.?.inner_index];

                            // TypeScript has a separate definition of unused
                            if (p.options.ts and p.ts_use_counts.items[default_name.ref.?.inner_index] != 0) {
                                is_unused_in_typescript = false;
                            }

                            // Remove the symbol if it's never used outside a dead code region
                            if (symbol.use_count_estimate == 0) {
                                st.default_name = null;
                            }
                        }

                        // Remove the star import if it's unused
                        if (st.star_name_loc) |star_name| {
                            found_imports = true;
                            const symbol = p.symbols.items[st.namespace_ref.inner_index];

                            // TypeScript has a separate definition of unused
                            if (p.options.ts and p.ts_use_counts.items[st.namespace_ref.inner_index] != 0) {
                                is_unused_in_typescript = false;
                            }

                            // Remove the symbol if it's never used outside a dead code region
                            if (symbol.use_count_estimate == 0) {
                                // Make sure we don't remove this if it was used for a property
                                // access while bundling
                                var has_any = false;

                                if (p.import_items_for_namespace.get(st.namespace_ref)) |entry| {
                                    if (entry.count() > 0) {
                                        has_any = true;
                                    }
                                }

                                if (!has_any) {
                                    st.star_name_loc = null;
                                    did_remove_star_loc = true;
                                }
                            }
                        }

                        // Remove items if they are unused
                        if (st.items.len > 0) {
                            found_imports = false;
                            var items_end: usize = 0;
                            var i: usize = 0;
                            while (i < st.items.len) : (i += 1) {
                                const item = st.items[i];
                                const ref = item.name.ref.?;
                                const symbol: Symbol = p.symbols.items[ref.inner_index];

                                // TypeScript has a separate definition of unused
                                if (p.options.ts and p.ts_use_counts.items[ref.inner_index] != 0) {
                                    is_unused_in_typescript = false;
                                }

                                // Remove the symbol if it's never used outside a dead code region
                                if (symbol.use_count_estimate != 0) {
                                    st.items[items_end] = item;
                                    items_end += 1;
                                }
                            }

                            if (items_end < st.items.len - 1) {
                                var list = List(js_ast.ClauseItem).fromOwnedSlice(p.allocator, st.items);
                                list.shrinkAndFree(items_end);
                                st.items = list.toOwnedSlice();
                            }
                        }

                        // -- Original Comment --
                        // Omit this statement if we're parsing TypeScript and all imports are
                        // unused. Note that this is distinct from the case where there were
                        // no imports at all (e.g. "import 'foo'"). In that case we want to keep
                        // the statement because the user is clearly trying to import the module
                        // for side effects.
                        //
                        // This culling is important for correctness when parsing TypeScript
                        // because a) the TypeScript compiler does ths and we want to match it
                        // and b) this may be a fake module that only exists in the type system
                        // and doesn't actually exist in reality.
                        //
                        // We do not want to do this culling in JavaScript though because the
                        // module may have side effects even if all imports are unused.
                        // -- Original Comment --

                        // jarred: I think, in this project, we want this behavior, even in JavaScript.
                        // I think this would be a big performance improvement.
                        // The less you import, the less code you transpile.
                        // Side-effect imports are nearly always done through identifier-less imports
                        // e.g. `import 'fancy-stylesheet-thing/style.css';`
                        // This is a breaking change though. We can make it an option with some guardrail
                        // so maybe if it errors, it shows a suggestion "retry without trimming unused imports"
                        if (found_imports and !p.options.preserve_unused_imports_ts) {
                            // Ignore import records with a pre-filled source index. These are
                            // for injected files and we definitely do not want to trim these.
                            if (!Ref.isSourceIndexNull(record.source_index)) {
                                record.is_unused = true;
                                continue;
                            }
                        }
                    }

                    if (p.options.trim_unused_imports) {
                        if (st.star_name_loc != null or did_remove_star_loc) {
                            // -- Original Comment --
                            // If we're bundling a star import and the namespace is only ever
                            // used for property accesses, then convert each unique property to
                            // a clause item in the import statement and remove the star import.
                            // That will cause the bundler to bundle them more efficiently when
                            // both this module and the imported module are in the same group.
                            //
                            // Before:
                            //
                            //   import * as ns from 'foo'
                            //   console.log(ns.a, ns.b)
                            //
                            // After:
                            //
                            //   import {a, b} from 'foo'
                            //   console.log(a, b)
                            //
                            // This is not done if the namespace itself is used, because in that
                            // case the code for the namespace will have to be generated. This is
                            // determined by the symbol count because the parser only counts the
                            // star import as used if it was used for something other than a
                            // property access:
                            //
                            //   import * as ns from 'foo'
                            //   console.log(ns, ns.a, ns.b)
                            //
                            // -- Original Comment --

                            // jarred: we don't use the same grouping mechanism as esbuild
                            // but, we do this anyway.
                            // The reasons why are:
                            // * It makes static analysis for other tools simpler.
                            // * I imagine browsers may someday do some optimizations
                            // when it's "easier" to know only certain modules are used
                            // For example, if you're importing a component from a design system
                            // it's really stupid to import all 1,000 components from that design system
                            // when you just want <Button />
                            const namespace_ref = st.namespace_ref;
                            const convert_star_to_clause = p.symbols.items[namespace_ref.inner_index].use_count_estimate == 0;

                            if (convert_star_to_clause and !keep_unused_imports) {
                                st.star_name_loc = null;
                            }

                            // "importItemsForNamespace" has property accesses off the namespace
                            if (p.import_items_for_namespace.get(namespace_ref)) |import_items| {
                                var count = import_items.count();
                                if (count > 0) {
                                    // Sort keys for determinism
                                    var sorted: []string = try p.allocator.alloc(string, count);
                                    var iter = import_items.iterator();
                                    var i: usize = 0;
                                    while (iter.next()) |item| {
                                        sorted[i] = item.key;
                                        i += 1;
                                    }
                                    strings.sortAsc(sorted);

                                    if (convert_star_to_clause) {
                                        // Create an import clause for these items. Named imports will be
                                        // automatically created later on since there is now a clause.
                                        var items = try p.allocator.alloc(js_ast.ClauseItem, count);
                                        try p.declared_symbols.ensureUnusedCapacity(count);
                                        i = 0;
                                        for (sorted) |alias| {
                                            const name: LocRef = import_items.get(alias) orelse unreachable;
                                            const original_name = p.symbols.items[name.ref.?.inner_index].original_name;
                                            items[i] = js_ast.ClauseItem{
                                                .alias = alias,
                                                .alias_loc = name.loc,
                                                .name = name,
                                                .original_name = original_name,
                                            };
                                            p.declared_symbols.appendAssumeCapacity(js_ast.DeclaredSymbol{
                                                .ref = name.ref.?,
                                                .is_top_level = true,
                                            });

                                            i += 1;
                                        }

                                        if (st.items.len > 0) {
                                            p.panic("The syntax \"import {{x}}, * as y from 'path'\" isn't valid", .{});
                                        }

                                        st.items = items;
                                    } else {
                                        // If we aren't converting this star import to a clause, still
                                        // create named imports for these property accesses. This will
                                        // cause missing imports to generate useful warnings.
                                        //
                                        // It will also improve bundling efficiency for internal imports
                                        // by still converting property accesses off the namespace into
                                        // bare identifiers even if the namespace is still needed.

                                        for (sorted) |alias| {
                                            const name: LocRef = import_items.get(alias) orelse unreachable;

                                            try p.named_imports.put(name.ref.?, js_ast.NamedImport{
                                                .alias = alias,
                                                .alias_loc = name.loc,
                                                .namespace_ref = st.namespace_ref,
                                                .import_record_index = st.import_record_index,
                                            });

                                            // Make sure the printer prints this as a property access
                                            var symbol: Symbol = p.symbols.items[name.ref.?.inner_index];
                                            symbol.namespace_alias = G.NamespaceAlias{ .namespace_ref = st.namespace_ref, .alias = alias };
                                            p.symbols.items[name.ref.?.inner_index] = symbol;
                                        }
                                    }
                                }
                            }
                        }
                    }

                    try p.import_records_for_current_part.append(st.import_record_index);

                    if (st.star_name_loc != null) {
                        record.contains_import_star = true;
                    }

                    if (st.default_name != null) {
                        record.contains_default_alias = true;
                    } else {
                        for (st.items) |item| {
                            if (strings.eqlComptime(item.alias, "default")) {
                                record.contains_default_alias = true;
                                break;
                            }
                        }
                    }
                },
                .s_function => |st| {
                    if (st.func.flags.is_export) {
                        if (st.func.name) |name| {
                            try p.recordExport(name.loc, p.symbols.items[name.ref.?.inner_index].original_name, name.ref.?);
                        } else {
                            try p.log.addRangeError(p.source, logger.Range{ .loc = st.func.open_parens_loc, .len = 2 }, "Exported functions must have a name");
                        }
                    }
                },
                .s_class => |st| {
                    if (st.is_export) {
                        if (st.class.class_name) |name| {
                            try p.recordExport(name.loc, p.symbols.items[name.ref.?.inner_index].original_name, name.ref.?);
                        } else {
                            try p.log.addRangeError(p.source, logger.Range{ .loc = st.class.body_loc, .len = 0 }, "Exported classes must have a name");
                        }
                    }
                },
                .s_local => |st| {
                    if (st.is_export) {
                        for (st.decls) |decl| {
                            p.recordExportedBinding(decl.binding);
                        }
                    }

                    // Remove unused import-equals statements, since those likely
                    // correspond to types instead of values
                    if (st.was_ts_import_equals and !st.is_export and st.decls.len > 0) {
                        var decl = st.decls[0];

                        // Skip to the underlying reference
                        var value = decl.value;
                        if (decl.value) |val| {
                            while (true) {
                                if (@as(Expr.Tag, val.data) == .e_dot) {
                                    value = val.data.e_dot.target;
                                } else {
                                    break;
                                }
                            }
                        }

                        // Is this an identifier reference and not a require() call?
                        if (value) |val| {
                            if (@as(Expr.Tag, val.data) == .e_identifier) {
                                // Is this import statement unused?
                                if (@as(Binding.Tag, decl.binding.data) == .b_identifier and p.symbols.items[decl.binding.data.b_identifier.ref.inner_index].use_count_estimate == 0) {
                                    p.ignoreUsage(val.data.e_identifier.ref);

                                    scanner.removed_import_equals = true;
                                    continue;
                                } else {
                                    scanner.kept_import_equals = true;
                                }
                            }
                        }
                    }
                },
                .s_export_default => |st| {
                    try p.recordExport(st.default_name.loc, "default", st.default_name.ref.?);
                },
                .s_export_clause => |st| {
                    for (st.items) |item| {
                        try p.recordExport(item.alias_loc, item.alias, item.name.ref.?);
                    }
                },
                .s_export_star => |st| {
                    try p.import_records_for_current_part.append(st.import_record_index);

                    if (st.alias) |alias| {
                        // "export * as ns from 'path'"
                        try p.named_imports.put(st.namespace_ref, js_ast.NamedImport{
                            .alias = null,
                            .alias_is_star = true,
                            .alias_loc = alias.loc,
                            .namespace_ref = Ref.None,
                            .import_record_index = st.import_record_index,
                            .is_exported = true,
                        });
                        try p.recordExport(alias.loc, alias.original_name, st.namespace_ref);
                    } else {
                        // "export * from 'path'"
                        try p.export_star_import_records.append(st.import_record_index);
                    }
                },
                .s_export_from => |st| {
                    try p.import_records_for_current_part.append(st.import_record_index);

                    for (st.items) |item| {
                        const ref = item.name.ref orelse p.panic("Expected export from item to have a name {s}", .{st});
                        // Note that the imported alias is not item.Alias, which is the
                        // exported alias. This is somewhat confusing because each
                        // SExportFrom statement is basically SImport + SExportClause in one.
                        try p.named_imports.put(ref, js_ast.NamedImport{
                            .alias_is_star = false,
                            .alias = item.original_name,
                            .alias_loc = item.name.loc,
                            .namespace_ref = st.namespace_ref,
                            .import_record_index = st.import_record_index,
                            .is_exported = true,
                        });
                        try p.recordExport(item.name.loc, item.alias, ref);
                    }
                },
                else => {},
            }

            stmts[stmts_end] = stmt;
            stmts_end += 1;
        }
        scanner.stmts = stmts[0..stmts_end];
        return scanner;
    }
};

pub const SideEffects = enum {
    could_have_side_effects,
    no_side_effects,

    pub const Result = struct {
        side_effects: SideEffects,
        ok: bool = false,
        value: bool = false,
    };

    pub fn toNumber(data: Expr.Data) ?f64 {
        switch (data) {
            .e_null => |e| {
                return 0;
            },
            .e_undefined => |e| {
                return std.math.nan_f64;
            },
            .e_boolean => |e| {
                return if (e.value) 1.0 else 0.0;
            },
            .e_number => |e| {
                return e.value;
            },
            else => {},
        }

        return null;
    }

    pub fn isPrimitiveToReorder(data: Expr.Data) bool {
        switch (data) {
            .e_null, .e_undefined, .e_string, .e_boolean, .e_number, .e_big_int => {
                return true;
            },
            else => {
                return false;
            },
        }
    }

    pub const Equality = struct { equal: bool = false, ok: bool = false };

    // Returns "equal, ok". If "ok" is false, then nothing is known about the two
    // values. If "ok" is true, the equality or inequality of the two values is
    // stored in "equal".
    pub fn eql(left: Expr.Data, right: Expr.Data, p: *P) Equality {
        var equality = Equality{};
        switch (left) {
            .e_null => |l| {
                equality.equal = @as(Expr.Tag, right) == Expr.Tag.e_null;
                equality.ok = equality.equal;
            },
            .e_undefined => |l| {
                equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_undefined;
                equality.equal = equality.ok;
            },
            .e_boolean => |l| {
                equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_boolean;
                equality.equal = equality.ok and l.value == right.e_boolean.value;
            },
            .e_number => |l| {
                equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_number;
                equality.equal = equality.ok and l.value == right.e_number.value;
            },
            .e_big_int => |l| {
                equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_big_int;
                equality.equal = equality.ok and strings.eql(l.value, right.e_big_int.value);
            },
            .e_string => |l| {
                equality.ok = @as(Expr.Tag, right) == Expr.Tag.e_string;
                if (equality.ok) {
                    const r = right.e_string;
                    equality.equal = r.eql(E.String, l);
                }
            },
            else => {},
        }

        return equality;
    }

    // Returns true if this expression is known to result in a primitive value (i.e.
    // null, undefined, boolean, number, bigint, or string), even if the expression
    // cannot be removed due to side effects.
    pub fn isPrimitiveWithSideEffects(data: Expr.Data) bool {
        switch (data) {
            .e_null, .e_undefined, .e_boolean, .e_number, .e_big_int, .e_string => {
                return true;
            },
            .e_unary => |e| {
                switch (e.op) {
                    // number or bigint
                    .un_pos,
                    .un_neg,
                    .un_cpl,
                    .un_pre_dec,
                    .un_pre_inc,
                    .un_post_dec,
                    .un_post_inc,
                    // boolean
                    .un_not,
                    .un_delete,
                    // undefined
                    .un_void,
                    // string
                    .un_typeof,
                    => {
                        return true;
                    },
                    else => {},
                }
            },
            .e_binary => |e| {
                switch (e.op) {
                    // boolean
                    .bin_lt,
                    .bin_le,
                    .bin_gt,
                    .bin_ge,
                    .bin_in,
                    .bin_instanceof,
                    .bin_loose_eq,
                    .bin_loose_ne,
                    .bin_strict_eq,
                    .bin_strict_ne,
                    // string, number, or bigint
                    .bin_add,
                    .bin_add_assign,
                    // number or bigint
                    .bin_sub,
                    .bin_mul,
                    .bin_div,
                    .bin_rem,
                    .bin_pow,
                    .bin_sub_assign,
                    .bin_mul_assign,
                    .bin_div_assign,
                    .bin_rem_assign,
                    .bin_pow_assign,
                    .bin_shl,
                    .bin_shr,
                    .bin_u_shr,
                    .bin_shl_assign,
                    .bin_shr_assign,
                    .bin_u_shr_assign,
                    .bin_bitwise_or,
                    .bin_bitwise_and,
                    .bin_bitwise_xor,
                    .bin_bitwise_or_assign,
                    .bin_bitwise_and_assign,
                    .bin_bitwise_xor_assign,
                    => {
                        return true;
                    },

                    // These always return one of the arguments unmodified
                    .bin_logical_and, .bin_logical_or, .bin_nullish_coalescing, .bin_logical_and_assign, .bin_logical_or_assign, .bin_nullish_coalescing_assign => {
                        return isPrimitiveWithSideEffects(e.left.data) and isPrimitiveWithSideEffects(e.right.data);
                    },
                    .bin_comma => {
                        return isPrimitiveWithSideEffects(e.right.data);
                    },
                }
            },
            .e_if => {
                return isPrimitiveWithSideEffects(e.yes.data) and isPrimitiveWithSideEffects(e.no.data);
            },
            else => {},
        }
        return false;
    }

    // Returns true if the result of the "typeof" operator on this expression is
    // statically determined and this expression has no side effects (i.e. can be
    // removed without consequence).
    pub fn toTypeof(data: Expr.Data) ?string {
        switch (data) {
            .e_null => {
                return "object";
            },
            .e_undefined => {
                return "undefined";
            },
            .e_boolean => {
                return "boolean";
            },
            .e_number => {
                return "number";
            },
            .e_big_int => {
                return "bigint";
            },
            .e_string => {
                return "string";
            },
            .e_function, .e_arrow => {
                return "function";
            },
            else => {},
        }

        return null;
    }

    pub fn toNullOrUndefined(exp: Expr.Data) Result {
        switch (exp) {
            // Never null or undefined
            .e_boolean, .e_number, .e_string, .e_reg_exp, .e_function, .e_arrow, .e_big_int => {
                return Result{ .value = false, .side_effects = SideEffects.no_side_effects, .ok = true };
            },

            .e_object, .e_array, .e_class => {
                return Result{ .value = false, .side_effects = .could_have_side_effects, .ok = true };
            },

            // always anull or undefined
            .e_null, .e_undefined => {
                return Result{ .value = true, .side_effects = .could_have_side_effects, .ok = true };
            },

            .e_unary => |e| {
                switch (e.op) {
                    // Always number or bigint
                    .un_pos, .un_neg, .un_cpl, .un_pre_dec, .un_pre_inc, .un_post_dec, .un_post_inc => {
                        return Result{ .ok = true, .value = false, .side_effects = SideEffects.could_have_side_effects };
                    },
                    // Always undefined
                    .un_not, .un_typeof, .un_delete => {
                        return Result{ .value = true, .side_effects = .could_have_side_effects, .ok = true };
                    },

                    .un_void => {
                        return Result{ .value = true, .side_effects = .could_have_side_effects, .ok = true };
                    },

                    else => {},
                }
            },

            .e_binary => |e| {
                switch (e.op) {
                    // always string or number or bigint
                    .bin_add,
                    .bin_add_assign,
                    // always number or bigint
                    .bin_sub,
                    .bin_mul,
                    .bin_div,
                    .bin_rem,
                    .bin_pow,
                    .bin_sub_assign,
                    .bin_mul_assign,
                    .bin_div_assign,
                    .bin_rem_assign,
                    .bin_pow_assign,
                    .bin_shl,
                    .bin_shr,
                    .bin_u_shr,
                    .bin_shl_assign,
                    .bin_shr_assign,
                    .bin_u_shr_assign,
                    .bin_bitwise_or,
                    .bin_bitwise_and,
                    .bin_bitwise_xor,
                    .bin_bitwise_or_assign,
                    .bin_bitwise_and_assign,
                    .bin_bitwise_xor_assign,
                    // always boolean
                    .bin_lt,
                    .bin_le,
                    .bin_gt,
                    .bin_ge,
                    .bin_in,
                    .bin_instanceof,
                    .bin_loose_eq,
                    .bin_loose_ne,
                    .bin_strict_eq,
                    .bin_strict_ne,
                    => {
                        return Result{ .ok = true, .value = false, .side_effects = SideEffects.could_have_side_effects };
                    },

                    .bin_comma => {
                        const res = toNullOrUndefined(e.right.data);
                        if (res.ok) {
                            return Result{ .ok = true, .value = res.value, .side_effects = SideEffects.could_have_side_effects };
                        }
                    },
                    else => {},
                }
            },
            else => {},
        }

        return Result{ .ok = false, .value = false, .side_effects = SideEffects.could_have_side_effects };
    }

    pub fn toBoolean(exp: Expr.Data) Result {
        switch (exp) {
            .e_null, .e_undefined => {
                return Result{ .ok = true, .value = false, .side_effects = .no_side_effects };
            },
            .e_boolean => |e| {
                return Result{ .ok = true, .value = e.value, .side_effects = .no_side_effects };
            },
            .e_number => |e| {
                return Result{ .ok = true, .value = e.value != 0.0 and !std.math.isNan(e.value), .side_effects = .no_side_effects };
            },
            .e_big_int => |e| {
                return Result{ .ok = true, .value = !strings.eqlComptime(e.value, "0"), .side_effects = .no_side_effects };
            },
            .e_string => |e| {
                return Result{ .ok = true, .value = std.math.max(e.value.len, e.utf8.len) > 0, .side_effects = .no_side_effects };
            },
            .e_function, .e_arrow, .e_reg_exp => {
                return Result{ .ok = true, .value = true, .side_effects = .no_side_effects };
            },
            .e_object, .e_array, .e_class => {
                return Result{ .ok = true, .value = true, .side_effects = .could_have_side_effects };
            },
            .e_unary => |e_| {
                switch (e_.op) {
                    .un_void => {
                        return Result{ .ok = true, .value = false, .side_effects = .could_have_side_effects };
                    },
                    .un_typeof => {
                        // Never an empty string

                        return Result{ .ok = true, .value = true, .side_effects = .could_have_side_effects };
                    },
                    .un_not => {
                        var result = toBoolean(e_.value.data);
                        if (result.ok) {
                            result.value = !result.value;
                            return result;
                        }
                    },
                    else => {},
                }
            },
            .e_binary => |e_| {
                switch (e_.op) {
                    .bin_logical_or => {
                        // "anything || truthy" is truthy
                        const result = toBoolean(e_.right.data);
                        if (result.value and result.ok) {
                            return Result{ .ok = true, .value = true, .side_effects = .could_have_side_effects };
                        }
                    },
                    .bin_logical_and => {
                        // "anything && falsy" is falsy
                        const result = toBoolean(e_.right.data);
                        if (!result.value and result.ok) {
                            return Result{ .ok = true, .value = false, .side_effects = .could_have_side_effects };
                        }
                    },
                    .bin_comma => {
                        // "anything, truthy/falsy" is truthy/falsy
                        var result = toBoolean(e_.right.data);
                        if (result.ok) {
                            result.side_effects = .could_have_side_effects;
                            return result;
                        }
                    },
                    else => {},
                }
            },
            else => {},
        }

        return Result{ .ok = false, .value = false, .side_effects = SideEffects.could_have_side_effects };
    }
};

const ExprOrLetStmt = struct {
    stmt_or_expr: js_ast.StmtOrExpr,
    decls: []G.Decl = &([_]G.Decl{}),
};

const FunctionKind = enum { stmt, expr };

const EightLetterMatcher = strings.ExactSizeMatcher(8);

const AsyncPrefixExpression = enum {
    none,
    is_yield,
    is_async,
    is_await,

    pub fn find(ident: string) AsyncPrefixExpression {
        if (ident.len != 5) {
            return .none;
        }

        switch (EightLetterMatcher.match(ident)) {
            EightLetterMatcher.case("yield") => {
                return .is_yield;
            },
            EightLetterMatcher.case("await") => {
                return .is_await;
            },
            EightLetterMatcher.case("async") => {
                return .is_async;
            },

            else => {
                return .none;
            },
        }
    }
};

const IdentifierOpts = struct {
    assign_target: js_ast.AssignTarget = js_ast.AssignTarget.none,
    is_delete_target: bool = false,
    was_originally_identifier: bool = false,
};

fn statementCaresAboutScope(stmt: Stmt) bool {
    switch (stmt.data) {
        .s_block,
        .s_empty,
        .s_debugger,
        .s_expr,
        .s_if,
        .s_for,
        .s_for_in,
        .s_for_of,
        .s_do_while,
        .s_while,
        .s_with,
        .s_try,
        .s_switch,
        .s_return,
        .s_throw,
        .s_break,
        .s_continue,
        .s_directive,
        => {
            return false;
        },
        .s_local => |s| {
            return s.kind != .k_var;
        },
        else => {
            return true;
        },
    }
}

const ExprIn = struct {
    // This tells us if there are optional chain expressions (EDot, EIndex, or
    // ECall) that are chained on to this expression. Because of the way the AST
    // works, chaining expressions on to this expression means they are our
    // parent expressions.
    //
    // Some examples:
    //
    //   a?.b.c  // EDot
    //   a?.b[c] // EIndex
    //   a?.b()  // ECall
    //
    // Note that this is false if our parent is a node with a OptionalChain
    // value of OptionalChainStart. That means it's the start of a new chain, so
    // it's not considered part of this one.
    //
    // Some examples:
    //
    //   a?.b?.c   // EDot
    //   a?.b?.[c] // EIndex
    //   a?.b?.()  // ECall
    //
    // Also note that this is false if our parent is a node with a OptionalChain
    // value of OptionalChainNone. That means it's outside parentheses, which
    // means it's no longer part of the chain.
    //
    // Some examples:
    //
    //   (a?.b).c  // EDot
    //   (a?.b)[c] // EIndex
    //   (a?.b)()  // ECall
    //
    has_chain_parent: bool = false,

    // If our parent is an ECall node with an OptionalChain value of
    // OptionalChainStart, then we will need to store the value for the "this" of
    // that call somewhere if the current expression is an optional chain that
    // ends in a property access. That's because the value for "this" will be
    // used twice: once for the inner optional chain and once for the outer
    // optional chain.
    //
    // Example:
    //
    //   // Original
    //   a?.b?.();
    //
    //   // Lowered
    //   var _a;
    //   (_a = a == null ? void 0 : a.b) == null ? void 0 : _a.call(a);
    //
    // In the example above we need to store "a" as the value for "this" so we
    // can substitute it back in when we call "_a" if "_a" is indeed present.
    // See also "thisArgFunc" and "thisArgWrapFunc" in "exprOut".
    store_this_arg_for_parent_optional_chain: bool = false,

    // Certain substitutions of identifiers are disallowed for assignment targets.
    // For example, we shouldn't transform "undefined = 1" into "void 0 = 1". This
    // isn't something real-world code would do but it matters for conformance
    // tests.
    assign_target: js_ast.AssignTarget = js_ast.AssignTarget.none,
};

const ExprOut = struct {
    // True if the child node is an optional chain node (EDot, EIndex, or ECall
    // with an IsOptionalChain value of true)
    child_contains_optional_chain: bool = false,
};

const Tup = std.meta.Tuple;

// This function exists to tie all of these checks together in one place
// This can sometimes show up on benchmarks as a small thing.
fn isEvalOrArguments(name: string) bool {
    return strings.eqlComptime(name, "eval") or strings.eqlComptime(name, "arguments");
}

const PrependTempRefsOpts = struct {
    fn_body_loc: ?logger.Loc = null,
    kind: StmtsKind = StmtsKind.none,
};

pub const StmtsKind = enum {
    none,
    loop_body,
    fn_body,
};

fn notimpl() noreturn {
    Global.panic("Not implemented yet!!", .{});
}

fn lexerpanic() noreturn {
    Global.panic("LexerPanic", .{});
}

fn fail() noreturn {
    Global.panic("Something went wrong :cry;", .{});
}

const ExprBindingTuple = struct { expr: ?ExprNodeIndex = null, binding: ?Binding = null, override_expr: ?ExprNodeIndex = null };

const TempRef = struct {
    ref: Ref,
    value: ?Expr = null,
};

const ImportNamespaceCallOrConstruct = struct {
    ref: js_ast.Ref,
    is_construct: bool = false,
};

const ThenCatchChain = struct {
    next_target: js_ast.Expr.Data,
    has_multiple_args: bool = false,
    has_catch: bool = false,
};

const ParsedPath = struct { loc: logger.Loc, text: string };

const StrictModeFeature = enum {
    with_statement,
    delete_bare_name,
    for_in_var_init,
    eval_or_arguments,
    reserved_word,
    legacy_octal_literal,
    legacy_octal_escape,
    if_else_function_stmt,
};

const SymbolMergeResult = enum {
    forbidden,
    replace_with_new,
    overwrite_with_new,
    keep_existing,
    become_private_get_set_pair,
    become_private_static_get_set_pair,
};

const Map = std.AutoHashMap;

const List = std.ArrayList;
const LocList = List(logger.Loc);
const StmtList = List(Stmt);

const SymbolUseMap = Map(js_ast.Ref, js_ast.Symbol.Use);
const StringRefMap = std.StringHashMap(js_ast.Ref);
const StringBoolMap = std.StringHashMap(bool);
const RefBoolMap = Map(js_ast.Ref, bool);
const RefRefMap = Map(js_ast.Ref, js_ast.Ref);
const ImportRecord = importRecord.ImportRecord;
const Flags = js_ast.Flags;
const ScopeOrder = struct {
    loc: logger.Loc,
    scope: *js_ast.Scope,
};
const EnumValueType = enum {
    unknown,
    string,
    numeric,
};

const ParenExprOpts = struct {
    async_range: logger.Range = logger.Range.None,
    is_async: bool = false,
    force_arrow_fn: bool = false,
};

const AwaitOrYield = enum {
    allow_ident,
    allow_expr,
    forbid_all,
};

// This is function-specific information used during parsing. It is saved and
// restored on the call stack around code that parses nested functions and
// arrow expressions.
const FnOrArrowDataParse = struct {
    async_range: ?logger.Range = null,
    allow_await: AwaitOrYield = AwaitOrYield.allow_ident,
    allow_yield: AwaitOrYield = AwaitOrYield.allow_ident,
    allow_super_call: bool = false,
    is_top_level: bool = false,
    is_constructor: bool = false,
    is_typescript_declare: bool = false,
    arrow_arg_errors: ?DeferredArrowArgErrors = null,

    // In TypeScript, forward declarations of functions have no bodies
    allow_missing_body_for_type_script: bool = false,

    // Allow TypeScript decorators in function arguments
    allow_ts_decorators: bool = false,

    pub fn i() FnOrArrowDataParse {
        return FnOrArrowDataParse{ .allow_await = AwaitOrYield.forbid_all };
    }
};

// This is function-specific information used during visiting. It is saved and
// restored on the call stack around code that parses nested functions and
// arrow expressions.
const FnOrArrowDataVisit = struct {
    super_index_ref: ?*js_ast.Ref = null,

    is_arrow: bool = false,
    is_async: bool = false,
    is_inside_loop: bool = false,
    is_inside_switch: bool = false,
    is_outside_fn_or_arrow: bool = false,

    // This is used to silence unresolvable imports due to "require" calls inside
    // a try/catch statement. The assumption is that the try/catch statement is
    // there to handle the case where the reference to "require" crashes.
    try_body_count: i32 = 0,
};

// This is function-specific information used during visiting. It is saved and
// restored on the call stack around code that parses nested functions (but not
// nested arrow functions).
const FnOnlyDataVisit = struct {
    // This is a reference to the magic "arguments" variable that exists inside
    // functions in JavaScript. It will be non-nil inside functions and nil
    // otherwise.
    arguments_ref: ?js_ast.Ref = null,

    // Arrow functions don't capture the value of "this" and "arguments". Instead,
    // the values are inherited from the surrounding context. If arrow functions
    // are turned into regular functions due to lowering, we will need to generate
    // local variables to capture these values so they are preserved correctly.
    this_capture_ref: ?js_ast.Ref = null,
    arguments_capture_ref: ?js_ast.Ref = null,

    // Inside a static class property initializer, "this" expressions should be
    // replaced with the class name.
    this_class_static_ref: ?js_ast.Ref = null,

    // If we're inside an async arrow function and async functions are not
    // supported, then we will have to convert that arrow function to a generator
    // function. That means references to "arguments" inside the arrow function
    // will have to reference a captured variable instead of the real variable.
    is_inside_async_arrow_fn: bool = false,

    // If false, the value for "this" is the top-level module scope "this" value.
    // That means it's "undefined" for ECMAScript modules and "exports" for
    // CommonJS modules. We track this information so that we can substitute the
    // correct value for these top-level "this" references at compile time instead
    // of passing the "this" expression through to the output and leaving the
    // interpretation up to the run-time behavior of the generated code.
    //
    // If true, the value for "this" is nested inside something (either a function
    // or a class declaration). That means the top-level module scope "this" value
    // has been shadowed and is now inaccessible.
    is_this_nested: bool = false,
};

// Due to ES6 destructuring patterns, there are many cases where it's
// impossible to distinguish between an array or object literal and a
// destructuring assignment until we hit the "=" operator later on.
// This object defers errors about being in one state or the other
// until we discover which state we're in.
const DeferredErrors = struct {
    // These are errors for expressions
    invalid_expr_default_value: ?logger.Range = null,
    invalid_expr_after_question: ?logger.Range = null,
    array_spread_feature: ?logger.Range = null,

    pub fn isEmpty(self: *DeferredErrors) bool {
        return self.invalid_expr_default_value == null and self.invalid_expr_after_question == null and self.array_spread_feature == null;
    }

    pub fn mergeInto(self: *DeferredErrors, to: *DeferredErrors) void {
        if (self.invalid_expr_default_value) |inv| {
            to.invalid_expr_default_value = inv;
        }

        if (self.invalid_expr_after_question) |inv| {
            to.invalid_expr_after_question = inv;
        }

        if (self.array_spread_feature) |inv| {
            to.array_spread_feature = inv;
        }
    }

    var None = DeferredErrors{
        .invalid_expr_default_value = null,
        .invalid_expr_after_question = null,
        .array_spread_feature = null,
    };
};

const ImportClause = struct {
    items: []js_ast.ClauseItem = &([_]js_ast.ClauseItem{}),
    is_single_line: bool = false,
};

const ModuleType = enum { esm };

const PropertyOpts = struct {
    async_range: logger.Range = logger.Range.None,
    is_async: bool = false,
    is_generator: bool = false,

    // Class-related options
    is_static: bool = false,
    is_class: bool = false,
    class_has_extends: bool = false,
    allow_ts_decorators: bool = false,
    ts_decorators: []Expr = &[_]Expr{},
};

pub const Parser = struct {
    options: Options,
    lexer: js_lexer.Lexer,
    log: *logger.Log,
    source: *const logger.Source,
    define: *Define,
    allocator: *std.mem.Allocator,
    p: ?*P,

    pub const Options = struct {
        jsx: options.JSX.Pragma,
        ts: bool = false,
        ascii_only: bool = true,
        keep_names: bool = true,
        mangle_syntax: bool = false,
        mange_identifiers: bool = false,
        omit_runtime_for_tests: bool = false,
        ignore_dce_annotations: bool = true,
        preserve_unused_imports_ts: bool = false,
        use_define_for_class_fields: bool = false,
        suppress_warnings_about_weird_code: bool = true,

        moduleType: ModuleType = ModuleType.esm,
        trim_unused_imports: bool = true,

        pub fn init(jsx: options.JSX.Pragma, loader: options.Loader) Options {
            return Options{
                .ts = loader.isTypeScript(),

                .jsx = jsx,
            };
        }
    };

    pub fn parse(self: *Parser) !js_ast.Result {
        if (self.p == null) {
            self.p = try P.init(self.allocator, self.log, self.source, self.define, self.lexer, self.options);
        }

        var result: js_ast.Result = undefined;

        if (self.p) |p| {
            // Parse the file in the first pass, but do not bind symbols
            var opts = ParseStatementOptions{ .is_module_scope = true };
            debugl("<p.parseStmtsUpTo>");
            const stmts = try p.parseStmtsUpTo(js_lexer.T.t_end_of_file, &opts);
            debugl("</p.parseStmtsUpTo>");
            try p.prepareForVisitPass();

            // ESM is always strict mode. I don't think we need this.
            // // Strip off a leading "use strict" directive when not bundling
            // var directive = "";

            // Insert a variable for "import.meta" at the top of the file if it was used.
            // We don't need to worry about "use strict" directives because this only
            // happens when bundling, in which case we are flatting the module scopes of
            // all modules together anyway so such directives are meaningless.
            // if (!p.import_meta_ref.isSourceIndexNull()) {
            //     // heap so it lives beyond this function call
            //     var decls = try p.allocator.alloc(G.Decl, 1);
            //     decls[0] = Decl{ .binding = p.b(B.Identifier{
            //         .ref = p.import_meta_ref,
            //     }, logger.Loc.Empty), .value = p.e(E.Object{}, logger.Loc.Empty) };
            //     var importMetaStatement = p.s(S.Local{
            //         .kind = .k_const,
            //         .decls = decls,
            //     }, logger.Loc.Empty);
            // }

            debugl("<p.appendPart>");
            var before = List(js_ast.Part).init(p.allocator);
            var after = List(js_ast.Part).init(p.allocator);
            var parts = List(js_ast.Part).init(p.allocator);
            try p.appendPart(&parts, stmts);

            // Auto-import JSX
            if (p.options.jsx.parse) {
                const jsx_symbol: Symbol = p.symbols.items[p.jsx_runtime_ref.inner_index];
                const jsx_fragment_symbol: Symbol = p.symbols.items[p.jsx_fragment_ref.inner_index];
                const jsx_factory_symbol: Symbol = p.symbols.items[p.jsx_factory_ref.inner_index];

                if (jsx_symbol.use_count_estimate > 0 or jsx_fragment_symbol.use_count_estimate > 0 or jsx_factory_symbol.use_count_estimate > 0) {
                    var jsx_imports = [_]string{ "", "", "" };
                    var symbols = StringRefMap.init(p.allocator);
                    defer symbols.deinit();
                    var i: usize = 0;
                    var additional_stmt: ?Stmt = null;
                    if (jsx_factory_symbol.use_count_estimate > 0) {
                        jsx_imports[i] = p.options.jsx.factory[0];
                        try symbols.put(p.options.jsx.factory[0], p.jsx_factory_ref);
                        i += 1;
                    }

                    if (jsx_symbol.use_count_estimate > 0) {
                        jsx_imports[i] = p.options.jsx.jsx;
                        i += 1;
                        try symbols.put(p.options.jsx.jsx, p.jsx_runtime_ref);
                        // While we are here, add the __jsxFilename declaration
                    }

                    if (p.options.jsx.development) {
                        const jsx_filename_symbol = p.symbols.items[p.jsx_filename_ref.inner_index];
                        if (jsx_filename_symbol.use_count_estimate > 0) {
                            var decls = try p.allocator.alloc(G.Decl, 1);
                            var filename_str = try strings.toUTF16Alloc(p.source.path.pretty, p.allocator);
                            decls[0] = G.Decl{ .binding = p.b(B.Identifier{ .ref = p.jsx_filename_ref }, logger.Loc{}), .value = p.e(E.String{ .value = filename_str }, logger.Loc{}) };
                            additional_stmt = p.s(S.Local{ .kind = .k_var, .decls = decls }, logger.Loc{});
                            try symbols.put(Prefill.Runtime.JSXFilename, p.jsx_filename_ref);
                        }
                    }

                    if (jsx_fragment_symbol.use_count_estimate > 0) {
                        jsx_imports[i] = p.options.jsx.fragment[0];

                        try symbols.put(p.options.jsx.fragment[0], p.jsx_fragment_ref);
                        i += 1;
                    }

                    try p.generateImportStmt(p.options.jsx.import_source, jsx_imports[0..i], &before, symbols, additional_stmt);
                }
            }

            // for (stmts) |stmt| {
            //     var _stmts = ([_]Stmt{stmt});

            //     switch (stmt.data) {
            //         // Split up top-level multi-declaration variable statements

            //         .s_local => |local| {
            //             for (local.decls) |decl| {
            //                 var decls = try p.allocator.alloc(Decl, 1);
            //                 var clone = S.Local{
            //                     .kind = local.kind,
            //                     .decls = decls,
            //                     .is_export = local.is_export,
            //                     .was_ts_import_equals = local.was_ts_import_equals,
            //                 };
            //                 _stmts[0] = p.s(clone, stmt.loc);

            //                 try p.appendPart(&parts, &_stmts);
            //             }
            //         },
            //         // Move imports (and import-like exports) to the top of the file to
            //         // ensure that if they are converted to a require() call, the effects
            //         // will take place before any other statements are evaluated.
            //         .s_import, .s_export_from, .s_export_star => {
            //             try p.appendPart(&before, &_stmts);
            //         },

            //         .s_export_equals => {
            //             try p.appendPart(&after, &_stmts);
            //         },
            //         else => {
            //             try p.appendPart(&parts, &_stmts);
            //         },
            //     }
            // }
            // p.popScope();
            var parts_slice: []js_ast.Part = &([_]js_ast.Part{});

            if (before.items.len > 0 or after.items.len > 0) {
                const before_len = before.items.len;
                const after_len = after.items.len;
                const parts_len = parts.items.len;
                var _parts = try p.allocator.alloc(
                    js_ast.Part,
                    before_len +
                        after_len +
                        parts_len,
                );
                if (before_len > 0) {
                    std.mem.copy(js_ast.Part, _parts, before.toOwnedSlice());
                }
                if (parts_len > 0) {
                    std.mem.copy(js_ast.Part, _parts[before_len .. before_len + parts_len], parts.toOwnedSlice());
                }

                if (after_len > 0) {
                    std.mem.copy(js_ast.Part, _parts[before_len + parts_len .. _parts.len], after.toOwnedSlice());
                }
                parts_slice = _parts;
            } else {
                after.deinit();
                before.deinit();
                parts_slice = parts.toOwnedSlice();
            }
            debugl("</p.appendPart>");

            // Pop the module scope to apply the "ContainsDirectEval" rules
            // p.popScope();
            debugl("<result.Ast>");
            result.ast = try p.toAST(parts_slice);
            result.ok = true;
            debugl("</result.Ast>");

            // result = p.toAST(parts);
            // result.source_map_comment = p.lexer.source_mapping_url;
        }

        return result;
    }

    pub fn init(_options: Options, log: *logger.Log, source: *const logger.Source, define: *Define, allocator: *std.mem.Allocator) !Parser {
        const lexer = try js_lexer.Lexer.init(log, source, allocator);
        return Parser{
            .options = _options,
            .allocator = allocator,
            .lexer = lexer,
            .define = define,
            .source = source,
            .log = log,
            .p = null,
        };
    }
};

const FindLabelSymbolResult = struct { ref: Ref, is_loop: bool, found: bool = false };

const FindSymbolResult = struct {
    ref: Ref,
    declare_loc: ?logger.Loc = null,
    is_inside_with_scope: bool = false,
};
const ExportClauseResult = struct { clauses: []js_ast.ClauseItem = &([_]js_ast.ClauseItem{}), is_single_line: bool = false };

const DeferredTsDecorators = struct {
    values: []js_ast.Expr,

    // If this turns out to be a "declare class" statement, we need to undo the
    // scopes that were potentially pushed while parsing the decorator arguments.
    scope_index: usize,
};

const LexicalDecl = enum(u8) { forbid, allow_all, allow_fn_inside_if, allow_fn_inside_label };

const ParseClassOptions = struct {
    ts_decorators: []Expr = &[_]Expr{},
    allow_ts_decorators: bool = false,
    is_type_script_declare: bool = false,
};

const ParseStatementOptions = struct {
    ts_decorators: ?DeferredTsDecorators = null,
    lexical_decl: LexicalDecl = .forbid,
    is_module_scope: bool = false,
    is_namespace_scope: bool = false,
    is_export: bool = false,
    is_name_optional: bool = false, // For "export default" pseudo-statements,
    is_typescript_declare: bool = false,

    pub fn hasNoDecorators(self: *ParseStatementOptions) bool {
        const decs = self.ts_decorators orelse return false;
        return decs.values.len > 0;
    }
};

var e_missing_data = E.Missing{};
var s_missing = S.Empty{};
var nullExprData = Expr.Data{ .e_missing = &e_missing_data };
var nullStmtData = Stmt.Data{ .s_empty = &s_missing };
pub const Prefill = struct {
    pub const StringLiteral = struct {
        pub var Key = [3]u16{ 'k', 'e', 'y' };
        pub var Children = [_]u16{ 'c', 'h', 'i', 'l', 'd', 'r', 'e', 'n' };
        pub var Filename = [_]u16{ 'f', 'i', 'l', 'e', 'n', 'a', 'm', 'e' };
        pub var LineNumber = [_]u16{ 'l', 'i', 'n', 'e', 'N', 'u', 'm', 'b', 'e', 'r' };
        pub var ColumnNumber = [_]u16{ 'c', 'o', 'l', 'u', 'm', 'n', 'N', 'u', 'm', 'b', 'e', 'r' };
    };
    pub const Value = struct {
        pub var EThis = E.This{};
    };
    pub const String = struct {
        pub var Key = E.String{ .value = &Prefill.StringLiteral.Key };
        pub var Children = E.String{ .value = &Prefill.StringLiteral.Children };
        pub var Filename = E.String{ .value = &Prefill.StringLiteral.Filename };
        pub var LineNumber = E.String{ .value = &Prefill.StringLiteral.LineNumber };
        pub var ColumnNumber = E.String{ .value = &Prefill.StringLiteral.ColumnNumber };
    };
    pub const Data = struct {
        pub var BMissing = B{ .b_missing = &BMissing_ };
        pub var BMissing_ = B.Missing{};

        pub var EMissing = Expr.Data{ .e_missing = &EMissing_ };
        pub var EMissing_ = E.Missing{};

        pub var SEmpty = Stmt.Data{ .s_empty = &SEmpty_ };
        pub var SEmpty_ = S.Empty{};

        pub var Filename = Expr.Data{ .e_string = &Prefill.String.Filename };
        pub var LineNumber = Expr.Data{ .e_string = &Prefill.String.LineNumber };
        pub var ColumnNumber = Expr.Data{ .e_string = &Prefill.String.ColumnNumber };
        pub var This = Expr.Data{ .e_this = &Prefill.Value.EThis };
    };
    pub const Runtime = struct {
        pub var JSXFilename = "__jsxFilename";
        pub var JSXDevelopmentImportName = "jsxDEV";
        pub var JSXImportName = "jsx";
    };
};

var keyExprData = Expr.Data{ .e_string = &Prefill.String.Key };
var jsxChildrenKeyData = Expr.Data{ .e_string = &Prefill.String.Children };
var nullExprValueData = E.Null{};
var falseExprValueData = E.Boolean{ .value = false };
var nullValueExpr = Expr.Data{ .e_null = &nullExprValueData };
var falseValueExpr = Expr.Data{ .e_boolean = &falseExprValueData };

// P is for Parser!
// public only because of Binding.ToExpr
pub const P = struct {
    allocator: *std.mem.Allocator,
    options: Parser.Options,
    log: *logger.Log,
    define: *Define,
    source: *const logger.Source,
    lexer: js_lexer.Lexer,
    allow_in: bool = false,
    allow_private_identifiers: bool = false,
    has_top_level_return: bool = false,
    latest_return_had_semicolon: bool = false,
    has_import_meta: bool = false,
    has_es_module_syntax: bool = false,
    top_level_await_keyword: logger.Range = logger.Range.None,
    fn_or_arrow_data_parse: FnOrArrowDataParse = FnOrArrowDataParse{},
    fn_or_arrow_data_visit: FnOrArrowDataVisit = FnOrArrowDataVisit{},
    fn_only_data_visit: FnOnlyDataVisit = FnOnlyDataVisit{},
    allocated_names: List(string),
    latest_arrow_arg_loc: logger.Loc = logger.Loc.Empty,
    forbid_suffix_after_as_loc: logger.Loc = logger.Loc.Empty,
    current_scope: *js_ast.Scope = undefined,
    scopes_for_current_part: List(*js_ast.Scope),
    symbols: List(js_ast.Symbol),
    ts_use_counts: List(u32),
    exports_ref: js_ast.Ref = js_ast.Ref.None,
    require_ref: js_ast.Ref = js_ast.Ref.None,
    module_ref: js_ast.Ref = js_ast.Ref.None,
    import_meta_ref: js_ast.Ref = js_ast.Ref.None,
    promise_ref: ?js_ast.Ref = null,
    scopes_in_order_visitor_index: usize = 0,
    has_classic_runtime_warned: bool = false,
    data: js_ast.AstData,

    injected_define_symbols: List(Ref),
    symbol_uses: SymbolUseMap,
    declared_symbols: List(js_ast.DeclaredSymbol),
    runtime_imports: StringRefMap,
    // duplicate_case_checker: void,
    // non_bmp_identifiers: StringBoolMap,
    // legacy_octal_literals: void,
    // legacy_octal_literals:      map[js_ast.E]logger.Range,

    // For lowering private methods
    // weak_map_ref: ?js_ast.Ref,
    // weak_set_ref: ?js_ast.Ref,
    // private_getters: RefRefMap,
    // private_setters: RefRefMap,

    // These are for TypeScript
    should_fold_numeric_constants: bool = false,
    emitted_namespace_vars: RefBoolMap,
    is_exported_inside_namespace: RefRefMap,
    known_enum_values: Map(js_ast.Ref, std.StringHashMap(f64)),
    local_type_names: StringBoolMap,

    // This is the reference to the generated function argument for the namespace,
    // which is different than the reference to the namespace itself:
    //
    //   namespace ns {
    //   }
    //
    // The code above is transformed into something like this:
    //
    //   var ns1;
    //   (function(ns2) {
    //   })(ns1 or (ns1 = {}));
    //
    // This variable is "ns2" not "ns1". It is only used during the second
    // "visit" pass.
    enclosing_namespace_arg_ref: ?js_ast.Ref = null,

    jsx_filename_ref: js_ast.Ref = Ref.None,
    jsx_runtime_ref: js_ast.Ref = Ref.None,
    jsx_factory_ref: js_ast.Ref = Ref.None,
    jsx_fragment_ref: js_ast.Ref = Ref.None,

    jsx_source_list_ref: js_ast.Ref = Ref.None,

    // Imports (both ES6 and CommonJS) are tracked at the top level
    import_records: List(ImportRecord),
    import_records_for_current_part: List(u32),
    export_star_import_records: List(u32),

    // These are for handling ES6 imports and exports
    es6_import_keyword: logger.Range = logger.Range.None,
    es6_export_keyword: logger.Range = logger.Range.None,
    enclosing_class_keyword: logger.Range = logger.Range.None,
    import_items_for_namespace: Map(js_ast.Ref, std.StringHashMap(js_ast.LocRef)),
    is_import_item: RefBoolMap,
    named_imports: Map(js_ast.Ref, js_ast.NamedImport),
    named_exports: std.StringHashMap(js_ast.NamedExport),
    top_level_symbol_to_parts: Map(js_ast.Ref, List(u32)),
    import_namespace_cc_map: Map(ImportNamespaceCallOrConstruct, bool),

    // The parser does two passes and we need to pass the scope tree information
    // from the first pass to the second pass. That's done by tracking the calls
    // to pushScopeForParsePass() and popScope() during the first pass in
    // scopesInOrder.
    //
    // Then, when the second pass calls pushScopeForVisitPass() and popScope(),
    // we consume entries from scopesInOrder and make sure they are in the same
    // order. This way the second pass can efficiently use the same scope tree
    // as the first pass without having to attach the scope tree to the AST.
    //
    // We need to split this into two passes because the pass that declares the
    // symbols must be separate from the pass that binds identifiers to declared
    // symbols to handle declaring a hoisted "var" symbol in a nested scope and
    // binding a name to it in a parent or sibling scope.
    scopes_in_order: ScopeOrderList,

    // These properties are for the visit pass, which runs after the parse pass.
    // The visit pass binds identifiers to declared symbols, does constant
    // folding, substitutes compile-time variable definitions, and lowers certain
    // syntactic constructs as appropriate.
    stmt_expr_value: Expr.Data,
    call_target: Expr.Data,
    delete_target: Expr.Data,
    loop_body: Stmt.Data,
    module_scope: *js_ast.Scope = undefined,
    is_control_flow_dead: bool = false,

    // Inside a TypeScript namespace, an "export declare" statement can be used
    // to cause a namespace to be emitted even though it has no other observable
    // effect. This flag is used to implement this feature.
    //
    // Specifically, namespaces should be generated for all of the following
    // namespaces below except for "f", which should not be generated:
    //
    //   namespace a { export declare const a }
    //   namespace b { export declare let [[b]] }
    //   namespace c { export declare function c() }
    //   namespace d { export declare class d {} }
    //   namespace e { export declare enum e {} }
    //   namespace f { export declare namespace f {} }
    //
    // The TypeScript compiler compiles this into the following code (notice "f"
    // is missing):
    //
    //   var a; (function (a_1) {})(a or (a = {}));
    //   var b; (function (b_1) {})(b or (b = {}));
    //   var c; (function (c_1) {})(c or (c = {}));
    //   var d; (function (d_1) {})(d or (d = {}));
    //   var e; (function (e_1) {})(e or (e = {}));
    //
    // Note that this should not be implemented by declaring symbols for "export
    // declare" statements because the TypeScript compiler doesn't generate any
    // code for these statements, so these statements are actually references to
    // global variables. There is one exception, which is that local variables
    // *should* be declared as symbols because they are replaced with. This seems
    // like very arbitrary behavior but it's what the TypeScript compiler does,
    // so we try to match it.
    //
    // Specifically, in the following code below "a" and "b" should be declared
    // and should be substituted with "ns.a" and "ns.b" but the other symbols
    // shouldn't. References to the other symbols actually refer to global
    // variables instead of to symbols that are exported from the namespace.
    // This is the case as of TypeScript 4.3. I assume this is a TypeScript bug:
    //
    //   namespace ns {
    //     export declare const a
    //     export declare let [[b]]
    //     export declare function c()
    //     export declare class d { }
    //     export declare enum e { }
    //     console.log(a, b, c, d, e)
    //   }
    //
    // The TypeScript compiler compiles this into the following code:
    //
    //   var ns;
    //   (function (ns) {
    //       console.log(ns.a, ns.b, c, d, e);
    //   })(ns or (ns = {}));
    //
    // Relevant issue: https://github.com/evanw/esbuild/issues/1158
    has_non_local_export_declare_inside_namespace: bool = false,

    // This helps recognize the "await import()" pattern. When this is present,
    // warnings about non-string import paths will be omitted inside try blocks.
    await_target: ?js_ast.Expr.Data = null,

    to_expr_wrapper_namespace: Binding2ExprWrapper.Namespace,
    to_expr_wrapper_hoisted: Binding2ExprWrapper.Hoisted,

    // This helps recognize the "import().catch()" pattern. We also try to avoid
    // warning about this just like the "try { await import() }" pattern.
    then_catch_chain: ThenCatchChain,

    // Temporary variables used for lowering
    temp_refs_to_declare: List(TempRef),
    temp_ref_count: i32 = 0,

    // When bundling, hoisted top-level local variables declared with "var" in
    // nested scopes are moved up to be declared in the top-level scope instead.
    // The old "var" statements are turned into regular assignments instead. This
    // makes it easier to quickly scan the top-level statements for "var" locals
    // with the guarantee that all will be found.
    relocated_top_level_vars: List(js_ast.LocRef),

    // ArrowFunction is a special case in the grammar. Although it appears to be
    // a PrimaryExpression, it's actually an AssignmentExpression. This means if
    // a AssignmentExpression ends up producing an ArrowFunction then nothing can
    // come after it other than the comma operator, since the comma operator is
    // the only thing above AssignmentExpression under the Expression rule:
    //
    //   AssignmentExpression:
    //     ArrowFunction
    //     ConditionalExpression
    //     LeftHandSideExpression = AssignmentExpression
    //     LeftHandSideExpression AssignmentOperator AssignmentExpression
    //
    //   Expression:
    //     AssignmentExpression
    //     Expression , AssignmentExpression
    //
    after_arrow_body_loc: logger.Loc = logger.Loc.Empty,
    import_transposer: ImportTransposer,
    require_transposer: RequireTransposer,
    require_resolve_transposer: RequireResolveTransposer,

    // This is a general place to put lots of Expr objects
    expr_list: List(Expr),

    scope_order_to_visit: []ScopeOrder = &([_]ScopeOrder{}),

    const TransposeState = struct {
        is_await_target: bool = false,
        is_then_catch_target: bool = false,
        loc: logger.Loc,
    };

    pub fn transposeImport(p: *P, arg: Expr, state: anytype) Expr {
        // The argument must be a string
        if (@as(Expr.Tag, arg.data) == .e_string) {
            // Ignore calls to import() if the control flow is provably dead here.
            // We don't want to spend time scanning the required files if they will
            // never be used.
            if (p.is_control_flow_dead) {
                return p.e(E.Null{}, arg.loc);
            }
            const str = arg.data.e_string;

            const import_record_index = p.addImportRecord(.dynamic, arg.loc, str.string(p.allocator) catch unreachable);
            p.import_records.items[import_record_index].handles_import_errors = (state.is_await_target and p.fn_or_arrow_data_visit.try_body_count != 0) or state.is_then_catch_target;
            p.import_records_for_current_part.append(import_record_index) catch unreachable;
            return p.e(E.Import{
                .expr = arg,
                .import_record_index = Ref.toInt(import_record_index),
                // .leading_interior_comments = arg.data.e_string.
            }, state.loc);
        }

        // Use a debug log so people can see this if they want to
        const r = js_lexer.rangeOfIdentifier(p.source, state.loc);
        p.log.addRangeDebug(p.source, r, "This \"import\" expression will not be bundled because the argument is not a string literal") catch unreachable;

        return p.e(E.Import{
            .expr = arg,
            .import_record_index = Ref.None.source_index,
        }, state.loc);
    }

    pub fn transposeRequireResolve(p: *P, arg: Expr, transpose_state: anytype) Expr {
        return arg;
    }

    pub fn transposeRequire(p: *P, arg: Expr, transpose_state: anytype) Expr {
        switch (arg.data) {
            .e_string => |str| {
                // Ignore calls to require() if the control flow is provably dead here.
                // We don't want to spend time scanning the required files if they will
                // never be used.
                if (p.is_control_flow_dead) {
                    return Expr{ .data = nullExprData, .loc = arg.loc };
                }

                const import_record_index = p.addImportRecord(.require, arg.loc, str.string(p.allocator) catch unreachable);
                p.import_records.items[import_record_index].handles_import_errors = p.fn_or_arrow_data_visit.try_body_count != 0;
                p.import_records_for_current_part.append(import_record_index) catch unreachable;

                p.ignoreUsage(p.require_ref);
                return p.e(E.Require{ .import_record_index = Ref.toInt(import_record_index) }, arg.loc);
            },
            else => {},
        }

        return arg;
    }

    const ImportTransposer = ExpressionTransposer(P, P.transposeImport);
    const RequireTransposer = ExpressionTransposer(P, P.transposeRequire);
    const RequireResolveTransposer = ExpressionTransposer(P, P.transposeRequireResolve);

    const Binding2ExprWrapper = struct {
        pub const Namespace = Binding.ToExpr(P, P.wrapIdentifierNamespace);
        pub const Hoisted = Binding.ToExpr(P, P.wrapIdentifierHoisting);
    };

    pub fn s(p: *P, t: anytype, loc: logger.Loc) Stmt {
        // Output.print("\nStmt: {s} - {d}\n", .{ @typeName(@TypeOf(t)), loc.start });
        if (@typeInfo(@TypeOf(t)) == .Pointer) {
            return Stmt.init(t, loc);
        } else {
            return Stmt.alloc(p.allocator, t, loc);
        }
    }

    pub fn e(p: *P, t: anytype, loc: logger.Loc) Expr {
        // Output.print("\nExpr: {s} - {d}\n", .{ @typeName(@TypeOf(t)), loc.start });
        if (@typeInfo(@TypeOf(t)) == .Pointer) {
            return Expr.init(t, loc);
        } else {
            return Expr.alloc(p.allocator, t, loc);
        }
    }

    pub fn b(p: *P, t: anytype, loc: logger.Loc) Binding {
        if (@typeInfo(@TypeOf(t)) == .Pointer) {
            return Binding.init(t, loc);
        } else {
            return Binding.alloc(p.allocator, t, loc);
        }
    }

    pub fn deinit(parser: *P) void {
        parser.allocated_names.deinit();
        parser.scopes_for_current_part.deinit();
        parser.symbols.deinit();
        parser.ts_use_counts.deinit();
        parser.declared_symbols.deinit();
        parser.known_enum_values.deinit();
        parser.import_records.deinit();
        parser.import_records_for_current_part.deinit();
        parser.export_star_import_records.deinit();
        parser.import_items_for_namespace.deinit();
        parser.named_imports.deinit();
        parser.top_level_symbol_to_parts.deinit();
        parser.import_namespace_cc_map.deinit();
        parser.scopes_in_order.deinit();
        parser.temp_refs_to_declare.deinit();
        parser.relocated_top_level_vars.deinit();
    }

    pub fn findSymbol(p: *P, loc: logger.Loc, name: string) !FindSymbolResult {
        var ref: Ref = undefined;
        var declare_loc: logger.Loc = undefined;
        var is_inside_with_scope = false;
        var did_forbid_argumen = false;
        var _scope: ?*Scope = p.current_scope;
        var did_match = false;

        while (_scope) |scope| : (_scope = _scope.?.parent) {

            // Track if we're inside a "with" statement body
            if (scope.kind == .with) {
                is_inside_with_scope = true;
            }

            // Forbid referencing "arguments" inside class bodies
            if (scope.forbid_arguments and strings.eql(name, "arguments") and !did_forbid_argumen) {
                const r = js_lexer.rangeOfIdentifier(p.source, loc);
                p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot access \"{s}\" here", .{name}) catch unreachable;
                did_forbid_argumen = true;
            }

            // Is the symbol a member of this scope?
            if (scope.members.get(name)) |member| {
                ref = member.ref;
                declare_loc = member.loc;
                did_match = true;
                break;
            }
        }

        if (!did_match) {
            // Allocate an "unbound" symbol
            p.checkForNonBMPCodePoint(loc, name);
            ref = p.newSymbol(.unbound, name) catch unreachable;
            declare_loc = loc;
            p.module_scope.members.put(name, js_ast.Scope.Member{ .ref = ref, .loc = logger.Loc.Empty }) catch unreachable;
        }

        // If we had to pass through a "with" statement body to get to the symbol
        // declaration, then this reference could potentially also refer to a
        // property on the target object of the "with" statement. We must not rename
        // it or we risk changing the behavior of the code.
        if (is_inside_with_scope) {
            p.symbols.items[ref.inner_index].must_not_be_renamed = true;
        }

        // Track how many times we've referenced this symbol
        p.recordUsage(ref);
        return FindSymbolResult{
            .ref = ref,
            .declare_loc = declare_loc,
            .is_inside_with_scope = is_inside_with_scope,
        };
    }

    pub fn recordExportedBinding(p: *P, binding: Binding) void {
        switch (binding.data) {
            .b_missing => {},
            .b_identifier => |ident| {
                p.recordExport(binding.loc, p.symbols.items[ident.ref.inner_index].original_name, ident.ref) catch unreachable;
            },
            .b_array => |array| {
                for (array.items) |prop| {
                    p.recordExportedBinding(prop.binding);
                }
            },
            .b_object => |obj| {
                for (obj.properties) |prop| {
                    p.recordExportedBinding(prop.value);
                }
            },
            else => {
                p.panic("Unexpected binding export type {s}", .{binding});
            },
        }
    }

    pub fn recordExport(p: *P, loc: logger.Loc, alias: string, ref: Ref) !void {
        if (p.named_exports.get(alias)) |name| {
            // Duplicate exports are an error
            var notes = try p.allocator.alloc(logger.Data, 1);
            notes[0] = logger.Data{
                .text = try std.fmt.allocPrint(p.allocator, "\"{s}\" was originally exported here", .{alias}),
                .location = logger.Location.init_or_nil(p.source, js_lexer.rangeOfIdentifier(p.source, name.alias_loc)),
            };
            try p.log.addRangeErrorFmtWithNotes(
                p.source,
                js_lexer.rangeOfIdentifier(p.source, loc),
                p.allocator,
                notes,
                "Multiple exports with the same name {s}",
                .{alias},
            );
        } else {
            try p.named_exports.put(alias, js_ast.NamedExport{ .alias_loc = loc, .ref = ref });
        }
    }

    pub fn recordUsage(p: *P, ref: js_ast.Ref) void {
        // The use count stored in the symbol is used for generating symbol names
        // during minification. These counts shouldn't include references inside dead
        // code regions since those will be culled.
        if (!p.is_control_flow_dead) {
            p.symbols.items[ref.inner_index].use_count_estimate += 1;
            var result = p.symbol_uses.getOrPut(ref) catch unreachable;
            if (!result.found_existing) {
                result.entry.value = Symbol.Use{ .count_estimate = 1 };
            } else {
                result.entry.value.count_estimate += 1;
            }
        }

        // The correctness of TypeScript-to-JavaScript conversion relies on accurate
        // symbol use counts for the whole file, including dead code regions. This is
        // tracked separately in a parser-only data structure.
        if (p.options.ts) {
            p.ts_use_counts.items[ref.inner_index] += 1;
        }
    }

    pub fn findSymbolHelper(self: *P, loc: logger.Loc, name: string) ?js_ast.Ref {
        if (self.findSymbol(loc, name)) |sym| {
            return sym.ref;
        }

        return null;
    }

    pub fn symbolForDefineHelper(self: *P, i: usize) ?js_ast.Ref {
        if (self.injected_define_symbols.items.len > i) {
            return self.injected_define_symbols.items[i];
        }

        return null;
    }

    pub fn logArrowArgErrors(p: *P, errors: *DeferredArrowArgErrors) void {
        if (errors.invalid_expr_await.len > 0) {
            var r = errors.invalid_expr_await;
            p.log.addRangeError(p.source, r, "Cannot use an \"await\" expression here") catch unreachable;
        }

        if (errors.invalid_expr_yield.len > 0) {
            var r = errors.invalid_expr_yield;
            p.log.addRangeError(p.source, r, "Cannot use a \"yield\" expression here") catch unreachable;
        }
    }

    pub fn keyNameForError(p: *P, key: js_ast.Expr) string {
        switch (key.data) {
            .e_string => {
                return p.lexer.raw();
            },
            .e_private_identifier => {
                return p.lexer.raw();
                // return p.loadNameFromRef()
            },
            else => {
                return "property";
            },
        }
    }

    pub fn canMergeSymbols(p: *P, scope: *js_ast.Scope, existing: Symbol.Kind, new: Symbol.Kind) SymbolMergeResult {
        if (existing == .unbound) {
            return .replace_with_new;
        }

        // In TypeScript, imports are allowed to silently collide with symbols within
        // the module. Presumably this is because the imports may be type-only:
        //
        //   import {Foo} from 'bar'
        //   class Foo {}
        //
        if (p.options.ts and existing == .import) {
            return .replace_with_new;
        }

        // "enum Foo {} enum Foo {}"
        // "namespace Foo { ... } enum Foo {}"
        if (new == .ts_enum and (existing == .ts_enum or existing == .ts_namespace)) {
            return .replace_with_new;
        }

        // "namespace Foo { ... } namespace Foo { ... }"
        // "function Foo() {} namespace Foo { ... }"
        // "enum Foo {} namespace Foo { ... }"
        if (new == .ts_namespace) {
            switch (existing) {
                .ts_namespace, .hoisted_function, .generator_or_async_function, .ts_enum, .class => {
                    return .keep_existing;
                },
                else => {},
            }
        }

        // "var foo; var foo;"
        // "var foo; function foo() {}"
        // "function foo() {} var foo;"
        // "function *foo() {} function *foo() {}" but not "{ function *foo() {} function *foo() {} }"
        if (Symbol.isKindHoistedOrFunction(new) and Symbol.isKindHoistedOrFunction(existing) and (scope.kind == .entry or scope.kind == .function_body or
            (Symbol.isKindHoisted(new) and Symbol.isKindHoisted(existing))))
        {
            return .keep_existing;
        }

        // "get #foo() {} set #foo() {}"
        // "set #foo() {} get #foo() {}"
        if ((existing == .private_get and new == .private_set) or
            (existing == .private_set and new == .private_get))
        {
            return .become_private_get_set_pair;
        }
        if ((existing == .private_static_get and new == .private_static_set) or
            (existing == .private_static_set and new == .private_static_get))
        {
            return .become_private_static_get_set_pair;
        }

        // "try {} catch (e) { var e }"
        if (existing == .catch_identifier and new == .hoisted) {
            return .replace_with_new;
        }

        // "function() { var arguments }"
        if (existing == .arguments and new == .hoisted) {
            return .keep_existing;
        }

        // "function() { let arguments }"
        if (existing == .arguments and new != .hoisted) {
            return .overwrite_with_new;
        }

        return .forbidden;
    }

    pub fn handleIdentifier(p: *P, loc: logger.Loc, ident: *E.Identifier, _original_name: ?string, opts: IdentifierOpts) Expr {
        const ref = ident.ref;

        if ((opts.assign_target != .none or opts.is_delete_target) and p.symbols.items[ref.inner_index].kind == .import) {
            // Create an error for assigning to an import namespace
            const r = js_lexer.rangeOfIdentifier(p.source, loc);
            p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot assign to import \"{s}\"", .{
                p.symbols.items[ref.inner_index].original_name,
            }) catch unreachable;
        }

        // Substitute an EImportIdentifier now if this is an import item
        if (p.is_import_item.contains(ref)) {
            return p.e(
                E.ImportIdentifier{ .ref = ref, .was_originally_identifier = opts.was_originally_identifier },
                loc,
            );
        }

        // Substitute a namespace export reference now if appropriate
        if (p.options.ts) {
            if (p.is_exported_inside_namespace.get(ref)) |ns_ref| {
                const name = p.symbols.items[ref.inner_index].original_name;

                // If this is a known enum value, inline the value of the enum
                if (p.known_enum_values.get(ns_ref)) |enum_values| {
                    if (enum_values.get(name)) |number| {
                        return p.e(E.Number{ .value = number }, loc);
                    }
                }

                // Otherwise, create a property access on the namespace
                p.recordUsage(ns_ref);

                return p.e(E.Dot{ .target = p.e(E.Identifier{ .ref = ns_ref }, loc), .name = name, .name_loc = loc }, loc);
            }
        }

        if (_original_name) |original_name| {
            const result = p.findSymbol(loc, original_name) catch unreachable;
            ident.ref = result.ref;
        }

        return p.e(ident, loc);
    }

    pub fn generateImportStmt(p: *P, import_path: string, imports: []string, parts: *List(js_ast.Part), symbols: StringRefMap, additional_stmt: ?Stmt) !void {
        const import_record_i = p.addImportRecordByRange(.stmt, logger.Range.None, import_path);
        var import_record = p.import_records.items[import_record_i];
        var import_path_identifier = try import_record.path.name.nonUniqueNameString(p.allocator);
        var namespace_identifier = try p.allocator.alloc(u8, import_path_identifier.len + "import_".len);
        var clause_items = try p.allocator.alloc(js_ast.ClauseItem, imports.len);
        var stmts = try p.allocator.alloc(Stmt, 1 + if (additional_stmt != null) @as(usize, 1) else @as(usize, 0));
        var declared_symbols = try p.allocator.alloc(js_ast.DeclaredSymbol, imports.len);
        std.mem.copy(u8, namespace_identifier[0.."import_".len], "import_");
        std.mem.copy(
            u8,
            namespace_identifier["import_".len..namespace_identifier.len],
            import_path_identifier[0..import_path_identifier.len],
        );

        const namespace_ref = try p.newSymbol(.other, namespace_identifier);
        try p.module_scope.generated.append(namespace_ref);

        for (imports) |alias, i| {
            const ref = symbols.get(alias) orelse unreachable;
            clause_items[i] = js_ast.ClauseItem{ .alias = imports[i], .original_name = imports[i], .alias_loc = logger.Loc{}, .name = LocRef{ .ref = ref, .loc = logger.Loc{} } };
            declared_symbols[i] = js_ast.DeclaredSymbol{ .ref = ref, .is_top_level = true };
            try p.is_import_item.put(ref, true);
            try p.named_imports.put(ref, js_ast.NamedImport{
                .alias = alias,
                .alias_loc = logger.Loc{},
                .namespace_ref = namespace_ref,
                .import_record_index = import_record_i,
            });
        }

        stmts[0] = p.s(S.Import{
            .namespace_ref = namespace_ref,
            .items = clause_items,
            .import_record_index = import_record_i,
        }, logger.Loc{});
        if (additional_stmt) |add| {
            stmts[1] = add;
        }

        var import_records = try p.allocator.alloc(@TypeOf(import_record_i), 1);
        import_records[0] = import_record_i;

        // Append a single import to the end of the file (ES6 imports are hoisted
        // so we don't need to worry about where the import statement goes)
        parts.append(js_ast.Part{
            .stmts = stmts,
            .declared_symbols = declared_symbols,
            .import_record_indices = import_records,
            .symbol_uses = SymbolUseMap.init(p.allocator),
        }) catch unreachable;
    }

    pub fn prepareForVisitPass(p: *P) !void {
        {
            var count: usize = 0;
            for (p.scopes_in_order.items) |item| {
                if (item != null) {
                    count += 1;
                }
            }
            var i: usize = 0;
            p.scope_order_to_visit = try p.allocator.alloc(ScopeOrder, p.scopes_in_order.items.len);
            for (p.scopes_in_order.items) |item| {
                if (item) |_item| {
                    p.scope_order_to_visit[i] = _item;
                    i += 1;
                }
            }
        }

        try p.pushScopeForVisitPass(js_ast.Scope.Kind.entry, locModuleScope);
        p.fn_or_arrow_data_visit.is_outside_fn_or_arrow = true;
        p.module_scope = p.current_scope;
        p.has_es_module_syntax = p.es6_import_keyword.len > 0 or p.es6_export_keyword.len > 0 or p.top_level_await_keyword.len > 0;
        if (p.options.jsx.parse) {
            if (p.options.jsx.development) {
                p.jsx_filename_ref = p.newSymbol(.other, Prefill.Runtime.JSXFilename) catch unreachable;
            }
            const jsx_importname = p.options.jsx.jsx;
            p.jsx_fragment_ref = p.newSymbol(.other, p.options.jsx.fragment[p.options.jsx.fragment.len - 1]) catch unreachable;
            p.jsx_runtime_ref = p.newSymbol(.other, jsx_importname) catch unreachable;
            p.jsx_factory_ref = p.newSymbol(.other, p.options.jsx.factory[p.options.jsx.factory.len - 1]) catch unreachable;
        }

        // ECMAScript modules are always interpreted as strict mode. This has to be
        // done before "hoistSymbols" because strict mode can alter hoisting (!).
        if (p.es6_import_keyword.len > 0) {
            p.module_scope.recursiveSetStrictMode(js_ast.StrictModeKind.implicit_strict_mode_import);
        } else if (p.es6_export_keyword.len > 0) {
            p.module_scope.recursiveSetStrictMode(js_ast.StrictModeKind.implicit_strict_mode_export);
        } else if (p.top_level_await_keyword.len > 0) {
            p.module_scope.recursiveSetStrictMode(js_ast.StrictModeKind.implicit_strict_mode_top_level_await);
        }

        p.hoistSymbols(p.module_scope);

        p.require_ref = try p.declareCommonJSSymbol(.unbound, "require");
        p.exports_ref = try p.declareCommonJSSymbol(.hoisted, "exports");
        p.module_ref = try p.declareCommonJSSymbol(.hoisted, "module");
    }

    pub fn hoistSymbols(p: *P, scope: *js_ast.Scope) void {
        if (!scope.kindStopsHoisting()) {
            var iter = scope.members.iterator();
            nextMember: while (iter.next()) |res| {
                var symbol = p.symbols.items[res.value.ref.inner_index];
                if (!symbol.isHoisted()) {
                    continue :nextMember;
                }

                // Check for collisions that would prevent to hoisting "var" symbols up to the enclosing function scope
                var __scope = scope.parent;

                while (__scope) |_scope| {
                    // Variable declarations hoisted past a "with" statement may actually end
                    // up overwriting a property on the target of the "with" statement instead
                    // of initializing the variable. We must not rename them or we risk
                    // causing a behavior change.
                    //
                    //   var obj = { foo: 1 }
                    //   with (obj) { var foo = 2 }
                    //   assert(foo === undefined)
                    //   assert(obj.foo === 2)
                    //
                    if (_scope.kind == .with) {
                        symbol.must_not_be_renamed = true;
                    }

                    if (_scope.members.getEntry(symbol.original_name)) |existing_member_entry| {
                        const existing_member = existing_member_entry.value;
                        const existing_symbol: Symbol = p.symbols.items[existing_member.ref.inner_index];

                        // We can hoist the symbol from the child scope into the symbol in
                        // this scope if:
                        //
                        //   - The symbol is unbound (i.e. a global variable access)
                        //   - The symbol is also another hoisted variable
                        //   - The symbol is a function of any kind and we're in a function or module scope
                        //
                        // Is this unbound (i.e. a global access) or also hoisted?
                        if (existing_symbol.kind == .unbound or existing_symbol.kind == .hoisted or
                            (Symbol.isKindFunction(existing_symbol.kind) and (_scope.kind == .entry or _scope.kind == .function_body)))
                        {
                            // Silently merge this symbol into the existing symbol
                            symbol.link = existing_member.ref;
                            _scope.members.put(symbol.original_name, existing_member) catch unreachable;
                            continue :nextMember;
                        }
                    }

                    if (_scope.kindStopsHoisting()) {
                        _scope.members.put(symbol.original_name, res.value) catch unreachable;
                        break;
                    }
                    __scope = _scope.parent;
                }
            }
        }

        for (scope.children.items) |_item, i| {
            p.hoistSymbols(scope.children.items[i]);
        }
    }

    pub fn nextScopeInOrderForVisitPass(p: *P) ScopeOrder {
        const head = p.scope_order_to_visit[0];
        p.scope_order_to_visit = p.scope_order_to_visit[1..p.scope_order_to_visit.len];
        return head;
    }

    pub fn pushScopeForVisitPass(p: *P, kind: js_ast.Scope.Kind, loc: logger.Loc) !void {
        // Output.print("\n+Loc: {d}\n", .{loc.start});
        // for (p.scopes_in_order.items[p.scopes_in_order_visitor_index..p.scopes_in_order.items.len]) |scope_order, i| {
        //     if (scope_order) |ord| {
        //         Output.print("Scope ({d}, {d})\n", .{ @enumToInt(ord.scope.kind), ord.loc.start });
        //     }
        // }
        const order = p.nextScopeInOrderForVisitPass();

        // Sanity-check that the scopes generated by the first and second passes match
        if (order.loc.start != loc.start or order.scope.kind != kind) {
            p.panic("Expected scope ({s}, {d}) in {s}, found scope ({s}, {d})", .{ kind, loc.start, p.source.path.pretty, order.scope.kind, order.loc.start });
        }

        p.current_scope = order.scope;

        try p.scopes_for_current_part.append(order.scope);
    }

    pub fn pushScopeForParsePass(p: *P, kind: js_ast.Scope.Kind, loc: logger.Loc) !usize {
        debugl("<pushScopeForParsePass>");
        defer debugl("</pushScopeForParsePass>");
        var parent: *Scope = p.current_scope;

        var scope = try p.allocator.create(Scope);
        scope.* = Scope{
            .members = @TypeOf(scope.members).init(p.allocator),
            .children = @TypeOf(scope.children).init(
                p.allocator,
            ),
            .generated = @TypeOf(scope.generated).init(p.allocator),
            .kind = kind,
            .label_ref = null,
            .parent = parent,
        };

        try parent.children.append(scope);
        scope.strict_mode = parent.strict_mode;

        p.current_scope = scope;

        // Enforce that scope locations are strictly increasing to help catch bugs
        // where the pushed scopes are mistmatched between the first and second passes
        if (std.builtin.mode != std.builtin.Mode.ReleaseFast and p.scopes_in_order.items.len > 0) {
            var last_i = p.scopes_in_order.items.len - 1;
            while (p.scopes_in_order.items[last_i] == null and last_i > 0) {
                last_i -= 1;
            }

            if (p.scopes_in_order.items[last_i]) |prev_scope| {
                if (prev_scope.loc.start >= loc.start) {
                    p.panic("Scope location {d} must be greater than {d}", .{ loc.start, prev_scope.loc.start });
                }
            }
        }

        // Copy down function arguments into the function body scope. That way we get
        // errors if a statement in the function body tries to re-declare any of the
        // arguments.
        if (kind == js_ast.Scope.Kind.function_body) {
            assert(parent.kind == js_ast.Scope.Kind.function_args);

            var iter = scope.parent.?.members.iterator();
            while (iter.next()) |entry| {
                // 	// Don't copy down the optional function expression name. Re-declaring
                // 	// the name of a function expression is allowed.
                const adjacent_symbols = p.symbols.items[entry.value.ref.inner_index];
                if (adjacent_symbols.kind != .hoisted_function) {
                    try scope.members.put(entry.key, entry.value);
                }
            }
        }

        // Remember the length in case we call popAndDiscardScope() later
        const scope_index = p.scopes_in_order.items.len;
        try p.scopes_in_order.append(p.allocator, ScopeOrder{ .loc = loc, .scope = scope });
        // Output.print("\nLoc: {d}\n", .{loc.start});
        return scope_index;
    }

    // Note: do not write to "p.log" in this function. Any errors due to conversion
    // from expression to binding should be written to "invalidLog" instead. That
    // way we can potentially keep this as an expression if it turns out it's not
    // needed as a binding after all.
    pub fn convertExprToBinding(p: *P, expr: ExprNodeIndex, invalid_loc: *LocList) ?Binding {
        switch (expr.data) {
            .e_missing => {
                return null;
            },
            .e_identifier => |ex| {
                return p.b(B.Identifier{ .ref = ex.ref }, expr.loc);
            },
            .e_array => |ex| {
                if (ex.comma_after_spread) |spread| {
                    invalid_loc.append(spread) catch unreachable;
                }

                if (ex.is_parenthesized) {
                    invalid_loc.append(p.source.rangeOfOperatorBefore(expr.loc, "(").loc) catch unreachable;
                }

                // p.markSyntaxFeature(Destructing)
                var items = List(js_ast.ArrayBinding).init(p.allocator);
                var is_spread = true;
                for (ex.items) |_, i| {
                    var item = ex.items[i];
                    var _expr = expr;
                    if (@as(Expr.Tag, item.data) == .e_spread) {
                        is_spread = true;
                        item = item.data.e_spread.value;
                    }
                    const res = p.convertExprToBindingAndInitializer(&_expr, invalid_loc, is_spread);
                    items.append(js_ast.ArrayBinding{ .binding = res.binding orelse unreachable, .default_value = res.override_expr }) catch unreachable;
                }

                return p.b(B.Array{
                    .items = items.toOwnedSlice(),
                    .has_spread = ex.comma_after_spread != null,
                    .is_single_line = ex.is_single_line,
                }, expr.loc);
            },
            .e_object => |ex| {
                if (ex.comma_after_spread) |sp| {
                    invalid_loc.append(sp) catch unreachable;
                }

                if (ex.is_parenthesized) {
                    invalid_loc.append(p.source.rangeOfOperatorBefore(expr.loc, "(").loc) catch unreachable;
                }
                // p.markSyntaxFeature(compat.Destructuring, p.source.RangeOfOperatorAfter(expr.Loc, "{"))

                var properties = List(B.Property).init(p.allocator);
                for (ex.properties) |item| {
                    if (item.flags.is_method or item.kind == .get or item.kind == .set) {
                        invalid_loc.append(item.key.?.loc) catch unreachable;
                        continue;
                    }
                    var value = &(item.value orelse unreachable);
                    const tup = p.convertExprToBindingAndInitializer(value, invalid_loc, false);
                    const initializer = tup.expr orelse item.initializer;

                    properties.append(B.Property{
                        .flags = Flags.Property{
                            .is_spread = item.kind == .spread or item.flags.is_spread,
                            .is_computed = item.flags.is_computed,
                        },

                        .key = item.key orelse p.panic("Internal error: Expected {s} to have a key.", .{item}),
                        .value = tup.binding orelse p.panic("Internal error: Expected {s} to have a binding.", .{tup}),
                        .default_value = initializer,
                    }) catch unreachable;
                }

                return p.b(B.Object{
                    .properties = properties.toOwnedSlice(),
                    .is_single_line = ex.is_single_line,
                }, expr.loc);
            },
            else => {
                invalid_loc.append(expr.loc) catch unreachable;
                return null;
            },
        }

        return null;
    }

    pub fn convertExprToBindingAndInitializer(p: *P, expr: *ExprNodeIndex, invalid_log: *LocList, is_spread: bool) ExprBindingTuple {
        var initializer: ?ExprNodeIndex = null;
        var override: ?ExprNodeIndex = null;
        // zig syntax is sometimes painful
        switch (expr.*.data) {
            .e_binary => |bin| {
                if (bin.op == .bin_assign) {
                    initializer = bin.right;
                    override = bin.left;
                }
            },
            else => {},
        }

        var bind = p.convertExprToBinding(expr.*, invalid_log);
        if (initializer) |initial| {
            const equalsRange = p.source.rangeOfOperatorBefore(initial.loc, "=");
            if (is_spread) {
                p.log.addRangeError(p.source, equalsRange, "A rest argument cannot have a default initializer") catch unreachable;
            } else {
                // p.markSyntaxFeature();
            }
        }
        return ExprBindingTuple{ .binding = bind, .expr = initializer };
    }

    pub fn forbidLexicalDecl(p: *P, loc: logger.Loc) !void {
        try p.log.addRangeError(p.source, p.lexer.range(), "Cannot use a declaration in a single-statement context");
    }

    pub fn logExprErrors(p: *P, errors: *DeferredErrors) void {
        if (errors.invalid_expr_default_value) |r| {
            p.log.addRangeError(
                p.source,
                r,
                "Unexpected \"=\"",
            ) catch unreachable;
        }

        if (errors.invalid_expr_after_question) |r| {
            p.log.addRangeErrorFmt(p.source, r, p.allocator, "Unexpected {s}", .{p.source.contents[r.loc.i()..r.endI()]}) catch unreachable;
        }

        // if (errors.array_spread_feature) |err| {
        //     p.markSyntaxFeature(compat.ArraySpread, errors.arraySpreadFeature)
        // }
    }

    // This assumes the "function" token has already been parsed

    pub fn parseFnStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions, asyncRange: ?logger.Range) !Stmt {
        const is_generator = p.lexer.token == T.t_asterisk;
        const is_async = asyncRange != null;

        if (is_generator) {
            // p.markSyntaxFeature(compat.Generator, p.lexer.Range())
            try p.lexer.next();
        } else if (is_async) {
            // p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
        }

        switch (opts.lexical_decl) {
            .forbid => {
                try p.forbidLexicalDecl(loc);
            },

            // Allow certain function statements in certain single-statement contexts
            .allow_fn_inside_if, .allow_fn_inside_label => {
                if (opts.is_typescript_declare or is_generator or is_async) {
                    try p.forbidLexicalDecl(loc);
                }
            },
            else => {},
        }

        var name: ?js_ast.LocRef = null;
        var nameText: string = "";

        // The name is optional for "export default function() {}" pseudo-statements
        if (!opts.is_name_optional or p.lexer.token == T.t_identifier) {
            var nameLoc = p.lexer.loc();
            nameText = p.lexer.identifier;
            try p.lexer.expect(T.t_identifier);
            // Difference
            const ref = try p.newSymbol(Symbol.Kind.other, nameText);
            name = js_ast.LocRef{
                .loc = nameLoc,
                .ref = ref,
            };
        }

        // Even anonymous functions can have TypeScript type parameters
        if (p.options.ts) {
            p.skipTypescriptTypeParameters();
        }

        // Introduce a fake block scope for function declarations inside if statements
        var ifStmtScopeIndex: usize = 0;
        var hasIfScope = opts.lexical_decl == .allow_fn_inside_if;
        if (hasIfScope) {
            ifStmtScopeIndex = try p.pushScopeForParsePass(js_ast.Scope.Kind.block, loc);
        }

        var scopeIndex = try p.pushScopeForParsePass(js_ast.Scope.Kind.function_args, p.lexer.loc());
        var func = try p.parseFn(name, FnOrArrowDataParse{
            .async_range = asyncRange,
            .allow_await = if (is_async) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
            .allow_yield = if (is_generator) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
            .is_typescript_declare = opts.is_typescript_declare,

            // Only allow omitting the body if we're parsing TypeScript
            .allow_missing_body_for_type_script = p.options.ts,
        });

        // Don't output anything if it's just a forward declaration of a function
        if (opts.is_typescript_declare or func.body == null) {
            p.popAndDiscardScope(scopeIndex);

            // Balance the fake block scope introduced above
            if (hasIfScope) {
                p.popScope();
            }

            if (opts.is_typescript_declare and opts.is_namespace_scope and opts.is_export) {
                p.has_non_local_export_declare_inside_namespace = true;
            }

            return p.s(S.TypeScript{}, loc);
        }

        p.popScope();

        // Only declare the function after we know if it had a body or not. Otherwise
        // TypeScript code such as this will double-declare the symbol:
        //
        //     function foo(): void;
        //     function foo(): void {}
        //
        if (name) |*name_| {
            const kind = if (is_generator or is_async) Symbol.Kind.generator_or_async_function else Symbol.Kind.hoisted_function;
            name_.ref = try p.declareSymbol(kind, name_.loc, nameText);
            func.name = name_.*;
        }

        func.flags.has_if_scope = hasIfScope;
        func.flags.is_export = opts.is_export;

        // Balance the fake block scope introduced above
        if (hasIfScope) {
            p.popScope();
        }

        return p.s(S.Function{
            .func = func,
        }, func.open_parens_loc);
    }

    pub fn popAndDiscardScope(p: *P, scope_index: usize) void {
        // Move up to the parent scope
        var to_discard = p.current_scope;
        var parent = to_discard.parent orelse unreachable;

        p.current_scope = parent;

        // Truncate the scope order where we started to pretend we never saw this scope
        p.scopes_in_order.shrinkRetainingCapacity(scope_index);

        var children = parent.children;
        // Remove the last child from the parent scope
        var last = children.items.len - 1;
        if (children.items[last] != to_discard) {
            p.panic("Internal error", .{});
        }

        _ = children.popOrNull();
    }

    pub fn parseFn(p: *P, name: ?js_ast.LocRef, opts: FnOrArrowDataParse) anyerror!G.Fn {
        // if data.allowAwait and data.allowYield {
        // 	p.markSyntaxFeature(compat.AsyncGenerator, data.asyncRange)
        // }

        var func = G.Fn{
            .name = name,
            .flags = Flags.Function{
                .has_rest_arg = false,
                .is_async = opts.allow_await == .allow_expr,
                .is_generator = opts.allow_yield == .allow_expr,
            },

            .arguments_ref = null,
            .open_parens_loc = p.lexer.loc(),
        };
        try p.lexer.expect(T.t_open_paren);

        // Await and yield are not allowed in function arguments
        var old_fn_or_arrow_data = opts;
        p.fn_or_arrow_data_parse.allow_await = if (opts.allow_await == .allow_expr) AwaitOrYield.forbid_all else AwaitOrYield.allow_ident;
        p.fn_or_arrow_data_parse.allow_yield = if (opts.allow_yield == .allow_expr) AwaitOrYield.forbid_all else AwaitOrYield.allow_ident;

        // If "super()" is allowed in the body, it's allowed in the arguments
        p.fn_or_arrow_data_parse.allow_super_call = opts.allow_super_call;
        var args = List(G.Arg).init(p.allocator);
        while (p.lexer.token != T.t_close_paren) {
            // Skip over "this" type annotations
            if (p.options.ts and p.lexer.token == T.t_this) {
                try p.lexer.next();
                if (p.lexer.token == T.t_colon) {
                    try p.lexer.next();
                    p.skipTypescriptType(js_ast.Op.Level.lowest);
                }
                if (p.lexer.token != T.t_comma) {
                    break;
                }

                try p.lexer.next();
                continue;
            }

            var ts_decorators: []ExprNodeIndex = &([_]ExprNodeIndex{});
            if (opts.allow_ts_decorators) {
                ts_decorators = try p.parseTypeScriptDecorators();
            }

            if (!func.flags.has_rest_arg and p.lexer.token == T.t_dot_dot_dot) {
                // p.markSyntaxFeature
                try p.lexer.next();
                func.flags.has_rest_arg = true;
            }

            var is_typescript_ctor_field = false;
            var is_identifier = p.lexer.token == T.t_identifier;
            var text = p.lexer.identifier;
            var arg = try p.parseBinding();

            if (p.options.ts and is_identifier and opts.is_constructor) {
                // Skip over TypeScript accessibility modifiers, which turn this argument
                // into a class field when used inside a class constructor. This is known
                // as a "parameter property" in TypeScript.
                while (true) {
                    switch (p.lexer.token) {
                        .t_identifier, .t_open_brace, .t_open_bracket => {
                            if (!js_lexer.TypeScriptAccessibilityModifier.has(p.lexer.identifier)) {
                                break;
                            }

                            is_typescript_ctor_field = true;

                            // TypeScript requires an identifier binding
                            if (p.lexer.token != .t_identifier) {
                                try p.lexer.expect(.t_identifier);
                            }
                            text = p.lexer.identifier;

                            // Re-parse the binding (the current binding is the TypeScript keyword)
                            arg = try p.parseBinding();
                        },
                        else => {
                            break;
                        },
                    }
                }

                // "function foo(a?) {}"
                if (p.lexer.token == .t_question) {
                    try p.lexer.next();
                }

                // "function foo(a: any) {}"
                if (p.lexer.token == .t_colon) {
                    try p.lexer.next();
                    p.skipTypescriptType(.lowest);
                }
            }

            var parseStmtOpts = ParseStatementOptions{};
            p.declareBinding(.hoisted, &arg, &parseStmtOpts) catch unreachable;

            var default_value: ?ExprNodeIndex = null;
            if (!func.flags.has_rest_arg and p.lexer.token == .t_equals) {
                // p.markSyntaxFeature
                try p.lexer.next();
                default_value = try p.parseExpr(.comma);
            }

            args.append(G.Arg{
                .ts_decorators = ts_decorators,
                .binding = arg,
                .default = default_value,

                // We need to track this because it affects code generation
                .is_typescript_ctor_field = is_typescript_ctor_field,
            }) catch unreachable;

            if (p.lexer.token != .t_comma) {
                break;
            }

            if (func.flags.has_rest_arg) {
                // JavaScript does not allow a comma after a rest argument
                if (opts.is_typescript_declare) {
                    // TypeScript does allow a comma after a rest argument in a "declare" context
                    try p.lexer.next();
                } else {
                    try p.lexer.expect(.t_close_paren);
                }

                break;
            }

            try p.lexer.next();
        }
        if (args.items.len > 0) {
            func.args = args.toOwnedSlice();
        }

        // Reserve the special name "arguments" in this scope. This ensures that it
        // shadows any variable called "arguments" in any parent scopes. But only do
        // this if it wasn't already declared above because arguments are allowed to
        // be called "arguments", in which case the real "arguments" is inaccessible.
        if (!p.current_scope.members.contains("arguments")) {
            func.arguments_ref = p.declareSymbol(.arguments, func.open_parens_loc, "arguments") catch unreachable;
            p.symbols.items[func.arguments_ref.?.inner_index].must_not_be_renamed = true;
        }

        try p.lexer.expect(.t_close_paren);
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        // "function foo(): any {}"
        if (p.options.ts and p.lexer.token == .t_colon) {
            try p.lexer.next();
            p.skipTypescriptReturnType();
        }

        // "function foo(): any;"
        if (opts.allow_missing_body_for_type_script and p.lexer.token != .t_open_brace) {
            try p.lexer.expectOrInsertSemicolon();
            return func;
        }
        var tempOpts = opts;
        func.body = try p.parseFnBody(&tempOpts);

        return func;
    }

    // pub fn parseBinding(p: *P)

    // TODO:
    pub fn skipTypescriptReturnType(p: *P) void {
        notimpl();
    }

    // TODO:
    pub fn parseTypeScriptDecorators(p: *P) ![]ExprNodeIndex {
        if (!p.options.ts) {
            return &([_]ExprNodeIndex{});
        }

        var decorators = List(ExprNodeIndex).init(p.allocator);
        while (p.lexer.token == T.t_at) {
            try p.lexer.next();

            // Parse a new/call expression with "exprFlagTSDecorator" so we ignore
            // EIndex expressions, since they may be part of a computed property:
            //
            //   class Foo {
            //     @foo ['computed']() {}
            //   }
            //
            // This matches the behavior of the TypeScript compiler.
            try decorators.append(try p.parseExprWithFlags(.new, Expr.EFlags.ts_decorator));
        }

        return decorators.toOwnedSlice();
    }

    // TODO:
    pub fn skipTypescriptType(p: *P, level: js_ast.Op.Level) void {
        notimpl();
    }

    pub const TypescriptIdentifier = enum {
        pub const Map = std.ComptimeStringMap(Kind, .{
            .{ "unique", .unique },
            .{ "abstract", .abstract },
            .{ "asserts", .asserts },
            .{ "keyof", .prefix },
            .{ "readonly", .prefix },
            .{ "infer", .prefix },
            .{ "any", .primitive },
            .{ "never", .primitive },
            .{ "unknown", .primitive },
            .{ "undefined", .primitive },
            .{ "object", .primitive },
            .{ "number", .primitive },
            .{ "string", .primitive },
            .{ "boolean", .primitive },
            .{ "bigint", .primitive },
            .{ "symbol", .primitive },
        });
        pub const Kind = enum {
            normal,
            unique,
            abstract,
            asserts,
            prefix,
            primitive,
        };
    };

    pub fn skipTypeScriptBinding(p: *P) !void {
        switch (p.lexer.token) {
            .t_identifier, .t_this => {},
            .t_open_bracket => {},
            .t_open_brace => {},
        }
    }

    pub fn skipTypescriptTypeWithOptions(p: *P, level: js_ast.Op.Level) void {
        notimpl();
    }

    // TODO:
    pub fn skipTypescriptTypeParameters(p: *P) void {
        notimpl();
    }

    fn createDefaultName(p: *P, loc: logger.Loc) !js_ast.LocRef {
        var identifier = try std.fmt.allocPrint(p.allocator, "{s}_default", .{p.source.identifier_name});

        const name = js_ast.LocRef{ .loc = loc, .ref = try p.newSymbol(Symbol.Kind.other, identifier) };

        var scope = p.current_scope;

        try scope.generated.append(name.ref orelse unreachable);

        return name;
    }

    pub fn newSymbol(p: *P, kind: Symbol.Kind, identifier: string) !js_ast.Ref {
        const ref = js_ast.Ref{
            .source_index = Ref.toInt(p.source.index),
            .inner_index = Ref.toInt(p.symbols.items.len),
        };
        try p.symbols.append(Symbol{
            .kind = kind,
            .original_name = identifier,
            .link = null,
        });

        if (p.options.ts) {
            try p.ts_use_counts.append(0);
        }
        return ref;
    }

    pub fn parseLabelName(p: *P) !?js_ast.LocRef {
        if (p.lexer.token != .t_identifier or p.lexer.has_newline_before) {
            return null;
        }

        const name = LocRef{ .loc = p.lexer.loc(), .ref = try p.storeNameInRef(p.lexer.identifier) };
        try p.lexer.next();
        return name;
    }

    pub fn parseClassStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) !Stmt {
        var name: ?js_ast.LocRef = null;
        var class_keyword = p.lexer.range();
        if (p.lexer.token == .t_class) {
            //marksyntaxfeature
            try p.lexer.next();
        } else {
            try p.lexer.expected(.t_class);
        }

        var is_identifier = p.lexer.token == .t_identifier;
        var is_strict_modereserved_word = is_identifier and js_lexer.StrictModeReservedWords.has(p.lexer.identifier);

        if (!opts.is_name_optional or (is_identifier and !is_strict_modereserved_word)) {
            var name_loc = p.lexer.loc();
            var name_text = p.lexer.identifier;
            if (is_strict_modereserved_word) {
                try p.lexer.unexpected();
            }

            try p.lexer.expect(.t_identifier);
            name = LocRef{ .loc = name_loc, .ref = null };
            if (!opts.is_typescript_declare) {
                (name orelse unreachable).ref = p.declareSymbol(.class, name_loc, name_text) catch unreachable;
            }
        }

        // Even anonymous classes can have TypeScript type parameters
        if (p.options.ts) {
            p.skipTypescriptTypeParameters();
        }
        var class_opts = ParseClassOptions{
            .allow_ts_decorators = true,
            .is_type_script_declare = opts.is_typescript_declare,
        };
        if (opts.ts_decorators) |dec| {
            class_opts.ts_decorators = dec.values;
        }

        var scope_index = p.pushScopeForParsePass(.class_name, loc) catch unreachable;
        var class = try p.parseClass(class_keyword, name, class_opts);

        if (opts.is_typescript_declare) {
            p.popAndDiscardScope(scope_index);
            if (opts.is_namespace_scope and opts.is_export) {
                p.has_non_local_export_declare_inside_namespace = true;
            }

            return p.s(S.TypeScript{}, loc);
        }

        p.popScope();
        return p.s(S.Class{
            .class = class,
            .is_export = opts.is_export,
        }, loc);
    }

    pub fn parseStmt(p: *P, opts: *ParseStatementOptions) anyerror!Stmt {
        var loc = p.lexer.loc();

        switch (p.lexer.token) {
            .t_semicolon => {
                try p.lexer.next();
                return Stmt.empty();
            },

            .t_export => {
                var previousExportKeyword = p.es6_export_keyword;
                if (opts.is_module_scope) {
                    p.es6_export_keyword = p.lexer.range();
                } else if (!opts.is_namespace_scope) {
                    try p.lexer.unexpected();
                }
                try p.lexer.next();

                // TypeScript decorators only work on class declarations
                // "@decorator export class Foo {}"
                // "@decorator export abstract class Foo {}"
                // "@decorator export default class Foo {}"
                // "@decorator export default abstract class Foo {}"
                // "@decorator export declare class Foo {}"
                // "@decorator export declare abstract class Foo {}"
                if (opts.ts_decorators != null and p.lexer.token != js_lexer.T.t_class and p.lexer.token != js_lexer.T.t_default and !p.lexer.isContextualKeyword("abstract") and !p.lexer.isContextualKeyword("declare")) {
                    try p.lexer.expected(js_lexer.T.t_class);
                }

                switch (p.lexer.token) {
                    T.t_class, T.t_const, T.t_function, T.t_var => {
                        opts.is_export = true;
                        return p.parseStmt(opts);
                    },

                    T.t_import => {
                        // "export import foo = bar"
                        if (p.options.ts and (opts.is_module_scope or opts.is_namespace_scope)) {
                            opts.is_export = true;
                            return p.parseStmt(opts);
                        }

                        try p.lexer.unexpected();
                    },

                    T.t_enum => {
                        if (!p.options.ts) {
                            try p.lexer.unexpected();
                        }

                        opts.is_export = true;
                        return p.parseStmt(opts);
                    },

                    T.t_identifier => {
                        if (p.lexer.isContextualKeyword("let")) {
                            opts.is_export = true;
                            return p.parseStmt(opts);
                        }

                        if (opts.is_typescript_declare and p.lexer.isContextualKeyword("as")) {
                            // "export as namespace ns;"
                            try p.lexer.next();
                            try p.lexer.expectContextualKeyword("namespace");
                            try p.lexer.expect(T.t_identifier);
                            try p.lexer.expectOrInsertSemicolon();

                            return p.s(S.TypeScript{}, loc);
                        }

                        if (p.lexer.isContextualKeyword("async")) {
                            var asyncRange = p.lexer.range();
                            try p.lexer.next();
                            if (p.lexer.has_newline_before) {
                                try p.log.addRangeError(p.source, asyncRange, "Unexpected newline after \"async\"");
                            }

                            try p.lexer.expect(T.t_function);
                            opts.is_export = true;
                            return try p.parseFnStmt(loc, opts, asyncRange);
                        }

                        if (p.options.ts) {
                            notimpl();

                            // switch (p.lexer.identifier) {
                            //     "type" => {
                            //         // "export type foo = ..."
                            //         const typeRange = p.lexer.range();
                            //         if (p.lexer.has_newline_before) {
                            //             p.lexer.addError(p.source, typeRange.end(), "Unexpected newline after \"type\"");
                            //             return;
                            //         }

                            //     },
                            // }
                        }

                        try p.lexer.unexpected();
                        lexerpanic();
                    },

                    T.t_default => {
                        if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            try p.lexer.unexpected();
                            lexerpanic();
                        }

                        var defaultLoc = p.lexer.loc();
                        try p.lexer.next();

                        // TypeScript decorators only work on class declarations
                        // "@decorator export default class Foo {}"
                        // "@decorator export default abstract class Foo {}"
                        if (opts.ts_decorators != null and p.lexer.token != T.t_class and !p.lexer.isContextualKeyword("abstract")) {
                            try p.lexer.expected(T.t_class);
                        }

                        if (p.lexer.isContextualKeyword("async")) {
                            var async_range = p.lexer.range();
                            try p.lexer.next();
                            var defaultName: js_ast.LocRef = undefined;
                            if (p.lexer.token == T.t_function and !p.lexer.has_newline_before) {
                                try p.lexer.next();
                                var stmtOpts = ParseStatementOptions{
                                    .is_name_optional = true,
                                    .lexical_decl = .allow_all,
                                };
                                var stmt = try p.parseFnStmt(loc, &stmtOpts, async_range);
                                if (@as(Stmt.Tag, stmt.data) == .s_type_script) {
                                    // This was just a type annotation
                                    return stmt;
                                }

                                if (stmt.data.s_function.func.name) |name| {
                                    defaultName = js_ast.LocRef{ .loc = defaultLoc, .ref = name.ref };
                                } else {
                                    defaultName = try p.createDefaultName(defaultLoc);
                                }
                                // this is probably a panic
                                var value = js_ast.StmtOrExpr{ .stmt = stmt };
                                return p.s(S.ExportDefault{ .default_name = defaultName, .value = value }, loc);
                            }

                            defaultName = try createDefaultName(p, loc);

                            const prefix_expr = try p.parseAsyncPrefixExpr(async_range, Level.comma);
                            var expr = try p.parseSuffix(prefix_expr, Level.comma, null, Expr.EFlags.none);
                            try p.lexer.expectOrInsertSemicolon();
                            // this is probably a panic
                            var value = js_ast.StmtOrExpr{ .expr = expr };
                            return p.s(S.ExportDefault{ .default_name = defaultName, .value = value }, loc);
                        }

                        if (p.lexer.token == .t_function or p.lexer.token == .t_class or p.lexer.isContextualKeyword("interface")) {
                            var _opts = ParseStatementOptions{
                                .ts_decorators = opts.ts_decorators,
                                .is_name_optional = true,
                                .lexical_decl = .allow_all,
                            };
                            var stmt = try p.parseStmt(&_opts);

                            const default_name: js_ast.LocRef = default_name_getter: {
                                switch (stmt.data) {
                                    // This was just a type annotation
                                    .s_type_script => {
                                        return stmt;
                                    },

                                    .s_function => |func_container| {
                                        if (func_container.func.name) |name| {
                                            break :default_name_getter LocRef{ .loc = defaultLoc, .ref = name.ref };
                                        } else {}
                                    },
                                    .s_class => |class| {
                                        if (class.class.class_name) |name| {
                                            break :default_name_getter LocRef{ .loc = defaultLoc, .ref = name.ref };
                                        } else {}
                                    },
                                    else => {},
                                }

                                break :default_name_getter createDefaultName(p, defaultLoc) catch unreachable;
                            };

                            return p.s(
                                S.ExportDefault{ .default_name = default_name, .value = js_ast.StmtOrExpr{ .stmt = stmt } },
                                loc,
                            );
                        }

                        const is_identifier = p.lexer.token == .t_identifier;
                        const name = p.lexer.identifier;
                        var expr = try p.parseExpr(.comma);

                        // Handle the default export of an abstract class in TypeScript
                        if (p.options.ts and is_identifier and (p.lexer.token == .t_class or opts.ts_decorators != null) and strings.eqlComptime(name, "abstract")) {
                            switch (expr.data) {
                                .e_identifier => |ident| {
                                    var stmtOpts = ParseStatementOptions{
                                        .ts_decorators = opts.ts_decorators,
                                        .is_name_optional = true,
                                    };
                                    const stmt: Stmt = try p.parseClassStmt(loc, &stmtOpts);

                                    // Use the statement name if present, since it's a better name
                                    const default_name: js_ast.LocRef = default_name_getter: {
                                        switch (stmt.data) {
                                            // This was just a type annotation
                                            .s_type_script => {
                                                return stmt;
                                            },

                                            .s_function => |func_container| {
                                                if (func_container.func.name) |_name| {
                                                    break :default_name_getter LocRef{ .loc = defaultLoc, .ref = _name.ref };
                                                } else {}
                                            },
                                            .s_class => |class| {
                                                if (class.class.class_name) |_name| {
                                                    break :default_name_getter LocRef{ .loc = defaultLoc, .ref = _name.ref };
                                                } else {}
                                            },
                                            else => {},
                                        }

                                        break :default_name_getter createDefaultName(p, defaultLoc) catch unreachable;
                                    };

                                    return p.s(S.ExportDefault{ .default_name = default_name, .value = js_ast.StmtOrExpr{ .stmt = stmt } }, loc);
                                },
                                else => {
                                    p.panic("internal error: unexpected", .{});
                                },
                            }
                        }

                        try p.lexer.expectOrInsertSemicolon();
                        return p.s(S.ExportDefault{ .default_name = createDefaultName(p, loc) catch unreachable, .value = js_ast.StmtOrExpr{ .expr = expr } }, loc);
                    },
                    T.t_asterisk => {
                        if (!opts.is_module_scope and !(opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            try p.lexer.unexpected();
                        }

                        try p.lexer.next();
                        var namespace_ref: js_ast.Ref = js_ast.Ref.None;
                        var alias: ?js_ast.G.ExportStarAlias = null;
                        var path_loc: logger.Loc = logger.Loc.Empty;
                        var path_text: string = "";

                        if (p.lexer.isContextualKeyword("as")) {
                            // "export * as ns from 'path'"
                            const name = p.lexer.identifier;
                            namespace_ref = p.storeNameInRef(name) catch unreachable;
                            alias = G.ExportStarAlias{ .loc = p.lexer.loc(), .original_name = name };
                            if (!p.lexer.isIdentifierOrKeyword()) {
                                try p.lexer.expect(.t_identifier);
                            }
                            p.checkForNonBMPCodePoint((alias orelse unreachable).loc, name);
                            try p.lexer.next();
                            try p.lexer.expectContextualKeyword("from");
                            const parsedPath = try p.parsePath();
                            path_loc = parsedPath.loc;
                            path_text = parsedPath.text;
                        } else {
                            // "export * from 'path'"
                            try p.lexer.expectContextualKeyword("from");
                            const parsedPath = try p.parsePath();
                            path_loc = parsedPath.loc;
                            path_text = parsedPath.text;
                            var path_name = fs.PathName.init(strings.append(p.allocator, path_text, "_star") catch unreachable);
                            namespace_ref = p.storeNameInRef(path_name.nonUniqueNameString(p.allocator) catch unreachable) catch unreachable;
                        }

                        var import_record_index = p.addImportRecord(ImportKind.stmt, path_loc, path_text);
                        try p.lexer.expectOrInsertSemicolon();
                        return p.s(S.ExportStar{
                            .namespace_ref = namespace_ref,
                            .alias = alias,
                            .import_record_index = import_record_index,
                        }, loc);
                    },
                    T.t_open_brace => {
                        if (!opts.is_module_scope and !(opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            try p.lexer.unexpected();
                        }

                        const export_clause = try p.parseExportClause();
                        if (p.lexer.isContextualKeyword("from")) {
                            try p.lexer.expectContextualKeyword("from");
                            const parsedPath = try p.parsePath();
                            const import_record_index = p.addImportRecord(.stmt, parsedPath.loc, parsedPath.text);
                            var path_name = fs.PathName.init(strings.append(p.allocator, "import_", parsedPath.text) catch unreachable);
                            const namespace_ref = p.storeNameInRef(path_name.nonUniqueNameString(p.allocator) catch unreachable) catch unreachable;
                            try p.lexer.expectOrInsertSemicolon();
                            return p.s(S.ExportFrom{ .items = export_clause.clauses, .is_single_line = export_clause.is_single_line, .namespace_ref = namespace_ref, .import_record_index = import_record_index }, loc);
                        }
                        try p.lexer.expectOrInsertSemicolon();
                        return p.s(S.ExportClause{ .items = export_clause.clauses, .is_single_line = export_clause.is_single_line }, loc);
                    },
                    T.t_equals => {
                        // "export = value;"

                        p.es6_export_keyword = previousExportKeyword; // This wasn't an ESM export statement after all
                        if (p.options.ts) {
                            try p.lexer.next();
                            var value = try p.parseExpr(.lowest);
                            try p.lexer.expectOrInsertSemicolon();
                            return p.s(S.ExportEquals{ .value = value }, loc);
                        }
                        try p.lexer.unexpected();
                        return Stmt.empty();
                    },
                    else => {
                        try p.lexer.unexpected();
                        return Stmt.empty();
                    },
                }
            },

            .t_function => {
                try p.lexer.next();
                return try p.parseFnStmt(loc, opts, null);
            },
            .t_enum => {
                if (!p.options.ts) {
                    try p.lexer.unexpected();
                }
                return p.parseTypescriptEnumStmt(loc, opts);
            },
            .t_at => {
                // Parse decorators before class statements, which are potentially exported
                if (p.options.ts) {
                    const scope_index = p.scopes_in_order.items.len;
                    const ts_decorators = try p.parseTypeScriptDecorators();

                    // If this turns out to be a "declare class" statement, we need to undo the
                    // scopes that were potentially pushed while parsing the decorator arguments.
                    // That can look like any one of the following:
                    //
                    //   "@decorator declare class Foo {}"
                    //   "@decorator declare abstract class Foo {}"
                    //   "@decorator export declare class Foo {}"
                    //   "@decorator export declare abstract class Foo {}"
                    //
                    opts.ts_decorators = DeferredTsDecorators{
                        .values = ts_decorators,
                        .scope_index = scope_index,
                    };

                    // "@decorator class Foo {}"
                    // "@decorator abstract class Foo {}"
                    // "@decorator declare class Foo {}"
                    // "@decorator declare abstract class Foo {}"
                    // "@decorator export class Foo {}"
                    // "@decorator export abstract class Foo {}"
                    // "@decorator export declare class Foo {}"
                    // "@decorator export declare abstract class Foo {}"
                    // "@decorator export default class Foo {}"
                    // "@decorator export default abstract class Foo {}"
                    if (p.lexer.token != .t_class and p.lexer.token != .t_export and !p.lexer.isContextualKeyword("abstract") and !p.lexer.isContextualKeyword("declare")) {
                        try p.lexer.expected(.t_class);
                    }

                    return p.parseStmt(opts);
                }
                // notimpl();
            },
            .t_class => {
                if (opts.lexical_decl != .allow_all) {
                    try p.forbidLexicalDecl(loc);
                }

                return try p.parseClassStmt(loc, opts);
            },
            .t_var => {
                try p.lexer.next();
                const decls = try p.parseAndDeclareDecls(.hoisted, opts);
                try p.lexer.expectOrInsertSemicolon();
                return p.s(S.Local{ .kind = .k_var, .decls = decls, .is_export = opts.is_export }, loc);
            },
            .t_const => {
                if (opts.lexical_decl != .allow_all) {
                    try p.forbidLexicalDecl(loc);
                }
                // p.markSyntaxFeature(compat.Const, p.lexer.Range())

                try p.lexer.next();

                if (p.options.ts and p.lexer.token == T.t_enum) {
                    return p.parseTypescriptEnumStmt(loc, opts);
                }

                const decls = try p.parseAndDeclareDecls(.cconst, opts);
                try p.lexer.expectOrInsertSemicolon();

                if (!opts.is_typescript_declare) {
                    try p.requireInitializers(decls);
                }

                return p.s(S.Local{ .kind = .k_const, .decls = decls, .is_export = opts.is_export }, loc);
            },
            .t_if => {
                try p.lexer.next();
                try p.lexer.expect(.t_open_paren);
                const test_ = try p.parseExpr(.lowest);
                try p.lexer.expect(.t_close_paren);
                var stmtOpts = ParseStatementOptions{
                    .lexical_decl = .allow_fn_inside_if,
                };
                const yes = try p.parseStmt(&stmtOpts);
                var no: ?Stmt = null;
                if (p.lexer.token == .t_else) {
                    try p.lexer.next();
                    stmtOpts = ParseStatementOptions{
                        .lexical_decl = .allow_fn_inside_if,
                    };
                    no = try p.parseStmt(&stmtOpts);
                }

                return p.s(S.If{
                    .test_ = test_,
                    .yes = yes,
                    .no = no,
                }, loc);
            },
            .t_do => {
                try p.lexer.next();
                var stmtOpts = ParseStatementOptions{};
                const body = try p.parseStmt(&stmtOpts);
                try p.lexer.expect(.t_while);
                try p.lexer.expect(.t_open_paren);
                const test_ = try p.parseExpr(.lowest);
                try p.lexer.expect(.t_close_paren);

                // This is a weird corner case where automatic semicolon insertion applies
                // even without a newline present
                if (p.lexer.token == .t_semicolon) {
                    try p.lexer.next();
                }
                return p.s(S.DoWhile{ .body = body, .test_ = test_ }, loc);
            },
            .t_while => {
                try p.lexer.next();

                try p.lexer.expect(.t_open_paren);
                const test_ = try p.parseExpr(.lowest);
                try p.lexer.expect(.t_close_paren);

                var stmtOpts = ParseStatementOptions{};
                const body = try p.parseStmt(&stmtOpts);

                return p.s(S.While{
                    .body = body,
                    .test_ = test_,
                }, loc);
            },
            .t_with => {
                try p.lexer.next();
                try p.lexer.expect(.t_open_paren);
                const test_ = try p.parseExpr(.lowest);
                const body_loc = p.lexer.loc();
                try p.lexer.expect(.t_close_paren);
            },
            .t_switch => {
                try p.lexer.next();

                try p.lexer.expect(.t_open_paren);
                const test_ = try p.parseExpr(.lowest);
                try p.lexer.expect(.t_close_paren);

                const body_loc = p.lexer.loc();
                _ = try p.pushScopeForParsePass(.block, body_loc);
                defer p.popScope();

                try p.lexer.expect(.t_open_brace);
                var cases = List(js_ast.Case).init(p.allocator);
                var foundDefault = false;
                var stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };
                var value: ?js_ast.Expr = null;
                while (p.lexer.token != .t_close_brace) {
                    var body = List(js_ast.Stmt).init(p.allocator);
                    value = null;
                    if (p.lexer.token == .t_default) {
                        if (foundDefault) {
                            try p.log.addRangeError(p.source, p.lexer.range(), "Multiple default clauses are not allowed");
                            fail();
                        }

                        foundDefault = true;
                        try p.lexer.next();
                        try p.lexer.expect(.t_colon);
                    } else {
                        try p.lexer.expect(.t_case);
                        value = try p.parseExpr(.lowest);
                        try p.lexer.expect(.t_colon);
                    }

                    caseBody: while (true) {
                        switch (p.lexer.token) {
                            .t_close_brace, .t_case, .t_default => {
                                break :caseBody;
                            },
                            else => {
                                stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };
                                try body.append(try p.parseStmt(&stmtOpts));
                            },
                        }
                    }
                    try cases.append(js_ast.Case{ .value = value, .body = body.toOwnedSlice(), .loc = logger.Loc.Empty });
                }
                try p.lexer.expect(.t_close_brace);
                return p.s(S.Switch{ .test_ = test_, .body_loc = body_loc, .cases = cases.toOwnedSlice() }, loc);
            },
            .t_try => {
                try p.lexer.next();
                const body_loc = p.lexer.loc();
                try p.lexer.expect(.t_open_brace);
                _ = try p.pushScopeForParsePass(.block, loc);
                var stmtOpts = ParseStatementOptions{};
                const body = try p.parseStmtsUpTo(.t_close_brace, &stmtOpts);
                p.popScope();
                try p.lexer.next();

                var catch_: ?js_ast.Catch = null;
                var finally: ?js_ast.Finally = null;

                if (p.lexer.token == .t_catch) {
                    const catch_loc = p.lexer.loc();
                    _ = try p.pushScopeForParsePass(.block, catch_loc);
                    try p.lexer.next();
                    var binding: ?js_ast.Binding = null;

                    // The catch binding is optional, and can be omitted
                    // jarred: TIL!
                    if (p.lexer.token != .t_open_brace) {
                        try p.lexer.expect(.t_open_paren);
                        var value = try p.parseBinding();

                        // Skip over types
                        if (p.options.ts and p.lexer.token == .t_colon) {
                            try p.lexer.expect(.t_colon);
                            p.skipTypescriptType(.lowest);
                        }

                        try p.lexer.expect(.t_close_paren);

                        // Bare identifiers are a special case
                        var kind = Symbol.Kind.other;
                        switch (value.data) {
                            .b_identifier => {
                                kind = .catch_identifier;
                            },
                            else => {},
                        }
                        stmtOpts = ParseStatementOptions{};
                        try p.declareBinding(kind, &value, &stmtOpts);
                        binding = value;
                    }

                    try p.lexer.expect(.t_open_brace);
                    stmtOpts = ParseStatementOptions{};
                    const stmts = try p.parseStmtsUpTo(.t_close_brace, &stmtOpts);
                    try p.lexer.next();
                    catch_ = js_ast.Catch{
                        .loc = catch_loc,
                        .binding = binding,
                        .body = stmts,
                    };
                    p.popScope();
                }

                if (p.lexer.token == .t_finally or catch_ == null) {
                    const finally_loc = p.lexer.loc();
                    _ = try p.pushScopeForParsePass(.block, finally_loc);
                    try p.lexer.expect(.t_finally);
                    try p.lexer.expect(.t_open_brace);
                    stmtOpts = ParseStatementOptions{};
                    const stmts = try p.parseStmtsUpTo(.t_close_brace, &stmtOpts);
                    try p.lexer.next();
                    finally = js_ast.Finally{ .loc = finally_loc, .stmts = stmts };
                    p.popScope();
                }

                return p.s(
                    S.Try{ .body_loc = body_loc, .body = body, .catch_ = catch_, .finally = finally },
                    loc,
                );
            },
            .t_for => {
                _ = try p.pushScopeForParsePass(.block, loc);
                defer p.popScope();

                try p.lexer.next();

                // "for await (let x of y) {}"
                var isForAwait = p.lexer.isContextualKeyword("await");
                if (isForAwait) {
                    const await_range = p.lexer.range();
                    if (p.fn_or_arrow_data_parse.allow_await != .allow_expr) {
                        try p.log.addRangeError(p.source, await_range, "Cannot use \"await\" outside an async function");
                        isForAwait = false;
                    } else {
                        // TODO: improve error handling here
                        //         		didGenerateError := p.markSyntaxFeature(compat.ForAwait, awaitRange)
                        if (p.fn_or_arrow_data_parse.is_top_level) {
                            p.top_level_await_keyword = await_range;
                            // p.markSyntaxFeature(compat.TopLevelAwait, awaitRange)
                        }
                    }
                    try p.lexer.next();
                }

                try p.lexer.expect(.t_open_paren);

                var init_: ?Stmt = null;
                var test_: ?Expr = null;
                var update: ?Expr = null;

                // "in" expressions aren't allowed here
                p.allow_in = false;

                var bad_let_range: ?logger.Range = null;
                if (p.lexer.isContextualKeyword("let")) {
                    bad_let_range = p.lexer.range();
                }

                var decls: []G.Decl = &([_]G.Decl{});
                var init_loc = p.lexer.loc();
                var is_var = false;
                switch (p.lexer.token) {
                    // for (var )
                    .t_var => {
                        is_var = true;
                        try p.lexer.next();
                        var stmtOpts = ParseStatementOptions{};
                        decls = try p.parseAndDeclareDecls(.hoisted, &stmtOpts);
                        init_ = p.s(S.Local{ .kind = .k_const, .decls = decls }, init_loc);
                    },
                    // for (const )
                    .t_const => {
                        try p.lexer.next();
                        var stmtOpts = ParseStatementOptions{};
                        decls = try p.parseAndDeclareDecls(.cconst, &stmtOpts);
                        init_ = p.s(S.Local{ .kind = .k_const, .decls = decls }, init_loc);
                    },
                    // for (;)
                    .t_semicolon => {},
                    else => {
                        var stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };

                        const res = try p.parseExprOrLetStmt(&stmtOpts);
                        switch (res.stmt_or_expr) {
                            .stmt => |stmt| {
                                bad_let_range = null;
                                init_ = stmt;
                            },
                            .expr => |expr| {
                                init_ = p.s(S.SExpr{
                                    .value = expr,
                                }, init_loc);
                            },
                        }
                    },
                }

                // "in" expressions are allowed again
                p.allow_in = true;

                // Detect for-of loops
                if (p.lexer.isContextualKeyword("of") or isForAwait) {
                    if (bad_let_range) |r| {
                        try p.log.addRangeError(p.source, r, "\"let\" must be wrapped in parentheses to be used as an expression here");
                        fail();
                    }

                    if (isForAwait and !p.lexer.isContextualKeyword("of")) {
                        if (init_) |init_stmt| {
                            try p.lexer.expectedString("\"of\"");
                        } else {
                            try p.lexer.unexpected();
                        }
                    }

                    try p.forbidInitializers(decls, "of", false);
                    try p.lexer.next();
                    const value = try p.parseExpr(.comma);
                    try p.lexer.expect(.t_close_paren);
                    var stmtOpts = ParseStatementOptions{};
                    const body = try p.parseStmt(&stmtOpts);
                    return p.s(S.ForOf{ .is_await = isForAwait, .init = init_ orelse unreachable, .value = value, .body = body }, loc);
                }

                // Detect for-in loops
                if (p.lexer.token == .t_in) {
                    try p.forbidInitializers(decls, "in", false);
                    try p.lexer.next();
                    const value = try p.parseExpr(.lowest);
                    try p.lexer.expect(.t_close_paren);
                    var stmtOpts = ParseStatementOptions{};
                    const body = try p.parseStmt(&stmtOpts);
                    return p.s(S.ForIn{ .init = init_ orelse unreachable, .value = value, .body = body }, loc);
                }

                // Only require "const" statement initializers when we know we're a normal for loop
                if (init_) |init_stmt| {
                    switch (init_stmt.data) {
                        .s_local => |local| {
                            if (local.kind == .k_const) {
                                try p.requireInitializers(decls);
                            }
                        },
                        else => {},
                    }
                }

                try p.lexer.expect(.t_semicolon);
                if (p.lexer.token != .t_semicolon) {
                    test_ = try p.parseExpr(.lowest);
                }

                try p.lexer.expect(.t_semicolon);

                if (p.lexer.token != .t_close_paren) {
                    update = try p.parseExpr(.lowest);
                }

                try p.lexer.expect(.t_close_paren);
                var stmtOpts = ParseStatementOptions{};
                const body = try p.parseStmt(&stmtOpts);
                return p.s(
                    S.For{ .init = init_, .test_ = test_, .update = update, .body = body },
                    loc,
                );
            },
            .t_import => {
                const previous_import_keyword = p.es6_import_keyword;
                p.es6_import_keyword = p.lexer.range();
                try p.lexer.next();
                var stmt: S.Import = S.Import{
                    .namespace_ref = Ref.None,
                    .import_record_index = std.math.maxInt(u32),
                };
                var was_originally_bare_import = false;

                // "export import foo = bar"
                if ((opts.is_export or (opts.is_namespace_scope and !opts.is_typescript_declare)) and p.lexer.token != .t_identifier) {
                    try p.lexer.expected(.t_identifier);
                }

                switch (p.lexer.token) {
                    // "import('path')"
                    // "import.meta"
                    .t_open_paren, .t_dot => {
                        p.es6_import_keyword = previous_import_keyword; // this wasn't an esm import statement after all
                        const expr = try p.parseSuffix(try p.parseImportExpr(loc, .lowest), .lowest, null, Expr.EFlags.none);
                        try p.lexer.expectOrInsertSemicolon();
                        return p.s(S.SExpr{
                            .value = expr,
                        }, loc);
                    },
                    .t_string_literal, .t_no_substitution_template_literal => {
                        // "import 'path'"
                        if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            try p.lexer.unexpected();
                            fail();
                        }
                        was_originally_bare_import = true;
                    },
                    .t_asterisk => {
                        // "import * as ns from 'path'"
                        if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            try p.lexer.unexpected();
                            fail();
                        }

                        try p.lexer.next();
                        try p.lexer.expectContextualKeyword("as");
                        stmt = S.Import{
                            .namespace_ref = try p.storeNameInRef(p.lexer.identifier),
                            .star_name_loc = p.lexer.loc(),
                            .import_record_index = std.math.maxInt(u32),
                        };
                        try p.lexer.expect(.t_identifier);
                        try p.lexer.expectContextualKeyword("from");
                    },
                    .t_open_brace => {
                        // "import {item1, item2} from 'path'"
                        if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                            try p.lexer.unexpected();
                            fail();
                        }
                        var importClause = try p.parseImportClause();
                        stmt = S.Import{
                            .namespace_ref = Ref.None,
                            .import_record_index = std.math.maxInt(u32),
                            .items = importClause.items,
                            .is_single_line = importClause.is_single_line,
                        };
                        try p.lexer.expectContextualKeyword("from");
                    },
                    .t_identifier => {
                        // "import defaultItem from 'path'"
                        // "import foo = bar"
                        if (!opts.is_module_scope and (!opts.is_namespace_scope)) {
                            try p.lexer.unexpected();
                            fail();
                        }

                        const default_name = p.lexer.identifier;
                        stmt = S.Import{ .namespace_ref = Ref.None, .import_record_index = std.math.maxInt(u32), .default_name = LocRef{
                            .loc = p.lexer.loc(),
                            .ref = try p.storeNameInRef(default_name),
                        } };
                        try p.lexer.next();

                        if (p.options.ts) {
                            // Skip over type-only imports
                            if (strings.eqlComptime(default_name, "type")) {
                                switch (p.lexer.token) {
                                    .t_identifier => {
                                        if (!strings.eqlComptime(p.lexer.identifier, "from")) {
                                            // "import type foo from 'bar';"
                                            try p.lexer.next();
                                            try p.lexer.expectContextualKeyword("from");
                                            _ = try p.parsePath();
                                            try p.lexer.expectOrInsertSemicolon();
                                            return p.s(S.TypeScript{}, loc);
                                        }
                                    },
                                    .t_asterisk => {
                                        // "import type * as foo from 'bar';"
                                        try p.lexer.next();
                                        try p.lexer.expectContextualKeyword("as");
                                        try p.lexer.expect(.t_identifier);
                                        try p.lexer.expectContextualKeyword("from");
                                        _ = try p.parsePath();
                                        try p.lexer.expectOrInsertSemicolon();
                                        return p.s(S.TypeScript{}, loc);
                                    },

                                    .t_open_brace => {
                                        // "import type {foo} from 'bar';"
                                        _ = try p.parseImportClause();
                                        try p.lexer.expectContextualKeyword("from");
                                        _ = try p.parsePath();
                                        try p.lexer.expectOrInsertSemicolon();
                                        return p.s(S.TypeScript{}, loc);
                                    },
                                    else => {},
                                }
                            }

                            // Parse TypeScript import assignment statements
                            p.es6_import_keyword = previous_import_keyword; // This wasn't an ESM import statement after all;
                            return p.parseTypeScriptImportEqualsStmt(loc, opts, logger.Loc.Empty, default_name);
                        }

                        if (p.lexer.token == .t_comma) {
                            try p.lexer.next();

                            switch (p.lexer.token) {
                                // "import defaultItem, * as ns from 'path'"
                                .t_asterisk => {
                                    try p.lexer.next();
                                    try p.lexer.expectContextualKeyword("as");
                                    stmt.namespace_ref = try p.storeNameInRef(p.lexer.identifier);
                                    stmt.star_name_loc = p.lexer.loc();
                                    try p.lexer.expect(.t_identifier);
                                },
                                // "import defaultItem, {item1, item2} from 'path'"
                                .t_open_brace => {
                                    const importClause = try p.parseImportClause();
                                    stmt.items = importClause.items;
                                    stmt.is_single_line = importClause.is_single_line;
                                },
                                else => {
                                    try p.lexer.unexpected();
                                },
                            }
                        }

                        try p.lexer.expectContextualKeyword("from");
                    },
                    else => {
                        try p.lexer.unexpected();
                        fail();
                    },
                }

                const path = try p.parsePath();
                stmt.import_record_index = p.addImportRecord(.stmt, path.loc, path.text);
                p.import_records.items[stmt.import_record_index].was_originally_bare_import = was_originally_bare_import;
                try p.lexer.expectOrInsertSemicolon();

                if (stmt.star_name_loc) |star| {
                    stmt.namespace_ref = try p.declareSymbol(.import, star, p.loadNameFromRef(stmt.namespace_ref));
                } else {
                    var path_name = fs.PathName.init(strings.append(p.allocator, "import_", path.text) catch unreachable);
                    const name = try path_name.nonUniqueNameString(p.allocator);
                    stmt.namespace_ref = try p.newSymbol(.other, name);
                    var scope: *Scope = p.current_scope;
                    try scope.generated.append(stmt.namespace_ref);
                }

                var item_refs = std.StringHashMap(LocRef).init(p.allocator);

                // Link the default item to the namespace
                if (stmt.default_name) |*name_loc| {
                    const name = p.loadNameFromRef(name_loc.ref orelse unreachable);
                    const ref = try p.declareSymbol(.import, name_loc.loc, name);
                    try p.is_import_item.put(ref, true);
                    name_loc.ref = ref;
                }

                if (stmt.items.len > 0) {
                    try item_refs.ensureCapacity(@intCast(u32, stmt.items.len));
                    for (stmt.items) |*item| {
                        const name = p.loadNameFromRef(item.name.ref orelse unreachable);
                        const ref = try p.declareSymbol(.import, item.name.loc, name);
                        p.checkForNonBMPCodePoint(item.alias_loc, item.alias);
                        try p.is_import_item.put(ref, true);
                        item.name.ref = ref;
                        item_refs.putAssumeCapacity(item.alias, LocRef{ .loc = item.name.loc, .ref = ref });
                    }
                }

                // Track the items for this namespace
                try p.import_items_for_namespace.put(stmt.namespace_ref, item_refs);
                return p.s(stmt, loc);
            },
            .t_break => {
                try p.lexer.next();
                const name = try p.parseLabelName();
                try p.lexer.expectOrInsertSemicolon();
                return p.s(S.Break{ .label = name }, loc);
            },
            .t_continue => {
                try p.lexer.next();
                const name = try p.parseLabelName();
                try p.lexer.expectOrInsertSemicolon();
                return p.s(S.Continue{ .label = name }, loc);
            },
            .t_return => {
                try p.lexer.next();
                var value: ?Expr = null;
                if ((p.lexer.token != .t_semicolon and
                    !p.lexer.has_newline_before and
                    p.lexer.token != .t_close_brace and
                    p.lexer.token != .t_end_of_file))
                {
                    value = try p.parseExpr(.lowest);
                }
                p.latest_return_had_semicolon = p.lexer.token == .t_semicolon;
                try p.lexer.expectOrInsertSemicolon();

                return p.s(S.Return{ .value = value }, loc);
            },
            .t_throw => {
                try p.lexer.next();
                if (p.lexer.has_newline_before) {
                    try p.log.addError(p.source, logger.Loc{
                        .start = loc.start + 5,
                    }, "Unexpected newline after \"throw\"");
                    fail();
                }
                const expr = try p.parseExpr(.lowest);
                try p.lexer.expectOrInsertSemicolon();
                return p.s(S.Throw{ .value = expr }, loc);
            },
            .t_debugger => {
                try p.lexer.next();
                try p.lexer.expectOrInsertSemicolon();
                return p.s(S.Debugger{}, loc);
            },
            .t_open_brace => {
                _ = try p.pushScopeForParsePass(.block, loc);
                defer p.popScope();
                try p.lexer.next();
                var stmtOpts = ParseStatementOptions{};
                const stmts = try p.parseStmtsUpTo(.t_close_brace, &stmtOpts);
                try p.lexer.next();
                return p.s(S.Block{
                    .stmts = stmts,
                }, loc);
            },

            else => {
                const is_identifier = p.lexer.token == .t_identifier;
                const name = p.lexer.identifier;
                var emiss = E.Missing{};
                // Parse either an async function, an async expression, or a normal expression
                var expr: Expr = Expr{ .loc = loc, .data = Expr.Data{ .e_missing = &emiss } };
                if (is_identifier and strings.eqlComptime(p.lexer.raw(), "async")) {
                    var async_range = p.lexer.range();
                    try p.lexer.next();
                    if (p.lexer.token == .t_function and !p.lexer.has_newline_before) {
                        try p.lexer.next();
                        return try p.parseFnStmt(async_range.loc, opts, async_range);
                    }

                    expr = try p.parseSuffix(try p.parseAsyncPrefixExpr(async_range, .lowest), .lowest, null, Expr.EFlags.none);
                } else {
                    const exprOrLet = try p.parseExprOrLetStmt(opts);
                    switch (exprOrLet.stmt_or_expr) {
                        .stmt => |stmt| {
                            try p.lexer.expectOrInsertSemicolon();
                            return stmt;
                        },
                        .expr => |_expr| {
                            expr = _expr;
                        },
                    }
                }
                if (is_identifier) {
                    switch (expr.data) {
                        .e_identifier => |ident| {
                            if (p.lexer.token == .t_colon and opts.hasNoDecorators()) {
                                _ = try p.pushScopeForParsePass(.label, loc);
                                defer p.popScope();

                                // Parse a labeled statement
                                try p.lexer.next();

                                const _name = LocRef{ .loc = expr.loc, .ref = ident.ref };
                                var nestedOpts = ParseStatementOptions{};

                                switch (opts.lexical_decl) {
                                    .allow_all, .allow_fn_inside_label => {
                                        nestedOpts.lexical_decl = .allow_fn_inside_label;
                                    },
                                    else => {},
                                }
                                var stmt = try p.parseStmt(&nestedOpts);
                                return p.s(S.Label{ .name = _name, .stmt = stmt }, loc);
                            }
                        },
                        else => {},
                    }

                    if (p.options.ts) {
                        if (js_lexer.TypescriptStmtKeyword.List.get(name)) |ts_stmt| {
                            switch (ts_stmt) {
                                .ts_stmt_type => {
                                    if (p.lexer.token == .t_identifier and !p.lexer.has_newline_before) {
                                        // "type Foo = any"
                                        var stmtOpts = ParseStatementOptions{ .is_module_scope = opts.is_module_scope };
                                        p.skipTypescriptTypeStmt(&stmtOpts);
                                        return p.s(S.TypeScript{}, loc);
                                    }
                                },
                                .ts_stmt_namespace, .ts_stmt_module => {
                                    // "namespace Foo {}"
                                    // "module Foo {}"
                                    // "declare module 'fs' {}"
                                    // "declare module 'fs';"
                                    if (((opts.is_module_scope or opts.is_namespace_scope) and (p.lexer.token == .t_identifier or
                                        (p.lexer.token == .t_string_literal and opts.is_typescript_declare))))
                                    {
                                        return p.parseTypescriptNamespaceTmt(loc, opts);
                                    }
                                },
                                .ts_stmt_interface => {
                                    // "interface Foo {}"
                                    var stmtOpts = ParseStatementOptions{ .is_module_scope = opts.is_module_scope };

                                    p.skipTypeScriptInterfaceStmt(&stmtOpts);
                                    return p.s(S.TypeScript{}, loc);
                                },
                                .ts_stmt_abstract => {
                                    if (p.lexer.token == .t_class or opts.ts_decorators != null) {
                                        return try p.parseClassStmt(loc, opts);
                                    }
                                },
                                .ts_stmt_global => {
                                    // "declare module 'fs' { global { namespace NodeJS {} } }"
                                    if (opts.is_namespace_scope and opts.is_typescript_declare and p.lexer.token == .t_open_brace) {
                                        try p.lexer.next();
                                        _ = try p.parseStmtsUpTo(.t_close_brace, opts);
                                        try p.lexer.next();
                                        return p.s(S.TypeScript{}, loc);
                                    }
                                },
                                .ts_stmt_declare => {
                                    opts.lexical_decl = .allow_all;
                                    opts.is_typescript_declare = true;

                                    // "@decorator declare class Foo {}"
                                    // "@decorator declare abstract class Foo {}"
                                    if (opts.ts_decorators != null and p.lexer.token != .t_class and !p.lexer.isContextualKeyword("abstract")) {
                                        try p.lexer.expected(.t_class);
                                    }

                                    // "declare global { ... }"
                                    if (p.lexer.isContextualKeyword("global")) {
                                        try p.lexer.next();
                                        try p.lexer.expect(.t_open_brace);
                                        _ = try p.parseStmtsUpTo(.t_close_brace, opts);
                                        try p.lexer.next();
                                        return p.s(S.TypeScript{}, loc);
                                    }

                                    // "declare const x: any"
                                    const stmt = try p.parseStmt(opts);
                                    if (opts.ts_decorators) |decs| {
                                        p.discardScopesUpTo(decs.scope_index);
                                    }

                                    // Unlike almost all uses of "declare", statements that use
                                    // "export declare" with "var/let/const" inside a namespace affect
                                    // code generation. They cause any declared bindings to be
                                    // considered exports of the namespace. Identifier references to
                                    // those names must be converted into property accesses off the
                                    // namespace object:
                                    //
                                    //   namespace ns {
                                    //     export declare const x
                                    //     export function y() { return x }
                                    //   }
                                    //
                                    //   (ns as any).x = 1
                                    //   console.log(ns.y())
                                    //
                                    // In this example, "return x" must be replaced with "return ns.x".
                                    // This is handled by replacing each "export declare" statement
                                    // inside a namespace with an "export var" statement containing all
                                    // of the declared bindings. That "export var" statement will later
                                    // cause identifiers to be transformed into property accesses.
                                    if (opts.is_namespace_scope and opts.is_export) {
                                        var decls: []G.Decl = &([_]G.Decl{});
                                        switch (stmt.data) {
                                            .s_local => |local| {
                                                var _decls = try List(G.Decl).initCapacity(p.allocator, local.decls.len);
                                                for (local.decls) |decl| {
                                                    try extractDeclsForBinding(decl.binding, &_decls);
                                                }
                                                decls = _decls.toOwnedSlice();
                                            },
                                            else => {},
                                        }

                                        if (decls.len > 0) {
                                            return p.s(S.Local{
                                                .kind = .k_var,
                                                .is_export = true,
                                                .decls = decls,
                                            }, loc);
                                        }
                                    }

                                    return p.s(S.TypeScript{}, loc);
                                },
                            }
                        }
                    }
                }
                // Output.print("\n\nmVALUE {s}:{s}\n", .{ expr, name });
                try p.lexer.expectOrInsertSemicolon();
                return p.s(S.SExpr{ .value = expr }, loc);
            },
        }

        return js_ast.Stmt.empty();
    }

    pub fn discardScopesUpTo(p: *P, scope_index: usize) void {
        // Remove any direct children from their parent
        var scope = p.current_scope;
        var children = scope.children;

        for (p.scopes_in_order.items[scope_index..]) |_child| {
            const child = _child orelse continue;

            if (child.scope.parent == p.current_scope) {
                var i: usize = children.items.len - 1;
                while (i >= 0) {
                    if (children.items[i] == child.scope) {
                        _ = children.orderedRemove(i);
                        break;
                    }
                    i -= 1;
                }
            }
        }

        // Truncate the scope order where we started to pretend we never saw this scope
        p.scopes_in_order.shrinkRetainingCapacity(scope_index);
    }

    pub fn skipTypescriptTypeStmt(p: *P, opts: *ParseStatementOptions) void {
        notimpl();
    }

    pub fn parseTypescriptNamespaceTmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) Stmt {
        notimpl();
    }

    pub fn skipTypeScriptInterfaceStmt(p: *P, opts: *ParseStatementOptions) void {
        notimpl();
    }

    pub fn parseTypeScriptImportEqualsStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions, default_name_loc: logger.Loc, default_name: string) Stmt {
        notimpl();
    }

    pub fn parseClauseAlias(p: *P, kind: string) !string {
        const loc = p.lexer.loc();

        // The alias may now be a string (see https://github.com/tc39/ecma262/pull/2154)
        if (p.lexer.token == .t_string_literal) {
            if (p.lexer.string_literal_is_ascii) {
                return p.lexer.string_literal_slice;
            } else if (p.lexer.utf16ToStringWithValidation(p.lexer.string_literal)) |alias| {
                return alias;
            } else |err| {
                const r = p.source.rangeOfString(loc);
                // TODO: improve error message
                try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Invalid {s} alias because it contains an unpaired Unicode surrogate (like emoji)", .{kind});
                return p.source.textForRange(r);
            }
        }

        // The alias may be a keyword
        if (!p.lexer.isIdentifierOrKeyword()) {
            try p.lexer.expect(.t_identifier);
        }

        const alias = p.lexer.identifier;
        p.checkForNonBMPCodePoint(loc, alias);
        return alias;
    }

    pub fn parseImportClause(
        p: *P,
    ) !ImportClause {
        var items = List(js_ast.ClauseItem).init(p.allocator);
        try p.lexer.expect(.t_open_brace);
        var is_single_line = !p.lexer.has_newline_before;

        while (p.lexer.token != .t_close_brace) {
            // The alias may be a keyword;
            const isIdentifier = p.lexer.token == .t_identifier;
            const alias_loc = p.lexer.loc();
            const alias = try p.parseClauseAlias("import");
            var name = LocRef{ .loc = alias_loc, .ref = try p.storeNameInRef(alias) };
            var original_name = alias;
            try p.lexer.next();

            if (p.lexer.isContextualKeyword("as")) {
                try p.lexer.next();
                original_name = p.lexer.identifier;
                name = LocRef{ .loc = alias_loc, .ref = try p.storeNameInRef(original_name) };
                try p.lexer.expect(.t_identifier);
            } else if (!isIdentifier) {
                // An import where the name is a keyword must have an alias
                try p.lexer.expectedString("\"as\"");
            }

            // Reject forbidden names
            if (isEvalOrArguments(original_name)) {
                const r = js_lexer.rangeOfIdentifier(p.source, name.loc);
                try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot use \"{s}\" as an identifier here", .{original_name});
            }

            try items.append(js_ast.ClauseItem{
                .alias = alias,
                .alias_loc = alias_loc,
                .name = name,
                .original_name = original_name,
            });

            if (p.lexer.token != .t_comma) {
                break;
            }

            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }

            try p.lexer.next();

            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }
        }

        if (p.lexer.has_newline_before) {
            is_single_line = false;
        }

        try p.lexer.expect(.t_close_brace);
        return ImportClause{ .items = items.toOwnedSlice(), .is_single_line = is_single_line };
    }

    pub fn forbidInitializers(p: *P, decls: []G.Decl, loop_type: string, is_var: bool) !void {
        if (decls.len > 1) {
            try p.log.addErrorFmt(p.source, decls[0].binding.loc, p.allocator, "for-{s} loops must have a single declaration", .{loop_type});
        } else if (decls.len == 1) {
            if (decls[0].value) |value| {
                if (is_var) {

                    // This is a weird special case. Initializers are allowed in "var"
                    // statements with identifier bindings.
                    return;
                }

                try p.log.addErrorFmt(p.source, value.loc, p.allocator, "for-{s} loop variables cannot have an initializer", .{loop_type});
            }
        }
    }

    pub fn parseExprOrLetStmt(p: *P, opts: *ParseStatementOptions) !ExprOrLetStmt {
        var let_range = p.lexer.range();
        var raw = p.lexer.raw();
        if (p.lexer.token != .t_identifier or !strings.eql(raw, "let")) {
            // Output.print("HI", .{});
            return ExprOrLetStmt{ .stmt_or_expr = js_ast.StmtOrExpr{ .expr = try p.parseExpr(.lowest) } };
        }

        try p.lexer.next();

        switch (p.lexer.token) {
            .t_identifier, .t_open_bracket, .t_open_brace => {
                if (opts.lexical_decl == .allow_all or !p.lexer.has_newline_before or p.lexer.token == .t_open_bracket) {
                    if (opts.lexical_decl != .allow_all) {
                        try p.forbidLexicalDecl(let_range.loc);
                    }

                    const decls = try p.parseAndDeclareDecls(.other, opts);
                    return ExprOrLetStmt{
                        .stmt_or_expr = js_ast.StmtOrExpr{
                            .stmt = p.s(S.Local{
                                .kind = .k_let,
                                .decls = decls,
                                .is_export = opts.is_export,
                            }, let_range.loc),
                        },
                        .decls = decls,
                    };
                }
            },
            else => {},
        }

        const ref = p.storeNameInRef(raw) catch unreachable;
        const expr = p.e(E.Identifier{ .ref = ref }, let_range.loc);
        return ExprOrLetStmt{ .stmt_or_expr = js_ast.StmtOrExpr{ .expr = try p.parseSuffix(expr, .lowest, null, Expr.EFlags.none) } };
    }

    pub fn requireInitializers(p: *P, decls: []G.Decl) !void {
        for (decls) |decl| {
            if (decl.value == null) {
                switch (decl.binding.data) {
                    .b_identifier => |ident| {
                        const r = js_lexer.rangeOfIdentifier(p.source, decl.binding.loc);
                        try p.log.addRangeErrorFmt(p.source, r, p.allocator, "The constant \"{s}\" must be initialized", .{p.symbols.items[ident.ref.inner_index].original_name});
                        // return;/
                    },
                    else => {
                        try p.log.addError(p.source, decl.binding.loc, "This constant must be initialized");
                    },
                }
            }
        }
    }

    pub fn parseBinding(p: *P) anyerror!Binding {
        var loc = p.lexer.loc();

        switch (p.lexer.token) {
            .t_identifier => {
                const name = p.lexer.identifier;
                if ((p.fn_or_arrow_data_parse.allow_await != .allow_ident and strings.eqlComptime(name, "await")) or (p.fn_or_arrow_data_parse.allow_yield != .allow_ident and strings.eqlComptime(name, "yield"))) {
                    // TODO: add fmt to addRangeError
                    p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"yield\" or \"await\" here.") catch unreachable;
                }

                const ref = p.storeNameInRef(name) catch unreachable;
                try p.lexer.next();
                return p.b(B.Identifier{ .ref = ref }, loc);
            },
            .t_open_bracket => {
                try p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                var items = List(js_ast.ArrayBinding).init(p.allocator);
                var has_spread = false;

                // "in" expressions are allowed
                var old_allow_in = p.allow_in;
                p.allow_in = true;

                while (p.lexer.token != .t_close_bracket) {
                    if (p.lexer.token == .t_comma) {
                        items.append(js_ast.ArrayBinding{
                            .binding = Binding{ .data = Prefill.Data.BMissing, .loc = p.lexer.loc() },
                        }) catch unreachable;
                    } else {
                        if (p.lexer.token == .t_dot_dot_dot) {
                            try p.lexer.next();
                            has_spread = true;

                            // This was a bug in the ES2015 spec that was fixed in ES2016
                            if (p.lexer.token != .t_identifier) {
                                // p.markSyntaxFeature(compat.NestedRestBinding, p.lexer.Range())

                            }
                        }

                        const binding = try p.parseBinding();

                        var default_value: ?Expr = null;
                        if (!has_spread and p.lexer.token == .t_equals) {
                            try p.lexer.next();
                            default_value = try p.parseExpr(.comma);
                        }

                        items.append(js_ast.ArrayBinding{ .binding = binding, .default_value = default_value }) catch unreachable;

                        // Commas after spread elements are not allowed
                        if (has_spread and p.lexer.token == .t_comma) {
                            p.log.addRangeError(p.source, p.lexer.range(), "Unexpected \",\" after rest pattern") catch unreachable;
                            fail();
                        }
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.next();

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }

                p.allow_in = old_allow_in;

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
                try p.lexer.expect(.t_close_bracket);
                return p.b(B.Array{
                    .items = items.toOwnedSlice(),
                    .has_spread = has_spread,
                    .is_single_line = is_single_line,
                }, loc);
            },
            .t_open_brace => {
                // p.markSyntaxFeature(compat.Destructuring, p.lexer.Range())
                try p.lexer.next();
                var is_single_line = false;
                var properties = List(js_ast.B.Property).init(p.allocator);

                // "in" expressions are allowed
                var old_allow_in = p.allow_in;
                p.allow_in = true;

                while (p.lexer.token != .t_close_brace) {
                    var property = try p.parsePropertyBinding();
                    properties.append(property) catch unreachable;

                    // Commas after spread elements are not allowed
                    if (property.flags.is_spread and p.lexer.token == .t_comma) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Unexpected \",\" after rest pattern") catch unreachable;
                        fail();
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.next();
                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }

                p.allow_in = old_allow_in;

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
                try p.lexer.expect(.t_close_brace);

                return p.b(B.Object{
                    .properties = properties.toOwnedSlice(),
                    .is_single_line = is_single_line,
                }, loc);
            },
            else => {},
        }

        try p.lexer.expect(.t_identifier);
        return Binding{ .loc = loc, .data = Prefill.Data.BMissing };
    }

    pub fn parsePropertyBinding(p: *P) anyerror!B.Property {
        var key: js_ast.Expr = Expr{ .loc = logger.Loc.Empty, .data = Prefill.Data.EMissing };
        var is_computed = false;

        switch (p.lexer.token) {
            .t_dot_dot_dot => {
                try p.lexer.next();
                const value = p.b(B.Identifier{
                    .ref = p.storeNameInRef(p.lexer.identifier) catch unreachable,
                }, p.lexer.loc());
                try p.lexer.expect(.t_identifier);
                return B.Property{
                    // This "key" diverges from esbuild, but is due to Go always having a zero value.
                    .key = Expr{ .data = Prefill.Data.EMissing, .loc = logger.Loc{} },

                    .flags = Flags.Property{ .is_spread = true },
                    .value = value,
                };
            },
            .t_numeric_literal => {
                key = p.e(E.Number{
                    .value = p.lexer.number,
                }, p.lexer.loc());
                // check for legacy octal literal
                try p.lexer.next();
            },
            .t_string_literal => {
                key = try p.parseStringLiteral();
            },
            .t_big_integer_literal => {
                key = p.e(E.BigInt{
                    .value = p.lexer.identifier,
                }, p.lexer.loc());
                // p.markSyntaxFeature(compat.BigInt, p.lexer.Range())
                try p.lexer.next();
            },
            .t_open_bracket => {
                is_computed = true;
                try p.lexer.next();
                key = try p.parseExpr(.comma);
                try p.lexer.expect(.t_close_bracket);
            },
            else => {
                const name = p.lexer.identifier;
                const loc = p.lexer.loc();

                const e_str = p.lexer.toEString();

                if (!p.lexer.isIdentifierOrKeyword()) {
                    try p.lexer.expect(.t_identifier);
                }

                try p.lexer.next();

                const ref = p.storeNameInRef(name) catch unreachable;

                key = p.e(e_str, loc);

                if (p.lexer.token != .t_colon and p.lexer.token != .t_open_paren) {
                    const value = p.b(B.Identifier{ .ref = ref }, loc);
                    var default_value: ?Expr = null;
                    if (p.lexer.token == .t_equals) {
                        try p.lexer.next();
                        default_value = try p.parseExpr(.comma);
                    }

                    return B.Property{
                        .key = key,
                        .value = value,
                        .default_value = default_value,
                    };
                }
            },
        }

        try p.lexer.expect(.t_colon);
        const value = try p.parseBinding();

        var default_value: ?Expr = null;
        if (p.lexer.token == .t_equals) {
            try p.lexer.next();
            default_value = try p.parseExpr(.comma);
        }

        return B.Property{
            .flags = Flags.Property{
                .is_computed = is_computed,
            },
            .key = key,
            .value = value,
            .default_value = default_value,
        };
    }

    pub fn parseAndDeclareDecls(p: *P, kind: Symbol.Kind, opts: *ParseStatementOptions) anyerror![]G.Decl {
        var decls = List(G.Decl).init(p.allocator);

        while (true) {
            // Forbid "let let" and "const let" but not "var let"
            if ((kind == .other or kind == .cconst) and p.lexer.isContextualKeyword("let")) {
                p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"let\" as an identifier here") catch unreachable;
            }

            var value: ?js_ast.Expr = null;
            var local = try p.parseBinding();
            p.declareBinding(kind, &local, opts) catch unreachable;

            // Skip over types
            if (p.options.ts) {
                // "let foo!"
                var is_definite_assignment_assertion = p.lexer.token == .t_exclamation;
                if (is_definite_assignment_assertion) {
                    try p.lexer.next();
                }

                // "let foo: number"
                if (is_definite_assignment_assertion or p.lexer.token == .t_colon) {
                    try p.lexer.expect(.t_colon);
                    p.skipTypescriptType(.lowest);
                }
            }

            if (p.lexer.token == .t_equals) {
                try p.lexer.next();
                value = try p.parseExpr(.comma);
            }

            decls.append(G.Decl{
                .binding = local,
                .value = value,
            }) catch unreachable;

            if (p.lexer.token != .t_comma) {
                break;
            }
            try p.lexer.next();
        }

        return decls.items;
    }

    pub fn parseTypescriptEnumStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) Stmt {
        notimpl();
        // return Stmt.empty();
    }

    pub fn parseExportClause(p: *P) !ExportClauseResult {
        var items = List(js_ast.ClauseItem).initCapacity(p.allocator, 1) catch unreachable;
        try p.lexer.expect(.t_open_brace);
        var is_single_line = !p.lexer.has_newline_before;
        var first_non_identifier_loc = logger.Loc{ .start = 0 };

        while (p.lexer.token != .t_close_brace) {
            var alias = try p.parseClauseAlias("export");
            var alias_loc = p.lexer.loc();

            var name = LocRef{
                .loc = alias_loc,
                .ref = p.storeNameInRef(alias) catch unreachable,
            };
            var original_name = alias;

            // The name can actually be a keyword if we're really an "export from"
            // statement. However, we won't know until later. Allow keywords as
            // identifiers for now and throw an error later if there's no "from".
            //
            //   // This is fine
            //   export { default } from 'path'
            //
            //   // This is a syntax error
            //   export { default }
            //
            if (p.lexer.token != .t_identifier and first_non_identifier_loc.start == 0) {
                first_non_identifier_loc = p.lexer.loc();
            }
            try p.lexer.next();

            if (p.lexer.isContextualKeyword("as")) {
                try p.lexer.next();
                alias = try p.parseClauseAlias("export");
                alias_loc = p.lexer.loc();

                try p.lexer.next();
            }

            items.append(js_ast.ClauseItem{
                .alias = alias,
                .alias_loc = alias_loc,
                .name = name,
                .original_name = original_name,
            }) catch unreachable;

            // we're done if there's no comma
            if (p.lexer.token != .t_comma) {
                break;
            }

            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }
            try p.lexer.next();
            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }
        }

        if (p.lexer.has_newline_before) {
            is_single_line = false;
        }
        try p.lexer.expect(.t_close_brace);

        // Throw an error here if we found a keyword earlier and this isn't an
        // "export from" statement after all
        if (first_non_identifier_loc.start != 0 and !p.lexer.isContextualKeyword("from")) {
            const r = js_lexer.rangeOfIdentifier(p.source, first_non_identifier_loc);
            try p.lexer.addRangeError(r, "Expected identifier but found \"{s}\"", .{p.source.textForRange(r)}, true);
        }

        return ExportClauseResult{
            .clauses = items.items,
            .is_single_line = is_single_line,
        };
    }

    pub fn parsePath(p: *P) !ParsedPath {
        var path = ParsedPath{
            .loc = p.lexer.loc(),
            .text = p.lexer.string_literal_slice,
        };

        if (p.lexer.token == .t_no_substitution_template_literal) {
            try p.lexer.next();
        } else {
            try p.lexer.expect(.t_string_literal);
        }

        return path;
    }

    // TODO:
    pub fn checkForNonBMPCodePoint(p: *P, loc: logger.Loc, name: string) void {}

    pub fn parseStmtsUpTo(p: *P, eend: js_lexer.T, _opts: *ParseStatementOptions) ![]Stmt {
        var opts = _opts.*;
        var stmts = StmtList.init(p.allocator);

        var returnWithoutSemicolonStart: i32 = -1;
        opts.lexical_decl = .allow_all;
        var isDirectivePrologue = true;

        run: while (true) {
            for (p.lexer.comments_to_preserve_before.items) |comment| {
                try stmts.append(p.s(S.Comment{
                    .text = comment.text,
                }, p.lexer.loc()));
            }

            if (p.lexer.token == eend) {
                break;
            }

            var current_opts = opts;
            var stmt = try p.parseStmt(&current_opts);

            // Skip TypeScript types entirely
            if (p.options.ts) {
                switch (stmt.data) {
                    .s_type_script => {
                        continue;
                    },
                    else => {},
                }
            }

            // Parse one or more directives at the beginning
            if (isDirectivePrologue) {
                isDirectivePrologue = false;
                switch (stmt.data) {
                    .s_expr => |expr| {
                        switch (expr.value.data) {
                            .e_string => |str| {
                                if (!str.prefer_template) {
                                    stmt.data = Stmt.Data{
                                        .s_directive = p.m(S.Directive{
                                            .value = str.value,
                                            // .legacy_octal_loc = str.legacy_octal_loc,
                                        }),
                                    };
                                    isDirectivePrologue = true;

                                    if (strings.eqlUtf16("use strict", str.value)) {
                                        // Track "use strict" directives
                                        p.current_scope.strict_mode = .explicit_strict_mode;
                                    } else if (strings.eqlUtf16("use asm", str.value)) {
                                        stmt.data = Prefill.Data.SEmpty;
                                    }
                                }
                            },
                            else => {},
                        }
                    },
                    else => {},
                }
            }

            try stmts.append(stmt);

            // Warn about ASI and return statements. Here's an example of code with
            // this problem: https://github.com/rollup/rollup/issues/3729
            if (!p.options.suppress_warnings_about_weird_code) {
                var needsCheck = true;
                switch (stmt.data) {
                    .s_return => |ret| {
                        if (ret.value == null and !p.latest_return_had_semicolon) {
                            returnWithoutSemicolonStart = stmt.loc.start;
                            needsCheck = false;
                        }
                    },
                    else => {},
                }

                if (needsCheck and returnWithoutSemicolonStart != -1) {
                    switch (stmt.data) {
                        .s_expr => |exp| {
                            try p.log.addWarning(
                                p.source,
                                logger.Loc{ .start = returnWithoutSemicolonStart + 6 },
                                "The following expression is not returned because of an automatically-inserted semicolon",
                            );
                        },
                        else => {},
                    }

                    returnWithoutSemicolonStart = -1;
                }
            }
        }

        return stmts.toOwnedSlice();
    }

    pub fn markStrictModeFeature(p: *P, feature: StrictModeFeature, r: logger.Range, detail: string) !void {
        var text: string = undefined;
        var can_be_transformed = false;
        switch (feature) {
            .with_statement => {
                text = "With statements";
            },
            .delete_bare_name => {
                text = "\"delete\" of a bare identifier";
            },
            .for_in_var_init => {
                text = "Variable initializers within for-in loops";
                can_be_transformed = true;
            },
            .eval_or_arguments => {
                text = try std.fmt.allocPrint(p.allocator, "Declarations with the name {s}", .{detail});
            },
            .reserved_word => {
                text = try std.fmt.allocPrint(p.allocator, "{s} is a reserved word and", .{detail});
            },
            .legacy_octal_literal => {
                text = "Legacy octal literals";
            },
            .legacy_octal_escape => {
                text = "Legacy octal escape sequences";
            },
            .if_else_function_stmt => {
                text = "Function declarations inside if statements";
            },
            // else => {
            //     text = "This feature";
            // },
        }

        var scope = p.current_scope;
        if (p.isStrictMode()) {
            var why: string = "";
            var notes: []logger.Data = &[_]logger.Data{};
            var where: logger.Range = logger.Range.None;
            switch (scope.strict_mode) {
                .implicit_strict_mode_import => {
                    where = p.es6_import_keyword;
                },
                .implicit_strict_mode_export => {
                    where = p.es6_export_keyword;
                },
                .implicit_strict_mode_top_level_await => {
                    where = p.top_level_await_keyword;
                },
                .implicit_strict_mode_class => {
                    why = "All code inside a class is implicitly in strict mode";
                    where = p.enclosing_class_keyword;
                },
                else => {},
            }
            if (why.len == 0) {
                why = try std.fmt.allocPrint(p.allocator, "This file is implicitly in strict mode because of the \"{s}\" keyword here", .{p.source.textForRange(where)});
            }

            try p.log.addRangeErrorWithNotes(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} cannot be used in strict mode", .{text}), &([_]logger.Data{logger.rangeData(p.source, where, why)}));
        } else if (!can_be_transformed and p.isStrictModeOutputFormat()) {
            try p.log.addRangeError(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} cannot be used with \"esm\" due to strict mode", .{text}));
        }
    }

    pub fn isStrictMode(p: *P) bool {
        return p.current_scope.strict_mode != .sloppy_mode;
    }

    pub fn isStrictModeOutputFormat(p: *P) bool {
        return true;
    }

    pub fn declareCommonJSSymbol(p: *P, kind: Symbol.Kind, name: string) !Ref {
        const member = p.module_scope.members.get(name);

        // If the code declared this symbol using "var name", then this is actually
        // not a collision. For example, node will let you do this:
        //
        //   var exports;
        //   module.exports.foo = 123;
        //   console.log(exports.foo);
        //
        // This works because node's implementation of CommonJS wraps the entire
        // source file like this:
        //
        //   (function(require, exports, module, __filename, __dirname) {
        //     var exports;
        //     module.exports.foo = 123;
        //     console.log(exports.foo);
        //   })
        //
        // Both the "exports" argument and "var exports" are hoisted variables, so
        // they don't collide.
        if (member) |_member| {
            if (p.symbols.items[_member.ref.inner_index].kind == .hoisted and kind == .hoisted and !p.has_es_module_syntax) {
                return _member.ref;
            }
        }

        // Create a new symbol if we didn't merge with an existing one above
        const ref = try p.newSymbol(kind, name);

        if (member == null) {
            try p.module_scope.members.put(name, Scope.Member{ .ref = ref, .loc = logger.Loc.Empty });
            return ref;
        }

        // If the variable was declared, then it shadows this symbol. The code in
        // this module will be unable to reference this symbol. However, we must
        // still add the symbol to the scope so it gets minified (automatically-
        // generated code may still reference the symbol).
        try p.module_scope.generated.append(ref);
        return ref;
    }

    pub fn declareSymbol(p: *P, kind: Symbol.Kind, loc: logger.Loc, name: string) !Ref {
        // p.checkForNonBMPCodePoint(loc, name)

        // Forbid declaring a symbol with a reserved word in strict mode
        if (p.isStrictMode() and js_lexer.StrictModeReservedWords.has(name)) {
            try p.markStrictModeFeature(.reserved_word, js_lexer.rangeOfIdentifier(p.source, loc), name);
        }

        // Allocate a new symbol
        var ref = try p.newSymbol(kind, name);

        const scope = p.current_scope;
        if (scope.members.get(name)) |existing| {
            var symbol: Symbol = p.symbols.items[@intCast(usize, existing.ref.inner_index)];

            switch (p.canMergeSymbols(scope, symbol.kind, kind)) {
                .forbidden => {
                    const r = js_lexer.rangeOfIdentifier(p.source, loc);
                    var notes: []logger.Data = &[_]logger.Data{};
                    notes = &([_]logger.Data{logger.rangeData(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} has already been declared", .{name}))});
                    try p.log.addRangeErrorWithNotes(p.source, r, try std.fmt.allocPrint(p.allocator, "{s} was originally declared here", .{name}), notes);
                    return existing.ref;
                },
                .keep_existing => {
                    ref = existing.ref;
                },
                .replace_with_new => {
                    symbol.link = ref;
                },
                .become_private_get_set_pair => {
                    ref = existing.ref;
                    symbol.kind = .private_get_set_pair;
                },
                .become_private_static_get_set_pair => {
                    ref = existing.ref;
                    symbol.kind = .private_static_get_set_pair;
                },

                .overwrite_with_new => {},
                // else => unreachable,
            }
        }

        try scope.members.put(name, js_ast.Scope.Member{ .ref = ref, .loc = loc });
        return ref;
    }

    pub fn validateFunctionName(p: *P, func: G.Fn, kind: FunctionKind) void {
        if (func.name) |name| {
            const original_name = p.symbols.items[name.ref.?.inner_index].original_name;

            if (func.flags.is_async and strings.eql(original_name, "await")) {
                p.log.addRangeError(
                    p.source,
                    js_lexer.rangeOfIdentifier(p.source, name.loc),
                    "An async function cannot be named \"await\"",
                ) catch unreachable;
            } else if (kind == .expr and func.flags.is_generator and strings.eql(original_name, "yield")) {
                p.log.addRangeError(
                    p.source,
                    js_lexer.rangeOfIdentifier(p.source, name.loc),
                    "An generator function expression cannot be named \"yield\"",
                ) catch unreachable;
            }
        }
    }

    pub fn parseFnExpr(p: *P, loc: logger.Loc, is_async: bool, async_range: logger.Range) !Expr {
        try p.lexer.next();
        const is_generator = p.lexer.token == T.t_asterisk;
        if (is_generator) {
            // p.markSyntaxFeature()
            try p.lexer.next();
        } else if (is_async) {
            // p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
        }

        var name: ?js_ast.LocRef = null;

        _ = p.pushScopeForParsePass(.function_args, loc) catch unreachable;

        // The name is optional
        if (p.lexer.token == .t_identifier) {
            // Don't declare the name "arguments" since it's shadowed and inaccessible
            var _name = js_ast.LocRef{
                .loc = p.lexer.loc(),
                .ref = null,
            };

            const text = p.lexer.identifier;
            if (text.len > 0 and !strings.eql(text, "arguments")) {
                _name.ref = try p.declareSymbol(.hoisted_function, _name.loc, text);
            } else {
                _name.ref = try p.newSymbol(.hoisted_function, text);
            }
            debug("FUNC NAME {s}", .{p.lexer.identifier});
            name = _name;
            try p.lexer.next();
        }

        // Even anonymous functions can have TypeScript type parameters
        if (p.options.ts) {
            p.skipTypescriptTypeParameters();
        }

        var func = try p.parseFn(name, FnOrArrowDataParse{
            .async_range = async_range,
            .allow_await = if (is_async) .allow_expr else .allow_ident,
            .allow_yield = if (is_generator) .allow_expr else .allow_ident,
        });

        p.validateFunctionName(func, .expr);
        p.popScope();

        return p.e(js_ast.E.Function{
            .func = func,
        }, loc);
    }

    pub fn parseFnBody(p: *P, data: *FnOrArrowDataParse) !G.FnBody {
        var oldFnOrArrowData = p.fn_or_arrow_data_parse;
        var oldAllowIn = p.allow_in;
        p.fn_or_arrow_data_parse = data.*;
        p.allow_in = true;

        const loc = p.lexer.loc();
        _ = try p.pushScopeForParsePass(Scope.Kind.function_body, p.lexer.loc());
        defer p.popScope();

        try p.lexer.expect(.t_open_brace);
        var opts = ParseStatementOptions{};
        const stmts = try p.parseStmtsUpTo(.t_close_brace, &opts);
        try p.lexer.next();

        p.allow_in = oldAllowIn;
        p.fn_or_arrow_data_parse = oldFnOrArrowData;
        return G.FnBody{ .loc = loc, .stmts = stmts };
    }

    pub fn parseArrowBody(p: *P, args: []js_ast.G.Arg, data: *FnOrArrowDataParse) !E.Arrow {
        var arrow_loc = p.lexer.loc();

        // Newlines are not allowed before "=>"
        if (p.lexer.has_newline_before) {
            try p.log.addRangeError(p.source, p.lexer.range(), "Unexpected newline before \"=>\"");
            fail();
        }

        try p.lexer.expect(T.t_equals_greater_than);

        for (args) |*arg| {
            var opts = ParseStatementOptions{};
            try p.declareBinding(Symbol.Kind.hoisted, &arg.binding, &opts);
        }

        // The ability to call "super()" is inherited by arrow functions
        data.allow_super_call = p.fn_or_arrow_data_parse.allow_super_call;

        if (p.lexer.token == .t_open_brace) {
            var body = try p.parseFnBody(data);
            p.after_arrow_body_loc = p.lexer.loc();
            return E.Arrow{ .args = args, .body = body };
        }

        _ = try p.pushScopeForParsePass(Scope.Kind.function_body, arrow_loc);
        defer p.popScope();

        var old_fn_or_arrow_data = p.fn_or_arrow_data_parse;

        p.fn_or_arrow_data_parse = data.*;
        var expr = try p.parseExpr(Level.comma);
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        var stmts = try p.allocator.alloc(Stmt, 1);
        stmts[0] = p.s(S.Return{ .value = expr }, expr.loc);
        return E.Arrow{ .args = args, .prefer_expr = true, .body = G.FnBody{ .loc = arrow_loc, .stmts = stmts } };
    }

    pub fn declareBinding(p: *P, kind: Symbol.Kind, binding: *BindingNodeIndex, opts: *ParseStatementOptions) !void {
        switch (binding.data) {
            .b_missing => {},
            .b_identifier => |bind| {
                if (!opts.is_typescript_declare or (opts.is_namespace_scope and opts.is_export)) {
                    bind.ref = try p.declareSymbol(kind, binding.loc, p.loadNameFromRef(bind.ref));
                }
            },

            .b_array => |bind| {
                for (bind.items) |item, i| {
                    p.declareBinding(kind, &bind.items[i].binding, opts) catch unreachable;
                }
            },

            .b_object => |bind| {
                for (bind.properties) |*prop| {
                    p.declareBinding(kind, &prop.value, opts) catch unreachable;
                }
            },

            else => {
                // @compileError("Missing binding type");
            },
        }
    }

    // This is where the allocate memory to the heap for AST objects.
    // This is a short name to keep the code more readable.
    // It also swallows errors, but I think that's correct here.
    // We can handle errors via the log.
    // We'll have to deal with @wasmHeapGrow or whatever that thing is.
    pub fn mm(self: *P, comptime ast_object_type: type, instance: anytype) callconv(.Inline) *ast_object_type {
        var obj = self.allocator.create(ast_object_type) catch unreachable;
        obj.* = instance;
        return obj;
    }

    // mmmm memmory allocation
    pub fn m(self: *P, kind: anytype) callconv(.Inline) *@TypeOf(kind) {
        return self.mm(@TypeOf(kind), kind);
    }

    pub fn storeNameInRef(p: *P, name: string) !js_ast.Ref {
        if (@ptrToInt(p.source.contents.ptr) <= @ptrToInt(name.ptr) and (@ptrToInt(name.ptr) + name.len) <= (@ptrToInt(p.source.contents.ptr) + p.source.contents.len)) {
            const start = Ref.toInt(@ptrToInt(name.ptr) - @ptrToInt(p.source.contents.ptr));
            const end = Ref.toInt(name.len);
            return js_ast.Ref{ .source_index = start, .inner_index = end, .is_source_contents_slice = true };
        } else if (p.allocated_names.capacity > 0) {
            const inner_index = Ref.toInt(p.allocated_names.items.len);
            try p.allocated_names.append(name);
            return js_ast.Ref{ .source_index = std.math.maxInt(Ref.Int), .inner_index = inner_index };
        } else {
            p.allocated_names = try @TypeOf(p.allocated_names).initCapacity(p.allocator, 1);
            p.allocated_names.appendAssumeCapacity(name);
            return js_ast.Ref{ .source_index = std.math.maxInt(Ref.Int), .inner_index = 0 };
        }
    }

    pub fn loadNameFromRef(p: *P, ref: js_ast.Ref) string {
        if (ref.is_source_contents_slice) {
            return p.source.contents[ref.source_index .. ref.source_index + ref.inner_index];
        } else if (ref.source_index == std.math.maxInt(Ref.Int)) {
            assert(ref.inner_index < p.allocated_names.items.len);
            return p.allocated_names.items[ref.inner_index];
        } else {
            return p.symbols.items[ref.inner_index].original_name;
        }
    }

    // This parses an expression. This assumes we've already parsed the "async"
    // keyword and are currently looking at the following token.
    pub fn parseAsyncPrefixExpr(p: *P, async_range: logger.Range, level: Level) !Expr {
        // "async function() {}"
        if (!p.lexer.has_newline_before and p.lexer.token == T.t_function) {
            return try p.parseFnExpr(async_range.loc, true, async_range);
        }

        // Check the precedence level to avoid parsing an arrow function in
        // "new async () => {}". This also avoids parsing "new async()" as
        // "new (async())()" instead.
        if (!p.lexer.has_newline_before and level.lt(.member)) {
            switch (p.lexer.token) {
                // "async => {}"
                .t_equals_greater_than => {
                    if (level.lte(.assign)) {
                        var args = try p.allocator.alloc(G.Arg, 1);
                        args[0] = G.Arg{ .binding = p.b(
                            B.Identifier{
                                .ref = try p.storeNameInRef("async"),
                            },
                            async_range.loc,
                        ) };
                        _ = p.pushScopeForParsePass(.function_args, async_range.loc) catch unreachable;
                        var data = FnOrArrowDataParse{};
                        var arrow_body = try p.parseArrowBody(args, &data);
                        p.popScope();
                        return p.e(arrow_body, async_range.loc);
                    }
                },
                // "async x => {}"
                .t_identifier => {
                    if (level.lte(.assign)) {
                        // p.markLoweredSyntaxFeature();
                        const ref = try p.storeNameInRef(p.lexer.identifier);
                        var args = try p.allocator.alloc(G.Arg, 1);
                        args[0] = G.Arg{ .binding = p.b(
                            B.Identifier{
                                .ref = ref,
                            },
                            async_range.loc,
                        ) };
                        try p.lexer.next();

                        _ = try p.pushScopeForParsePass(.function_args, async_range.loc);
                        defer p.popScope();

                        var data = FnOrArrowDataParse{
                            .allow_await = .allow_expr,
                        };
                        var arrowBody = try p.parseArrowBody(args, &data);
                        arrowBody.is_async = true;
                        return p.e(arrowBody, async_range.loc);
                    }
                },

                // "async()"
                // "async () => {}"
                .t_open_paren => {
                    try p.lexer.next();
                    return p.parseParenExpr(async_range.loc, level, ParenExprOpts{ .is_async = true, .async_range = async_range });
                },

                // "async<T>()"
                // "async <T>() => {}"
                .t_less_than => {
                    if (p.options.ts and p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking()) {
                        try p.lexer.next();
                        return p.parseParenExpr(async_range.loc, level, ParenExprOpts{ .is_async = true, .async_range = async_range });
                    }
                },

                else => {},
            }
        }

        // "async"
        // "async + 1"
        return p.e(
            E.Identifier{ .ref = try p.storeNameInRef("async") },
            async_range.loc,
        );
    }

    pub fn trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking(self: *P) bool {
        notimpl();
    }

    pub fn parseExprOrBindings(p: *P, level: Level, errors: ?*DeferredErrors) anyerror!Expr {
        return try p.parseExprCommon(level, errors, Expr.EFlags.none);
    }

    pub fn parseExpr(p: *P, level: Level) anyerror!Expr {
        return try p.parseExprCommon(level, null, Expr.EFlags.none);
    }

    pub fn parseExprWithFlags(p: *P, level: Level, flags: Expr.EFlags) anyerror!Expr {
        return try p.parseExprCommon(level, null, flags);
    }

    pub fn parseExprCommon(p: *P, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
        const had_pure_comment_before = p.lexer.has_pure_comment_before and !p.options.ignore_dce_annotations;
        var expr = try p.parsePrefix(level, errors, flags);

        // There is no formal spec for "__PURE__" comments but from reverse-
        // engineering, it looks like they apply to the next CallExpression or
        // NewExpression. So in "/* @__PURE__ */ a().b() + c()" the comment applies
        // to the expression "a().b()".

        if (had_pure_comment_before and level.lt(.call)) {
            expr = try p.parseSuffix(expr, @intToEnum(Level, @enumToInt(Level.call) - 1), errors, flags);
            switch (expr.data) {
                .e_call => |ex| {
                    ex.can_be_unwrapped_if_unused = true;
                },
                .e_new => |ex| {
                    ex.can_be_unwrapped_if_unused = true;
                },
                else => {},
            }
        }

        return try p.parseSuffix(expr, level, errors, flags);
    }

    pub fn addImportRecord(p: *P, kind: ImportKind, loc: logger.Loc, name: string) u32 {
        return p.addImportRecordByRange(kind, p.source.rangeOfString(loc), name);
    }

    pub fn addImportRecordByRange(p: *P, kind: ImportKind, range: logger.Range, name: string) u32 {
        var index = p.import_records.items.len;
        const record = ImportRecord{
            .kind = kind,
            .range = range,
            .path = fs.Path.init(name),
        };
        p.import_records.append(record) catch unreachable;
        return @intCast(u32, index);
    }

    pub fn popScope(p: *P) void {
        const current_scope = p.current_scope;
        // We cannot rename anything inside a scope containing a direct eval() call
        if (current_scope.contains_direct_eval) {
            var iter = current_scope.members.iterator();
            while (iter.next()) |member| {

                // Using direct eval when bundling is not a good idea in general because
                // esbuild must assume that it can potentially reach anything in any of
                // the containing scopes. We try to make it work but this isn't possible
                // in some cases.
                //
                // For example, symbols imported using an ESM import are a live binding
                // to the underlying symbol in another file. This is emulated during
                // scope hoisting by erasing the ESM import and just referencing the
                // underlying symbol in the flattened bundle directly. However, that
                // symbol may have a different name which could break uses of direct
                // eval:
                //
                //   // Before bundling
                //   import { foo as bar } from './foo.js'
                //   console.log(eval('bar'))
                //
                //   // After bundling
                //   let foo = 123 // The contents of "foo.js"
                //   console.log(eval('bar'))
                //
                // There really isn't any way to fix this. You can't just rename "foo" to
                // "bar" in the example above because there may be a third bundled file
                // that also contains direct eval and imports the same symbol with a
                // different conflicting import alias. And there is no way to store a
                // live binding to the underlying symbol in a variable with the import's
                // name so that direct eval can access it:
                //
                //   // After bundling
                //   let foo = 123 // The contents of "foo.js"
                //   const bar = /* cannot express a live binding to "foo" here */
                //   console.log(eval('bar'))
                //
                // Technically a "with" statement could potentially make this work (with
                // a big hit to performance), but they are deprecated and are unavailable
                // in strict mode. This is a non-starter since all ESM code is strict mode.
                //
                // So while we still try to obey the requirement that all symbol names are
                // pinned when direct eval is present, we make an exception for top-level
                // symbols in an ESM file when bundling is enabled. We make no guarantee
                // that "eval" will be able to reach these symbols and we allow them to be
                // renamed or removed by tree shaking.
                // if (p.currentScope.parent == null and p.has_es_module_syntax) {
                //     continue;
                // }

                p.symbols.items[member.value.ref.inner_index].must_not_be_renamed = true;
            }
        }

        p.current_scope = current_scope.parent orelse p.panic("Internal error: attempted to call popScope() on the topmost scope", .{});
    }

    pub fn markExprAsParenthesized(p: *P, expr: *Expr) void {
        switch (expr.data) {
            .e_array => |ex| {
                ex.is_parenthesized = true;
            },
            .e_object => |ex| {
                ex.is_parenthesized = true;
            },
            else => {
                return;
            },
        }
    }

    pub fn parseYieldExpr(p: *P, loc: logger.Loc) Expr {
        // Parse a yield-from expression, which yields from an iterator
        const isStar = p.lexer.token == T.t_asterisk;

        if (isStar) {
            if (p.lexer.has_newline_before) {
                try p.lexer.unexpected();
            }
            try p.lexer.next();
        }

        var value: ?ExprNodeIndex = null;
        switch (p.lexer.token) {
            .t_close_brace, .t_close_paren, .t_colon, .t_comma, .t_semicolon => {},
            else => {
                if (isStar or !p.lexer.has_newline_before) {
                    value = try p.parseExpr(.yield);
                }
            },
        }

        return p.e(E.Yield{
            .value = value,
            .is_star = isStar,
        }, loc);
    }

    pub fn parseProperty(p: *P, kind: Property.Kind, opts: *PropertyOpts, errors: ?*DeferredErrors) anyerror!?G.Property {
        var key: Expr = Expr{ .loc = logger.Loc.Empty, .data = Prefill.Data.EMissing };
        var key_range = p.lexer.range();
        var is_computed = false;

        switch (p.lexer.token) {
            .t_numeric_literal => {
                key = p.e(E.Number{
                    .value = p.lexer.number,
                }, p.lexer.loc());
                // p.checkForLegacyOctalLiteral()
                try p.lexer.next();
            },
            .t_string_literal => {
                key = try p.parseStringLiteral();
            },
            .t_big_integer_literal => {
                key = p.e(E.BigInt{ .value = p.lexer.identifier }, p.lexer.loc());
                // markSyntaxFeature
                try p.lexer.next();
            },
            .t_private_identifier => {
                if (!opts.is_class or opts.ts_decorators.len > 0) {
                    try p.lexer.expected(.t_identifier);
                }

                key = p.e(E.PrivateIdentifier{ .ref = p.storeNameInRef(p.lexer.identifier) catch unreachable }, p.lexer.loc());
                try p.lexer.next();
            },
            .t_open_bracket => {
                is_computed = true;
                // p.markSyntaxFeature(compat.objectExtensions, p.lexer.range())
                try p.lexer.next();
                const wasIdentifier = p.lexer.token == .t_identifier;
                const expr = try p.parseExpr(.comma);

                // Handle index signatures
                if (p.options.ts and p.lexer.token == .t_colon and wasIdentifier and opts.is_class) {
                    switch (expr.data) {
                        .e_identifier => |ident| {
                            try p.lexer.next();
                            p.skipTypescriptType(.lowest);
                            try p.lexer.expect(.t_close_bracket);
                            try p.lexer.expect(.t_colon);
                            p.skipTypescriptType(.lowest);
                            try p.lexer.expectOrInsertSemicolon();

                            // Skip this property entirely
                            return null;
                        },
                        else => {},
                    }
                }

                try p.lexer.expect(.t_close_bracket);
                key = expr;
            },
            .t_asterisk => {
                if (kind != .normal or opts.is_generator) {
                    try p.lexer.unexpected();
                }

                try p.lexer.next();
                opts.is_generator = true;
                return try p.parseProperty(.normal, opts, errors);
            },

            else => {
                const name = p.lexer.identifier;
                const raw = p.lexer.raw();
                const name_range = p.lexer.range();

                if (!p.lexer.isIdentifierOrKeyword()) {
                    try p.lexer.expect(.t_identifier);
                }

                try p.lexer.next();

                // Support contextual keywords
                if (kind == .normal and !opts.is_generator) {
                    // Does the following token look like a key?
                    var couldBeModifierKeyword = p.lexer.isIdentifierOrKeyword();
                    if (!couldBeModifierKeyword) {
                        switch (p.lexer.token) {
                            .t_open_bracket, .t_numeric_literal, .t_string_literal, .t_asterisk, .t_private_identifier => {
                                couldBeModifierKeyword = true;
                            },
                            else => {},
                        }
                    }

                    // If so, check for a modifier keyword
                    if (couldBeModifierKeyword) {
                        // TODO: micro-optimization, use a smaller list for non-typescript files.
                        if (js_lexer.PropertyModifierKeyword.List.get(name)) |keyword| {
                            switch (keyword) {
                                .p_get => {
                                    if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_get) {
                                        // p.markSyntaxFeautre(ObjectAccessors, name_range)
                                        return try p.parseProperty(.get, opts, null);
                                    }
                                },

                                .p_set => {
                                    if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_set) {
                                        // p.markSyntaxFeautre(ObjectAccessors, name_range)
                                        return try p.parseProperty(.set, opts, null);
                                    }
                                },
                                .p_async => {
                                    if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_async and !p.lexer.has_newline_before) {
                                        opts.is_async = true;
                                        opts.async_range = name_range;

                                        // p.markSyntaxFeautre(ObjectAccessors, name_range)
                                        return try p.parseProperty(kind, opts, null);
                                    }
                                },
                                .p_static => {
                                    if (!opts.is_static and !opts.is_async and opts.is_class and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_get) == .p_static) {
                                        opts.is_static = true;
                                        return try p.parseProperty(kind, opts, null);
                                    }
                                },
                                .p_private, .p_protected, .p_public, .p_readonly, .p_abstract, .p_declare, .p_override => {
                                    // Skip over TypeScript keywords
                                    if (opts.is_class and p.options.ts and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == keyword) {
                                        return try p.parseProperty(kind, opts, null);
                                    }
                                },
                            }
                        }
                    }
                }

                key = p.e(E.String{ .utf8 = name }, name_range.loc);

                // Parse a shorthand property
                if (!opts.is_class and kind == .normal and p.lexer.token != .t_colon and p.lexer.token != .t_open_paren and p.lexer.token != .t_less_than and !opts.is_generator and !js_lexer.Keywords.has(name)) {
                    if ((p.fn_or_arrow_data_parse.allow_await != .allow_ident and strings.eqlComptime(name, "await")) or (p.fn_or_arrow_data_parse.allow_yield != .allow_ident and strings.eqlComptime(name, "yield"))) {
                        // TODO: add fmt to addRangeError
                        p.log.addRangeError(p.source, name_range, "Cannot use \"yield\" or \"await\" here.") catch unreachable;
                    }

                    const ref = p.storeNameInRef(name) catch unreachable;
                    const value = p.e(E.Identifier{ .ref = ref }, key.loc);

                    // Destructuring patterns have an optional default value
                    var initializer: ?Expr = null;
                    if (errors != null and p.lexer.token == .t_equals) {
                        (errors orelse unreachable).invalid_expr_default_value = p.lexer.range();
                        try p.lexer.next();
                        initializer = try p.parseExpr(.comma);
                    }

                    return G.Property{
                        .kind = kind,
                        .key = key,
                        .value = value,
                        .initializer = initializer,
                        .flags = Flags.Property{
                            .was_shorthand = true,
                        },
                    };
                }
            },
        }

        if (p.options.ts) {
            // "class X { foo?: number }"
            // "class X { foo!: number }"
            if (opts.is_class and (p.lexer.token == .t_question or p.lexer.token == .t_exclamation)) {
                try p.lexer.next();
            }

            // "class X { foo?<T>(): T }"
            // "const x = { foo<T>(): T {} }"
            p.skipTypescriptTypeParameters();
        }

        // Parse a class field with an optional initial value
        if (opts.is_class and kind == .normal and !opts.is_async and !opts.is_generator and p.lexer.token != .t_open_paren) {
            var initializer: ?Expr = null;

            // Forbid the names "constructor" and "prototype" in some cases
            if (!is_computed) {
                switch (key.data) {
                    .e_string => |str| {
                        if (str.eql(string, "constructor") or (opts.is_static and str.eql(string, "prototype"))) {
                            // TODO: fmt error message to include string value.
                            p.log.addRangeError(p.source, key_range, "Invalid field name") catch unreachable;
                        }
                    },
                    else => {},
                }
            }

            // Skip over types
            if (p.options.ts and p.lexer.token == .t_colon) {
                try p.lexer.next();
                p.skipTypescriptType(.lowest);
            }

            if (p.lexer.token == .t_equals) {
                try p.lexer.next();
                initializer = try p.parseExpr(.comma);
            }

            // Special-case private identifiers
            switch (key.data) {
                .e_private_identifier => |private| {
                    const name = p.loadNameFromRef(private.ref);
                    if (strings.eqlComptime(name, "#constructor")) {
                        p.log.addRangeError(p.source, key_range, "Invalid field name \"#constructor\"") catch unreachable;
                    }

                    var declare: js_ast.Symbol.Kind = undefined;
                    if (opts.is_static) {
                        declare = .private_static_field;
                    } else {
                        declare = .private_field;
                    }
                    private.ref = p.declareSymbol(declare, key.loc, name) catch unreachable;
                },
                else => {},
            }

            try p.lexer.expectOrInsertSemicolon();

            return G.Property{
                .ts_decorators = opts.ts_decorators,
                .kind = kind,
                .flags = Flags.Property{
                    .is_computed = is_computed,
                    .is_static = opts.is_static,
                },
                .key = key,
                .initializer = initializer,
            };
        }

        // Parse a method expression
        if (p.lexer.token == .t_open_paren or kind != .normal or opts.is_class or opts.is_async or opts.is_generator) {
            if (p.lexer.token == .t_open_paren and kind != .get and kind != .set) {
                // markSyntaxFeature object extensions
            }

            const loc = p.lexer.loc();
            const scope_index = p.pushScopeForParsePass(.function_args, loc) catch unreachable;
            var is_constructor = false;

            // Forbid the names "constructor" and "prototype" in some cases
            if (opts.is_class and !is_computed) {
                switch (key.data) {
                    .e_string => |str| {
                        if (!opts.is_static and str.eql(string, "constructor")) {
                            if (kind == .get) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be a getter") catch unreachable;
                            } else if (kind == .set) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be a setter") catch unreachable;
                            } else if (opts.is_async) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be an async function") catch unreachable;
                            } else if (opts.is_generator) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be a generator function") catch unreachable;
                            } else {
                                is_constructor = true;
                            }
                        } else if (opts.is_static and str.eql(string, "prototype")) {
                            p.log.addRangeError(p.source, key_range, "Invalid static method name \"prototype\"") catch unreachable;
                        }
                    },
                    else => {},
                }
            }

            var func = try p.parseFn(null, FnOrArrowDataParse{
                .async_range = opts.async_range,
                .allow_await = if (opts.is_async) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                .allow_yield = if (opts.is_generator) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                .allow_super_call = opts.class_has_extends and is_constructor,
                .allow_ts_decorators = opts.allow_ts_decorators,
                .is_constructor = is_constructor,

                // Only allow omitting the body if we're parsing TypeScript class
                .allow_missing_body_for_type_script = p.options.ts and opts.is_class,
            });

            // "class Foo { foo(): void; foo(): void {} }"
            if (func.body == null) {
                // Skip this property entirely
                p.popAndDiscardScope(scope_index);
                return null;
            }

            p.popScope();
            func.flags.is_unique_formal_parameters = true;
            const value = p.e(E.Function{ .func = func }, loc);

            // Enforce argument rules for accessors
            switch (kind) {
                .get => {
                    if (func.args.len > 0) {
                        const r = js_lexer.rangeOfIdentifier(p.source, func.args[0].binding.loc);
                        p.log.addRangeErrorFmt(p.source, r, p.allocator, "Getter {s} must have zero arguments", .{p.keyNameForError(key)}) catch unreachable;
                    }
                },
                .set => {
                    if (func.args.len != 1) {
                        var r = js_lexer.rangeOfIdentifier(p.source, if (func.args.len > 0) func.args[0].binding.loc else loc);
                        if (func.args.len > 1) {
                            r = js_lexer.rangeOfIdentifier(p.source, func.args[1].binding.loc);
                        }
                        p.log.addRangeErrorFmt(p.source, r, p.allocator, "Setter {s} must have exactly 1 argument (there are {d})", .{ p.keyNameForError(key), func.args.len }) catch unreachable;
                    }
                },
                else => {},
            }

            // Special-case private identifiers
            switch (key.data) {
                .e_private_identifier => |private| {
                    var declare: Symbol.Kind = undefined;
                    var suffix: string = "";
                    switch (kind) {
                        .get => {
                            if (opts.is_static) {
                                declare = .private_static_get;
                            } else {
                                declare = .private_get;
                            }
                            suffix = "_get";
                        },
                        .set => {
                            if (opts.is_static) {
                                declare = .private_static_set;
                            } else {
                                declare = .private_set;
                            }
                            suffix = "_set";
                        },
                        else => {
                            if (opts.is_static) {
                                declare = .private_static_method;
                            } else {
                                declare = .private_method;
                            }
                            suffix = "_fn";
                        },
                    }

                    const name = p.loadNameFromRef(private.ref);
                    if (strings.eqlComptime(name, "#constructor")) {
                        p.log.addRangeError(p.source, key_range, "Invalid method name \"#constructor\"") catch unreachable;
                    }
                    private.ref = p.declareSymbol(declare, key.loc, name) catch unreachable;
                },
                else => {},
            }

            return G.Property{
                .ts_decorators = opts.ts_decorators,
                .kind = kind,
                .flags = Flags.Property{
                    .is_computed = is_computed,
                    .is_method = true,
                    .is_static = opts.is_static,
                },
                .key = key,
                .value = value,
            };
        }

        // Parse an object key/value pair
        try p.lexer.expect(.t_colon);
        const value = try p.parseExprOrBindings(.comma, errors);

        return G.Property{
            .ts_decorators = &[_]Expr{},
            .kind = kind,
            .flags = Flags.Property{
                .is_computed = is_computed,
            },
            .key = key,
            .value = value,
        };
    }

    // By the time we call this, the identifier and type parameters have already
    // been parsed. We need to start parsing from the "extends" clause.
    pub fn parseClass(p: *P, class_keyword: logger.Range, name: ?js_ast.LocRef, class_opts: ParseClassOptions) !G.Class {
        var extends: ?Expr = null;

        if (p.lexer.token == .t_extends) {
            try p.lexer.next();
            extends = try p.parseExpr(.new);

            // TypeScript's type argument parser inside expressions backtracks if the
            // first token after the end of the type parameter list is "{", so the
            // parsed expression above will have backtracked if there are any type
            // arguments. This means we have to re-parse for any type arguments here.
            // This seems kind of wasteful to me but it's what the official compiler
            // does and it probably doesn't have that high of a performance overhead
            // because "extends" clauses aren't that frequent, so it should be ok.
            if (p.options.ts) {
                p.skipTypeScriptTypeArguments(false); // isInsideJSXElement
            }
        }

        if (p.options.ts and p.lexer.isContextualKeyword("implements")) {
            try p.lexer.next();

            while (true) {
                p.skipTypescriptType(.lowest);
                if (p.lexer.token != .t_comma) {
                    break;
                }
                try p.lexer.next();
            }
        }

        var body_loc = p.lexer.loc();
        try p.lexer.expect(T.t_open_brace);
        var properties = List(G.Property).init(p.allocator);

        // Allow "in" and private fields inside class bodies
        const old_allow_in = p.allow_in;
        const old_allow_private_identifiers = p.allow_private_identifiers;
        p.allow_in = true;
        p.allow_private_identifiers = true;

        // A scope is needed for private identifiers
        const scopeIndex = p.pushScopeForParsePass(.class_body, body_loc) catch unreachable;

        var opts = PropertyOpts{ .is_class = true, .allow_ts_decorators = class_opts.allow_ts_decorators, .class_has_extends = extends != null };
        while (p.lexer.token != T.t_close_brace) {
            if (p.lexer.token == .t_semicolon) {
                try p.lexer.next();
                continue;
            }

            opts = PropertyOpts{ .is_class = true, .allow_ts_decorators = class_opts.allow_ts_decorators, .class_has_extends = extends != null };

            // Parse decorators for this property
            const first_decorator_loc = p.lexer.loc();
            if (opts.allow_ts_decorators) {
                opts.ts_decorators = try p.parseTypeScriptDecorators();
            } else {
                opts.ts_decorators = &[_]Expr{};
            }

            // This property may turn out to be a type in TypeScript, which should be ignored
            if (try p.parseProperty(.normal, &opts, null)) |property| {
                properties.append(property) catch unreachable;

                // Forbid decorators on class constructors
                if (opts.ts_decorators.len > 0) {
                    switch ((property.key orelse p.panic("Internal error: Expected property {s} to have a key.", .{property})).data) {
                        .e_string => |str| {
                            if (str.eql(string, "constructor")) {
                                p.log.addError(p.source, first_decorator_loc, "TypeScript does not allow decorators on class constructors") catch unreachable;
                            }
                        },
                        else => {},
                    }
                }
            }
        }

        if (class_opts.is_type_script_declare) {
            p.popAndDiscardScope(scopeIndex);
        } else {
            p.popScope();
        }

        p.allow_in = old_allow_in;
        p.allow_private_identifiers = old_allow_private_identifiers;

        try p.lexer.expect(.t_close_brace);

        return G.Class{
            .class_name = name,
            .extends = extends,
            .ts_decorators = class_opts.ts_decorators,
            .class_keyword = class_keyword,
            .body_loc = body_loc,
            .properties = properties.toOwnedSlice(),
        };
    }

    pub fn skipTypeScriptTypeArguments(p: *P, isInsideJSXElement: bool) void {
        notimpl();
    }

    pub fn parseTemplateParts(p: *P, include_raw: bool) anyerror!TemplatePartTuple {
        var parts = List(E.TemplatePart).initCapacity(p.allocator, 1) catch unreachable;
        // Allow "in" inside template literals
        var oldAllowIn = p.allow_in;
        p.allow_in = true;
        var legacy_octal_loc = logger.Loc.Empty;

        parseTemplatePart: while (true) {
            try p.lexer.next();
            var value = try p.parseExpr(.lowest);
            var tail_loc = p.lexer.loc();
            try p.lexer.rescanCloseBraceAsTemplateToken();

            var tail = p.lexer.stringLiteralUTF16();
            var tail_raw: string = "";

            if (include_raw) {
                tail_raw = p.lexer.rawTemplateContents();
            } else if (p.lexer.legacy_octal_loc.start > tail_loc.start) {
                legacy_octal_loc = p.lexer.legacy_octal_loc;
            }

            parts.append(E.TemplatePart{
                .value = value,
                .tail_loc = tail_loc,
                .tail = tail,
                .tail_raw = tail_raw,
            }) catch unreachable;

            if (p.lexer.token == .t_template_tail) {
                try p.lexer.next();
                break :parseTemplatePart;
            }
            std.debug.assert(p.lexer.token != .t_end_of_file);
        }

        p.allow_in = oldAllowIn;

        return TemplatePartTuple{ .@"0" = parts.toOwnedSlice(), .@"1" = legacy_octal_loc };
    }

    // This assumes the caller has already checked for TStringLiteral or TNoSubstitutionTemplateLiteral
    pub fn parseStringLiteral(p: *P) anyerror!Expr {
        var legacy_octal_loc: logger.Loc = logger.Loc.Empty;
        var loc = p.lexer.loc();
        if (p.lexer.legacy_octal_loc.start > loc.start) {
            legacy_octal_loc = p.lexer.legacy_octal_loc;
        }
        var str = p.lexer.toEString();
        str.prefer_template = p.lexer.token == .t_no_substitution_template_literal;

        const expr = p.e(str, loc);
        try p.lexer.next();
        return expr;
    }

    pub fn parseCallArgs(p: *P) anyerror![]Expr {
        // Allow "in" inside call arguments
        const old_allow_in = p.allow_in;
        p.allow_in = true;
        defer p.allow_in = old_allow_in;

        var args = List(Expr).init(p.allocator);
        try p.lexer.expect(.t_open_paren);

        while (p.lexer.token != .t_close_paren) {
            const loc = p.lexer.loc();
            const is_spread = p.lexer.token == .t_dot_dot_dot;
            if (is_spread) {
                // p.mark_syntax_feature(compat.rest_argument, p.lexer.range());
                try p.lexer.next();
            }
            var arg = try p.parseExpr(.comma);
            if (is_spread) {
                arg = p.e(E.Spread{ .value = arg }, loc);
            }
            args.append(arg) catch unreachable;
            if (p.lexer.token != .t_comma) {
                break;
            }
            try p.lexer.next();
        }

        try p.lexer.expect(.t_close_paren);
        return args.toOwnedSlice();
    }

    pub fn parseSuffix(p: *P, left: Expr, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
        return _parseSuffix(p, left, level, errors orelse &DeferredErrors.None, flags);
    }
    pub fn _parseSuffix(p: *P, _left: Expr, level: Level, errors: *DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
        var expr: Expr = Expr{ .loc = logger.Loc.Empty, .data = Prefill.Data.EMissing };
        var left = _left;
        var loc = p.lexer.loc();
        var optional_chain: ?js_ast.OptionalChain = null;

        while (true) {
            if (p.lexer.loc().start == p.after_arrow_body_loc.start) {
                while (true) {
                    switch (p.lexer.token) {
                        .t_comma => {
                            if (level.gte(.comma)) {
                                return left;
                            }

                            try p.lexer.next();
                            left = p.e(E.Binary{
                                .op = .bin_comma,
                                .left = left,
                                .right = try p.parseExpr(.comma),
                            }, left.loc);
                        },
                        else => {
                            return left;
                        },
                    }
                }
            }

            // Stop now if this token is forbidden to follow a TypeScript "as" cast
            if (p.forbid_suffix_after_as_loc.start > -1 and p.lexer.loc().start == p.forbid_suffix_after_as_loc.start) {
                return left;
            }

            // Reset the optional chain flag by default. That way we won't accidentally
            // treat "c.d" as OptionalChainContinue in "a?.b + c.d".
            var old_optional_chain = optional_chain;
            optional_chain = null;
            switch (p.lexer.token) {
                .t_dot => {
                    try p.lexer.next();
                    if (p.lexer.token == .t_private_identifier and p.allow_private_identifiers) {
                        // "a.#b"
                        // "a?.b.#c"
                        switch (left.data) {
                            .e_super => {
                                try p.lexer.expected(.t_identifier);
                            },
                            else => {},
                        }

                        var name = p.lexer.identifier;
                        var name_loc = p.lexer.loc();
                        try p.lexer.next();
                        const ref = p.storeNameInRef(name) catch unreachable;
                        left = p.e(E.Index{
                            .target = left,
                            .index = p.e(
                                E.PrivateIdentifier{
                                    .ref = ref,
                                },
                                name_loc,
                            ),
                            .optional_chain = old_optional_chain,
                        }, left.loc);
                    } else {
                        // "a.b"
                        // "a?.b.c"
                        if (!p.lexer.isIdentifierOrKeyword()) {
                            try p.lexer.expect(.t_identifier);
                        }

                        var name = p.lexer.identifier;
                        var name_loc = p.lexer.loc();
                        try p.lexer.next();

                        left = p.e(E.Dot{ .target = left, .name = name, .name_loc = name_loc, .optional_chain = old_optional_chain }, left.loc);
                    }

                    optional_chain = old_optional_chain;
                },
                .t_question_dot => {
                    try p.lexer.next();
                    var optional_start = js_ast.OptionalChain.start;

                    // TODO: Remove unnecessary optional chains
                    //                     		if p.options.mangleSyntax {
                    // 	if isNullOrUndefined, _, ok := toNullOrUndefinedWithSideEffects(left.Data); ok and !isNullOrUndefined {
                    // 		optionalStart = js_ast.OptionalChainNone
                    // 	}
                    // }

                    switch (p.lexer.token) {
                        .t_open_bracket => {
                            // "a?.[b]"
                            try p.lexer.next();

                            // allow "in" inside the brackets;
                            const old_allow_in = p.allow_in;
                            p.allow_in = true;

                            const index = try p.parseExpr(.lowest);

                            p.allow_in = old_allow_in;

                            try p.lexer.expect(.t_close_bracket);
                            left = p.e(
                                E.Index{ .target = left, .index = index, .optional_chain = optional_start },
                                left.loc,
                            );
                        },

                        .t_open_paren => {
                            // "a?.()"
                            if (level.gte(.call)) {
                                return left;
                            }

                            left = p.e(E.Call{
                                .target = left,
                                .args = try p.parseCallArgs(),
                                .optional_chain = optional_start,
                            }, left.loc);
                        },
                        .t_less_than => {
                            // "a?.<T>()"
                            if (!p.options.ts) {
                                try p.lexer.expected(.t_identifier);
                            }

                            p.skipTypeScriptTypeArguments(false);
                            if (p.lexer.token != .t_open_paren) {
                                try p.lexer.expected(.t_open_paren);
                            }

                            if (level.gte(.call)) {
                                return left;
                            }

                            left = p.e(
                                E.Call{ .target = left, .args = try p.parseCallArgs(), .optional_chain = optional_start },
                                left.loc,
                            );
                        },
                        else => {
                            if (p.lexer.token == .t_private_identifier and p.allow_private_identifiers) {
                                // "a?.#b"
                                const name = p.lexer.identifier;
                                const name_loc = p.lexer.loc();
                                try p.lexer.next();
                                const ref = p.storeNameInRef(name) catch unreachable;
                                left = p.e(E.Index{
                                    .target = left,
                                    .index = p.e(
                                        E.PrivateIdentifier{
                                            .ref = ref,
                                        },
                                        name_loc,
                                    ),
                                    .optional_chain = optional_start,
                                }, left.loc);
                            } else {
                                // "a?.b"
                                if (!p.lexer.isIdentifierOrKeyword()) {
                                    try p.lexer.expect(.t_identifier);
                                }
                                const name = p.lexer.identifier;
                                const name_loc = p.lexer.loc();
                                try p.lexer.next();

                                left = p.e(E.Dot{
                                    .target = left,
                                    .name = name,
                                    .name_loc = name_loc,
                                    .optional_chain = optional_start,
                                }, left.loc);
                            }
                        },
                    }

                    // Only continue if we have started
                    if (optional_start == .start) {
                        optional_start = .ccontinue;
                    }
                },
                .t_no_substitution_template_literal => {
                    if (old_optional_chain != null) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Template literals cannot have an optional chain as a tag") catch unreachable;
                    }
                    // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
                    const head = p.lexer.stringLiteralUTF16();
                    const head_raw = p.lexer.rawTemplateContents();
                    try p.lexer.next();
                    left = p.e(E.Template{
                        .tag = left,
                        .head = head,
                        .head_raw = head_raw,
                        .legacy_octal_loc = logger.Loc.Empty,
                    }, left.loc);
                },
                .t_template_head => {
                    if (old_optional_chain != null) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Template literals cannot have an optional chain as a tag") catch unreachable;
                    }
                    // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
                    const head = p.lexer.stringLiteralUTF16();
                    const head_raw = p.lexer.rawTemplateContents();
                    const partsGroup = try p.parseTemplateParts(true);
                    try p.lexer.next();
                    const tag = left;
                    left = p.e(E.Template{ .tag = tag, .head = head, .head_raw = head_raw, .parts = partsGroup.@"0" }, left.loc);
                },
                .t_open_bracket => {
                    // When parsing a decorator, ignore EIndex expressions since they may be
                    // part of a computed property:
                    //
                    //   class Foo {
                    //     @foo ['computed']() {}
                    //   }
                    //
                    // This matches the behavior of the TypeScript compiler.
                    if (flags == .ts_decorator) {
                        return left;
                    }

                    try p.lexer.next();

                    // Allow "in" inside the brackets
                    const old_allow_in = p.allow_in;
                    p.allow_in = true;

                    const index = try p.parseExpr(.lowest);

                    p.allow_in = old_allow_in;

                    try p.lexer.expect(.t_close_bracket);

                    left = p.e(E.Index{
                        .target = left,
                        .index = index,
                        .optional_chain = old_optional_chain,
                    }, left.loc);
                    optional_chain = old_optional_chain;
                },
                .t_open_paren => {
                    if (level.gte(.call)) {
                        return left;
                    }

                    left = p.e(
                        E.Call{
                            .target = left,
                            .args = try p.parseCallArgs(),
                            .optional_chain = old_optional_chain,
                        },
                        left.loc,
                    );
                    optional_chain = old_optional_chain;
                },
                .t_question => {
                    if (level.gte(.conditional)) {
                        return left;
                    }
                    try p.lexer.next();

                    // Stop now if we're parsing one of these:
                    // "(a?) => {}"
                    // "(a?: b) => {}"
                    // "(a?, b?) => {}"
                    if (p.options.ts and left.loc.start == p.latest_arrow_arg_loc.start and (p.lexer.token == .t_colon or
                        p.lexer.token == .t_close_paren or p.lexer.token == .t_comma))
                    {
                        if (errors.isEmpty()) {
                            try p.lexer.unexpected();
                        }
                        errors.invalid_expr_after_question = p.lexer.range();
                        return left;
                    }

                    // Allow "in" in between "?" and ":"
                    const old_allow_in = p.allow_in;
                    p.allow_in = true;

                    const yes = try p.parseExpr(.comma);

                    p.allow_in = old_allow_in;

                    try p.lexer.expect(.t_colon);
                    const no = try p.parseExpr(.comma);

                    left = p.e(E.If{
                        .test_ = left,
                        .yes = yes,
                        .no = no,
                    }, left.loc);
                },
                .t_exclamation => {
                    // Skip over TypeScript non-null assertions
                    if (p.lexer.has_newline_before) {
                        return left;
                    }

                    if (!p.options.ts) {
                        try p.lexer.unexpected();
                    }

                    if (level.gte(.postfix)) {
                        return left;
                    }

                    try p.lexer.next();
                    optional_chain = old_optional_chain;
                },
                .t_minus_minus => {
                    if (p.lexer.has_newline_before or level.gte(.postfix)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Unary{ .op = .un_post_dec, .value = left }, left.loc);
                },
                .t_plus_plus => {
                    if (p.lexer.has_newline_before or level.gte(.postfix)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Unary{ .op = .un_post_inc, .value = left }, left.loc);
                },
                .t_comma => {
                    if (level.gte(.comma)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_comma, .left = left, .right = try p.parseExpr(.comma) }, left.loc);
                },
                .t_plus => {
                    if (level.gte(.add)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_add, .left = left, .right = try p.parseExpr(.add) }, left.loc);
                },
                .t_plus_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_add_assign, .left = left, .right = try p.parseExpr(@intToEnum(Op.Level, @enumToInt(Op.Level.assign) - 1)) }, left.loc);
                },
                .t_minus => {
                    if (level.gte(.add)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_sub, .left = left, .right = try p.parseExpr(.add) }, left.loc);
                },
                .t_minus_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_sub_assign, .left = left, .right = try p.parseExpr(Op.Level.sub(Op.Level.assign, 1)) }, left.loc);
                },
                .t_asterisk => {
                    if (level.gte(.multiply)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_mul, .left = left, .right = try p.parseExpr(.multiply) }, left.loc);
                },
                .t_asterisk_asterisk => {
                    if (level.gte(.exponentiation)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_pow, .left = left, .right = try p.parseExpr(Op.Level.exponentiation.sub(1)) }, left.loc);
                },
                .t_asterisk_asterisk_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_pow_assign, .left = left, .right = try p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
                },
                .t_asterisk_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_mul_assign, .left = left, .right = try p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
                },
                .t_percent => {
                    if (level.gte(.multiply)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_rem, .left = left, .right = try p.parseExpr(Op.Level.multiply) }, left.loc);
                },
                .t_percent_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_rem_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_slash => {
                    if (level.gte(.multiply)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_div, .left = left, .right = try p.parseExpr(Level.multiply) }, left.loc);
                },
                .t_slash_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_div_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_equals_equals => {
                    if (level.gte(.equals)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_loose_eq, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                },
                .t_exclamation_equals => {
                    if (level.gte(.equals)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_loose_ne, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                },
                .t_equals_equals_equals => {
                    if (level.gte(.equals)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_strict_eq, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                },
                .t_exclamation_equals_equals => {
                    if (level.gte(.equals)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_strict_ne, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                },
                .t_less_than => {
                    // TypeScript allows type arguments to be specified with angle brackets
                    // inside an expression. Unlike in other languages, this unfortunately
                    // appears to require backtracking to parse.
                    if (p.options.ts and p.trySkipTypeScriptTypeArgumentsWithBacktracking()) {
                        optional_chain = old_optional_chain;
                        continue;
                    }

                    if (level.gte(.compare)) {
                        return left;
                    }
                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_lt, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                },
                .t_less_than_equals => {
                    if (level.gte(.compare)) {
                        return left;
                    }
                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_le, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                },
                .t_greater_than => {
                    if (level.gte(.compare)) {
                        return left;
                    }
                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_gt, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                },
                .t_greater_than_equals => {
                    if (level.gte(.compare)) {
                        return left;
                    }
                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_ge, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                },
                .t_less_than_less_than => {
                    if (level.gte(.shift)) {
                        return left;
                    }
                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shl, .left = left, .right = try p.parseExpr(.shift) }, left.loc);
                },
                .t_less_than_less_than_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shl_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_greater_than_greater_than => {
                    if (level.gte(.shift)) {
                        return left;
                    }
                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shr, .left = left, .right = try p.parseExpr(.shift) }, left.loc);
                },
                .t_greater_than_greater_than_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shl_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_greater_than_greater_than_greater_than => {
                    if (level.gte(.shift)) {
                        return left;
                    }
                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_u_shr, .left = left, .right = try p.parseExpr(.shift) }, left.loc);
                },
                .t_greater_than_greater_than_greater_than_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_u_shr_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_question_question => {
                    if (level.gte(.nullish_coalescing)) {
                        return left;
                    }
                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_nullish_coalescing, .left = left, .right = try p.parseExpr(.nullish_coalescing) }, left.loc);
                },
                .t_question_question_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_nullish_coalescing_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_bar_bar => {
                    if (level.gte(.logical_or)) {
                        return left;
                    }

                    // Prevent "||" inside "??" from the right
                    if (level.eql(.nullish_coalescing)) {
                        try p.lexer.unexpected();
                    }

                    try p.lexer.next();
                    const right = try p.parseExpr(.logical_or);
                    left = p.e(E.Binary{ .op = Op.Code.bin_logical_or, .left = left, .right = right }, left.loc);

                    if (level.lt(.nullish_coalescing)) {
                        left = try p.parseSuffix(left, Level.nullish_coalescing.add(1), null, flags);

                        if (p.lexer.token == .t_question_question) {
                            try p.lexer.unexpected();
                        }
                    }
                },
                .t_bar_bar_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_logical_or_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_ampersand_ampersand => {
                    if (level.gte(.logical_and)) {
                        return left;
                    }

                    // Prevent "&&" inside "??" from the right
                    if (level.eql(.nullish_coalescing)) {
                        try p.lexer.unexpected();
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_logical_and, .left = left, .right = try p.parseExpr(.logical_and) }, left.loc);

                    // Prevent "&&" inside "??" from the left
                    if (level.lt(.nullish_coalescing)) {
                        left = try p.parseSuffix(left, Level.nullish_coalescing.add(1), null, flags);

                        if (p.lexer.token == .t_question_question) {
                            try p.lexer.unexpected();
                        }
                    }
                },
                .t_ampersand_ampersand_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_logical_and_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_bar => {
                    if (level.gte(.bitwise_or)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_or, .left = left, .right = try p.parseExpr(.bitwise_or) }, left.loc);
                },
                .t_bar_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_or_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_ampersand => {
                    if (level.gte(.bitwise_and)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_and, .left = left, .right = try p.parseExpr(.bitwise_and) }, left.loc);
                },
                .t_ampersand_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_shl_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_caret => {
                    if (level.gte(.bitwise_xor)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_xor, .left = left, .right = try p.parseExpr(.bitwise_xor) }, left.loc);
                },
                .t_caret_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_bitwise_xor_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_equals => {
                    if (level.gte(.assign)) {
                        return left;
                    }

                    try p.lexer.next();

                    left = p.e(E.Binary{ .op = .bin_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                },
                .t_in => {
                    if (level.gte(.compare) or !p.allow_in) {
                        return left;
                    }

                    // Warn about "!a in b" instead of "!(a in b)"
                    switch (left.data) {
                        .e_unary => |unary| {
                            if (unary.op == .un_not) {
                                // TODO:
                                // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
                            }
                        },
                        else => {},
                    }

                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_in, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                },
                .t_instanceof => {
                    if (level.gte(.compare)) {
                        return left;
                    }

                    // Warn about "!a instanceof b" instead of "!(a instanceof b)". Here's an
                    // example of code with this problem: https://github.com/mrdoob/three.js/pull/11182.
                    if (!p.options.suppress_warnings_about_weird_code) {
                        switch (left.data) {
                            .e_unary => |unary| {
                                if (unary.op == .un_not) {
                                    // TODO:
                                    // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
                                }
                            },
                            else => {},
                        }
                    }
                    try p.lexer.next();
                    left = p.e(E.Binary{ .op = .bin_instanceof, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                },
                else => {
                    // Handle the TypeScript "as" operator
                    if (p.options.ts and level.lt(.compare) and !p.lexer.has_newline_before and p.lexer.isContextualKeyword("as")) {
                        try p.lexer.next();
                        p.skipTypescriptType(.lowest);

                        // These tokens are not allowed to follow a cast expression. This isn't
                        // an outright error because it may be on a new line, in which case it's
                        // the start of a new expression when it's after a cast:
                        //
                        //   x = y as z
                        //   (something);
                        //
                        switch (p.lexer.token) {
                            .t_plus_plus,
                            .t_minus_minus,
                            .t_no_substitution_template_literal,
                            .t_template_head,
                            .t_open_paren,
                            .t_open_bracket,
                            .t_question_dot,
                            => {
                                p.forbid_suffix_after_as_loc = p.lexer.loc();
                                return left;
                            },
                            else => {},
                        }

                        if (p.lexer.token.isAssign()) {
                            p.forbid_suffix_after_as_loc = p.lexer.loc();
                            return left;
                        }
                        continue;
                    }

                    return left;
                },
            }
        }
    }

    pub fn panic(p: *P, comptime str: string, args: anytype) noreturn {
        p.log.addRangeErrorFmt(p.source, p.lexer.range(), p.allocator, str, args) catch unreachable;
        p.log.print(panic_stream.writer()) catch unreachable;
        Global.panic("{s}", .{panic_buffer});
    }

    pub fn _parsePrefix(p: *P, level: Level, errors: *DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
        const loc = p.lexer.loc();
        const l = @enumToInt(level);
        // Output.print("Parse Prefix {s}:{s} @{s} ", .{ p.lexer.token, p.lexer.raw(), @tagName(level) });

        switch (p.lexer.token) {
            .t_super => {
                const superRange = p.lexer.range();
                try p.lexer.next();

                switch (p.lexer.token) {
                    .t_open_paren => {
                        if (l < @enumToInt(Level.call) and p.fn_or_arrow_data_parse.allow_super_call) {
                            return p.e(E.Super{}, loc);
                        }
                    },
                    .t_dot, .t_open_bracket => {
                        return p.e(E.Super{}, loc);
                    },
                    else => {},
                }

                p.log.addRangeError(p.source, superRange, "Unexpected \"super\"") catch unreachable;
                return p.e(E.Super{}, loc);
            },
            .t_open_paren => {
                try p.lexer.next();

                // Arrow functions aren't allowed in the middle of expressions
                if (level.gt(.assign)) {
                    // Allow "in" inside parentheses
                    const oldAllowIn = p.allow_in;
                    p.allow_in = true;

                    var value = try p.parseExpr(Level.lowest);
                    p.markExprAsParenthesized(&value);
                    try p.lexer.expect(.t_close_paren);

                    p.allow_in = oldAllowIn;
                    return value;
                }

                return p.parseParenExpr(loc, level, ParenExprOpts{}) catch unreachable;
            },
            .t_false => {
                try p.lexer.next();
                return p.e(E.Boolean{ .value = false }, loc);
            },
            .t_true => {
                try p.lexer.next();
                return p.e(E.Boolean{ .value = true }, loc);
            },
            .t_null => {
                try p.lexer.next();
                return p.e(E.Null{}, loc);
            },
            .t_this => {
                try p.lexer.next();
                return Expr{ .data = Prefill.Data.This, .loc = loc };
            },
            .t_private_identifier => {
                if (!p.allow_private_identifiers or !p.allow_in) {
                    try p.lexer.unexpected();
                }

                const name = p.lexer.identifier;
                try p.lexer.next();

                // Check for "#foo in bar"
                if (p.lexer.token != .t_in) {
                    try p.lexer.expected(.t_in);
                }

                return p.e(E.PrivateIdentifier{ .ref = try p.storeNameInRef(name) }, loc);
            },
            .t_identifier => {
                const name = p.lexer.identifier;
                const name_range = p.lexer.range();
                const raw = p.lexer.raw();

                try p.lexer.next();

                // Handle async and await expressions
                switch (AsyncPrefixExpression.find(name)) {
                    .is_async => {
                        if ((raw.ptr == name.ptr and raw.len == name.len) or AsyncPrefixExpression.find(raw) == .is_async) {
                            return p.parseAsyncPrefixExpr(name_range, level) catch unreachable;
                        }
                    },

                    .is_await => {
                        switch (p.fn_or_arrow_data_parse.allow_await) {
                            .forbid_all => {
                                p.log.addRangeError(p.source, name_range, "The keyword \"await\" cannot be used here.") catch unreachable;
                            },
                            .allow_expr => {
                                if (AsyncPrefixExpression.find(raw) != .is_await) {
                                    p.log.addRangeError(p.source, name_range, "The keyword \"await\" cannot be escaped.") catch unreachable;
                                } else {
                                    if (p.fn_or_arrow_data_parse.is_top_level) {
                                        p.top_level_await_keyword = name_range;
                                    }

                                    if (p.fn_or_arrow_data_parse.arrow_arg_errors) |*args| {
                                        args.invalid_expr_await = name_range;
                                    }

                                    const value = try p.parseExpr(.prefix);
                                    if (p.lexer.token == T.t_asterisk_asterisk) {
                                        try p.lexer.unexpected();
                                    }

                                    return p.e(E.Await{ .value = value }, loc);
                                }
                            },
                            else => {},
                        }
                    },

                    .is_yield => {
                        switch (p.fn_or_arrow_data_parse.allow_yield) {
                            .forbid_all => {
                                p.log.addRangeError(p.source, name_range, "The keyword \"yield\" cannot be used here") catch unreachable;
                            },
                            .allow_expr => {
                                if (AsyncPrefixExpression.find(raw) != .is_yield) {
                                    p.log.addRangeError(p.source, name_range, "The keyword \"yield\" cannot be escaped") catch unreachable;
                                } else {
                                    if (level.gte(.assign)) {
                                        p.log.addRangeError(p.source, name_range, "Cannot use a \"yield\" here without parentheses") catch unreachable;
                                    }
                                    const value = try p.parseExpr(.prefix);

                                    if (p.fn_or_arrow_data_parse.arrow_arg_errors) |*args| {
                                        args.invalid_expr_yield = name_range;
                                    }

                                    if (p.lexer.token == T.t_asterisk_asterisk) {
                                        try p.lexer.unexpected();
                                    }

                                    return p.e(E.Yield{ .value = value }, loc);
                                }
                            },
                            // .allow_ident => {

                            // },
                            else => {
                                // Try to gracefully recover if "yield" is used in the wrong place
                                if (!p.lexer.has_newline_before) {
                                    switch (p.lexer.token) {
                                        .t_null, .t_identifier, .t_false, .t_true, .t_numeric_literal, .t_big_integer_literal, .t_string_literal => {
                                            p.log.addRangeError(p.source, name_range, "Cannot use \"yield\" outside a generator function") catch unreachable;
                                        },
                                        else => {},
                                    }
                                }
                            },
                        }
                    },
                    .none => {},
                }

                // Handle the start of an arrow expression
                if (p.lexer.token == .t_equals_greater_than and level.lte(.assign)) {
                    const ref = p.storeNameInRef(name) catch unreachable;
                    var args = p.allocator.alloc(Arg, 1) catch unreachable;
                    args[0] = Arg{ .binding = p.b(B.Identifier{
                        .ref = ref,
                    }, loc) };

                    _ = p.pushScopeForParsePass(.function_args, loc) catch unreachable;
                    defer p.popScope();
                    // Output.print("HANDLE START ", .{});
                    return p.e(p.parseArrowBody(args, p.m(FnOrArrowDataParse{})) catch unreachable, loc);
                }

                const ref = p.storeNameInRef(name) catch unreachable;

                return p.e(E.Identifier{
                    .ref = ref,
                }, loc);
            },
            .t_string_literal, .t_no_substitution_template_literal => {
                return try p.parseStringLiteral();
            },
            .t_template_head => {
                var legacy_octal_loc = logger.Loc.Empty;
                var head = p.lexer.stringLiteralUTF16();
                var head_raw = p.lexer.raw();
                if (p.lexer.legacy_octal_loc.start > loc.start) {
                    legacy_octal_loc = p.lexer.legacy_octal_loc;
                }

                var resp = try p.parseTemplateParts(false);
                const parts: []E.TemplatePart = resp.@"0";
                const tail_legacy_octal_loc: logger.Loc = resp.@"1";
                if (tail_legacy_octal_loc.start > 0) {
                    legacy_octal_loc = tail_legacy_octal_loc;
                }
                // Check if TemplateLiteral is unsupported. We don't care for this product.`
                // if ()

                return p.e(E.Template{ .head = head, .parts = parts, .legacy_octal_loc = legacy_octal_loc, .head_raw = head_raw }, loc);
            },
            .t_numeric_literal => {
                const value = p.e(E.Number{ .value = p.lexer.number }, loc);
                // p.checkForLegacyOctalLiteral()
                try p.lexer.next();
                return value;
            },
            .t_big_integer_literal => {
                const value = p.lexer.identifier;
                // markSyntaxFeature bigInt
                try p.lexer.next();
                return p.e(E.BigInt{ .value = value }, loc);
            },
            .t_slash, .t_slash_equals => {
                try p.lexer.scanRegExp();
                const value = p.lexer.raw();
                try p.lexer.next();
                return p.e(E.RegExp{ .value = value }, loc);
            },
            .t_void => {
                try p.lexer.next();
                const value = try p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    try p.lexer.unexpected();
                }

                return p.e(E.Unary{
                    .op = .un_void,
                    .value = value,
                }, loc);
            },
            .t_typeof => {
                try p.lexer.next();
                const value = try p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    try p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_typeof, .value = value }, loc);
            },
            .t_delete => {
                try p.lexer.next();
                const value = try p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    try p.lexer.unexpected();
                }
                // TODO: add error deleting private identifier
                // const private = value.data.e_private_identifier;
                // if (private) |private| {
                //     const name = p.loadNameFromRef(private.ref);
                //     p.log.addRangeError(index.loc, )
                // }

                return p.e(E.Unary{ .op = .un_delete, .value = value }, loc);
            },
            .t_plus => {
                try p.lexer.next();
                const value = try p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    try p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_pos, .value = value }, loc);
            },
            .t_minus => {
                try p.lexer.next();
                const value = try p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    try p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_neg, .value = value }, loc);
            },
            .t_tilde => {
                try p.lexer.next();
                const value = try p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    try p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_cpl, .value = value }, loc);
            },
            .t_exclamation => {
                try p.lexer.next();
                const value = try p.parseExpr(.prefix);
                if (p.lexer.token == .t_asterisk_asterisk) {
                    try p.lexer.unexpected();
                }

                return p.e(E.Unary{ .op = .un_not, .value = value }, loc);
            },
            .t_minus_minus => {
                try p.lexer.next();
                return p.e(E.Unary{ .op = .un_pre_dec, .value = try p.parseExpr(.prefix) }, loc);
            },
            .t_plus_plus => {
                try p.lexer.next();
                return p.e(E.Unary{ .op = .un_pre_inc, .value = try p.parseExpr(.prefix) }, loc);
            },
            .t_function => {
                return try p.parseFnExpr(loc, false, logger.Range.None);
            },
            .t_class => {
                const classKeyword = p.lexer.range();
                // markSyntaxFEatuer class
                try p.lexer.next();
                var name: ?js_ast.LocRef = null;

                _ = p.pushScopeForParsePass(.class_name, loc) catch unreachable;

                // Parse an optional class name
                if (p.lexer.token == .t_identifier and !js_lexer.StrictModeReservedWords.has(p.lexer.identifier)) {
                    name = js_ast.LocRef{ .loc = p.lexer.loc(), .ref = p.newSymbol(.other, p.lexer.identifier) catch unreachable };
                    try p.lexer.next();
                }

                // Even anonymous classes can have TypeScript type parameters
                if (p.options.ts) {
                    p.skipTypescriptTypeParameters();
                }

                const class = try p.parseClass(classKeyword, name, ParseClassOptions{});
                p.popScope();

                return p.e(class, loc);
            },
            .t_new => {
                try p.lexer.next();

                // Special-case the weird "new.target" expression here

                const target = try p.parseExprWithFlags(.member, flags);
                var args: []Expr = &([_]Expr{});

                if (p.options.ts) {
                    // Skip over TypeScript non-null assertions
                    if (p.lexer.token == .t_exclamation and !p.lexer.has_newline_before) {
                        try p.lexer.next();
                    }

                    // Skip over TypeScript type arguments here if there are any
                    if (p.lexer.token == .t_less_than) {
                        _ = p.trySkipTypeScriptTypeArgumentsWithBacktracking();
                    }
                }

                if (p.lexer.token == .t_open_paren) {
                    args = try p.parseCallArgs();
                }

                return p.e(E.New{
                    .target = target,
                    .args = args,
                }, loc);
            },
            .t_open_bracket => {
                try p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                var items = List(Expr).init(p.allocator);
                var self_errors = DeferredErrors{};
                var comma_after_spread = logger.Loc{};

                // Allow "in" inside arrays
                const old_allow_in = p.allow_in;
                p.allow_in = true;

                while (p.lexer.token != .t_close_bracket) {
                    switch (p.lexer.token) {
                        .t_comma => {
                            items.append(Expr{ .data = Prefill.Data.EMissing, .loc = p.lexer.loc() }) catch unreachable;
                        },
                        .t_dot_dot_dot => {
                            // this might be wrong.
                            errors.array_spread_feature = p.lexer.range();

                            const dots_loc = p.lexer.loc();
                            try p.lexer.next();
                            items.append(
                                p.e(E.Spread{ .value = try p.parseExprOrBindings(.comma, &self_errors) }, dots_loc),
                            ) catch unreachable;
                        },
                        else => {
                            items.append(
                                try p.parseExprOrBindings(.comma, &self_errors),
                            ) catch unreachable;
                        },
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }

                    try p.lexer.next();

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }

                try p.lexer.expect(.t_close_bracket);
                p.allow_in = old_allow_in;

                // Is this a binding pattern?
                if (p.willNeedBindingPattern()) {
                    // noop
                } else if (errors.isEmpty()) {
                    // Is this an expression?
                    p.logExprErrors(&self_errors);
                } else {
                    // In this case, we can't distinguish between the two yet
                    self_errors.mergeInto(errors);
                }
                return p.e(E.Array{
                    .items = items.toOwnedSlice(),
                    .comma_after_spread = comma_after_spread,
                    .is_single_line = is_single_line,
                }, loc);
            },
            .t_open_brace => {
                try p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                var properties = List(G.Property).init(p.allocator);
                var self_errors = DeferredErrors{};
                var comma_after_spread = logger.Loc{};

                // Allow "in" inside object literals
                const old_allow_in = p.allow_in;
                p.allow_in = true;

                while (p.lexer.token != .t_close_brace) {
                    if (p.lexer.token == .t_dot_dot_dot) {
                        try p.lexer.next();
                        properties.append(G.Property{ .kind = .spread, .value = try p.parseExpr(.comma) }) catch unreachable;

                        // Commas are not allowed here when destructuring
                        if (p.lexer.token == .t_comma) {
                            comma_after_spread = p.lexer.loc();
                        }
                    } else {
                        // This property may turn out to be a type in TypeScript, which should be ignored
                        var propertyOpts = PropertyOpts{};
                        if (try p.parseProperty(.normal, &propertyOpts, &self_errors)) |prop| {
                            properties.append(prop) catch unreachable;
                        }
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }

                    try p.lexer.next();

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }

                try p.lexer.expect(.t_close_brace);
                p.allow_in = old_allow_in;

                if (p.willNeedBindingPattern()) {} else if (errors.isEmpty()) {
                    // Is this an expression?
                    p.logExprErrors(&self_errors);
                } else {
                    // In this case, we can't distinguish between the two yet
                    self_errors.mergeInto(errors);
                }
                return p.e(E.Object{
                    .properties = properties.toOwnedSlice(),
                    .comma_after_spread = comma_after_spread,
                    .is_single_line = is_single_line,
                }, loc);
            },
            .t_less_than => {
                // This is a very complicated and highly ambiguous area of TypeScript
                // syntax. Many similar-looking things are overloaded.
                //
                // TS:
                //
                //   A type cast:
                //     <A>(x)
                //     <[]>(x)
                //     <A[]>(x)
                //
                //   An arrow function with type parameters:
                //     <A>(x) => {}
                //     <A, B>(x) => {}
                //     <A = B>(x) => {}
                //     <A extends B>(x) => {}
                //
                // TSX:
                //
                //   A JSX element:
                //     <A>(x) => {}</A>
                //     <A extends>(x) => {}</A>
                //     <A extends={false}>(x) => {}</A>
                //
                //   An arrow function with type parameters:
                //     <A, B>(x) => {}
                //     <A extends B>(x) => {}
                //
                //   A syntax error:
                //     <[]>(x)
                //     <A[]>(x)
                //     <A>(x) => {}
                //     <A = B>(x) => {}
                if (p.options.ts and p.options.jsx.parse) {
                    var oldLexer = p.lexer;

                    try p.lexer.next();
                    // Look ahead to see if this should be an arrow function instead
                    var is_ts_arrow_fn = false;

                    if (p.lexer.token == .t_identifier) {
                        try p.lexer.next();
                        if (p.lexer.token == .t_comma) {
                            is_ts_arrow_fn = true;
                        } else if (p.lexer.token == .t_extends) {
                            try p.lexer.next();
                            is_ts_arrow_fn = p.lexer.token != .t_equals and p.lexer.token != .t_greater_than;
                        }
                    }

                    // Restore the lexer
                    p.lexer = oldLexer;

                    if (is_ts_arrow_fn) {
                        p.skipTypescriptTypeParameters();
                        try p.lexer.expect(.t_open_paren);
                        return p.parseParenExpr(loc, level, ParenExprOpts{ .force_arrow_fn = true }) catch unreachable;
                    }
                }

                if (p.options.jsx.parse) {
                    // Use NextInsideJSXElement() instead of Next() so we parse "<<" as "<"
                    try p.lexer.nextInsideJSXElement();
                    const element = p.parseJSXElement(loc) catch unreachable;

                    // The call to parseJSXElement() above doesn't consume the last
                    // TGreaterThan because the caller knows what Next() function to call.
                    // Use Next() instead of NextInsideJSXElement() here since the next
                    // token is an expression.
                    try p.lexer.next();
                    return element;
                }

                if (p.options.ts) {
                    // This is either an old-style type cast or a generic lambda function

                    // "<T>(x)"
                    // "<T>(x) => {}"
                    if (p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking()) {
                        try p.lexer.expect(.t_open_paren);
                        return p.parseParenExpr(loc, level, ParenExprOpts{}) catch unreachable;
                    }

                    // "<T>x"
                    try p.lexer.next();
                    p.skipTypescriptType(.lowest);
                    try p.lexer.expectGreaterThan(false);
                    return p.parsePrefix(level, errors, flags);
                }

                try p.lexer.unexpected();
                return Expr{ .data = Prefill.Data.EMissing, .loc = logger.Loc.Empty };
            },
            .t_import => {
                try p.lexer.next();
                return p.parseImportExpr(loc, level);
            },
            else => {
                try p.lexer.unexpected();
                return Expr{ .data = Prefill.Data.EMissing, .loc = logger.Loc.Empty };
            },
        }

        return Expr{ .data = Prefill.Data.EMissing, .loc = logger.Loc.Empty };
    }

    // esbuild's version of this function is much more complicated.
    // I'm not sure why defines is strictly relevant for this case
    // and I imagine all the allocations cause some performance
    // guessing it's concurrency-related
    pub fn jsxStringsToMemberExpression(p: *P, loc: logger.Loc, ref: Ref) Expr {
        p.recordUsage(ref);
        return p.e(E.Identifier{ .ref = ref }, loc);
    }

    // Note: The caller has already parsed the "import" keyword
    pub fn parseImportExpr(p: *P, loc: logger.Loc, level: Level) anyerror!Expr {
        // Parse an "import.meta" expression
        if (p.lexer.token == .t_dot) {
            p.es6_import_keyword = js_lexer.rangeOfIdentifier(p.source, loc);
            try p.lexer.next();
            if (p.lexer.isContextualKeyword("meta")) {
                const r = p.lexer.range();
                try p.lexer.next();
                p.has_import_meta = true;
                return p.e(E.ImportMeta{}, loc);
            } else {
                try p.lexer.expectedString("\"meta\"");
            }
        }

        if (level.gt(.call)) {
            const r = js_lexer.rangeOfIdentifier(p.source, loc);
            p.log.addRangeError(p.source, r, "Cannot use an \"import\" expression here without parentheses") catch unreachable;
        }
        // allow "in" inside call arguments;
        var old_allow_in = p.allow_in;
        p.allow_in = true;

        p.lexer.preserve_all_comments_before = true;
        try p.lexer.expect(.t_open_paren);
        const comments = p.lexer.comments_to_preserve_before.toOwnedSlice();
        p.lexer.preserve_all_comments_before = false;

        const value = try p.parseExpr(.comma);
        try p.lexer.expect(.t_close_paren);

        p.allow_in = old_allow_in;
        return p.e(E.Import{ .expr = value, .leading_interior_comments = comments, .import_record_index = 0 }, loc);
    }

    const JSXTag = struct {
        pub const TagType = enum { fragment, tag };
        pub const Data = union(TagType) {
            fragment: u1,
            tag: Expr,

            pub fn asExpr(d: *const Data) ?ExprNodeIndex {
                switch (d.*) {
                    .tag => |tag| {
                        return tag;
                    },
                    else => {
                        return null;
                    },
                }
            }
        };
        data: Data,
        range: logger.Range,
        name: string = "",

        pub fn parse(p: *P) !JSXTag {
            const loc = p.lexer.loc();

            // A missing tag is a fragment
            if (p.lexer.token == .t_greater_than) {
                return JSXTag{
                    .range = logger.Range{ .loc = loc, .len = 0 },
                    .data = Data{ .fragment = 1 },
                };
            }

            // The tag is an identifier
            var name = p.lexer.identifier;
            var tag_range = p.lexer.range();
            try p.lexer.expectInsideJSXElement(.t_identifier);

            // Certain identifiers are strings
            // <div
            // <button
            // <Hello-:Button
            if (strings.contains(name, "-:") or (p.lexer.token != .t_dot and name[0] >= 'a' and name[0] <= 'z')) {
                return JSXTag{
                    .data = Data{ .tag = p.e(E.String{
                        .utf8 = name,
                    }, loc) },
                    .range = tag_range,
                };
            }

            // Otherwise, this is an identifier
            // <Button>
            var tag = p.e(E.Identifier{ .ref = try p.storeNameInRef(name) }, loc);

            // Parse a member expression chain
            // <Button.Red>
            while (p.lexer.token == .t_dot) {
                try p.lexer.nextInsideJSXElement();
                const member_range = p.lexer.range();
                const member = p.lexer.identifier;
                try p.lexer.expectInsideJSXElement(.t_identifier);

                if (strings.indexOfChar(member, '-')) |index| {
                    try p.log.addError(p.source, logger.Loc{ .start = member_range.loc.start + @intCast(i32, index) }, "Unexpected \"-\"");
                    p.panic("", .{});
                }

                var _name = try p.allocator.alloc(u8, name.len + 1 + member.len);
                std.mem.copy(u8, _name, name);
                _name[name.len] = '.';
                std.mem.copy(u8, _name[name.len + 1 .. _name.len], member);
                name = _name;
                tag_range.len = member_range.loc.start + member_range.len - tag_range.loc.start;
                tag = p.e(E.Dot{ .target = tag, .name = member, .name_loc = member_range.loc }, loc);
            }

            return JSXTag{ .data = Data{ .tag = tag }, .range = tag_range, .name = name };
        }
    };

    pub fn parseJSXPropValueIdentifier(p: *P, previous_string_with_backslash_loc: *logger.Loc) !Expr {
        // Use NextInsideJSXElement() not Next() so we can parse a JSX-style string literal
        try p.lexer.nextInsideJSXElement();
        if (p.lexer.token == .t_string_literal) {
            previous_string_with_backslash_loc.start = std.math.max(p.lexer.loc().start, p.lexer.previous_backslash_quote_in_jsx.loc.start);
            const expr = p.e(p.lexer.toEString(), previous_string_with_backslash_loc.*);

            try p.lexer.nextInsideJSXElement();
            return expr;
        } else {
            // Use Expect() not ExpectInsideJSXElement() so we can parse expression tokens
            try p.lexer.expect(.t_open_brace);
            const value = try p.parseExpr(.lowest);
            try p.lexer.expectInsideJSXElement(.t_close_brace);
            return value;
        }
    }

    pub fn parseJSXElement(p: *P, loc: logger.Loc) !Expr {
        var tag = try JSXTag.parse(p);

        // The tag may have TypeScript type arguments: "<Foo<T>/>"
        if (p.options.ts) {
            // Pass a flag to the type argument skipper because we need to call
            p.skipTypeScriptTypeArguments(true);
        }

        var previous_string_with_backslash_loc = logger.Loc{};
        var properties: []G.Property = &([_]G.Property{});
        var key_prop: ?ExprNodeIndex = null;
        var flags = Flags.JSXElement{};
        var start_tag: ?ExprNodeIndex = null;

        // Fragments don't have props
        // Fragments of the form "React.Fragment" are not parsed as fragments.
        if (@as(JSXTag.TagType, tag.data) == .tag) {
            start_tag = tag.data.tag;
            var spread_loc: logger.Loc = logger.Loc.Empty;
            var props = List(G.Property).init(p.allocator);
            var key_prop_i: i32 = -1;
            var spread_prop_i: i32 = -1;
            var i: i32 = 0;
            parse_attributes: while (true) {
                switch (p.lexer.token) {
                    .t_identifier => {
                        defer i += 1;
                        // Parse the prop name
                        var key_range = p.lexer.range();
                        const prop_name_literal = p.lexer.identifier;
                        const special_prop = E.JSXElement.SpecialProp.Map.get(prop_name_literal) orelse E.JSXElement.SpecialProp.any;
                        try p.lexer.nextInsideJSXElement();

                        if (special_prop == .key) {

                            // <ListItem key>
                            if (p.lexer.token != .t_equals) {
                                // Unlike Babel, we're going to just warn here and move on.
                                try p.log.addWarning(p.source, key_range.loc, "\"key\" prop ignored. Must be a string, number or symbol.");
                                continue;
                            }

                            key_prop_i = i;
                            key_prop = try p.parseJSXPropValueIdentifier(&previous_string_with_backslash_loc);
                            continue;
                        }

                        var prop_name = p.e(E.String{ .utf8 = prop_name_literal }, key_range.loc);

                        // Parse the value
                        var value: Expr = undefined;
                        if (p.lexer.token != .t_equals) {

                            // Implicitly true value
                            // <button selected>
                            value = p.e(E.Boolean{ .value = true }, logger.Loc{ .start = key_range.loc.start + key_range.len });
                        } else {
                            value = try p.parseJSXPropValueIdentifier(&previous_string_with_backslash_loc);
                        }

                        try props.append(G.Property{ .key = prop_name, .value = value });
                    },
                    .t_open_brace => {
                        defer i += 1;
                        // Use Next() not ExpectInsideJSXElement() so we can parse "..."
                        try p.lexer.next();
                        try p.lexer.expect(.t_dot_dot_dot);
                        spread_prop_i = i;
                        spread_loc = p.lexer.loc();
                        try props.append(G.Property{ .value = try p.parseExpr(.comma), .kind = .spread });
                        try p.lexer.nextInsideJSXElement();
                    },
                    else => {
                        break :parse_attributes;
                    },
                }
            }

            flags.is_key_before_rest = key_prop_i > -1 and spread_prop_i > key_prop_i;
            if (flags.is_key_before_rest and p.options.jsx.runtime == .automatic and !p.has_classic_runtime_warned) {
                try p.log.addWarning(p.source, spread_loc, "\"key\" prop before a {...spread} is deprecated in JSX. Falling back to classic runtime.");
                p.has_classic_runtime_warned = true;
            }
            properties = props.toOwnedSlice();
        }

        // People sometimes try to use the output of "JSON.stringify()" as a JSX
        // attribute when automatically-generating JSX code. Doing so is incorrect
        // because JSX strings work like XML instead of like JS (since JSX is XML-in-
        // JS). Specifically, using a backslash before a quote does not cause it to
        // be escaped:
        //
        //   JSX ends the "content" attribute here and sets "content" to 'some so-called \\'
        //                                          v
        //         <Button content="some so-called \"button text\"" />
        //                                                      ^
        //       There is no "=" after the JSX attribute "text", so we expect a ">"
        //
        // This code special-cases this error to provide a less obscure error message.
        if (p.lexer.token == .t_syntax_error and strings.eqlComptime(p.lexer.raw(), "\\") and previous_string_with_backslash_loc.start > 0) {
            const r = p.lexer.range();
            // Not dealing with this right now.
            try p.log.addRangeError(p.source, r, "Invalid JSX escape - use XML entity codes quotes or pass a JavaScript string instead");
            p.panic("", .{});
        }

        // A slash here is a self-closing element
        if (p.lexer.token == .t_slash) {
            // Use NextInsideJSXElement() not Next() so we can parse ">>" as ">"
            try p.lexer.nextInsideJSXElement();
            if (p.lexer.token != .t_greater_than) {
                try p.lexer.expected(.t_greater_than);
            }

            return p.e(E.JSXElement{
                .tag = start_tag,
                .properties = properties,
                .key = key_prop,
                .flags = flags,
            }, loc);
        }

        // Use ExpectJSXElementChild() so we parse child strings
        try p.lexer.expectJSXElementChild(.t_greater_than);
        var children = List(Expr).init(p.allocator);

        while (true) {
            switch (p.lexer.token) {
                .t_string_literal => {
                    try children.append(p.e(p.lexer.toEString(), loc));
                    try p.lexer.nextJSXElementChild();
                },
                .t_open_brace => {
                    // Use Next() instead of NextJSXElementChild() here since the next token is an expression
                    try p.lexer.next();

                    // The "..." here is ignored (it's used to signal an array type in TypeScript)
                    if (p.lexer.token == .t_dot_dot_dot and p.options.ts) {
                        try p.lexer.next();
                    }

                    // The expression is optional, and may be absent
                    if (p.lexer.token != .t_close_brace) {
                        try children.append(try p.parseExpr(.lowest));
                    }

                    // Use ExpectJSXElementChild() so we parse child strings
                    try p.lexer.expectJSXElementChild(.t_close_brace);
                },
                .t_less_than => {
                    const less_than_loc = p.lexer.loc();
                    try p.lexer.nextInsideJSXElement();

                    if (p.lexer.token != .t_slash) {
                        // This is a child element
                        children.append(p.parseJSXElement(less_than_loc) catch unreachable) catch unreachable;

                        // The call to parseJSXElement() above doesn't consume the last
                        // TGreaterThan because the caller knows what Next() function to call.
                        // Use NextJSXElementChild() here since the next token is an element
                        // child.
                        try p.lexer.nextJSXElementChild();
                        continue;
                    }

                    // This is the closing element
                    try p.lexer.nextInsideJSXElement();
                    const end_tag = try JSXTag.parse(p);
                    if (!strings.eql(end_tag.name, tag.name)) {
                        try p.log.addRangeErrorFmt(p.source, end_tag.range, p.allocator, "Expected closing tag </{s}> to match opening tag <{s}>", .{
                            tag.name,
                            end_tag.name,
                        });
                        p.panic("", .{});
                    }

                    if (p.lexer.token != .t_greater_than) {
                        try p.lexer.expected(.t_greater_than);
                    }

                    return p.e(E.JSXElement{
                        .tag = end_tag.data.asExpr(),
                        .children = children.toOwnedSlice(),
                        .properties = properties,
                        .key = key_prop,
                        .flags = flags,
                    }, loc);
                },
                else => {
                    try p.lexer.unexpected();
                    p.panic("", .{});
                },
            }
        }
    }

    pub fn willNeedBindingPattern(p: *P) bool {
        switch (p.lexer.token) {
            .t_equals => {
                // "[a] = b;"
                return true;
            },
            .t_in => {
                // "for ([a] in b) {}"
                return !p.allow_in;
            },
            .t_identifier => {
                // "for ([a] of b) {}"
                return p.allow_in and p.lexer.isContextualKeyword("of");
            },
            else => {
                return false;
            },
        }
    }

    pub fn trySkipTypeScriptTypeArgumentsWithBacktracking(p: *P) bool {
        notimpl();
        // return false;
    }
    pub fn parsePrefix(p: *P, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
        return try p._parsePrefix(level, errors orelse &DeferredErrors.None, flags);
    }

    pub fn appendPart(p: *P, parts: *List(js_ast.Part), stmts: []Stmt) !void {
        p.symbol_uses = SymbolUseMap.init(p.allocator);
        p.declared_symbols.deinit();
        p.declared_symbols = @TypeOf(p.declared_symbols).init(p.allocator);
        p.import_records_for_current_part.deinit();
        p.import_records_for_current_part = @TypeOf(p.import_records_for_current_part).init(p.allocator);
        p.scopes_for_current_part.deinit();
        p.scopes_for_current_part = @TypeOf(p.scopes_for_current_part).init(p.allocator);
        var opts = PrependTempRefsOpts{};
        var partStmts = List(Stmt).fromOwnedSlice(p.allocator, stmts);
        try p.visitStmtsAndPrependTempRefs(&partStmts, &opts);

        // Insert any relocated variable statements now
        if (p.relocated_top_level_vars.items.len > 0) {
            var already_declared = RefBoolMap.init(p.allocator);
            for (p.relocated_top_level_vars.items) |*local| {
                // Follow links because "var" declarations may be merged due to hoisting
                while (local.ref != null) {
                    const link = p.symbols.items[local.ref.?.inner_index].link orelse break;
                    if (link.isNull()) {
                        break;
                    }
                    local.ref = link;
                }
                const ref = local.ref orelse continue;
                if (!already_declared.contains(ref)) {
                    try already_declared.put(ref, true);

                    const decls = try p.allocator.alloc(G.Decl, 1);
                    decls[0] = Decl{
                        .binding = p.b(B.Identifier{ .ref = ref }, local.loc),
                    };
                    try partStmts.append(p.s(S.Local{ .decls = decls }, local.loc));
                }
            }
            p.relocated_top_level_vars.deinit();
            p.relocated_top_level_vars = @TypeOf(p.relocated_top_level_vars).init(p.allocator);

            // Follow links because "var" declarations may be merged due to hoisting

            // while (true) {
            //     const link = p.symbols.items[local.ref.inner_index].link;
            // }
        }

        if (partStmts.items.len > 0) {
            const _stmts = partStmts.toOwnedSlice();
            var part = js_ast.Part{
                .stmts = _stmts,
                .symbol_uses = p.symbol_uses,
                .declared_symbols = p.declared_symbols.toOwnedSlice(),
                .import_record_indices = p.import_records_for_current_part.toOwnedSlice(),
                .scopes = p.scopes_for_current_part.toOwnedSlice(),
                .can_be_removed_if_unused = p.stmtsCanBeRemovedIfUnused(_stmts),
            };
            try parts.append(part);
        }
    }

    pub fn bindingCanBeRemovedIfUnused(p: *P, binding: Binding) bool {
        switch (binding.data) {
            .b_array => |bi| {
                for (bi.items) |item| {
                    if (!p.bindingCanBeRemovedIfUnused(item.binding)) {
                        return false;
                    }

                    if (item.default_value) |default| {
                        if (!p.exprCanBeRemovedIfUnused(default)) {
                            return false;
                        }
                    }
                }
            },
            .b_object => |bi| {
                for (bi.properties) |property| {
                    if (!property.flags.is_spread and !p.exprCanBeRemovedIfUnused(property.key)) {
                        return false;
                    }

                    if (!p.bindingCanBeRemovedIfUnused(property.value)) {
                        return false;
                    }

                    if (property.default_value) |default| {
                        if (!p.exprCanBeRemovedIfUnused(default)) {
                            return false;
                        }
                    }
                }
            },
            else => {},
        }

        return true;
    }

    pub fn stmtsCanBeRemovedIfUnused(p: *P, stmts: []Stmt) bool {
        for (stmts) |stmt| {
            switch (stmt.data) {
                // These never have side effects
                .s_function, .s_empty => {},

                // Let these be removed if they are unused. Note that we also need to
                // check if the imported file is marked as "sideEffects: false" before we
                // can remove a SImport statement. Otherwise the import must be kept for
                // its side effects.
                .s_import => |st| {},
                .s_class => |st| {
                    if (!p.classCanBeRemovedIfUnused(&st.class)) {
                        return false;
                    }
                },
                .s_expr => |st| {
                    if (st.does_not_affect_tree_shaking) {} else if (!p.exprCanBeRemovedIfUnused(st.value)) {
                        return false;
                    }
                },
                .s_local => |st| {
                    for (st.decls) |decl| {
                        if (!p.bindingCanBeRemovedIfUnused(decl.binding)) {
                            return false;
                        }

                        if (decl.value) |decl_value| {
                            if (!p.exprCanBeRemovedIfUnused(decl_value)) {
                                return false;
                            }
                        }
                    }
                },

                // Exports are tracked separately, so this isn't necessary
                .s_export_clause, .s_export_from => {},

                .s_export_default => |st| {
                    switch (st.value) {
                        .stmt => |s2| {
                            switch (s2.data) {
                                // These never have side effects
                                .s_function => {},
                                .s_class => |class| {
                                    if (!p.classCanBeRemovedIfUnused(&class.class)) {
                                        return false;
                                    }
                                },
                                else => {
                                    Global.panic("Unexpected type in export default: {s}", .{s2});
                                },
                            }
                        },
                        .expr => |exp| {
                            if (!p.exprCanBeRemovedIfUnused(exp)) {
                                return false;
                            }
                        },
                    }
                },
                else => {
                    return false;
                },
            }
        }

        return true;
    }

    pub fn visitStmtsAndPrependTempRefs(p: *P, stmts: *List(Stmt), opts: *PrependTempRefsOpts) !void {
        var old_temp_refs = p.temp_refs_to_declare;
        var old_temp_ref_count = p.temp_ref_count;
        p.temp_refs_to_declare.deinit();
        p.temp_refs_to_declare = @TypeOf(p.temp_refs_to_declare).init(p.allocator);
        p.temp_ref_count = 0;

        try p.visitStmts(stmts, opts.kind);

        // Prepend values for "this" and "arguments"
        if (opts.fn_body_loc != null) {
            // Capture "this"
            if (p.fn_only_data_visit.this_capture_ref) |ref| {
                try p.temp_refs_to_declare.append(TempRef{
                    .ref = ref,
                    .value = p.e(E.This{}, opts.fn_body_loc orelse p.panic("Internal error: Expected opts.fn_body_loc to exist", .{})),
                });
            }
        }
    }

    pub fn recordDeclaredSymbol(p: *P, ref: Ref) !void {
        try p.declared_symbols.append(js_ast.DeclaredSymbol{
            .ref = ref,
            .is_top_level = p.current_scope == p.module_scope,
        });
    }

    pub fn visitExpr(p: *P, expr: Expr) Expr {
        return p.visitExprInOut(expr, ExprIn{});
    }

    pub fn visitFunc(p: *P, func: *G.Fn, open_parens_loc: logger.Loc) void {
        const old_fn_or_arrow_data = p.fn_or_arrow_data_visit;
        const old_fn_only_data = p.fn_only_data_visit;
        p.fn_or_arrow_data_visit = FnOrArrowDataVisit{ .is_async = func.flags.is_async };
        p.fn_only_data_visit = FnOnlyDataVisit{ .is_this_nested = true, .arguments_ref = func.arguments_ref };

        if (func.name) |name| {
            if (name.ref) |name_ref| {
                p.recordDeclaredSymbol(name_ref) catch unreachable;
                const symbol_name = p.symbols.items[name_ref.inner_index].original_name;
                if (isEvalOrArguments(symbol_name)) {
                    p.markStrictModeFeature(.eval_or_arguments, js_lexer.rangeOfIdentifier(p.source, name.loc), symbol_name) catch unreachable;
                }
            }
        }

        p.pushScopeForVisitPass(.function_args, open_parens_loc) catch unreachable;
        p.visitArgs(
            func.args,
            VisitArgsOpts{
                .has_rest_arg = func.flags.has_rest_arg,
                .body = func.body.?.stmts,
                .is_unique_formal_parameters = true,
            },
        );

        assert(func.body != null);
        p.pushScopeForVisitPass(.function_body, func.body.?.loc) catch unreachable;
        var stmts = List(Stmt).fromOwnedSlice(p.allocator, func.body.?.stmts);
        var temp_opts = PrependTempRefsOpts{ .kind = StmtsKind.fn_body, .fn_body_loc = func.body.?.loc };
        p.visitStmtsAndPrependTempRefs(&stmts, &temp_opts) catch unreachable;
        func.body.?.stmts = stmts.toOwnedSlice();

        p.popScope();
        p.popScope();

        p.fn_or_arrow_data_visit = old_fn_or_arrow_data;
        p.fn_only_data_visit = old_fn_only_data;
    }

    pub fn maybeKeepExprSymbolName(p: *P, expr: Expr, original_name: string, was_anonymous_named_expr: bool) Expr {
        return if (was_anonymous_named_expr) p.keepExprSymbolName(expr, original_name) else expr;
    }

    pub fn valueForThis(p: *P, loc: logger.Loc) ?Expr {
        // Substitute "this" if we're inside a static class property initializer
        if (p.fn_only_data_visit.this_class_static_ref) |ref| {
            p.recordUsage(ref);
            return p.e(E.Identifier{ .ref = ref }, loc);
        }

        // oroigianlly was !=- modepassthrough
        if (!p.fn_only_data_visit.is_this_nested) {
            if (p.has_es_module_syntax) {
                // In an ES6 module, "this" is supposed to be undefined. Instead of
                // doing this at runtime using "fn.call(undefined)", we do it at
                // compile time using expression substitution here.
                return Expr{ .loc = loc, .data = nullValueExpr };
            } else {
                // In a CommonJS module, "this" is supposed to be the same as "exports".
                // Instead of doing this at runtime using "fn.call(module.exports)", we
                // do it at compile time using expression substitution here.
                p.recordUsage(p.exports_ref);
                return p.e(E.Identifier{ .ref = p.exports_ref }, loc);
            }
        }

        return null;
    }

    pub fn visitExprInOut(p: *P, expr: Expr, in: ExprIn) Expr {
        // Output.print("\nVisit: {s} - {d}\n", .{ @tagName(expr.data), expr.loc.start });
        switch (expr.data) {
            .e_null, .e_super, .e_boolean, .e_big_int, .e_reg_exp, .e_new_target, .e_undefined => {},
            .e_string => |e_| {
                // If you're using this, you're probably not using 0-prefixed legacy octal notation
                // if e.LegacyOctalLoc.Start > 0 {
            },
            .e_number => |e_| {
                // idc about legacy octal loc
            },
            .e_this => |e_| {
                if (p.valueForThis(expr.loc)) |exp| {
                    return exp;
                }

                //         		// Capture "this" inside arrow functions that will be lowered into normal
                // // function expressions for older language environments
                // if p.fnOrArrowDataVisit.isArrow && p.options.unsupportedJSFeatures.Has(compat.Arrow) && p.fnOnlyDataVisit.isThisNested {
                // 	return js_ast.Expr{Loc: expr.Loc, Data: &js_ast.EIdentifier{Ref: p.captureThis()}}, exprOut{}
                // }
            },

            .e_import_meta => |exp| {
                const is_delete_target = std.meta.activeTag(p.delete_target) == .e_import_meta and exp == p.delete_target.e_import_meta;

                if (p.define.dots.get("meta")) |meta| {
                    for (meta) |define| {
                        if (p.isDotDefineMatch(expr, define.parts)) {
                            // Substitute user-specified defines
                            return p.valueForDefine(expr.loc, in.assign_target, is_delete_target, &define.data);
                        }
                    }
                }

                if (!p.import_meta_ref.isNull()) {
                    p.recordUsage(p.import_meta_ref);
                    return p.e(E.Identifier{ .ref = p.import_meta_ref }, expr.loc);
                }
            },
            .e_spread => |exp| {
                exp.value = p.visitExpr(exp.value);
            },
            .e_identifier => |e_| {
                const is_delete_target = @as(Expr.Tag, p.delete_target) == .e_identifier and e_ == p.delete_target.e_identifier;

                const name = p.loadNameFromRef(e_.ref);
                if (p.isStrictMode() and js_lexer.StrictModeReservedWords.has(name)) {
                    p.markStrictModeFeature(.reserved_word, js_lexer.rangeOfIdentifier(p.source, expr.loc), name) catch unreachable;
                }

                const result = p.findSymbol(expr.loc, name) catch unreachable;

                e_.must_keep_due_to_with_stmt = result.is_inside_with_scope;
                e_.ref = result.ref;

                // Handle assigning to a constant
                if (in.assign_target != .none and p.symbols.items[result.ref.inner_index].kind == .cconst) {
                    const r = js_lexer.rangeOfIdentifier(p.source, expr.loc);
                    p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot assign to {s} because it is a constant", .{name}) catch unreachable;
                }

                var original_name: ?string = null;

                // Substitute user-specified defines for unbound symbols
                if (p.symbols.items[e_.ref.inner_index].kind == .unbound and !result.is_inside_with_scope and !is_delete_target) {
                    if (p.define.identifiers.get(name)) |def| {
                        if (!def.isUndefined()) {
                            const newvalue = p.valueForDefine(expr.loc, in.assign_target, is_delete_target, &def);

                            // Don't substitute an identifier for a non-identifier if this is an
                            // assignment target, since it'll cause a syntax error
                            if (@as(Expr.Tag, newvalue.data) == .e_identifier or in.assign_target == .none) {
                                return newvalue;
                            }

                            original_name = def.original_name;
                        }

                        // Copy the side effect flags over in case this expression is unused
                        if (def.can_be_removed_if_unused) {
                            e_.can_be_removed_if_unused = true;
                        }
                        if (def.call_can_be_unwrapped_if_unused and !p.options.ignore_dce_annotations) {
                            e_.call_can_be_unwrapped_if_unused = true;
                        }
                    }
                }

                return p.handleIdentifier(expr.loc, e_, original_name, IdentifierOpts{
                    .assign_target = in.assign_target,
                    .is_delete_target = is_delete_target,
                    .was_originally_identifier = true,
                });
            },
            .e_private_identifier => |e_| {
                p.panic("Unexpected private identifier. This is an internal error - not your fault.", .{});
            },
            .e_jsx_element => |e_| {
                const tag = tagger: {
                    if (e_.tag) |_tag| {
                        break :tagger p.visitExpr(_tag);
                    } else {
                        break :tagger p.jsxStringsToMemberExpression(expr.loc, p.jsx_fragment_ref);
                    }
                };

                for (e_.properties) |property, i| {
                    if (property.kind != .spread) {
                        e_.properties[i].key = p.visitExpr(e_.properties[i].key.?);
                    }

                    if (property.value != null) {
                        e_.properties[i].value = p.visitExpr(e_.properties[i].value.?);
                    }

                    if (property.initializer != null) {
                        e_.properties[i].initializer = p.visitExpr(e_.properties[i].initializer.?);
                    }
                }

                const runtime = if (p.options.jsx.runtime == .automatic and !e_.flags.is_key_before_rest) options.JSX.Runtime.automatic else options.JSX.Runtime.classic;

                // TODO: maybe we should split these into two different AST Nodes
                // That would reduce the amount of allocations a little
                switch (runtime) {
                    .classic => {
                        // Arguments to createElement()
                        const args = p.allocator.alloc(Expr, 1 + e_.children.len) catch unreachable;
                        var i: usize = 1;
                        if (e_.properties.len > 0) {
                            if (e_.key) |key| {
                                var props = List(G.Property).fromOwnedSlice(p.allocator, e_.properties);
                                props.append(G.Property{ .key = Expr{ .loc = key.loc, .data = keyExprData }, .value = key }) catch unreachable;
                                args[0] = p.e(E.Object{ .properties = props.toOwnedSlice() }, expr.loc);
                            } else {
                                args[0] = p.e(E.Object{ .properties = e_.properties }, expr.loc);
                            }
                        } else {
                            args[0] = p.e(E.Null{}, expr.loc);
                        }

                        for (e_.children) |child| {
                            args[i] = p.visitExpr(child);
                            i += 1;
                        }

                        // Call createElement()
                        return p.e(E.Call{
                            .target = p.jsxStringsToMemberExpression(expr.loc, p.jsx_runtime_ref),
                            .args = args,
                            // Enable tree shaking
                            .can_be_unwrapped_if_unused = !p.options.ignore_dce_annotations,
                        }, expr.loc);
                    },
                    .automatic => {
                        // Assuming jsx development for now.
                        // React.jsxDEV(type, arguments, key, isStaticChildren, source, self)
                        // React.jsx(type, arguments, key)

                        const args = p.allocator.alloc(Expr, if (p.options.jsx.development) @as(usize, 6) else @as(usize, 4)) catch unreachable;
                        args[0] = tag;
                        var props = List(G.Property).fromOwnedSlice(p.allocator, e_.properties);
                        // arguments needs to be like
                        // {
                        //    ...props,
                        //    children: []
                        // }
                        for (e_.children) |child, i| {
                            e_.children[i] = p.visitExpr(child);
                        }
                        const children_key = Expr{ .data = jsxChildrenKeyData, .loc = expr.loc };

                        if (e_.children.len == 1) {
                            props.append(G.Property{
                                .key = children_key,
                                .value = e_.children[0],
                            }) catch unreachable;
                        } else {
                            props.append(G.Property{
                                .key = children_key,
                                .value = p.e(E.Array{
                                    .items = e_.children,
                                    .is_single_line = e_.children.len < 2,
                                }, expr.loc),
                            }) catch unreachable;
                        }

                        args[1] = p.e(E.Object{
                            .properties = props.toOwnedSlice(),
                        }, expr.loc);
                        if (e_.key) |key| {
                            args[2] = key;
                        } else {
                            args[2] = Expr{ .loc = expr.loc, .data = nullValueExpr };
                        }

                        if (p.options.jsx.development) {
                            args[3] = Expr{ .loc = expr.loc, .data = falseValueExpr };
                            // placeholder src prop for now
                            var source = p.allocator.alloc(G.Property, 3) catch unreachable;
                            p.recordUsage(p.jsx_filename_ref);
                            source[0] = G.Property{
                                .key = Expr{ .loc = expr.loc, .data = Prefill.Data.Filename },
                                .value = p.e(E.Identifier{ .ref = p.jsx_filename_ref }, expr.loc),
                            };

                            source[1] = G.Property{
                                .key = Expr{ .loc = expr.loc, .data = Prefill.Data.LineNumber },
                                .value = p.e(E.Number{ .value = @intToFloat(f64, expr.loc.start) }, expr.loc),
                            };

                            source[2] = G.Property{
                                .key = Expr{ .loc = expr.loc, .data = Prefill.Data.ColumnNumber },
                                .value = p.e(E.Number{ .value = @intToFloat(f64, expr.loc.start) }, expr.loc),
                            };

                            args[4] = p.e(E.Object{
                                .properties = source,
                            }, expr.loc);
                            args[5] = Expr{ .data = Prefill.Data.This, .loc = expr.loc };
                        }

                        return p.e(E.Call{
                            .target = p.jsxStringsToMemberExpressionAutomatic(expr.loc),
                            .args = args,
                            // Enable tree shaking
                            .can_be_unwrapped_if_unused = !p.options.ignore_dce_annotations,
                            .was_jsx_element = true,
                        }, expr.loc);
                    },
                    else => unreachable,
                }
            },

            .e_template => |e_| {
                if (e_.tag) |tag| {
                    e_.tag = p.visitExpr(tag);
                }

                var i: usize = 0;
                while (i < e_.parts.len) : (i += 1) {
                    e_.parts[i].value = p.visitExpr(e_.parts[i].value);
                }
            },

            .e_binary => |e_| {
                switch (e_.left.data) {
                    // Special-case private identifiers
                    .e_private_identifier => |private| {
                        if (e_.op == .bin_in) {
                            const name = p.loadNameFromRef(private.ref);
                            const result = p.findSymbol(e_.left.loc, name) catch unreachable;
                            private.ref = result.ref;

                            // Unlike regular identifiers, there are no unbound private identifiers
                            const symbol: Symbol = p.symbols.items[result.ref.inner_index];
                            if (!Symbol.isKindPrivate(symbol.kind)) {
                                const r = logger.Range{ .loc = e_.left.loc, .len = @intCast(i32, name.len) };
                                p.log.addRangeErrorFmt(p.source, r, p.allocator, "Private name \"{s}\" must be declared in an enclosing class", .{name}) catch unreachable;
                            }

                            e_.right = p.visitExpr(e_.right);
                            // privateSymbolNeedsToBeLowered
                            return expr;
                        }
                    },
                    else => {},
                }

                const is_call_target = @as(Expr.Tag, p.call_target) == .e_binary and e_ == p.call_target.e_binary;
                const is_stmt_expr = @as(Expr.Tag, p.stmt_expr_value) == .e_binary and e_ == p.stmt_expr_value.e_binary;
                const was_anonymous_named_expr = p.isAnonymousNamedExpr(e_.right);

                e_.left = p.visitExprInOut(e_.left, ExprIn{
                    .assign_target = e_.op.binaryAssignTarget(),
                });

                // Mark the control flow as dead if the branch is never taken
                switch (e_.op) {
                    .bin_logical_or => {
                        const side_effects = SideEffects.toBoolean(e_.left.data);
                        if (side_effects.ok and side_effects.value) {
                            // "true || dead"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.right = p.visitExpr(e_.right);
                            p.is_control_flow_dead = old;
                        } else {
                            e_.right = p.visitExpr(e_.right);
                        }
                    },
                    .bin_logical_and => {
                        const side_effects = SideEffects.toBoolean(e_.left.data);
                        if (side_effects.ok and !side_effects.value) {
                            // "false && dead"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.right = p.visitExpr(e_.right);
                            p.is_control_flow_dead = old;
                        } else {
                            e_.right = p.visitExpr(e_.right);
                        }
                    },
                    .bin_nullish_coalescing => {
                        const side_effects = SideEffects.toNullOrUndefined(e_.left.data);
                        if (side_effects.ok and side_effects.value) {
                            // "false && dead"
                            const old = p.is_control_flow_dead;
                            p.is_control_flow_dead = true;
                            e_.right = p.visitExpr(e_.right);
                            p.is_control_flow_dead = old;
                        } else {
                            e_.right = p.visitExpr(e_.right);
                        }
                    },
                    else => {
                        e_.right = p.visitExpr(e_.right);
                    },
                }

                // Always put constants on the right for equality comparisons to help
                // reduce the number of cases we have to check during pattern matching. We
                // can only reorder expressions that do not have any side effects.
                switch (e_.op) {
                    .bin_loose_eq, .bin_loose_ne, .bin_strict_eq, .bin_strict_ne => {
                        if (SideEffects.isPrimitiveToReorder(e_.left.data) and !SideEffects.isPrimitiveToReorder(e_.right.data)) {
                            const _left = e_.left;
                            const _right = e_.right;
                            e_.left = _right;
                            e_.right = _left;
                        }
                    },
                    else => {},
                }

                switch (e_.op) {
                    .bin_comma => {
                        // notimpl();
                    },
                    .bin_loose_eq => {
                        const equality = SideEffects.eql(e_.left.data, e_.right.data, p);
                        if (equality.ok) {
                            return p.e(
                                E.Boolean{ .value = equality.equal },
                                expr.loc,
                            );
                        }

                        // const after_op_loc = locAfterOp(e_.);
                        // TODO: warn about equality check
                        // TODO: warn about typeof string

                    },
                    .bin_strict_eq => {
                        const equality = SideEffects.eql(e_.left.data, e_.right.data, p);
                        if (equality.ok) {
                            return p.e(E.Boolean{ .value = equality.ok }, expr.loc);
                        }

                        // const after_op_loc = locAfterOp(e_.);
                        // TODO: warn about equality check
                        // TODO: warn about typeof string
                    },
                    .bin_loose_ne => {
                        const equality = SideEffects.eql(e_.left.data, e_.right.data, p);
                        if (equality.ok) {
                            return p.e(E.Boolean{ .value = !equality.ok }, expr.loc);
                        }
                        // const after_op_loc = locAfterOp(e_.);
                        // TODO: warn about equality check
                        // TODO: warn about typeof string

                        // "x != void 0" => "x != null"
                        if (@as(Expr.Tag, e_.right.data) == .e_undefined) {
                            e_.right = p.e(E.Null{}, e_.right.loc);
                        }
                    },
                    .bin_strict_ne => {
                        const equality = SideEffects.eql(e_.left.data, e_.right.data, p);
                        if (equality.ok) {
                            return p.e(E.Boolean{ .value = !equality.ok }, expr.loc);
                        }
                    },
                    .bin_nullish_coalescing => {
                        const nullorUndefined = SideEffects.toNullOrUndefined(e_.left.data);
                        if (!nullorUndefined.value) {
                            return e_.left;
                        } else if (nullorUndefined.side_effects == .no_side_effects) {
                            // TODO:
                            // "(null ?? fn)()" => "fn()"
                            // "(null ?? this.fn)" => "this.fn"
                            // "(null ?? this.fn)()" => "(0, this.fn)()"

                        }
                    },
                    .bin_logical_or => {
                        const side_effects = SideEffects.toBoolean(e_.left.data);
                        if (side_effects.ok and side_effects.value) {
                            return e_.left;
                        } else if (side_effects.ok) {
                            // TODO:
                            // "(0 || fn)()" => "fn()"
                            // "(0 || this.fn)" => "this.fn"
                            // "(0 || this.fn)()" => "(0, this.fn)()"
                        }
                    },
                    .bin_logical_and => {
                        const side_effects = SideEffects.toBoolean(e_.left.data);
                        if (side_effects.ok) {
                            return e_.left;
                        }

                        // TODO:
                        // "(1 && fn)()" => "fn()"
                        // "(1 && this.fn)" => "this.fn"
                        // "(1 && this.fn)()" => "(0, this.fn)()"
                    },
                    .bin_add => {
                        if (p.should_fold_numeric_constants) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.e(E.Number{ .value = vals[0] + vals[1] }, expr.loc);
                            }
                        }

                        // TODO: fold string addition
                    },
                    .bin_sub => {
                        if (p.should_fold_numeric_constants) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.e(E.Number{ .value = vals[0] - vals[1] }, expr.loc);
                            }
                        }
                    },
                    .bin_mul => {
                        if (p.should_fold_numeric_constants) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.e(E.Number{ .value = vals[0] * vals[1] }, expr.loc);
                            }
                        }
                    },
                    .bin_div => {
                        if (p.should_fold_numeric_constants) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.e(E.Number{ .value = vals[0] / vals[1] }, expr.loc);
                            }
                        }
                    },
                    .bin_rem => {
                        if (p.should_fold_numeric_constants) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                // is this correct?
                                return p.e(E.Number{ .value = std.math.mod(f64, vals[0], vals[1]) catch 0.0 }, expr.loc);
                            }
                        }
                    },
                    .bin_pow => {
                        if (p.should_fold_numeric_constants) {
                            if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                                return p.e(E.Number{ .value = std.math.pow(f64, vals[0], vals[1]) }, expr.loc);
                            }
                        }
                    },
                    .bin_shl => {
                        // TODO:
                        // if (p.should_fold_numeric_constants) {
                        //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                        //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) << @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                        //     }
                        // }
                    },
                    .bin_shr => {
                        // TODO:
                        // if (p.should_fold_numeric_constants) {
                        //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                        //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                        //     }
                        // }
                    },
                    .bin_u_shr => {
                        // TODO:
                        // if (p.should_fold_numeric_constants) {
                        //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                        //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                        //     }
                        // }
                    },
                    .bin_bitwise_and => {
                        // TODO:
                        // if (p.should_fold_numeric_constants) {
                        //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                        //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                        //     }
                        // }
                    },
                    .bin_bitwise_or => {
                        // TODO:
                        // if (p.should_fold_numeric_constants) {
                        //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                        //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                        //     }
                        // }
                    },
                    .bin_bitwise_xor => {
                        // TODO:
                        // if (p.should_fold_numeric_constants) {
                        //     if (Expr.extractNumericValues(e_.left.data, e_.right.data)) |vals| {
                        //         return p.e(E.Number{ .value = ((@floatToInt(i32, vals[0]) >> @floatToInt(u32, vals[1])) & 31) }, expr.loc);
                        //     }
                        // }
                    },
                    // ---------------------------------------------------------------------------------------------------
                    // ---------------------------------------------------------------------------------------------------
                    // ---------------------------------------------------------------------------------------------------
                    // ---------------------------------------------------------------------------------------------------
                    .bin_assign => {

                        // Optionally preserve the name
                        if (@as(Expr.Tag, e_.left.data) == .e_identifier) {
                            e_.right = p.maybeKeepExprSymbolName(e_.right, p.symbols.items[e_.left.data.e_identifier.ref.inner_index].original_name, was_anonymous_named_expr);
                        }
                    },
                    .bin_add_assign => {
                        // notimpl();
                    },
                    .bin_sub_assign => {
                        // notimpl();
                    },
                    .bin_mul_assign => {
                        // notimpl();
                    },
                    .bin_div_assign => {
                        // notimpl();
                    },
                    .bin_rem_assign => {
                        // notimpl();
                    },
                    .bin_pow_assign => {
                        // notimpl();
                    },
                    .bin_shl_assign => {
                        // notimpl();
                    },
                    .bin_shr_assign => {
                        // notimpl();
                    },
                    .bin_u_shr_assign => {
                        // notimpl();
                    },
                    .bin_bitwise_or_assign => {
                        // notimpl();
                    },
                    .bin_bitwise_and_assign => {
                        // notimpl();
                    },
                    .bin_bitwise_xor_assign => {
                        // notimpl();
                    },
                    .bin_nullish_coalescing_assign => {
                        // notimpl();
                    },
                    .bin_logical_and_assign => {
                        // notimpl();
                    },
                    .bin_logical_or_assign => {
                        // notimpl();
                    },
                    else => {},
                }
            },
            .e_index => |e_| {
                const is_call_target = std.meta.activeTag(p.call_target) == .e_index and e_ == p.call_target.e_index;
                const is_delete_target = std.meta.activeTag(p.delete_target) == .e_index and e_ == p.delete_target.e_index;

                const target = p.visitExprInOut(e_.target, ExprIn{
                    // this is awkward due to a zig compiler bug
                    .has_chain_parent = (e_.optional_chain orelse js_ast.OptionalChain.start) == js_ast.OptionalChain.ccontinue,
                });
                e_.target = target;

                if (e_.optional_chain == null and @as(Expr.Tag, e_.index.data) == .e_string) {
                    if (p.maybeRewritePropertyAccess(
                        expr.loc,
                        in.assign_target,
                        is_delete_target,
                        e_.target,
                        e_.index.data.e_string.string(p.allocator) catch unreachable,
                        e_.index.loc,
                        is_call_target,
                    )) |val| {
                        return val;
                    }
                }

                // Create an error for assigning to an import namespace when bundling. Even
                // though this is a run-time error, we make it a compile-time error when
                // bundling because scope hoisting means these will no longer be run-time
                // errors.
                if ((in.assign_target != .none or is_delete_target) and @as(Expr.Tag, e_.target.data) == .e_identifier and p.symbols.items[e_.target.data.e_identifier.ref.inner_index].kind == .import) {
                    const r = js_lexer.rangeOfIdentifier(p.source, e_.target.loc);
                    p.log.addRangeErrorFmt(
                        p.source,
                        r,
                        p.allocator,
                        "Cannot assign to property on import \"{s}\"",
                        .{p.symbols.items[e_.target.data.e_identifier.ref.inner_index].original_name},
                    ) catch unreachable;
                }

                return p.e(e_, expr.loc);
            },
            .e_unary => |e_| {
                switch (e_.op) {
                    .un_typeof => {
                        e_.value = p.visitExprInOut(e_.value, ExprIn{ .assign_target = e_.op.unaryAssignTarget() });

                        if (SideEffects.toTypeof(e_.value.data)) |typeof| {
                            return p.e(E.String{ .utf8 = typeof }, expr.loc);
                        }
                    },
                    .un_delete => {
                        e_.value = p.visitExprInOut(e_.value, ExprIn{ .has_chain_parent = true });
                    },
                    else => {
                        e_.value = p.visitExprInOut(e_.value, ExprIn{ .assign_target = e_.op.unaryAssignTarget() });

                        // Post-process the unary expression

                        switch (e_.op) {
                            .un_not => {
                                const side_effects = SideEffects.toBoolean(e_.value.data);
                                if (side_effects.ok) {
                                    return p.e(E.Boolean{ .value = !side_effects.value }, expr.loc);
                                }

                                // maybe won't do this idk
                                if (Expr.maybeSimplifyNot(&e_.value, p.allocator)) |exp| {
                                    return exp;
                                }
                            },
                            .un_void => {
                                if (p.exprCanBeRemovedIfUnused(e_.value)) {
                                    return p.e(E.Undefined{}, e_.value.loc);
                                }
                            },
                            .un_pos => {
                                if (SideEffects.toNumber(e_.value.data)) |num| {
                                    return p.e(E.Number{ .value = num }, expr.loc);
                                }
                            },
                            .un_neg => {
                                if (SideEffects.toNumber(e_.value.data)) |num| {
                                    return p.e(E.Number{ .value = -num }, expr.loc);
                                }
                            },

                            ////////////////////////////////////////////////////////////////////////////////

                            .un_pre_dec => {
                                // TODO: private fields
                            },
                            .un_pre_inc => {
                                // TODO: private fields
                            },
                            .un_post_dec => {
                                // TODO: private fields
                            },
                            .un_post_inc => {
                                // TODO: private fields
                            },
                            else => {},
                        }
                    },
                }
            },
            .e_dot => |e_| {
                const is_delete_target = @as(Expr.Tag, p.delete_target) == .e_dot and e_ == p.delete_target.e_dot;
                const is_call_target = @as(Expr.Tag, p.call_target) == .e_dot and e_ == p.call_target.e_dot;

                if (p.define.dots.get(e_.name)) |parts| {
                    for (parts) |define| {
                        if (p.isDotDefineMatch(expr, define.parts)) {
                            // Substitute user-specified defines
                            if (!define.data.isUndefined()) {
                                // TODO: check this doesn't crash due to the pointer no longer being allocated
                                return p.valueForDefine(expr.loc, in.assign_target, is_delete_target, &define.data);
                            }

                            // Copy the side effect flags over in case this expression is unused
                            if (define.data.can_be_removed_if_unused) {
                                e_.can_be_removed_if_unused = true;
                            }

                            if (define.data.call_can_be_unwrapped_if_unused and !p.options.ignore_dce_annotations) {
                                e_.call_can_be_unwrapped_if_unused = true;
                            }

                            break;
                        }
                    }
                }

                // Track ".then().catch()" chains
                if (is_call_target and @as(Expr.Tag, p.then_catch_chain.next_target) == .e_dot and p.then_catch_chain.next_target.e_dot == e_) {
                    if (strings.eqlComptime(e_.name, "catch")) {
                        p.then_catch_chain = ThenCatchChain{
                            .next_target = e_.target.data,
                            .has_catch = true,
                        };
                    } else if (strings.eqlComptime(e_.name, "then")) {
                        p.then_catch_chain = ThenCatchChain{
                            .next_target = e_.target.data,
                            .has_catch = p.then_catch_chain.has_catch or p.then_catch_chain.has_multiple_args,
                        };
                    }
                }

                e_.target = p.visitExpr(e_.target);
                if (e_.optional_chain == null) {
                    if (p.maybeRewritePropertyAccess(
                        expr.loc,
                        in.assign_target,
                        is_delete_target,
                        e_.target,
                        e_.name,
                        e_.name_loc,
                        is_call_target,
                    )) |_expr| {
                        return _expr;
                    }
                }
            },
            .e_if => |e_| {
                const is_call_target = @as(Expr.Data, p.call_target) == .e_if and e_ == p.call_target.e_if;

                e_.test_ = p.visitExpr(e_.test_);

                const side_effects = SideEffects.toBoolean(e_.test_.data);

                if (!side_effects.ok) {
                    e_.yes = p.visitExpr(e_.yes);
                    e_.no = p.visitExpr(e_.no);
                } else {
                    // Mark the control flow as dead if the branch is never taken
                    if (side_effects.value) {
                        // "true ? live : dead"
                        e_.yes = p.visitExpr(e_.yes);
                        const old = p.is_control_flow_dead;
                        p.is_control_flow_dead = true;
                        e_.no = p.visitExpr(e_.no);
                        p.is_control_flow_dead = old;
                    } else {
                        // "false ? dead : live"
                        const old = p.is_control_flow_dead;
                        p.is_control_flow_dead = true;
                        e_.yes = p.visitExpr(e_.yes);
                        p.is_control_flow_dead = old;
                        e_.no = p.visitExpr(e_.no);
                    }
                }
            },
            .e_await => |e_| {
                p.await_target = e_.value.data;
                e_.value = p.visitExpr(e_.value);
            },
            .e_yield => |e_| {
                if (e_.value) |val| {
                    e_.value = p.visitExpr(val);
                }
            },
            .e_array => |e_| {
                if (in.assign_target != .none) {
                    if (e_.comma_after_spread) |spread| {
                        p.log.addRangeError(p.source, logger.Range{ .loc = spread, .len = 1 }, "Unexpected \",\" after rest pattern") catch unreachable;
                    }
                }

                var has_spread = false;
                var i: usize = 0;
                while (i < e_.items.len) : (i += 1) {
                    var item = e_.items[i];
                    const data = item.data;
                    switch (data) {
                        .e_missing => {},
                        .e_spread => |spread| {
                            spread.value = p.visitExprInOut(spread.value, ExprIn{ .assign_target = in.assign_target });
                        },
                        .e_binary => |e2| {
                            if (in.assign_target != .none and e2.op == .bin_assign) {
                                const was_anonymous_named_expr = p.isAnonymousNamedExpr(e2.right);
                                e2.left = p.visitExprInOut(e2.left, ExprIn{ .assign_target = .replace });
                                e2.right = p.visitExpr(e2.right);

                                if (@as(Expr.Tag, e2.left.data) == .e_identifier) {
                                    e2.right = p.maybeKeepExprSymbolName(
                                        e2.right,
                                        p.symbols.items[e2.left.data.e_identifier.ref.inner_index].original_name,
                                        was_anonymous_named_expr,
                                    );
                                }
                            } else {
                                item = p.visitExprInOut(item, ExprIn{ .assign_target = in.assign_target });
                            }
                        },
                        else => {
                            item = p.visitExprInOut(item, ExprIn{ .assign_target = in.assign_target });
                        },
                    }
                    e_.items[i] = item;
                }
            },
            .e_object => |e_| {
                if (in.assign_target != .none) {
                    p.maybeCommaSpreadError(e_.comma_after_spread);
                }

                var has_spread = false;
                var has_proto = false;
                for (e_.properties) |*property, i| {
                    if (property.kind != .spread) {
                        property.key = p.visitExpr(property.key orelse Global.panic("Expected property key", .{}));
                        const key = property.key.?;
                        // Forbid duplicate "__proto__" properties according to the specification
                        if (!property.flags.is_computed and !property.flags.was_shorthand and !property.flags.is_method and in.assign_target == .none and key.data.isStringValue() and strings.eqlComptime(
                            // __proto__ is utf8, assume it lives in refs
                            key.data.e_string.utf8,
                            "__proto__",
                        )) {
                            if (has_proto) {
                                const r = js_lexer.rangeOfIdentifier(p.source, key.loc);
                                p.log.addRangeError(p.source, r, "Cannot specify the \"__proto__\" property more than once per object") catch unreachable;
                            }
                            has_proto = true;
                        }
                    } else {
                        has_spread = true;
                    }

                    // Extract the initializer for expressions like "({ a: b = c } = d)"
                    if (in.assign_target != .none and property.initializer != null and property.value != null) {
                        switch (property.value.?.data) {
                            .e_binary => |bin| {
                                if (bin.op == .bin_assign) {
                                    property.initializer = bin.right;
                                    property.value = bin.left;
                                }
                            },
                            else => {},
                        }
                    }

                    if (property.value != null) {
                        property.value = p.visitExprInOut(property.value.?, ExprIn{ .assign_target = in.assign_target });
                    }

                    if (property.initializer != null) {
                        const was_anonymous_named_expr = p.isAnonymousNamedExpr(property.initializer orelse unreachable);
                        property.initializer = p.visitExprInOut(property.initializer.?, ExprIn{ .assign_target = in.assign_target });

                        if (property.value) |val| {
                            if (@as(Expr.Tag, val.data) == .e_identifier) {
                                property.initializer = p.maybeKeepExprSymbolName(
                                    property.initializer orelse unreachable,
                                    p.symbols.items[val.data.e_identifier.ref.inner_index].original_name,
                                    was_anonymous_named_expr,
                                );
                            }
                        }
                    }
                }
            },
            .e_import => |e_| {
                const state = TransposeState{
                    .is_await_target = if (p.await_target != null) p.await_target.?.e_import == e_ else false,
                    .is_then_catch_target = e_ == p.then_catch_chain.next_target.e_import and p.then_catch_chain.has_catch,
                    .loc = e_.expr.loc,
                };

                e_.expr = p.visitExpr(e_.expr);
                return p.import_transposer.maybeTransposeIf(e_.expr, state);

                // TODO: maybeTransposeIfExprChain
            },
            .e_call => |e_| {
                p.call_target = e_.target.data;

                p.then_catch_chain = ThenCatchChain{
                    .next_target = e_.target.data,
                    .has_multiple_args = e_.args.len >= 2,
                    .has_catch = @as(Expr.Tag, p.then_catch_chain.next_target) == .e_call and p.then_catch_chain.next_target.e_call == e_ and p.then_catch_chain.has_catch,
                };

                // Prepare to recognize "require.resolve()" calls
                // const could_be_require_resolve = (e_.args.len == 1 and @as(
                //     Expr.Tag,
                //     e_.target.data,
                // ) == .e_dot and e_.target.data.e_dot.optional_chain == null and strings.eql(
                //     e_.target.dat.e_dot.name,
                //     "resolve",
                // ));

                e_.target = p.visitExprInOut(e_.target, ExprIn{
                    .has_chain_parent = (e_.optional_chain orelse js_ast.OptionalChain.start) == .ccontinue,
                });
                // TODO: wan about import namespace call
                var has_spread = false;
                var i: usize = 0;
                while (i < e_.args.len) : (i += 1) {
                    e_.args[i] = p.visitExpr(e_.args[i]);
                    has_spread = has_spread or @as(Expr.Tag, e_.args[i].data) == .e_spread;
                }

                if (e_.optional_chain == null and @as(Expr.Tag, e_.target.data) == .e_identifier and e_.target.data.e_identifier.ref.eql(p.require_ref)) {
                    // Heuristic: omit warnings inside try/catch blocks because presumably
                    // the try/catch statement is there to handle the potential run-time
                    // error from the unbundled require() call failing.
                    if (e_.args.len == 1) {
                        return p.require_transposer.maybeTransposeIf(e_.args[0], null);
                    } else {
                        const r = js_lexer.rangeOfIdentifier(p.source, e_.target.loc);
                        p.log.addRangeDebug(p.source, r, "This call to \"require\" will not be bundled because it has multiple arguments") catch unreachable;
                    }
                }

                return expr;
            },
            .e_new => |e_| {
                e_.target = p.visitExpr(e_.target);
                // p.warnA

                var i: usize = 0;
                while (i < e_.args.len) : (i += 1) {
                    e_.args[i] = p.visitExpr(e_.args[i]);
                }
            },
            .e_arrow => |e_| {
                const old_fn_or_arrow_data = p.fn_or_arrow_data_visit;
                p.fn_or_arrow_data_visit = FnOrArrowDataVisit{
                    .is_arrow = true,
                    .is_async = e_.is_async,
                };

                // Mark if we're inside an async arrow function. This value should be true
                // even if we're inside multiple arrow functions and the closest inclosing
                // arrow function isn't async, as long as at least one enclosing arrow
                // function within the current enclosing function is async.
                const old_inside_async_arrow_fn = p.fn_only_data_visit.is_inside_async_arrow_fn;
                p.fn_only_data_visit.is_inside_async_arrow_fn = e_.is_async or p.fn_only_data_visit.is_inside_async_arrow_fn;

                p.pushScopeForVisitPass(.function_args, expr.loc) catch unreachable;
                var dupe = p.allocator.dupe(Stmt, e_.body.stmts) catch unreachable;

                p.visitArgs(e_.args, VisitArgsOpts{
                    .has_rest_arg = e_.has_rest_arg,
                    .body = dupe,
                    .is_unique_formal_parameters = true,
                });
                p.pushScopeForVisitPass(.function_body, e_.body.loc) catch unreachable;

                var stmts_list = List(Stmt).fromOwnedSlice(p.allocator, dupe);
                var temp_opts = PrependTempRefsOpts{ .kind = StmtsKind.fn_body };
                p.visitStmtsAndPrependTempRefs(&stmts_list, &temp_opts) catch unreachable;
                p.allocator.free(e_.body.stmts);
                e_.body.stmts = stmts_list.toOwnedSlice();
                p.popScope();
                p.popScope();

                p.fn_only_data_visit.is_inside_async_arrow_fn = old_inside_async_arrow_fn;
                p.fn_or_arrow_data_visit = old_fn_or_arrow_data;
            },
            .e_function => |e_| {
                p.visitFunc(&e_.func, expr.loc);
                if (e_.func.name) |name| {
                    return p.keepExprSymbolName(expr, p.symbols.items[name.ref.?.inner_index].original_name);
                }
            },
            .e_class => |e_| {
                // This might be wrong.
                _ = p.visitClass(expr.loc, e_);
            },
            else => {},
        }
        return expr;
    }

    const VisitArgsOpts = struct {
        body: []Stmt = &([_]Stmt{}),
        has_rest_arg: bool = false,

        // This is true if the function is an arrow function or a method
        is_unique_formal_parameters: bool = false,
    };

    pub fn visitArgs(p: *P, args: []G.Arg, opts: VisitArgsOpts) void {
        const strict_loc = fnBodyContainsUseStrict(opts.body);
        const has_simple_args = isSimpleParameterList(args, opts.has_rest_arg);
        var duplicate_args_check: ?StringBoolMap = null;
        // Section 15.2.1 Static Semantics: Early Errors: "It is a Syntax Error if
        // FunctionBodyContainsUseStrict of FunctionBody is true and
        // IsSimpleParameterList of FormalParameters is false."
        if (strict_loc != null and !has_simple_args) {
            p.log.addRangeError(p.source, p.source.rangeOfString(strict_loc.?), "Cannot use a \"use strict\" directive in a function with a non-simple parameter list") catch unreachable;
        }

        // Section 15.1.1 Static Semantics: Early Errors: "Multiple occurrences of
        // the same BindingIdentifier in a FormalParameterList is only allowed for
        // functions which have simple parameter lists and which are not defined in
        // strict mode code."
        if (opts.is_unique_formal_parameters or strict_loc != null or !has_simple_args or p.isStrictMode()) {
            duplicate_args_check = StringBoolMap.init(p.allocator);
        }

        var i: usize = 0;
        var duplicate_args_check_ptr: ?*StringBoolMap = if (duplicate_args_check != null) &duplicate_args_check.? else null;

        while (i < args.len) : (i += 1) {
            if (args[i].ts_decorators.len > 0) {
                args[i].ts_decorators = p.visitTSDecorators(args[i].ts_decorators);
            }

            p.visitBinding(args[i].binding, duplicate_args_check_ptr);
            if (args[i].default) |default| {
                args[i].default = p.visitExpr(default);
            }
        }
    }

    pub fn visitTSDecorators(p: *P, decs: ExprNodeList) ExprNodeList {
        var i: usize = 0;
        while (i < decs.len) : (i += 1) {
            decs[i] = p.visitExpr(decs[i]);
        }

        return decs;
    }

    pub fn keepExprSymbolName(p: *P, _value: Expr, name: string) Expr {
        return _value;
        // var start = p.expr_list.items.len;
        // p.expr_list.ensureUnusedCapacity(2) catch unreachable;
        // p.expr_list.appendAssumeCapacity(_value);
        // p.expr_list.appendAssumeCapacity(p.e(E.String{
        //     .utf8 = name,
        // }, _value.loc));

        // var value = p.callRuntime(_value.loc, "ℹ", p.expr_list.items[start..p.expr_list.items.len]);
        // // Make sure tree shaking removes this if the function is never used
        // value.data.e_call.can_be_unwrapped_if_unused = true;
        // return value;
    }

    pub fn fnBodyContainsUseStrict(body: []Stmt) ?logger.Loc {
        for (body) |stmt| {
            switch (stmt.data) {
                .s_comment => {
                    continue;
                },
                .s_directive => |dir| {
                    if (strings.utf16EqlString(dir.value, "use strict")) {
                        return stmt.loc;
                    }
                },
                else => {},
            }
        }

        return null;
    }

    pub fn isSimpleParameterList(args: []G.Arg, has_rest_arg: bool) bool {
        if (has_rest_arg) {
            return false;
        }

        for (args) |arg| {
            if (@as(Binding.Tag, arg.binding.data) != .b_identifier or arg.default != null) {
                return false;
            }
        }

        return true;
    }

    pub fn classCanBeRemovedIfUnused(p: *P, class: *G.Class) bool {
        if (class.extends) |extends| {
            if (!p.exprCanBeRemovedIfUnused(extends)) {
                return false;
            }
        }

        for (class.properties) |property| {
            if (!p.exprCanBeRemovedIfUnused(property.key orelse unreachable)) {
                return false;
            }

            if (property.value) |val| {
                if (!p.exprCanBeRemovedIfUnused(val)) {
                    return false;
                }
            }

            if (property.initializer) |val| {
                if (!p.exprCanBeRemovedIfUnused(val)) {
                    return false;
                }
            }
        }

        return true;
    }

    // TODO:
    // When React Fast Refresh is enabled, anything that's a JSX component should not be removable
    // This is to improve the reliability of fast refresh between page loads.
    pub fn exprCanBeRemovedIfUnused(p: *P, expr: Expr) bool {
        switch (expr.data) {
            .e_null,
            .e_undefined,
            .e_missing,
            .e_boolean,
            .e_number,
            .e_big_int,
            .e_string,
            .e_this,
            .e_reg_exp,
            .e_function,
            .e_arrow,
            .e_import_meta,
            => {
                return true;
            },

            .e_dot => |ex| {
                return ex.can_be_removed_if_unused;
            },
            .e_class => |ex| {
                return p.classCanBeRemovedIfUnused(ex);
            },
            .e_identifier => |ex| {
                if (ex.must_keep_due_to_with_stmt) {
                    return false;
                }

                // Unbound identifiers cannot be removed because they can have side effects.
                // One possible side effect is throwing a ReferenceError if they don't exist.
                // Another one is a getter with side effects on the global object:
                //
                //   Object.defineProperty(globalThis, 'x', {
                //     get() {
                //       sideEffect();
                //     },
                //   });
                //
                // Be very careful about this possibility. It's tempting to treat all
                // identifier expressions as not having side effects but that's wrong. We
                // must make sure they have been declared by the code we are currently
                // compiling before we can tell that they have no side effects.
                //
                // Note that we currently ignore ReferenceErrors due to TDZ access. This is
                // incorrect but proper TDZ analysis is very complicated and would have to
                // be very conservative, which would inhibit a lot of optimizations of code
                // inside closures. This may need to be revisited if it proves problematic.
                if (ex.can_be_removed_if_unused or p.symbols.items[ex.ref.inner_index].kind != .unbound) {
                    return true;
                }
            },
            .e_import_identifier => |ex| {
                // References to an ES6 import item are always side-effect free in an
                // ECMAScript environment.
                //
                // They could technically have side effects if the imported module is a
                // CommonJS module and the import item was translated to a property access
                // (which esbuild's bundler does) and the property has a getter with side
                // effects.
                //
                // But this is very unlikely and respecting this edge case would mean
                // disabling tree shaking of all code that references an export from a
                // CommonJS module. It would also likely violate the expectations of some
                // developers because the code *looks* like it should be able to be tree
                // shaken.
                //
                // So we deliberately ignore this edge case and always treat import item
                // references as being side-effect free.
                return true;
            },
            .e_if => |ex| {
                return p.exprCanBeRemovedIfUnused(ex.test_) and p.exprCanBeRemovedIfUnused(ex.yes) and p.exprCanBeRemovedIfUnused(ex.no);
            },
            .e_array => |ex| {
                for (ex.items) |item| {
                    if (!p.exprCanBeRemovedIfUnused(item)) {
                        return false;
                    }
                }

                return true;
            },
            .e_object => |ex| {
                for (ex.properties) |property| {

                    // The key must still be evaluated if it's computed or a spread
                    if (property.kind == .spread or property.flags.is_computed or property.flags.is_spread) {
                        return false;
                    }

                    if (property.value) |val| {
                        if (!p.exprCanBeRemovedIfUnused(val)) {
                            return false;
                        }
                    }
                }
                return true;
            },
            .e_call => |ex| {
                // A call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if (ex.can_be_unwrapped_if_unused) {
                    for (ex.args) |arg| {
                        if (!p.exprCanBeRemovedIfUnused(arg)) {
                            return false;
                        }
                    }
                }

                return true;
            },
            .e_new => |ex| {
                // A call that has been marked "__PURE__" can be removed if all arguments
                // can be removed. The annotation causes us to ignore the target.
                if (ex.can_be_unwrapped_if_unused) {
                    for (ex.args) |arg| {
                        if (!p.exprCanBeRemovedIfUnused(arg)) {
                            return false;
                        }
                    }
                }

                return true;
            },
            .e_unary => |ex| {
                switch (ex.op) {
                    .un_typeof, .un_void, .un_not => {
                        return p.exprCanBeRemovedIfUnused(ex.value);
                    },
                    else => {},
                }
            },
            .e_binary => |ex| {
                switch (ex.op) {
                    .bin_strict_eq, .bin_strict_ne, .bin_comma, .bin_logical_or, .bin_logical_and, .bin_nullish_coalescing => {
                        return p.exprCanBeRemovedIfUnused(ex.left) and p.exprCanBeRemovedIfUnused(ex.right);
                    },
                    else => {},
                }
            },
            else => {},
        }

        return false;
    }

    pub fn jsxStringsToMemberExpressionAutomatic(p: *P, loc: logger.Loc) Expr {
        return p.jsxStringsToMemberExpression(loc, p.jsx_runtime_ref);
    }

    // EDot nodes represent a property access. This function may return an
    // expression to replace the property access with. It assumes that the
    // target of the EDot expression has already been visited.
    pub fn maybeRewritePropertyAccess(
        p: *P,
        loc: logger.Loc,
        assign_target: js_ast.AssignTarget,
        is_delete_target: bool,
        target: js_ast.Expr,
        name: string,
        name_loc: logger.Loc,
        is_call_target: bool,
    ) ?Expr {
        if (@as(Expr.Tag, target.data) == .e_identifier) {
            const id = target.data.e_identifier;

            // Rewrite property accesses on explicit namespace imports as an identifier.
            // This lets us replace them easily in the printer to rebind them to
            // something else without paying the cost of a whole-tree traversal during
            // module linking just to rewrite these EDot expressions.
            if (p.import_items_for_namespace.get(id.ref)) |*import_items| {
                var item: LocRef = LocRef{ .loc = logger.Loc.Empty, .ref = null };

                if (!import_items.contains(name)) {
                    item = LocRef{ .loc = name_loc, .ref = p.newSymbol(.import, name) catch unreachable };
                    p.module_scope.generated.append(item.ref orelse unreachable) catch unreachable;

                    import_items.put(name, item) catch unreachable;
                    p.is_import_item.put(item.ref orelse unreachable, true) catch unreachable;

                    var symbol = p.symbols.items[item.ref.?.inner_index];
                    // Mark this as generated in case it's missing. We don't want to
                    // generate errors for missing import items that are automatically
                    // generated.
                    symbol.import_item_status = .generated;
                } else {
                    item = import_items.get(name) orelse unreachable;
                }

                // Undo the usage count for the namespace itself. This is used later
                // to detect whether the namespace symbol has ever been "captured"
                // or whether it has just been used to read properties off of.
                //
                // The benefit of doing this is that if both this module and the
                // imported module end up in the same module group and the namespace
                // symbol has never been captured, then we don't need to generate
                // any code for the namespace at all.
                p.ignoreUsage(id.ref);

                // Track how many times we've referenced this symbol
                p.recordUsage(item.ref.?);
                var ident = p.allocator.create(E.Identifier) catch unreachable;
                ident.ref = item.ref.?;

                return p.handleIdentifier(name_loc, ident, name, IdentifierOpts{
                    .assign_target = assign_target,
                    .is_delete_target = is_delete_target,
                    // If this expression is used as the target of a call expression, make
                    // sure the value of "this" is preserved.
                    .was_originally_identifier = false,
                });
            }

            if (is_call_target and id.ref.eql(p.module_ref) and strings.eqlComptime(name, "require")) {
                p.ignoreUsage(p.module_ref);
                p.recordUsage(p.require_ref);
                return p.e(E.Identifier{ .ref = p.require_ref }, name_loc);
            }

            // If this is a known enum value, inline the value of the enum
            if (p.options.ts) {
                if (p.known_enum_values.get(id.ref)) |enum_value_map| {
                    if (enum_value_map.get(name)) |enum_value| {
                        return p.e(E.Number{ .value = enum_value }, loc);
                    }
                }
            }
        }

        return null;
    }

    pub fn ignoreUsage(p: *P, ref: Ref) void {
        if (!p.is_control_flow_dead) {
            p.symbols.items[ref.inner_index].use_count_estimate = std.math.max(p.symbols.items[ref.inner_index].use_count_estimate - 1, 0);
            var use = p.symbol_uses.get(ref) orelse p.panic("Expected symbol_uses to exist {s}\n{s}", .{ ref, p.symbol_uses });
            use.count_estimate = std.math.max(use.count_estimate - 1, 0);
            if (use.count_estimate == 0) {
                _ = p.symbol_uses.remove(ref);
            } else {
                p.symbol_uses.putAssumeCapacity(ref, use);
            }
        }

        // Don't roll back the "tsUseCounts" increment. This must be counted even if
        // the value is ignored because that's what the TypeScript compiler does.
    }

    pub fn visitAndAppendStmt(p: *P, stmts: *List(Stmt), stmt: *Stmt) !void {
        switch (stmt.data) {
            // These don't contain anything to traverse

            .s_debugger, .s_empty, .s_comment => {},
            .s_type_script => |data| {
                // Erase TypeScript constructs from the output completely
                return;
            },
            .s_directive => |data| {
                //         	if p.isStrictMode() && s.LegacyOctalLoc.Start > 0 {
                // 	p.markStrictModeFeature(legacyOctalEscape, p.source.RangeOfLegacyOctalEscape(s.LegacyOctalLoc), "")
                // }
                return;
            },
            .s_import => |data| {
                try p.recordDeclaredSymbol(data.namespace_ref);

                if (data.default_name) |default_name| {
                    try p.recordDeclaredSymbol(default_name.ref orelse unreachable);
                }

                if (data.items.len > 0) {
                    for (data.items) |*item| {
                        try p.recordDeclaredSymbol(item.name.ref orelse unreachable);
                    }
                }
            },
            .s_export_clause => |data| {
                // "export {foo}"
                var end: usize = 0;
                for (data.items) |*item| {
                    const name = p.loadNameFromRef(item.name.ref orelse unreachable);
                    const symbol = try p.findSymbol(item.alias_loc, name);
                    const ref = symbol.ref;

                    if (p.symbols.items[ref.inner_index].kind == .unbound) {
                        // Silently strip exports of non-local symbols in TypeScript, since
                        // those likely correspond to type-only exports. But report exports of
                        // non-local symbols as errors in JavaScript.
                        if (!p.options.ts) {
                            const r = js_lexer.rangeOfIdentifier(p.source, item.name.loc);
                            try p.log.addRangeErrorFmt(p.source, r, p.allocator, "\"{s}\" is not declared in this file", .{name});
                            continue;
                        }
                        continue;
                    }

                    item.name.ref = ref;
                    data.items[end] = item.*;
                    end += 1;
                }
                // esbuild: "Note: do not remove empty export statements since TypeScript uses them as module markers"
                // jarred: does that mean we can remove them here, since we're not bundling for production?
                data.items = data.items[0..end];
            },
            .s_export_from => |data| {
                // "export {foo} from 'path'"
                const name = p.loadNameFromRef(data.namespace_ref);
                data.namespace_ref = try p.newSymbol(.other, name);
                try p.current_scope.generated.append(data.namespace_ref);
                try p.recordDeclaredSymbol(data.namespace_ref);

                // This is a re-export and the symbols created here are used to reference
                for (data.items) |*item| {
                    const _name = p.loadNameFromRef(item.name.ref orelse unreachable);
                    const ref = try p.newSymbol(.other, _name);
                    try p.current_scope.generated.append(data.namespace_ref);
                    try p.recordDeclaredSymbol(data.namespace_ref);
                    item.name.ref = ref;
                }
            },
            .s_export_star => |data| {
                // "export {foo} from 'path'"
                const name = p.loadNameFromRef(data.namespace_ref);
                data.namespace_ref = try p.newSymbol(.other, name);
                try p.current_scope.generated.append(data.namespace_ref);
                try p.recordDeclaredSymbol(data.namespace_ref);

                // "export * as ns from 'path'"
                if (data.alias) |alias| {
                    // "import * as ns from 'path'"
                    // "export {ns}"

                    // jarred: For now, just always do this transform.
                    // because Safari doesn't support it and I've seen cases where this breaks
                    // TODO: backport unsupportedJSFeatures map
                    p.recordUsage(data.namespace_ref);
                    try stmts.ensureCapacity(stmts.items.len + 2);
                    stmts.appendAssumeCapacity(p.s(S.Import{ .namespace_ref = data.namespace_ref, .star_name_loc = alias.loc, .import_record_index = data.import_record_index }, stmt.loc));

                    var items = try List(js_ast.ClauseItem).initCapacity(p.allocator, 1);
                    items.appendAssumeCapacity(js_ast.ClauseItem{ .alias = alias.original_name, .original_name = alias.original_name, .alias_loc = alias.loc, .name = LocRef{ .loc = alias.loc, .ref = data.namespace_ref } });
                    stmts.appendAssumeCapacity(p.s(S.ExportClause{ .items = items.toOwnedSlice(), .is_single_line = true }, stmt.loc));
                }
            },
            .s_export_default => |data| {
                if (data.default_name.ref) |ref| {
                    try p.recordDeclaredSymbol(ref);
                }

                switch (data.value) {
                    .expr => |expr| {
                        const was_anonymous_named_expr = p.isAnonymousNamedExpr(expr);
                        data.value.expr = p.visitExpr(expr);

                        // // Optionally preserve the name
                        data.value.expr = p.maybeKeepExprSymbolName(expr, "default", was_anonymous_named_expr);

                        // Discard type-only export default statements
                        if (p.options.ts) {
                            switch (expr.data) {
                                .e_identifier => |ident| {
                                    const symbol = p.symbols.items[ident.ref.inner_index];
                                    if (symbol.kind == .unbound) {
                                        if (p.local_type_names.get(symbol.original_name)) |local_type| {
                                            if (local_type) {
                                                return;
                                            }
                                        }
                                    }
                                },
                                else => {},
                            }
                        }
                    },

                    .stmt => |s2| {
                        switch (s2.data) {
                            .s_function => |func| {
                                var name: string = "";
                                if (func.func.name) |func_loc| {
                                    name = p.loadNameFromRef(func_loc.ref.?);
                                } else {
                                    func.func.name = data.default_name;
                                    name = "default";
                                }

                                p.visitFunc(&func.func, func.func.open_parens_loc);
                                stmts.append(stmt.*) catch unreachable;

                                // if (func.func.name != null and func.func.name.?.ref != null) {
                                //     stmts.append(p.keepStmtSymbolName(func.func.name.?.loc, func.func.name.?.ref.?, name)) catch unreachable;
                                // }
                                // prevent doubling export default function name
                                return;
                            },
                            .s_class => |class| {
                                var shadow_ref = p.visitClass(s2.loc, &class.class);
                                stmts.appendSlice(p.lowerClass(js_ast.StmtOrExpr{ .stmt = stmt.* }, shadow_ref)) catch unreachable;
                                return;
                            },
                            else => {},
                        }
                    },
                }
            },
            .s_export_equals => |data| {
                // "module.exports = value"
                stmts.append(
                    Expr.assignStmt(
                        p.e(
                            E.Dot{
                                .target = p.e(
                                    E.Identifier{
                                        .ref = p.module_ref,
                                    },
                                    stmt.loc,
                                ),
                                .name = "exports",
                                .name_loc = stmt.loc,
                            },
                            stmt.loc,
                        ),
                        p.visitExpr(data.value),
                        p.allocator,
                    ),
                ) catch unreachable;
                p.recordUsage(p.module_ref);
            },
            .s_break => |data| {
                if (data.label) |*label| {
                    const name = p.loadNameFromRef(label.ref orelse p.panic("Expected label to have a ref", .{}));
                    const res = p.findLabelSymbol(label.loc, name);
                    if (res.found) {
                        label.ref = res.ref;
                    } else {
                        data.label = null;
                    }
                } else if (!p.fn_or_arrow_data_visit.is_inside_loop and !p.fn_or_arrow_data_visit.is_inside_switch) {
                    const r = js_lexer.rangeOfIdentifier(p.source, stmt.loc);
                    p.log.addRangeError(p.source, r, "Cannot use \"break\" here") catch unreachable;
                }
            },
            .s_continue => |data| {
                if (data.label) |*label| {
                    const name = p.loadNameFromRef(label.ref orelse p.panic("Expected continue label to have a ref", .{}));
                    const res = p.findLabelSymbol(label.loc, name);
                    label.ref = res.ref;
                    if (res.found and !res.is_loop) {
                        const r = js_lexer.rangeOfIdentifier(p.source, stmt.loc);
                        p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot \"continue\" to label {s}", .{name}) catch unreachable;
                    }
                } else if (!p.fn_or_arrow_data_visit.is_inside_loop) {
                    const r = js_lexer.rangeOfIdentifier(p.source, stmt.loc);
                    p.log.addRangeError(p.source, r, "Cannot use \"continue\" here") catch unreachable;
                }
            },
            .s_label => |data| {
                p.pushScopeForVisitPass(.label, stmt.loc) catch unreachable;
                const name = p.loadNameFromRef(data.name.ref orelse unreachable);
                const ref = p.newSymbol(.label, name) catch unreachable;
                data.name.ref = ref;
                p.current_scope.label_ref = ref;
                switch (data.stmt.data) {
                    .s_for, .s_for_in, .s_for_of, .s_while, .s_do_while => {
                        p.current_scope.label_stmt_is_loop = true;
                    },
                    else => {},
                }

                data.stmt = p.visitSingleStmt(data.stmt, StmtsKind.none);
                p.popScope();
            },
            .s_local => |data| {
                for (data.decls) |*d| {
                    p.visitBinding(d.binding, null);

                    if (d.value != null) {
                        var val = d.value orelse unreachable;
                        const was_anonymous_named_expr = p.isAnonymousNamedExpr(val);

                        val = p.visitExpr(val);
                        // go version of defer would cause this to reset the variable
                        // zig version of defer causes this to set it to the last value of val, at the end of the scope.
                        d.value = val;

                        // Optionally preserve the name
                        switch (d.binding.data) {
                            .b_identifier => |id| {
                                val = p.maybeKeepExprSymbolName(
                                    val,
                                    p.symbols.items[id.ref.inner_index].original_name,
                                    was_anonymous_named_expr,
                                );
                            },
                            else => {},
                        }
                    }
                }

                // Handle being exported inside a namespace
                if (data.is_export and p.enclosing_namespace_arg_ref != null) {
                    for (data.decls) |*d| {
                        if (d.value) |val| {
                            p.recordUsage((p.enclosing_namespace_arg_ref orelse unreachable));
                            // TODO: is it necessary to lowerAssign? why does esbuild do it _most_ of the time?
                            stmts.append(p.s(S.SExpr{
                                .value = Expr.assign(Binding.toExpr(&d.binding, p.to_expr_wrapper_namespace), val, p.allocator),
                            }, stmt.loc)) catch unreachable;
                        }
                    }

                    return;
                }

                // TODO: do we need to relocate vars? I don't think so.
                if (data.kind == .k_var) {}
            },
            .s_expr => |data| {
                p.stmt_expr_value = data.value.data;
                data.value = p.visitExpr(data.value);

                // TODO:
                // if (p.options.mangle_syntax) {

                // }
            },
            .s_throw => |data| {
                data.value = p.visitExpr(data.value);
            },
            .s_return => |data| {
                // Forbid top-level return inside modules with ECMAScript-style exports
                if (p.fn_or_arrow_data_visit.is_outside_fn_or_arrow) {
                    const where = where: {
                        if (p.es6_export_keyword.len > 0) {
                            break :where p.es6_export_keyword;
                        } else if (p.top_level_await_keyword.len > 0) {
                            break :where p.top_level_await_keyword;
                        } else {
                            break :where logger.Range.None;
                        }
                    };

                    if (where.len > 0) {
                        p.log.addRangeError(p.source, where, "Top-level return cannot be used inside an ECMAScript module") catch unreachable;
                    }
                }

                if (data.value) |val| {
                    data.value = p.visitExpr(val);

                    // "return undefined;" can safely just always be "return;"
                    if (data.value != null and @as(Expr.Tag, data.value.?.data) == .e_undefined) {
                        // Returning undefined is implicit
                        data.value = null;
                    }
                }
            },
            .s_block => |data| {
                {
                    p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;

                    // Pass the "is loop body" status on to the direct children of a block used
                    // as a loop body. This is used to enable optimizations specific to the
                    // topmost scope in a loop body block.
                    const kind = if (std.meta.eql(p.loop_body, stmt.data)) StmtsKind.loop_body else StmtsKind.none;
                    var _stmts = List(Stmt).fromOwnedSlice(p.allocator, data.stmts);
                    p.visitStmts(&_stmts, kind) catch unreachable;
                    data.stmts = _stmts.toOwnedSlice();
                    p.popScope();
                }

                // // trim empty statements
                // if (data.stmts.len == 0) {
                //     stmts.append(Stmt{ .data = Prefill.Data.SEmpty, .loc = stmt.loc }) catch unreachable;
                //     return;
                // } else if (data.stmts.len == 1 and !statementCaresAboutScope(data.stmts[0])) {
                //     // Unwrap blocks containing a single statement
                //     stmts.append(data.stmts[0]) catch unreachable;
                //     return;
                // }
                stmts.append(stmt.*) catch unreachable;
                return;
            },
            .s_with => |data| {
                notimpl();
            },
            .s_while => |data| {
                data.test_ = p.visitExpr(data.test_);
                data.body = p.visitLoopBody(data.body);

                // TODO: simplify boolean expression
            },
            .s_do_while => |data| {
                data.test_ = p.visitExpr(data.test_);
                data.body = p.visitLoopBody(data.body);

                // TODO: simplify boolean expression
            },
            .s_if => |data| {
                data.test_ = p.visitExpr(data.test_);

                const effects = SideEffects.toBoolean(data.test_.data);
                if (effects.ok and !effects.value) {
                    const old = p.is_control_flow_dead;
                    p.is_control_flow_dead = true;
                    data.yes = p.visitSingleStmt(data.yes, StmtsKind.none);
                    p.is_control_flow_dead = old;
                } else {
                    data.yes = p.visitSingleStmt(data.yes, StmtsKind.none);
                }

                // The "else" clause is optional
                if (data.no) |no| {
                    if (effects.ok and !effects.value) {
                        const old = p.is_control_flow_dead;
                        p.is_control_flow_dead = true;
                        defer p.is_control_flow_dead = old;
                        data.no = p.visitSingleStmt(no, .none);
                    } else {
                        data.no = p.visitSingleStmt(no, .none);
                    }

                    if (data.no != null and @as(Stmt.Tag, data.no.?.data) == .s_empty) {
                        data.no = null;
                    }
                }
            },
            .s_for => |data| {
                {
                    p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;

                    if (data.init) |initst| {
                        data.init = p.visitForLoopInit(initst, false);
                    }

                    if (data.test_) |test_| {
                        data.test_ = p.visitExpr(test_);

                        // TODO: boolean with side effects
                    }

                    if (data.update) |update| {
                        data.update = p.visitExpr(update);
                    }

                    data.body = p.visitLoopBody(data.body);
                    p.popScope();
                }
                // TODO: Potentially relocate "var" declarations to the top level

            },
            .s_for_in => |data| {
                {
                    p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
                    defer p.popScope();
                    _ = p.visitForLoopInit(data.init, true);
                    data.value = p.visitExpr(data.value);
                    data.body = p.visitLoopBody(data.body);

                    // TODO: do we need to this?
                    // // Check for a variable initializer
                    // if local, ok := s.Init.Data.(*js_ast.SLocal); ok && local.Kind == js_ast.LocalVar && len(local.Decls) == 1 {
                    // 	decl := &local.Decls[0]
                    // 	if id, ok := decl.Binding.Data.(*js_ast.BIdentifier); ok && decl.Value != nil {
                    // 		p.markStrictModeFeature(forInVarInit, p.source.RangeOfOperatorBefore(decl.Value.Loc, "="), "")

                    // 		// Lower for-in variable initializers in case the output is used in strict mode
                    // 		stmts = append(stmts, js_ast.Stmt{Loc: stmt.Loc, Data: &js_ast.SExpr{Value: js_ast.Assign(
                    // 			js_ast.Expr{Loc: decl.Binding.Loc, Data: &js_ast.EIdentifier{Ref: id.Ref}},
                    // 			*decl.Value,
                    // 		)}})
                    // 		decl.Value = nil
                    // 	}
                    // }
                }
            },
            .s_for_of => |data| {
                p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
                defer p.popScope();
                _ = p.visitForLoopInit(data.init, true);
                data.value = p.visitExpr(data.value);
                data.body = p.visitLoopBody(data.body);

                // TODO: do we need to do this?
                //         	// Potentially relocate "var" declarations to the top level
                // if init, ok := s.Init.Data.(*js_ast.SLocal); ok && init.Kind == js_ast.LocalVar {
                // 	if replacement, ok := p.maybeRelocateVarsToTopLevel(init.Decls, relocateVarsForInOrForOf); ok {
                // 		s.Init = replacement
                // 	}
                // }

                // p.lowerObjectRestInForLoopInit(s.Init, &s.Body)
            },
            .s_try => |data| {
                p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
                {
                    var _stmts = List(Stmt).fromOwnedSlice(p.allocator, data.body);
                    p.fn_or_arrow_data_visit.try_body_count += 1;
                    p.visitStmts(&_stmts, StmtsKind.none) catch unreachable;
                    p.fn_or_arrow_data_visit.try_body_count -= 1;
                    data.body = _stmts.toOwnedSlice();
                }
                p.popScope();

                if (data.catch_) |*catch_| {
                    p.pushScopeForVisitPass(.block, catch_.loc) catch unreachable;
                    {
                        if (catch_.binding != null) {
                            p.visitBinding(catch_.binding.?, null);
                        }
                        var _stmts = List(Stmt).fromOwnedSlice(p.allocator, catch_.body);
                        p.visitStmts(&_stmts, StmtsKind.none) catch unreachable;
                        catch_.body = _stmts.toOwnedSlice();
                    }
                    p.popScope();
                }

                if (data.finally) |*finally| {
                    p.pushScopeForVisitPass(.block, finally.loc) catch unreachable;
                    {
                        var _stmts = List(Stmt).fromOwnedSlice(p.allocator, finally.stmts);
                        p.visitStmts(&_stmts, StmtsKind.none) catch unreachable;
                        finally.stmts = _stmts.toOwnedSlice();
                    }
                    p.popScope();
                }
            },
            .s_switch => |data| {
                data.test_ = p.visitExpr(data.test_);
                {
                    p.pushScopeForVisitPass(.block, data.body_loc) catch unreachable;
                    defer p.popScope();
                    var old_is_inside_Swsitch = p.fn_or_arrow_data_visit.is_inside_switch;
                    p.fn_or_arrow_data_visit.is_inside_switch = true;
                    defer p.fn_or_arrow_data_visit.is_inside_switch = old_is_inside_Swsitch;
                    var i: usize = 0;
                    while (i < data.cases.len) : (i += 1) {
                        const case = data.cases[i];
                        if (case.value) |val| {
                            data.cases[i].value = p.visitExpr(val);
                            // TODO: error messages
                            // Check("case", *c.Value, c.Value.Loc)
                            // 				p.warnAboutTypeofAndString(s.Test, *c.Value)
                        }
                        var _stmts = List(Stmt).fromOwnedSlice(p.allocator, case.body);
                        p.visitStmts(&_stmts, StmtsKind.none) catch unreachable;
                        data.cases[i].body = _stmts.toOwnedSlice();
                    }
                }
                // TODO: duplicate case checker

            },
            .s_function => |data| {
                p.visitFunc(&data.func, data.func.open_parens_loc);

                // Handle exporting this function from a namespace
                if (data.func.flags.is_export and p.enclosing_namespace_arg_ref != null) {
                    const enclosing_namespace_arg_ref = p.enclosing_namespace_arg_ref orelse unreachable;
                    stmts.ensureUnusedCapacity(3) catch unreachable;
                    stmts.appendAssumeCapacity(stmt.*);
                    // i wonder if this will crash
                    stmts.appendAssumeCapacity(Expr.assignStmt(p.e(E.Dot{
                        .target = p.e(E.Identifier{ .ref = enclosing_namespace_arg_ref }, stmt.loc),
                        .name = p.loadNameFromRef(data.func.name.?.ref.?),
                        .name_loc = data.func.name.?.loc,
                    }, stmt.loc), p.e(E.Identifier{ .ref = data.func.name.?.ref.? }, data.func.name.?.loc), p.allocator));
                } else {
                    stmts.ensureUnusedCapacity(2) catch unreachable;
                    stmts.appendAssumeCapacity(stmt.*);
                }

                // stmts.appendAssumeCapacity(
                //     // i wonder if this will crash
                //     p.keepStmtSymbolName(
                //         data.func.name.?.loc,
                //         data.func.name.?.ref.?,
                //         p.symbols.items[data.func.name.?.ref.?.inner_index].original_name,
                //     ),
                // );
                return;
            },
            .s_class => |data| {
                const shadow_ref = p.visitClass(stmt.loc, &data.class);

                // Remove the export flag inside a namespace
                const was_export_inside_namespace = data.is_export and p.enclosing_namespace_arg_ref != null;
                if (was_export_inside_namespace) {
                    data.is_export = false;
                }

                // Lower class field syntax for browsers that don't support it
                stmts.appendSlice(p.lowerClass(js_ast.StmtOrExpr{ .stmt = stmt.* }, shadow_ref)) catch unreachable;

                // Handle exporting this class from a namespace
                if (was_export_inside_namespace) {
                    stmts.appendAssumeCapacity(Expr.assignStmt(p.e(E.Dot{
                        .target = p.e(E.Identifier{ .ref = p.enclosing_namespace_arg_ref.? }, stmt.loc),
                        .name = p.symbols.items[data.class.class_name.?.ref.?.inner_index].original_name,
                        .name_loc = data.class.class_name.?.loc,
                    }, stmt.loc), p.e(E.Identifier{ .ref = data.class.class_name.?.ref.? }, data.class.class_name.?.loc), p.allocator));
                }

                return;
            },
            .s_enum => |data| {
                p.recordDeclaredSymbol(data.name.ref.?) catch unreachable;
                p.pushScopeForVisitPass(.entry, stmt.loc) catch unreachable;
                defer p.popScope();
                p.recordDeclaredSymbol(data.arg) catch unreachable;

                // Scan ahead for any variables inside this namespace. This must be done
                // ahead of time before visiting any statements inside the namespace
                // because we may end up visiting the uses before the declarations.
                // We need to convert the uses into property accesses on the namespace.
                for (data.values) |value| {
                    if (!value.ref.isNull()) {
                        p.is_exported_inside_namespace.put(value.ref, data.arg) catch unreachable;
                    }
                }

                // Values without initializers are initialized to one more than the
                // previous value if the previous value is numeric. Otherwise values
                // without initializers are initialized to undefined.
                var next_numeric_value: f64 = 0.0;
                var has_numeric_value = true;
                var value_exprs = List(Expr).initCapacity(p.allocator, data.values.len) catch unreachable;

                // Track values so they can be used by constant folding. We need to follow
                // links here in case the enum was merged with a preceding namespace
                var values_so_far = std.StringHashMap(f64).init(p.allocator);
                p.known_enum_values.put(data.name.ref orelse p.panic("Expected data.name.ref", .{}), values_so_far) catch unreachable;
                p.known_enum_values.put(data.arg, values_so_far) catch unreachable;

                // We normally don't fold numeric constants because they might increase code
                // size, but it's important to fold numeric constants inside enums since
                // that's what the TypeScript compiler does.
                const old_should_fold_numeric_constants = p.should_fold_numeric_constants;
                p.should_fold_numeric_constants = true;
                defer p.should_fold_numeric_constants = old_should_fold_numeric_constants;
                for (data.values) |*enum_value| {
                    // gotta allocate here so it lives after this function stack frame goes poof
                    const name = p.lexer.utf16ToString(enum_value.name);
                    var assign_target: Expr = Expr{ .loc = logger.Loc.Empty, .data = Prefill.Data.EMissing };
                    var enum_value_type: EnumValueType = EnumValueType.unknown;
                    if (enum_value.value != null) {
                        enum_value.value = p.visitExpr(enum_value.value.?);
                        switch (enum_value.value.?.data) {
                            .e_number => |num| {
                                values_so_far.put(name, num.value) catch unreachable;
                                enum_value_type = .numeric;
                                next_numeric_value = num.value + 1.0;
                            },
                            .e_string => |str| {
                                enum_value_type = .string;
                            },
                            else => {},
                        }
                    } else if (enum_value_type == .numeric) {
                        enum_value.value = p.e(E.Number{ .value = next_numeric_value }, enum_value.loc);
                        values_so_far.put(name, next_numeric_value) catch unreachable;
                        next_numeric_value += 1;
                    } else {
                        enum_value.value = p.e(E.Undefined{}, enum_value.loc);
                    }
                    // "Enum['Name'] = value"

                    assign_target = Expr.assign(p.e(E.Index{
                        .target = p.e(
                            E.Identifier{ .ref = data.arg },
                            enum_value.loc,
                        ),
                        .index = p.e(
                            E.String{ .value = enum_value.name },
                            enum_value.loc,
                        ),
                    }, enum_value.loc), enum_value.value orelse unreachable, p.allocator);

                    p.recordUsage(data.arg);

                    // String-valued enums do not form a two-way map
                    if (enum_value_type == .string) {
                        value_exprs.append(assign_target) catch unreachable;
                    } else {
                        // "Enum[assignTarget] = 'Name'"
                        value_exprs.append(Expr.assign(p.e(E.Index{
                            .target = p.e(
                                E.Identifier{ .ref = data.arg },
                                enum_value.loc,
                            ),
                            .index = assign_target,
                        }, enum_value.loc), p.e(E.String{ .value = enum_value.name }, enum_value.loc), p.allocator)) catch unreachable;
                    }
                }
                p.recordUsage(data.arg);

                var value_stmts = List(Stmt).initCapacity(p.allocator, value_exprs.items.len) catch unreachable;
                // Generate statements from expressions

                for (value_exprs.items) |expr| {
                    value_stmts.appendAssumeCapacity(p.s(S.SExpr{ .value = expr }, expr.loc));
                }
                value_exprs.deinit();
                p.generateClosureForTypescriptNameSpaceOrEnum(
                    stmts,
                    stmt.loc,
                    data.is_export,
                    data.name.loc,
                    data.name.ref.?,
                    data.arg,
                    value_stmts.toOwnedSlice(),
                );
                return;
            },
            .s_namespace => |data| {
                p.recordDeclaredSymbol(data.name.ref.?) catch unreachable;

                // Scan ahead for any variables inside this namespace. This must be done
                // ahead of time before visiting any statements inside the namespace
                // because we may end up visiting the uses before the declarations.
                // We need to convert the uses into property accesses on the namespace.
                for (data.stmts) |child_stmt| {
                    switch (child_stmt.data) {
                        .s_local => |local| {
                            if (local.is_export) {
                                p.markExportedDeclsInsideNamespace(data.arg, local.decls);
                            }
                        },
                        else => {},
                    }
                }

                var prepend_temp_refs = PrependTempRefsOpts{ .kind = StmtsKind.fn_body };
                var prepend_list = List(Stmt).fromOwnedSlice(p.allocator, data.stmts);

                {
                    const old_enclosing_namespace_arg_ref = p.enclosing_namespace_arg_ref;
                    p.enclosing_namespace_arg_ref = data.arg;
                    defer p.enclosing_namespace_arg_ref = old_enclosing_namespace_arg_ref;
                    p.pushScopeForVisitPass(.entry, stmt.loc) catch unreachable;
                    defer p.popScope();
                    p.recordDeclaredSymbol(data.arg) catch unreachable;
                    p.visitStmtsAndPrependTempRefs(&prepend_list, &prepend_temp_refs) catch unreachable;
                }

                p.generateClosureForTypescriptNameSpaceOrEnum(
                    stmts,
                    stmt.loc,
                    data.is_export,
                    data.name.loc,
                    data.name.ref.?,
                    data.arg,
                    prepend_list.toOwnedSlice(),
                );
                return;
            },
            else => {
                notimpl();
            },
        }

        // if we get this far, it stays
        try stmts.append(stmt.*);
    }

    pub fn markExportedDeclsInsideNamespace(p: *P, ns_ref: Ref, decls: []G.Decl) void {
        notimpl();
    }

    pub fn generateClosureForTypescriptNameSpaceOrEnum(
        p: *P,
        stmts: *List(Stmt),
        stmt_loc: logger.Loc,
        is_export: bool,
        name_loc: logger.Loc,
        name_ref: Ref,
        arg_ref: Ref,
        stmts_inside_closure: []Stmt,
    ) void {
        notimpl();
    }

    pub fn lowerClass(p: *P, stmtorexpr: js_ast.StmtOrExpr, ref: Ref) []Stmt {
        switch (stmtorexpr) {
            .stmt => |stmt| {
                var stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
                stmts[0] = stmt;
                return stmts;
            },
            .expr => |expr| {
                var stmts = p.allocator.alloc(Stmt, 1) catch unreachable;
                stmts[0] = p.s(S.SExpr{ .value = expr }, expr.loc);
                return stmts;
            },
        }
    }

    pub fn visitForLoopInit(p: *P, stmt: Stmt, is_in_or_of: bool) Stmt {
        switch (stmt.data) {
            .s_expr => |st| {
                const assign_target = if (is_in_or_of) js_ast.AssignTarget.replace else js_ast.AssignTarget.none;
                p.stmt_expr_value = st.value.data;
                st.value = p.visitExprInOut(st.value, ExprIn{ .assign_target = assign_target });
            },
            .s_local => |st| {
                for (st.decls) |*dec| {
                    p.visitBinding(dec.binding, null);
                    if (dec.value) |val| {
                        dec.value = p.visitExpr(val);
                    }
                }
                //         		s.Decls = p.lowerObjectRestInDecls(s.Decls)
                // s.Kind = p.selectLocalKind(s.Kind)
            },
            else => {
                p.panic("Unexpected stmt in visitForLoopInit: {s}", .{stmt});
            },
        }

        return stmt;
    }

    // pub fn maybeRelocateVarsToTopLevel(p: *P, decls: []G.Decl, mode: )

    pub fn wrapIdentifierNamespace(
        p: *P,
        loc: logger.Loc,
        ref: Ref,
    ) Expr {
        p.recordUsage((p.enclosing_namespace_arg_ref orelse unreachable));

        return p.e(E.Dot{
            .target = p.e(E.Identifier{ .ref = p.enclosing_namespace_arg_ref orelse unreachable }, loc),
            .name = p.symbols.items[ref.inner_index].original_name,
            .name_loc = loc,
        }, loc);
    }

    pub fn wrapIdentifierHoisting(
        p: *P,
        loc: logger.Loc,
        ref: Ref,
    ) Expr {
        p.relocated_top_level_vars.append(LocRef{ .loc = loc, .ref = ref }) catch unreachable;
        var _ref = ref;
        p.recordUsage(_ref);
        return p.e(E.Identifier{ .ref = _ref }, loc);
    }

    pub fn isAnonymousNamedExpr(p: *P, expr: ExprNodeIndex) bool {
        switch (expr.data) {
            .e_arrow => {
                return true;
            },
            .e_function => |func| {
                return func.func.name == null;
            },
            .e_class => |class| {
                return class.class_name == null;
            },
            else => {
                return false;
            },
        }
    }

    pub fn valueForDefine(p: *P, loc: logger.Loc, assign_target: js_ast.AssignTarget, is_delete_target: bool, define_data: *const DefineData) Expr {
        switch (define_data.value) {
            .e_identifier => |ident| {
                return p.handleIdentifier(
                    loc,
                    ident,
                    define_data.original_name.?,
                    IdentifierOpts{
                        .assign_target = assign_target,
                        .is_delete_target = is_delete_target,
                        .was_originally_identifier = true,
                    },
                );
            },
            else => {},
        }

        return Expr{
            .data = define_data.value,
            .loc = loc,
        };
    }

    pub fn isDotDefineMatch(p: *P, expr: Expr, parts: []const string) bool {
        switch (expr.data) {
            .e_dot => |ex| {
                if (parts.len > 1) {
                    // Intermediates must be dot expressions
                    const last = parts.len - 1;
                    return strings.eql(parts[last], ex.name) and ex.optional_chain == null and p.isDotDefineMatch(ex.target, parts[0..last]);
                }
            },
            .e_import_meta => |ex| {
                return parts.len == 2 and strings.eqlComptime(parts[0], "import") and strings.eqlComptime(parts[1], "meta");
            },
            .e_identifier => |ex| {
                // The last expression must be an identifier
                if (parts.len == 1) {
                    const name = p.loadNameFromRef(ex.ref);
                    if (!strings.eql(name, parts[0])) {
                        return false;
                    }

                    const result = p.findSymbol(expr.loc, name) catch return false;

                    // We must not be in a "with" statement scope
                    if (result.is_inside_with_scope) {
                        return false;
                    }

                    // The last symbol must be unbound
                    return p.symbols.items[result.ref.inner_index].kind == .unbound;
                }
            },
            else => {},
        }

        return false;
    }

    pub fn visitBinding(p: *P, binding: BindingNodeIndex, duplicate_arg_check: ?*StringBoolMap) void {
        switch (binding.data) {
            .b_missing => {},
            .b_identifier => |bind| {
                p.recordDeclaredSymbol(bind.ref) catch unreachable;
                const name = p.symbols.items[bind.ref.inner_index].original_name;
                if (isEvalOrArguments(name)) {
                    p.markStrictModeFeature(.eval_or_arguments, js_lexer.rangeOfIdentifier(p.source, binding.loc), name) catch unreachable;
                }

                if (duplicate_arg_check) |dup| {
                    const res = dup.getOrPut(name) catch unreachable;
                    if (res.found_existing) {
                        p.log.addRangeErrorFmt(
                            p.source,
                            js_lexer.rangeOfIdentifier(p.source, binding.loc),
                            p.allocator,
                            "\"{s}\" cannot be bound multiple times in the same parameter list",
                            .{name},
                        ) catch unreachable;
                    }
                    res.entry.value = true;
                }
            },
            .b_array => |bind| {
                for (bind.items) |*item| {
                    p.visitBinding(item.binding, duplicate_arg_check);
                    if (item.default_value) |default_value| {
                        const was_anonymous_named_expr = p.isAnonymousNamedExpr(default_value);
                        item.default_value = p.visitExpr(default_value);

                        switch (item.binding.data) {
                            .b_identifier => |bind_| {
                                item.default_value = p.maybeKeepExprSymbolName(
                                    item.default_value orelse unreachable,
                                    p.symbols.items[bind_.ref.inner_index].original_name,
                                    was_anonymous_named_expr,
                                );
                            },
                            else => {},
                        }
                    }
                }
            },
            .b_object => |bind| {
                for (bind.properties) |*property| {
                    if (!property.flags.is_spread) {
                        property.key = p.visitExpr(property.key);
                    }

                    p.visitBinding(property.value, duplicate_arg_check);
                    if (property.default_value) |default_value| {
                        const was_anonymous_named_expr = p.isAnonymousNamedExpr(default_value);
                        property.default_value = p.visitExpr(default_value);

                        switch (property.value.data) {
                            .b_identifier => |bind_| {
                                property.default_value = p.maybeKeepExprSymbolName(
                                    property.default_value orelse unreachable,
                                    p.symbols.items[bind_.ref.inner_index].original_name,
                                    was_anonymous_named_expr,
                                );
                            },
                            else => {},
                        }
                    }
                }
            },
            else => {
                p.panic("Unexpected binding {s}", .{binding});
            },
        }
    }

    pub fn visitLoopBody(p: *P, stmt: StmtNodeIndex) StmtNodeIndex {
        const old_is_inside_loop = p.fn_or_arrow_data_visit.is_inside_loop;
        p.fn_or_arrow_data_visit.is_inside_loop = true;
        p.loop_body = stmt.data;
        const res = p.visitSingleStmt(stmt, .loop_body);
        p.fn_or_arrow_data_visit.is_inside_loop = old_is_inside_loop;
        return res;
    }

    pub fn visitSingleStmt(p: *P, stmt: Stmt, kind: StmtsKind) Stmt {
        const has_if_scope = has_if: {
            switch (stmt.data) {
                .s_function => |func| {
                    break :has_if func.func.flags.has_if_scope;
                },
                else => {
                    break :has_if false;
                },
            }
        };

        // Introduce a fake block scope for function declarations inside if statements
        if (has_if_scope) {
            p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
        }

        var stmts = List(Stmt).initCapacity(p.allocator, 1) catch unreachable;
        stmts.append(stmt) catch unreachable;
        p.visitStmts(&stmts, kind) catch unreachable;

        if (has_if_scope) {
            p.popScope();
        }

        return p.stmtsToSingleStmt(stmt.loc, stmts.toOwnedSlice());
    }

    // One statement could potentially expand to several statements
    pub fn stmtsToSingleStmt(p: *P, loc: logger.Loc, stmts: []Stmt) Stmt {
        if (stmts.len == 0) {
            return Stmt{ .data = Prefill.Data.SEmpty, .loc = loc };
        }

        if (stmts.len == 1 and std.meta.activeTag(stmts[0].data) != .s_local or (std.meta.activeTag(stmts[0].data) == .s_local and stmts[0].data.s_local.kind == S.Local.Kind.k_var)) {
            // "let" and "const" must be put in a block when in a single-statement context
            return stmts[0];
        }

        return p.s(S.Block{ .stmts = stmts }, loc);
    }

    pub fn findLabelSymbol(p: *P, loc: logger.Loc, name: string) FindLabelSymbolResult {
        var res = FindLabelSymbolResult{ .ref = Ref.None, .is_loop = false };

        var _scope: ?*Scope = p.current_scope;

        while (_scope != null and !_scope.?.kindStopsHoisting()) : (_scope = _scope.?.parent.?) {
            const scope = _scope orelse unreachable;
            const label_ref = scope.label_ref orelse continue;
            if (scope.kind == .label and strings.eql(name, p.symbols.items[label_ref.inner_index].original_name)) {
                // Track how many times we've referenced this symbol
                p.recordUsage(label_ref);
                res.ref = label_ref;
                res.is_loop = scope.label_stmt_is_loop;
                res.found = true;
                return res;
            }
        }

        const r = js_lexer.rangeOfIdentifier(p.source, loc);
        p.log.addRangeErrorFmt(p.source, r, p.allocator, "There is no containing label named {s}", .{name}) catch unreachable;

        // Allocate an "unbound" symbol
        var ref = p.newSymbol(.unbound, name) catch unreachable;

        // Track how many times we've referenced this symbol
        p.recordUsage(ref);

        return res;
    }

    pub fn visitClass(p: *P, name_scope_loc: logger.Loc, class: *G.Class) Ref {
        class.ts_decorators = p.visitTSDecorators(class.ts_decorators);

        if (class.class_name) |name| {
            p.recordDeclaredSymbol(name.ref.?) catch unreachable;
        }

        p.pushScopeForVisitPass(.class_name, name_scope_loc) catch unreachable;
        const old_enclosing_class_keyword = p.enclosing_class_keyword;
        p.enclosing_class_keyword = class.class_keyword;
        p.current_scope.recursiveSetStrictMode(.implicit_strict_mode_class);
        var class_name_ref: Ref = if (class.class_name != null) class.class_name.?.ref.? else p.newSymbol(.other, "this") catch unreachable;

        var shadow_ref = Ref.None;

        if (!class_name_ref.eql(Ref.None)) {
            // are not allowed to assign to this symbol (it throws a TypeError).
            const name = p.symbols.items[class_name_ref.inner_index].original_name;
            var identifier = p.allocator.alloc(u8, name.len + 1) catch unreachable;
            std.mem.copy(u8, identifier[1..identifier.len], name);
            identifier[0] = '_';
            shadow_ref = p.newSymbol(Symbol.Kind.cconst, identifier) catch unreachable;
            p.recordDeclaredSymbol(shadow_ref) catch unreachable;
            if (class.class_name) |class_name| {
                p.current_scope.members.put(identifier, Scope.Member{ .loc = class_name.loc, .ref = shadow_ref }) catch unreachable;
            }
        }

        if (class.extends) |extends| {
            class.extends = p.visitExpr(extends);
        }

        p.pushScopeForVisitPass(.class_body, class.body_loc) catch unreachable;
        defer p.popScope();

        var i: usize = 0;
        while (i < class.properties.len) : (i += 1) {
            var property = &class.properties[i];
            property.ts_decorators = p.visitTSDecorators(property.ts_decorators);
            const is_private = if (property.key != null) @as(Expr.Tag, property.key.?.data) == .e_private_identifier else false;

            // Special-case EPrivateIdentifier to allow it here

            if (is_private) {
                p.recordDeclaredSymbol(property.key.?.data.e_private_identifier.ref) catch unreachable;
            } else if (property.key) |key| {
                class.properties[i].key = p.visitExpr(key);
            }

            // Make it an error to use "arguments" in a class body
            p.current_scope.forbid_arguments = true;
            defer p.current_scope.forbid_arguments = false;

            // The value of "this" is shadowed inside property values
            const old_is_this_captured = p.fn_only_data_visit.is_this_nested;
            const old_this = p.fn_only_data_visit.this_class_static_ref;
            p.fn_only_data_visit.is_this_nested = true;
            p.fn_only_data_visit.this_class_static_ref = null;
            defer p.fn_only_data_visit.is_this_nested = old_is_this_captured;
            defer p.fn_only_data_visit.this_class_static_ref = old_this;

            // We need to explicitly assign the name to the property initializer if it
            // will be transformed such that it is no longer an inline initializer.
            var name_to_keep: ?string = null;
            if (is_private) {} else if (!property.flags.is_method and !property.flags.is_computed) {
                if (property.key) |key| {
                    if (@as(Expr.Tag, key.data) == .e_string) {
                        name_to_keep = key.data.e_string.string(p.allocator) catch unreachable;
                    }
                }
            }

            if (property.value) |val| {
                if (name_to_keep) |name| {
                    const was_anon = p.isAnonymousNamedExpr(val);
                    property.value = p.maybeKeepExprSymbolName(p.visitExpr(val), name, was_anon);
                } else {
                    property.value = p.visitExpr(val);
                }
            }

            if (property.initializer) |val| {
                // if (property.flags.is_static and )
                if (name_to_keep) |name| {
                    const was_anon = p.isAnonymousNamedExpr(val);
                    property.initializer = p.maybeKeepExprSymbolName(p.visitExpr(val), name, was_anon);
                } else {
                    property.initializer = p.visitExpr(val);
                }
            }
        }

        if (!shadow_ref.eql(Ref.None)) {
            if (p.symbols.items[shadow_ref.inner_index].use_count_estimate == 0) {
                // Don't generate a shadowing name if one isn't needed
                shadow_ref = Ref.None;
            } else if (class.class_name) |class_name| {
                // If there was originally no class name but something inside needed one
                // (e.g. there was a static property initializer that referenced "this"),
                // store our generated name so the class expression ends up with a name.
                class.class_name = LocRef{ .loc = name_scope_loc, .ref = class_name_ref };
                p.current_scope.generated.append(class_name_ref) catch unreachable;
                p.recordDeclaredSymbol(class_name_ref) catch unreachable;
            }
        }

        return shadow_ref;
    }

    fn keepStmtSymbolName(p: *P, loc: logger.Loc, ref: Ref, name: string) Stmt {
        p.expr_list.ensureUnusedCapacity(2) catch unreachable;
        const start = p.expr_list.items.len;
        p.expr_list.appendAssumeCapacity(p.e(E.Identifier{
            .ref = ref,
        }, loc));
        p.expr_list.appendAssumeCapacity(p.e(E.String{ .utf8 = name }, loc));
        return p.s(S.SExpr{
            // I believe that this is a spot we can do $RefreshReg$(name)
            .value = p.callRuntime(loc, "__name", p.expr_list.items[start..p.expr_list.items.len]),

            // Make sure tree shaking removes this if the function is never used
            .does_not_affect_tree_shaking = true,
        }, loc);
    }

    pub fn callRuntime(p: *P, loc: logger.Loc, comptime name: string, args: []Expr) Expr {
        var ref: Ref = undefined;
        if (!p.runtime_imports.contains(name)) {
            ref = p.newSymbol(.other, name) catch unreachable;
            p.module_scope.generated.append(ref) catch unreachable;
            p.runtime_imports.put(name, ref) catch unreachable;
        } else {
            ref = p.runtime_imports.get(name) orelse unreachable;
        }

        p.recordUsage(ref);
        return p.e(E.Call{
            .target = p.e(E.Identifier{
                .ref = ref,
            }, loc),
            .args = args,
        }, loc);
    }

    // Try separating the list for appending, so that it's not a pointer.
    fn visitStmts(p: *P, stmts: *List(Stmt), kind: StmtsKind) !void {
        // Save the current control-flow liveness. This represents if we are
        // currently inside an "if (false) { ... }" block.
        var old_is_control_flow_dead = p.is_control_flow_dead;

        // visit all statements first
        var visited = List(Stmt).init(p.allocator);
        var before = List(Stmt).init(p.allocator);
        var after = List(Stmt).init(p.allocator);
        defer before.deinit();
        defer visited.deinit();
        defer after.deinit();

        for (stmts.items) |*stmt, i| {
            const list = list_getter: {
                switch (stmt.data) {
                    .s_export_equals => {
                        // TypeScript "export = value;" becomes "module.exports = value;". This
                        // must happen at the end after everything is parsed because TypeScript
                        // moves this statement to the end when it generates code.
                        break :list_getter &after;
                    },
                    .s_function => |data| {
                        // Manually hoist block-level function declarations to preserve semantics.
                        // This is only done for function declarations that are not generators
                        // or async functions, since this is a backwards-compatibility hack from
                        // Annex B of the JavaScript standard.
                        if (!p.current_scope.kindStopsHoisting() and p.symbols.items[data.func.name.?.ref.?.inner_index].kind == .hoisted_function) {
                            break :list_getter &before;
                        }
                    },
                    else => {},
                }
                break :list_getter &visited;
            };

            try p.visitAndAppendStmt(list, stmt);
        }

        p.is_control_flow_dead = old_is_control_flow_dead;
        try stmts.resize(visited.items.len + before.items.len + after.items.len);
        var i: usize = 0;

        for (before.items) |item| {
            stmts.items[i] = item;
            i += 1;
        }

        for (visited.items) |item| {
            stmts.items[i] = item;
            i += 1;
        }

        for (after.items) |item| {
            stmts.items[i] = item;
            i += 1;
        }
    }

    fn extractDeclsForBinding(binding: Binding, decls: *List(G.Decl)) !void {
        switch (binding.data) {
            .b_property, .b_missing => {},
            .b_identifier => {
                try decls.append(G.Decl{ .binding = binding });
            },
            .b_array => |arr| {
                for (arr.items) |item| {
                    extractDeclsForBinding(item.binding, decls) catch unreachable;
                }
            },
            .b_object => |obj| {
                for (obj.properties) |prop| {
                    extractDeclsForBinding(prop.value, decls) catch unreachable;
                }
            },
        }
    }

    // This assumes that the open parenthesis has already been parsed by the caller
    pub fn parseParenExpr(p: *P, loc: logger.Loc, level: Level, opts: ParenExprOpts) !Expr {
        var items_list = List(Expr).init(p.allocator);
        var errors = DeferredErrors{};
        var arrowArgErrors = DeferredArrowArgErrors{};
        var spread_range = logger.Range{};
        var type_colon_range = logger.Range{};
        var comma_after_spread: ?logger.Loc = null;

        // Push a scope assuming this is an arrow function. It may not be, in which
        // case we'll need to roll this change back. This has to be done ahead of
        // parsing the arguments instead of later on when we hit the "=>" token and
        // we know it's an arrow function because the arguments may have default
        // values that introduce new scopes and declare new symbols. If this is an
        // arrow function, then those new scopes will need to be parented under the
        // scope of the arrow function itself.
        const scope_index = try p.pushScopeForParsePass(.function_args, loc);

        // Allow "in" inside parentheses
        var oldAllowIn = p.allow_in;
        p.allow_in = true;

        // Forbid "await" and "yield", but only for arrow functions
        var old_fn_or_arrow_data = p.fn_or_arrow_data_parse;
        p.fn_or_arrow_data_parse.arrow_arg_errors = arrowArgErrors;

        // Scan over the comma-separated arguments or expressions
        while (p.lexer.token != .t_close_paren) {
            const item_loc = p.lexer.loc();
            const is_spread = p.lexer.token == .t_dot_dot_dot;

            if (is_spread) {
                spread_range = p.lexer.range();
                // p.markSyntaxFeature()
                try p.lexer.next();
            }

            // We don't know yet whether these are arguments or expressions, so parse
            p.latest_arrow_arg_loc = p.lexer.loc();

            var item = try p.parseExprOrBindings(.comma, &errors);

            if (is_spread) {
                item = p.e(E.Spread{ .value = item }, loc);
            }

            // Skip over types
            if (p.options.ts and p.lexer.token == .t_colon) {
                type_colon_range = p.lexer.range();
                try p.lexer.next();
                p.skipTypescriptType(.lowest);
            }

            // There may be a "=" after the type (but not after an "as" cast)
            if (p.options.ts and p.lexer.token == .t_equals and !p.forbid_suffix_after_as_loc.eql(p.lexer.loc())) {
                try p.lexer.next();
                item = Expr.assign(item, try p.parseExpr(.comma), p.allocator);
            }

            items_list.append(item) catch unreachable;

            if (p.lexer.token != .t_comma) {
                break;
            }

            // Spread arguments must come last. If there's a spread argument followed
            if (is_spread) {
                comma_after_spread = p.lexer.loc();
            }

            // Eat the comma token
            try p.lexer.next();
        }
        var items = items_list.toOwnedSlice();

        // The parenthetical construct must end with a close parenthesis
        try p.lexer.expect(.t_close_paren);

        // Restore "in" operator status before we parse the arrow function body
        p.allow_in = oldAllowIn;

        // Also restore "await" and "yield" expression errors
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        // Are these arguments to an arrow function?
        if (p.lexer.token == .t_equals_greater_than or opts.force_arrow_fn or (p.options.ts and p.lexer.token == .t_colon)) {
            // Arrow functions are not allowed inside certain expressions
            if (level.gt(.assign)) {
                try p.lexer.unexpected();
            }

            var invalidLog = List(logger.Loc).init(p.allocator);
            var args = List(G.Arg).init(p.allocator);

            if (opts.is_async) {
                // markl,oweredsyntaxpoksdpokasd
            }

            // First, try converting the expressions to bindings
            var i: usize = 0;
            while (i < items.len) : (i += 1) {
                var is_spread = false;
                switch (items[i].data) {
                    .e_spread => |v| {
                        is_spread = true;
                        items[i] = v.value;
                    },
                    else => {},
                }

                const tuple = p.convertExprToBindingAndInitializer(&items[i], &invalidLog, is_spread);
                // double allocations
                args.append(G.Arg{
                    .binding = tuple.binding orelse Binding{ .data = Prefill.Data.BMissing, .loc = items[i].loc },
                    .default = tuple.expr,
                }) catch unreachable;
            }

            // Avoid parsing TypeScript code like "a ? (1 + 2) : (3 + 4)" as an arrow
            // function. The ":" after the ")" may be a return type annotation, so we
            // attempt to convert the expressions to bindings first before deciding
            // whether this is an arrow function, and only pick an arrow function if
            // there were no conversion errors.
            if (p.lexer.token == .t_equals_greater_than or (invalidLog.items.len == 0 and p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking()) or opts.force_arrow_fn) {
                p.maybeCommaSpreadError(comma_after_spread);
                p.logArrowArgErrors(&arrowArgErrors);

                // Now that we've decided we're an arrow function, report binding pattern
                // conversion errors
                if (invalidLog.items.len > 0) {
                    for (invalidLog.items) |_loc| {
                        try p.log.addError(p.source, _loc, "Invalid binding pattern");
                    }
                }
                var arrow_data = FnOrArrowDataParse{
                    .allow_await = if (opts.is_async) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                };
                var arrow = try p.parseArrowBody(args.items, &arrow_data);
                arrow.is_async = opts.is_async;
                arrow.has_rest_arg = spread_range.len > 0;
                p.popScope();
                return p.e(arrow, loc);
            }
        }

        // If we get here, it's not an arrow function so undo the pushing of the
        // scope we did earlier. This needs to flatten any child scopes into the
        // parent scope as if the scope was never pushed in the first place.
        p.popAndFlattenScope(scope_index);

        // If this isn't an arrow function, then types aren't allowed
        if (type_colon_range.len > 0) {
            try p.log.addRangeError(p.source, type_colon_range, "Unexpected \":\"");
            return error.ParseError;
        }

        // Are these arguments for a call to a function named "async"?
        if (opts.is_async) {
            p.logExprErrors(&errors);
            const async_expr = p.e(E.Identifier{ .ref = try p.storeNameInRef("async") }, loc);
            return p.e(E.Call{ .target = async_expr, .args = items }, loc);
        }

        // Is this a chain of expressions and comma operators?
        if (items.len > 0) {
            p.logExprErrors(&errors);
            if (spread_range.len > 0) {
                try p.log.addRangeError(p.source, type_colon_range, "Unexpected \"...\"");
                return error.ParseError;
            }

            var value = Expr.joinAllWithComma(items, p.allocator);
            p.markExprAsParenthesized(&value);
            return value;
        }

        // Indicate that we expected an arrow function
        try p.lexer.expected(.t_equals_greater_than);
        return error.ParseError;
    }

    // This code is tricky.
    // - Doing it incorrectly will cause segfaults.
    // - Doing it correctly drastically affects runtime performance while parsing larger files
    // The key is in how we remove scopes from the list
    // If we do an orderedRemove, it gets very slow.
    // swapRemove is fast. But a little more dangerous.
    // Instead, we just tombstone it.
    pub fn popAndFlattenScope(p: *P, scope_index: usize) void {
        // Move up to the parent scope
        var to_flatten = p.current_scope;
        var parent = to_flatten.parent.?;
        p.current_scope = parent;

        // Erase this scope from the order. This will shift over the indices of all
        // the scopes that were created after us. However, we shouldn't have to
        // worry about other code with outstanding scope indices for these scopes.
        // These scopes were all created in between this scope's push and pop
        // operations, so they should all be child scopes and should all be popped
        // by the time we get here.
        p.scopes_in_order.items[scope_index] = null;
        // Remove the last child from the parent scope
        const last = parent.children.items.len - 1;
        assert(parent.children.items[last] == to_flatten);
        _ = parent.children.popOrNull();

        for (to_flatten.children.items) |item| {
            item.parent = parent;
            parent.children.append(item) catch unreachable;
        }
    }

    pub fn maybeCommaSpreadError(p: *P, _comma_after_spread: ?logger.Loc) void {
        const comma_after_spread = _comma_after_spread orelse return;
        if (comma_after_spread.start == -1) return;

        p.log.addRangeError(p.source, logger.Range{ .loc = comma_after_spread, .len = 1 }, "Unexpected \",\" after rest pattern") catch unreachable;
    }

    pub fn toAST(p: *P, _parts: []js_ast.Part) !js_ast.Ast {
        var parts = _parts;
        // Insert an import statement for any runtime imports we generated
        if (p.runtime_imports.count() > 0 and !p.options.omit_runtime_for_tests) {}

        var parts_end: usize = 0;
        // Handle import paths after the whole file has been visited because we need
        // symbol usage counts to be able to remove unused type-only imports in
        // TypeScript code.
        while (true) {
            var kept_import_equals = false;
            var removed_import_equals = false;

            var i: usize = 0;
            // Potentially remove some statements, then filter out parts to remove any
            // with no statements
            while (i < parts.len) : (i += 1) {
                var part = parts[i];
                p.import_records_for_current_part.shrinkRetainingCapacity(0);
                p.declared_symbols.shrinkRetainingCapacity(0);

                var result = try ImportScanner.scan(p, part.stmts);
                kept_import_equals = kept_import_equals or result.kept_import_equals;
                removed_import_equals = removed_import_equals or result.removed_import_equals;
                part.import_record_indices = p.import_records_for_current_part.toOwnedSlice();
                part.declared_symbols = p.declared_symbols.toOwnedSlice();
                part.stmts = result.stmts;
                if (part.stmts.len > 0) {
                    if (p.module_scope.contains_direct_eval and part.declared_symbols.len > 0) {
                        // If this file contains a direct call to "eval()", all parts that
                        // declare top-level symbols must be kept since the eval'd code may
                        // reference those symbols.
                        part.can_be_removed_if_unused = false;
                    }
                    parts[parts_end] = part;
                    parts_end += 1;
                }
            }

            // We need to iterate multiple times if an import-equals statement was
            // removed and there are more import-equals statements that may be removed
            if (!kept_import_equals or !removed_import_equals) {
                break;
            }
        }

        parts = parts[0..parts_end];
        // Do a second pass for exported items now that imported items are filled out
        for (parts) |part| {
            for (part.stmts) |stmt| {
                switch (stmt.data) {
                    .s_export_clause => |clause| {
                        for (clause.items) |item| {
                            if (p.named_imports.getEntry(item.name.ref.?)) |_import| {
                                _import.value.is_exported = true;
                            }
                        }
                    },
                    else => {},
                }
            }
        }

        // Analyze cross-part dependencies for tree shaking and code splitting

        {
            // Map locals to parts
            p.top_level_symbol_to_parts = @TypeOf(p.top_level_symbol_to_parts).init(p.allocator);
            var i: usize = 0;
            while (i < parts.len) : (i += 1) {
                const part = parts[i];
                for (part.declared_symbols) |declared| {
                    if (declared.is_top_level) {
                        if (p.top_level_symbol_to_parts.contains(declared.ref)) {
                            try p.top_level_symbol_to_parts.get(declared.ref).?.append(@intCast(u32, i));
                        } else {
                            var list = try List(u32).initCapacity(p.allocator, 1);
                            list.appendAssumeCapacity(@intCast(u32, i));
                            try p.top_level_symbol_to_parts.put(declared.ref, list);
                        }
                    }
                }
            }

            // Each part tracks the other parts it depends on within this file
            var local_dependencies = std.AutoHashMap(u32, u32).init(p.allocator);

            i = 0;
            while (i < parts.len) : (i += 1) {
                const part = parts[i];
                var iter = part.symbol_uses.iterator();
                var dependencies = List(js_ast.Dependency).init(p.allocator);
                while (iter.next()) |entry| {
                    const ref = entry.key;

                    if (p.top_level_symbol_to_parts.get(ref)) |tlstp| {
                        for (tlstp.items) |other_part_index| {
                            if (!local_dependencies.contains(other_part_index) or other_part_index != i) {
                                try local_dependencies.put(other_part_index, @intCast(u32, i));
                                try dependencies.append(js_ast.Dependency{
                                    .source_index = p.source.index,
                                    .part_index = other_part_index,
                                });
                            }
                        }
                    }

                    // Also map from imports to parts that use them
                    // TODO: will appending to this list like this be a perf issue?
                    if (p.named_imports.getEntry(ref)) |named_import_entry| {
                        const named_import = named_import_entry.value;
                        var buf = try p.allocator.alloc(u32, named_import.local_parts_with_uses.len + 1);
                        if (named_import.local_parts_with_uses.len > 0) {
                            std.mem.copy(u32, buf, named_import.local_parts_with_uses);
                        }
                        buf[buf.len - 1] = @intCast(u32, i);
                        named_import_entry.value.local_parts_with_uses = buf;
                    }
                }
            }
        }

        var exports_kind = js_ast.ExportsKind.none;
        const uses_exports_ref = p.symbols.items[p.exports_ref.inner_index].use_count_estimate > 0;
        const uses_module_ref = p.symbols.items[p.module_ref.inner_index].use_count_estimate > 0;

        if (p.es6_export_keyword.len > 0 or p.top_level_await_keyword.len > 0) {
            exports_kind = .esm;
        } else if (uses_exports_ref or uses_module_ref or p.has_top_level_return) {
            exports_kind = .cjs;
        } else {
            exports_kind = .esm;
        }

        var wrapper_name = try p.allocator.alloc(u8, "require_".len + p.source.identifier_name.len);
        std.mem.copy(u8, wrapper_name[0.."require_".len], "require_");
        std.mem.copy(u8, wrapper_name["require_".len..wrapper_name.len], p.source.identifier_name);

        var wrapper = try p.newSymbol(.other, wrapper_name);

        return js_ast.Ast{
            .parts = parts,
            .module_scope = p.module_scope.*,
            .symbols = p.symbols.toOwnedSlice(),
            .exports_ref = p.exports_ref,
            .wrapper_ref = wrapper,
            .import_records = p.import_records.toOwnedSlice(),
            .export_star_import_records = p.export_star_import_records.toOwnedSlice(),
            .top_level_symbol_to_parts = p.top_level_symbol_to_parts,
            .approximate_line_count = p.lexer.approximate_newline_count + 1,
            .exports_kind = exports_kind,
            .named_imports = p.named_imports,
            .named_exports = p.named_exports,
            .import_keyword = p.es6_import_keyword,
            .export_keyword = p.es6_export_keyword,
            // .top_Level_await_keyword = p.top_level_await_keyword,
        };
    }

    pub fn init(allocator: *std.mem.Allocator, log: *logger.Log, source: *const logger.Source, define: *Define, lexer: js_lexer.Lexer, opts: Parser.Options) !*P {
        var scope_order = try ScopeOrderList.initCapacity(allocator, 1);
        var scope = try allocator.create(Scope);
        scope.* = Scope{
            .members = @TypeOf(scope.members).init(allocator),
            .children = @TypeOf(scope.children).init(
                allocator,
            ),
            .generated = @TypeOf(scope.generated).init(allocator),
            .kind = .entry,
            .label_ref = null,
            .parent = null,
        };

        scope_order.appendAssumeCapacity(ScopeOrder{ .loc = locModuleScope, .scope = scope });

        var _parser = try allocator.create(P);
        _parser.* = P{
            // This must default to true or else parsing "in" won't work right.
            // It will fail for the case in the "in-keyword.js" file
            .allow_in = true,

            .symbol_uses = SymbolUseMap.init(allocator),
            .call_target = nullExprData,
            .delete_target = nullExprData,
            .stmt_expr_value = nullExprData,
            .expr_list = List(Expr).init(allocator),
            .loop_body = nullStmtData,
            .injected_define_symbols = @TypeOf(_parser.injected_define_symbols).init(allocator),
            .emitted_namespace_vars = @TypeOf(_parser.emitted_namespace_vars).init(allocator),
            .is_exported_inside_namespace = @TypeOf(_parser.is_exported_inside_namespace).init(allocator),
            .known_enum_values = @TypeOf(_parser.known_enum_values).init(allocator),
            .local_type_names = @TypeOf(_parser.local_type_names).init(allocator),
            .allocated_names = @TypeOf(_parser.allocated_names).init(allocator),
            .define = define,
            .scopes_for_current_part = @TypeOf(_parser.scopes_for_current_part).init(allocator),
            .symbols = @TypeOf(_parser.symbols).init(allocator),
            .ts_use_counts = @TypeOf(_parser.ts_use_counts).init(allocator),
            .declared_symbols = @TypeOf(_parser.declared_symbols).init(allocator),
            .import_records = @TypeOf(_parser.import_records).init(allocator),
            .import_records_for_current_part = @TypeOf(_parser.import_records_for_current_part).init(allocator),
            .export_star_import_records = @TypeOf(_parser.export_star_import_records).init(allocator),
            .import_items_for_namespace = @TypeOf(_parser.import_items_for_namespace).init(allocator),
            .named_imports = @TypeOf(_parser.named_imports).init(allocator),
            .named_exports = @TypeOf(_parser.named_exports).init(allocator),
            .top_level_symbol_to_parts = @TypeOf(_parser.top_level_symbol_to_parts).init(allocator),
            .import_namespace_cc_map = @TypeOf(_parser.import_namespace_cc_map).init(allocator),
            .scopes_in_order = scope_order,
            .current_scope = scope,
            .temp_refs_to_declare = @TypeOf(_parser.temp_refs_to_declare).init(allocator),
            .relocated_top_level_vars = @TypeOf(_parser.relocated_top_level_vars).init(allocator),
            .log = log,
            .is_import_item = @TypeOf(_parser.is_import_item).init(allocator),
            .allocator = allocator,
            .runtime_imports = StringRefMap.init(allocator),
            .options = opts,
            .then_catch_chain = ThenCatchChain{ .next_target = nullExprData },
            .to_expr_wrapper_namespace = Binding2ExprWrapper.Namespace.init(_parser),
            .to_expr_wrapper_hoisted = Binding2ExprWrapper.Hoisted.init(_parser),
            .source = source,
            .import_transposer = @TypeOf(_parser.import_transposer).init(_parser),
            .require_transposer = @TypeOf(_parser.require_transposer).init(_parser),
            .require_resolve_transposer = @TypeOf(_parser.require_resolve_transposer).init(_parser),
            .lexer = lexer,
            .data = js_ast.AstData.init(allocator),
        };

        return _parser;
    }
};

// The "await" and "yield" expressions are never allowed in argument lists but
// may or may not be allowed otherwise depending on the details of the enclosing
// function or module. This needs to be handled when parsing an arrow function
// argument list because we don't know if these expressions are not allowed until
// we reach the "=>" token (or discover the absence of one).
//
// Specifically, for await:
//
//   // This is ok
//   async function foo() { (x = await y) }
//
//   // This is an error
//   async function foo() { (x = await y) => {} }
//
// And for yield:
//
//   // This is ok
//   function* foo() { (x = yield y) }
//
//   // This is an error
//   function* foo() { (x = yield y) => {} }
//
const DeferredArrowArgErrors = struct {
    invalid_expr_await: logger.Range = logger.Range.None,
    invalid_expr_yield: logger.Range = logger.Range.None,
};
