#![allow(clippy::too_many_arguments, clippy::needless_late_init)]
//! Lowering for TC39 standard ES decorators.

use bun_alloc::ArenaVecExt as _;

use bun_collections::{HashMap, VecExt};

use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::{ARGUMENTS_STR as arguments_str, Ref, is_eval_or_arguments};
use bun_ast::g::{DeclList, Property, PropertyKind};
use bun_ast::{self as js_ast, B, E, Expr, ExprNodeList, Flags, G, S, Stmt};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

// Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
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

#[derive(Clone, Copy)]
enum RewriteKind {
    ReplaceRef {
        old: Ref,
        new: Ref,
    },
    ReplaceThis {
        ref_: Ref,
        loc: bun_ast::Loc,
    },
    /// `super.x` in a static context whose home object is the class in `ref_`.
    ReplaceSuper {
        ref_: Ref,
        loc: bun_ast::Loc,
    },
}

// ── Shallow-copy helpers (Property / Class are not `Clone` because they hold
//    raw arena pointers; copying the raw pointers is intentional). ──

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
        // SAFETY: this duplicates ownership of any heap allocation inside
        // `Metadata` (`MDot` owns a global-heap `Vec<Ref>`), but the source
        // `Property` is an arena-resident AST node whose `Drop` never runs
        // (AST stores are bulk-freed without dropping — see the
        // `bun_alloc::ast_alloc` module docs), so at most one of the two
        // copies ever reaches drop glue; no double free.
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

/// Whether a context-inferred name (`export default` → "default", object
/// property keys, assignment targets) can be attached to a lowered anonymous
/// class expression as its syntactic binding name. Class bodies are always
/// strict mode code and the output may be a module, so reserved words
/// ("default", "let", "await", …), `eval`/`arguments`, and non-identifier
/// strings would turn `_class = class <name> {}` into a syntax error.
#[inline]
fn can_be_class_binding_name(name: &[u8]) -> bool {
    js_lexer::is_identifier(name)
        && js_lexer::keyword(name).is_none()
        && !js_lexer::is_strict_mode_reserved_word(name)
        && name != b"await"
        && !is_eval_or_arguments(name)
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

    /// A generated binding for the lowering output (`_init`, `_dec`, the
    /// WeakMap behind `#x`, ...).
    ///
    /// Without a renamer the printer emits `original_name` verbatim, so the
    /// name gets a per-file counter: two decorated classes in one scope must
    /// not share `_init`, and user code may already use `_x`. With a renamer
    /// the symbol is recorded as declared by the current part so the
    /// top-level pass renames collisions.
    fn new_sym(&mut self, kind: js_ast::symbol::Kind, name: &'a [u8]) -> Ref {
        let name: &'a [u8] = if self.will_use_renamer() {
            name
        } else {
            self.temp_ref_count += 1;
            bun_alloc::arena_format!(
                in self.arena,
                "{}${}",
                bstr::BStr::new(name),
                self.temp_ref_count
            )
            .into_bump_str()
            .as_bytes()
        };
        let ref_ = self.new_symbol(kind, name);
        VecExt::append(&mut self.current_scope_mut().generated, ref_);
        self.record_declared_symbol(ref_);
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

    /// `Global.method` for a well-known global like `Reflect.get`.
    fn global_method(
        &mut self,
        global: &'static [u8],
        method: &'static [u8],
        l: bun_ast::Loc,
    ) -> Expr {
        let ref_ = self.find_symbol(l, global).expect("unreachable").r#ref;
        let target = self.new_expr(
            E::Identifier {
                ref_,
                ..Default::default()
            },
            l,
        );
        self.new_expr(
            E::Dot {
                target,
                name: method.into(),
                name_loc: l,
                ..Default::default()
            },
            l,
        )
    }

    /// The key of `super.x` / `super[x]`, if `expr` is one.
    fn super_property_key(&mut self, expr: &Expr) -> Option<Expr> {
        match &expr.data {
            js_ast::ExprData::EDot(d) if matches!(d.target.data, js_ast::ExprData::ESuper(_)) => {
                Some(self.new_expr(E::EString::init(d.name.slice()), d.name_loc))
            }
            js_ast::ExprData::EIndex(i) if matches!(i.target.data, js_ast::ExprData::ESuper(_)) => {
                Some(i.index)
            }
            _ => None,
        }
    }

    /// `Object.getPrototypeOf(C)`: the home object of a static member is the
    /// class, so `super` resolves to the class's prototype.
    fn super_home_proto(&mut self, class_ref: Ref, l: bun_ast::Loc) -> Expr {
        let get_proto = self.global_method(b"Object", b"getPrototypeOf", l);
        let c = self.use_ref(class_ref, l);
        self.new_expr(
            E::Call {
                target: get_proto,
                args: ExprNodeList::from_arena_slice(self.arena.alloc_slice_copy(&[c])),
                ..Default::default()
            },
            l,
        )
    }

    /// `super.key` moved out of the class: `Reflect.get(Object.getPrototypeOf(C), key, C)`.
    fn super_get(&mut self, class_ref: Ref, key: Expr, l: bun_ast::Loc) -> Expr {
        let get = self.global_method(b"Reflect", b"get", l);
        let proto = self.super_home_proto(class_ref, l);
        let receiver = self.use_ref(class_ref, l);
        self.new_expr(
            E::Call {
                target: get,
                args: ExprNodeList::from_arena_slice(
                    self.arena.alloc_slice_copy(&[proto, key, receiver]),
                ),
                ..Default::default()
            },
            l,
        )
    }

    /// `super.key = value` moved out of the class: `Reflect.set(Object.getPrototypeOf(C), key, value, C)`.
    fn super_set(&mut self, class_ref: Ref, key: Expr, value: Expr, l: bun_ast::Loc) -> Expr {
        let set = self.global_method(b"Reflect", b"set", l);
        let proto = self.super_home_proto(class_ref, l);
        let receiver = self.use_ref(class_ref, l);
        self.new_expr(
            E::Call {
                target: set,
                args: ExprNodeList::from_arena_slice(
                    self.arena.alloc_slice_copy(&[proto, key, value, receiver]),
                ),
                ..Default::default()
            },
            l,
        )
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
            // `E::Dot.name` is a UTF-8 `Str`; a UTF-16 `EString.data` stores
            // u16-count bytes that are garbage as UTF-8. Fall through to
            // `E::Index` for UTF-16 keys so the printer emits `["…"]`.
            if s.is_utf8() {
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
            // bumpalo Vec<u8> doesn't impl io::Write; format into a
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
            RewriteKind::ReplaceSuper { ref_, loc } => {
                if let Some(mut key) = self.super_property_key(expr) {
                    self.rewrite_expr(&mut key, kind);
                    *expr = self.super_get(ref_, key, loc);
                    return;
                }
                if let js_ast::ExprData::ECall(call) = &mut expr.data
                    && let Some(mut key) = self.super_property_key(&call.target)
                {
                    // `super.m(...)` => `Reflect.get(proto, "m", C).call(C, ...)`
                    self.rewrite_expr(&mut key, kind);
                    let getter = self.super_get(ref_, key, loc);
                    let call_target = self.new_expr(
                        E::Dot {
                            target: getter,
                            name: b"call".into(),
                            name_loc: loc,
                            ..Default::default()
                        },
                        loc,
                    );
                    let orig_args = call.args.slice_mut();
                    let mut new_args = BumpVec::with_capacity_in(1 + orig_args.len(), self.arena);
                    new_args.push(self.use_ref(ref_, loc));
                    for arg in orig_args.iter_mut() {
                        self.rewrite_expr(arg, kind);
                        new_args.push(*arg);
                    }
                    call.target = call_target;
                    call.args = ExprNodeList::from_bump_vec(new_args);
                    return;
                }
                if let js_ast::ExprData::EBinary(bin) = &mut expr.data
                    && bin.op == js_ast::OpCode::BinAssign
                    && let Some(mut key) = self.super_property_key(&bin.left)
                {
                    self.rewrite_expr(&mut key, kind);
                    let mut value = bin.right;
                    self.rewrite_expr(&mut value, kind);
                    *expr = self.super_set(ref_, key, value, loc);
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
                self.rewrite_expr(&mut e.test, kind);
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
                RewriteKind::ReplaceThis { .. } | RewriteKind::ReplaceSuper { .. } => {}
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
                    let mut t = data.test;
                    self.rewrite_expr(&mut t, kind);
                    data.test = t;
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
                    if let Some(t) = &mut data.test {
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
                    let mut t = data.test;
                    self.rewrite_expr(&mut t, kind);
                    data.test = t;
                    let mut body = data.body;
                    self.rewrite_stmts(core::slice::from_mut(&mut body), kind);
                    data.body = body;
                }
                js_ast::StmtData::SDoWhile(data) => {
                    let mut t = data.test;
                    self.rewrite_expr(&mut t, kind);
                    data.test = t;
                    let mut body = data.body;
                    self.rewrite_stmts(core::slice::from_mut(&mut body), kind);
                    data.body = body;
                }
                js_ast::StmtData::SSwitch(data) => {
                    let mut t = data.test;
                    self.rewrite_expr(&mut t, kind);
                    data.test = t;
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
                    if let Some(c) = &mut data.catch {
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

    fn private_get_expr(&mut self, obj: Expr, info: &PrivateLoweredInfo, l: bun_ast::Loc) -> Expr {
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
        info: &PrivateLoweredInfo,
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

    /// A lowered private access that reads and then writes `obj.#x` names the
    /// receiver twice. Only identifiers and `this` can be repeated safely; any
    /// other receiver is captured in a temporary so its side effects run once
    /// and nested private calls don't duplicate the whole subtree (the
    /// duplication is exponential in the length of a chain like
    /// `o.#m().#m().#m()`). Returns `(first use, later use)`.
    fn capture_private_receiver(&mut self, obj_expr: Expr, l: bun_ast::Loc) -> (Expr, Expr) {
        match &obj_expr.data {
            js_ast::ExprData::EIdentifier(id) => {
                let obj_ref = id.ref_;
                (obj_expr, self.use_ref(obj_ref, obj_expr.loc))
            }
            js_ast::ExprData::EThis(_) => (obj_expr, self.new_expr(E::This {}, obj_expr.loc)),
            _ => {
                let tmp_ref = self.generate_temp_ref(Some(b"_obj"));
                let write = self.assign_to(tmp_ref, obj_expr, l);
                let read = self.use_ref(tmp_ref, l);
                (write, read)
            }
        }
    }

    /// `obj.#x op= value` and `++obj.#x` style updates need the current value
    /// first. Returns the lowered private member if `left` is one.
    fn lowered_private_member(
        left: &Expr,
        map: &PrivateLoweredMap,
    ) -> Option<(Expr, PrivateLoweredInfo)> {
        let js_ast::ExprData::EIndex(idx) = &left.data else {
            return None;
        };
        let js_ast::ExprData::EPrivateIdentifier(pi) = &idx.index.data else {
            return None;
        };
        let info = map.get(&pi.ref_.inner_index()).copied()?;
        Some((idx.target, info))
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
                        *expr = self.private_get_expr(target, &info, expr_loc);
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
                                *expr = self.private_set_expr(lt, &info, rt, expr_loc);
                                return;
                            }
                        }
                    }
                }
                if let Some(base_op) = compound_assign_base_op(e.op)
                    && let Some((obj, info)) = Self::lowered_private_member(&e.left, map)
                {
                    let mut obj = obj;
                    self.rewrite_private_accesses_in_expr(&mut obj, map);
                    // The receiver use that is evaluated first carries the capture.
                    let (first_obj, second_obj) = self.capture_private_receiver(obj, expr_loc);
                    let mut rt = e.right;
                    self.rewrite_private_accesses_in_expr(&mut rt, map);
                    *expr = if matches!(
                        base_op,
                        js_ast::OpCode::BinLogicalAnd
                            | js_ast::OpCode::BinLogicalOr
                            | js_ast::OpCode::BinNullishCoalescing
                    ) {
                        // `o.#x ??= v` => `__privateGet(o, _x) ?? __privateSet(o, _x, v)`
                        let current = self.private_get_expr(first_obj, &info, expr_loc);
                        let set = self.private_set_expr(second_obj, &info, rt, expr_loc);
                        self.new_expr(
                            E::Binary {
                                op: base_op,
                                left: current,
                                right: set,
                            },
                            expr_loc,
                        )
                    } else {
                        // `o.#x += v` => `__privateSet(o, _x, __privateGet(o, _x) + v)`
                        let current = self.private_get_expr(second_obj, &info, expr_loc);
                        let value = self.new_expr(
                            E::Binary {
                                op: base_op,
                                left: current,
                                right: rt,
                            },
                            expr_loc,
                        );
                        self.private_set_expr(first_obj, &info, value, expr_loc)
                    };
                    return;
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
                            // `x.#m(...)` becomes `__privateGet(x, _m).call(x, ...)`.
                            let (get_obj, this_arg) =
                                self.capture_private_receiver(obj_expr, expr_loc);
                            let private_access = self.private_get_expr(get_obj, &info, expr_loc);
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
                            new_args.push(this_arg);
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
            js_ast::ExprData::EUnary(e) => {
                let is_update = matches!(
                    e.op,
                    js_ast::OpCode::UnPreInc
                        | js_ast::OpCode::UnPreDec
                        | js_ast::OpCode::UnPostInc
                        | js_ast::OpCode::UnPostDec
                );
                if is_update && let Some((obj, info)) = Self::lowered_private_member(&e.value, map)
                {
                    let mut obj = obj;
                    self.rewrite_private_accesses_in_expr(&mut obj, map);
                    // `__privateSet` evaluates its receiver before the value, so the
                    // set carries the capture and the inner get reuses it.
                    let (set_obj, get_obj) = self.capture_private_receiver(obj, expr_loc);
                    // The update runs on a temporary so ToNumeric applies to the
                    // read value (a string increments as a number, a BigInt stays
                    // a BigInt), the same as `++` on a plain variable.
                    let tmp_ref = self.generate_temp_ref(Some(b"_tmp"));
                    let current = self.private_get_expr(get_obj, &info, expr_loc);
                    let read_into_tmp = self.assign_to(tmp_ref, current, expr_loc);
                    let tmp = self.use_ref(tmp_ref, expr_loc);
                    let update = self.new_expr(
                        E::Unary {
                            op: e.op,
                            value: tmp,
                            flags: Default::default(),
                        },
                        expr_loc,
                    );
                    if js_ast::OpCode::is_prefix(e.op) {
                        // `++o.#x` => `__privateSet(o, _x, (_tmp = __privateGet(o, _x), ++_tmp))`
                        let value = read_into_tmp.join_with_comma(update);
                        *expr = self.private_set_expr(set_obj, &info, value, expr_loc);
                    } else {
                        // `o.#x++` => `(__privateSet(o, _x, (_tmp = __privateGet(o, _x), _old = _tmp++, _tmp)), _old)`
                        let old_ref = self.generate_temp_ref(Some(b"_old"));
                        let save_old = self.assign_to(old_ref, update, expr_loc);
                        let tmp_again = self.use_ref(tmp_ref, expr_loc);
                        let value = read_into_tmp
                            .join_with_comma(save_old)
                            .join_with_comma(tmp_again);
                        let set = self.private_set_expr(set_obj, &info, value, expr_loc);
                        let old = self.use_ref(old_ref, expr_loc);
                        *expr = set.join_with_comma(old);
                    }
                    return;
                }
                self.rewrite_private_accesses_in_expr(&mut e.value, map)
            }
            js_ast::ExprData::EDot(e) => self.rewrite_private_accesses_in_expr(&mut e.target, map),
            js_ast::ExprData::ESpread(e) => {
                self.rewrite_private_accesses_in_expr(&mut e.value, map)
            }
            js_ast::ExprData::EIf(e) => {
                let mut t = e.test;
                self.rewrite_private_accesses_in_expr(&mut t, map);
                e.test = t;
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
                let temps_before = self.temp_refs_to_declare.len();
                let stmts = e.func.body.stmts.slice_mut();
                self.rewrite_private_accesses_in_stmts(stmts, map);
                e.func.body.stmts = self.declare_capture_temps_in_fn_body(
                    e.func.body.stmts,
                    temps_before,
                    e.func.body.loc,
                );
            }
            js_ast::ExprData::EArrow(e) => {
                let temps_before = self.temp_refs_to_declare.len();
                let stmts = e.body.stmts.slice_mut();
                self.rewrite_private_accesses_in_stmts(stmts, map);
                e.body.stmts =
                    self.declare_capture_temps_in_fn_body(e.body.stmts, temps_before, e.body.loc);
            }
            _ => {}
        }
    }

    /// Drain receiver-capture temporaries created past `baseline` into a
    /// single `var` declaration statement; `None` if none were created.
    fn drain_capture_temp_decls(&mut self, baseline: usize, loc: bun_ast::Loc) -> Option<Stmt> {
        let total = self.temp_refs_to_declare.len();
        if total == baseline {
            return None;
        }
        let bump = self.arena;
        let mut capture_decls = BumpVec::<G::Decl>::with_capacity_in(total - baseline, bump);
        for i in baseline..total {
            let capture_ref = self.temp_refs_to_declare[i].r#ref;
            let binding = self.b(B::Identifier { r#ref: capture_ref }, loc);
            capture_decls.push(G::Decl {
                binding,
                value: None,
            });
        }
        self.temp_refs_to_declare.truncate(baseline);
        Some(self.s(
            S::Local {
                decls: DeclList::from_bump_vec(capture_decls),
                ..Default::default()
            },
            loc,
        ))
    }

    /// Declare receiver-capture temporaries created past `temps_before` at the
    /// top of the function body they were created in, so each invocation gets
    /// a fresh binding. A binding hoisted outside the function would be shared
    /// across invocations, and `__privateGet(_obj = recv, _s, getter)` runs the
    /// user getter between the write and the `.call(_obj)` read; re-entering
    /// the same call site through that getter would clobber the shared temp.
    fn declare_capture_temps_in_fn_body(
        &mut self,
        stmts: js_ast::StmtNodeList,
        temps_before: usize,
        body_loc: bun_ast::Loc,
    ) -> js_ast::StmtNodeList {
        let Some(decl_stmt) = self.drain_capture_temp_decls(temps_before, body_loc) else {
            return stmts;
        };
        let old_stmts = stmts.slice();
        let mut new_stmts = BumpVec::<Stmt>::with_capacity_in(old_stmts.len() + 1, self.arena);
        new_stmts.push(decl_stmt);
        new_stmts.extend_from_slice(old_stmts);
        js_ast::StmtNodeList::from_bump(new_stmts)
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
                    let mut t = data.test;
                    self.rewrite_private_accesses_in_expr(&mut t, map);
                    data.test = t;
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
                    if let Some(t) = &mut data.test {
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
                    let mut t = data.test;
                    self.rewrite_private_accesses_in_expr(&mut t, map);
                    data.test = t;
                    let mut body = data.body;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut body), map);
                    data.body = body;
                }
                js_ast::StmtData::SDoWhile(data) => {
                    let mut t = data.test;
                    self.rewrite_private_accesses_in_expr(&mut t, map);
                    data.test = t;
                    let mut body = data.body;
                    self.rewrite_private_accesses_in_stmts(core::slice::from_mut(&mut body), map);
                    data.body = body;
                }
                js_ast::StmtData::SSwitch(data) => {
                    let mut t = data.test;
                    self.rewrite_private_accesses_in_expr(&mut t, map);
                    data.test = t;
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
                    if let Some(c) = &mut data.catch {
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

    pub(crate) fn lower_standard_decorators_stmt(
        &mut self,
        stmt: Stmt,
        out: &mut BumpVec<'a, Stmt>,
    ) {
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

    pub(crate) fn lower_standard_decorators_expr(
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

    /// An expression that leaves the class body (a static initializer or a
    /// static block) can no longer see the class's own `this` or `super`, nor
    /// the inner class name of a named class expression. Point all of them at
    /// the binding that holds the class instead.
    fn rewrite_moved_static_expr(
        &mut self,
        expr: &mut Expr,
        class_name_ref: Ref,
        class_name_loc: bun_ast::Loc,
        name_rewrite: Option<RewriteKind>,
    ) {
        self.rewrite_expr(
            expr,
            RewriteKind::ReplaceThis {
                ref_: class_name_ref,
                loc: class_name_loc,
            },
        );
        self.rewrite_expr(
            expr,
            RewriteKind::ReplaceSuper {
                ref_: class_name_ref,
                loc: class_name_loc,
            },
        );
        if let Some(rk) = name_rewrite {
            self.rewrite_expr(expr, rk);
        }
    }

    /// `__runInitializers(_init, flag, target, ...value)`.
    fn run_initializers_call(
        &mut self,
        init_ref: Ref,
        flag: f64,
        target: Expr,
        value: Option<Expr>,
        l: bun_ast::Loc,
    ) -> Expr {
        let i_e = self.use_ref(init_ref, l);
        let n_e = self.new_expr(E::Number::new(flag), l);
        match value {
            Some(v) => self.call_rt(l, b"__runInitializers", &[i_e, n_e, target, v]),
            None => self.call_rt(l, b"__runInitializers", &[i_e, n_e, target]),
        }
    }

    /// `__privateAdd(target, storage, ...value)`.
    fn private_add_call(
        &mut self,
        target: Expr,
        storage_ref: Ref,
        value: Option<Expr>,
        l: bun_ast::Loc,
    ) -> Expr {
        let storage = self.use_ref(storage_ref, l);
        match value {
            Some(v) => self.call_rt(l, b"__privateAdd", &[target, storage, v]),
            None => self.call_rt(l, b"__privateAdd", &[target, storage]),
        }
    }

    /// The value a public field is initialized with once it has left the class
    /// body: `__publicField(target, key, ...value)` keeps [[Define]] semantics;
    /// TypeScript with `useDefineForClassFields: false` assigns instead.
    fn public_field_init(
        &mut self,
        target: Expr,
        prop: &Property,
        value: Option<Expr>,
        use_define: bool,
        l: bun_ast::Loc,
    ) -> Expr {
        if use_define {
            let key = prop.key.expect("infallible: prop has key");
            return match value {
                Some(v) => self.call_rt(l, b"__publicField", &[target, key, v]),
                None => self.call_rt(l, b"__publicField", &[target, key]),
            };
        }
        let member = self.member_target(target, prop);
        let value = value.unwrap_or_else(|| self.new_expr(E::Undefined {}, l));
        Expr::assign(member, value)
    }

    /// Build the getter/setter pair that replaces an `accessor` field, backed by
    /// the WeakMap in `storage_ref`. Returns `(getter, setter)` function exprs.
    fn auto_accessor_get_set(&mut self, storage_ref: Ref, l: bun_ast::Loc) -> (Expr, Expr) {
        let bump = self.arena;
        let this_e = self.new_expr(E::This {}, l);
        let wm_e = self.use_ref(storage_ref, l);
        let get_ret = self.call_rt(l, b"__privateGet", &[this_e, wm_e]);
        let get_body = bump.alloc_slice_copy(&[self.s(
            S::Return {
                value: Some(get_ret),
            },
            l,
        )]);
        let get_fn = G::Fn {
            body: G::FnBody {
                stmts: bun_ast::StoreSlice::new_mut(get_body),
                loc: l,
            },
            ..Default::default()
        };

        let setter_param_ref = self.new_symbol(js_ast::symbol::Kind::Other, b"v");
        let this_e2 = self.new_expr(E::This {}, l);
        let wm_e2 = self.use_ref(storage_ref, l);
        let v_e = self.use_ref(setter_param_ref, l);
        let set_call = self.call_rt(l, b"__privateSet", &[this_e2, wm_e2, v_e]);
        let set_body = bump.alloc_slice_copy(&[self.s(
            S::SExpr {
                value: set_call,
                ..Default::default()
            },
            l,
        )]);
        let setter_binding = self.b(
            B::Identifier {
                r#ref: setter_param_ref,
            },
            l,
        );
        let setter_fn_args = bump.alloc(G::Arg {
            binding: setter_binding,
            ..Default::default()
        });
        let set_fn = G::Fn {
            args: bun_ast::StoreSlice::new_mut(core::slice::from_mut(setter_fn_args)),
            body: G::FnBody {
                stmts: bun_ast::StoreSlice::new_mut(set_body),
                loc: l,
            },
            ..Default::default()
        };
        (
            self.new_expr(E::Function { func: get_fn }, l),
            self.new_expr(E::Function { func: set_fn }, l),
        )
    }

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

        // Receiver-capture temporaries created by `rewrite_private_accesses_in_expr`
        // land in `temp_refs_to_declare`; everything pushed past this point is
        // declared in a `var` statement alongside the other lowering variables
        // right before output assembly.
        let temp_refs_before = p.temp_refs_to_declare.len();

        // ── Phase 0: Classify the class body ─────────────
        //
        // Same rules as esbuild's `computeClassLoweringInfo`: once any member
        // is decorated (or an `accessor` needs its WeakMap storage) every field
        // leaves the class body, so initializers keep their source order, and
        // every private member is lowered so the moved code can still reach it.
        let class_decorators_len = class.ts_decorators.len_u32() as usize;
        let mut has_decorated_prop = false;
        let mut has_auto_accessor = false;
        let mut has_any_private = false;
        let mut has_public_instance_field = false;
        for prop in class.properties.slice().iter() {
            if prop.kind == PropertyKind::ClassStaticBlock {
                continue;
            }
            if prop.ts_decorators.len_u32() > 0 {
                has_decorated_prop = true;
            }
            if prop.kind == PropertyKind::AutoAccessor {
                has_auto_accessor = true;
            }
            if prop_is_private(prop) {
                has_any_private = true;
            } else if !prop.flags.contains(Flags::Property::IsMethod)
                && !prop.flags.contains(Flags::Property::IsStatic)
                && !is_synthesized_param_prop(prop)
            {
                has_public_instance_field = true;
            }
        }
        let has_any_decorators = has_decorated_prop || class_decorators_len > 0;
        let use_define = !Self::IS_TYPESCRIPT_ENABLED || p.options.use_define_for_class_fields;
        let lower_all_static_fields = has_decorated_prop || has_auto_accessor;
        let lower_all_instance_fields =
            lower_all_static_fields || (!use_define && has_public_instance_field);
        let lower_all_private = lower_all_static_fields && has_any_private;
        // Hoisting one computed key before the class means every computed key
        // must be hoisted, or the keys would no longer evaluate in source order.
        let hoist_all_computed_keys = has_decorated_prop
            || class.properties.slice().iter().any(|prop| {
                prop.kind != PropertyKind::ClassStaticBlock
                    && !prop.flags.contains(Flags::Property::IsMethod)
                    && key_needs_hoisting(prop)
                    && if prop.flags.contains(Flags::Property::IsStatic) {
                        lower_all_static_fields
                    } else {
                        lower_all_instance_fields
                    }
            });

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
                class_name_ref = cn.ref_;
                class_name_loc = cn.loc;
            } else {
                class_name_ref = ecr;
                class_name_loc = loc;
                expr_class_is_anonymous = true;
                if let Some(name) = name_from_context
                    && can_be_class_binding_name(name)
                {
                    // This is the class's own `.name`, so it is spelled exactly.
                    let name_ref = p.new_symbol(js_ast::symbol::Kind::Other, name);
                    VecExt::append(&mut p.current_scope_mut().generated, name_ref);
                    class.class_name = Some(js_ast::LocRef {
                        ref_: name_ref,
                        loc,
                    });
                }
            }
        } else {
            class_name_ref = class.class_name.as_ref().unwrap().ref_;
            class_name_loc = class.class_name.as_ref().unwrap().loc;
        }
        let original_class_name_ref = class_name_ref;

        let mut inner_class_ref: Ref = class_name_ref;
        if !is_expr {
            // SAFETY: original_name is arena-owned for 'a.
            let cns: &'a [u8] = p.symbols[class_name_ref.inner_index() as usize]
                .original_name
                .slice();
            let name = p.bump_name2(b"_", cns);
            inner_class_ref = p.new_sym(js_ast::symbol::Kind::Other, name);
        }

        // `ExprNodeList` owns its buffer, so this must be a real ownership
        // transfer: a `ptr::read` copy left in a local would free the buffer
        // that the `E::Array { items }` built below still points at.
        let mut class_decorators: ExprNodeList =
            bun_alloc::AstAlloc::take(&mut class.ts_decorators);

        // The decorator context array. A class with only undecorated
        // `accessor` fields has no decorators to run and gets no metadata.
        let init_ref = if has_any_decorators {
            p.new_sym(js_ast::symbol::Kind::Other, b"_init")
        } else {
            Ref::NONE
        };
        if is_expr && has_any_decorators {
            let binding = p.b(B::Identifier { r#ref: init_ref }, loc);
            expr_var_decls.push(G::Decl {
                binding,
                value: None,
            });
        }

        let mut base_ref: Option<Ref> = None;
        if has_any_decorators && class.extends.is_some() {
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

        // Decorator arrays and computed keys are evaluated before the class, in
        // source order: each member's decorators, then its key. In expression
        // mode these `var` declarations are hoisted by the output assembly.
        let mut prop_dec_refs: HashMap<usize, Ref> = HashMap::default();
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
                let items = bun_alloc::AstAlloc::take(&mut prop.ts_decorators);
                let arr = p.new_expr(
                    E::Array {
                        items,
                        ..Default::default()
                    },
                    loc,
                );
                pre_eval_stmts.push(p.var_decl(dec_ref, Some(arr), loc));
            }
            if hoist_all_computed_keys && key_needs_hoisting(prop) {
                computed_key_counter += 1;
                let key_name: &'a [u8] = if computed_key_counter == 1 {
                    b"_computedKey"
                } else {
                    p.bump_name(b"_computedKey", Some(computed_key_counter))
                };
                let key_ref = p.new_sym(js_ast::symbol::Kind::Other, key_name);
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
        if is_expr
            && !expr_class_is_anonymous
            && let Some(ecr) = expr_class_ref
        {
            // SAFETY: see above.
            original_class_name_for_decorator = Some(
                p.symbols[class_name_ref.inner_index() as usize]
                    .original_name
                    .slice(),
            );
            class_name_ref = ecr;
            class_name_loc = loc;
        }

        // Code moved out of a named class expression's body must reference the
        // temporary that holds the class, not the inner class name.
        let name_rewrite: Option<RewriteKind> = if is_expr && !expr_class_is_anonymous {
            Some(RewriteKind::ReplaceRef {
                old: original_class_name_ref,
                new: class_name_ref,
            })
        } else {
            None
        };

        // `__decorateElement` appends one initializer slot per decorated field
        // or accessor, in call order: static accessors, instance accessors,
        // static fields, instance fields. Number the members the same way.
        let mut initializer_index: HashMap<usize, usize> = HashMap::default();
        let mut call_static_method_extra_inits = false;
        let mut call_instance_method_extra_inits = false;
        {
            let mut counts = [0usize; 4];
            let cprops: &[Property] = class.properties.slice();
            for (prop_idx, prop) in cprops.iter().enumerate() {
                if !prop_dec_refs.contains_key(&prop_idx) {
                    continue;
                }
                match field_or_accessor_order(prop) {
                    Some(i) => counts[i] += 1,
                    None => {
                        if prop.flags.contains(Flags::Property::IsStatic) {
                            call_static_method_extra_inits = true;
                        } else {
                            call_instance_method_extra_inits = true;
                        }
                    }
                }
            }
            let mut next = [
                0,
                counts[0],
                counts[0] + counts[1],
                counts[0] + counts[1] + counts[2],
            ];
            for (prop_idx, prop) in cprops.iter().enumerate() {
                if !prop_dec_refs.contains_key(&prop_idx) {
                    continue;
                }
                if let Some(i) = field_or_accessor_order(prop) {
                    initializer_index.insert(prop_idx, next[i]);
                    next[i] += 1;
                }
            }
        }

        // ── Phase 3: __decoratorStart + base decls ───────
        let init_start_expr: Option<Expr> = if has_any_decorators {
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
            Some(p.call_rt(loc, b"__decoratorStart", &[base_expr]))
        } else {
            None
        };

        let mut base_decl_stmt: Stmt = Stmt::empty();
        if !is_expr {
            if let Some(br) = base_ref {
                base_decl_stmt = p.var_decl(br, class.extends, loc);
            }
        }

        let base_assign_expr: Option<Expr> = if is_expr && let Some(br) = base_ref {
            Some(p.assign_to(br, class.extends.unwrap(), loc))
        } else {
            None
        };

        if let Some(br) = base_ref {
            class.extends = Some(p.use_ref(br, loc));
        }

        let init_decl_stmt: Option<Stmt> = if !is_expr && let Some(ise) = init_start_expr {
            Some(p.var_decl(init_ref, Some(ise), loc))
        } else {
            None
        };

        // ── Phase 4: Property loop ───────────────────────
        let mut prefix_stmts = BumpVec::<Stmt>::new_in(bump);
        let mut new_properties = BumpVec::<Property>::new_in(bump);
        // `__privateAdd(this, _m)` for lowered private methods: first thing in
        // the constructor, so field initializers can call them.
        let mut instance_private_method_adds = BumpVec::<Expr>::new_in(bump);
        let mut static_private_method_adds = BumpVec::<Expr>::new_in(bump);
        // Field, accessor and static-block initialization in source order.
        let mut instance_members = BumpVec::<Expr>::new_in(bump);
        let mut static_members = BumpVec::<Expr>::new_in(bump);
        let mut static_non_field_elements = BumpVec::<Expr>::new_in(bump);
        let mut instance_non_field_elements = BumpVec::<Expr>::new_in(bump);
        let mut static_field_elements = BumpVec::<Expr>::new_in(bump);
        let mut instance_field_elements = BumpVec::<Expr>::new_in(bump);
        let mut private_lowered_map: PrivateLoweredMap = PrivateLoweredMap::default();
        let mut accessor_storage_counter: usize = 0;
        let mut emitted_private_adds: HashMap<u32, ()> = HashMap::default();

        let props_slice2: &mut [Property] = class.properties.slice_mut();
        for (prop_idx, prop) in props_slice2.iter_mut().enumerate() {
            let is_static = prop.flags.contains(Flags::Property::IsStatic);

            if prop.kind == PropertyKind::ClassStaticBlock {
                if !lower_all_static_fields {
                    new_properties.push(prop_full_copy(prop));
                    continue;
                }
                let Some(sb) = prop.class_static_block_mut() else {
                    continue;
                };
                let stmts_slice = sb.stmts.slice_mut();
                p.rewrite_stmts(
                    stmts_slice,
                    RewriteKind::ReplaceThis {
                        ref_: class_name_ref,
                        loc: class_name_loc,
                    },
                );
                p.rewrite_stmts(
                    stmts_slice,
                    RewriteKind::ReplaceSuper {
                        ref_: class_name_ref,
                        loc: class_name_loc,
                    },
                );
                if let Some(rk) = name_rewrite {
                    p.rewrite_stmts(stmts_slice, rk);
                }

                let all_exprs = stmts_slice.iter().all(|s| {
                    matches!(
                        s.data,
                        js_ast::StmtData::SExpr(_) | js_ast::StmtData::SEmpty(_)
                    )
                });
                if all_exprs {
                    for sb_stmt in stmts_slice.iter() {
                        if let js_ast::StmtData::SExpr(s) = &sb_stmt.data {
                            static_members.push(s.value);
                        }
                    }
                } else {
                    // A non-expression statement needs an IIFE, since the class
                    // may be in expression position.
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
                    static_members.push(p.new_expr(
                        E::Call {
                            target: iife_body,
                            args: bun_alloc::AstAlloc::vec(),
                            ..Default::default()
                        },
                        loc,
                    ));
                }
                continue;
            }

            let key_expr = prop.key.expect("infallible: class member has a key");
            let is_private = matches!(key_expr.data, js_ast::ExprData::EPrivateIdentifier(_));
            let is_method = prop.flags.contains(Flags::Property::IsMethod);
            let is_accessor = prop.kind == PropertyKind::AutoAccessor;
            // TypeScript `declare` / `abstract` fields have no runtime presence.
            let omit_field_init =
                matches!(prop.kind, PropertyKind::Declare | PropertyKind::Abstract);
            let must_lower_field = !is_method
                && !is_synthesized_param_prop(prop)
                && if is_static {
                    lower_all_static_fields
                } else {
                    lower_all_instance_fields
                };

            // The object a moved initializer runs against.
            macro_rules! member_target_expr {
                () => {
                    if is_static {
                        p.use_ref(class_name_ref, class_name_loc)
                    } else {
                        p.new_expr(E::This {}, loc)
                    }
                };
            }
            macro_rules! push_member {
                ($e:expr) => {
                    if is_static {
                        static_members.push($e);
                    } else {
                        instance_members.push($e);
                    }
                };
            }
            // The initializer, rewritten if it leaves the class body.
            macro_rules! moved_initializer {
                () => {{
                    let mut init_val = prop.initializer;
                    if is_static {
                        if let Some(iv) = &mut init_val {
                            p.rewrite_moved_static_expr(
                                iv,
                                class_name_ref,
                                class_name_loc,
                                name_rewrite,
                            );
                        }
                    }
                    init_val
                }};
            }

            if let Some(dec_ref) = prop_dec_refs.get(&prop_idx).copied() {
                // ── Decorated property ──
                let mut flags: f64;
                if is_method {
                    flags = match prop.kind {
                        PropertyKind::Get => 2.0,
                        PropertyKind::Set => 3.0,
                        _ => 1.0,
                    };
                } else {
                    flags = if is_accessor { 4.0 } else { 5.0 };
                }
                if is_static {
                    flags += 8.0;
                }
                if is_private {
                    flags += 16.0;
                }
                let k = (flags as u8) & 7;
                let decorator_array = p.use_ref(dec_ref, loc);

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
                    let private_orig: &'a [u8] =
                        p.symbols[priv_inner as usize].original_name.slice();

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

                        let mut new_info =
                            existing.unwrap_or_else(|| PrivateLoweredInfo::new(ws_ref));
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
                        if let js_ast::ExprData::EString(s) = &key_expr.data
                            && s.is_utf8()
                        {
                            break 'brk p.bump_name2(b"_", &s.data);
                        }
                        let name =
                            p.bump_name(b"_accessor_storage", Some(accessor_storage_counter));
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
                let target_ref = if is_expr && let Some(ecr) = expr_class_ref {
                    ecr
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
                dec_args.push(p.new_expr(E::Number::new(flags), loc));
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

                if is_private && let Some(storage_ref) = private_storage_ref {
                    dec_args.push(p.use_ref(storage_ref, loc));
                    if dec_arg_count == 6 {
                        if (1..=3).contains(&k) {
                            dec_args.push(
                                prop.value
                                    .unwrap_or_else(|| p.new_expr(E::Undefined {}, loc)),
                            );
                        } else if k == 4 {
                            dec_args.push(p.use_ref(storage_ref, loc));
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

                if k >= 4 {
                    // Field or accessor: the decorate call runs after the class,
                    // the initializer runs in source order with the other fields.
                    match (is_static, k == 4) {
                        (true, true) => static_non_field_elements.push(element),
                        (true, false) => static_field_elements.push(element),
                        (false, true) => instance_non_field_elements.push(element),
                        (false, false) => instance_field_elements.push(element),
                    }
                    if omit_field_init {
                        continue;
                    }
                    let idx = initializer_index
                        .get(&prop_idx)
                        .copied()
                        .expect("infallible: decorated field has an initializer slot");
                    let init_val = moved_initializer!();
                    let target = member_target_expr!();
                    let run_init = p.run_initializers_call(
                        init_ref,
                        Self::init_flag(idx),
                        target,
                        init_val,
                        loc,
                    );
                    let target = member_target_expr!();
                    let member_expr = if k == 4 {
                        let wm = if is_private {
                            private_storage_ref
                        } else {
                            private_extra_ref
                        }
                        .expect("infallible: accessor has storage");
                        p.private_add_call(target, wm, Some(run_init), loc)
                    } else if let Some(storage_ref) = private_storage_ref {
                        p.private_add_call(target, storage_ref, Some(run_init), loc)
                    } else {
                        p.public_field_init(target, prop, Some(run_init), use_define, loc)
                    };
                    push_member!(member_expr);
                    let target = member_target_expr!();
                    let extra = p.run_initializers_call(
                        init_ref,
                        Self::extra_init_flag(idx),
                        target,
                        None,
                        loc,
                    );
                    push_member!(extra);
                    continue;
                }

                if is_static {
                    static_non_field_elements.push(element);
                } else {
                    instance_non_field_elements.push(element);
                }
                if let Some(storage_ref) = private_storage_ref {
                    // Lowered private method: the function lives in `_m_fn`, the
                    // class body only needs the brand added to each instance.
                    let priv_inner = match &key_expr.data {
                        js_ast::ExprData::EPrivateIdentifier(pi) => pi.ref_.inner_index(),
                        _ => unreachable!(),
                    };
                    if !emitted_private_adds.contains_key(&priv_inner) {
                        emitted_private_adds.insert(priv_inner, ());
                        let target = member_target_expr!();
                        let add = p.private_add_call(target, storage_ref, None, loc);
                        if is_static {
                            static_private_method_adds.push(add);
                        } else {
                            instance_private_method_adds.push(add);
                        }
                    }
                    continue;
                }
                new_properties.push(prop_copy(prop));
                continue;
            }

            // ── Undecorated property ──

            // `constructor(public x)` declares `x;` through the visit pass;
            // its assignment is already in the constructor.
            if is_synthesized_param_prop(prop) {
                new_properties.push(prop_full_copy(prop));
                continue;
            }

            if is_private {
                let npriv_ref = match &key_expr.data {
                    js_ast::ExprData::EPrivateIdentifier(pi) => pi.ref_,
                    _ => unreachable!(),
                };
                let npriv_inner = npriv_ref.inner_index();
                // SAFETY: arena-owned.
                let npriv_orig: &'a [u8] = p.symbols[npriv_inner as usize].original_name.slice();

                if lower_all_private && is_method {
                    // Private method/getter/setter → WeakSet brand + extracted fn
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

                    let mut new_info = existing.unwrap_or_else(|| PrivateLoweredInfo::new(ws_ref));
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

                    if !emitted_private_adds.contains_key(&npriv_inner) {
                        emitted_private_adds.insert(npriv_inner, ());
                        let target = member_target_expr!();
                        let add = p.private_add_call(target, ws_ref, None, loc);
                        if is_static {
                            static_private_method_adds.push(add);
                        } else {
                            instance_private_method_adds.push(add);
                        }
                    }
                    continue;
                }

                if lower_all_private && is_accessor {
                    // Private auto-accessor → WeakSet brand + getter/setter fns over
                    // a WeakMap, the same shape as a lowered private getter/setter.
                    let storage_nm = {
                        let mut v = BumpVec::<u8>::new_in(bump);
                        v.push(b'_');
                        v.extend_from_slice(&npriv_orig[1..]);
                        v.extend_from_slice(b"_storage");
                        v.into_bump_slice()
                    };
                    let storage_ref = p.new_sym(js_ast::symbol::Kind::Other, storage_nm);
                    let wme = p.new_weak_map_expr(loc);
                    prefix_stmts.push(p.var_decl(storage_ref, Some(wme), loc));

                    let ws_nm = p.bump_name2(b"_", &npriv_orig[1..]);
                    let ws_ref = p.new_sym(js_ast::symbol::Kind::Other, ws_nm);
                    let get_nm = p.bump_name2(ws_nm, b"_get");
                    let set_nm = p.bump_name2(ws_nm, b"_set");
                    let get_ref = p.new_sym(js_ast::symbol::Kind::Other, get_nm);
                    let set_ref = p.new_sym(js_ast::symbol::Kind::Other, set_nm);
                    private_lowered_map.insert(
                        npriv_inner,
                        PrivateLoweredInfo {
                            storage_ref: ws_ref,
                            method_fn_ref: None,
                            getter_fn_ref: Some(get_ref),
                            setter_fn_ref: Some(set_ref),
                            accessor_desc_ref: None,
                        },
                    );
                    let wse = p.new_weak_set_expr(loc);
                    prefix_stmts.push(p.var_decl2(ws_ref, Some(wse), get_ref, None, loc));
                    prefix_stmts.push(p.var_decl(set_ref, None, loc));
                    let (get_fn, set_fn) = p.auto_accessor_get_set(storage_ref, loc);
                    let assign_get = p.assign_to(get_ref, get_fn, loc);
                    prefix_stmts.push(p.s(
                        S::SExpr {
                            value: assign_get,
                            ..Default::default()
                        },
                        loc,
                    ));
                    let assign_set = p.assign_to(set_ref, set_fn, loc);
                    prefix_stmts.push(p.s(
                        S::SExpr {
                            value: assign_set,
                            ..Default::default()
                        },
                        loc,
                    ));

                    let target = member_target_expr!();
                    let add = p.private_add_call(target, ws_ref, None, loc);
                    if is_static {
                        static_private_method_adds.push(add);
                    } else {
                        instance_private_method_adds.push(add);
                    }
                    let init_val = moved_initializer!();
                    let target = member_target_expr!();
                    let add_value = p.private_add_call(target, storage_ref, init_val, loc);
                    push_member!(add_value);
                    continue;
                }

                if lower_all_private {
                    // Private field → WeakMap
                    let wm_nm = p.bump_name2(b"_", &npriv_orig[1..]);
                    let wm_ref = p.new_sym(js_ast::symbol::Kind::Other, wm_nm);
                    private_lowered_map.insert(npriv_inner, PrivateLoweredInfo::new(wm_ref));
                    let wme = p.new_weak_map_expr(loc);
                    prefix_stmts.push(p.var_decl(wm_ref, Some(wme), loc));

                    let init_val = moved_initializer!();
                    let target = member_target_expr!();
                    let add = p.private_add_call(target, wm_ref, init_val, loc);
                    push_member!(add);
                    continue;
                }

                if must_lower_field && !is_accessor {
                    // Keep `#p;` as the brand check; the initializer runs with the
                    // other fields. Static private fields never reach here: lowering
                    // static fields lowers every private member.
                    debug_assert!(!is_static);
                    let mut brand = prop_full_copy(prop);
                    brand.initializer = None;
                    new_properties.push(brand);
                    if let Some(init) = prop.initializer {
                        let target = p.new_expr(E::This {}, loc);
                        let member = p.new_expr(
                            E::Index {
                                target,
                                index: key_expr,
                                optional_chain: None,
                            },
                            key_expr.loc,
                        );
                        instance_members.push(Expr::assign(member, init));
                    }
                    continue;
                }

                if !is_accessor {
                    new_properties.push(prop_full_copy(prop));
                    continue;
                }
            }

            if is_accessor {
                // Undecorated auto-accessor → WeakMap + getter/setter
                let accessor_name: &'a [u8] = 'brk: {
                    if let js_ast::ExprData::EString(s) = &key_expr.data
                        && s.is_utf8()
                    {
                        break 'brk p.bump_name2(b"_", &s.data);
                    }
                    let name = p.bump_name(b"_accessor_storage", Some(accessor_storage_counter));
                    accessor_storage_counter += 1;
                    name
                };
                let wm_ref = p.new_sym(js_ast::symbol::Kind::Other, accessor_name);
                let wme = p.new_weak_map_expr(loc);
                prefix_stmts.push(p.var_decl(wm_ref, Some(wme), loc));

                let (get_fn, set_fn) = p.auto_accessor_get_set(wm_ref, loc);
                let mut getter_flags = prop.flags;
                getter_flags.insert(Flags::Property::IsMethod);
                new_properties.push(Property {
                    key: prop.key,
                    value: Some(get_fn),
                    kind: PropertyKind::Get,
                    flags: getter_flags,
                    ..Default::default()
                });
                new_properties.push(Property {
                    key: prop.key,
                    value: Some(set_fn),
                    kind: PropertyKind::Set,
                    flags: getter_flags,
                    ..Default::default()
                });

                let init_val = moved_initializer!();
                let target = member_target_expr!();
                let add = p.private_add_call(target, wm_ref, init_val, loc);
                push_member!(add);
                continue;
            }

            if is_method || !must_lower_field {
                new_properties.push(prop_full_copy(prop));
                continue;
            }

            if omit_field_init {
                continue;
            }

            // Public field → initialized with the other fields, in source order
            let init_val = moved_initializer!();
            let target = member_target_expr!();
            let member_expr = p.public_field_init(target, prop, init_val, use_define, loc);
            push_member!(member_expr);
        }

        // ── Phase 5: Rewrite private accesses ────────────
        if !private_lowered_map.is_empty() {
            for nprop in new_properties.iter_mut() {
                if let Some(v) = &mut nprop.value {
                    p.rewrite_private_accesses_in_expr(v, &private_lowered_map);
                }
                if let Some(ini) = &mut nprop.initializer {
                    p.rewrite_private_accesses_in_expr(ini, &private_lowered_map);
                }
                if let Some(sb) = nprop.class_static_block_mut() {
                    p.rewrite_private_accesses_in_stmts(sb.stmts.slice_mut(), &private_lowered_map);
                }
            }
            for list in [
                &mut instance_members,
                &mut static_members,
                &mut static_non_field_elements,
                &mut instance_non_field_elements,
                &mut static_field_elements,
                &mut instance_field_elements,
            ] {
                for elem in list.iter_mut() {
                    p.rewrite_private_accesses_in_expr(elem, &private_lowered_map);
                }
            }
            p.rewrite_private_accesses_in_stmts(&mut pre_eval_stmts, &private_lowered_map);
            p.rewrite_private_accesses_in_stmts(&mut prefix_stmts, &private_lowered_map);
        }

        // ── Phase 6: Emit suffix ─────────────────────────
        let mut suffix_exprs = BumpVec::<Expr>::new_in(bump);
        suffix_exprs.extend_from_slice(&static_non_field_elements);
        suffix_exprs.extend_from_slice(&instance_non_field_elements);
        suffix_exprs.extend_from_slice(&static_field_elements);
        suffix_exprs.extend_from_slice(&instance_field_elements);
        suffix_exprs.extend_from_slice(&static_private_method_adds);

        // Class decorators run before any static member is initialized; the
        // class binding is rebound to the decorated class first.
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
            cls_dec_args.push(p.new_expr(E::Number::new(0.0), loc));
            cls_dec_args.push(p.new_expr(
                E::EString {
                    data: class_name_str,
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

        // Static method extra initializers
        if call_static_method_extra_inits {
            let c_e = p.use_ref(class_name_ref, class_name_loc);
            let call = p.run_initializers_call(init_ref, 3.0, c_e, None, loc);
            suffix_exprs.push(call);
        }

        // Static fields, accessors and blocks in source order
        suffix_exprs.extend_from_slice(&static_members);

        if class_decorators_len > 0 {
            // Class extra initializers. `__decorateElement` with kind 0 already
            // defined `Symbol.metadata` on the class.
            let c_e = p.use_ref(class_name_ref, class_name_loc);
            let call = p.run_initializers_call(init_ref, 1.0, c_e, None, loc);
            suffix_exprs.push(call);
        } else if has_any_decorators {
            let i_e = p.use_ref(init_ref, loc);
            let c_e = p.use_ref(class_name_ref, class_name_loc);
            suffix_exprs.push(p.call_rt(loc, b"__decoratorMetadata", &[i_e, c_e]));
        }

        // ── Phase 7: Constructor injection ───────────────
        let mut constructor_inject_stmts = BumpVec::<Stmt>::new_in(bump);
        for e in instance_private_method_adds.iter() {
            constructor_inject_stmts.push(p.s(
                S::SExpr {
                    value: *e,
                    ..Default::default()
                },
                loc,
            ));
        }
        if call_instance_method_extra_inits {
            let t_e = p.new_expr(E::This {}, loc);
            let call = p.run_initializers_call(init_ref, 5.0, t_e, None, loc);
            constructor_inject_stmts.push(p.s(
                S::SExpr {
                    value: call,
                    ..Default::default()
                },
                loc,
            ));
        }
        for e in instance_members.iter() {
            constructor_inject_stmts.push(p.s(
                S::SExpr {
                    value: *e,
                    ..Default::default()
                },
                loc,
            ));
        }

        if !constructor_inject_stmts.is_empty() {
            let mut found_constructor = false;
            for nprop in new_properties.iter_mut() {
                if !nprop.flags.contains(Flags::Property::IsMethod)
                    || nprop.flags.contains(Flags::Property::IsStatic)
                    || nprop.flags.contains(Flags::Property::IsComputed)
                    || nprop.key.is_none()
                {
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
                let mut insert_at: usize = 0;
                if class.extends.is_some() {
                    for (index, item) in body_slice.iter().enumerate() {
                        let js_ast::StmtData::SExpr(se) = &item.data else {
                            continue;
                        };
                        let js_ast::ExprData::ECall(call) = &se.value.data else {
                            continue;
                        };
                        if !matches!(call.target.data, js_ast::ExprData::ESuper(_)) {
                            continue;
                        }
                        insert_at = index + 1;
                        break;
                    }
                }
                if !use_define {
                    // TypeScript assigns parameter properties before field
                    // initializers when fields use [[Set]] semantics.
                    let args = func.func.args.slice();
                    while insert_at < body_slice.len()
                        && is_param_prop_assignment(&body_slice[insert_at], args)
                    {
                        insert_at += 1;
                    }
                }
                // BumpVec has no `splice`; rebuild.
                let mut spliced = BumpVec::<Stmt>::with_capacity_in(
                    body_slice.len() + constructor_inject_stmts.len(),
                    bump,
                );
                spliced.extend_from_slice(&body_slice[..insert_at]);
                spliced.extend_from_slice(&constructor_inject_stmts);
                spliced.extend_from_slice(&body_slice[insert_at..]);
                func.func.body.stmts = bun_ast::StoreSlice::new_mut(spliced.into_bump_slice_mut());
                found_constructor = true;
                break;
            }

            if !found_constructor {
                let mut ctor_stmts = BumpVec::<Stmt>::new_in(bump);
                if class.extends.is_some() {
                    let target = p.new_expr(E::Super {}, loc);
                    // `arguments` must keep its name: it is the function's own binding.
                    let args_ref = p.new_symbol(js_ast::symbol::Kind::Unbound, arguments_str);
                    VecExt::append(&mut p.current_scope_mut().generated, args_ref);
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

        class.properties = bun_ast::StoreSlice::new_mut(new_properties.into_bump_slice_mut());
        class.has_decorators = false;
        class.should_lower_standard_decorators = false;

        // Declare the receiver-capture temporaries that were created outside any
        // function body (field initializers, static blocks, pre-eval/decorate
        // expressions). Temps created inside method/function/arrow bodies were
        // already declared there by `declare_capture_temps_in_fn_body`. Static
        // blocks, static initializers, and decorate expressions run at most
        // once per class evaluation; instance field initializers run once per
        // construction and share the hoisted binding across constructions,
        // matching where esbuild declares these temps.
        if let Some(decl_stmt) = p.drain_capture_temp_decls(temp_refs_before, loc) {
            prefix_stmts.push(decl_stmt);
        }

        // ── Phase 8: Assemble output ─────────────────────
        if is_expr {
            let mut comma_parts = BumpVec::<Expr>::new_in(bump);
            if let Some(cda) = class_dec_assign_expr {
                comma_parts.push(cda);
            }
            if let Some(ba) = base_assign_expr {
                comma_parts.push(ba);
            }

            // Can't capture `&mut self` in a closure while also calling
            // `p.method()`, so inline both call sites against a `&[Stmt]`
            // slice array.
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
            if let Some(ise) = init_start_expr {
                comma_parts.push(p.assign_to(init_ref, ise, loc));
            }

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
        if let Some(ids) = init_decl_stmt {
            out.push(ids);
        }
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
        // Inner class binding: let _Foo = Foo. Only decorator expressions that
        // name the class reference it.
        if !inner_class_ref.eql(class_name_ref)
            && p.symbols[inner_class_ref.inner_index() as usize].use_count_estimate > 0
        {
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

#[inline]
fn prop_is_private(prop: &Property) -> bool {
    matches!(
        prop.key,
        Some(k) if matches!(k.data, js_ast::ExprData::EPrivateIdentifier(_))
    )
}

/// The visit pass declares a TypeScript parameter property (`constructor(public
/// x)`) as a class field whose key is the parameter's identifier, not a string.
/// No other class field has a non-computed identifier key.
#[inline]
fn is_synthesized_param_prop(prop: &Property) -> bool {
    !prop.flags.contains(Flags::Property::IsComputed)
        && !prop.flags.contains(Flags::Property::IsMethod)
        && matches!(
            prop.key,
            Some(k) if matches!(k.data, js_ast::ExprData::EIdentifier(_))
        )
}

/// A computed key with side effects must be evaluated exactly once, where the
/// class is defined. String and number literals can be copied instead.
#[inline]
fn key_needs_hoisting(prop: &Property) -> bool {
    prop.flags.contains(Flags::Property::IsComputed)
        && matches!(
            prop.key,
            Some(k) if !matches!(k.data, js_ast::ExprData::EString(_) | js_ast::ExprData::ENumber(_))
        )
}

/// The order `__decorateElement` allocates initializer slots in: static
/// accessors, instance accessors, static fields, instance fields. Methods,
/// getters and setters have no slot.
#[inline]
fn field_or_accessor_order(prop: &Property) -> Option<usize> {
    if prop.flags.contains(Flags::Property::IsMethod) {
        return None;
    }
    let is_static = prop.flags.contains(Flags::Property::IsStatic);
    match prop.kind {
        PropertyKind::AutoAccessor => Some(if is_static { 0 } else { 1 }),
        PropertyKind::Normal | PropertyKind::Declare | PropertyKind::Abstract => {
            Some(if is_static { 2 } else { 3 })
        }
        _ => None,
    }
}

/// `this.x = x` for a `constructor(public x)` parameter property, as the visit
/// pass emits it at the top of the constructor body.
fn is_param_prop_assignment(stmt: &Stmt, args: &[G::Arg]) -> bool {
    let js_ast::StmtData::SExpr(se) = &stmt.data else {
        return false;
    };
    let js_ast::ExprData::EBinary(bin) = &se.value.data else {
        return false;
    };
    if bin.op != js_ast::OpCode::BinAssign {
        return false;
    }
    let js_ast::ExprData::EDot(dot) = &bin.left.data else {
        return false;
    };
    if !matches!(dot.target.data, js_ast::ExprData::EThis(_)) {
        return false;
    }
    let js_ast::ExprData::EIdentifier(id) = &bin.right.data else {
        return false;
    };
    args.iter().any(|arg| {
        arg.is_typescript_ctor_field
            && matches!(arg.binding.data, js_ast::b::B::BIdentifier(b) if b.r#ref.eql(id.ref_))
    })
}

/// The operator behind a compound assignment: `+=` is `+`.
#[inline]
fn compound_assign_base_op(op: js_ast::OpCode) -> Option<js_ast::OpCode> {
    use js_ast::OpCode;
    Some(match op {
        OpCode::BinAddAssign => OpCode::BinAdd,
        OpCode::BinSubAssign => OpCode::BinSub,
        OpCode::BinMulAssign => OpCode::BinMul,
        OpCode::BinDivAssign => OpCode::BinDiv,
        OpCode::BinRemAssign => OpCode::BinRem,
        OpCode::BinPowAssign => OpCode::BinPow,
        OpCode::BinShlAssign => OpCode::BinShl,
        OpCode::BinShrAssign => OpCode::BinShr,
        OpCode::BinUShrAssign => OpCode::BinUShr,
        OpCode::BinBitwiseOrAssign => OpCode::BinBitwiseOr,
        OpCode::BinBitwiseAndAssign => OpCode::BinBitwiseAnd,
        OpCode::BinBitwiseXorAssign => OpCode::BinBitwiseXor,
        OpCode::BinNullishCoalescingAssign => OpCode::BinNullishCoalescing,
        OpCode::BinLogicalOrAssign => OpCode::BinLogicalOr,
        OpCode::BinLogicalAndAssign => OpCode::BinLogicalAnd,
        _ => return None,
    })
}
