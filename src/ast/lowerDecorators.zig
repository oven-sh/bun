/// Lowering for TC39 standard ES decorators.
/// Extracted from P.zig to reduce duplication via shared helpers.
pub fn LowerDecorators(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);

        // ── Types ────────────────────────────────────────────

        const PrivateLoweredInfo = struct {
            storage_ref: Ref,
            method_fn_ref: ?Ref = null,
            getter_fn_ref: ?Ref = null,
            setter_fn_ref: ?Ref = null,
            accessor_desc_ref: ?Ref = null,
        };

        const PrivateLoweredMap = std.AutoHashMapUnmanaged(u32, PrivateLoweredInfo);

        const StdDecMode = union(enum) {
            stmt,
            expr: struct {
                class: *G.Class,
                loc: logger.Loc,
                name_from_context: ?[]const u8 = null,
            },
        };

        const FieldInitEntry = struct {
            prop: Property,
            is_private: bool,
            is_accessor: bool,
        };

        const StaticElement = struct {
            kind: enum { block, field_or_accessor },
            index: usize,
        };

        // ── Expression builder helpers ───────────────────────

        /// recordUsage + E.Identifier in one call.
        inline fn useRef(p: *P, ref: Ref, l: logger.Loc) Expr {
            p.recordUsage(ref);
            return p.newExpr(E.Identifier{ .ref = ref }, l);
        }

        /// Allocate args + callRuntime in one call.
        fn callRt(p: *P, l: logger.Loc, comptime name: []const u8, args: []const Expr) Expr {
            const a = bun.handleOom(p.allocator.alloc(Expr, args.len));
            @memcpy(a, args);
            return p.callRuntime(l, name, a);
        }

        /// newSymbol + scope.generated.append in one call.
        fn newSym(p: *P, kind: Symbol.Kind, name: []const u8) Ref {
            const ref = p.newSymbol(kind, name) catch unreachable;
            bun.handleOom(p.current_scope.generated.append(p.allocator, ref));
            return ref;
        }

        /// Single var declaration statement.
        fn varDecl(p: *P, ref: Ref, value: ?Expr, l: logger.Loc) Stmt {
            const decls = bun.handleOom(p.allocator.alloc(G.Decl, 1));
            decls[0] = .{ .binding = p.b(B.Identifier{ .ref = ref }, l), .value = value };
            return p.s(S.Local{ .decls = Decl.List.fromOwnedSlice(decls) }, l);
        }

        /// Two-variable declaration statement.
        fn varDecl2(p: *P, r1: Ref, v1: ?Expr, r2: Ref, v2: ?Expr, l: logger.Loc) Stmt {
            const decls = bun.handleOom(p.allocator.alloc(G.Decl, 2));
            decls[0] = .{ .binding = p.b(B.Identifier{ .ref = r1 }, l), .value = v1 };
            decls[1] = .{ .binding = p.b(B.Identifier{ .ref = r2 }, l), .value = v2 };
            return p.s(S.Local{ .decls = Decl.List.fromOwnedSlice(decls) }, l);
        }

        /// recordUsage + Expr.assign.
        fn assignTo(p: *P, ref: Ref, value: Expr, l: logger.Loc) Expr {
            p.recordUsage(ref);
            return Expr.assign(p.newExpr(E.Identifier{ .ref = ref }, l), value);
        }

        /// new WeakMap() expression.
        fn newWeakMapExpr(p: *P, l: logger.Loc) Expr {
            return p.newExpr(E.New{
                .target = p.newExpr(E.Identifier{ .ref = (p.findSymbol(l, "WeakMap") catch unreachable).ref }, l),
                .args = ExprNodeList.empty,
                .close_parens_loc = l,
            }, l);
        }

        /// new WeakSet() expression.
        fn newWeakSetExpr(p: *P, l: logger.Loc) Expr {
            return p.newExpr(E.New{
                .target = p.newExpr(E.Identifier{ .ref = (p.findSymbol(l, "WeakSet") catch unreachable).ref }, l),
                .args = ExprNodeList.empty,
                .close_parens_loc = l,
            }, l);
        }

        /// Create a static block property from a single expression.
        fn makeStaticBlock(p: *P, expr: Expr, l: logger.Loc) Property {
            const stmts = bun.handleOom(p.allocator.alloc(Stmt, 1));
            stmts[0] = p.s(S.SExpr{ .value = expr }, l);
            const sb = bun.handleOom(p.allocator.create(G.ClassStaticBlock));
            sb.* = .{ .loc = l, .stmts = bun.BabyList(Stmt).fromOwnedSlice(stmts) };
            return .{ .kind = .class_static_block, .class_static_block = sb };
        }

        /// Build property access: target.name or target[key].
        fn memberTarget(p: *P, target_expr: Expr, prop: Property) Expr {
            const key_expr = prop.key.?;
            if (prop.flags.contains(.is_computed) or key_expr.data == .e_number) {
                return p.newExpr(E.Index{ .target = target_expr, .index = key_expr }, key_expr.loc);
            } else if (key_expr.data == .e_string) {
                return p.newExpr(E.Dot{
                    .target = target_expr,
                    .name = key_expr.data.e_string.data,
                    .name_loc = key_expr.loc,
                }, key_expr.loc);
            } else {
                return p.newExpr(E.Index{ .target = target_expr, .index = key_expr }, key_expr.loc);
            }
        }

        fn initFlag(idx: usize) f64 {
            return @floatFromInt((4 + 2 * idx) << 1);
        }

        fn extraInitFlag(idx: usize) f64 {
            return @floatFromInt(((5 + 2 * idx) << 1) | 1);
        }

        /// Emit __privateAdd for a given storage ref. Appends to constructor or static blocks.
        fn emitPrivateAdd(
            p: *P,
            is_static: bool,
            storage_ref: Ref,
            value: ?Expr,
            loc: logger.Loc,
            constructor_inject: *ListManaged(Stmt),
            static_blocks: *ListManaged(Property),
        ) void {
            const target = p.newExpr(E.This{}, loc);
            if (value) |v| {
                const call = callRt(p, loc, "__privateAdd", &[_]Expr{ target, useRef(p, storage_ref, loc), v });
                if (is_static) {
                    static_blocks.append(makeStaticBlock(p, call, loc)) catch unreachable;
                } else {
                    constructor_inject.append(p.s(S.SExpr{ .value = call }, loc)) catch unreachable;
                }
            } else {
                const call = callRt(p, loc, "__privateAdd", &[_]Expr{ target, useRef(p, storage_ref, loc) });
                if (is_static) {
                    static_blocks.append(makeStaticBlock(p, call, loc)) catch unreachable;
                } else {
                    constructor_inject.append(p.s(S.SExpr{ .value = call }, loc)) catch unreachable;
                }
            }
        }

        /// Get the method kind code (1=method, 2=getter, 3=setter).
        fn methodKind(prop: *const Property) u8 {
            return switch (prop.kind) {
                .get => 2,
                .set => 3,
                else => 1,
            };
        }

        /// Get fn variable suffix for a given kind code.
        fn fnSuffix(k: u8) []const u8 {
            return if (k == 2) "_get" else if (k == 3) "_set" else "_fn";
        }

        // ── Generic tree rewriter ────────────────────────────

        const RewriteKind = union(enum) {
            replace_ref: struct { old: Ref, new: Ref },
            replace_this: struct { ref: Ref, loc: logger.Loc },
        };

        fn rewriteExpr(p: *P, expr: *Expr, kind: RewriteKind) void {
            switch (kind) {
                .replace_ref => |r| {
                    if (expr.data == .e_identifier and expr.data.e_identifier.ref.eql(r.old)) {
                        p.recordUsage(r.new);
                        expr.data = .{ .e_identifier = .{ .ref = r.new } };
                        return;
                    }
                },
                .replace_this => |r| {
                    if (expr.data == .e_this) {
                        expr.* = useRef(p, r.ref, r.loc);
                        return;
                    }
                },
            }
            switch (expr.data) {
                .e_binary => |e| {
                    rewriteExpr(p, &e.left, kind);
                    rewriteExpr(p, &e.right, kind);
                },
                .e_call => |e| {
                    rewriteExpr(p, &e.target, kind);
                    for (e.args.slice()) |*a| rewriteExpr(p, a, kind);
                },
                .e_new => |e| {
                    rewriteExpr(p, &e.target, kind);
                    for (e.args.slice()) |*a| rewriteExpr(p, a, kind);
                },
                .e_index => |e| {
                    rewriteExpr(p, &e.target, kind);
                    rewriteExpr(p, &e.index, kind);
                },
                .e_dot => |e| rewriteExpr(p, &e.target, kind),
                .e_spread => |e| rewriteExpr(p, &e.value, kind),
                .e_unary => |e| rewriteExpr(p, &e.value, kind),
                .e_if => |e| {
                    rewriteExpr(p, &e.test_, kind);
                    rewriteExpr(p, &e.yes, kind);
                    rewriteExpr(p, &e.no, kind);
                },
                .e_array => |e| {
                    for (e.items.slice()) |*item| rewriteExpr(p, item, kind);
                },
                .e_object => |e| {
                    for (e.properties.slice()) |*prop| {
                        if (prop.value) |*v| rewriteExpr(p, v, kind);
                        if (prop.initializer) |*ini| rewriteExpr(p, ini, kind);
                    }
                },
                .e_template => |e| {
                    if (e.tag) |*t| rewriteExpr(p, t, kind);
                    for (e.parts) |*part| rewriteExpr(p, &part.value, kind);
                },
                .e_arrow => |e| rewriteStmts(p, e.body.stmts, kind),
                .e_function => |e| {
                    switch (kind) {
                        .replace_this => {},
                        .replace_ref => {
                            if (e.func.body.stmts.len > 0)
                                rewriteStmts(p, e.func.body.stmts, kind);
                        },
                    }
                },
                .e_class => {},
                else => {},
            }
        }

        fn rewriteStmts(p: *P, stmts: []Stmt, kind: RewriteKind) void {
            for (stmts) |*cur_stmt| {
                switch (cur_stmt.data) {
                    .s_expr => |sexpr| {
                        var val = sexpr.value;
                        rewriteExpr(p, &val, kind);
                        cur_stmt.* = p.s(S.SExpr{
                            .value = val,
                            .does_not_affect_tree_shaking = sexpr.does_not_affect_tree_shaking,
                        }, cur_stmt.loc);
                    },
                    .s_local => |local| {
                        for (local.decls.slice()) |*decl| {
                            if (decl.value) |*v| rewriteExpr(p, v, kind);
                        }
                    },
                    .s_return => |ret| {
                        if (ret.value) |*v| rewriteExpr(p, v, kind);
                    },
                    .s_throw => |data| rewriteExpr(p, &data.value, kind),
                    .s_if => |data| {
                        rewriteExpr(p, &data.test_, kind);
                        rewriteStmts(p, (&data.yes)[0..1], kind);
                        if (data.no) |*no| rewriteStmts(p, no[0..1], kind);
                    },
                    .s_block => |data| rewriteStmts(p, data.stmts, kind),
                    .s_for => |data| {
                        if (data.init) |*fi| rewriteStmts(p, fi[0..1], kind);
                        if (data.test_) |*t| rewriteExpr(p, t, kind);
                        if (data.update) |*u| rewriteExpr(p, u, kind);
                        rewriteStmts(p, (&data.body)[0..1], kind);
                    },
                    .s_for_in => |data| {
                        rewriteExpr(p, &data.value, kind);
                        rewriteStmts(p, (&data.body)[0..1], kind);
                    },
                    .s_for_of => |data| {
                        rewriteExpr(p, &data.value, kind);
                        rewriteStmts(p, (&data.body)[0..1], kind);
                    },
                    .s_while => |data| {
                        rewriteExpr(p, &data.test_, kind);
                        rewriteStmts(p, (&data.body)[0..1], kind);
                    },
                    .s_do_while => |data| {
                        rewriteExpr(p, &data.test_, kind);
                        rewriteStmts(p, (&data.body)[0..1], kind);
                    },
                    .s_switch => |data| {
                        rewriteExpr(p, &data.test_, kind);
                        for (data.cases) |*case| {
                            if (case.value) |*v| rewriteExpr(p, v, kind);
                            rewriteStmts(p, case.body, kind);
                        }
                    },
                    .s_try => |data| {
                        rewriteStmts(p, data.body, kind);
                        if (data.catch_) |c| rewriteStmts(p, c.body, kind);
                        if (data.finally) |f| rewriteStmts(p, f.stmts, kind);
                    },
                    .s_label => |data| rewriteStmts(p, (&data.stmt)[0..1], kind),
                    .s_with => |data| {
                        rewriteExpr(p, &data.value, kind);
                        rewriteStmts(p, (&data.body)[0..1], kind);
                    },
                    else => {},
                }
            }
        }

        // ── Private access rewriting ─────────────────────────

        fn privateGetExpr(p: *P, obj: Expr, info: PrivateLoweredInfo, l: logger.Loc) Expr {
            if (info.accessor_desc_ref) |desc_ref| {
                return callRt(p, l, "__privateGet", &[_]Expr{
                    obj,
                    useRef(p, info.storage_ref, l),
                    p.newExpr(E.Dot{ .target = useRef(p, desc_ref, l), .name = "get", .name_loc = l }, l),
                });
            } else if (info.getter_fn_ref) |fn_ref| {
                return callRt(p, l, "__privateGet", &[_]Expr{ obj, useRef(p, info.storage_ref, l), useRef(p, fn_ref, l) });
            } else if (info.method_fn_ref) |fn_ref| {
                return callRt(p, l, "__privateMethod", &[_]Expr{ obj, useRef(p, info.storage_ref, l), useRef(p, fn_ref, l) });
            } else {
                return callRt(p, l, "__privateGet", &[_]Expr{ obj, useRef(p, info.storage_ref, l) });
            }
        }

        fn privateSetExpr(p: *P, obj: Expr, info: PrivateLoweredInfo, val: Expr, l: logger.Loc) Expr {
            if (info.accessor_desc_ref) |desc_ref| {
                return callRt(p, l, "__privateSet", &[_]Expr{
                    obj,
                    useRef(p, info.storage_ref, l),
                    val,
                    p.newExpr(E.Dot{ .target = useRef(p, desc_ref, l), .name = "set", .name_loc = l }, l),
                });
            } else if (info.setter_fn_ref) |fn_ref| {
                return callRt(p, l, "__privateSet", &[_]Expr{ obj, useRef(p, info.storage_ref, l), val, useRef(p, fn_ref, l) });
            } else {
                return callRt(p, l, "__privateSet", &[_]Expr{ obj, useRef(p, info.storage_ref, l), val });
            }
        }

        fn rewritePrivateAccessesInExpr(p: *P, expr: *Expr, map: *const PrivateLoweredMap) void {
            switch (expr.data) {
                .e_index => |e| {
                    rewritePrivateAccessesInExpr(p, &e.target, map);
                    if (e.index.data == .e_private_identifier) {
                        if (map.get(e.index.data.e_private_identifier.ref.innerIndex())) |info| {
                            expr.* = privateGetExpr(p, e.target, info, expr.loc);
                            return;
                        }
                    }
                    rewritePrivateAccessesInExpr(p, &e.index, map);
                },
                .e_binary => |e| {
                    if (e.op == .bin_assign and e.left.data == .e_index) {
                        if (e.left.data.e_index.index.data == .e_private_identifier) {
                            if (map.get(e.left.data.e_index.index.data.e_private_identifier.ref.innerIndex())) |info| {
                                rewritePrivateAccessesInExpr(p, &e.left.data.e_index.target, map);
                                rewritePrivateAccessesInExpr(p, &e.right, map);
                                expr.* = privateSetExpr(p, e.left.data.e_index.target, info, e.right, expr.loc);
                                return;
                            }
                        }
                    }
                    if (e.op == .bin_in and e.left.data == .e_private_identifier) {
                        if (map.get(e.left.data.e_private_identifier.ref.innerIndex())) |info| {
                            rewritePrivateAccessesInExpr(p, &e.right, map);
                            expr.* = callRt(p, expr.loc, "__privateIn", &[_]Expr{
                                useRef(p, info.storage_ref, expr.loc),
                                e.right,
                            });
                            return;
                        }
                    }
                    rewritePrivateAccessesInExpr(p, &e.left, map);
                    rewritePrivateAccessesInExpr(p, &e.right, map);
                },
                .e_call => |e| {
                    if (e.target.data == .e_index) {
                        if (e.target.data.e_index.index.data == .e_private_identifier) {
                            if (map.get(e.target.data.e_index.index.data.e_private_identifier.ref.innerIndex())) |info| {
                                rewritePrivateAccessesInExpr(p, &e.target.data.e_index.target, map);
                                const obj_expr = e.target.data.e_index.target;
                                const private_access = privateGetExpr(p, obj_expr, info, expr.loc);
                                const call_target = p.newExpr(E.Dot{
                                    .target = private_access,
                                    .name = "call",
                                    .name_loc = expr.loc,
                                }, expr.loc);
                                const orig_args = e.args.slice();
                                const new_args = bun.handleOom(p.allocator.alloc(Expr, 1 + orig_args.len));
                                new_args[0] = obj_expr;
                                for (orig_args, 0..) |*arg, ai| {
                                    rewritePrivateAccessesInExpr(p, arg, map);
                                    new_args[1 + ai] = arg.*;
                                }
                                e.target = call_target;
                                e.args = ExprNodeList.fromOwnedSlice(new_args);
                                return;
                            }
                        }
                    }
                    rewritePrivateAccessesInExpr(p, &e.target, map);
                    for (e.args.slice()) |*arg| rewritePrivateAccessesInExpr(p, arg, map);
                },
                .e_unary => |e| rewritePrivateAccessesInExpr(p, &e.value, map),
                .e_dot => |e| rewritePrivateAccessesInExpr(p, &e.target, map),
                .e_spread => |e| rewritePrivateAccessesInExpr(p, &e.value, map),
                .e_if => |e| {
                    rewritePrivateAccessesInExpr(p, &e.test_, map);
                    rewritePrivateAccessesInExpr(p, &e.yes, map);
                    rewritePrivateAccessesInExpr(p, &e.no, map);
                },
                .e_await => |e| rewritePrivateAccessesInExpr(p, &e.value, map),
                .e_yield => |e| {
                    if (e.value) |*v| rewritePrivateAccessesInExpr(p, v, map);
                },
                .e_new => |e| {
                    rewritePrivateAccessesInExpr(p, &e.target, map);
                    for (e.args.slice()) |*arg| rewritePrivateAccessesInExpr(p, arg, map);
                },
                .e_array => |e| {
                    for (e.items.slice()) |*item| rewritePrivateAccessesInExpr(p, item, map);
                },
                .e_object => |e| {
                    for (e.properties.slice()) |*prop| {
                        if (prop.value) |*v| rewritePrivateAccessesInExpr(p, v, map);
                        if (prop.initializer) |*ini| rewritePrivateAccessesInExpr(p, ini, map);
                    }
                },
                .e_template => |e| {
                    if (e.tag) |*t| rewritePrivateAccessesInExpr(p, t, map);
                    for (e.parts) |*part| rewritePrivateAccessesInExpr(p, &part.value, map);
                },
                .e_function => |e| rewritePrivateAccessesInStmts(p, e.func.body.stmts, map),
                .e_arrow => |e| rewritePrivateAccessesInStmts(p, e.body.stmts, map),
                else => {},
            }
        }

        fn rewritePrivateAccessesInStmts(p: *P, stmts: []Stmt, map: *const PrivateLoweredMap) void {
            for (stmts) |*stmt_item| {
                switch (stmt_item.data) {
                    .s_expr => |data| rewritePrivateAccessesInExpr(p, &data.value, map),
                    .s_return => |data| {
                        if (data.value) |*v| rewritePrivateAccessesInExpr(p, v, map);
                    },
                    .s_throw => |data| rewritePrivateAccessesInExpr(p, &data.value, map),
                    .s_local => |data| {
                        for (data.decls.slice()) |*decl| {
                            if (decl.value) |*v| rewritePrivateAccessesInExpr(p, v, map);
                        }
                    },
                    .s_if => |data| {
                        rewritePrivateAccessesInExpr(p, &data.test_, map);
                        rewritePrivateAccessesInStmts(p, (&data.yes)[0..1], map);
                        if (data.no) |*no| rewritePrivateAccessesInStmts(p, no[0..1], map);
                    },
                    .s_block => |data| rewritePrivateAccessesInStmts(p, data.stmts, map),
                    .s_for => |data| {
                        if (data.init) |*fi| rewritePrivateAccessesInStmts(p, fi[0..1], map);
                        if (data.test_) |*t| rewritePrivateAccessesInExpr(p, t, map);
                        if (data.update) |*u| rewritePrivateAccessesInExpr(p, u, map);
                        rewritePrivateAccessesInStmts(p, (&data.body)[0..1], map);
                    },
                    .s_for_in => |data| {
                        rewritePrivateAccessesInExpr(p, &data.value, map);
                        rewritePrivateAccessesInStmts(p, (&data.body)[0..1], map);
                    },
                    .s_for_of => |data| {
                        rewritePrivateAccessesInExpr(p, &data.value, map);
                        rewritePrivateAccessesInStmts(p, (&data.body)[0..1], map);
                    },
                    .s_while => |data| {
                        rewritePrivateAccessesInExpr(p, &data.test_, map);
                        rewritePrivateAccessesInStmts(p, (&data.body)[0..1], map);
                    },
                    .s_do_while => |data| {
                        rewritePrivateAccessesInExpr(p, &data.test_, map);
                        rewritePrivateAccessesInStmts(p, (&data.body)[0..1], map);
                    },
                    .s_switch => |data| {
                        rewritePrivateAccessesInExpr(p, &data.test_, map);
                        for (data.cases) |*case| {
                            if (case.value) |*v| rewritePrivateAccessesInExpr(p, v, map);
                            rewritePrivateAccessesInStmts(p, case.body, map);
                        }
                    },
                    .s_try => |data| {
                        rewritePrivateAccessesInStmts(p, data.body, map);
                        if (data.catch_) |c| rewritePrivateAccessesInStmts(p, c.body, map);
                        if (data.finally) |f| rewritePrivateAccessesInStmts(p, f.stmts, map);
                    },
                    .s_label => |data| rewritePrivateAccessesInStmts(p, (&data.stmt)[0..1], map),
                    .s_with => |data| {
                        rewritePrivateAccessesInExpr(p, &data.value, map);
                        rewritePrivateAccessesInStmts(p, (&data.body)[0..1], map);
                    },
                    else => {},
                }
            }
        }

        // ── Public API ───────────────────────────────────────

        pub fn lowerStandardDecoratorsStmt(p: *P, stmt: Stmt) []Stmt {
            return lowerImpl(p, stmt, .stmt);
        }

        pub fn lowerStandardDecoratorsExpr(p: *P, class: *G.Class, l: logger.Loc, name_from_context: ?[]const u8) Expr {
            const result = lowerImpl(p, Stmt.empty(), .{ .expr = .{
                .class = class,
                .loc = l,
                .name_from_context = name_from_context,
            } });
            if (result.len == 0) return p.newExpr(E.Missing{}, l);
            return result[0].data.s_expr.value;
        }

        // ── Core lowering ────────────────────────────────────

        fn lowerImpl(p: *P, stmt: Stmt, mode: StdDecMode) []Stmt {
            const is_expr = mode == .expr;
            var class = switch (mode) {
                .stmt => &stmt.data.s_class.class,
                .expr => |e| e.class,
            };
            const loc = switch (mode) {
                .stmt => stmt.loc,
                .expr => |e| e.loc,
            };
            const name_from_context: ?[]const u8 = switch (mode) {
                .expr => |e| e.name_from_context,
                .stmt => null,
            };

            // ── Phase 1: Setup ───────────────────────────────
            var class_name_ref: Ref = undefined;
            var class_name_loc: logger.Loc = undefined;
            var expr_class_ref: ?Ref = null;
            var expr_class_is_anonymous = false;
            var expr_var_decls = ListManaged(G.Decl).init(p.allocator);

            if (is_expr) {
                expr_class_ref = newSym(p, .other, "_class");
                expr_var_decls.append(.{ .binding = p.b(B.Identifier{ .ref = expr_class_ref.? }, loc) }) catch unreachable;
                if (class.class_name) |cn| {
                    class_name_ref = cn.ref.?;
                    class_name_loc = cn.loc;
                } else {
                    class_name_ref = expr_class_ref.?;
                    class_name_loc = loc;
                    expr_class_is_anonymous = true;
                    if (name_from_context) |name| {
                        class.class_name = .{ .ref = newSym(p, .other, name), .loc = loc };
                    }
                }
            } else {
                class_name_ref = class.class_name.?.ref.?;
                class_name_loc = class.class_name.?.loc;
            }

            var inner_class_ref: Ref = class_name_ref;
            if (!is_expr) {
                const cns = p.symbols.items[class_name_ref.innerIndex()].original_name;
                inner_class_ref = newSym(p, .other, std.fmt.allocPrint(p.allocator, "_{s}", .{cns}) catch unreachable);
            }

            const class_decorators = class.ts_decorators;
            class.ts_decorators = .{};

            const init_ref = newSym(p, .other, "_init");
            if (is_expr) {
                expr_var_decls.append(.{ .binding = p.b(B.Identifier{ .ref = init_ref }, loc) }) catch unreachable;
            }

            var base_ref: ?Ref = null;
            if (class.extends != null) {
                base_ref = newSym(p, .other, "_base");
                if (is_expr) {
                    expr_var_decls.append(.{ .binding = p.b(B.Identifier{ .ref = base_ref.? }, loc) }) catch unreachable;
                }
            }

            // ── Phase 2: Pre-evaluate decorators/keys ────────
            var dec_counter: usize = 0;
            var class_dec_ref: ?Ref = null;
            var class_dec_stmt: Stmt = Stmt.empty();
            var class_dec_assign_expr: ?Expr = null;
            if (class_decorators.len > 0) {
                dec_counter += 1;
                class_dec_ref = newSym(p, .other, "_dec");
                const arr = p.newExpr(E.Array{ .items = class_decorators }, loc);
                if (is_expr) {
                    expr_var_decls.append(.{ .binding = p.b(B.Identifier{ .ref = class_dec_ref.? }, loc) }) catch unreachable;
                    class_dec_assign_expr = assignTo(p, class_dec_ref.?, arr, loc);
                } else {
                    class_dec_stmt = varDecl(p, class_dec_ref.?, arr, loc);
                }
            }

            var prop_dec_refs = std.AutoHashMapUnmanaged(usize, Ref){};
            var computed_key_refs = std.AutoHashMapUnmanaged(usize, Ref){};
            var pre_eval_stmts = ListManaged(Stmt).init(p.allocator);
            var computed_key_counter: usize = 0;

            for (class.properties, 0..) |*prop, prop_idx| {
                if (prop.kind == .class_static_block) continue;
                if (prop.ts_decorators.len > 0) {
                    dec_counter += 1;
                    const dec_name = if (dec_counter == 1)
                        "_dec"
                    else
                        std.fmt.allocPrint(p.allocator, "_dec{d}", .{dec_counter}) catch unreachable;
                    const dec_ref = newSym(p, .other, dec_name);
                    prop_dec_refs.put(p.allocator, prop_idx, dec_ref) catch unreachable;
                    if (is_expr) {
                        expr_var_decls.append(.{ .binding = p.b(B.Identifier{ .ref = dec_ref }, loc) }) catch unreachable;
                    }
                    pre_eval_stmts.append(varDecl(p, dec_ref, p.newExpr(E.Array{ .items = prop.ts_decorators }, loc), loc)) catch unreachable;
                }
                if (prop.flags.contains(.is_computed) and prop.key != null and prop.ts_decorators.len > 0) {
                    computed_key_counter += 1;
                    const key_name = if (computed_key_counter == 1)
                        "_computedKey"
                    else
                        std.fmt.allocPrint(p.allocator, "_computedKey{d}", .{computed_key_counter}) catch unreachable;
                    const key_ref = newSym(p, .other, key_name);
                    computed_key_refs.put(p.allocator, prop_idx, key_ref) catch unreachable;
                    if (is_expr) {
                        expr_var_decls.append(.{ .binding = p.b(B.Identifier{ .ref = key_ref }, loc) }) catch unreachable;
                    }
                    pre_eval_stmts.append(varDecl(p, key_ref, prop.key.?, loc)) catch unreachable;
                    prop.key = useRef(p, key_ref, prop.key.?.loc);
                }
            }

            // Replace class name refs in pre-eval expressions for inner binding
            {
                const replacement_ref = if (is_expr) (expr_class_ref orelse class_name_ref) else inner_class_ref;
                if (!replacement_ref.eql(class_name_ref)) {
                    const rk: RewriteKind = .{ .replace_ref = .{ .old = class_name_ref, .new = replacement_ref } };
                    for (pre_eval_stmts.items) |*pre_stmt| {
                        if (pre_stmt.data == .s_local) {
                            for (pre_stmt.data.s_local.decls.slice()) |*decl| {
                                if (decl.value) |*v| rewriteExpr(p, v, rk);
                            }
                        }
                    }
                }
            }

            // For named class expressions: swap to expr_class_ref for suffix ops
            var original_class_name_for_decorator: ?[]const u8 = null;
            if (is_expr and !expr_class_is_anonymous and expr_class_ref != null) {
                original_class_name_for_decorator = p.symbols.items[class_name_ref.innerIndex()].original_name;
                class_name_ref = expr_class_ref.?;
                class_name_loc = loc;
            }

            // ── Phase 3: __decoratorStart + base decls ───────
            const init_start_expr: Expr = brk: {
                const base_expr = if (base_ref) |br|
                    p.newExpr(E.Identifier{ .ref = br }, loc)
                else
                    p.newExpr(E.Undefined{}, loc);
                break :brk callRt(p, loc, "__decoratorStart", &[_]Expr{base_expr});
            };

            var base_decl_stmt: Stmt = Stmt.empty();
            if (!is_expr) {
                if (base_ref) |br| base_decl_stmt = varDecl(p, br, class.extends, loc);
            }

            const base_assign_expr: ?Expr = if (is_expr and base_ref != null)
                assignTo(p, base_ref.?, class.extends.?, loc)
            else
                null;

            if (base_ref) |br| class.extends = useRef(p, br, loc);

            const init_decl_stmt: Stmt = if (!is_expr)
                varDecl(p, init_ref, init_start_expr, loc)
            else
                Stmt.empty();

            // ── Phase 4: Property loop ───────────────────────
            var suffix_exprs = ListManaged(Expr).init(p.allocator);
            var constructor_inject_stmts = ListManaged(Stmt).init(p.allocator);
            var new_properties = ListManaged(Property).init(p.allocator);
            var static_non_field_elements = ListManaged(Expr).init(p.allocator);
            var instance_non_field_elements = ListManaged(Expr).init(p.allocator);
            var has_static_private_methods = false;
            var has_instance_private_methods = false;
            var static_field_decorate = ListManaged(Expr).init(p.allocator);
            var instance_field_decorate = ListManaged(Expr).init(p.allocator);
            var static_accessor_count: usize = 0;
            var instance_accessor_count: usize = 0;
            var static_init_entries = ListManaged(FieldInitEntry).init(p.allocator);
            var instance_init_entries = ListManaged(FieldInitEntry).init(p.allocator);
            var static_element_order = ListManaged(StaticElement).init(p.allocator);
            var extracted_static_blocks = ListManaged(*G.ClassStaticBlock).init(p.allocator);
            var prefix_stmts = ListManaged(Stmt).init(p.allocator);
            var private_lowered_map = PrivateLoweredMap{};
            var accessor_storage_counter: usize = 0;
            var emitted_private_adds = std.AutoHashMapUnmanaged(u32, void){};
            var static_private_add_blocks = ListManaged(Property).init(p.allocator);

            // Pre-scan: determine if all private members need lowering
            var lower_all_private = false;
            {
                var has_any_private = false;
                var has_any_decorated = false;
                for (class.properties) |cprop| {
                    if (cprop.kind == .class_static_block) continue;
                    if (cprop.ts_decorators.len > 0) {
                        has_any_decorated = true;
                        if (cprop.key != null and cprop.key.?.data == .e_private_identifier) {
                            lower_all_private = true;
                            break;
                        }
                    }
                    if (cprop.key != null and cprop.key.?.data == .e_private_identifier) {
                        has_any_private = true;
                    }
                }
                if (!lower_all_private and has_any_private and has_any_decorated)
                    lower_all_private = true;
            }

            for (class.properties, 0..) |*prop, prop_idx| {
                if (prop.ts_decorators.len == 0) {
                    // ── Non-decorated property ──
                    if (lower_all_private and prop.key != null and
                        prop.key.?.data == .e_private_identifier and prop.kind != .class_static_block and
                        prop.kind != .auto_accessor)
                    {
                        const nk_expr = prop.key.?;
                        const npriv_orig = p.symbols.items[nk_expr.data.e_private_identifier.ref.innerIndex()].original_name;
                        const npriv_inner = nk_expr.data.e_private_identifier.ref.innerIndex();

                        if (prop.flags.contains(.is_method)) {
                            // Non-decorated private method/getter/setter → WeakSet + fn extraction
                            const nk = methodKind(prop);
                            const existing = private_lowered_map.get(npriv_inner);
                            const ws_ref = if (existing) |ex| ex.storage_ref else brk: {
                                break :brk newSym(p, .other, std.fmt.allocPrint(p.allocator, "_{s}", .{npriv_orig[1..]}) catch unreachable);
                            };
                            const fn_nm = std.fmt.allocPrint(p.allocator, "_{s}{s}", .{ npriv_orig[1..], fnSuffix(nk) }) catch unreachable;
                            const fn_ref = newSym(p, .other, fn_nm);

                            var new_info = if (existing) |ex| ex else PrivateLoweredInfo{ .storage_ref = ws_ref };
                            if (nk == 1) new_info.method_fn_ref = fn_ref else if (nk == 2) new_info.getter_fn_ref = fn_ref else new_info.setter_fn_ref = fn_ref;
                            private_lowered_map.put(p.allocator, npriv_inner, new_info) catch unreachable;

                            if (existing == null) {
                                prefix_stmts.append(varDecl2(p, ws_ref, newWeakSetExpr(p, loc), fn_ref, null, loc)) catch unreachable;
                            } else {
                                prefix_stmts.append(varDecl(p, fn_ref, null, loc)) catch unreachable;
                            }

                            // Assign function: _fn = function() { ... }
                            prefix_stmts.append(p.s(S.SExpr{
                                .value = assignTo(p, fn_ref, if (prop.value) |v| v else p.newExpr(E.Undefined{}, loc), loc),
                            }, loc)) catch unreachable;

                            // __privateAdd (once per name)
                            if (!emitted_private_adds.contains(npriv_inner)) {
                                emitted_private_adds.put(p.allocator, npriv_inner, {}) catch unreachable;
                                emitPrivateAdd(p, prop.flags.contains(.is_static), ws_ref, null, loc, &constructor_inject_stmts, &static_private_add_blocks);
                            }
                            continue;
                        } else {
                            // Non-decorated private field → WeakMap
                            const wm_nm = std.fmt.allocPrint(p.allocator, "_{s}", .{npriv_orig[1..]}) catch unreachable;
                            const wm_ref = newSym(p, .other, wm_nm);
                            private_lowered_map.put(p.allocator, npriv_inner, .{ .storage_ref = wm_ref }) catch unreachable;
                            prefix_stmts.append(varDecl(p, wm_ref, newWeakMapExpr(p, loc), loc)) catch unreachable;

                            const init_val = if (prop.initializer) |iv| iv else p.newExpr(E.Undefined{}, loc);
                            if (!prop.flags.contains(.is_static)) {
                                constructor_inject_stmts.append(p.s(S.SExpr{
                                    .value = callRt(p, loc, "__privateAdd", &[_]Expr{
                                        p.newExpr(E.This{}, loc),
                                        useRef(p, wm_ref, loc),
                                        init_val,
                                    }),
                                }, loc)) catch unreachable;
                            } else {
                                static_private_add_blocks.append(makeStaticBlock(
                                    p,
                                    callRt(p, loc, "__privateAdd", &[_]Expr{
                                        p.newExpr(E.This{}, loc),
                                        useRef(p, wm_ref, loc),
                                        init_val,
                                    }),
                                    loc,
                                )) catch unreachable;
                            }
                            continue;
                        }
                    }
                    // Undecorated auto-accessor → WeakMap + getter/setter
                    if (prop.kind == .auto_accessor) {
                        const accessor_name = brk: {
                            if (prop.key.?.data == .e_string)
                                break :brk std.fmt.allocPrint(p.allocator, "_{s}", .{prop.key.?.data.e_string.data}) catch unreachable;
                            const name = std.fmt.allocPrint(p.allocator, "_accessor_storage{d}", .{accessor_storage_counter}) catch unreachable;
                            accessor_storage_counter += 1;
                            break :brk name;
                        };
                        const wm_ref = newSym(p, .other, accessor_name);
                        prefix_stmts.append(varDecl(p, wm_ref, newWeakMapExpr(p, loc), loc)) catch unreachable;

                        // Getter: get foo() { return __privateGet(this, _foo); }
                        const get_body = bun.handleOom(p.allocator.alloc(Stmt, 1));
                        get_body[0] = p.s(S.Return{ .value = callRt(p, loc, "__privateGet", &[_]Expr{
                            p.newExpr(E.This{}, loc),
                            useRef(p, wm_ref, loc),
                        }) }, loc);
                        const get_fn = bun.handleOom(p.allocator.create(G.Fn));
                        get_fn.* = .{ .body = .{ .stmts = get_body, .loc = loc } };

                        // Setter: set foo(v) { __privateSet(this, _foo, v); }
                        const setter_param_ref = newSym(p, .other, "v");
                        const set_body = bun.handleOom(p.allocator.alloc(Stmt, 1));
                        set_body[0] = p.s(S.SExpr{ .value = callRt(p, loc, "__privateSet", &[_]Expr{
                            p.newExpr(E.This{}, loc),
                            useRef(p, wm_ref, loc),
                            useRef(p, setter_param_ref, loc),
                        }) }, loc);
                        const setter_fn_args = bun.handleOom(p.allocator.alloc(G.Arg, 1));
                        setter_fn_args[0] = .{ .binding = p.b(B.Identifier{ .ref = setter_param_ref }, loc) };
                        const set_fn = bun.handleOom(p.allocator.create(G.Fn));
                        set_fn.* = .{ .args = setter_fn_args, .body = .{ .stmts = set_body, .loc = loc } };

                        var getter_flags = prop.flags;
                        getter_flags.insert(.is_method);
                        new_properties.append(.{
                            .key = prop.key,
                            .value = p.newExpr(E.Function{ .func = get_fn.* }, loc),
                            .kind = .get,
                            .flags = getter_flags,
                        }) catch unreachable;
                        new_properties.append(.{
                            .key = prop.key,
                            .value = p.newExpr(E.Function{ .func = set_fn.* }, loc),
                            .kind = .set,
                            .flags = getter_flags,
                        }) catch unreachable;

                        const init_val = if (prop.initializer) |iv| iv else p.newExpr(E.Undefined{}, loc);
                        if (!prop.flags.contains(.is_static)) {
                            constructor_inject_stmts.append(p.s(S.SExpr{
                                .value = callRt(p, loc, "__privateAdd", &[_]Expr{
                                    p.newExpr(E.This{}, loc),
                                    useRef(p, wm_ref, loc),
                                    init_val,
                                }),
                            }, loc)) catch unreachable;
                        } else {
                            suffix_exprs.append(callRt(p, loc, "__privateAdd", &[_]Expr{
                                useRef(p, class_name_ref, class_name_loc),
                                useRef(p, wm_ref, loc),
                                init_val,
                            })) catch unreachable;
                        }
                        continue;
                    }
                    // Static blocks → extract to suffix
                    if (prop.kind == .class_static_block) {
                        if (prop.class_static_block) |sb| {
                            static_element_order.append(.{ .kind = .block, .index = extracted_static_blocks.items.len }) catch unreachable;
                            extracted_static_blocks.append(sb) catch unreachable;
                        }
                        continue;
                    }
                    new_properties.append(prop.*) catch unreachable;
                    continue;
                }

                // ── Decorated property ──
                var flags: f64 = 0;
                if (prop.flags.contains(.is_method)) {
                    flags = switch (prop.kind) {
                        .get => 2,
                        .set => 3,
                        else => 1,
                    };
                } else {
                    flags = switch (prop.kind) {
                        .auto_accessor => 4,
                        else => 5,
                    };
                }
                if (prop.flags.contains(.is_static)) flags += 8;
                const is_private = prop.key.?.data == .e_private_identifier;
                if (is_private) flags += 16;

                const decorator_array = if (prop_dec_refs.get(prop_idx)) |dec_ref|
                    useRef(p, dec_ref, loc)
                else
                    p.newExpr(E.Array{ .items = prop.ts_decorators }, loc);

                const key_expr = prop.key.?;
                const k = @as(u8, @intFromFloat(flags)) & 7;

                var dec_arg_count: usize = 5;
                var private_storage_ref: ?Ref = null;
                var private_extra_ref: ?Ref = null;
                var private_method_fn_ref: ?Ref = null;

                if (is_private) {
                    const private_orig = p.symbols.items[key_expr.data.e_private_identifier.ref.innerIndex()].original_name;
                    const priv_inner = key_expr.data.e_private_identifier.ref.innerIndex();

                    if (k >= 1 and k <= 3) {
                        // Decorated private method/getter/setter → WeakSet
                        const existing = private_lowered_map.get(priv_inner);
                        const ws_ref = if (existing) |ex| ex.storage_ref else newSym(p, .other, std.fmt.allocPrint(p.allocator, "_{s}", .{private_orig[1..]}) catch unreachable);
                        private_storage_ref = ws_ref;
                        const fn_ref = newSym(p, .other, std.fmt.allocPrint(p.allocator, "_{s}{s}", .{ private_orig[1..], fnSuffix(k) }) catch unreachable);
                        private_method_fn_ref = fn_ref;

                        var new_info = if (existing) |ex| ex else PrivateLoweredInfo{ .storage_ref = ws_ref };
                        if (k == 1) new_info.method_fn_ref = fn_ref else if (k == 2) new_info.getter_fn_ref = fn_ref else new_info.setter_fn_ref = fn_ref;
                        private_lowered_map.put(p.allocator, priv_inner, new_info) catch unreachable;

                        if (existing == null) {
                            prefix_stmts.append(varDecl2(p, ws_ref, newWeakSetExpr(p, loc), fn_ref, null, loc)) catch unreachable;
                        } else {
                            prefix_stmts.append(varDecl(p, fn_ref, null, loc)) catch unreachable;
                        }
                        dec_arg_count = 6;
                    } else if (k == 5) {
                        // Decorated private field → WeakMap
                        const wm_ref = newSym(p, .other, std.fmt.allocPrint(p.allocator, "_{s}", .{private_orig[1..]}) catch unreachable);
                        private_storage_ref = wm_ref;
                        private_lowered_map.put(p.allocator, priv_inner, .{ .storage_ref = wm_ref }) catch unreachable;
                        prefix_stmts.append(varDecl(p, wm_ref, newWeakMapExpr(p, loc), loc)) catch unreachable;
                        dec_arg_count = 5;
                    } else if (k == 4) {
                        // Decorated private auto-accessor → WeakMap + descriptor
                        const wm_ref = newSym(p, .other, std.fmt.allocPrint(p.allocator, "_{s}", .{private_orig[1..]}) catch unreachable);
                        private_storage_ref = wm_ref;
                        const acc_ref = newSym(p, .other, std.fmt.allocPrint(p.allocator, "_{s}_acc", .{private_orig[1..]}) catch unreachable);
                        private_method_fn_ref = acc_ref;
                        private_lowered_map.put(p.allocator, priv_inner, .{
                            .storage_ref = wm_ref,
                            .accessor_desc_ref = acc_ref,
                        }) catch unreachable;
                        prefix_stmts.append(varDecl2(p, wm_ref, newWeakMapExpr(p, loc), acc_ref, null, loc)) catch unreachable;
                        dec_arg_count = 6;
                    }
                } else if (k == 4) {
                    // Decorated public auto-accessor → WeakMap
                    const accessor_name = brk: {
                        if (key_expr.data == .e_string)
                            break :brk std.fmt.allocPrint(p.allocator, "_{s}", .{key_expr.data.e_string.data}) catch unreachable;
                        const name = std.fmt.allocPrint(p.allocator, "_accessor_storage{d}", .{accessor_storage_counter}) catch unreachable;
                        accessor_storage_counter += 1;
                        break :brk name;
                    };
                    const wm_ref = newSym(p, .other, accessor_name);
                    private_extra_ref = wm_ref;
                    prefix_stmts.append(varDecl(p, wm_ref, newWeakMapExpr(p, loc), loc)) catch unreachable;
                    dec_arg_count = 6;
                }

                // Build __decorateElement args
                const target_ref = if (is_expr and expr_class_ref != null) expr_class_ref.? else class_name_ref;
                const dec_args = bun.handleOom(p.allocator.alloc(Expr, dec_arg_count));
                dec_args[0] = p.newExpr(E.Identifier{ .ref = init_ref }, loc);
                dec_args[1] = p.newExpr(E.Number{ .value = flags }, loc);
                dec_args[2] = if (is_private)
                    p.newExpr(E.String{ .data = p.symbols.items[key_expr.data.e_private_identifier.ref.innerIndex()].original_name }, loc)
                else
                    key_expr;
                dec_args[3] = decorator_array;

                if (is_private and private_storage_ref != null) {
                    dec_args[4] = useRef(p, private_storage_ref.?, loc);
                    if (dec_arg_count == 6) {
                        if (k >= 1 and k <= 3) {
                            dec_args[5] = if (prop.value) |v| v else p.newExpr(E.Undefined{}, loc);
                        } else if (k == 4) {
                            dec_args[5] = useRef(p, private_storage_ref.?, loc);
                        } else {
                            dec_args[5] = p.newExpr(E.Undefined{}, loc);
                        }
                    }
                } else {
                    p.recordUsage(target_ref);
                    dec_args[4] = p.newExpr(E.Identifier{ .ref = target_ref }, class_name_loc);
                    if (dec_arg_count == 6) {
                        if (private_extra_ref) |extra_ref| {
                            dec_args[5] = useRef(p, extra_ref, loc);
                        } else {
                            dec_args[5] = p.newExpr(E.Undefined{}, loc);
                        }
                    }
                }

                const raw_element = p.callRuntime(loc, "__decorateElement", dec_args);
                const element = if (private_method_fn_ref) |fn_ref|
                    assignTo(p, fn_ref, raw_element, loc)
                else
                    raw_element;

                // Categorize the element
                if (k >= 4) {
                    // Field (k=5) or accessor (k=4) — remove from class body
                    var prop_copy = prop.*;
                    prop_copy.ts_decorators = .{};
                    if (is_private) {
                        if (private_storage_ref) |ps_ref|
                            prop_copy.key = p.newExpr(E.Identifier{ .ref = ps_ref }, loc);
                    }
                    if (private_extra_ref) |pe_ref|
                        prop_copy.value = p.newExpr(E.Identifier{ .ref = pe_ref }, loc);

                    const is_accessor = (k == 4);
                    const init_entry = FieldInitEntry{ .prop = prop_copy, .is_private = is_private, .is_accessor = is_accessor };

                    if (prop.flags.contains(.is_static)) {
                        if (is_accessor) {
                            static_non_field_elements.append(element) catch unreachable;
                            static_accessor_count += 1;
                        } else {
                            static_field_decorate.append(element) catch unreachable;
                        }
                        static_element_order.append(.{ .kind = .field_or_accessor, .index = static_init_entries.items.len }) catch unreachable;
                        static_init_entries.append(init_entry) catch unreachable;
                    } else {
                        if (is_accessor) {
                            instance_non_field_elements.append(element) catch unreachable;
                            instance_accessor_count += 1;
                        } else {
                            instance_field_decorate.append(element) catch unreachable;
                        }
                        instance_init_entries.append(init_entry) catch unreachable;
                    }
                } else if (is_private and private_storage_ref != null) {
                    // Private method/getter/setter — remove from class body
                    const priv_inner2 = key_expr.data.e_private_identifier.ref.innerIndex();
                    if (!emitted_private_adds.contains(priv_inner2)) {
                        emitted_private_adds.put(p.allocator, priv_inner2, {}) catch unreachable;
                        emitPrivateAdd(p, prop.flags.contains(.is_static), private_storage_ref.?, null, loc, &constructor_inject_stmts, &static_private_add_blocks);
                    }
                    if (prop.flags.contains(.is_static)) {
                        static_non_field_elements.append(element) catch unreachable;
                        has_static_private_methods = true;
                    } else {
                        instance_non_field_elements.append(element) catch unreachable;
                        has_instance_private_methods = true;
                    }
                } else {
                    // Public method/getter/setter — keep in class body
                    var new_prop = prop.*;
                    new_prop.ts_decorators = .{};
                    new_properties.append(new_prop) catch unreachable;
                    if (prop.flags.contains(.is_static)) {
                        static_non_field_elements.append(element) catch unreachable;
                    } else {
                        instance_non_field_elements.append(element) catch unreachable;
                    }
                }
            }

            // ── Phase 5: Rewrite private accesses ────────────
            if (private_lowered_map.count() > 0) {
                for (new_properties.items) |*nprop| {
                    if (nprop.value) |*v| rewritePrivateAccessesInExpr(p, v, &private_lowered_map);
                    if (nprop.class_static_block) |sb|
                        rewritePrivateAccessesInStmts(p, sb.stmts.slice(), &private_lowered_map);
                }
                for (instance_init_entries.items) |*entry| {
                    if (entry.prop.initializer) |*ini| rewritePrivateAccessesInExpr(p, ini, &private_lowered_map);
                }
                for (static_init_entries.items) |*entry| {
                    if (entry.prop.initializer) |*ini| rewritePrivateAccessesInExpr(p, ini, &private_lowered_map);
                }
                for (extracted_static_blocks.items) |sb|
                    rewritePrivateAccessesInStmts(p, sb.stmts.slice(), &private_lowered_map);
                for (static_non_field_elements.items) |*elem| rewritePrivateAccessesInExpr(p, elem, &private_lowered_map);
                for (instance_non_field_elements.items) |*elem| rewritePrivateAccessesInExpr(p, elem, &private_lowered_map);
                for (static_field_decorate.items) |*elem| rewritePrivateAccessesInExpr(p, elem, &private_lowered_map);
                for (instance_field_decorate.items) |*elem| rewritePrivateAccessesInExpr(p, elem, &private_lowered_map);
                rewritePrivateAccessesInStmts(p, pre_eval_stmts.items, &private_lowered_map);
                rewritePrivateAccessesInStmts(p, prefix_stmts.items, &private_lowered_map);
            }

            // ── Phase 6: Emit suffix ─────────────────────────
            const static_field_count = static_field_decorate.items.len;
            const total_accessor_count = static_accessor_count + instance_accessor_count;
            const static_field_base_idx = total_accessor_count;
            const instance_accessor_base_idx = static_accessor_count;
            const instance_field_base_idx = total_accessor_count + static_field_count;

            // 1-4: __decorateElement calls in spec order
            suffix_exprs.appendSlice(static_non_field_elements.items) catch unreachable;
            suffix_exprs.appendSlice(instance_non_field_elements.items) catch unreachable;
            suffix_exprs.appendSlice(static_field_decorate.items) catch unreachable;
            suffix_exprs.appendSlice(instance_field_decorate.items) catch unreachable;

            // 5: Class decorator
            if (class_decorators.len > 0) {
                p.recordUsage(class_name_ref);
                const class_name_str: []const u8 = if (original_class_name_for_decorator) |name|
                    name
                else if (is_expr and expr_class_is_anonymous)
                    (name_from_context orelse "")
                else
                    p.symbols.items[class_name_ref.innerIndex()].original_name;

                const cls_dec_args = bun.handleOom(p.allocator.alloc(Expr, 5));
                cls_dec_args[0] = p.newExpr(E.Identifier{ .ref = init_ref }, loc);
                cls_dec_args[1] = p.newExpr(E.Number{ .value = 0 }, loc);
                cls_dec_args[2] = p.newExpr(E.String{ .data = class_name_str }, loc);
                cls_dec_args[3] = if (class_dec_ref) |cdr| useRef(p, cdr, loc) else p.newExpr(E.Array{ .items = class_decorators }, loc);
                cls_dec_args[4] = if (is_expr)
                    useRef(p, expr_class_ref.?, loc)
                else
                    p.newExpr(E.Identifier{ .ref = class_name_ref }, class_name_loc);

                suffix_exprs.append(assignTo(p, class_name_ref, p.callRuntime(loc, "__decorateElement", cls_dec_args), class_name_loc)) catch unreachable;
            }

            // 6: Static method extra initializers
            if (static_non_field_elements.items.len > 0 or has_static_private_methods) {
                suffix_exprs.append(callRt(p, loc, "__runInitializers", &[_]Expr{
                    useRef(p, init_ref, loc),
                    p.newExpr(E.Number{ .value = 3 }, loc),
                    useRef(p, class_name_ref, class_name_loc),
                })) catch unreachable;
            }

            // 7: Static elements in source order
            {
                var s_accessor_idx: usize = 0;
                var s_field_idx: usize = 0;
                for (static_element_order.items) |elem| {
                    switch (elem.kind) {
                        .block => {
                            const sb = extracted_static_blocks.items[elem.index];
                            const stmts_slice = sb.stmts.slice();
                            rewriteStmts(p, stmts_slice, .{ .replace_this = .{ .ref = class_name_ref, .loc = class_name_loc } });

                            // Check if all statements are simple expressions
                            const all_exprs = blk: {
                                for (stmts_slice) |sb_stmt| {
                                    if (sb_stmt.data != .s_expr) break :blk false;
                                }
                                break :blk true;
                            };

                            if (all_exprs) {
                                for (stmts_slice) |sb_stmt| {
                                    suffix_exprs.append(sb_stmt.data.s_expr.value) catch unreachable;
                                }
                            } else {
                                // Wrap in IIFE to preserve non-expression statements
                                const iife_body = p.newExpr(E.Arrow{
                                    .body = .{ .loc = loc, .stmts = stmts_slice },
                                    .is_async = false,
                                }, loc);
                                suffix_exprs.append(p.newExpr(E.Call{
                                    .target = iife_body,
                                    .args = ExprNodeList.empty,
                                }, loc)) catch unreachable;
                            }
                        },
                        .field_or_accessor => {
                            const entry = static_init_entries.items[elem.index];
                            const field_idx: usize = if (entry.is_accessor) brk: {
                                const idx = s_accessor_idx;
                                s_accessor_idx += 1;
                                break :brk idx;
                            } else brk: {
                                const idx = static_field_base_idx + s_field_idx;
                                s_field_idx += 1;
                                break :brk idx;
                            };

                            const run_args_count: usize = if (entry.prop.initializer != null) 4 else 3;
                            const run_args = bun.handleOom(p.allocator.alloc(Expr, run_args_count));
                            run_args[0] = useRef(p, init_ref, loc);
                            run_args[1] = p.newExpr(E.Number{ .value = initFlag(field_idx) }, loc);
                            run_args[2] = useRef(p, class_name_ref, class_name_loc);
                            if (entry.prop.initializer) |init_val| run_args[3] = init_val;
                            const run_init_call = p.callRuntime(loc, "__runInitializers", run_args);

                            if (entry.is_accessor or entry.is_private) {
                                const wm_ref_expr = if (entry.is_accessor and !entry.is_private)
                                    entry.prop.value.?
                                else
                                    entry.prop.key.?;
                                suffix_exprs.append(callRt(p, loc, "__privateAdd", &[_]Expr{
                                    useRef(p, class_name_ref, class_name_loc),
                                    wm_ref_expr,
                                    run_init_call,
                                })) catch unreachable;
                            } else {
                                const assign_target = memberTarget(p, useRef(p, class_name_ref, class_name_loc), entry.prop);
                                suffix_exprs.append(Expr.assign(assign_target, run_init_call)) catch unreachable;
                            }

                            // Extra initializer
                            suffix_exprs.append(callRt(p, loc, "__runInitializers", &[_]Expr{
                                useRef(p, init_ref, loc),
                                p.newExpr(E.Number{ .value = extraInitFlag(field_idx) }, loc),
                                useRef(p, class_name_ref, class_name_loc),
                            })) catch unreachable;
                        },
                    }
                }
            }

            // 8: Class extra initializers
            if (class_decorators.len > 0) {
                suffix_exprs.append(callRt(p, loc, "__runInitializers", &[_]Expr{
                    useRef(p, init_ref, loc),
                    p.newExpr(E.Number{ .value = 1 }, loc),
                    useRef(p, class_name_ref, class_name_loc),
                })) catch unreachable;
            }

            // 9: __decoratorMetadata
            suffix_exprs.append(callRt(p, loc, "__decoratorMetadata", &[_]Expr{
                useRef(p, init_ref, loc),
                useRef(p, class_name_ref, class_name_loc),
            })) catch unreachable;

            // ── Phase 7: Constructor injection ───────────────
            if (instance_non_field_elements.items.len > 0 or has_instance_private_methods) {
                constructor_inject_stmts.append(p.s(S.SExpr{
                    .value = callRt(p, loc, "__runInitializers", &[_]Expr{
                        useRef(p, init_ref, loc),
                        p.newExpr(E.Number{ .value = 5 }, loc),
                        p.newExpr(E.This{}, loc),
                    }),
                }, loc)) catch unreachable;
            }

            // Instance field/accessor init + extra-init
            {
                var i_accessor_idx: usize = 0;
                var i_field_idx: usize = 0;
                for (instance_init_entries.items) |entry| {
                    const field_idx: usize = if (entry.is_accessor) brk: {
                        const idx = instance_accessor_base_idx + i_accessor_idx;
                        i_accessor_idx += 1;
                        break :brk idx;
                    } else brk: {
                        const idx = instance_field_base_idx + i_field_idx;
                        i_field_idx += 1;
                        break :brk idx;
                    };

                    const run_args_count: usize = if (entry.prop.initializer != null) 4 else 3;
                    const run_args = bun.handleOom(p.allocator.alloc(Expr, run_args_count));
                    run_args[0] = useRef(p, init_ref, loc);
                    run_args[1] = p.newExpr(E.Number{ .value = initFlag(field_idx) }, loc);
                    run_args[2] = p.newExpr(E.This{}, loc);
                    if (entry.prop.initializer) |init_val| run_args[3] = init_val;
                    const run_init_call = p.callRuntime(loc, "__runInitializers", run_args);

                    if (entry.is_accessor or entry.is_private) {
                        const wm_ref_expr = if (entry.is_accessor and !entry.is_private)
                            entry.prop.value.?
                        else
                            entry.prop.key.?;
                        constructor_inject_stmts.append(p.s(S.SExpr{
                            .value = callRt(p, loc, "__privateAdd", &[_]Expr{
                                p.newExpr(E.This{}, loc),
                                wm_ref_expr,
                                run_init_call,
                            }),
                        }, loc)) catch unreachable;
                    } else {
                        constructor_inject_stmts.append(
                            Stmt.assign(memberTarget(p, p.newExpr(E.This{}, loc), entry.prop), run_init_call),
                        ) catch unreachable;
                    }

                    // Extra initializer
                    constructor_inject_stmts.append(p.s(S.SExpr{
                        .value = callRt(p, loc, "__runInitializers", &[_]Expr{
                            useRef(p, init_ref, loc),
                            p.newExpr(E.Number{ .value = extraInitFlag(field_idx) }, loc),
                            p.newExpr(E.This{}, loc),
                        }),
                    }, loc)) catch unreachable;
                }
            }

            // Inject into constructor
            if (constructor_inject_stmts.items.len > 0) {
                var found_constructor = false;
                for (new_properties.items) |*nprop| {
                    if (nprop.flags.contains(.is_method) and nprop.key != null and
                        nprop.key.?.data == .e_string and nprop.key.?.data.e_string.eqlComptime("constructor"))
                    {
                        const func = nprop.value.?.data.e_function;
                        var body_stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, func.func.body.stmts);
                        var super_index: ?usize = null;
                        for (body_stmts.items, 0..) |item, index| {
                            if (item.data != .s_expr) continue;
                            if (item.data.s_expr.value.data != .e_call) continue;
                            if (item.data.s_expr.value.data.e_call.target.data != .e_super) continue;
                            super_index = index;
                            break;
                        }
                        const insert_at = if (super_index) |j| j + 1 else 0;
                        body_stmts.insertSlice(insert_at, constructor_inject_stmts.items) catch unreachable;
                        func.func.body.stmts = body_stmts.items;
                        found_constructor = true;
                        break;
                    }
                }

                if (!found_constructor) {
                    var ctor_stmts = ListManaged(Stmt).init(p.allocator);
                    if (class.extends != null) {
                        const target = p.newExpr(E.Super{}, loc);
                        const args_ref = newSym(p, .unbound, arguments_str);
                        const spread = p.newExpr(E.Spread{ .value = p.newExpr(E.Identifier{ .ref = args_ref }, loc) }, loc);
                        const call_args = bun.handleOom(ExprNodeList.initOne(p.allocator, spread));
                        ctor_stmts.append(
                            p.s(S.SExpr{ .value = p.newExpr(E.Call{ .target = target, .args = call_args }, loc) }, loc),
                        ) catch unreachable;
                    }
                    ctor_stmts.appendSlice(constructor_inject_stmts.items) catch unreachable;
                    new_properties.insert(0, G.Property{
                        .flags = Flags.Property.init(.{ .is_method = true }),
                        .key = p.newExpr(E.String{ .data = "constructor" }, loc),
                        .value = p.newExpr(E.Function{ .func = G.Fn{
                            .name = null,
                            .open_parens_loc = logger.Loc.Empty,
                            .args = &[_]Arg{},
                            .body = .{ .loc = loc, .stmts = ctor_stmts.items },
                            .flags = Flags.Function.init(.{}),
                        } }, loc),
                    }) catch unreachable;
                }
            }

            // Static private __privateAdd blocks at beginning
            if (static_private_add_blocks.items.len > 0) {
                new_properties.insertSlice(0, static_private_add_blocks.items) catch unreachable;
            }

            class.properties = new_properties.items;
            class.has_decorators = false;
            class.should_lower_standard_decorators = false;

            // ── Phase 8: Assemble output ─────────────────────
            if (is_expr) {
                var comma_parts = ListManaged(Expr).init(p.allocator);
                if (class_dec_assign_expr) |cda| comma_parts.append(cda) catch unreachable;
                if (base_assign_expr) |ba| comma_parts.append(ba) catch unreachable;

                // Convert S.Local decls to comma assignments
                const appendDeclsAsAssigns = struct {
                    fn f(parts: *ListManaged(Expr), var_decls: *ListManaged(G.Decl), stmts_list: []const Stmt, parser: *P, l: logger.Loc) void {
                        for (stmts_list) |pstmt| {
                            if (pstmt.data == .s_expr) {
                                parts.append(pstmt.data.s_expr.value) catch unreachable;
                            } else if (pstmt.data == .s_local) {
                                for (pstmt.data.s_local.decls.slice()) |decl_item| {
                                    const ref = decl_item.binding.data.b_identifier.ref;
                                    var_decls.append(.{ .binding = parser.b(B.Identifier{ .ref = ref }, l) }) catch unreachable;
                                    if (decl_item.value) |val| {
                                        parser.recordUsage(ref);
                                        parts.append(
                                            Expr.assign(parser.newExpr(E.Identifier{ .ref = ref }, l), val),
                                        ) catch unreachable;
                                    }
                                }
                            }
                        }
                    }
                }.f;

                appendDeclsAsAssigns(&comma_parts, &expr_var_decls, pre_eval_stmts.items, p, loc);
                appendDeclsAsAssigns(&comma_parts, &expr_var_decls, prefix_stmts.items, p, loc);

                // _init = __decoratorStart(...)
                comma_parts.append(assignTo(p, init_ref, init_start_expr, loc)) catch unreachable;

                // _class = class { ... }
                comma_parts.append(assignTo(p, expr_class_ref.?, p.newExpr(class.*, loc), loc)) catch unreachable;

                comma_parts.appendSlice(suffix_exprs.items) catch unreachable;

                // Final value
                const final_ref = if (class_decorators.len > 0) class_name_ref else expr_class_ref.?;
                comma_parts.append(useRef(p, final_ref, loc)) catch unreachable;

                // Build comma chain
                var result = comma_parts.items[0];
                for (comma_parts.items[1..]) |part| {
                    result = p.newExpr(E.Binary{
                        .op = .bin_comma,
                        .left = result,
                        .right = part,
                    }, loc);
                }

                // Emit var declarations
                if (expr_var_decls.items.len > 0) {
                    const var_decl_stmt = p.s(S.Local{
                        .decls = Decl.List.fromOwnedSlice(expr_var_decls.items),
                    }, loc);
                    if (p.nearest_stmt_list) |stmt_list| {
                        stmt_list.append(var_decl_stmt) catch unreachable;
                    }
                }

                var out = ListManaged(Stmt).initCapacity(p.allocator, 1) catch unreachable;
                out.appendAssumeCapacity(p.s(S.SExpr{ .value = result }, loc));
                return out.items;
            }

            // Statement mode
            var out = ListManaged(Stmt).initCapacity(p.allocator, prefix_stmts.items.len + pre_eval_stmts.items.len + 5 + suffix_exprs.items.len) catch unreachable;
            if (class_dec_stmt.data != .s_empty) out.append(class_dec_stmt) catch unreachable;
            if (base_decl_stmt.data != .s_empty) out.append(base_decl_stmt) catch unreachable;
            out.appendSlice(pre_eval_stmts.items) catch unreachable;
            out.appendSlice(prefix_stmts.items) catch unreachable;
            out.appendAssumeCapacity(init_decl_stmt);
            out.appendAssumeCapacity(stmt);
            for (suffix_exprs.items) |expr| {
                out.append(p.s(S.SExpr{ .value = expr }, expr.loc)) catch unreachable;
            }
            // Inner class binding: let _Foo = Foo
            if (!inner_class_ref.eql(class_name_ref)) {
                p.recordUsage(class_name_ref);
                const inner_decls = bun.handleOom(p.allocator.alloc(G.Decl, 1));
                inner_decls[0] = .{
                    .binding = p.b(B.Identifier{ .ref = inner_class_ref }, loc),
                    .value = p.newExpr(E.Identifier{ .ref = class_name_ref }, class_name_loc),
                };
                out.append(p.s(S.Local{
                    .kind = .k_let,
                    .decls = Decl.List.fromOwnedSlice(inner_decls),
                }, loc)) catch unreachable;
            }

            return out.items;
        }
    };
}

const std = @import("std");
const ListManaged = std.array_list.Managed;

const bun = @import("bun");
const logger = bun.logger;

const js_ast = bun.ast;
const B = js_ast.B;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeList = js_ast.ExprNodeList;
const Flags = js_ast.Flags;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Arg = G.Arg;
const Decl = G.Decl;
const Property = G.Property;

const js_parser = bun.js_parser;
const JSXTransformType = js_parser.JSXTransformType;
const Ref = js_parser.Ref;
const arguments_str = js_parser.arguments_str;
