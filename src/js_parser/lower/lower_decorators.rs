//! Lowering for TC39 standard ES decorators.

use bun_alloc::ArenaVecExt as _;

use bun_collections::{HashMap, VecExt};

use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::{ARGUMENTS_STR as arguments_str, Ref, TempRef};
use bun_ast::g::{DeclList, Property, PropertyKind};
use bun_ast::{self as js_ast, B, E, Expr, ExprNodeList, Flags, G, S, Stmt};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

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

struct LoweredClass {
    /// `var` statement for the temporaries the class body now refers to.
    temps: Option<Stmt>,
    class_decorators: Option<ClassDecorators>,
}

struct ClassDecorators {
    /// Evaluates the decorator list, before the class.
    evaluate: Expr,
    /// What the decorators returned.
    decorated: Ref,
    /// Runs their extra initializers, once the class is bound to its name.
    run_extra_initializers: Expr,
}

/// How an instance field names an anonymous function it is initialized with.
#[derive(Clone, Copy)]
enum FieldName {
    /// A string or number key, or `"#name"` for a private one.
    Key(Expr),
    /// The temporary that holds a computed key.
    Computed(Expr),
    Unknown,
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
        let ref_ = self.new_symbol(kind, name);
        VecExt::append(&mut self.current_scope_mut().generated, ref_);
        ref_
    }

    /// recordUsage + Expr.assign.
    fn assign_to(&mut self, ref_: Ref, value: Expr, l: bun_ast::Loc) -> Expr {
        Expr::assign(self.use_ref(ref_, l), value)
    }

    /// `new WeakMap` / `new WeakSet`
    fn new_global_expr(&mut self, name: &'static [u8], l: bun_ast::Loc) -> Expr {
        let ref_ = self.find_symbol(l, name).expect("unreachable").r#ref;
        let target = self.new_expr(E::Identifier::init(ref_), l);
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

    /// `static { a; b; }`
    fn make_static_block(&mut self, exprs: &[Expr], l: bun_ast::Loc) -> Property {
        let stmts = self.effect_stmts(exprs, l);
        let stmts_list = bun_alloc::AstVec::<Stmt>::from_arena_slice(stmts.into_bump_slice_mut());
        let sb = self.arena.alloc(G::ClassStaticBlock {
            loc: l,
            stmts: stmts_list,
        });
        Property {
            kind: PropertyKind::ClassStaticBlock,
            class_static_block: Some(js_ast::StoreRef::from_bump(sb)),
            ..Default::default()
        }
    }

    fn bump_name3(&self, a: &[u8], b: &[u8], c: &[u8]) -> &'a [u8] {
        let mut v = BumpVec::<u8>::with_capacity_in(a.len() + b.len() + c.len(), self.arena);
        v.extend_from_slice(a);
        v.extend_from_slice(b);
        v.extend_from_slice(c);
        v.into_bump_slice()
    }

    fn accessor_storage_name(&self, key: Option<Expr>) -> &'a [u8] {
        if let Some(key) = key
            && let js_ast::ExprData::EString(s) = &key.data
            && s.is_utf8()
            && js_lexer::is_identifier(&s.data)
        {
            return self.bump_name3(b"_", &s.data, b"");
        }
        b"_accessor_storage"
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
                            // `x.#m(...)` becomes `__privateGet(x, _m).call(x, ...)`, which
                            // references the receiver twice. Only identifiers and `this` can
                            // be repeated safely; any other receiver is captured in a
                            // temporary so its side effects run once and nested private
                            // calls don't duplicate the whole subtree (the duplication is
                            // exponential in the length of a chain like `o.#m().#m().#m()`).
                            let (get_obj, this_arg) = match &obj_expr.data {
                                js_ast::ExprData::EIdentifier(id) => {
                                    let obj_ref = id.ref_;
                                    (obj_expr, self.use_ref(obj_ref, obj_expr.loc))
                                }
                                js_ast::ExprData::EThis(_) => {
                                    (obj_expr, self.new_expr(E::This {}, obj_expr.loc))
                                }
                                _ => {
                                    let tmp_ref = self.declared_temp(b"_obj");
                                    let write = self.assign_to(tmp_ref, obj_expr, expr_loc);
                                    let read = self.use_ref(tmp_ref, expr_loc);
                                    (write, read)
                                }
                            };
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
            js_ast::ExprData::EUnary(e) => self.rewrite_private_accesses_in_expr(&mut e.value, map),
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
                    self.rewrite_private_accesses_in_property(prop, map);
                }
            }
            js_ast::ExprData::ETemplate(e) => {
                if let Some(t) = &mut e.tag {
                    self.rewrite_private_accesses_in_expr(t, map);
                }
                for part in e.parts_mut().iter_mut() {
                    self.rewrite_private_accesses_in_expr(&mut part.value, map);
                }
            }
            js_ast::ExprData::EFunction(e) => {
                self.rewrite_private_accesses_in_fn(e.func.args, &mut e.func.body, map);
            }
            js_ast::ExprData::EArrow(e) => {
                self.rewrite_private_accesses_in_fn(e.args, &mut e.body, map);
            }
            js_ast::ExprData::EClass(e) => self.rewrite_private_accesses_in_class(e, map),
            _ => {}
        }
    }

    fn rewrite_private_accesses_in_fn(
        &mut self,
        args: bun_ast::StoreSlice<G::Arg>,
        body: &mut G::FnBody,
        map: &PrivateLoweredMap,
    ) {
        // A `var` of the body is not visible to a parameter default: the
        // receiver temporaries of the defaults stay with the enclosing function.
        for arg in args.slice_mut() {
            self.rewrite_private_accesses_in_binding(arg.binding, map);
            if let Some(default) = &mut arg.default {
                self.rewrite_private_accesses_in_expr(default, map);
            }
        }
        let temps_before = self.temp_refs_to_declare.len();
        self.rewrite_private_accesses_in_stmts(body.stmts.slice_mut(), map);
        body.stmts = self.declare_capture_temps_in_fn_body(body.stmts, temps_before, body.loc);
    }

    fn rewrite_private_accesses_in_class(&mut self, class: &mut G::Class, map: &PrivateLoweredMap) {
        if let Some(extends) = &mut class.extends {
            self.rewrite_private_accesses_in_expr(extends, map);
        }
        for prop in class.properties.slice_mut() {
            self.rewrite_private_accesses_in_property(prop, map);
        }
    }

    fn rewrite_private_accesses_in_property(
        &mut self,
        prop: &mut Property,
        map: &PrivateLoweredMap,
    ) {
        if prop.flags.contains(Flags::Property::IsComputed)
            && let Some(key) = &mut prop.key
        {
            self.rewrite_private_accesses_in_expr(key, map);
        }
        if let Some(value) = &mut prop.value {
            self.rewrite_private_accesses_in_expr(value, map);
        }
        if let Some(initializer) = &mut prop.initializer {
            self.rewrite_private_accesses_in_expr(initializer, map);
        }
        if let Some(block) = prop.class_static_block_mut() {
            self.rewrite_private_accesses_in_stmts(block.stmts.slice_mut(), map);
        }
    }

    fn rewrite_private_accesses_in_binding(
        &mut self,
        binding: js_ast::Binding,
        map: &PrivateLoweredMap,
    ) {
        match binding.data {
            js_ast::b::B::BArray(mut array) => {
                for item in array.items_mut() {
                    self.rewrite_private_accesses_in_binding(item.binding, map);
                    if let Some(default) = &mut item.default_value {
                        self.rewrite_private_accesses_in_expr(default, map);
                    }
                }
            }
            js_ast::b::B::BObject(mut object) => {
                for prop in object.properties_mut() {
                    if prop.flags.contains(Flags::Property::IsComputed) {
                        self.rewrite_private_accesses_in_expr(&mut prop.key, map);
                    }
                    self.rewrite_private_accesses_in_binding(prop.value, map);
                    if let Some(default) = &mut prop.default_value {
                        self.rewrite_private_accesses_in_expr(default, map);
                    }
                }
            }
            js_ast::b::B::BIdentifier(_) | js_ast::b::B::BMissing(_) => {}
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
                        self.rewrite_private_accesses_in_binding(decl.binding, map);
                        if let Some(v) = &mut decl.value {
                            self.rewrite_private_accesses_in_expr(v, map);
                        }
                    }
                }
                js_ast::StmtData::SFunction(data) => {
                    let args = data.func.args;
                    self.rewrite_private_accesses_in_fn(args, &mut data.func.body, map);
                }
                js_ast::StmtData::SClass(data) => {
                    self.rewrite_private_accesses_in_class(&mut data.class, map);
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
        let mut s_class = match stmt.data {
            js_ast::StmtData::SClass(c) => c,
            _ => unreachable!(),
        };
        let lowered = self.lower_class_body(&mut s_class.class, stmt.loc, None);
        out.extend(lowered.temps);
        let Some(decorators) = lowered.class_decorators else {
            out.push(stmt);
            return;
        };
        let name = s_class
            .class
            .class_name
            .expect("a class statement has a name");
        let decorated = self.use_ref(decorators.decorated, name.loc);
        let rebind = self.assign_to(name.ref_, decorated, name.loc);
        out.push(self.expr_stmt(decorators.evaluate, stmt.loc));
        out.push(stmt);
        out.push(self.expr_stmt(rebind, stmt.loc));
        out.push(self.expr_stmt(decorators.run_extra_initializers, stmt.loc));
    }

    pub(crate) fn lower_standard_decorators_expr(
        &mut self,
        expr: Expr,
        class: &mut G::Class,
        name_from_context: Option<&'a [u8]>,
    ) -> Expr {
        let lowered = self.lower_class_body(class, expr.loc, name_from_context);
        if let Some(decl) = lowered.temps
            && let Some(stmt_list) = self.nearest_stmt_list_mut()
        {
            stmt_list.push(decl);
        }
        let Some(decorators) = lowered.class_decorators else {
            return expr;
        };
        let decorated = self.use_ref(decorators.decorated, expr.loc);
        Expr::join_all_with_comma(&[
            decorators.evaluate,
            expr,
            decorators.run_extra_initializers,
            decorated,
        ])
    }

    // ── Core lowering ────────────────────────────────────

    /// Rewrites `class` in place. Members stay where they are written, so
    /// fields, static blocks, `this`, `super` and `#private` names keep their
    /// native behavior; what the runtime helpers need is added around them.
    /// Decorator lists are evaluated in the key of their member and applied by
    /// a leading `static {}`. What has to run between two instance fields rides
    /// in the initializer of the next one, or the constructor after the last.
    /// A `#private` name with a decorated member becomes a WeakMap or WeakSet,
    /// which is how the helpers reach it; its methods become function expressions.
    #[allow(clippy::too_many_lines)]
    fn lower_class_body(
        &mut self,
        class: &mut G::Class,
        loc: bun_ast::Loc,
        name_from_context: Option<&'a [u8]>,
    ) -> LoweredClass {
        let p = self;
        let bump = p.arena;
        let temps_before = p.temp_refs_to_declare.len();

        let class_decorators: ExprNodeList = bun_alloc::AstAlloc::take(&mut class.ts_decorators);
        let has_class_decorators = class_decorators.len_u32() > 0;

        // `__decorateElement` numbers the initializer lists of accessors and
        // fields in the order it is called: static accessors, instance
        // accessors, static fields, instance fields.
        let mut next_initializer = [0usize; 4];
        let mut has_member_decorators = false;
        let mut lowered_names: HashMap<u32, ()> = HashMap::default();
        for prop in class.properties.slice() {
            if prop.ts_decorators.len_u32() == 0 {
                continue;
            }
            has_member_decorators = true;
            if let Some(key) = prop.key
                && let js_ast::ExprData::EPrivateIdentifier(private) = &key.data
            {
                lowered_names.insert(private.ref_.inner_index(), ());
            }
            if let Some(group) = Self::initializer_group(prop) {
                for later in &mut next_initializer[group + 1..] {
                    *later += 1;
                }
            }
        }
        let has_decorators = has_class_decorators || has_member_decorators;
        let init_ref = if has_decorators {
            p.declared_temp(b"_init")
        } else {
            Ref::NONE
        };
        let mut base_ref: Option<Ref> = None;
        if has_decorators && let Some(extends) = class.extends {
            let base = p.declared_temp(b"_base");
            class.extends = Some(p.assign_to(base, extends, extends.loc));
            base_ref = Some(base);
        }

        let mut members = BumpVec::<Property>::with_capacity_in(class.properties.len() + 4, bump);
        let mut key_effects = BumpVec::<Expr>::new_in(bump);
        let mut instance_effects = BumpVec::<Expr>::new_in(bump);
        let mut first_instance_host: Option<(usize, FieldName)> = None;
        let mut last_key_host: Option<(usize, Option<Expr>)> = None;
        let mut constructor: Option<usize> = None;
        let mut storage_inits = BumpVec::<Expr>::new_in(bump);
        let mut static_brands = BumpVec::<Expr>::new_in(bump);
        let mut instance_brands = BumpVec::<Expr>::new_in(bump);
        let mut decorate: [BumpVec<'a, Expr>; 4] = [
            BumpVec::new_in(bump),
            BumpVec::new_in(bump),
            BumpVec::new_in(bump),
            BumpVec::new_in(bump),
        ];
        let mut private_lowered_map: PrivateLoweredMap = PrivateLoweredMap::default();

        for slot in class.properties.slice_mut().iter_mut() {
            let mut prop = core::mem::take(slot);
            if prop.kind == PropertyKind::ClassStaticBlock {
                members.push(prop);
                continue;
            }

            let key = prop.key.expect("a class member has a key");
            let private_index = match &key.data {
                js_ast::ExprData::EPrivateIdentifier(private) => Some(private.ref_.inner_index()),
                _ => None,
            };
            let decorators: ExprNodeList = bun_alloc::AstAlloc::take(&mut prop.ts_decorators);
            // An undecorated `accessor #x` behaves like the field `#x`.
            if private_index.is_some()
                && prop.kind == PropertyKind::AutoAccessor
                && decorators.len_u32() == 0
            {
                prop.kind = PropertyKind::Normal;
            }
            let is_static = prop.flags.contains(Flags::Property::IsStatic);
            let is_method = prop.flags.contains(Flags::Property::IsMethod);
            let kind: u8 = match prop.kind {
                PropertyKind::Get => 2,
                PropertyKind::Set => 3,
                PropertyKind::AutoAccessor => 4,
                _ if is_method => 1,
                _ => 5,
            };
            let flags = f64::from(
                kind + if is_static { 8 } else { 0 } + if private_index.is_some() { 16 } else { 0 },
            );
            let group = usize::from(!is_static) + if kind == 5 { 2 } else { 0 };

            let dec_ref = if decorators.len_u32() > 0 {
                let dec = p.declared_temp(b"_dec");
                let list = p.new_expr(
                    E::Array {
                        items: decorators,
                        ..Default::default()
                    },
                    loc,
                );
                key_effects.push(p.assign_to(dec, list, loc));
                Some(dec)
            } else {
                None
            };

            // ── `#private` member of a lowered name ──
            if let Some(private_index) = private_index
                && lowered_names.contains_key(&private_index)
            {
                let private_name: &'a [u8] =
                    p.symbols[private_index as usize].original_name.slice();
                let name_expr = p.new_expr(E::EString::init(private_name), loc);
                let existing = private_lowered_map.get(&private_index).copied();
                let storage = if let Some(existing) = existing {
                    existing.storage_ref
                } else {
                    let name = p.bump_name3(b"_", &private_name[1..], b"");
                    let storage = p.declared_temp(name);
                    let container =
                        p.new_global_expr(if is_method { b"WeakSet" } else { b"WeakMap" }, loc);
                    storage_inits.push(p.assign_to(storage, container, loc));
                    storage
                };
                let mut info = existing.unwrap_or_else(|| PrivateLoweredInfo::new(storage));
                let storage_expr = p.use_ref(storage, loc);

                if is_method {
                    if existing.is_none() {
                        let this = p.new_expr(E::This {}, loc);
                        let brand = p.call_rt(loc, b"__privateAdd", &[this, storage_expr]);
                        if is_static {
                            static_brands.push(brand);
                        } else {
                            instance_brands.push(brand);
                        }
                    }
                    let (suffix, slot): (&[u8], _) = match kind {
                        2 => (b"_get", &mut info.getter_fn_ref),
                        3 => (b"_set", &mut info.setter_fn_ref),
                        _ => (b"_fn", &mut info.method_fn_ref),
                    };
                    let fn_name = p.bump_name3(b"_", &private_name[1..], suffix);
                    let fn_ref = p.declared_temp(fn_name);
                    *slot = Some(fn_ref);
                    private_lowered_map.insert(private_index, info);
                    let body = prop
                        .value
                        .unwrap_or_else(|| p.new_expr(E::Undefined {}, loc));
                    if let Some(dec) = dec_ref {
                        let decorated = p.decorate_element(
                            init_ref,
                            flags,
                            name_expr,
                            dec,
                            storage_expr,
                            Some(body),
                            loc,
                        );
                        decorate[group].push(p.assign_to(fn_ref, decorated, loc));
                    } else {
                        storage_inits.push(p.assign_to(fn_ref, body, loc));
                    }
                    continue;
                }

                let mut initializer_index = None;
                if let Some(dec) = dec_ref {
                    let extra = (kind == 4).then_some(storage_expr);
                    let mut decorated = p.decorate_element(
                        init_ref,
                        flags,
                        name_expr,
                        dec,
                        storage_expr,
                        extra,
                        loc,
                    );
                    if kind == 4 {
                        let name = p.bump_name3(b"_", &private_name[1..], b"_acc");
                        let descriptor = p.declared_temp(name);
                        info.accessor_desc_ref = Some(descriptor);
                        decorated = p.assign_to(descriptor, decorated, loc);
                    }
                    decorate[group].push(decorated);
                    initializer_index = Some((init_ref, next_initializer[group]));
                    next_initializer[group] += 1;
                }
                private_lowered_map.insert(private_index, info);
                let effects =
                    p.storage_init_effects(storage, prop.initializer, initializer_index, loc);
                if is_static {
                    members.push(p.make_static_block(&effects, loc));
                } else {
                    instance_effects.extend_from_slice(&effects);
                }
                continue;
            }

            // ── `accessor x` ──
            if kind == 4 {
                let storage_name = p.accessor_storage_name(prop.key);
                let storage = p.declared_temp(storage_name);
                let container = p.new_global_expr(b"WeakMap", loc);
                storage_inits.push(p.assign_to(storage, container, loc));

                // Hosting key effects makes the getter's key computed; the
                // setter repeats the key as it was.
                let mut setter_flags = prop.flags;
                setter_flags.insert(Flags::Property::IsMethod);
                let (name_expr, key_temp) = p.host_key_effects(&mut prop, &mut key_effects, true);
                let mut getter_flags = prop.flags;
                getter_flags.insert(Flags::Property::IsMethod);
                let getter = p.accessor_getter(storage, loc);
                last_key_host = Some((members.len(), key_temp));
                members.push(Property {
                    key: prop.key,
                    value: Some(getter),
                    kind: PropertyKind::Get,
                    flags: getter_flags,
                    ..Default::default()
                });
                // `__decorateElement` defines a decorated accessor itself: the
                // getter only holds the key.
                if dec_ref.is_none() {
                    let setter = p.accessor_setter(storage, loc);
                    members.push(Property {
                        key: Some(name_expr),
                        value: Some(setter),
                        kind: PropertyKind::Set,
                        flags: setter_flags,
                        ..Default::default()
                    });
                }

                let mut initializer_index = None;
                if let Some(dec) = dec_ref {
                    let this = p.new_expr(E::This {}, loc);
                    let storage_expr = p.use_ref(storage, loc);
                    decorate[group].push(p.decorate_element(
                        init_ref,
                        flags,
                        name_expr,
                        dec,
                        this,
                        Some(storage_expr),
                        loc,
                    ));
                    initializer_index = Some((init_ref, next_initializer[group]));
                    next_initializer[group] += 1;
                }
                let effects =
                    p.storage_init_effects(storage, prop.initializer, initializer_index, loc);
                if is_static {
                    members.push(p.make_static_block(&effects, loc));
                } else {
                    instance_effects.extend_from_slice(&effects);
                }
                continue;
            }

            // ── Members that stay as written ──
            let mut field_name = FieldName::Unknown;
            let mut name_expr = key;
            if Self::is_constructor(&prop) {
                constructor = Some(members.len());
            } else if let Some(private_index) = private_index {
                let name: &'a [u8] = p.symbols[private_index as usize].original_name.slice();
                field_name = FieldName::Key(p.new_expr(E::EString::init(name), loc));
            } else {
                // Only a field that may carry effects has to name its function itself.
                let names_function = !is_method
                    && !is_static
                    && (!instance_effects.is_empty() || first_instance_host.is_none())
                    && prop
                        .initializer
                        .is_some_and(|value| value.is_anonymous_named());
                let key_temp;
                (name_expr, key_temp) = p.host_key_effects(
                    &mut prop,
                    &mut key_effects,
                    dec_ref.is_some() || names_function,
                );
                last_key_host = Some((members.len(), key_temp));
                if Self::is_constant_key(&name_expr) {
                    field_name = FieldName::Key(name_expr);
                } else if names_function {
                    field_name = FieldName::Computed(name_expr);
                }
            }

            let mut extra_initializer: Option<Expr> = None;
            if let Some(dec) = dec_ref {
                let this = p.new_expr(E::This {}, loc);
                decorate[group]
                    .push(p.decorate_element(init_ref, flags, name_expr, dec, this, None, loc));
                if !is_method {
                    let (value, extra) = p.decorated_initializer(
                        init_ref,
                        next_initializer[group],
                        prop.initializer,
                        loc,
                    );
                    next_initializer[group] += 1;
                    prop.initializer = Some(value);
                    extra_initializer = Some(extra);
                }
            }

            if !is_method && !is_static {
                if !instance_effects.is_empty() {
                    instance_effects.push(p.hosted_initializer(prop.initializer, field_name, loc));
                    prop.initializer = Some(Expr::join_all_with_comma(&instance_effects));
                    instance_effects.clear();
                }
                first_instance_host.get_or_insert((members.len(), field_name));
            }
            members.push(prop);
            if let Some(extra) = extra_initializer {
                if is_static {
                    members.push(p.make_static_block(&[extra], loc));
                } else {
                    instance_effects.push(extra);
                }
            }
        }

        // ── Decorator lists written after the last key that can hold them ──
        let mut leading = BumpVec::<Expr>::new_in(bump);
        if !key_effects.is_empty() {
            if let Some((host, key_temp)) = last_key_host {
                p.append_key_effects(&mut members[host], &key_effects, key_temp);
            } else {
                // No member has a key: `static [(lists, "__decorators")]() {}`,
                // deleted before anything can see it.
                let key = p.new_expr(E::EString::from_static(b"__decorators"), loc);
                key_effects.push(key);
                let mut flags = Flags::PropertySet::from(Flags::Property::IsMethod);
                flags.insert(Flags::Property::IsStatic);
                flags.insert(Flags::Property::IsComputed);
                members.push(Property {
                    key: Some(Expr::join_all_with_comma(&key_effects)),
                    value: Some(p.new_expr(
                        E::Function {
                            func: G::Fn::default(),
                        },
                        loc,
                    )),
                    flags,
                    ..Default::default()
                });
                let this = p.new_expr(E::This {}, loc);
                let member = p.new_expr(
                    E::Index {
                        target: this,
                        index: key,
                        optional_chain: None,
                        is_import_property_use: false,
                    },
                    loc,
                );
                leading.push(p.new_expr(
                    E::Unary {
                        op: js_ast::OpCode::UnDelete,
                        value: member,
                        flags:
                            E::UnaryFlags::WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS,
                    },
                    loc,
                ));
            }
        }

        // ── The leading static block ──
        leading.extend_from_slice(&storage_inits);
        leading.extend_from_slice(&static_brands);
        let mut class_decorators_result: Option<ClassDecorators> = None;
        if has_decorators {
            let base = match base_ref {
                Some(base) => p.use_ref(base, loc),
                None => p.new_expr(E::Undefined {}, loc),
            };
            let start = p.call_rt(loc, b"__decoratorStart", &[base]);
            leading.push(p.assign_to(init_ref, start, loc));
            let has_static_method_decorators = !decorate[0].is_empty();
            for group in &decorate {
                leading.extend_from_slice(group);
            }
            if has_class_decorators {
                let dec = p.declared_temp(b"_dec");
                let list = p.new_expr(
                    E::Array {
                        items: class_decorators,
                        ..Default::default()
                    },
                    loc,
                );
                let evaluate = p.assign_to(dec, list, loc);
                let name: &'a [u8] = match &class.class_name {
                    Some(name) => p.symbols[name.ref_.inner_index() as usize]
                        .original_name
                        .slice(),
                    None => name_from_context.unwrap_or(b""),
                };
                let decorated_ref = p.declared_temp(if js_lexer::is_identifier(name) {
                    p.bump_name3(b"_", name, b"")
                } else {
                    b"_class"
                });
                let this = p.new_expr(E::This {}, loc);
                let name = p.new_expr(E::EString::init(name), loc);
                let decorated = p.decorate_element(init_ref, 0.0, name, dec, this, None, loc);
                leading.push(p.assign_to(decorated_ref, decorated, loc));
                let decorated = p.use_ref(decorated_ref, loc);
                class_decorators_result = Some(ClassDecorators {
                    evaluate,
                    decorated: decorated_ref,
                    run_extra_initializers: p.run_initializers(init_ref, 1.0, decorated, loc),
                });
            } else {
                let args = [p.use_ref(init_ref, loc), p.new_expr(E::This {}, loc)];
                leading.push(p.call_rt(loc, b"__decoratorMetadata", &args));
            }
            if has_static_method_decorators {
                let this = p.new_expr(E::This {}, loc);
                leading.push(p.run_initializers(init_ref, 3.0, this, loc));
            }
        }

        // ── What runs before the first instance field ──
        let mut instance_prologue = instance_brands;
        if !decorate[1].is_empty() {
            let this = p.new_expr(E::This {}, loc);
            instance_prologue.push(p.run_initializers(init_ref, 5.0, this, loc));
        }
        let mut constructor_effects = BumpVec::<Expr>::new_in(bump);
        if let Some((host, field_name)) = first_instance_host {
            if !instance_prologue.is_empty() {
                let host = &mut members[host];
                instance_prologue.push(p.hosted_initializer(host.initializer, field_name, loc));
                host.initializer = Some(Expr::join_all_with_comma(&instance_prologue));
            }
        } else {
            constructor_effects.extend_from_slice(&instance_prologue);
        }
        constructor_effects.extend_from_slice(&instance_effects);

        let mut leading = (!leading.is_empty()).then(|| p.make_static_block(&leading, loc));
        if !private_lowered_map.is_empty() {
            for member in members.iter_mut().chain(leading.as_mut()) {
                p.rewrite_private_accesses_in_property(member, &private_lowered_map);
            }
            for effect in constructor_effects.iter_mut() {
                p.rewrite_private_accesses_in_expr(effect, &private_lowered_map);
            }
        }

        let mut new_constructor = None;
        if !constructor_effects.is_empty() {
            match constructor {
                Some(constructor) => {
                    p.run_after_super(&mut members[constructor], &constructor_effects, loc);
                }
                None => {
                    new_constructor =
                        Some(p.new_constructor(class.extends.is_some(), &constructor_effects, loc));
                }
            }
        }

        let mut properties = BumpVec::<Property>::with_capacity_in(members.len() + 2, bump);
        properties.extend(new_constructor);
        properties.extend(leading);
        properties.extend(members);
        class.properties = bun_ast::StoreSlice::from_bump(properties);
        class.has_decorators = false;
        class.should_lower_standard_decorators = false;

        LoweredClass {
            temps: p.drain_capture_temp_decls(temps_before, loc),
            class_decorators: class_decorators_result,
        }
    }

    /// A temporary the `var` next to the class declares.
    fn declared_temp(&mut self, name: &'a [u8]) -> Ref {
        let ref_ = self.generate_temp_var(name);
        self.temp_refs_to_declare.push(TempRef { r#ref: ref_ });
        ref_
    }

    fn is_constructor(prop: &Property) -> bool {
        prop.flags.contains(Flags::Property::IsMethod)
            && !prop.flags.contains(Flags::Property::IsStatic)
            && !prop.flags.contains(Flags::Property::IsComputed)
            && matches!(
                prop.key.map(|key| key.data),
                Some(js_ast::ExprData::EString(s)) if s.eql_comptime(b"constructor")
            )
    }

    /// A key whose evaluation cannot be observed, so it can be repeated.
    fn is_constant_key(key: &Expr) -> bool {
        matches!(
            key.data,
            js_ast::ExprData::EString(_) | js_ast::ExprData::ENumber(_)
        )
    }

    /// Which initializer list of `__decorateElement` a decorated accessor or
    /// field gets: static accessors, instance accessors, static fields,
    /// instance fields.
    fn initializer_group(prop: &Property) -> Option<usize> {
        let instance = usize::from(!prop.flags.contains(Flags::Property::IsStatic));
        if prop.kind == PropertyKind::AutoAccessor {
            Some(instance)
        } else if prop.flags.contains(Flags::Property::IsMethod) {
            None
        } else {
            Some(2 + instance)
        }
    }

    /// `__decorateElement(_init, flags, name, _dec, target[, extra])`
    fn decorate_element(
        &mut self,
        init_ref: Ref,
        flags: f64,
        name: Expr,
        dec: Ref,
        target: Expr,
        extra: Option<Expr>,
        loc: bun_ast::Loc,
    ) -> Expr {
        let mut args = BumpVec::<Expr>::with_capacity_in(6, self.arena);
        args.push(self.use_ref(init_ref, loc));
        args.push(self.new_expr(E::Number::new(flags), loc));
        args.push(name);
        args.push(self.use_ref(dec, loc));
        args.push(target);
        args.extend(extra);
        self.call_runtime(loc, b"__decorateElement", ExprNodeList::from_bump_vec(args))
    }

    /// `__runInitializers(_init, flags, target)`
    fn run_initializers(
        &mut self,
        init_ref: Ref,
        flags: f64,
        target: Expr,
        loc: bun_ast::Loc,
    ) -> Expr {
        let args = [
            self.use_ref(init_ref, loc),
            self.new_expr(E::Number::new(flags), loc),
            target,
        ];
        self.call_rt(loc, b"__runInitializers", &args)
    }

    /// Moves `effects` into the key of `prop` so they run where the member is
    /// defined. Returns the key as `__decorateElement` names it; `reuse_key`
    /// keeps a computed key in a temporary for that, which is also returned.
    fn host_key_effects(
        &mut self,
        prop: &mut Property,
        effects: &mut BumpVec<'a, Expr>,
        reuse_key: bool,
    ) -> (Expr, Option<Expr>) {
        let key = prop.key.expect("a class member has a key");
        let is_constant =
            !prop.flags.contains(Flags::Property::IsComputed) || Self::is_constant_key(&key);
        if !is_constant && reuse_key {
            let key_ref = self.declared_temp(b"_computedKey");
            effects.push(self.assign_to(key_ref, key, key.loc));
            prop.key = Some(Expr::join_all_with_comma(effects));
            effects.clear();
            let key_temp = self.use_ref(key_ref, key.loc);
            return (key_temp, Some(key_temp));
        }
        if !effects.is_empty() {
            effects.push(self.key_as_value(prop, key));
            prop.key = Some(Expr::join_all_with_comma(effects));
            prop.flags.insert(Flags::Property::IsComputed);
            effects.clear();
        }
        (key, None)
    }

    /// The key of `prop` as the expression a computed key needs. The visit pass
    /// keys the field of a TypeScript parameter property by an identifier.
    fn key_as_value(&mut self, prop: &Property, key: Expr) -> Expr {
        if !prop.flags.contains(Flags::Property::IsComputed)
            && let js_ast::ExprData::EIdentifier(id) = &key.data
        {
            let name: &'a [u8] = self.symbols[id.ref_.inner_index() as usize]
                .original_name
                .slice();
            return self.new_expr(E::EString::init(name), key.loc);
        }
        key
    }

    /// Runs `effects` right after the key of `prop` is evaluated. `key_temp`
    /// is the temporary `host_key_effects` left the key in.
    fn append_key_effects(
        &mut self,
        prop: &mut Property,
        effects: &[Expr],
        key_temp: Option<Expr>,
    ) {
        let key = prop.key.expect("a class member has a key");
        let mut parts = BumpVec::<Expr>::with_capacity_in(effects.len() + 2, self.arena);
        if let Some(key_temp) = key_temp {
            parts.push(key);
            parts.extend_from_slice(effects);
            parts.push(key_temp);
        } else if !prop.flags.contains(Flags::Property::IsComputed) || Self::is_constant_key(&key) {
            parts.extend_from_slice(effects);
            parts.push(self.key_as_value(prop, key));
        } else if let js_ast::ExprData::EBinary(comma) = &key.data
            && comma.op == js_ast::OpCode::BinComma
            && Self::is_constant_key(&comma.right)
        {
            parts.push(comma.left);
            parts.extend_from_slice(effects);
            parts.push(comma.right);
        } else {
            let key_ref = self.declared_temp(b"_computedKey");
            parts.push(self.assign_to(key_ref, key, key.loc));
            parts.extend_from_slice(effects);
            parts.push(self.use_ref(key_ref, key.loc));
        }
        prop.key = Some(Expr::join_all_with_comma(&parts));
        prop.flags.insert(Flags::Property::IsComputed);
    }

    /// The initializer of a field that is about to go behind a comma. There an
    /// anonymous function or class is not named by the field any more.
    fn hosted_initializer(
        &mut self,
        initializer: Option<Expr>,
        field_name: FieldName,
        loc: bun_ast::Loc,
    ) -> Expr {
        let Some(value) = initializer else {
            return self.new_expr(E::Undefined {}, loc);
        };
        if !value.is_anonymous_named() {
            return value;
        }
        match field_name {
            FieldName::Unknown => value,
            // `{ key: value }[key]` names it as the field would.
            FieldName::Key(key) | FieldName::Computed(key) => {
                let mut flags = Flags::PROPERTY_NONE;
                if matches!(field_name, FieldName::Computed(_))
                    || matches!(&key.data, js_ast::ExprData::EString(s) if s.eql_comptime(b"__proto__"))
                {
                    flags.insert(Flags::Property::IsComputed);
                }
                let mut properties = bun_alloc::AstAlloc::vec();
                VecExt::append(
                    &mut properties,
                    Property {
                        key: Some(key),
                        value: Some(value),
                        flags,
                        ..Default::default()
                    },
                );
                let object = self.new_expr(
                    E::Object {
                        properties,
                        is_single_line: true,
                        ..Default::default()
                    },
                    value.loc,
                );
                self.new_expr(
                    E::Index {
                        target: object,
                        index: key,
                        optional_chain: None,
                        is_import_property_use: false,
                    },
                    value.loc,
                )
            }
        }
    }

    /// `__runInitializers(_init, n, this, initializer)` for the value of a
    /// decorated field or accessor, and the call that runs the extra
    /// initializers once it is defined.
    fn decorated_initializer(
        &mut self,
        init_ref: Ref,
        index: usize,
        initializer: Option<Expr>,
        loc: bun_ast::Loc,
    ) -> (Expr, Expr) {
        let mut args = BumpVec::<Expr>::with_capacity_in(4, self.arena);
        args.push(self.use_ref(init_ref, loc));
        args.push(self.new_expr(E::Number::new(((4 + 2 * index) << 1) as f64), loc));
        args.push(self.new_expr(E::This {}, loc));
        args.extend(initializer);
        let value = self.call_runtime(loc, b"__runInitializers", ExprNodeList::from_bump_vec(args));
        let this = self.new_expr(E::This {}, loc);
        let extra = self.run_initializers(init_ref, (((5 + 2 * index) << 1) | 1) as f64, this, loc);
        (value, extra)
    }

    /// `__privateAdd(this, storage, initializer)`. `decorated` is the
    /// `_init` temporary and the index of the member's initializer list.
    fn storage_init_effects(
        &mut self,
        storage: Ref,
        initializer: Option<Expr>,
        decorated: Option<(Ref, usize)>,
        loc: bun_ast::Loc,
    ) -> BumpVec<'a, Expr> {
        let mut effects = BumpVec::<Expr>::with_capacity_in(2, self.arena);
        let (value, extra) = match decorated {
            Some((init_ref, index)) => {
                let (value, extra) = self.decorated_initializer(init_ref, index, initializer, loc);
                (value, Some(extra))
            }
            None => (
                initializer.unwrap_or_else(|| self.new_expr(E::Undefined {}, loc)),
                None,
            ),
        };
        let this = self.new_expr(E::This {}, loc);
        let storage = self.use_ref(storage, loc);
        effects.push(self.call_rt(loc, b"__privateAdd", &[this, storage, value]));
        effects.extend(extra);
        effects
    }

    /// `function() { return __privateGet(this, storage) }`
    fn accessor_getter(&mut self, storage: Ref, loc: bun_ast::Loc) -> Expr {
        let this = self.new_expr(E::This {}, loc);
        let storage = self.use_ref(storage, loc);
        let get = self.call_rt(loc, b"__privateGet", &[this, storage]);
        let body = self
            .arena
            .alloc_slice_copy(&[self.s(S::Return { value: Some(get) }, loc)]);
        let func = G::Fn {
            body: G::FnBody {
                stmts: bun_ast::StoreSlice::new_mut(body),
                loc,
            },
            ..Default::default()
        };
        self.new_expr(E::Function { func }, loc)
    }

    /// `function(v) { __privateSet(this, storage, v) }`
    fn accessor_setter(&mut self, storage: Ref, loc: bun_ast::Loc) -> Expr {
        let param = self.new_sym(js_ast::symbol::Kind::Other, b"v");
        let this = self.new_expr(E::This {}, loc);
        let storage = self.use_ref(storage, loc);
        let value = self.use_ref(param, loc);
        let set = self.call_rt(loc, b"__privateSet", &[this, storage, value]);
        let body = self.effect_stmts(&[set], loc);
        let arg = self.arena.alloc(G::Arg {
            binding: self.b(B::Identifier { r#ref: param }, loc),
            ..Default::default()
        });
        let func = G::Fn {
            args: bun_ast::StoreSlice::new_mut(core::slice::from_mut(arg)),
            body: G::FnBody {
                stmts: bun_ast::StoreSlice::from_bump(body),
                loc,
            },
            ..Default::default()
        };
        self.new_expr(E::Function { func }, loc)
    }

    fn expr_stmt(&mut self, value: Expr, loc: bun_ast::Loc) -> Stmt {
        self.s(
            S::SExpr {
                value,
                ..Default::default()
            },
            loc,
        )
    }

    fn effect_stmts(&mut self, effects: &[Expr], loc: bun_ast::Loc) -> BumpVec<'a, Stmt> {
        let mut stmts = BumpVec::<Stmt>::with_capacity_in(effects.len(), self.arena);
        for effect in effects {
            stmts.push(self.s(
                S::SExpr {
                    value: *effect,
                    ..Default::default()
                },
                loc,
            ));
        }
        stmts
    }

    /// Runs `effects` in `constructor` right after a top-level `super()`
    /// statement returns, which is after the last instance field.
    fn run_after_super(&mut self, constructor: &mut Property, effects: &[Expr], loc: bun_ast::Loc) {
        let func = match &mut constructor.value.as_mut().unwrap().data {
            js_ast::ExprData::EFunction(f) => &mut **f,
            _ => unreachable!(),
        };
        let body: &[Stmt] = func.func.body.stmts.slice();
        let after_super = body
            .iter()
            .position(|stmt| stmt.is_super_call())
            .map_or(0, |i| i + 1);
        let mut stmts = BumpVec::<Stmt>::with_capacity_in(body.len() + effects.len(), self.arena);
        stmts.extend_from_slice(&body[..after_super]);
        stmts.extend(self.effect_stmts(effects, loc));
        stmts.extend_from_slice(&body[after_super..]);
        func.func.body.stmts = bun_ast::StoreSlice::from_bump(stmts);
    }

    /// `constructor() { super(...arguments); effects }`
    fn new_constructor(
        &mut self,
        is_derived: bool,
        effects: &[Expr],
        loc: bun_ast::Loc,
    ) -> Property {
        let mut stmts = BumpVec::<Stmt>::with_capacity_in(effects.len() + 1, self.arena);
        if is_derived {
            let arguments = self.new_sym(js_ast::symbol::Kind::Unbound, arguments_str);
            let arguments = self.new_expr(E::Identifier::init(arguments), loc);
            let spread = self.new_expr(E::Spread { value: arguments }, loc);
            let target = self.new_expr(E::Super {}, loc);
            let call = self.new_expr(
                E::Call {
                    target,
                    args: ExprNodeList::init_one(spread),
                    ..Default::default()
                },
                loc,
            );
            stmts.push(self.s(
                S::SExpr {
                    value: call,
                    ..Default::default()
                },
                loc,
            ));
        }
        stmts.extend(self.effect_stmts(effects, loc));
        let func = G::Fn {
            body: G::FnBody {
                loc,
                stmts: bun_ast::StoreSlice::from_bump(stmts),
            },
            ..Default::default()
        };
        Property {
            flags: Flags::Property::IsMethod.into(),
            key: Some(self.new_expr(E::EString::from_static(b"constructor"), loc)),
            value: Some(self.new_expr(E::Function { func }, loc)),
            ..Default::default()
        }
    }
}
