#![allow(
    unused_imports,
    unused_variables,
    dead_code,
    unused_mut,
    clippy::too_many_arguments,
    clippy::needless_late_init
)]
//! Lowering for TC39 standard ES decorators.
//! Extracted from P.zig to reduce duplication via shared helpers.

use bun_alloc::ArenaVecExt as _;
use core::ptr::NonNull;

use bun_collections::{HashMap, VecExt};

use crate::p::P;
use crate::parser::{ARGUMENTS_STR as arguments_str, Ref};
use bun_ast::g::{Arg, Decl, DeclList, Property, PropertyKind};
use bun_ast::{self as js_ast, B, E, Expr, ExprNodeList, Flags, G, S, Stmt, StmtNodeList, Symbol};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

// Zig: `pub fn LowerDecorators(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block.

// ── Local helper types ───────────────────────────────────────────────────────

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

#[derive(Clone, Copy)]
enum RewriteKind {
    ReplaceRef { old: Ref, new: Ref },
    ReplaceThis { ref_: Ref, loc: bun_ast::Loc },
}

// ── Shallow-copy helpers (Property / Class are not `Clone` because they hold
//    raw arena pointers; copying the pointers is the intended Zig semantic). ──

#[inline]
fn prop_copy(p: &Property) -> Property {
    Property {
        initializer: p.initializer,
        kind: p.kind,
        flags: p.flags,
        class_static_block: p.class_static_block,
        ts_decorators: bun_alloc::AstAlloc::vec(),
        key: p.key,
        value: p.value,
        // SAFETY: `Metadata` is a plain data enum (no Drop); shallow read is the
        // intended Zig copy semantic.
        ts_metadata: unsafe { core::ptr::read(&raw const p.ts_metadata) },
    }
}

#[inline]
fn prop_full_copy(p: &Property) -> Property {
    // Same as `prop_copy` but preserves `ts_decorators` (used for the "keep
    // undecorated property as-is" path).
    // SAFETY: Vec is repr-compatible with a (ptr,len,cap,origin) POD; the
    // arena owns the buffer for the parser lifetime. Shallow copy via read.
    let ts_decorators = unsafe { core::ptr::read(&raw const p.ts_decorators) };
    Property {
        initializer: p.initializer,
        kind: p.kind,
        flags: p.flags,
        class_static_block: p.class_static_block,
        ts_decorators,
        key: p.key,
        value: p.value,
        // SAFETY: see `prop_copy`.
        ts_metadata: unsafe { core::ptr::read(&raw const p.ts_metadata) },
    }
}

#[inline]
fn class_copy(c: &G::Class) -> G::Class {
    G::Class {
        class_keyword: c.class_keyword,
        // SAFETY: see `prop_full_copy`.
        ts_decorators: unsafe { core::ptr::read(&raw const c.ts_decorators) },
        class_name: c.class_name,
        extends: c.extends,
        body_loc: c.body_loc,
        close_brace_loc: c.close_brace_loc,
        properties: c.properties,
        has_decorators: c.has_decorators,
        should_lower_standard_decorators: c.should_lower_standard_decorators,
    }
}

// ── impl P ───────────────────────────────────────────────────────────────────

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    // ── Expression builder helpers ───────────────────────

    /// recordUsage + E.Identifier in one call.
    #[inline]
    fn use_ref(&mut self, ref_: Ref, l: bun_ast::Loc) -> Expr {
        self.record_usage(ref_);
        self.new_expr(
            E::Identifier {
                ref_,
                ..Default::default()
            },
            l,
        )
    }

    /// Allocate args + callRuntime in one call.
    fn call_rt(&mut self, l: bun_ast::Loc, name: &'static [u8], args: &[Expr]) -> Expr {
        let bump = self.arena;
        let a = bump.alloc_slice_copy(args);
        let list = ExprNodeList::from_arena_slice(a);
        self.call_runtime(l, name, list)
    }

    /// newSymbol + scope.generated.append in one call.
    fn new_sym(&mut self, kind: js_ast::symbol::Kind, name: &'a [u8]) -> Ref {
        let ref_ = self.new_symbol(kind, name).expect("unreachable");
        VecExt::append(&mut self.current_scope_mut().generated, ref_);
        ref_
    }

    /// Single var declaration statement.
    fn var_decl(&mut self, ref_: Ref, value: Option<Expr>, l: bun_ast::Loc) -> Stmt {
        let binding = self.b(B::Identifier { r#ref: ref_ }, l);
        let decls = DeclList::from_slice(&[G::Decl { binding, value }]);
        self.s(
            S::Local {
                decls,
                ..Default::default()
            },
            l,
        )
    }

    /// Two-variable declaration statement.
    fn var_decl2(
        &mut self,
        r1: Ref,
        v1: Option<Expr>,
        r2: Ref,
        v2: Option<Expr>,
        l: bun_ast::Loc,
    ) -> Stmt {
        let b1 = self.b(B::Identifier { r#ref: r1 }, l);
        let b2 = self.b(B::Identifier { r#ref: r2 }, l);
        let decls = DeclList::from_slice(&[
            G::Decl {
                binding: b1,
                value: v1,
            },
            G::Decl {
                binding: b2,
                value: v2,
            },
        ]);
        self.s(
            S::Local {
                decls,
                ..Default::default()
            },
            l,
        )
    }

    /// recordUsage + Expr.assign.
    fn assign_to(&mut self, ref_: Ref, value: Expr, l: bun_ast::Loc) -> Expr {
        self.record_usage(ref_);
        Expr::assign(
            self.new_expr(
                E::Identifier {
                    ref_,
                    ..Default::default()
                },
                l,
            ),
            value,
        )
    }

    /// new WeakMap() expression.
    fn new_weak_map_expr(&mut self, l: bun_ast::Loc) -> Expr {
        let ref_ = self.find_symbol(l, b"WeakMap").expect("unreachable").r#ref;
        let target = self.new_expr(
            E::Identifier {
                ref_,
                ..Default::default()
            },
            l,
        );
        self.new_expr(
            E::New {
                target,
                args: bun_alloc::AstAlloc::vec(),
                close_parens_loc: l,
                ..Default::default()
            },
            l,
        )
    }

    /// new WeakSet() expression.
    fn new_weak_set_expr(&mut self, l: bun_ast::Loc) -> Expr {
        let ref_ = self.find_symbol(l, b"WeakSet").expect("unreachable").r#ref;
        let target = self.new_expr(
            E::Identifier {
                ref_,
                ..Default::default()
            },
            l,
        );
        self.new_expr(
            E::New {
                target,
                args: bun_alloc::AstAlloc::vec(),
                close_parens_loc: l,
                ..Default::default()
            },
            l,
        )
    }

    /// Create a static block property from a single expression.
    fn make_static_block(&mut self, expr: Expr, l: bun_ast::Loc) -> Property {
        let bump = self.arena;
        let stmt = self.s(
            S::SExpr {
                value: expr,
                ..Default::default()
            },
            l,
        );
        let stmts = bump.alloc_slice_copy(&[stmt]);
        let stmts_list = bun_alloc::AstVec::<Stmt>::from_arena_slice(stmts);
        let sb = bump.alloc(G::ClassStaticBlock {
            loc: l,
            stmts: stmts_list,
        });
        Property {
            kind: PropertyKind::ClassStaticBlock,
            class_static_block: Some(js_ast::StoreRef::from_bump(sb)),
            ..Default::default()
        }
    }

    /// Build property access: target.name or target[key].
    fn member_target(&mut self, target_expr: Expr, prop: &Property) -> Expr {
        let key_expr = prop.key.expect("infallible: prop has key");
        if prop.flags.contains(Flags::Property::IsComputed)
            || matches!(key_expr.data, js_ast::ExprData::ENumber(_))
        {
            return self.new_expr(
                E::Index {
                    target: target_expr,
                    index: key_expr,
                    optional_chain: None,
                },
                key_expr.loc,
            );
        }
        if let js_ast::ExprData::EString(s) = &key_expr.data {
            return self.new_expr(
                E::Dot {
                    target: target_expr,
                    name: s.data,
                    name_loc: key_expr.loc,
                    ..Default::default()
                },
                key_expr.loc,
            );
        }
        self.new_expr(
            E::Index {
                target: target_expr,
                index: key_expr,
                optional_chain: None,
            },
            key_expr.loc,
        )
    }

    fn init_flag(idx: usize) -> f64 {
        ((4 + 2 * idx) << 1) as f64
    }

    fn extra_init_flag(idx: usize) -> f64 {
        (((5 + 2 * idx) << 1) | 1) as f64
    }

    /// Emit __privateAdd for a given storage ref.
    fn emit_private_add(
        &mut self,
        is_static: bool,
        storage_ref: Ref,
        value: Option<Expr>,
        loc: bun_ast::Loc,
        constructor_inject: &mut BumpVec<'_, Stmt>,
        static_blocks: &mut BumpVec<'_, Property>,
    ) {
        let target = self.new_expr(E::This {}, loc);
        let storage = self.use_ref(storage_ref, loc);
        let call = if let Some(v) = value {
            self.call_rt(loc, b"__privateAdd", &[target, storage, v])
        } else {
            self.call_rt(loc, b"__privateAdd", &[target, storage])
        };
        if is_static {
            static_blocks.push(self.make_static_block(call, loc));
        } else {
            constructor_inject.push(self.s(
                S::SExpr {
                    value: call,
                    ..Default::default()
                },
                loc,
            ));
        }
    }

    /// Get the method kind code (1=method, 2=getter, 3=setter).
    fn method_kind(prop: &Property) -> u8 {
        match prop.kind {
            PropertyKind::Get => 2,
            PropertyKind::Set => 3,
            _ => 1,
        }
    }

    /// Get fn variable suffix for a given kind code.
    fn fn_suffix(k: u8) -> &'static [u8] {
        if k == 2 {
            b"_get"
        } else if k == 3 {
            b"_set"
        } else {
            b"_fn"
        }
    }

    /// Bump-format `_{prefix}{n}` (or just `_{prefix}` when n is omitted).
    fn bump_name(&self, prefix: &[u8], n: Option<usize>) -> &'a [u8] {
        let mut v = BumpVec::<u8>::new_in(self.arena);
        v.extend_from_slice(prefix);
        if let Some(n) = n {
            // PORT NOTE: bumpalo Vec<u8> doesn't impl io::Write; format into a
            // bump String and copy the bytes.
            let s = bun_alloc::arena_format!(in self.arena, "{}", n);
            v.extend_from_slice(s.as_bytes());
        }
        v.into_bump_slice()
    }

    fn bump_name2(&self, a: &[u8], b: &[u8]) -> &'a [u8] {
        let mut v = BumpVec::<u8>::new_in(self.arena);
        v.extend_from_slice(a);
        v.extend_from_slice(b);
        v.into_bump_slice()
    }

    // ── Generic tree rewriter ────────────────────────────

    fn rewrite_expr(&mut self, expr: &mut Expr, kind: RewriteKind) {
        match kind {
            RewriteKind::ReplaceRef { old, new } => {
                if let js_ast::ExprData::EIdentifier(id) = &expr.data {
                    if id.ref_.eql(old) {
                        self.record_usage(new);
                        expr.data = js_ast::ExprData::EIdentifier(E::Identifier {
                            ref_: new,
                            ..Default::default()
                        });
                        return;
                    }
                }
            }
            RewriteKind::ReplaceThis { ref_, loc } => {
                if matches!(expr.data, js_ast::ExprData::EThis(_)) {
                    *expr = self.use_ref(ref_, loc);
                    return;
                }
            }
        }
        match &mut expr.data {
            js_ast::ExprData::EBinary(e) => {
                self.rewrite_expr(&mut e.left, kind);
                self.rewrite_expr(&mut e.right, kind);
            }
            js_ast::ExprData::ECall(e) => {
                let mut t = e.target;
                self.rewrite_expr(&mut t, kind);
                e.target = t;
                for a in e.args.slice_mut() {
                    self.rewrite_expr(a, kind);
                }
            }
            js_ast::ExprData::ENew(e) => {
                let mut t = e.target;
                self.rewrite_expr(&mut t, kind);
                e.target = t;
                for a in e.args.slice_mut() {
                    self.rewrite_expr(a, kind);
                }
            }
            js_ast::ExprData::EIndex(e) => {
                self.rewrite_expr(&mut e.target, kind);
                self.rewrite_expr(&mut e.index, kind);
            }
            js_ast::ExprData::EDot(e) => self.rewrite_expr(&mut e.target, kind),
            js_ast::ExprData::ESpread(e) => self.rewrite_expr(&mut e.value, kind),
            js_ast::ExprData::EUnary(e) => self.rewrite_expr(&mut e.value, kind),
            js_ast::ExprData::EIf(e) => {
                self.rewrite_expr(&mut e.test_, kind);
                self.rewrite_expr(&mut e.yes, kind);
                self.rewrite_expr(&mut e.no, kind);
            }
            js_ast::ExprData::EArray(e) => {
                for item in e.items.slice_mut() {
                    self.rewrite_expr(item, kind);
                }
            }
            js_ast::ExprData::EObject(e) => {
                for prop in e.properties.slice_mut() {
                    if let Some(v) = &mut prop.value {
                        self.rewrite_expr(v, kind);
                    }
                    if let Some(ini) = &mut prop.initializer {
                        self.rewrite_expr(ini, kind);
                    }
                }
            }
            js_ast::ExprData::ETemplate(e) => {
                if let Some(t) = &mut e.tag {
                    self.rewrite_expr(t, kind);
                }
                // SAFETY: arena-owned slice; unique access via `&mut e`.
                for part in e.parts_mut().iter_mut() {
                    self.rewrite_expr(&mut part.value, kind);
                }
            }
            js_ast::ExprData::EArrow(e) => {
                let stmts = e.body.stmts.slice_mut();
                self.rewrite_stmts(stmts, kind);
            }
            js_ast::ExprData::EFunction(e) => match kind {
                RewriteKind::ReplaceThis { .. } => {}
                RewriteKind::ReplaceRef { .. } => {
                    let stmts = e.func.body.stmts.slice_mut();
                    if !stmts.is_empty() {
                        self.rewrite_stmts(stmts, kind);
                    }
                }
            },
            js_ast::ExprData::EClass(_) => {}
            _ => {}
        }
    }

    fn rewrite_stmts(&mut self, stmts: &mut [Stmt], kind: RewriteKind) {
        for cur_stmt in stmts.iter_mut() {
            let cur_loc = cur_stmt.loc;
            match &mut cur_stmt.data {
                js_ast::StmtData::SExpr(sexpr) => {
                    let mut val = sexpr.value;
                    self.rewrite_expr(&mut val, kind);
                    *cur_stmt = self.s(
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
                            self.rewrite_expr(v, kind);
                        }
                    }
                }
                js_ast::StmtData::SReturn(ret) => {
                    if let Some(v) = &mut ret.value {
                        self.rewrite_expr(v, kind);
                    }
                }
                js_ast::StmtData::SThrow(data) => self.rewrite_expr(&mut data.value, kind),
                js_ast::StmtData::SIf(data) => {
                    let mut t = data.test_;
                    self.rewrite_expr(&mut t, kind);
                    data.test_ = t;
                    let mut yes = data.yes;
                    self.rewrite_stmts(core::slice::from_mut(&mut yes), kind);
                    data.yes = yes;
                    if let Some(no) = &mut data.no {
                        self.rewrite_stmts(core::slice::from_mut(no), kind);
                    }
                }
                js_ast::StmtData::SBlock(data) => {
                    let stmts = data.stmts.slice_mut();
                    self.rewrite_stmts(stmts, kind);
                }
                js_ast::StmtData::SFor(data) => {
                    if let Some(fi) = &mut data.init {
                        self.rewrite_stmts(core::slice::from_mut(fi), kind);
                    }
                    if let Some(t) = &mut data.test_ {
                        self.rewrite_expr(t, kind);
                    }
                    if let Some(u) = &mut data.update {
                        self.rewrite_expr(u, kind);
                    }
                    let mut body = data.body;
                    self.rewrite_stmts(core::slice::from_mut(&mut body), kind);
                    data.body = body;
                }
                js_ast::StmtData::SForIn(data) => {
                    let mut v = data.value;
                    self.rewrite_expr(&mut v, kind);
                    data.value = v;
                    let mut body = data.body;
                    self.rewrite_stmts(core::slice::from_mut(&mut body), kind);
                    data.body = body;
                }
                js_ast::StmtData::SForOf(data) => {
                    let mut v = data.value;
                    self.rewrite_expr(&mut v, kind);
                    data.value = v;
                    let mut body = data.body;
                    self.rewrite_stmts(core::slice::from_mut(&mut body), kind);
                    data.body = body;
                }
                js_ast::StmtData::SWhile(data) => {
                    let mut t = data.test_;
                    self.rewrite_expr(&mut t, kind);
                    data.test_ = t;
                    let mut body = data.body;
                    self.rewrite_stmts(core::slice::from_mut(&mut body), kind);
                    data.body = body;
                }
                js_ast::StmtData::SDoWhile(data) => {
                    let mut t = data.test_;
                    self.rewrite_expr(&mut t, kind);
                    data.test_ = t;
                    let mut body = data.body;
                    self.rewrite_stmts(core::slice::from_mut(&mut body), kind);
                    data.body = body;
                }
                js_ast::StmtData::SSwitch(data) => {
                    let mut t = data.test_;
                    self.rewrite_expr(&mut t, kind);
                    data.test_ = t;
                    let cases = data.cases.slice_mut();
                    for case in cases.iter_mut() {
                        if let Some(v) = &mut case.value {
                            self.rewrite_expr(v, kind);
                        }
                        let body = case.body.slice_mut();
                        self.rewrite_stmts(body, kind);
                    }
                }
                js_ast::StmtData::STry(data) => {
                    let body = data.body.slice_mut();
                    self.rewrite_stmts(body, kind);
                    if let Some(c) = &mut data.catch_ {
                        let cb = c.body.slice_mut();
                        self.rewrite_stmts(cb, kind);
                    }
                    if let Some(f) = &mut data.finally {
                        let fb = f.stmts.slice_mut();
                        self.rewrite_stmts(fb, kind);
                    }
                }
                js_ast::StmtData::SLabel(data) => {
                    let mut s = data.stmt;
                    self.rewrite_stmts(core::slice::from_mut(&mut s), kind);
                    data.stmt = s;
                }
                js_ast::StmtData::SWith(data) => {
                    let mut v = data.value;
                    self.rewrite_expr(&mut v, kind);
                    data.value = v;
                    let mut body = data.body;
                    self.rewrite_stmts(core::slice::from_mut(&mut body), kind);
                    data.body = body;
                }
                _ => {}
            }
        }
    }

    // ── Private access rewriting ─────────────────────────

    fn private_get_expr(&mut self, obj: Expr, info: PrivateLoweredInfo, l: bun_ast::Loc) -> Expr {
        if let Some(desc_ref) = info.accessor_desc_ref {
            let storage = self.use_ref(info.storage_ref, l);
            let desc = self.use_ref(desc_ref, l);
            let dot = self.new_expr(
                E::Dot {
                    target: desc,
                    name: b"get".into(),
                    name_loc: l,
                    ..Default::default()
                },
                l,
            );
            self.call_rt(l, b"__privateGet", &[obj, storage, dot])
        } else if let Some(fn_ref) = info.getter_fn_ref {
            let storage = self.use_ref(info.storage_ref, l);
            let f = self.use_ref(fn_ref, l);
            self.call_rt(l, b"__privateGet", &[obj, storage, f])
        } else if let Some(fn_ref) = info.method_fn_ref {
            let storage = self.use_ref(info.storage_ref, l);
            let f = self.use_ref(fn_ref, l);
            self.call_rt(l, b"__privateMethod", &[obj, storage, f])
        } else {
            let storage = self.use_ref(info.storage_ref, l);
            self.call_rt(l, b"__privateGet", &[obj, storage])
        }
    }

    fn private_set_expr(
        &mut self,
        obj: Expr,
        info: PrivateLoweredInfo,
        val: Expr,
        l: bun_ast::Loc,
    ) -> Expr {
        if let Some(desc_ref) = info.accessor_desc_ref {
            let storage = self.use_ref(info.storage_ref, l);
            let desc = self.use_ref(desc_ref, l);
            let dot = self.new_expr(
                E::Dot {
                    target: desc,
                    name: b"set".into(),
                    name_loc: l,
                    ..Default::default()
                },
                l,
            );
            self.call_rt(l, b"__privateSet", &[obj, storage, val, dot])
        } else if let Some(fn_ref) = info.setter_fn_ref {
            let storage = self.use_ref(info.storage_ref, l);
            let f = self.use_ref(fn_ref, l);
            self.call_rt(l, b"__privateSet", &[obj, storage, val, f])
        } else {
            let storage = self.use_ref(info.storage_ref, l);
            self.call_rt(l, b"__privateSet", &[obj, storage, val])
        }
    }

    fn rewrite_private_accesses_in_expr(&mut self, expr: &mut Expr, map: &PrivateLoweredMap) {
        let expr_loc = expr.loc;
        match &mut expr.data {
            js_ast::ExprData::EIndex(e) => {
                let mut tgt = e.target;
                self.rewrite_private_accesses_in_expr(&mut tgt, map);
                e.target = tgt;
                if let js_ast::ExprData::EPrivateIdentifier(pi) = &e.index.data {
                    if let Some(info) = map.get(&pi.ref_.inner_index()).copied() {
                        let target = e.target;
                        *expr = self.private_get_expr(target, info, expr_loc);
                        return;
                    }
                }
                let mut idx = e.index;
                self.rewrite_private_accesses_in_expr(&mut idx, map);
                e.index = idx;
            }
            js_ast::ExprData::EBinary(e) => {
                if e.op == js_ast::OpCode::BinAssign {
                    if let js_ast::ExprData::EIndex(left_idx) = &mut e.left.data {
                        if let js_ast::ExprData::EPrivateIdentifier(pi) = &left_idx.index.data {
                            if let Some(info) = map.get(&pi.ref_.inner_index()).copied() {
                                let mut lt = left_idx.target;
                                self.rewrite_private_accesses_in_expr(&mut lt, map);
                                let mut rt = e.right;
                                self.rewrite_private_accesses_in_expr(&mut rt, map);
                                *expr = self.private_set_expr(lt, info, rt, expr_loc);
                                return;
                            }
                        }
                    }
                }
                if e.op == js_ast::OpCode::BinIn {
                    if let js_ast::ExprData::EPrivateIdentifier(pi) = &e.left.data {
                        if let Some(info) = map.get(&pi.ref_.inner_index()).copied() {
                            let mut rt = e.right;
                            self.rewrite_private_accesses_in_expr(&mut rt, map);
                            let storage = self.use_ref(info.storage_ref, expr_loc);
                            *expr = self.call_rt(expr_loc, b"__privateIn", &[storage, rt]);
                            return;
                        }
                    }
                }
                let mut l = e.left;
                self.rewrite_private_accesses_in_expr(&mut l, map);
                e.left = l;
                let mut r = e.right;
                self.rewrite_private_accesses_in_expr(&mut r, map);
                e.right = r;
            }
            js_ast::ExprData::ECall(e) => {
                if let js_ast::ExprData::EIndex(tgt_idx) = &mut e.target.data {
                    if let js_ast::ExprData::EPrivateIdentifier(pi) = &tgt_idx.index.data {
                        if let Some(info) = map.get(&pi.ref_.inner_index()).copied() {
                            let mut obj_expr = tgt_idx.target;
                            self.rewrite_private_accesses_in_expr(&mut obj_expr, map);
                            let private_access = self.private_get_expr(obj_expr, info, expr_loc);
                            let call_target = self.new_expr(
                                E::Dot {
                                    target: private_access,
                                    name: b"call".into(),
                                    name_loc: expr_loc,
                                    ..Default::default()
                                },
                                expr_loc,
                            );
                            let bump = self.arena;
                            let orig_args = e.args.slice_mut();
                            let mut new_args = BumpVec::with_capacity_in(1 + orig_args.len(), bump);
                            new_args.push(obj_expr);
                            for arg in orig_args.iter_mut() {
                                self.rewrite_private_accesses_in_expr(arg, map);
                                new_args.push(*arg);
                            }
                            e.target = call_target;
                            e.args = ExprNodeList::from_bump_vec(new_args);
                            return;
                        }
                    }
                }
                let mut t = e.target;
                self.rewrite_private_accesses_in_expr(&mut t, map);
                e.target = t;
                for arg in e.args.slice_mut() {
                    self.rewrite_private_accesses_in_expr(arg, map);
                }
            }
            js_ast::ExprData::EUnary(e) => self.rewrite_private_accesses_in_expr(&mut e.value, map),
            js_ast::ExprData::EDot(e) => self.rewrite_private_accesses_in_expr(&mut e.target, map),
            js_ast::ExprData::ESpread(e) => {
                self.rewrite_private_accesses_in_expr(&mut e.value, map)
            }
            js_ast::ExprData::EIf(e) => {
                let mut t = e.test_;
                self.rewrite_private_accesses_in_expr(&mut t, map);
                e.test_ = t;
                let mut y = e.yes;
                self.rewrite_private_accesses_in_expr(&mut y, map);
                e.yes = y;
                let mut n = e.no;
                self.rewrite_private_accesses_in_expr(&mut n, map);
                e.no = n;
            }
            js_ast::ExprData::EAwait(e) => self.rewrite_private_accesses_in_expr(&mut e.value, map),
            js_ast::ExprData::EYield(e) => {
                if let Some(v) = &mut e.value {
                    self.rewrite_private_accesses_in_expr(v, map);
                }
            }
            js_ast::ExprData::ENew(e) => {
                let mut t = e.target;
                self.rewrite_private_accesses_in_expr(&mut t, map);
                e.target = t;
                for arg in e.args.slice_mut() {
                    self.rewrite_private_accesses_in_expr(arg, map);
                }
            }
            js_ast::ExprData::EArray(e) => {
                for item in e.items.slice_mut() {
                    self.rewrite_private_accesses_in_expr(item, map);
                }
            }
            js_ast::ExprData::EObject(e) => {
                for prop in e.properties.slice_mut() {
                    if let Some(v) = &mut prop.value {
                        self.rewrite_private_accesses_in_expr(v, map);
                    }
                    if let Some(ini) = &mut prop.initializer {
                        self.rewrite_private_accesses_in_expr(ini, map);
                    }
                }
            }
            js_ast::ExprData::ETemplate(e) => {
                if let Some(t) = &mut e.tag {
                    self.rewrite_private_accesses_in_expr(t, map);
                }
                // SAFETY: see `rewrite_expr` ETemplate.
                for part in e.parts_mut().iter_mut() {
                    self.rewrite_private_accesses_in_expr(&mut part.value, map);
                }
            }
            js_ast::ExprData::EFunction(e) => {
                let stmts = e.func.body.stmts.slice_mut();
                self.rewrite_private_accesses_in_stmts(stmts, map);
            }
            js_ast::ExprData::EArrow(e) => {
                let stmts = e.body.stmts.slice_mut();
                self.rewrite_private_accesses_in_stmts(stmts, map);
            }
            _ => {}
        }
    }

    fn rewrite_private_accesses_in_stmts(&mut self, stmts: &mut [Stmt], map: &PrivateLoweredMap) {
        for stmt_item in stmts.iter_mut() {
            match &mut stmt_item.data {
                js_ast::StmtData::SExpr(data) => {
                    self.rewrite_private_accesses_in_expr(&mut data.value, map)
                }
                js_ast::StmtData::SReturn(data) => {
                    if let Some(v) = &mut data.value {
                        self.rewrite_private_accesses_in_expr(v, map);
                    }
                }
                js_ast::StmtData::SThrow(data) => {
                    self.rewrite_private_accesses_in_expr(&mut data.value, map)
                }
                js_ast::StmtData::SLocal(data) => {
                    for decl in data.decls.slice_mut() {
                        if let Some(v) = &mut decl.value {
                            self.rewrite_private_accesses_in_expr(v, map);
                        }
                    }
                }
                js_ast::StmtData::SIf(data) => {
                    let mut t = data.test_;
                    self.rewrite_private_accesses_in_expr(&mut t, map);
                    data.test_ = t;
                    let mut yes = data.yes;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut yes), map);
                    data.yes = yes;
                    if let Some(no) = &mut data.no {
                        self.rewrite_private_accesses_in_stmts(core::slice::from_mut(no), map);
                    }
                }
                js_ast::StmtData::SBlock(data) => {
                    let stmts = data.stmts.slice_mut();
                    self.rewrite_private_accesses_in_stmts(stmts, map);
                }
                js_ast::StmtData::SFor(data) => {
                    if let Some(fi) = &mut data.init {
                        self.rewrite_private_accesses_in_stmts(core::slice::from_mut(fi), map);
                    }
                    if let Some(t) = &mut data.test_ {
                        self.rewrite_private_accesses_in_expr(t, map);
                    }
                    if let Some(u) = &mut data.update {
                        self.rewrite_private_accesses_in_expr(u, map);
                    }
                    let mut body = data.body;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut body), map);
                    data.body = body;
                }
                js_ast::StmtData::SForIn(data) => {
                    let mut v = data.value;
                    self.rewrite_private_accesses_in_expr(&mut v, map);
                    data.value = v;
                    let mut body = data.body;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut body), map);
                    data.body = body;
                }
                js_ast::StmtData::SForOf(data) => {
                    let mut v = data.value;
                    self.rewrite_private_accesses_in_expr(&mut v, map);
                    data.value = v;
                    let mut body = data.body;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut body), map);
                    data.body = body;
                }
                js_ast::StmtData::SWhile(data) => {
                    let mut t = data.test_;
                    self.rewrite_private_accesses_in_expr(&mut t, map);
                    data.test_ = t;
                    let mut body = data.body;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut body), map);
                    data.body = body;
                }
                js_ast::StmtData::SDoWhile(data) => {
                    let mut t = data.test_;
                    self.rewrite_private_accesses_in_expr(&mut t, map);
                    data.test_ = t;
                    let mut body = data.body;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut body), map);
                    data.body = body;
                }
                js_ast::StmtData::SSwitch(data) => {
                    let mut t = data.test_;
                    self.rewrite_private_accesses_in_expr(&mut t, map);
                    data.test_ = t;
                    let cases = data.cases.slice_mut();
                    for case in cases.iter_mut() {
                        if let Some(v) = &mut case.value {
                            self.rewrite_private_accesses_in_expr(v, map);
                        }
                        let body = case.body.slice_mut();
                        self.rewrite_private_accesses_in_stmts(body, map);
                    }
                }
                js_ast::StmtData::STry(data) => {
                    let body = data.body.slice_mut();
                    self.rewrite_private_accesses_in_stmts(body, map);
                    if let Some(c) = &mut data.catch_ {
                        let cb = c.body.slice_mut();
                        self.rewrite_private_accesses_in_stmts(cb, map);
                    }
                    if let Some(f) = &mut data.finally {
                        let fb = f.stmts.slice_mut();
                        self.rewrite_private_accesses_in_stmts(fb, map);
                    }
                }
                js_ast::StmtData::SLabel(data) => {
                    let mut s = data.stmt;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut s), map);
                    data.stmt = s;
                }
                js_ast::StmtData::SWith(data) => {
                    let mut v = data.value;
                    self.rewrite_private_accesses_in_expr(&mut v, map);
                    data.value = v;
                    let mut body = data.body;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut body), map);
                    data.body = body;
                }
                _ => {}
            }
        }
    }

    // ── Public API ───────────────────────────────────────

    pub fn lower_standard_decorators_stmt(&mut self, stmt: Stmt, out: &mut BumpVec<'a, Stmt>) {
        // Every call site is the visitStmt `s_class` branch. `Stmt` and the
        // `StoreRef<S::Class>` payload are both `Copy`, so we can hold a copy
        // of the arena handle while still passing `stmt` by value below.
        // `StoreRef::DerefMut` is the safe arena-backref accessor; no raw
        // pointer round-trip needed.
        let mut s_class = match stmt.data {
            js_ast::StmtData::SClass(c) => c,
            _ => unreachable!(),
        };
        self.lower_impl(&mut s_class.class, stmt.loc, None, false, Some(stmt), out);
    }

    pub fn lower_standard_decorators_expr(
        &mut self,
        class: &mut G::Class,
        loc: bun_ast::Loc,
        name_from_context: Option<&'a [u8]>,
    ) -> Expr {
        let bump = self.arena;
        let mut out = BumpVec::<Stmt>::new_in(bump);
        self.lower_impl(class, loc, name_from_context, true, None, &mut out);
        if out.is_empty() {
            return self.new_expr(E::Missing {}, loc);
        }
        match &out[0].data {
            js_ast::StmtData::SExpr(s) => s.value,
            _ => unreachable!(),
        }
    }

    // ── Core lowering ────────────────────────────────────

    #[allow(clippy::too_many_lines)]
    fn lower_impl(
        &mut self,
        class: &mut G::Class,
        loc: bun_ast::Loc,
        name_from_context: Option<&'a [u8]>,
        is_expr: bool,
        original_stmt: Option<Stmt>,
        out: &mut BumpVec<'a, Stmt>,
    ) {
        let p = self;
        let bump = p.arena;

        // ── Phase 1: Setup ───────────────────────────────
        let mut class_name_ref: Ref;
        let mut class_name_loc: bun_ast::Loc;
        let mut expr_class_ref: Option<Ref> = None;
        let mut expr_class_is_anonymous = false;
        let mut expr_var_decls = BumpVec::<G::Decl>::new_in(bump);

        if is_expr {
            let ecr = p.new_sym(js_ast::symbol::Kind::Other, b"_class");
            expr_class_ref = Some(ecr);
            let binding = p.b(B::Identifier { r#ref: ecr }, loc);
            expr_var_decls.push(G::Decl {
                binding,
                value: None,
            });
            if let Some(cn) = &class.class_name {
                class_name_ref = cn.ref_.expect("infallible: ref bound");
                class_name_loc = cn.loc;
            } else {
                class_name_ref = ecr;
                class_name_loc = loc;
                expr_class_is_anonymous = true;
                if let Some(name) = name_from_context {
                    class.class_name = Some(js_ast::LocRef {
                        ref_: Some(p.new_sym(js_ast::symbol::Kind::Other, name)),
                        loc,
                    });
                }
            }
        } else {
            class_name_ref = class
                .class_name
                .as_ref()
                .unwrap()
                .ref_
                .expect("infallible: ref bound");
            class_name_loc = class.class_name.as_ref().unwrap().loc;
        }

        let mut inner_class_ref: Ref = class_name_ref;
        if !is_expr {
            // SAFETY: original_name is arena-owned for 'a.
            let cns: &'a [u8] = p.symbols[class_name_ref.inner_index() as usize]
                .original_name
                .slice();
            let name = p.bump_name2(b"_", cns);
            inner_class_ref = p.new_sym(js_ast::symbol::Kind::Other, name);
        }

        // Zig: `const class_decorators = class.ts_decorators; class.ts_decorators = .{};`
        // — a shallow `BabyList` copy. In Rust `ExprNodeList = Vec<Expr>` owns its
        // buffer, so this MUST be a real ownership transfer; the previous
        // `ptr::read` left a second owner in the local that dropped at function
        // exit, freeing the buffer that `E::Array { items }` (Phase-2/5 below)
        // still pointed at → use-after-poison in `expr_can_be_removed_if_unused`.
        let mut class_decorators: ExprNodeList =
            bun_alloc::AstAlloc::take(&mut class.ts_decorators);
        let class_decorators_len = class_decorators.len_u32() as usize;

        let init_ref = p.new_sym(js_ast::symbol::Kind::Other, b"_init");
        if is_expr {
            let binding = p.b(B::Identifier { r#ref: init_ref }, loc);
            expr_var_decls.push(G::Decl {
                binding,
                value: None,
            });
        }

        let mut base_ref: Option<Ref> = None;
        if class.extends.is_some() {
            let br = p.new_sym(js_ast::symbol::Kind::Other, b"_base");
            base_ref = Some(br);
            if is_expr {
                let binding = p.b(B::Identifier { r#ref: br }, loc);
                expr_var_decls.push(G::Decl {
                    binding,
                    value: None,
                });
            }
        }

        // ── Phase 2: Pre-evaluate decorators/keys ────────
        let mut dec_counter: usize = 0;
        let mut class_dec_ref: Option<Ref> = None;
        let mut class_dec_stmt: Stmt = Stmt::empty();
        let mut class_dec_assign_expr: Option<Expr> = None;
        if class_decorators_len > 0 {
            dec_counter += 1;
            let cdr = p.new_sym(js_ast::symbol::Kind::Other, b"_dec");
            class_dec_ref = Some(cdr);
            // Move ownership into the AST node — `class_decorators` is not read
            // again on this branch (Phase-5's else-arm only runs when
            // `class_dec_ref` is `None`, i.e. `class_decorators_len == 0`).
            let items = bun_alloc::AstAlloc::take(&mut class_decorators);
            let arr = p.new_expr(
                E::Array {
                    items,
                    ..Default::default()
                },
                loc,
            );
            if is_expr {
                let binding = p.b(B::Identifier { r#ref: cdr }, loc);
                expr_var_decls.push(G::Decl {
                    binding,
                    value: None,
                });
                class_dec_assign_expr = Some(p.assign_to(cdr, arr, loc));
            } else {
                class_dec_stmt = p.var_decl(cdr, Some(arr), loc);
            }
        }

        let mut prop_dec_refs: HashMap<usize, Ref> = HashMap::default();
        let mut computed_key_refs: HashMap<usize, Ref> = HashMap::default();
        let mut pre_eval_stmts = BumpVec::<Stmt>::new_in(bump);
        let mut computed_key_counter: usize = 0;

        let props_slice: &mut [Property] = class.properties.slice_mut();
        for (prop_idx, prop) in props_slice.iter_mut().enumerate() {
            if prop.kind == PropertyKind::ClassStaticBlock {
                continue;
            }
            if prop.ts_decorators.len_u32() > 0 {
                dec_counter += 1;
                let dec_name: &'a [u8] = if dec_counter == 1 {
                    b"_dec"
                } else {
                    p.bump_name(b"_dec", Some(dec_counter))
                };
                let dec_ref = p.new_sym(js_ast::symbol::Kind::Other, dec_name);
                prop_dec_refs.insert(prop_idx, dec_ref);
                if is_expr {
                    let binding = p.b(B::Identifier { r#ref: dec_ref }, loc);
                    expr_var_decls.push(G::Decl {
                        binding,
                        value: None,
                    });
                }
                // SAFETY: shallow-reborrow arena Vec.
                let items: ExprNodeList = unsafe { core::ptr::read(&raw const prop.ts_decorators) };
                let arr = p.new_expr(
                    E::Array {
                        items,
                        ..Default::default()
                    },
                    loc,
                );
                pre_eval_stmts.push(p.var_decl(dec_ref, Some(arr), loc));
            }
            if prop.flags.contains(Flags::Property::IsComputed)
                && prop.key.is_some()
                && prop.ts_decorators.len_u32() > 0
            {
                computed_key_counter += 1;
                let key_name: &'a [u8] = if computed_key_counter == 1 {
                    b"_computedKey"
                } else {
                    p.bump_name(b"_computedKey", Some(computed_key_counter))
                };
                let key_ref = p.new_sym(js_ast::symbol::Kind::Other, key_name);
                computed_key_refs.insert(prop_idx, key_ref);
                if is_expr {
                    let binding = p.b(B::Identifier { r#ref: key_ref }, loc);
                    expr_var_decls.push(G::Decl {
                        binding,
                        value: None,
                    });
                }
                let key_loc = prop.key.expect("infallible: prop has key").loc;
                pre_eval_stmts.push(p.var_decl(key_ref, prop.key, loc));
                prop.key = Some(p.use_ref(key_ref, key_loc));
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
                let rk = RewriteKind::ReplaceRef {
                    old: class_name_ref,
                    new: replacement_ref,
                };
                for pre_stmt in pre_eval_stmts.iter_mut() {
                    if let js_ast::StmtData::SLocal(local) = &mut pre_stmt.data {
                        for decl in local.decls.slice_mut() {
                            if let Some(v) = &mut decl.value {
                                p.rewrite_expr(v, rk);
                            }
                        }
                    }
                }
            }
        }

        // For named class expressions: swap to expr_class_ref for suffix ops
        let mut original_class_name_for_decorator: Option<&'a [u8]> = None;
        if is_expr && !expr_class_is_anonymous && expr_class_ref.is_some() {
            // SAFETY: see above.
            original_class_name_for_decorator = Some(
                p.symbols[class_name_ref.inner_index() as usize]
                    .original_name
                    .slice(),
            );
            class_name_ref = expr_class_ref.unwrap();
            class_name_loc = loc;
        }

        // ── Phase 3: __decoratorStart + base decls ───────
        let init_start_expr: Expr = {
            let base_expr = if let Some(br) = base_ref {
                p.new_expr(
                    E::Identifier {
                        ref_: br,
                        ..Default::default()
                    },
                    loc,
                )
            } else {
                p.new_expr(E::Undefined {}, loc)
            };
            p.call_rt(loc, b"__decoratorStart", &[base_expr])
        };

        let mut base_decl_stmt: Stmt = Stmt::empty();
        if !is_expr {
            if let Some(br) = base_ref {
                base_decl_stmt = p.var_decl(br, class.extends, loc);
            }
        }

        let base_assign_expr: Option<Expr> = if is_expr && base_ref.is_some() {
            Some(p.assign_to(base_ref.unwrap(), class.extends.unwrap(), loc))
        } else {
            None
        };

        if let Some(br) = base_ref {
            class.extends = Some(p.use_ref(br, loc));
        }

        let init_decl_stmt: Stmt = if !is_expr {
            p.var_decl(init_ref, Some(init_start_expr), loc)
        } else {
            Stmt::empty()
        };

        // ── Phase 4: Property loop ───────────────────────
        let mut suffix_exprs = BumpVec::<Expr>::new_in(bump);
        let mut constructor_inject_stmts = BumpVec::<Stmt>::new_in(bump);
        let mut new_properties = BumpVec::<Property>::new_in(bump);
        let mut static_non_field_elements = BumpVec::<Expr>::new_in(bump);
        let mut instance_non_field_elements = BumpVec::<Expr>::new_in(bump);
        let mut has_static_private_methods = false;
        let mut has_instance_private_methods = false;
        let mut static_field_decorate = BumpVec::<Expr>::new_in(bump);
        let mut instance_field_decorate = BumpVec::<Expr>::new_in(bump);
        let mut static_accessor_count: usize = 0;
        let mut instance_accessor_count: usize = 0;
        let mut static_init_entries = BumpVec::<FieldInitEntry>::new_in(bump);
        let mut instance_init_entries = BumpVec::<FieldInitEntry>::new_in(bump);
        let mut static_element_order = BumpVec::<StaticElement>::new_in(bump);
        let mut extracted_static_blocks =
            BumpVec::<js_ast::StoreRef<G::ClassStaticBlock>>::new_in(bump);
        let mut prefix_stmts = BumpVec::<Stmt>::new_in(bump);
        let mut private_lowered_map: PrivateLoweredMap = PrivateLoweredMap::default();
        let mut accessor_storage_counter: usize = 0;
        let mut emitted_private_adds: HashMap<u32, ()> = HashMap::default();
        let mut static_private_add_blocks = BumpVec::<Property>::new_in(bump);

        // Pre-scan: determine if all private members need lowering
        let mut lower_all_private = false;
        {
            let mut has_any_private = false;
            let mut has_any_decorated = false;
            let cprops: &[Property] = class.properties.slice();
            for cprop in cprops.iter() {
                if cprop.kind == PropertyKind::ClassStaticBlock {
                    continue;
                }
                if cprop.ts_decorators.len_u32() > 0 {
                    has_any_decorated = true;
                    if cprop.key.is_some()
                        && matches!(
                            cprop.key.unwrap().data,
                            js_ast::ExprData::EPrivateIdentifier(_)
                        )
                    {
                        lower_all_private = true;
                        break;
                    }
                }
                if cprop.key.is_some()
                    && matches!(
                        cprop.key.unwrap().data,
                        js_ast::ExprData::EPrivateIdentifier(_)
                    )
                {
                    has_any_private = true;
                }
            }
            if !lower_all_private && has_any_private && has_any_decorated {
                lower_all_private = true;
            }
        }

        let props_slice2: &mut [Property] = class.properties.slice_mut();
        for (prop_idx, prop) in props_slice2.iter_mut().enumerate() {
            if prop.ts_decorators.len_u32() == 0 {
                // ── Non-decorated property ──
                if lower_all_private
                    && prop.key.is_some()
                    && matches!(
                        prop.key.expect("infallible: prop has key").data,
                        js_ast::ExprData::EPrivateIdentifier(_)
                    )
                    && prop.kind != PropertyKind::ClassStaticBlock
                    && prop.kind != PropertyKind::AutoAccessor
                {
                    let nk_expr = prop.key.expect("infallible: prop has key");
                    let npriv_ref = match &nk_expr.data {
                        js_ast::ExprData::EPrivateIdentifier(pi) => pi.ref_,
                        _ => unreachable!(),
                    };
                    let npriv_inner = npriv_ref.inner_index();
                    // SAFETY: arena-owned.
                    let npriv_orig: &'a [u8] =
                        p.symbols[npriv_inner as usize].original_name.slice();

                    if prop.flags.contains(Flags::Property::IsMethod) {
                        // Non-decorated private method/getter/setter → WeakSet + fn extraction
                        let nk = Self::method_kind(prop);
                        let existing = private_lowered_map.get(&npriv_inner).copied();
                        let ws_ref = if let Some(ex) = existing {
                            ex.storage_ref
                        } else {
                            let nm = p.bump_name2(b"_", &npriv_orig[1..]);
                            p.new_sym(js_ast::symbol::Kind::Other, nm)
                        };
                        let fn_nm = {
                            let mut v = BumpVec::<u8>::new_in(bump);
                            v.push(b'_');
                            v.extend_from_slice(&npriv_orig[1..]);
                            v.extend_from_slice(Self::fn_suffix(nk));
                            v.into_bump_slice()
                        };
                        let fn_ref = p.new_sym(js_ast::symbol::Kind::Other, fn_nm);

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
                            let wse = p.new_weak_set_expr(loc);
                            prefix_stmts.push(p.var_decl2(ws_ref, Some(wse), fn_ref, None, loc));
                        } else {
                            prefix_stmts.push(p.var_decl(fn_ref, None, loc));
                        }

                        // Assign function: _fn = function() { ... }
                        let val = prop
                            .value
                            .unwrap_or_else(|| p.new_expr(E::Undefined {}, loc));
                        let assign = p.assign_to(fn_ref, val, loc);
                        prefix_stmts.push(p.s(
                            S::SExpr {
                                value: assign,
                                ..Default::default()
                            },
                            loc,
                        ));

                        // __privateAdd (once per name)
                        if !emitted_private_adds.contains_key(&npriv_inner) {
                            emitted_private_adds.insert(npriv_inner, ());
                            p.emit_private_add(
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
                        let wm_nm = p.bump_name2(b"_", &npriv_orig[1..]);
                        let wm_ref = p.new_sym(js_ast::symbol::Kind::Other, wm_nm);
                        private_lowered_map.insert(npriv_inner, PrivateLoweredInfo::new(wm_ref));
                        let wme = p.new_weak_map_expr(loc);
                        prefix_stmts.push(p.var_decl(wm_ref, Some(wme), loc));

                        let init_val = prop
                            .initializer
                            .unwrap_or_else(|| p.new_expr(E::Undefined {}, loc));
                        let this_e = p.new_expr(E::This {}, loc);
                        let wm_e = p.use_ref(wm_ref, loc);
                        let call = p.call_rt(loc, b"__privateAdd", &[this_e, wm_e, init_val]);
                        if !prop.flags.contains(Flags::Property::IsStatic) {
                            constructor_inject_stmts.push(p.s(
                                S::SExpr {
                                    value: call,
                                    ..Default::default()
                                },
                                loc,
                            ));
                        } else {
                            static_private_add_blocks.push(p.make_static_block(call, loc));
                        }
                        continue;
                    }
                }
                // Undecorated auto-accessor → WeakMap + getter/setter
                if prop.kind == PropertyKind::AutoAccessor {
                    let accessor_name: &'a [u8] = 'brk: {
                        if let Some(k) = prop.key {
                            if let js_ast::ExprData::EString(s) = &k.data {
                                break 'brk p.bump_name2(b"_", &s.data);
                            }
                        }
                        let name =
                            p.bump_name(b"_accessor_storage", Some(accessor_storage_counter));
                        accessor_storage_counter += 1;
                        name
                    };
                    let wm_ref = p.new_sym(js_ast::symbol::Kind::Other, accessor_name);
                    let wme = p.new_weak_map_expr(loc);
                    prefix_stmts.push(p.var_decl(wm_ref, Some(wme), loc));

                    // Getter: get foo() { return __privateGet(this, _foo); }
                    let this_e = p.new_expr(E::This {}, loc);
                    let wm_e = p.use_ref(wm_ref, loc);
                    let get_ret = p.call_rt(loc, b"__privateGet", &[this_e, wm_e]);
                    let get_body = bump.alloc_slice_copy(&[p.s(
                        S::Return {
                            value: Some(get_ret),
                        },
                        loc,
                    )]);
                    let get_fn = G::Fn {
                        body: G::FnBody {
                            stmts: bun_ast::StoreSlice::new_mut(get_body),
                            loc,
                        },
                        ..Default::default()
                    };

                    // Setter: set foo(v) { __privateSet(this, _foo, v); }
                    let setter_param_ref = p.new_sym(js_ast::symbol::Kind::Other, b"v");
                    let this_e2 = p.new_expr(E::This {}, loc);
                    let wm_e2 = p.use_ref(wm_ref, loc);
                    let v_e = p.use_ref(setter_param_ref, loc);
                    let set_call = p.call_rt(loc, b"__privateSet", &[this_e2, wm_e2, v_e]);
                    let set_body = bump.alloc_slice_copy(&[p.s(
                        S::SExpr {
                            value: set_call,
                            ..Default::default()
                        },
                        loc,
                    )]);
                    let setter_binding = p.b(
                        B::Identifier {
                            r#ref: setter_param_ref,
                        },
                        loc,
                    );
                    let setter_fn_args = bump.alloc(G::Arg {
                        binding: setter_binding,
                        ..Default::default()
                    });
                    let set_fn = G::Fn {
                        args: bun_ast::StoreSlice::new_mut(core::slice::from_mut(setter_fn_args)),
                        body: G::FnBody {
                            stmts: bun_ast::StoreSlice::new_mut(set_body),
                            loc,
                        },
                        ..Default::default()
                    };

                    let mut getter_flags = prop.flags;
                    getter_flags.insert(Flags::Property::IsMethod);
                    new_properties.push(Property {
                        key: prop.key,
                        value: Some(p.new_expr(E::Function { func: get_fn }, loc)),
                        kind: PropertyKind::Get,
                        flags: getter_flags,
                        ..Default::default()
                    });
                    new_properties.push(Property {
                        key: prop.key,
                        value: Some(p.new_expr(E::Function { func: set_fn }, loc)),
                        kind: PropertyKind::Set,
                        flags: getter_flags,
                        ..Default::default()
                    });

                    let init_val = prop
                        .initializer
                        .unwrap_or_else(|| p.new_expr(E::Undefined {}, loc));
                    if !prop.flags.contains(Flags::Property::IsStatic) {
                        let this_e3 = p.new_expr(E::This {}, loc);
                        let wm_e3 = p.use_ref(wm_ref, loc);
                        let call = p.call_rt(loc, b"__privateAdd", &[this_e3, wm_e3, init_val]);
                        constructor_inject_stmts.push(p.s(
                            S::SExpr {
                                value: call,
                                ..Default::default()
                            },
                            loc,
                        ));
                    } else {
                        let cn_e = p.use_ref(class_name_ref, class_name_loc);
                        let wm_e3 = p.use_ref(wm_ref, loc);
                        suffix_exprs.push(p.call_rt(
                            loc,
                            b"__privateAdd",
                            &[cn_e, wm_e3, init_val],
                        ));
                    }
                    continue;
                }
                // Static blocks → extract to suffix
                if prop.kind == PropertyKind::ClassStaticBlock {
                    if let Some(sb) = prop.class_static_block {
                        static_element_order.push(StaticElement {
                            kind: StaticElementKind::Block,
                            index: extracted_static_blocks.len(),
                        });
                        extracted_static_blocks.push(sb);
                    }
                    continue;
                }
                new_properties.push(prop_full_copy(prop));
                continue;
            }

            // ── Decorated property ──
            let mut flags: f64;
            if prop.flags.contains(Flags::Property::IsMethod) {
                flags = match prop.kind {
                    PropertyKind::Get => 2.0,
                    PropertyKind::Set => 3.0,
                    _ => 1.0,
                };
            } else {
                flags = match prop.kind {
                    PropertyKind::AutoAccessor => 4.0,
                    _ => 5.0,
                };
            }
            if prop.flags.contains(Flags::Property::IsStatic) {
                flags += 8.0;
            }
            let key_expr = prop.key.expect("infallible: prop has key");
            let is_private = matches!(key_expr.data, js_ast::ExprData::EPrivateIdentifier(_));
            if is_private {
                flags += 16.0;
            }

            let decorator_array = if let Some(dec_ref) = prop_dec_refs.get(&prop_idx).copied() {
                p.use_ref(dec_ref, loc)
            } else {
                // SAFETY: shallow-reborrow arena Vec.
                let items: ExprNodeList = unsafe { core::ptr::read(&raw const prop.ts_decorators) };
                p.new_expr(
                    E::Array {
                        items,
                        ..Default::default()
                    },
                    loc,
                )
            };

            let k = (flags as u8) & 7;

            let mut dec_arg_count: usize = 5;
            let mut private_storage_ref: Option<Ref> = None;
            let mut private_extra_ref: Option<Ref> = None;
            let mut private_method_fn_ref: Option<Ref> = None;

            if is_private {
                let priv_ref = match &key_expr.data {
                    js_ast::ExprData::EPrivateIdentifier(pi) => pi.ref_,
                    _ => unreachable!(),
                };
                let priv_inner = priv_ref.inner_index();
                // SAFETY: arena-owned.
                let private_orig: &'a [u8] = p.symbols[priv_inner as usize].original_name.slice();

                if (1..=3).contains(&k) {
                    let existing = private_lowered_map.get(&priv_inner).copied();
                    let ws_ref = if let Some(ex) = existing {
                        ex.storage_ref
                    } else {
                        let nm = p.bump_name2(b"_", &private_orig[1..]);
                        p.new_sym(js_ast::symbol::Kind::Other, nm)
                    };
                    private_storage_ref = Some(ws_ref);
                    let fn_nm = {
                        let mut v = BumpVec::<u8>::new_in(bump);
                        v.push(b'_');
                        v.extend_from_slice(&private_orig[1..]);
                        v.extend_from_slice(Self::fn_suffix(k));
                        v.into_bump_slice()
                    };
                    let fn_ref = p.new_sym(js_ast::symbol::Kind::Other, fn_nm);
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
                        let wse = p.new_weak_set_expr(loc);
                        prefix_stmts.push(p.var_decl2(ws_ref, Some(wse), fn_ref, None, loc));
                    } else {
                        prefix_stmts.push(p.var_decl(fn_ref, None, loc));
                    }
                    dec_arg_count = 6;
                } else if k == 5 {
                    let nm = p.bump_name2(b"_", &private_orig[1..]);
                    let wm_ref = p.new_sym(js_ast::symbol::Kind::Other, nm);
                    private_storage_ref = Some(wm_ref);
                    private_lowered_map.insert(priv_inner, PrivateLoweredInfo::new(wm_ref));
                    let wme = p.new_weak_map_expr(loc);
                    prefix_stmts.push(p.var_decl(wm_ref, Some(wme), loc));
                    dec_arg_count = 5;
                } else if k == 4 {
                    let nm = p.bump_name2(b"_", &private_orig[1..]);
                    let wm_ref = p.new_sym(js_ast::symbol::Kind::Other, nm);
                    private_storage_ref = Some(wm_ref);
                    let acc_nm = {
                        let mut v = BumpVec::<u8>::new_in(bump);
                        v.push(b'_');
                        v.extend_from_slice(&private_orig[1..]);
                        v.extend_from_slice(b"_acc");
                        v.into_bump_slice()
                    };
                    let acc_ref = p.new_sym(js_ast::symbol::Kind::Other, acc_nm);
                    private_method_fn_ref = Some(acc_ref);
                    private_lowered_map.insert(
                        priv_inner,
                        PrivateLoweredInfo {
                            storage_ref: wm_ref,
                            method_fn_ref: None,
                            getter_fn_ref: None,
                            setter_fn_ref: None,
                            accessor_desc_ref: Some(acc_ref),
                        },
                    );
                    let wme = p.new_weak_map_expr(loc);
                    prefix_stmts.push(p.var_decl2(wm_ref, Some(wme), acc_ref, None, loc));
                    dec_arg_count = 6;
                }
            } else if k == 4 {
                // Decorated public auto-accessor → WeakMap
                let accessor_name: &'a [u8] = 'brk: {
                    if let js_ast::ExprData::EString(s) = &key_expr.data {
                        break 'brk p.bump_name2(b"_", &s.data);
                    }
                    let name = p.bump_name(b"_accessor_storage", Some(accessor_storage_counter));
                    accessor_storage_counter += 1;
                    name
                };
                let wm_ref = p.new_sym(js_ast::symbol::Kind::Other, accessor_name);
                private_extra_ref = Some(wm_ref);
                let wme = p.new_weak_map_expr(loc);
                prefix_stmts.push(p.var_decl(wm_ref, Some(wme), loc));
                dec_arg_count = 6;
            }

            // Build __decorateElement args
            let target_ref = if is_expr && expr_class_ref.is_some() {
                expr_class_ref.unwrap()
            } else {
                class_name_ref
            };
            let mut dec_args = BumpVec::with_capacity_in(dec_arg_count, bump);
            dec_args.push(p.new_expr(
                E::Identifier {
                    ref_: init_ref,
                    ..Default::default()
                },
                loc,
            ));
            dec_args.push(p.new_expr(E::Number { value: flags }, loc));
            dec_args.push(if is_private {
                let priv_ref = match &key_expr.data {
                    js_ast::ExprData::EPrivateIdentifier(pi) => pi.ref_,
                    _ => unreachable!(),
                };
                // `original_name` is an arena-owned `StoreStr`.
                let priv_name = E::Str::new(
                    p.symbols[priv_ref.inner_index() as usize]
                        .original_name
                        .slice(),
                );
                p.new_expr(
                    E::EString {
                        data: priv_name,
                        ..Default::default()
                    },
                    loc,
                )
            } else {
                key_expr
            });
            dec_args.push(decorator_array);

            if is_private && private_storage_ref.is_some() {
                dec_args.push(p.use_ref(private_storage_ref.unwrap(), loc));
                if dec_arg_count == 6 {
                    if (1..=3).contains(&k) {
                        dec_args.push(
                            prop.value
                                .unwrap_or_else(|| p.new_expr(E::Undefined {}, loc)),
                        );
                    } else if k == 4 {
                        dec_args.push(p.use_ref(private_storage_ref.unwrap(), loc));
                    } else {
                        dec_args.push(p.new_expr(E::Undefined {}, loc));
                    }
                }
            } else {
                p.record_usage(target_ref);
                dec_args.push(p.new_expr(
                    E::Identifier {
                        ref_: target_ref,
                        ..Default::default()
                    },
                    class_name_loc,
                ));
                if dec_arg_count == 6 {
                    if let Some(extra_ref) = private_extra_ref {
                        dec_args.push(p.use_ref(extra_ref, loc));
                    } else {
                        dec_args.push(p.new_expr(E::Undefined {}, loc));
                    }
                }
            }

            let dec_args_list = ExprNodeList::from_bump_vec(dec_args);
            let raw_element = p.call_runtime(loc, b"__decorateElement", dec_args_list);
            let element = if let Some(fn_ref) = private_method_fn_ref {
                p.assign_to(fn_ref, raw_element, loc)
            } else {
                raw_element
            };

            // Categorize the element
            if k >= 4 {
                let mut prop_shallow = prop_copy(prop);
                if is_private {
                    if let Some(ps_ref) = private_storage_ref {
                        prop_shallow.key = Some(p.new_expr(
                            E::Identifier {
                                ref_: ps_ref,
                                ..Default::default()
                            },
                            loc,
                        ));
                    }
                }
                if let Some(pe_ref) = private_extra_ref {
                    prop_shallow.value = Some(p.new_expr(
                        E::Identifier {
                            ref_: pe_ref,
                            ..Default::default()
                        },
                        loc,
                    ));
                }

                let is_accessor = k == 4;
                let init_entry = FieldInitEntry {
                    prop: prop_shallow,
                    is_private,
                    is_accessor,
                };

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
                let priv_inner2 = match &key_expr.data {
                    js_ast::ExprData::EPrivateIdentifier(pi) => pi.ref_.inner_index(),
                    _ => unreachable!(),
                };
                if !emitted_private_adds.contains_key(&priv_inner2) {
                    emitted_private_adds.insert(priv_inner2, ());
                    p.emit_private_add(
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
                let mut new_prop = prop_copy(prop);
                new_properties.push(new_prop);
                if prop.flags.contains(Flags::Property::IsStatic) {
                    static_non_field_elements.push(element);
                } else {
                    instance_non_field_elements.push(element);
                }
            }
        }

        // ── Phase 5: Rewrite private accesses ────────────
        if !private_lowered_map.is_empty() {
            for nprop in new_properties.iter_mut() {
                if let Some(v) = &mut nprop.value {
                    p.rewrite_private_accesses_in_expr(v, &private_lowered_map);
                }
                if let Some(sb) = nprop.class_static_block_mut() {
                    p.rewrite_private_accesses_in_stmts(sb.stmts.slice_mut(), &private_lowered_map);
                }
            }
            for entry in instance_init_entries.iter_mut() {
                if let Some(ini) = &mut entry.prop.initializer {
                    p.rewrite_private_accesses_in_expr(ini, &private_lowered_map);
                }
            }
            for entry in static_init_entries.iter_mut() {
                if let Some(ini) = &mut entry.prop.initializer {
                    p.rewrite_private_accesses_in_expr(ini, &private_lowered_map);
                }
            }
            for sb_ptr in extracted_static_blocks.iter_mut() {
                // `StoreRef::DerefMut` — arena-owned, safe under the StoreRef invariant.
                let sb = &mut **sb_ptr;
                p.rewrite_private_accesses_in_stmts(sb.stmts.slice_mut(), &private_lowered_map);
            }
            for elem in static_non_field_elements.iter_mut() {
                p.rewrite_private_accesses_in_expr(elem, &private_lowered_map);
            }
            for elem in instance_non_field_elements.iter_mut() {
                p.rewrite_private_accesses_in_expr(elem, &private_lowered_map);
            }
            for elem in static_field_decorate.iter_mut() {
                p.rewrite_private_accesses_in_expr(elem, &private_lowered_map);
            }
            for elem in instance_field_decorate.iter_mut() {
                p.rewrite_private_accesses_in_expr(elem, &private_lowered_map);
            }
            p.rewrite_private_accesses_in_stmts(&mut pre_eval_stmts, &private_lowered_map);
            p.rewrite_private_accesses_in_stmts(&mut prefix_stmts, &private_lowered_map);
        }

        // ── Phase 6: Emit suffix ─────────────────────────
        let static_field_count = static_field_decorate.len();
        let total_accessor_count = static_accessor_count + instance_accessor_count;
        let static_field_base_idx = total_accessor_count;
        let instance_accessor_base_idx = static_accessor_count;
        let instance_field_base_idx = total_accessor_count + static_field_count;

        suffix_exprs.extend_from_slice(&static_non_field_elements);
        suffix_exprs.extend_from_slice(&instance_non_field_elements);
        suffix_exprs.extend_from_slice(&static_field_decorate);
        suffix_exprs.extend_from_slice(&instance_field_decorate);

        // 5: Class decorator
        if class_decorators_len > 0 {
            p.record_usage(class_name_ref);
            let class_name_str: E::Str = if let Some(name) = original_class_name_for_decorator {
                name.into()
            } else if is_expr && expr_class_is_anonymous {
                name_from_context.unwrap_or(b"").into()
            } else {
                // `original_name` is an arena-owned `StoreStr`.
                E::Str::new(
                    p.symbols[class_name_ref.inner_index() as usize]
                        .original_name
                        .slice(),
                )
            };

            let mut cls_dec_args = BumpVec::with_capacity_in(5, bump);
            cls_dec_args.push(p.new_expr(
                E::Identifier {
                    ref_: init_ref,
                    ..Default::default()
                },
                loc,
            ));
            cls_dec_args.push(p.new_expr(E::Number { value: 0.0 }, loc));
            cls_dec_args.push(p.new_expr(
                E::EString {
                    data: class_name_str.into(),
                    ..Default::default()
                },
                loc,
            ));
            cls_dec_args.push(if let Some(cdr) = class_dec_ref {
                p.use_ref(cdr, loc)
            } else {
                // `class_dec_ref` is `None` ⇒ `class_decorators_len == 0`, so
                // this is an empty list. Still `take` (not `ptr::read`) so the
                // local can never own a second copy of a live buffer.
                let items = bun_alloc::AstAlloc::take(&mut class_decorators);
                p.new_expr(
                    E::Array {
                        items,
                        ..Default::default()
                    },
                    loc,
                )
            });
            cls_dec_args.push(if is_expr {
                p.use_ref(expr_class_ref.unwrap(), loc)
            } else {
                p.new_expr(
                    E::Identifier {
                        ref_: class_name_ref,
                        ..Default::default()
                    },
                    class_name_loc,
                )
            });

            let cls_dec_list = ExprNodeList::from_bump_vec(cls_dec_args);
            let dec_call = p.call_runtime(loc, b"__decorateElement", cls_dec_list);
            suffix_exprs.push(p.assign_to(class_name_ref, dec_call, class_name_loc));
        }

        // 6: Static method extra initializers
        if !static_non_field_elements.is_empty() || has_static_private_methods {
            let i_e = p.use_ref(init_ref, loc);
            let n_e = p.new_expr(E::Number { value: 3.0 }, loc);
            let c_e = p.use_ref(class_name_ref, class_name_loc);
            suffix_exprs.push(p.call_rt(loc, b"__runInitializers", &[i_e, n_e, c_e]));
        }

        // 7: Static elements in source order
        {
            let mut s_accessor_idx: usize = 0;
            let mut s_field_idx: usize = 0;
            for elem in static_element_order.iter() {
                match elem.kind {
                    StaticElementKind::Block => {
                        // `StoreRef::DerefMut` — arena-owned, safe under the StoreRef invariant.
                        let sb = &mut *extracted_static_blocks[elem.index];
                        let stmts_slice = sb.stmts.slice_mut();
                        p.rewrite_stmts(
                            stmts_slice,
                            RewriteKind::ReplaceThis {
                                ref_: class_name_ref,
                                loc: class_name_loc,
                            },
                        );

                        let all_exprs = stmts_slice
                            .iter()
                            .all(|s| matches!(s.data, js_ast::StmtData::SExpr(_)));

                        if all_exprs {
                            for sb_stmt in stmts_slice.iter() {
                                match &sb_stmt.data {
                                    js_ast::StmtData::SExpr(s) => suffix_exprs.push(s.value),
                                    _ => unreachable!(),
                                }
                            }
                        } else {
                            // Wrap in IIFE
                            let stmts_ptr = bun_ast::StoreSlice::new_mut(stmts_slice);
                            let iife_body = p.new_expr(
                                E::Arrow {
                                    body: G::FnBody {
                                        loc,
                                        stmts: stmts_ptr,
                                    },
                                    is_async: false,
                                    ..Default::default()
                                },
                                loc,
                            );
                            suffix_exprs.push(p.new_expr(
                                E::Call {
                                    target: iife_body,
                                    args: bun_alloc::AstAlloc::vec(),
                                    ..Default::default()
                                },
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

                        let mut run_args = BumpVec::with_capacity_in(4, bump);
                        run_args.push(p.use_ref(init_ref, loc));
                        run_args.push(p.new_expr(
                            E::Number {
                                value: Self::init_flag(field_idx),
                            },
                            loc,
                        ));
                        run_args.push(p.use_ref(class_name_ref, class_name_loc));
                        if let Some(init_val) = entry.prop.initializer {
                            run_args.push(init_val);
                        }
                        let run_args_list = ExprNodeList::from_bump_vec(run_args);
                        let run_init_call =
                            p.call_runtime(loc, b"__runInitializers", run_args_list);

                        if entry.is_accessor || entry.is_private {
                            let wm_ref_expr = if entry.is_accessor && !entry.is_private {
                                entry.prop.value.expect("infallible: prop has value")
                            } else {
                                entry.prop.key.expect("infallible: prop has key")
                            };
                            let cn_e = p.use_ref(class_name_ref, class_name_loc);
                            suffix_exprs.push(p.call_rt(
                                loc,
                                b"__privateAdd",
                                &[cn_e, wm_ref_expr, run_init_call],
                            ));
                        } else {
                            let cn_e = p.use_ref(class_name_ref, class_name_loc);
                            let assign_target = p.member_target(cn_e, &entry.prop);
                            suffix_exprs.push(Expr::assign(assign_target, run_init_call));
                        }

                        // Extra initializer
                        let i_e = p.use_ref(init_ref, loc);
                        let n_e = p.new_expr(
                            E::Number {
                                value: Self::extra_init_flag(field_idx),
                            },
                            loc,
                        );
                        let c_e = p.use_ref(class_name_ref, class_name_loc);
                        suffix_exprs.push(p.call_rt(loc, b"__runInitializers", &[i_e, n_e, c_e]));
                    }
                }
            }
        }

        // 8: Class extra initializers
        if class_decorators_len > 0 {
            let i_e = p.use_ref(init_ref, loc);
            let n_e = p.new_expr(E::Number { value: 1.0 }, loc);
            let c_e = p.use_ref(class_name_ref, class_name_loc);
            suffix_exprs.push(p.call_rt(loc, b"__runInitializers", &[i_e, n_e, c_e]));
        }

        // 9: __decoratorMetadata
        {
            let i_e = p.use_ref(init_ref, loc);
            let c_e = p.use_ref(class_name_ref, class_name_loc);
            suffix_exprs.push(p.call_rt(loc, b"__decoratorMetadata", &[i_e, c_e]));
        }

        // ── Phase 7: Constructor injection ───────────────
        if !instance_non_field_elements.is_empty() || has_instance_private_methods {
            let i_e = p.use_ref(init_ref, loc);
            let n_e = p.new_expr(E::Number { value: 5.0 }, loc);
            let t_e = p.new_expr(E::This {}, loc);
            let call = p.call_rt(loc, b"__runInitializers", &[i_e, n_e, t_e]);
            constructor_inject_stmts.push(p.s(
                S::SExpr {
                    value: call,
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

                let mut run_args = BumpVec::with_capacity_in(4, bump);
                run_args.push(p.use_ref(init_ref, loc));
                run_args.push(p.new_expr(
                    E::Number {
                        value: Self::init_flag(field_idx),
                    },
                    loc,
                ));
                run_args.push(p.new_expr(E::This {}, loc));
                if let Some(init_val) = entry.prop.initializer {
                    run_args.push(init_val);
                }
                let run_args_list = ExprNodeList::from_bump_vec(run_args);
                let run_init_call = p.call_runtime(loc, b"__runInitializers", run_args_list);

                if entry.is_accessor || entry.is_private {
                    let wm_ref_expr = if entry.is_accessor && !entry.is_private {
                        entry.prop.value.expect("infallible: prop has value")
                    } else {
                        entry.prop.key.expect("infallible: prop has key")
                    };
                    let t_e = p.new_expr(E::This {}, loc);
                    let call = p.call_rt(loc, b"__privateAdd", &[t_e, wm_ref_expr, run_init_call]);
                    constructor_inject_stmts.push(p.s(
                        S::SExpr {
                            value: call,
                            ..Default::default()
                        },
                        loc,
                    ));
                } else {
                    let t_e = p.new_expr(E::This {}, loc);
                    let mt = p.member_target(t_e, &entry.prop);
                    constructor_inject_stmts.push(Stmt::assign(mt, run_init_call));
                }

                // Extra initializer
                let i_e = p.use_ref(init_ref, loc);
                let n_e = p.new_expr(
                    E::Number {
                        value: Self::extra_init_flag(field_idx),
                    },
                    loc,
                );
                let t_e = p.new_expr(E::This {}, loc);
                let call = p.call_rt(loc, b"__runInitializers", &[i_e, n_e, t_e]);
                constructor_inject_stmts.push(p.s(
                    S::SExpr {
                        value: call,
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
                if !nprop.flags.contains(Flags::Property::IsMethod) || nprop.key.is_none() {
                    continue;
                }
                let is_ctor = match &nprop.key.unwrap().data {
                    js_ast::ExprData::EString(s) => s.eql_comptime(b"constructor"),
                    _ => false,
                };
                if !is_ctor {
                    continue;
                }
                let func = match &mut nprop.value.as_mut().unwrap().data {
                    js_ast::ExprData::EFunction(f) => &mut **f,
                    _ => unreachable!(),
                };
                let body_slice: &[Stmt] = func.func.body.stmts.slice();
                let mut body_stmts = BumpVec::<Stmt>::with_capacity_in(
                    body_slice.len() + constructor_inject_stmts.len(),
                    bump,
                );
                body_stmts.extend_from_slice(body_slice);
                let mut super_index: Option<usize> = None;
                for (index, item) in body_stmts.iter().enumerate() {
                    let js_ast::StmtData::SExpr(se) = &item.data else {
                        continue;
                    };
                    let js_ast::ExprData::ECall(call) = &se.value.data else {
                        continue;
                    };
                    if !matches!(call.target.data, js_ast::ExprData::ESuper(_)) {
                        continue;
                    }
                    super_index = Some(index);
                    break;
                }
                let insert_at = if let Some(j) = super_index { j + 1 } else { 0 };
                // PORT NOTE: BumpVec has no `splice`; rebuild.
                let mut spliced = BumpVec::<Stmt>::with_capacity_in(
                    body_stmts.len() + constructor_inject_stmts.len(),
                    bump,
                );
                spliced.extend_from_slice(&body_stmts[..insert_at]);
                spliced.extend_from_slice(&constructor_inject_stmts);
                spliced.extend_from_slice(&body_stmts[insert_at..]);
                func.func.body.stmts = bun_ast::StoreSlice::new_mut(spliced.into_bump_slice_mut());
                found_constructor = true;
                break;
            }

            if !found_constructor {
                let mut ctor_stmts = BumpVec::<Stmt>::new_in(bump);
                if class.extends.is_some() {
                    let target = p.new_expr(E::Super {}, loc);
                    let args_ref = p.new_sym(js_ast::symbol::Kind::Unbound, arguments_str);
                    let inner = p.new_expr(
                        E::Identifier {
                            ref_: args_ref,
                            ..Default::default()
                        },
                        loc,
                    );
                    let spread = p.new_expr(E::Spread { value: inner }, loc);
                    let arg_slice = bump.alloc_slice_copy(&[spread]);
                    let call_args = ExprNodeList::from_arena_slice(arg_slice);
                    let call = p.new_expr(
                        E::Call {
                            target,
                            args: call_args,
                            ..Default::default()
                        },
                        loc,
                    );
                    ctor_stmts.push(p.s(
                        S::SExpr {
                            value: call,
                            ..Default::default()
                        },
                        loc,
                    ));
                }
                ctor_stmts.extend_from_slice(&constructor_inject_stmts);
                let ctor_body_ptr = bun_ast::StoreSlice::new_mut(ctor_stmts.into_bump_slice_mut());
                let func = G::Fn {
                    name: None,
                    open_parens_loc: bun_ast::Loc::EMPTY,
                    args: bun_ast::StoreSlice::EMPTY,
                    body: G::FnBody {
                        loc,
                        stmts: ctor_body_ptr,
                    },
                    ..Default::default()
                };
                let value = Some(p.new_expr(E::Function { func }, loc));
                let key = Some(p.new_expr(
                    E::EString {
                        data: b"constructor".into(),
                        ..Default::default()
                    },
                    loc,
                ));
                new_properties.insert(
                    0,
                    G::Property {
                        flags: Flags::Property::IsMethod.into(),
                        key,
                        value,
                        ..Default::default()
                    },
                );
            }
        }

        // Static private __privateAdd blocks at beginning
        if !static_private_add_blocks.is_empty() {
            let mut merged = BumpVec::<Property>::with_capacity_in(
                static_private_add_blocks.len() + new_properties.len(),
                bump,
            );
            for sp in static_private_add_blocks.drain(..) {
                merged.push(sp);
            }
            for np in new_properties.drain(..) {
                merged.push(np);
            }
            new_properties = merged;
        }

        class.properties = bun_ast::StoreSlice::new_mut(new_properties.into_bump_slice_mut());
        class.has_decorators = false;
        class.should_lower_standard_decorators = false;

        // ── Phase 8: Assemble output ─────────────────────
        if is_expr {
            let mut comma_parts = BumpVec::<Expr>::new_in(bump);
            if let Some(cda) = class_dec_assign_expr {
                comma_parts.push(cda);
            }
            if let Some(ba) = base_assign_expr {
                comma_parts.push(ba);
            }

            // PORT NOTE: Zig used a local anonymous-struct fn; can't capture
            // `&mut self` in a Rust closure while also calling `p.method()`, so
            // inline both call sites against a `&[Stmt]` slice array.
            for stmts_list in [&pre_eval_stmts[..], &prefix_stmts[..]] {
                for pstmt in stmts_list.iter() {
                    match &pstmt.data {
                        js_ast::StmtData::SExpr(se) => {
                            comma_parts.push(se.value);
                        }
                        js_ast::StmtData::SLocal(local) => {
                            for decl_item in local.decls.slice() {
                                let ref_ = match decl_item.binding.data {
                                    js_ast::b::B::BIdentifier(b) => b.r#ref,
                                    _ => unreachable!(),
                                };
                                let binding = p.b(B::Identifier { r#ref: ref_ }, loc);
                                expr_var_decls.push(G::Decl {
                                    binding,
                                    value: None,
                                });
                                if let Some(val) = decl_item.value {
                                    p.record_usage(ref_);
                                    comma_parts.push(Expr::assign(
                                        p.new_expr(
                                            E::Identifier {
                                                ref_,
                                                ..Default::default()
                                            },
                                            loc,
                                        ),
                                        val,
                                    ));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }

            // _init = __decoratorStart(...)
            comma_parts.push(p.assign_to(init_ref, init_start_expr, loc));

            // _class = class { ... }
            let class_expr = p.new_expr(class_copy(class), loc);
            comma_parts.push(p.assign_to(expr_class_ref.unwrap(), class_expr, loc));

            comma_parts.extend_from_slice(&suffix_exprs);

            // Final value
            let final_ref = if class_decorators_len > 0 {
                class_name_ref
            } else {
                expr_class_ref.unwrap()
            };
            comma_parts.push(p.use_ref(final_ref, loc));

            // Build comma chain
            let mut result = comma_parts[0];
            for part in &comma_parts[1..] {
                result = p.new_expr(
                    E::Binary {
                        op: js_ast::OpCode::BinComma,
                        left: result,
                        right: *part,
                    },
                    loc,
                );
            }

            // Emit var declarations
            if !expr_var_decls.is_empty() {
                let decls = DeclList::from_bump_vec(expr_var_decls);
                let var_decl_stmt = p.s(
                    S::Local {
                        decls,
                        ..Default::default()
                    },
                    loc,
                );
                if let Some(stmt_list) = p.nearest_stmt_list_mut() {
                    stmt_list.push(var_decl_stmt);
                }
            }

            out.push(p.s(
                S::SExpr {
                    value: result,
                    ..Default::default()
                },
                loc,
            ));
            return;
        }

        // Statement mode
        if !matches!(class_dec_stmt.data, js_ast::StmtData::SEmpty(_)) {
            out.push(class_dec_stmt);
        }
        if !matches!(base_decl_stmt.data, js_ast::StmtData::SEmpty(_)) {
            out.push(base_decl_stmt);
        }
        out.extend_from_slice(&pre_eval_stmts);
        out.extend_from_slice(&prefix_stmts);
        out.push(init_decl_stmt);
        out.push(original_stmt.unwrap());
        for expr in suffix_exprs.iter() {
            out.push(p.s(
                S::SExpr {
                    value: *expr,
                    ..Default::default()
                },
                expr.loc,
            ));
        }
        // Inner class binding: let _Foo = Foo
        if !inner_class_ref.eql(class_name_ref) {
            p.record_usage(class_name_ref);
            let binding = p.b(
                B::Identifier {
                    r#ref: inner_class_ref,
                },
                loc,
            );
            let value = Some(p.new_expr(
                E::Identifier {
                    ref_: class_name_ref,
                    ..Default::default()
                },
                class_name_loc,
            ));
            let decls = DeclList::from_slice(&[G::Decl { binding, value }]);
            out.push(p.s(
                S::Local {
                    kind: S::Kind::KLet,
                    decls,
                    ..Default::default()
                },
                loc,
            ));
        }
    }
}

// ported from: src/js_parser/ast/lowerDecorators.zig
