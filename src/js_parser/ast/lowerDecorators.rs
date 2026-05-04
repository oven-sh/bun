//! Lowering for TC39 standard ES decorators.
//! Extracted from P.zig to reduce duplication via shared helpers.

use bun_collections::HashMap;
use bun_logger as logger;

use bun_js_parser::ast::{self as js_ast, B, E, Expr, ExprNodeList, Flags, G, S, Stmt, Symbol};
use bun_js_parser::ast::g::{Arg, Decl, Property};
use bun_js_parser::{self as js_parser, JSXTransformType, Ref, ARGUMENTS_STR as arguments_str};

// TODO(port): `P` is the monomorphized parser type `NewParser_<TS, JSX, SCAN_ONLY>`.
// In Phase A we model the const-param plumbing on the impl block; Phase B may
// need to thread these generics differently once `NewParser_` is ported.
type P<const TS: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool> =
    js_parser::NewParser_<TS, JSX, SCAN_ONLY>;

// ── Types ────────────────────────────────────────────

#[derive(Clone, Copy)]
struct PrivateLoweredInfo {
    storage_ref: Ref,
    method_fn_ref: Option<Ref>,
    getter_fn_ref: Option<Ref>,
    setter_fn_ref: Option<Ref>,
    accessor_desc_ref: Option<Ref>,
}

impl PrivateLoweredInfo {
    fn new(storage_ref: Ref) -> Self {
        Self {
            storage_ref,
            method_fn_ref: None,
            getter_fn_ref: None,
            setter_fn_ref: None,
            accessor_desc_ref: None,
        }
    }
}

type PrivateLoweredMap = HashMap<u32, PrivateLoweredInfo>;

enum StdDecMode<'a> {
    Stmt,
    Expr {
        class: &'a mut G::Class,
        loc: logger::Loc,
        name_from_context: Option<&'a [u8]>,
    },
}

struct FieldInitEntry {
    prop: Property,
    is_private: bool,
    is_accessor: bool,
}

#[derive(Clone, Copy)]
enum StaticElementKind {
    Block,
    FieldOrAccessor,
}

#[derive(Clone, Copy)]
struct StaticElement {
    kind: StaticElementKind,
    index: usize,
}

// ── Generic tree rewriter kinds ──────────────────────

#[derive(Clone, Copy)]
enum RewriteKind {
    ReplaceRef { old: Ref, new: Ref },
    ReplaceThis { r#ref: Ref, loc: logger::Loc },
}

/// Zig: `fn LowerDecorators(comptime ts, comptime jsx, comptime scan_only) type { return struct {...} }`
pub struct LowerDecorators<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

impl<
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > LowerDecorators<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    // ── Expression builder helpers ───────────────────────

    /// recordUsage + E.Identifier in one call.
    #[inline]
    fn use_ref(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        r#ref: Ref,
        l: logger::Loc,
    ) -> Expr {
        p.record_usage(r#ref);
        p.new_expr(E::Identifier { r#ref }, l)
    }

    /// Allocate args + callRuntime in one call.
    fn call_rt(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        l: logger::Loc,
        name: &'static [u8],
        args: &[Expr],
    ) -> Expr {
        // PERF(port): was arena alloc + @memcpy — Phase B: use bump.alloc_slice_copy
        let a = p.alloc().alloc_slice_copy(args);
        p.call_runtime(l, name, a)
    }

    /// newSymbol + scope.generated.append in one call.
    fn new_sym(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        kind: Symbol::Kind,
        name: &[u8],
    ) -> Ref {
        let r#ref = p.new_symbol(kind, name).expect("unreachable");
        p.current_scope.generated.push(r#ref);
        r#ref
    }

    /// Single var declaration statement.
    fn var_decl(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        r#ref: Ref,
        value: Option<Expr>,
        l: logger::Loc,
    ) -> Stmt {
        let decls = p.alloc().alloc_slice_fill_with(1, |_| G::Decl {
            binding: p.b(B::Identifier { r#ref }, l),
            value,
        });
        p.s(S::Local { decls: Decl::List::from_owned_slice(decls), ..Default::default() }, l)
    }

    /// Two-variable declaration statement.
    fn var_decl2(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        r1: Ref,
        v1: Option<Expr>,
        r2: Ref,
        v2: Option<Expr>,
        l: logger::Loc,
    ) -> Stmt {
        // TODO(port): bumpalo slice init — Phase B may need a different ctor
        let mut decls = bumpalo::vec![in p.alloc();
            G::Decl { binding: p.b(B::Identifier { r#ref: r1 }, l), value: v1 },
            G::Decl { binding: p.b(B::Identifier { r#ref: r2 }, l), value: v2 },
        ];
        p.s(
            S::Local { decls: Decl::List::from_owned_slice(decls.into_bump_slice()), ..Default::default() },
            l,
        )
    }

    /// recordUsage + Expr.assign.
    fn assign_to(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        r#ref: Ref,
        value: Expr,
        l: logger::Loc,
    ) -> Expr {
        p.record_usage(r#ref);
        Expr::assign(p.new_expr(E::Identifier { r#ref }, l), value)
    }

    /// new WeakMap() expression.
    fn new_weak_map_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        l: logger::Loc,
    ) -> Expr {
        let r#ref = p.find_symbol(l, b"WeakMap").expect("unreachable").r#ref;
        p.new_expr(
            E::New {
                target: p.new_expr(E::Identifier { r#ref }, l),
                args: ExprNodeList::empty(),
                close_parens_loc: l,
            },
            l,
        )
    }

    /// new WeakSet() expression.
    fn new_weak_set_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        l: logger::Loc,
    ) -> Expr {
        let r#ref = p.find_symbol(l, b"WeakSet").expect("unreachable").r#ref;
        p.new_expr(
            E::New {
                target: p.new_expr(E::Identifier { r#ref }, l),
                args: ExprNodeList::empty(),
                close_parens_loc: l,
            },
            l,
        )
    }

    /// Create a static block property from a single expression.
    fn make_static_block(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: Expr,
        l: logger::Loc,
    ) -> Property {
        let stmts = p.alloc().alloc_slice_fill_with(1, |_| p.s(S::SExpr { value: expr, ..Default::default() }, l));
        let sb = p.alloc().alloc(G::ClassStaticBlock {
            loc: l,
            stmts: bun_collections::BabyList::<Stmt>::from_owned_slice(stmts),
        });
        Property { kind: Property::Kind::ClassStaticBlock, class_static_block: Some(sb), ..Default::default() }
    }

    /// Build property access: target.name or target[key].
    fn member_target(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        target_expr: Expr,
        prop: &Property,
    ) -> Expr {
        let key_expr = prop.key.unwrap();
        if prop.flags.contains(Flags::Property::IsComputed) || matches!(key_expr.data, js_ast::ExprData::ENumber(_)) {
            p.new_expr(E::Index { target: target_expr, index: key_expr }, key_expr.loc)
        } else if let js_ast::ExprData::EString(s) = &key_expr.data {
            p.new_expr(
                E::Dot { target: target_expr, name: s.data, name_loc: key_expr.loc },
                key_expr.loc,
            )
        } else {
            p.new_expr(E::Index { target: target_expr, index: key_expr }, key_expr.loc)
        }
    }

    fn init_flag(idx: usize) -> f64 {
        ((4 + 2 * idx) << 1) as f64
    }

    fn extra_init_flag(idx: usize) -> f64 {
        (((5 + 2 * idx) << 1) | 1) as f64
    }

    /// Emit __privateAdd for a given storage ref. Appends to constructor or static blocks.
    fn emit_private_add(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        is_static: bool,
        storage_ref: Ref,
        value: Option<Expr>,
        loc: logger::Loc,
        constructor_inject: &mut bumpalo::collections::Vec<'_, Stmt>,
        static_blocks: &mut bumpalo::collections::Vec<'_, Property>,
    ) {
        let target = p.new_expr(E::This {}, loc);
        if let Some(v) = value {
            let call = Self::call_rt(p, loc, b"__privateAdd", &[target, Self::use_ref(p, storage_ref, loc), v]);
            if is_static {
                static_blocks.push(Self::make_static_block(p, call, loc));
            } else {
                constructor_inject.push(p.s(S::SExpr { value: call, ..Default::default() }, loc));
            }
        } else {
            let call = Self::call_rt(p, loc, b"__privateAdd", &[target, Self::use_ref(p, storage_ref, loc)]);
            if is_static {
                static_blocks.push(Self::make_static_block(p, call, loc));
            } else {
                constructor_inject.push(p.s(S::SExpr { value: call, ..Default::default() }, loc));
            }
        }
    }

    /// Get the method kind code (1=method, 2=getter, 3=setter).
    fn method_kind(prop: &Property) -> u8 {
        match prop.kind {
            Property::Kind::Get => 2,
            Property::Kind::Set => 3,
            _ => 1,
        }
    }

    /// Get fn variable suffix for a given kind code.
    fn fn_suffix(k: u8) -> &'static [u8] {
        if k == 2 { b"_get" } else if k == 3 { b"_set" } else { b"_fn" }
    }

    // ── Generic tree rewriter ────────────────────────────

    fn rewrite_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: &mut Expr,
        kind: RewriteKind,
    ) {
        match kind {
            RewriteKind::ReplaceRef { old, new } => {
                if let js_ast::ExprData::EIdentifier(id) = &expr.data {
                    if id.r#ref.eql(old) {
                        p.record_usage(new);
                        expr.data = js_ast::ExprData::EIdentifier(E::Identifier { r#ref: new });
                        return;
                    }
                }
            }
            RewriteKind::ReplaceThis { r#ref, loc } => {
                if matches!(expr.data, js_ast::ExprData::EThis(_)) {
                    *expr = Self::use_ref(p, r#ref, loc);
                    return;
                }
            }
        }
        match &mut expr.data {
            js_ast::ExprData::EBinary(e) => {
                Self::rewrite_expr(p, &mut e.left, kind);
                Self::rewrite_expr(p, &mut e.right, kind);
            }
            js_ast::ExprData::ECall(e) => {
                Self::rewrite_expr(p, &mut e.target, kind);
                for a in e.args.slice_mut() {
                    Self::rewrite_expr(p, a, kind);
                }
            }
            js_ast::ExprData::ENew(e) => {
                Self::rewrite_expr(p, &mut e.target, kind);
                for a in e.args.slice_mut() {
                    Self::rewrite_expr(p, a, kind);
                }
            }
            js_ast::ExprData::EIndex(e) => {
                Self::rewrite_expr(p, &mut e.target, kind);
                Self::rewrite_expr(p, &mut e.index, kind);
            }
            js_ast::ExprData::EDot(e) => Self::rewrite_expr(p, &mut e.target, kind),
            js_ast::ExprData::ESpread(e) => Self::rewrite_expr(p, &mut e.value, kind),
            js_ast::ExprData::EUnary(e) => Self::rewrite_expr(p, &mut e.value, kind),
            js_ast::ExprData::EIf(e) => {
                Self::rewrite_expr(p, &mut e.test_, kind);
                Self::rewrite_expr(p, &mut e.yes, kind);
                Self::rewrite_expr(p, &mut e.no, kind);
            }
            js_ast::ExprData::EArray(e) => {
                for item in e.items.slice_mut() {
                    Self::rewrite_expr(p, item, kind);
                }
            }
            js_ast::ExprData::EObject(e) => {
                for prop in e.properties.slice_mut() {
                    if let Some(v) = &mut prop.value {
                        Self::rewrite_expr(p, v, kind);
                    }
                    if let Some(ini) = &mut prop.initializer {
                        Self::rewrite_expr(p, ini, kind);
                    }
                }
            }
            js_ast::ExprData::ETemplate(e) => {
                if let Some(t) = &mut e.tag {
                    Self::rewrite_expr(p, t, kind);
                }
                for part in e.parts.iter_mut() {
                    Self::rewrite_expr(p, &mut part.value, kind);
                }
            }
            js_ast::ExprData::EArrow(e) => Self::rewrite_stmts(p, &mut e.body.stmts, kind),
            js_ast::ExprData::EFunction(e) => match kind {
                RewriteKind::ReplaceThis { .. } => {}
                RewriteKind::ReplaceRef { .. } => {
                    if !e.func.body.stmts.is_empty() {
                        Self::rewrite_stmts(p, &mut e.func.body.stmts, kind);
                    }
                }
            },
            js_ast::ExprData::EClass(_) => {}
            _ => {}
        }
    }

    fn rewrite_stmts(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut [Stmt],
        kind: RewriteKind,
    ) {
        for cur_stmt in stmts.iter_mut() {
            // PORT NOTE: reshaped for borrowck — capture loc before mutating data
            let cur_loc = cur_stmt.loc;
            match &mut cur_stmt.data {
                js_ast::StmtData::SExpr(sexpr) => {
                    let mut val = sexpr.value;
                    Self::rewrite_expr(p, &mut val, kind);
                    *cur_stmt = p.s(
                        S::SExpr {
                            value: val,
                            does_not_affect_tree_shaking: sexpr.does_not_affect_tree_shaking,
                        },
                        cur_loc,
                    );
                }
                js_ast::StmtData::SLocal(local) => {
                    for decl in local.decls.slice_mut() {
                        if let Some(v) = &mut decl.value {
                            Self::rewrite_expr(p, v, kind);
                        }
                    }
                }
                js_ast::StmtData::SReturn(ret) => {
                    if let Some(v) = &mut ret.value {
                        Self::rewrite_expr(p, v, kind);
                    }
                }
                js_ast::StmtData::SThrow(data) => Self::rewrite_expr(p, &mut data.value, kind),
                js_ast::StmtData::SIf(data) => {
                    Self::rewrite_expr(p, &mut data.test_, kind);
                    Self::rewrite_stmts(p, core::slice::from_mut(&mut data.yes), kind);
                    if let Some(no) = &mut data.no {
                        Self::rewrite_stmts(p, core::slice::from_mut(no), kind);
                    }
                }
                js_ast::StmtData::SBlock(data) => Self::rewrite_stmts(p, &mut data.stmts, kind),
                js_ast::StmtData::SFor(data) => {
                    if let Some(fi) = &mut data.init {
                        Self::rewrite_stmts(p, core::slice::from_mut(fi), kind);
                    }
                    if let Some(t) = &mut data.test_ {
                        Self::rewrite_expr(p, t, kind);
                    }
                    if let Some(u) = &mut data.update {
                        Self::rewrite_expr(p, u, kind);
                    }
                    Self::rewrite_stmts(p, core::slice::from_mut(&mut data.body), kind);
                }
                js_ast::StmtData::SForIn(data) => {
                    Self::rewrite_expr(p, &mut data.value, kind);
                    Self::rewrite_stmts(p, core::slice::from_mut(&mut data.body), kind);
                }
                js_ast::StmtData::SForOf(data) => {
                    Self::rewrite_expr(p, &mut data.value, kind);
                    Self::rewrite_stmts(p, core::slice::from_mut(&mut data.body), kind);
                }
                js_ast::StmtData::SWhile(data) => {
                    Self::rewrite_expr(p, &mut data.test_, kind);
                    Self::rewrite_stmts(p, core::slice::from_mut(&mut data.body), kind);
                }
                js_ast::StmtData::SDoWhile(data) => {
                    Self::rewrite_expr(p, &mut data.test_, kind);
                    Self::rewrite_stmts(p, core::slice::from_mut(&mut data.body), kind);
                }
                js_ast::StmtData::SSwitch(data) => {
                    Self::rewrite_expr(p, &mut data.test_, kind);
                    for case in data.cases.iter_mut() {
                        if let Some(v) = &mut case.value {
                            Self::rewrite_expr(p, v, kind);
                        }
                        Self::rewrite_stmts(p, &mut case.body, kind);
                    }
                }
                js_ast::StmtData::STry(data) => {
                    Self::rewrite_stmts(p, &mut data.body, kind);
                    if let Some(c) = &mut data.catch_ {
                        Self::rewrite_stmts(p, &mut c.body, kind);
                    }
                    if let Some(f) = &mut data.finally {
                        Self::rewrite_stmts(p, &mut f.stmts, kind);
                    }
                }
                js_ast::StmtData::SLabel(data) => {
                    Self::rewrite_stmts(p, core::slice::from_mut(&mut data.stmt), kind)
                }
                js_ast::StmtData::SWith(data) => {
                    Self::rewrite_expr(p, &mut data.value, kind);
                    Self::rewrite_stmts(p, core::slice::from_mut(&mut data.body), kind);
                }
                _ => {}
            }
        }
    }

    // ── Private access rewriting ─────────────────────────

    fn private_get_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        obj: Expr,
        info: PrivateLoweredInfo,
        l: logger::Loc,
    ) -> Expr {
        if let Some(desc_ref) = info.accessor_desc_ref {
            Self::call_rt(p, l, b"__privateGet", &[
                obj,
                Self::use_ref(p, info.storage_ref, l),
                p.new_expr(E::Dot { target: Self::use_ref(p, desc_ref, l), name: b"get", name_loc: l }, l),
            ])
        } else if let Some(fn_ref) = info.getter_fn_ref {
            Self::call_rt(p, l, b"__privateGet", &[obj, Self::use_ref(p, info.storage_ref, l), Self::use_ref(p, fn_ref, l)])
        } else if let Some(fn_ref) = info.method_fn_ref {
            Self::call_rt(p, l, b"__privateMethod", &[obj, Self::use_ref(p, info.storage_ref, l), Self::use_ref(p, fn_ref, l)])
        } else {
            Self::call_rt(p, l, b"__privateGet", &[obj, Self::use_ref(p, info.storage_ref, l)])
        }
    }

    fn private_set_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        obj: Expr,
        info: PrivateLoweredInfo,
        val: Expr,
        l: logger::Loc,
    ) -> Expr {
        if let Some(desc_ref) = info.accessor_desc_ref {
            Self::call_rt(p, l, b"__privateSet", &[
                obj,
                Self::use_ref(p, info.storage_ref, l),
                val,
                p.new_expr(E::Dot { target: Self::use_ref(p, desc_ref, l), name: b"set", name_loc: l }, l),
            ])
        } else if let Some(fn_ref) = info.setter_fn_ref {
            Self::call_rt(p, l, b"__privateSet", &[obj, Self::use_ref(p, info.storage_ref, l), val, Self::use_ref(p, fn_ref, l)])
        } else {
            Self::call_rt(p, l, b"__privateSet", &[obj, Self::use_ref(p, info.storage_ref, l), val])
        }
    }

    fn rewrite_private_accesses_in_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        expr: &mut Expr,
        map: &PrivateLoweredMap,
    ) {
        // PORT NOTE: reshaped for borrowck — capture loc before mutably borrowing data
        let expr_loc = expr.loc;
        match &mut expr.data {
            js_ast::ExprData::EIndex(e) => {
                Self::rewrite_private_accesses_in_expr(p, &mut e.target, map);
                if let js_ast::ExprData::EPrivateIdentifier(pi) = &e.index.data {
                    if let Some(info) = map.get(&pi.r#ref.inner_index()) {
                        let target = e.target;
                        *expr = Self::private_get_expr(p, target, *info, expr_loc);
                        return;
                    }
                }
                Self::rewrite_private_accesses_in_expr(p, &mut e.index, map);
            }
            js_ast::ExprData::EBinary(e) => {
                if e.op == js_ast::Op::BinAssign {
                    if let js_ast::ExprData::EIndex(left_idx) = &mut e.left.data {
                        if let js_ast::ExprData::EPrivateIdentifier(pi) = &left_idx.index.data {
                            if let Some(info) = map.get(&pi.r#ref.inner_index()).copied() {
                                Self::rewrite_private_accesses_in_expr(p, &mut left_idx.target, map);
                                Self::rewrite_private_accesses_in_expr(p, &mut e.right, map);
                                let target = left_idx.target;
                                let right = e.right;
                                *expr = Self::private_set_expr(p, target, info, right, expr_loc);
                                return;
                            }
                        }
                    }
                }
                if e.op == js_ast::Op::BinIn {
                    if let js_ast::ExprData::EPrivateIdentifier(pi) = &e.left.data {
                        if let Some(info) = map.get(&pi.r#ref.inner_index()).copied() {
                            Self::rewrite_private_accesses_in_expr(p, &mut e.right, map);
                            let right = e.right;
                            *expr = Self::call_rt(p, expr_loc, b"__privateIn", &[
                                Self::use_ref(p, info.storage_ref, expr_loc),
                                right,
                            ]);
                            return;
                        }
                    }
                }
                Self::rewrite_private_accesses_in_expr(p, &mut e.left, map);
                Self::rewrite_private_accesses_in_expr(p, &mut e.right, map);
            }
            js_ast::ExprData::ECall(e) => {
                if let js_ast::ExprData::EIndex(tgt_idx) = &mut e.target.data {
                    if let js_ast::ExprData::EPrivateIdentifier(pi) = &tgt_idx.index.data {
                        if let Some(info) = map.get(&pi.r#ref.inner_index()).copied() {
                            Self::rewrite_private_accesses_in_expr(p, &mut tgt_idx.target, map);
                            let obj_expr = tgt_idx.target;
                            let private_access = Self::private_get_expr(p, obj_expr, info, expr_loc);
                            let call_target = p.new_expr(
                                E::Dot { target: private_access, name: b"call", name_loc: expr_loc },
                                expr_loc,
                            );
                            let orig_args = e.args.slice_mut();
                            // PERF(port): was arena alloc — Phase B: bump.alloc_slice
                            let mut new_args = bumpalo::collections::Vec::with_capacity_in(1 + orig_args.len(), p.alloc());
                            new_args.push(obj_expr);
                            for arg in orig_args.iter_mut() {
                                Self::rewrite_private_accesses_in_expr(p, arg, map);
                                new_args.push(*arg);
                            }
                            e.target = call_target;
                            e.args = ExprNodeList::from_owned_slice(new_args.into_bump_slice());
                            return;
                        }
                    }
                }
                Self::rewrite_private_accesses_in_expr(p, &mut e.target, map);
                for arg in e.args.slice_mut() {
                    Self::rewrite_private_accesses_in_expr(p, arg, map);
                }
            }
            js_ast::ExprData::EUnary(e) => Self::rewrite_private_accesses_in_expr(p, &mut e.value, map),
            js_ast::ExprData::EDot(e) => Self::rewrite_private_accesses_in_expr(p, &mut e.target, map),
            js_ast::ExprData::ESpread(e) => Self::rewrite_private_accesses_in_expr(p, &mut e.value, map),
            js_ast::ExprData::EIf(e) => {
                Self::rewrite_private_accesses_in_expr(p, &mut e.test_, map);
                Self::rewrite_private_accesses_in_expr(p, &mut e.yes, map);
                Self::rewrite_private_accesses_in_expr(p, &mut e.no, map);
            }
            js_ast::ExprData::EAwait(e) => Self::rewrite_private_accesses_in_expr(p, &mut e.value, map),
            js_ast::ExprData::EYield(e) => {
                if let Some(v) = &mut e.value {
                    Self::rewrite_private_accesses_in_expr(p, v, map);
                }
            }
            js_ast::ExprData::ENew(e) => {
                Self::rewrite_private_accesses_in_expr(p, &mut e.target, map);
                for arg in e.args.slice_mut() {
                    Self::rewrite_private_accesses_in_expr(p, arg, map);
                }
            }
            js_ast::ExprData::EArray(e) => {
                for item in e.items.slice_mut() {
                    Self::rewrite_private_accesses_in_expr(p, item, map);
                }
            }
            js_ast::ExprData::EObject(e) => {
                for prop in e.properties.slice_mut() {
                    if let Some(v) = &mut prop.value {
                        Self::rewrite_private_accesses_in_expr(p, v, map);
                    }
                    if let Some(ini) = &mut prop.initializer {
                        Self::rewrite_private_accesses_in_expr(p, ini, map);
                    }
                }
            }
            js_ast::ExprData::ETemplate(e) => {
                if let Some(t) = &mut e.tag {
                    Self::rewrite_private_accesses_in_expr(p, t, map);
                }
                for part in e.parts.iter_mut() {
                    Self::rewrite_private_accesses_in_expr(p, &mut part.value, map);
                }
            }
            js_ast::ExprData::EFunction(e) => {
                Self::rewrite_private_accesses_in_stmts(p, &mut e.func.body.stmts, map)
            }
            js_ast::ExprData::EArrow(e) => {
                Self::rewrite_private_accesses_in_stmts(p, &mut e.body.stmts, map)
            }
            _ => {}
        }
    }

    fn rewrite_private_accesses_in_stmts(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut [Stmt],
        map: &PrivateLoweredMap,
    ) {
        for stmt_item in stmts.iter_mut() {
            match &mut stmt_item.data {
                js_ast::StmtData::SExpr(data) => Self::rewrite_private_accesses_in_expr(p, &mut data.value, map),
                js_ast::StmtData::SReturn(data) => {
                    if let Some(v) = &mut data.value {
                        Self::rewrite_private_accesses_in_expr(p, v, map);
                    }
                }
                js_ast::StmtData::SThrow(data) => Self::rewrite_private_accesses_in_expr(p, &mut data.value, map),
                js_ast::StmtData::SLocal(data) => {
                    for decl in data.decls.slice_mut() {
                        if let Some(v) = &mut decl.value {
                            Self::rewrite_private_accesses_in_expr(p, v, map);
                        }
                    }
                }
                js_ast::StmtData::SIf(data) => {
                    Self::rewrite_private_accesses_in_expr(p, &mut data.test_, map);
                    Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(&mut data.yes), map);
                    if let Some(no) = &mut data.no {
                        Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(no), map);
                    }
                }
                js_ast::StmtData::SBlock(data) => Self::rewrite_private_accesses_in_stmts(p, &mut data.stmts, map),
                js_ast::StmtData::SFor(data) => {
                    if let Some(fi) = &mut data.init {
                        Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(fi), map);
                    }
                    if let Some(t) = &mut data.test_ {
                        Self::rewrite_private_accesses_in_expr(p, t, map);
                    }
                    if let Some(u) = &mut data.update {
                        Self::rewrite_private_accesses_in_expr(p, u, map);
                    }
                    Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(&mut data.body), map);
                }
                js_ast::StmtData::SForIn(data) => {
                    Self::rewrite_private_accesses_in_expr(p, &mut data.value, map);
                    Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(&mut data.body), map);
                }
                js_ast::StmtData::SForOf(data) => {
                    Self::rewrite_private_accesses_in_expr(p, &mut data.value, map);
                    Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(&mut data.body), map);
                }
                js_ast::StmtData::SWhile(data) => {
                    Self::rewrite_private_accesses_in_expr(p, &mut data.test_, map);
                    Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(&mut data.body), map);
                }
                js_ast::StmtData::SDoWhile(data) => {
                    Self::rewrite_private_accesses_in_expr(p, &mut data.test_, map);
                    Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(&mut data.body), map);
                }
                js_ast::StmtData::SSwitch(data) => {
                    Self::rewrite_private_accesses_in_expr(p, &mut data.test_, map);
                    for case in data.cases.iter_mut() {
                        if let Some(v) = &mut case.value {
                            Self::rewrite_private_accesses_in_expr(p, v, map);
                        }
                        Self::rewrite_private_accesses_in_stmts(p, &mut case.body, map);
                    }
                }
                js_ast::StmtData::STry(data) => {
                    Self::rewrite_private_accesses_in_stmts(p, &mut data.body, map);
                    if let Some(c) = &mut data.catch_ {
                        Self::rewrite_private_accesses_in_stmts(p, &mut c.body, map);
                    }
                    if let Some(f) = &mut data.finally {
                        Self::rewrite_private_accesses_in_stmts(p, &mut f.stmts, map);
                    }
                }
                js_ast::StmtData::SLabel(data) => {
                    Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(&mut data.stmt), map)
                }
                js_ast::StmtData::SWith(data) => {
                    Self::rewrite_private_accesses_in_expr(p, &mut data.value, map);
                    Self::rewrite_private_accesses_in_stmts(p, core::slice::from_mut(&mut data.body), map);
                }
                _ => {}
            }
        }
    }

    // ── Public API ───────────────────────────────────────

    pub fn lower_standard_decorators_stmt(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmt: Stmt,
    ) -> &mut [Stmt] {
        Self::lower_impl(p, stmt, StdDecMode::Stmt)
    }

    pub fn lower_standard_decorators_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        class: &mut G::Class,
        l: logger::Loc,
        name_from_context: Option<&[u8]>,
    ) -> Expr {
        let result = Self::lower_impl(
            p,
            Stmt::empty(),
            StdDecMode::Expr { class, loc: l, name_from_context },
        );
        if result.is_empty() {
            return p.new_expr(E::Missing {}, l);
        }
        // TODO(port): assumes result[0].data is SExpr — matches Zig's invariant
        match &result[0].data {
            js_ast::StmtData::SExpr(s) => s.value,
            _ => unreachable!(),
        }
    }

    // ── Core lowering ────────────────────────────────────

    fn lower_impl<'a>(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        mut stmt: Stmt,
        mode: StdDecMode<'a>,
    ) -> &'a mut [Stmt] {
        // TODO(port): return type lifetime — Zig returns arena-owned []Stmt; Phase B
        // should pin this to the parser's bump lifetime.
        let is_expr = matches!(mode, StdDecMode::Expr { .. });
        // PORT NOTE: reshaped for borrowck — extract all fields from `mode` once.
        let (class, loc, name_from_context): (&mut G::Class, logger::Loc, Option<&[u8]>) = match mode {
            StdDecMode::Stmt => {
                // SAFETY: in stmt mode the input `stmt` is `S.Class` and outlives this fn
                // TODO(port): borrowck — Zig took `&stmt.data.s_class.class` from a value param
                let s_class = match &mut stmt.data {
                    js_ast::StmtData::SClass(c) => c,
                    _ => unreachable!(),
                };
                (&mut s_class.class, stmt.loc, None)
            }
            StdDecMode::Expr { class, loc, name_from_context } => (class, loc, name_from_context),
        };

        // ── Phase 1: Setup ───────────────────────────────
        let mut class_name_ref: Ref;
        let mut class_name_loc: logger::Loc;
        let mut expr_class_ref: Option<Ref> = None;
        let mut expr_class_is_anonymous = false;
        let mut expr_var_decls = bumpalo::collections::Vec::<G::Decl>::new_in(p.alloc());

        if is_expr {
            expr_class_ref = Some(Self::new_sym(p, Symbol::Kind::Other, b"_class"));
            expr_var_decls.push(G::Decl {
                binding: p.b(B::Identifier { r#ref: expr_class_ref.unwrap() }, loc),
                value: None,
            });
            if let Some(cn) = &class.class_name {
                class_name_ref = cn.r#ref.unwrap();
                class_name_loc = cn.loc;
            } else {
                class_name_ref = expr_class_ref.unwrap();
                class_name_loc = loc;
                expr_class_is_anonymous = true;
                if let Some(name) = name_from_context {
                    class.class_name = Some(js_ast::LocRef {
                        r#ref: Some(Self::new_sym(p, Symbol::Kind::Other, name)),
                        loc,
                    });
                }
            }
        } else {
            class_name_ref = class.class_name.as_ref().unwrap().r#ref.unwrap();
            class_name_loc = class.class_name.as_ref().unwrap().loc;
        }

        let mut inner_class_ref: Ref = class_name_ref;
        if !is_expr {
            let cns = p.symbols.items[class_name_ref.inner_index() as usize].original_name;
            let name = {
                let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                v.push(b'_');
                v.extend_from_slice(cns);
                v.into_bump_slice()
            };
            inner_class_ref = Self::new_sym(p, Symbol::Kind::Other, name);
        }

        let class_decorators = core::mem::take(&mut class.ts_decorators);

        let init_ref = Self::new_sym(p, Symbol::Kind::Other, b"_init");
        if is_expr {
            expr_var_decls.push(G::Decl { binding: p.b(B::Identifier { r#ref: init_ref }, loc), value: None });
        }

        let mut base_ref: Option<Ref> = None;
        if class.extends.is_some() {
            let br = Self::new_sym(p, Symbol::Kind::Other, b"_base");
            base_ref = Some(br);
            if is_expr {
                expr_var_decls.push(G::Decl { binding: p.b(B::Identifier { r#ref: br }, loc), value: None });
            }
        }

        // ── Phase 2: Pre-evaluate decorators/keys ────────
        let mut dec_counter: usize = 0;
        let mut class_dec_ref: Option<Ref> = None;
        let mut class_dec_stmt: Stmt = Stmt::empty();
        let mut class_dec_assign_expr: Option<Expr> = None;
        if class_decorators.len() > 0 {
            dec_counter += 1;
            let cdr = Self::new_sym(p, Symbol::Kind::Other, b"_dec");
            class_dec_ref = Some(cdr);
            let arr = p.new_expr(E::Array { items: class_decorators, ..Default::default() }, loc);
            if is_expr {
                expr_var_decls.push(G::Decl { binding: p.b(B::Identifier { r#ref: cdr }, loc), value: None });
                class_dec_assign_expr = Some(Self::assign_to(p, cdr, arr, loc));
            } else {
                class_dec_stmt = Self::var_decl(p, cdr, Some(arr), loc);
            }
        }

        let mut prop_dec_refs: HashMap<usize, Ref> = HashMap::default();
        let mut computed_key_refs: HashMap<usize, Ref> = HashMap::default();
        let mut pre_eval_stmts = bumpalo::collections::Vec::<Stmt>::new_in(p.alloc());
        let mut computed_key_counter: usize = 0;

        for (prop_idx, prop) in class.properties.iter_mut().enumerate() {
            if prop.kind == Property::Kind::ClassStaticBlock {
                continue;
            }
            if prop.ts_decorators.len() > 0 {
                dec_counter += 1;
                let dec_name: &[u8] = if dec_counter == 1 {
                    b"_dec"
                } else {
                    {
                        use std::io::Write as _;
                        let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                        let _ = write!(&mut v, "_dec{}", dec_counter);
                        v.into_bump_slice()
                    }
                };
                let dec_ref = Self::new_sym(p, Symbol::Kind::Other, dec_name);
                prop_dec_refs.insert(prop_idx, dec_ref);
                if is_expr {
                    expr_var_decls.push(G::Decl { binding: p.b(B::Identifier { r#ref: dec_ref }, loc), value: None });
                }
                pre_eval_stmts.push(Self::var_decl(
                    p,
                    dec_ref,
                    Some(p.new_expr(E::Array { items: prop.ts_decorators, ..Default::default() }, loc)),
                    loc,
                ));
            }
            if prop.flags.contains(Flags::Property::IsComputed) && prop.key.is_some() && prop.ts_decorators.len() > 0 {
                computed_key_counter += 1;
                let key_name: &[u8] = if computed_key_counter == 1 {
                    b"_computedKey"
                } else {
                    {
                        use std::io::Write as _;
                        let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                        let _ = write!(&mut v, "_computedKey{}", computed_key_counter);
                        v.into_bump_slice()
                    }
                };
                let key_ref = Self::new_sym(p, Symbol::Kind::Other, key_name);
                computed_key_refs.insert(prop_idx, key_ref);
                if is_expr {
                    expr_var_decls.push(G::Decl { binding: p.b(B::Identifier { r#ref: key_ref }, loc), value: None });
                }
                let key_loc = prop.key.unwrap().loc;
                pre_eval_stmts.push(Self::var_decl(p, key_ref, Some(prop.key.unwrap()), loc));
                prop.key = Some(Self::use_ref(p, key_ref, key_loc));
            }
        }

        // Replace class name refs in pre-eval expressions for inner binding
        {
            let replacement_ref = if is_expr {
                expr_class_ref.unwrap_or(class_name_ref)
            } else {
                inner_class_ref
            };
            if !replacement_ref.eql(class_name_ref) {
                let rk = RewriteKind::ReplaceRef { old: class_name_ref, new: replacement_ref };
                for pre_stmt in pre_eval_stmts.iter_mut() {
                    if let js_ast::StmtData::SLocal(local) = &mut pre_stmt.data {
                        for decl in local.decls.slice_mut() {
                            if let Some(v) = &mut decl.value {
                                Self::rewrite_expr(p, v, rk);
                            }
                        }
                    }
                }
            }
        }

        // For named class expressions: swap to expr_class_ref for suffix ops
        let mut original_class_name_for_decorator: Option<&[u8]> = None;
        if is_expr && !expr_class_is_anonymous && expr_class_ref.is_some() {
            original_class_name_for_decorator =
                Some(p.symbols.items[class_name_ref.inner_index() as usize].original_name);
            class_name_ref = expr_class_ref.unwrap();
            class_name_loc = loc;
        }

        // ── Phase 3: __decoratorStart + base decls ───────
        let init_start_expr: Expr = {
            let base_expr = if let Some(br) = base_ref {
                p.new_expr(E::Identifier { r#ref: br }, loc)
            } else {
                p.new_expr(E::Undefined {}, loc)
            };
            Self::call_rt(p, loc, b"__decoratorStart", &[base_expr])
        };

        let mut base_decl_stmt: Stmt = Stmt::empty();
        if !is_expr {
            if let Some(br) = base_ref {
                base_decl_stmt = Self::var_decl(p, br, class.extends, loc);
            }
        }

        let base_assign_expr: Option<Expr> = if is_expr && base_ref.is_some() {
            Some(Self::assign_to(p, base_ref.unwrap(), class.extends.unwrap(), loc))
        } else {
            None
        };

        if let Some(br) = base_ref {
            class.extends = Some(Self::use_ref(p, br, loc));
        }

        let init_decl_stmt: Stmt = if !is_expr {
            Self::var_decl(p, init_ref, Some(init_start_expr), loc)
        } else {
            Stmt::empty()
        };

        // ── Phase 4: Property loop ───────────────────────
        let mut suffix_exprs = bumpalo::collections::Vec::<Expr>::new_in(p.alloc());
        let mut constructor_inject_stmts = bumpalo::collections::Vec::<Stmt>::new_in(p.alloc());
        let mut new_properties = bumpalo::collections::Vec::<Property>::new_in(p.alloc());
        let mut static_non_field_elements = bumpalo::collections::Vec::<Expr>::new_in(p.alloc());
        let mut instance_non_field_elements = bumpalo::collections::Vec::<Expr>::new_in(p.alloc());
        let mut has_static_private_methods = false;
        let mut has_instance_private_methods = false;
        let mut static_field_decorate = bumpalo::collections::Vec::<Expr>::new_in(p.alloc());
        let mut instance_field_decorate = bumpalo::collections::Vec::<Expr>::new_in(p.alloc());
        let mut static_accessor_count: usize = 0;
        let mut instance_accessor_count: usize = 0;
        let mut static_init_entries = bumpalo::collections::Vec::<FieldInitEntry>::new_in(p.alloc());
        let mut instance_init_entries = bumpalo::collections::Vec::<FieldInitEntry>::new_in(p.alloc());
        let mut static_element_order = bumpalo::collections::Vec::<StaticElement>::new_in(p.alloc());
        let mut extracted_static_blocks = bumpalo::collections::Vec::<&mut G::ClassStaticBlock>::new_in(p.alloc());
        let mut prefix_stmts = bumpalo::collections::Vec::<Stmt>::new_in(p.alloc());
        let mut private_lowered_map: PrivateLoweredMap = PrivateLoweredMap::default();
        let mut accessor_storage_counter: usize = 0;
        let mut emitted_private_adds: HashMap<u32, ()> = HashMap::default();
        let mut static_private_add_blocks = bumpalo::collections::Vec::<Property>::new_in(p.alloc());

        // Pre-scan: determine if all private members need lowering
        let mut lower_all_private = false;
        {
            let mut has_any_private = false;
            let mut has_any_decorated = false;
            for cprop in class.properties.iter() {
                if cprop.kind == Property::Kind::ClassStaticBlock {
                    continue;
                }
                if cprop.ts_decorators.len() > 0 {
                    has_any_decorated = true;
                    if cprop.key.is_some()
                        && matches!(cprop.key.unwrap().data, js_ast::ExprData::EPrivateIdentifier(_))
                    {
                        lower_all_private = true;
                        break;
                    }
                }
                if cprop.key.is_some()
                    && matches!(cprop.key.unwrap().data, js_ast::ExprData::EPrivateIdentifier(_))
                {
                    has_any_private = true;
                }
            }
            if !lower_all_private && has_any_private && has_any_decorated {
                lower_all_private = true;
            }
        }

        for (prop_idx, prop) in class.properties.iter_mut().enumerate() {
            if prop.ts_decorators.len() == 0 {
                // ── Non-decorated property ──
                if lower_all_private
                    && prop.key.is_some()
                    && matches!(prop.key.unwrap().data, js_ast::ExprData::EPrivateIdentifier(_))
                    && prop.kind != Property::Kind::ClassStaticBlock
                    && prop.kind != Property::Kind::AutoAccessor
                {
                    let nk_expr = prop.key.unwrap();
                    let npriv_ref = match &nk_expr.data {
                        js_ast::ExprData::EPrivateIdentifier(pi) => pi.r#ref,
                        _ => unreachable!(),
                    };
                    let npriv_inner = npriv_ref.inner_index();
                    let npriv_orig = p.symbols.items[npriv_inner as usize].original_name;

                    if prop.flags.contains(Flags::Property::IsMethod) {
                        // Non-decorated private method/getter/setter → WeakSet + fn extraction
                        let nk = Self::method_kind(prop);
                        let existing = private_lowered_map.get(&npriv_inner).copied();
                        let ws_ref = if let Some(ex) = existing {
                            ex.storage_ref
                        } else {
                            let nm = {
                                let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                                v.push(b'_');
                                v.extend_from_slice(&npriv_orig[1..]);
                                v.into_bump_slice()
                            };
                            Self::new_sym(p, Symbol::Kind::Other, nm)
                        };
                        let fn_nm = {
                            let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                            v.push(b'_');
                            v.extend_from_slice(&npriv_orig[1..]);
                            v.extend_from_slice(Self::fn_suffix(nk));
                            v.into_bump_slice()
                        };
                        let fn_ref = Self::new_sym(p, Symbol::Kind::Other, fn_nm);

                        let mut new_info = existing.unwrap_or(PrivateLoweredInfo::new(ws_ref));
                        if nk == 1 {
                            new_info.method_fn_ref = Some(fn_ref);
                        } else if nk == 2 {
                            new_info.getter_fn_ref = Some(fn_ref);
                        } else {
                            new_info.setter_fn_ref = Some(fn_ref);
                        }
                        private_lowered_map.insert(npriv_inner, new_info);

                        if existing.is_none() {
                            prefix_stmts.push(Self::var_decl2(p, ws_ref, Some(Self::new_weak_set_expr(p, loc)), fn_ref, None, loc));
                        } else {
                            prefix_stmts.push(Self::var_decl(p, fn_ref, None, loc));
                        }

                        // Assign function: _fn = function() { ... }
                        let val = prop.value.unwrap_or_else(|| p.new_expr(E::Undefined {}, loc));
                        prefix_stmts.push(p.s(
                            S::SExpr { value: Self::assign_to(p, fn_ref, val, loc), ..Default::default() },
                            loc,
                        ));

                        // __privateAdd (once per name)
                        if !emitted_private_adds.contains_key(&npriv_inner) {
                            emitted_private_adds.insert(npriv_inner, ());
                            Self::emit_private_add(
                                p,
                                prop.flags.contains(Flags::Property::IsStatic),
                                ws_ref,
                                None,
                                loc,
                                &mut constructor_inject_stmts,
                                &mut static_private_add_blocks,
                            );
                        }
                        continue;
                    } else {
                        // Non-decorated private field → WeakMap
                        let wm_nm = {
                            let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                            v.push(b'_');
                            v.extend_from_slice(&npriv_orig[1..]);
                            v.into_bump_slice()
                        };
                        let wm_ref = Self::new_sym(p, Symbol::Kind::Other, wm_nm);
                        private_lowered_map.insert(npriv_inner, PrivateLoweredInfo::new(wm_ref));
                        prefix_stmts.push(Self::var_decl(p, wm_ref, Some(Self::new_weak_map_expr(p, loc)), loc));

                        let init_val = prop.initializer.unwrap_or_else(|| p.new_expr(E::Undefined {}, loc));
                        if !prop.flags.contains(Flags::Property::IsStatic) {
                            constructor_inject_stmts.push(p.s(
                                S::SExpr {
                                    value: Self::call_rt(p, loc, b"__privateAdd", &[
                                        p.new_expr(E::This {}, loc),
                                        Self::use_ref(p, wm_ref, loc),
                                        init_val,
                                    ]),
                                    ..Default::default()
                                },
                                loc,
                            ));
                        } else {
                            static_private_add_blocks.push(Self::make_static_block(
                                p,
                                Self::call_rt(p, loc, b"__privateAdd", &[
                                    p.new_expr(E::This {}, loc),
                                    Self::use_ref(p, wm_ref, loc),
                                    init_val,
                                ]),
                                loc,
                            ));
                        }
                        continue;
                    }
                }
                // Undecorated auto-accessor → WeakMap + getter/setter
                if prop.kind == Property::Kind::AutoAccessor {
                    let accessor_name: &[u8] = 'brk: {
                        if let js_ast::ExprData::EString(s) = &prop.key.unwrap().data {
                            let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                            v.push(b'_');
                            v.extend_from_slice(s.data);
                            break 'brk v.into_bump_slice();
                        }
                        let name = {
                            use std::io::Write as _;
                            let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                            let _ = write!(&mut v, "_accessor_storage{}", accessor_storage_counter);
                            v.into_bump_slice()
                        };
                        accessor_storage_counter += 1;
                        name
                    };
                    let wm_ref = Self::new_sym(p, Symbol::Kind::Other, accessor_name);
                    prefix_stmts.push(Self::var_decl(p, wm_ref, Some(Self::new_weak_map_expr(p, loc)), loc));

                    // Getter: get foo() { return __privateGet(this, _foo); }
                    let get_ret = Self::call_rt(p, loc, b"__privateGet", &[
                        p.new_expr(E::This {}, loc),
                        Self::use_ref(p, wm_ref, loc),
                    ]);
                    let get_body = p.alloc().alloc_slice_fill_with(1, |_| p.s(S::Return { value: Some(get_ret) }, loc));
                    let get_fn = p.alloc().alloc(G::Fn { body: G::FnBody { stmts: get_body, loc }, ..Default::default() });

                    // Setter: set foo(v) { __privateSet(this, _foo, v); }
                    let setter_param_ref = Self::new_sym(p, Symbol::Kind::Other, b"v");
                    let set_call = Self::call_rt(p, loc, b"__privateSet", &[
                        p.new_expr(E::This {}, loc),
                        Self::use_ref(p, wm_ref, loc),
                        Self::use_ref(p, setter_param_ref, loc),
                    ]);
                    let set_body = p.alloc().alloc_slice_fill_with(1, |_| p.s(S::SExpr { value: set_call, ..Default::default() }, loc));
                    let setter_fn_args = p.alloc().alloc_slice_fill_with(1, |_| G::Arg {
                        binding: p.b(B::Identifier { r#ref: setter_param_ref }, loc),
                        ..Default::default()
                    });
                    let set_fn = p.alloc().alloc(G::Fn {
                        args: setter_fn_args,
                        body: G::FnBody { stmts: set_body, loc },
                        ..Default::default()
                    });

                    let mut getter_flags = prop.flags;
                    getter_flags.insert(Flags::Property::IsMethod);
                    new_properties.push(Property {
                        key: prop.key,
                        value: Some(p.new_expr(E::Function { func: *get_fn }, loc)),
                        kind: Property::Kind::Get,
                        flags: getter_flags,
                        ..Default::default()
                    });
                    new_properties.push(Property {
                        key: prop.key,
                        value: Some(p.new_expr(E::Function { func: *set_fn }, loc)),
                        kind: Property::Kind::Set,
                        flags: getter_flags,
                        ..Default::default()
                    });

                    let init_val = prop.initializer.unwrap_or_else(|| p.new_expr(E::Undefined {}, loc));
                    if !prop.flags.contains(Flags::Property::IsStatic) {
                        constructor_inject_stmts.push(p.s(
                            S::SExpr {
                                value: Self::call_rt(p, loc, b"__privateAdd", &[
                                    p.new_expr(E::This {}, loc),
                                    Self::use_ref(p, wm_ref, loc),
                                    init_val,
                                ]),
                                ..Default::default()
                            },
                            loc,
                        ));
                    } else {
                        suffix_exprs.push(Self::call_rt(p, loc, b"__privateAdd", &[
                            Self::use_ref(p, class_name_ref, class_name_loc),
                            Self::use_ref(p, wm_ref, loc),
                            init_val,
                        ]));
                    }
                    continue;
                }
                // Static blocks → extract to suffix
                if prop.kind == Property::Kind::ClassStaticBlock {
                    if let Some(sb) = prop.class_static_block {
                        static_element_order.push(StaticElement {
                            kind: StaticElementKind::Block,
                            index: extracted_static_blocks.len(),
                        });
                        extracted_static_blocks.push(sb);
                    }
                    continue;
                }
                new_properties.push(prop.clone());
                continue;
            }

            // ── Decorated property ──
            let mut flags: f64;
            if prop.flags.contains(Flags::Property::IsMethod) {
                flags = match prop.kind {
                    Property::Kind::Get => 2.0,
                    Property::Kind::Set => 3.0,
                    _ => 1.0,
                };
            } else {
                flags = match prop.kind {
                    Property::Kind::AutoAccessor => 4.0,
                    _ => 5.0,
                };
            }
            if prop.flags.contains(Flags::Property::IsStatic) {
                flags += 8.0;
            }
            let is_private = matches!(prop.key.unwrap().data, js_ast::ExprData::EPrivateIdentifier(_));
            if is_private {
                flags += 16.0;
            }

            let decorator_array = if let Some(dec_ref) = prop_dec_refs.get(&prop_idx).copied() {
                Self::use_ref(p, dec_ref, loc)
            } else {
                p.new_expr(E::Array { items: prop.ts_decorators, ..Default::default() }, loc)
            };

            let key_expr = prop.key.unwrap();
            let k = (flags as u8) & 7;

            let mut dec_arg_count: usize = 5;
            let mut private_storage_ref: Option<Ref> = None;
            let mut private_extra_ref: Option<Ref> = None;
            let mut private_method_fn_ref: Option<Ref> = None;

            if is_private {
                let priv_ref = match &key_expr.data {
                    js_ast::ExprData::EPrivateIdentifier(pi) => pi.r#ref,
                    _ => unreachable!(),
                };
                let priv_inner = priv_ref.inner_index();
                let private_orig = p.symbols.items[priv_inner as usize].original_name;

                if k >= 1 && k <= 3 {
                    // Decorated private method/getter/setter → WeakSet
                    let existing = private_lowered_map.get(&priv_inner).copied();
                    let ws_ref = if let Some(ex) = existing {
                        ex.storage_ref
                    } else {
                        let nm = {
                            let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                            v.push(b'_');
                            v.extend_from_slice(&private_orig[1..]);
                            v.into_bump_slice()
                        };
                        Self::new_sym(p, Symbol::Kind::Other, nm)
                    };
                    private_storage_ref = Some(ws_ref);
                    let fn_nm = {
                        let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                        v.push(b'_');
                        v.extend_from_slice(&private_orig[1..]);
                        v.extend_from_slice(Self::fn_suffix(k));
                        v.into_bump_slice()
                    };
                    let fn_ref = Self::new_sym(p, Symbol::Kind::Other, fn_nm);
                    private_method_fn_ref = Some(fn_ref);

                    let mut new_info = existing.unwrap_or(PrivateLoweredInfo::new(ws_ref));
                    if k == 1 {
                        new_info.method_fn_ref = Some(fn_ref);
                    } else if k == 2 {
                        new_info.getter_fn_ref = Some(fn_ref);
                    } else {
                        new_info.setter_fn_ref = Some(fn_ref);
                    }
                    private_lowered_map.insert(priv_inner, new_info);

                    if existing.is_none() {
                        prefix_stmts.push(Self::var_decl2(p, ws_ref, Some(Self::new_weak_set_expr(p, loc)), fn_ref, None, loc));
                    } else {
                        prefix_stmts.push(Self::var_decl(p, fn_ref, None, loc));
                    }
                    dec_arg_count = 6;
                } else if k == 5 {
                    // Decorated private field → WeakMap
                    let nm = {
                        let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                        v.push(b'_');
                        v.extend_from_slice(&private_orig[1..]);
                        v.into_bump_slice()
                    };
                    let wm_ref = Self::new_sym(p, Symbol::Kind::Other, nm);
                    private_storage_ref = Some(wm_ref);
                    private_lowered_map.insert(priv_inner, PrivateLoweredInfo::new(wm_ref));
                    prefix_stmts.push(Self::var_decl(p, wm_ref, Some(Self::new_weak_map_expr(p, loc)), loc));
                    dec_arg_count = 5;
                } else if k == 4 {
                    // Decorated private auto-accessor → WeakMap + descriptor
                    let nm = {
                        let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                        v.push(b'_');
                        v.extend_from_slice(&private_orig[1..]);
                        v.into_bump_slice()
                    };
                    let wm_ref = Self::new_sym(p, Symbol::Kind::Other, nm);
                    private_storage_ref = Some(wm_ref);
                    let acc_nm = {
                        let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                        v.push(b'_');
                        v.extend_from_slice(&private_orig[1..]);
                        v.extend_from_slice(b"_acc");
                        v.into_bump_slice()
                    };
                    let acc_ref = Self::new_sym(p, Symbol::Kind::Other, acc_nm);
                    private_method_fn_ref = Some(acc_ref);
                    private_lowered_map.insert(priv_inner, PrivateLoweredInfo {
                        storage_ref: wm_ref,
                        method_fn_ref: None,
                        getter_fn_ref: None,
                        setter_fn_ref: None,
                        accessor_desc_ref: Some(acc_ref),
                    });
                    prefix_stmts.push(Self::var_decl2(p, wm_ref, Some(Self::new_weak_map_expr(p, loc)), acc_ref, None, loc));
                    dec_arg_count = 6;
                }
            } else if k == 4 {
                // Decorated public auto-accessor → WeakMap
                let accessor_name: &[u8] = 'brk: {
                    if let js_ast::ExprData::EString(s) = &key_expr.data {
                        let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                        v.push(b'_');
                        v.extend_from_slice(s.data);
                        break 'brk v.into_bump_slice();
                    }
                    let name = {
                        use std::io::Write as _;
                        let mut v = bumpalo::collections::Vec::<u8>::new_in(p.alloc());
                        let _ = write!(&mut v, "_accessor_storage{}", accessor_storage_counter);
                        v.into_bump_slice()
                    };
                    accessor_storage_counter += 1;
                    name
                };
                let wm_ref = Self::new_sym(p, Symbol::Kind::Other, accessor_name);
                private_extra_ref = Some(wm_ref);
                prefix_stmts.push(Self::var_decl(p, wm_ref, Some(Self::new_weak_map_expr(p, loc)), loc));
                dec_arg_count = 6;
            }

            // Build __decorateElement args
            let target_ref = if is_expr && expr_class_ref.is_some() {
                expr_class_ref.unwrap()
            } else {
                class_name_ref
            };
            // PERF(port): was arena alloc(Expr, n) — Phase B: bump slice
            let mut dec_args = bumpalo::collections::Vec::with_capacity_in(dec_arg_count, p.alloc());
            dec_args.push(p.new_expr(E::Identifier { r#ref: init_ref }, loc));
            dec_args.push(p.new_expr(E::Number { value: flags }, loc));
            dec_args.push(if is_private {
                let priv_ref = match &key_expr.data {
                    js_ast::ExprData::EPrivateIdentifier(pi) => pi.r#ref,
                    _ => unreachable!(),
                };
                p.new_expr(E::String { data: p.symbols.items[priv_ref.inner_index() as usize].original_name }, loc)
            } else {
                key_expr
            });
            dec_args.push(decorator_array);

            if is_private && private_storage_ref.is_some() {
                dec_args.push(Self::use_ref(p, private_storage_ref.unwrap(), loc));
                if dec_arg_count == 6 {
                    if k >= 1 && k <= 3 {
                        dec_args.push(prop.value.unwrap_or_else(|| p.new_expr(E::Undefined {}, loc)));
                    } else if k == 4 {
                        dec_args.push(Self::use_ref(p, private_storage_ref.unwrap(), loc));
                    } else {
                        dec_args.push(p.new_expr(E::Undefined {}, loc));
                    }
                }
            } else {
                p.record_usage(target_ref);
                dec_args.push(p.new_expr(E::Identifier { r#ref: target_ref }, class_name_loc));
                if dec_arg_count == 6 {
                    if let Some(extra_ref) = private_extra_ref {
                        dec_args.push(Self::use_ref(p, extra_ref, loc));
                    } else {
                        dec_args.push(p.new_expr(E::Undefined {}, loc));
                    }
                }
            }

            let raw_element = p.call_runtime(loc, b"__decorateElement", dec_args.into_bump_slice());
            let element = if let Some(fn_ref) = private_method_fn_ref {
                Self::assign_to(p, fn_ref, raw_element, loc)
            } else {
                raw_element
            };

            // Categorize the element
            if k >= 4 {
                // Field (k=5) or accessor (k=4) — remove from class body
                let mut prop_copy = prop.clone();
                prop_copy.ts_decorators = Default::default();
                if is_private {
                    if let Some(ps_ref) = private_storage_ref {
                        prop_copy.key = Some(p.new_expr(E::Identifier { r#ref: ps_ref }, loc));
                    }
                }
                if let Some(pe_ref) = private_extra_ref {
                    prop_copy.value = Some(p.new_expr(E::Identifier { r#ref: pe_ref }, loc));
                }

                let is_accessor = k == 4;
                let init_entry = FieldInitEntry { prop: prop_copy, is_private, is_accessor };

                if prop.flags.contains(Flags::Property::IsStatic) {
                    if is_accessor {
                        static_non_field_elements.push(element);
                        static_accessor_count += 1;
                    } else {
                        static_field_decorate.push(element);
                    }
                    static_element_order.push(StaticElement {
                        kind: StaticElementKind::FieldOrAccessor,
                        index: static_init_entries.len(),
                    });
                    static_init_entries.push(init_entry);
                } else {
                    if is_accessor {
                        instance_non_field_elements.push(element);
                        instance_accessor_count += 1;
                    } else {
                        instance_field_decorate.push(element);
                    }
                    instance_init_entries.push(init_entry);
                }
            } else if is_private && private_storage_ref.is_some() {
                // Private method/getter/setter — remove from class body
                let priv_inner2 = match &key_expr.data {
                    js_ast::ExprData::EPrivateIdentifier(pi) => pi.r#ref.inner_index(),
                    _ => unreachable!(),
                };
                if !emitted_private_adds.contains_key(&priv_inner2) {
                    emitted_private_adds.insert(priv_inner2, ());
                    Self::emit_private_add(
                        p,
                        prop.flags.contains(Flags::Property::IsStatic),
                        private_storage_ref.unwrap(),
                        None,
                        loc,
                        &mut constructor_inject_stmts,
                        &mut static_private_add_blocks,
                    );
                }
                if prop.flags.contains(Flags::Property::IsStatic) {
                    static_non_field_elements.push(element);
                    has_static_private_methods = true;
                } else {
                    instance_non_field_elements.push(element);
                    has_instance_private_methods = true;
                }
            } else {
                // Public method/getter/setter — keep in class body
                let mut new_prop = prop.clone();
                new_prop.ts_decorators = Default::default();
                new_properties.push(new_prop);
                if prop.flags.contains(Flags::Property::IsStatic) {
                    static_non_field_elements.push(element);
                } else {
                    instance_non_field_elements.push(element);
                }
            }
        }

        // ── Phase 5: Rewrite private accesses ────────────
        if private_lowered_map.len() > 0 {
            for nprop in new_properties.iter_mut() {
                if let Some(v) = &mut nprop.value {
                    Self::rewrite_private_accesses_in_expr(p, v, &private_lowered_map);
                }
                if let Some(sb) = nprop.class_static_block {
                    Self::rewrite_private_accesses_in_stmts(p, sb.stmts.slice_mut(), &private_lowered_map);
                }
            }
            for entry in instance_init_entries.iter_mut() {
                if let Some(ini) = &mut entry.prop.initializer {
                    Self::rewrite_private_accesses_in_expr(p, ini, &private_lowered_map);
                }
            }
            for entry in static_init_entries.iter_mut() {
                if let Some(ini) = &mut entry.prop.initializer {
                    Self::rewrite_private_accesses_in_expr(p, ini, &private_lowered_map);
                }
            }
            for sb in extracted_static_blocks.iter_mut() {
                Self::rewrite_private_accesses_in_stmts(p, sb.stmts.slice_mut(), &private_lowered_map);
            }
            for elem in static_non_field_elements.iter_mut() {
                Self::rewrite_private_accesses_in_expr(p, elem, &private_lowered_map);
            }
            for elem in instance_non_field_elements.iter_mut() {
                Self::rewrite_private_accesses_in_expr(p, elem, &private_lowered_map);
            }
            for elem in static_field_decorate.iter_mut() {
                Self::rewrite_private_accesses_in_expr(p, elem, &private_lowered_map);
            }
            for elem in instance_field_decorate.iter_mut() {
                Self::rewrite_private_accesses_in_expr(p, elem, &private_lowered_map);
            }
            Self::rewrite_private_accesses_in_stmts(p, &mut pre_eval_stmts, &private_lowered_map);
            Self::rewrite_private_accesses_in_stmts(p, &mut prefix_stmts, &private_lowered_map);
        }

        // ── Phase 6: Emit suffix ─────────────────────────
        let static_field_count = static_field_decorate.len();
        let total_accessor_count = static_accessor_count + instance_accessor_count;
        let static_field_base_idx = total_accessor_count;
        let instance_accessor_base_idx = static_accessor_count;
        let instance_field_base_idx = total_accessor_count + static_field_count;

        // 1-4: __decorateElement calls in spec order
        suffix_exprs.extend_from_slice(&static_non_field_elements);
        suffix_exprs.extend_from_slice(&instance_non_field_elements);
        suffix_exprs.extend_from_slice(&static_field_decorate);
        suffix_exprs.extend_from_slice(&instance_field_decorate);

        // 5: Class decorator
        if class_decorators.len() > 0 {
            p.record_usage(class_name_ref);
            let class_name_str: &[u8] = if let Some(name) = original_class_name_for_decorator {
                name
            } else if is_expr && expr_class_is_anonymous {
                name_from_context.unwrap_or(b"")
            } else {
                p.symbols.items[class_name_ref.inner_index() as usize].original_name
            };

            let mut cls_dec_args = bumpalo::collections::Vec::with_capacity_in(5, p.alloc());
            cls_dec_args.push(p.new_expr(E::Identifier { r#ref: init_ref }, loc));
            cls_dec_args.push(p.new_expr(E::Number { value: 0.0 }, loc));
            cls_dec_args.push(p.new_expr(E::String { data: class_name_str }, loc));
            cls_dec_args.push(if let Some(cdr) = class_dec_ref {
                Self::use_ref(p, cdr, loc)
            } else {
                p.new_expr(E::Array { items: class_decorators, ..Default::default() }, loc)
            });
            cls_dec_args.push(if is_expr {
                Self::use_ref(p, expr_class_ref.unwrap(), loc)
            } else {
                p.new_expr(E::Identifier { r#ref: class_name_ref }, class_name_loc)
            });

            suffix_exprs.push(Self::assign_to(
                p,
                class_name_ref,
                p.call_runtime(loc, b"__decorateElement", cls_dec_args.into_bump_slice()),
                class_name_loc,
            ));
        }

        // 6: Static method extra initializers
        if !static_non_field_elements.is_empty() || has_static_private_methods {
            suffix_exprs.push(Self::call_rt(p, loc, b"__runInitializers", &[
                Self::use_ref(p, init_ref, loc),
                p.new_expr(E::Number { value: 3.0 }, loc),
                Self::use_ref(p, class_name_ref, class_name_loc),
            ]));
        }

        // 7: Static elements in source order
        {
            let mut s_accessor_idx: usize = 0;
            let mut s_field_idx: usize = 0;
            for elem in static_element_order.iter() {
                match elem.kind {
                    StaticElementKind::Block => {
                        let sb = &mut extracted_static_blocks[elem.index];
                        let stmts_slice = sb.stmts.slice_mut();
                        Self::rewrite_stmts(
                            p,
                            stmts_slice,
                            RewriteKind::ReplaceThis { r#ref: class_name_ref, loc: class_name_loc },
                        );

                        // Check if all statements are simple expressions
                        let all_exprs = 'blk: {
                            for sb_stmt in stmts_slice.iter() {
                                if !matches!(sb_stmt.data, js_ast::StmtData::SExpr(_)) {
                                    break 'blk false;
                                }
                            }
                            true
                        };

                        if all_exprs {
                            for sb_stmt in stmts_slice.iter() {
                                match &sb_stmt.data {
                                    js_ast::StmtData::SExpr(s) => suffix_exprs.push(s.value),
                                    _ => unreachable!(),
                                }
                            }
                        } else {
                            // Wrap in IIFE to preserve non-expression statements
                            let iife_body = p.new_expr(
                                E::Arrow {
                                    body: G::FnBody { loc, stmts: stmts_slice },
                                    is_async: false,
                                    ..Default::default()
                                },
                                loc,
                            );
                            suffix_exprs.push(p.new_expr(
                                E::Call { target: iife_body, args: ExprNodeList::empty(), ..Default::default() },
                                loc,
                            ));
                        }
                    }
                    StaticElementKind::FieldOrAccessor => {
                        let entry = &static_init_entries[elem.index];
                        let field_idx: usize = if entry.is_accessor {
                            let idx = s_accessor_idx;
                            s_accessor_idx += 1;
                            idx
                        } else {
                            let idx = static_field_base_idx + s_field_idx;
                            s_field_idx += 1;
                            idx
                        };

                        let run_args_count: usize = if entry.prop.initializer.is_some() { 4 } else { 3 };
                        let mut run_args = bumpalo::collections::Vec::with_capacity_in(run_args_count, p.alloc());
                        run_args.push(Self::use_ref(p, init_ref, loc));
                        run_args.push(p.new_expr(E::Number { value: Self::init_flag(field_idx) }, loc));
                        run_args.push(Self::use_ref(p, class_name_ref, class_name_loc));
                        if let Some(init_val) = entry.prop.initializer {
                            run_args.push(init_val);
                        }
                        let run_init_call = p.call_runtime(loc, b"__runInitializers", run_args.into_bump_slice());

                        if entry.is_accessor || entry.is_private {
                            let wm_ref_expr = if entry.is_accessor && !entry.is_private {
                                entry.prop.value.unwrap()
                            } else {
                                entry.prop.key.unwrap()
                            };
                            suffix_exprs.push(Self::call_rt(p, loc, b"__privateAdd", &[
                                Self::use_ref(p, class_name_ref, class_name_loc),
                                wm_ref_expr,
                                run_init_call,
                            ]));
                        } else {
                            let assign_target = Self::member_target(
                                p,
                                Self::use_ref(p, class_name_ref, class_name_loc),
                                &entry.prop,
                            );
                            suffix_exprs.push(Expr::assign(assign_target, run_init_call));
                        }

                        // Extra initializer
                        suffix_exprs.push(Self::call_rt(p, loc, b"__runInitializers", &[
                            Self::use_ref(p, init_ref, loc),
                            p.new_expr(E::Number { value: Self::extra_init_flag(field_idx) }, loc),
                            Self::use_ref(p, class_name_ref, class_name_loc),
                        ]));
                    }
                }
            }
        }

        // 8: Class extra initializers
        if class_decorators.len() > 0 {
            suffix_exprs.push(Self::call_rt(p, loc, b"__runInitializers", &[
                Self::use_ref(p, init_ref, loc),
                p.new_expr(E::Number { value: 1.0 }, loc),
                Self::use_ref(p, class_name_ref, class_name_loc),
            ]));
        }

        // 9: __decoratorMetadata
        suffix_exprs.push(Self::call_rt(p, loc, b"__decoratorMetadata", &[
            Self::use_ref(p, init_ref, loc),
            Self::use_ref(p, class_name_ref, class_name_loc),
        ]));

        // ── Phase 7: Constructor injection ───────────────
        if !instance_non_field_elements.is_empty() || has_instance_private_methods {
            constructor_inject_stmts.push(p.s(
                S::SExpr {
                    value: Self::call_rt(p, loc, b"__runInitializers", &[
                        Self::use_ref(p, init_ref, loc),
                        p.new_expr(E::Number { value: 5.0 }, loc),
                        p.new_expr(E::This {}, loc),
                    ]),
                    ..Default::default()
                },
                loc,
            ));
        }

        // Instance field/accessor init + extra-init
        {
            let mut i_accessor_idx: usize = 0;
            let mut i_field_idx: usize = 0;
            for entry in instance_init_entries.iter() {
                let field_idx: usize = if entry.is_accessor {
                    let idx = instance_accessor_base_idx + i_accessor_idx;
                    i_accessor_idx += 1;
                    idx
                } else {
                    let idx = instance_field_base_idx + i_field_idx;
                    i_field_idx += 1;
                    idx
                };

                let run_args_count: usize = if entry.prop.initializer.is_some() { 4 } else { 3 };
                let mut run_args = bumpalo::collections::Vec::with_capacity_in(run_args_count, p.alloc());
                run_args.push(Self::use_ref(p, init_ref, loc));
                run_args.push(p.new_expr(E::Number { value: Self::init_flag(field_idx) }, loc));
                run_args.push(p.new_expr(E::This {}, loc));
                if let Some(init_val) = entry.prop.initializer {
                    run_args.push(init_val);
                }
                let run_init_call = p.call_runtime(loc, b"__runInitializers", run_args.into_bump_slice());

                if entry.is_accessor || entry.is_private {
                    let wm_ref_expr = if entry.is_accessor && !entry.is_private {
                        entry.prop.value.unwrap()
                    } else {
                        entry.prop.key.unwrap()
                    };
                    constructor_inject_stmts.push(p.s(
                        S::SExpr {
                            value: Self::call_rt(p, loc, b"__privateAdd", &[
                                p.new_expr(E::This {}, loc),
                                wm_ref_expr,
                                run_init_call,
                            ]),
                            ..Default::default()
                        },
                        loc,
                    ));
                } else {
                    constructor_inject_stmts.push(Stmt::assign(
                        Self::member_target(p, p.new_expr(E::This {}, loc), &entry.prop),
                        run_init_call,
                    ));
                }

                // Extra initializer
                constructor_inject_stmts.push(p.s(
                    S::SExpr {
                        value: Self::call_rt(p, loc, b"__runInitializers", &[
                            Self::use_ref(p, init_ref, loc),
                            p.new_expr(E::Number { value: Self::extra_init_flag(field_idx) }, loc),
                            p.new_expr(E::This {}, loc),
                        ]),
                        ..Default::default()
                    },
                    loc,
                ));
            }
        }

        // Inject into constructor
        if !constructor_inject_stmts.is_empty() {
            let mut found_constructor = false;
            for nprop in new_properties.iter_mut() {
                if nprop.flags.contains(Flags::Property::IsMethod)
                    && nprop.key.is_some()
                    && matches!(&nprop.key.unwrap().data, js_ast::ExprData::EString(s) if s.eql_comptime(b"constructor"))
                {
                    // TODO(port): borrowck — `nprop.value.?.data.e_function` returns &mut E::Function
                    let func = match &mut nprop.value.as_mut().unwrap().data {
                        js_ast::ExprData::EFunction(f) => f,
                        _ => unreachable!(),
                    };
                    // PERF(port): was ListManaged.fromOwnedSlice + insertSlice — Phase B: bumpalo Vec
                    let mut body_stmts: Vec<Stmt> = func.func.body.stmts.iter().cloned().collect();
                    let mut super_index: Option<usize> = None;
                    for (index, item) in body_stmts.iter().enumerate() {
                        let js_ast::StmtData::SExpr(se) = &item.data else { continue };
                        let js_ast::ExprData::ECall(call) = &se.value.data else { continue };
                        if !matches!(call.target.data, js_ast::ExprData::ESuper(_)) {
                            continue;
                        }
                        super_index = Some(index);
                        break;
                    }
                    let insert_at = if let Some(j) = super_index { j + 1 } else { 0 };
                    body_stmts.splice(insert_at..insert_at, constructor_inject_stmts.iter().cloned());
                    // TODO(port): leak body_stmts into arena slice
                    func.func.body.stmts = p.alloc().alloc_slice_clone(&body_stmts);
                    found_constructor = true;
                    break;
                }
            }

            if !found_constructor {
                let mut ctor_stmts = bumpalo::collections::Vec::<Stmt>::new_in(p.alloc());
                if class.extends.is_some() {
                    let target = p.new_expr(E::Super {}, loc);
                    let args_ref = Self::new_sym(p, Symbol::Kind::Unbound, arguments_str);
                    let spread = p.new_expr(
                        E::Spread { value: p.new_expr(E::Identifier { r#ref: args_ref }, loc) },
                        loc,
                    );
                    let call_args = ExprNodeList::init_one(p.alloc(), spread);
                    ctor_stmts.push(p.s(
                        S::SExpr {
                            value: p.new_expr(E::Call { target, args: call_args, ..Default::default() }, loc),
                            ..Default::default()
                        },
                        loc,
                    ));
                }
                ctor_stmts.extend_from_slice(&constructor_inject_stmts);
                new_properties.insert(0, G::Property {
                    flags: Flags::Property::init(Flags::Property::IsMethod),
                    key: Some(p.new_expr(E::String { data: b"constructor" }, loc)),
                    value: Some(p.new_expr(
                        E::Function {
                            func: G::Fn {
                                name: None,
                                open_parens_loc: logger::Loc::EMPTY,
                                args: &[],
                                body: G::FnBody { loc, stmts: p.alloc().alloc_slice_clone(&ctor_stmts) },
                                flags: Flags::Function::init(Default::default()),
                                ..Default::default()
                            },
                        },
                        loc,
                    )),
                    ..Default::default()
                });
            }
        }

        // Static private __privateAdd blocks at beginning
        if !static_private_add_blocks.is_empty() {
            // PORT NOTE: Vec has no insertSlice — splice at 0
            new_properties.splice(0..0, static_private_add_blocks.iter().cloned());
        }

        // TODO(port): leak Vec<Property> into arena slice for class.properties
        class.properties = p.alloc().alloc_slice_clone(&new_properties);
        class.has_decorators = false;
        class.should_lower_standard_decorators = false;

        // ── Phase 8: Assemble output ─────────────────────
        if is_expr {
            let mut comma_parts = bumpalo::collections::Vec::<Expr>::new_in(p.alloc());
            if let Some(cda) = class_dec_assign_expr {
                comma_parts.push(cda);
            }
            if let Some(ba) = base_assign_expr {
                comma_parts.push(ba);
            }

            // Convert S.Local decls to comma assignments
            // PORT NOTE: Zig used a local anonymous struct fn; ported as a closure.
            let mut append_decls_as_assigns =
                |parts: &mut bumpalo::collections::Vec<'_, Expr>,
                 var_decls: &mut bumpalo::collections::Vec<'_, G::Decl>,
                 stmts_list: &[Stmt],
                 parser: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
                 l: logger::Loc| {
                    for pstmt in stmts_list.iter() {
                        match &pstmt.data {
                            js_ast::StmtData::SExpr(se) => {
                                parts.push(se.value);
                            }
                            js_ast::StmtData::SLocal(local) => {
                                for decl_item in local.decls.slice() {
                                    let r#ref = match &decl_item.binding.data {
                                        js_ast::BindingData::BIdentifier(b) => b.r#ref,
                                        _ => unreachable!(),
                                    };
                                    var_decls.push(G::Decl {
                                        binding: parser.b(B::Identifier { r#ref }, l),
                                        value: None,
                                    });
                                    if let Some(val) = decl_item.value {
                                        parser.record_usage(r#ref);
                                        parts.push(Expr::assign(
                                            parser.new_expr(E::Identifier { r#ref }, l),
                                            val,
                                        ));
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                };

            append_decls_as_assigns(&mut comma_parts, &mut expr_var_decls, &pre_eval_stmts, p, loc);
            append_decls_as_assigns(&mut comma_parts, &mut expr_var_decls, &prefix_stmts, p, loc);

            // _init = __decoratorStart(...)
            comma_parts.push(Self::assign_to(p, init_ref, init_start_expr, loc));

            // _class = class { ... }
            comma_parts.push(Self::assign_to(
                p,
                expr_class_ref.unwrap(),
                p.new_expr(class.clone(), loc),
                loc,
            ));

            comma_parts.extend_from_slice(&suffix_exprs);

            // Final value
            let final_ref = if class_decorators.len() > 0 {
                class_name_ref
            } else {
                expr_class_ref.unwrap()
            };
            comma_parts.push(Self::use_ref(p, final_ref, loc));

            // Build comma chain
            let mut result = comma_parts[0];
            for part in &comma_parts[1..] {
                result = p.new_expr(
                    E::Binary { op: js_ast::Op::BinComma, left: result, right: *part },
                    loc,
                );
            }

            // Emit var declarations
            if !expr_var_decls.is_empty() {
                let var_decl_stmt = p.s(
                    S::Local {
                        decls: Decl::List::from_owned_slice(p.alloc().alloc_slice_clone(&expr_var_decls)),
                        ..Default::default()
                    },
                    loc,
                );
                if let Some(stmt_list) = &mut p.nearest_stmt_list {
                    stmt_list.push(var_decl_stmt);
                }
            }

            let mut out = bumpalo::collections::Vec::with_capacity_in(1, p.alloc());
            // PERF(port): was appendAssumeCapacity
            out.push(p.s(S::SExpr { value: result, ..Default::default() }, loc));
            return out.into_bump_slice_mut();
        }

        // Statement mode
        let mut out = bumpalo::collections::Vec::with_capacity_in(
            prefix_stmts.len() + pre_eval_stmts.len() + 5 + suffix_exprs.len(),
            p.alloc(),
        );
        if !matches!(class_dec_stmt.data, js_ast::StmtData::SEmpty(_)) {
            out.push(class_dec_stmt);
        }
        if !matches!(base_decl_stmt.data, js_ast::StmtData::SEmpty(_)) {
            out.push(base_decl_stmt);
        }
        out.extend_from_slice(&pre_eval_stmts);
        out.extend_from_slice(&prefix_stmts);
        // PERF(port): was appendAssumeCapacity
        out.push(init_decl_stmt);
        out.push(stmt);
        for expr in suffix_exprs.iter() {
            out.push(p.s(S::SExpr { value: *expr, ..Default::default() }, expr.loc));
        }
        // Inner class binding: let _Foo = Foo
        if !inner_class_ref.eql(class_name_ref) {
            p.record_usage(class_name_ref);
            let inner_decls = p.alloc().alloc_slice_fill_with(1, |_| G::Decl {
                binding: p.b(B::Identifier { r#ref: inner_class_ref }, loc),
                value: Some(p.new_expr(E::Identifier { r#ref: class_name_ref }, class_name_loc)),
            });
            out.push(p.s(
                S::Local {
                    kind: S::Local::Kind::KLet,
                    decls: Decl::List::from_owned_slice(inner_decls),
                    ..Default::default()
                },
                loc,
            ));
        }

        out.into_bump_slice_mut()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/lowerDecorators.zig (1495 lines)
//   confidence: medium
//   todos:      8
//   notes:      heavy borrowck reshaping needed in lower_impl (overlapping &mut p / class.properties iteration); arena slice handoffs (`p.alloc()`) are placeholders pending NewParser_ port; ExprData/StmtData variant names are guessed from .e_*/.s_* tags
// ──────────────────────────────────────────────────────────────────────────
