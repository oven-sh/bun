//! Lowering for TC39 standard ES decorators.

use bun_alloc::ArenaVecExt as _;

use bun_collections::VecExt;

use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::{ARGUMENTS_STR as arguments_str, Ref, TempRef};
use bun_ast::g::{DeclList, Property, PropertyKind};
use bun_ast::{self as js_ast, B, E, Expr, ExprNodeList, Flags, G, S, Stmt};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

/// A function the lowering adds has no place in the source, so coverage can leave it out.
const GENERATED: bun_ast::Loc = bun_ast::Loc::EMPTY;

// ── Local helper types ───────────────────────────────────────────────────────

/// What a key, a decorator or the `extends` clause of a class expression does to the function around it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Suspends {
    No,
    Awaits,
    Yields,
}

/// What the lowering declares in the body scope of the class it rewrites.
struct Generated<'a> {
    class_body: js_ast::StoreRef<js_ast::Scope>,
    /// Each `#private` name added so far, with the last suffix tried for it.
    private_names: bun_collections::HashMap<&'a [u8], u32>,
    /// The parameters of the functions the lowering adds, `o` and `v`, and the scope that declares them.
    object: Option<Ref>,
    value: Option<Ref>,
    params: Option<js_ast::StoreRef<js_ast::Scope>>,
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

/// The initializer of a decorated field or accessor.
struct DecoratedInitializer {
    /// `__runInitializers(_init, n, this, initializer)`
    value: Expr,
    /// Runs the extra initializers once the member is defined.
    extra: Expr,
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

/// Whether the class of `generated` or a class around it declares the `#private` name `name`.
fn is_private_name_declared(generated: &Generated<'_>, name: &[u8]) -> bool {
    // No class can declare `#constructor`.
    if name == b"#constructor" {
        return true;
    }
    let mut scope = Some(generated.class_body);
    while let Some(current) = scope {
        if current.kind == js_ast::scope::Kind::ClassBody && current.members.contains_key(name) {
            return true;
        }
        scope = current.parent;
    }
    false
}

/// Which initializer list of `__decorateElement` a decorated accessor or field
/// gets: static accessors, instance accessors, static fields, instance fields.
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

/// Puts `inserted` after the last instance field; false where a derived constructor has no `super()` statement.
fn insert_after_fields<'a>(
    constructor: &mut Property,
    is_derived: bool,
    inserted: &[Stmt],
    arena: &'a bun_alloc::Arena,
) -> bool {
    let func = match &mut constructor.value.as_mut().unwrap().data {
        js_ast::ExprData::EFunction(f) => &mut **f,
        _ => unreachable!(),
    };
    let body: &[Stmt] = func.func.body.stmts.slice();
    let after_fields = if is_derived {
        match body.iter().position(|stmt| stmt.is_super_call()) {
            Some(super_call) => super_call + 1,
            None => return false,
        }
    } else {
        0
    };
    let mut stmts = BumpVec::<'a, Stmt>::with_capacity_in(body.len() + inserted.len(), arena);
    stmts.extend_from_slice(&body[..after_fields]);
    stmts.extend_from_slice(inserted);
    stmts.extend_from_slice(&body[after_fields..]);
    func.func.body.stmts = bun_ast::StoreSlice::from_bump(stmts);
    true
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

    fn accessor_storage_name(&self, prefix: &[u8], key: Option<Expr>) -> &'a [u8] {
        if let Some(key) = key
            && let js_ast::ExprData::EString(s) = &key.data
            && s.is_utf8()
            && js_lexer::is_identifier(&s.data)
        {
            return self.bump_name3(prefix, &s.data, b"");
        }
        self.bump_name3(prefix, b"accessor_storage", b"")
    }

    /// A `#private` name for the class of `generated` that no class around it declares.
    fn new_private_name(
        &mut self,
        generated: &mut Generated<'a>,
        base: &'a [u8],
        kind: js_ast::symbol::Kind,
    ) -> Ref {
        let mut name = base;
        let mut suffix = generated.private_names.get(base).copied().unwrap_or(0);
        if suffix > 0 || is_private_name_declared(generated, base) {
            suffix = suffix.max(1);
            loop {
                suffix += 1;
                name =
                    bun_alloc::arena_format!(in self.arena, "{}{}", bstr::BStr::new(base), suffix)
                        .into_bump_str()
                        .as_bytes();
                if !generated.private_names.contains_key(name)
                    && !is_private_name_declared(generated, name)
                {
                    break;
                }
            }
            generated.private_names.insert(name, 1);
        }
        generated.private_names.insert(base, suffix.max(1));
        let ref_ = self.new_symbol(kind, name);
        VecExt::append(&mut generated.class_body.generated, ref_);
        ref_
    }

    /// A parameter of the functions the lowering adds, in a scope below every name the class declares.
    fn new_param(&mut self, generated: &mut Generated<'a>, name: &'static [u8]) -> Ref {
        let mut scope = match generated.params {
            Some(scope) => scope,
            None => {
                let mut class_body = generated.class_body;
                let scope = js_ast::StoreRef::from(core::ptr::NonNull::from(self.arena.alloc(
                    js_ast::Scope {
                        kind: js_ast::scope::Kind::FunctionArgs,
                        parent: Some(class_body),
                        strict_mode: class_body.strict_mode,
                        ..js_ast::Scope::EMPTY
                    },
                )));
                VecExt::append(&mut class_body.children, scope);
                generated.params = Some(scope);
                scope
            }
        };
        let param = self.new_symbol(js_ast::symbol::Kind::Other, name);
        VecExt::append(&mut scope.generated, param);
        param
    }

    fn object_param(&mut self, generated: &mut Generated<'a>) -> Ref {
        if let Some(param) = generated.object {
            return param;
        }
        let param = self.new_param(generated, b"o");
        generated.object = Some(param);
        param
    }

    fn value_param(&mut self, generated: &mut Generated<'a>) -> Ref {
        if let Some(param) = generated.value {
            return param;
        }
        let param = self.new_param(generated, b"v");
        generated.value = Some(param);
        param
    }

    fn private_member(&mut self, target: Expr, name: Ref, l: bun_ast::Loc) -> Expr {
        self.record_usage(name);
        let index = self.new_expr(E::PrivateIdentifier { ref_: name }, l);
        self.new_expr(
            E::Index {
                target,
                index,
                optional_chain: None,
                is_import_property_use: false,
            },
            l,
        )
    }

    fn member(&mut self, target: Expr, name: &'static [u8], l: bun_ast::Loc) -> Expr {
        self.new_expr(
            E::Dot {
                target,
                name: name.into(),
                name_loc: l,
                ..Default::default()
            },
            l,
        )
    }

    fn call(&mut self, callee: Expr, args: &[Expr], l: bun_ast::Loc) -> Expr {
        self.new_expr(
            E::Call {
                target: callee,
                args: ExprNodeList::from_arena_slice(self.arena.alloc_slice_copy(args)),
                ..Default::default()
            },
            l,
        )
    }

    fn arrow_returning(&mut self, params: &[Ref], value: Expr) -> Expr {
        let arena = self.arena;
        let args = arena.alloc_slice_fill_iter(params.iter().map(|&param| G::Arg {
            binding: self.b(B::Identifier { r#ref: param }, GENERATED),
            ..Default::default()
        }));
        let body = arena.alloc_slice_copy(&[self.s(S::Return { value: Some(value) }, GENERATED)]);
        self.new_expr(
            E::Arrow {
                args: bun_ast::StoreSlice::new_mut(args),
                body: G::FnBody {
                    stmts: bun_ast::StoreSlice::new_mut(body),
                    loc: GENERATED,
                },
                prefer_expr: true,
                ..Default::default()
            },
            GENERATED,
        )
    }

    /// The object `__decorateElement` reaches `#name` through: `{ has: o => #name in o, ...rest }`.
    fn private_access_object<const N: usize>(
        &mut self,
        name: Ref,
        rest: [Property; N],
        is_single_line: bool,
        generated: &mut Generated<'a>,
    ) -> Expr {
        let object = self.object_param(generated);
        self.record_usage(name);
        let left = self.new_expr(E::PrivateIdentifier { ref_: name }, GENERATED);
        let right = self.use_ref(object, GENERATED);
        let has = self.new_expr(
            E::Binary {
                op: js_ast::OpCode::BinIn,
                left,
                right,
            },
            GENERATED,
        );
        let has = self.arrow_returning(&[object], has);
        let mut properties = bun_alloc::AstAlloc::vec();
        VecExt::append(&mut properties, self.object_property(b"has", has));
        for property in rest {
            VecExt::append(&mut properties, property);
        }
        self.new_expr(
            E::Object {
                properties,
                is_single_line,
                ..Default::default()
            },
            GENERATED,
        )
    }

    fn object_property(&mut self, key: &'static [u8], value: Expr) -> Property {
        Property {
            key: Some(self.new_expr(E::EString::from_static(key), GENERATED)),
            value: Some(value),
            ..Default::default()
        }
    }

    /// For a decorated method, getter or setter `#name`: `{ has: o => #name in o }`
    fn private_brand(&mut self, name: Ref, generated: &mut Generated<'a>) -> Expr {
        self.private_access_object(name, [], true, generated)
    }

    /// For a decorated field: `{ has, get: o => o.#name, set: (o, v) => o.#name = v }`, as a WeakMap has.
    fn private_field_access(&mut self, name: Ref, generated: &mut Generated<'a>) -> Expr {
        let object = self.object_param(generated);
        let assigned = self.value_param(generated);
        let target = self.use_ref(object, GENERATED);
        let get = self.private_member(target, name, GENERATED);
        let get = self.arrow_returning(&[object], get);
        let target = self.use_ref(object, GENERATED);
        let member = self.private_member(target, name, GENERATED);
        let set = Expr::assign(member, self.use_ref(assigned, GENERATED));
        let set = self.arrow_returning(&[object, assigned], set);
        let rest = [
            self.object_property(b"get", get),
            self.object_property(b"set", set),
        ];
        self.private_access_object(name, rest, true, generated)
    }

    /// For a decorated `accessor #name`: `{ has, get "#name"() { return this.#storage }, set "#name"(v) {} }`.
    fn private_accessor_access(
        &mut self,
        name: Ref,
        storage: Ref,
        generated: &mut Generated<'a>,
    ) -> Expr {
        let text: &'a [u8] = self.symbols[name.inner_index() as usize]
            .original_name
            .slice();
        let param = self.value_param(generated);
        let flags = Flags::PropertySet::from(Flags::Property::IsMethod);
        let rest = [
            Property {
                key: Some(self.new_expr(E::EString::init(text), GENERATED)),
                value: Some(self.accessor_getter(storage)),
                kind: PropertyKind::Get,
                flags,
                ..Default::default()
            },
            Property {
                key: Some(self.new_expr(E::EString::init(text), GENERATED)),
                value: Some(self.accessor_setter(storage, param)),
                kind: PropertyKind::Set,
                flags,
                ..Default::default()
            },
        ];
        self.private_access_object(name, rest, false, generated)
    }

    /// The member `get #name() { return value }`, or `set #name(v) { return value }` where `value` uses `setter_param`.
    fn private_accessor_member(
        &mut self,
        name: Ref,
        is_static: bool,
        setter_param: Option<Ref>,
        value: Expr,
    ) -> Property {
        let mut flags = Flags::PropertySet::from(Flags::Property::IsMethod);
        if is_static {
            flags.insert(Flags::Property::IsStatic);
        }
        let (kind, func) = match setter_param {
            Some(param) => (PropertyKind::Set, self.returning_fn(Some(param), value)),
            None => (PropertyKind::Get, self.returning_fn(None, value)),
        };
        Property {
            key: Some(self.new_expr(E::PrivateIdentifier { ref_: name }, GENERATED)),
            value: Some(func),
            kind,
            flags,
            ..Default::default()
        }
    }

    /// `function.call(this)`, or `function.call(this, argument)`
    fn call_with_this(&mut self, function: Expr, argument: Option<Ref>) -> Expr {
        let callee = self.member(function, b"call", GENERATED);
        let this = self.new_expr(E::This {}, GENERATED);
        match argument {
            Some(argument) => {
                let argument = self.use_ref(argument, GENERATED);
                self.call(callee, &[this, argument], GENERATED)
            }
            None => self.call(callee, &[this], GENERATED),
        }
    }

    /// `let` in the body of a loop, so that each evaluation of the class has its own temporaries.
    fn temps_kind(&self) -> S::Kind {
        if self.fn_or_arrow_data_visit.is_inside_loop {
            S::Kind::KLet
        } else {
            S::Kind::KVar
        }
    }

    /// Declares the temporaries declared past `baseline`; `None` if there are none.
    fn drain_temp_decls(
        &mut self,
        baseline: usize,
        kind: S::Kind,
        loc: bun_ast::Loc,
    ) -> Option<Stmt> {
        let total = self.temp_refs_to_declare.len();
        if total == baseline {
            return None;
        }
        let bump = self.arena;
        let mut decls = BumpVec::<G::Decl>::with_capacity_in(total - baseline, bump);
        for i in baseline..total {
            let temp = self.temp_refs_to_declare[i].r#ref;
            let binding = self.b(B::Identifier { r#ref: temp }, loc);
            decls.push(G::Decl {
                binding,
                value: None,
            });
        }
        self.temp_refs_to_declare.truncate(baseline);
        Some(self.s(
            S::Local {
                kind,
                decls: DeclList::from_bump_vec(decls),
                ..Default::default()
            },
            loc,
        ))
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
        let temps_before = self.temp_refs_to_declare.len();
        let class_decorators = self.lower_class_body(&mut s_class.class, stmt.loc, None);
        let kind = self.temps_kind();
        out.extend(self.drain_temp_decls(temps_before, kind, stmt.loc));
        let Some(decorators) = class_decorators else {
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

    /// `name_is_computed`: the class is the value of a computed key, which names it.
    pub(crate) fn lower_standard_decorators_expr(
        &mut self,
        expr: Expr,
        class: &mut G::Class,
        name_from_context: Option<&'a [u8]>,
        name_is_computed: bool,
        suspends: Suspends,
    ) -> Expr {
        let temps_before = self.temp_refs_to_declare.len();
        let class_decorators = self.lower_class_body(class, expr.loc, name_from_context);
        let is_decorated = class_decorators.is_some();
        let mut result = match class_decorators {
            Some(decorators) => {
                let decorated = self.use_ref(decorators.decorated, expr.loc);
                Expr::join_all_with_comma(&[
                    decorators.evaluate,
                    expr,
                    decorators.run_extra_initializers,
                    decorated,
                ])
            }
            None => expr,
        };

        // Where the list runs less often than the class, an arrow function declares the temporaries: not around a `yield`, nor under a computed key that names the class.
        let has_list = self.nearest_stmt_list_mut().is_some();
        let keeps_its_place = suspends == Suspends::Yields || (name_is_computed && !is_decorated);
        if has_list && (keeps_its_place || !self.nearest_stmt_list_is_shared) {
            let kind = self.temps_kind();
            if let Some(decl) = self.drain_temp_decls(temps_before, kind, expr.loc)
                && let Some(stmt_list) = self.nearest_stmt_list_mut()
            {
                stmt_list.push(decl);
            }
        } else if let Some(decl) = self.drain_temp_decls(temps_before, S::Kind::KVar, expr.loc) {
            // The arrow function is between the class and what gave it a name.
            if !is_decorated && let Some(name) = name_from_context {
                let key = self.new_expr(E::EString::init(name), expr.loc);
                result = self.hosted_initializer(Some(result), FieldName::Key(key), expr.loc);
            }
            // An `await` makes it `(await (async () => { ...; return [class] })())[0]`: a class can have a `then`.
            let is_async = suspends == Suspends::Awaits;
            if is_async {
                result = self.new_expr(
                    E::Array {
                        items: ExprNodeList::from_arena_slice(
                            self.arena.alloc_slice_copy(&[result]),
                        ),
                        is_single_line: true,
                        ..Default::default()
                    },
                    expr.loc,
                );
            }
            let returned = self.s(
                S::Return {
                    value: Some(result),
                },
                expr.loc,
            );
            let body = self.arena.alloc_slice_copy(&[decl, returned]);
            let arrow = self.new_expr(
                E::Arrow {
                    body: G::FnBody {
                        stmts: bun_ast::StoreSlice::new_mut(body),
                        loc: expr.loc,
                    },
                    is_async,
                    ..Default::default()
                },
                expr.loc,
            );
            result = self.call(arrow, &[], expr.loc);
            if is_async {
                let target = self.new_expr(E::Await { value: result }, expr.loc);
                let index = self.new_expr(E::Number::new(0.0), expr.loc);
                result = self.new_expr(
                    E::Index {
                        target,
                        index,
                        optional_chain: None,
                        is_import_property_use: false,
                    },
                    expr.loc,
                );
            }
        }
        result
    }

    // ── Core lowering ────────────────────────────────────

    /// Rewrites `class` in place. Members stay where they are written, so
    /// fields, static blocks, `this`, `super` and `#private` names keep their
    /// native behavior; what the runtime helpers need is added around them.
    /// Decorator lists are evaluated in the key of their member and applied by
    /// a leading `static {}`. What has to run between two instance fields rides
    /// in the initializer of the next one, or the constructor after the last.
    /// A decorated `#private` member stays a member too: the helpers reach it through an object of arrows.
    #[allow(clippy::too_many_lines)]
    fn lower_class_body(
        &mut self,
        class: &mut G::Class,
        loc: bun_ast::Loc,
        name_from_context: Option<&'a [u8]>,
    ) -> Option<ClassDecorators> {
        let p = self;
        let bump = p.arena;
        let mut generated = Generated {
            class_body: p
                .visited_class_body
                .take()
                .expect("visit_class ran for this class"),
            private_names: bun_collections::HashMap::default(),
            object: None,
            value: None,
            params: None,
        };

        let class_decorators: ExprNodeList = bun_alloc::AstAlloc::take(&mut class.ts_decorators);
        let has_class_decorators = class_decorators.len_u32() > 0;

        // `__decorateElement` numbers the initializer lists of accessors and
        // fields in the order it is called: static accessors, instance
        // accessors, static fields, instance fields.
        let mut next_initializer = [0usize; 4];
        let mut has_member_decorators = false;
        for prop in class.properties.slice() {
            if prop.ts_decorators.len_u32() == 0 {
                continue;
            }
            has_member_decorators = true;
            if let Some(group) = initializer_group(prop) {
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
        let mut decorate: [BumpVec<'a, Expr>; 4] = [
            BumpVec::new_in(bump),
            BumpVec::new_in(bump),
            BumpVec::new_in(bump),
            BumpVec::new_in(bump),
        ];

        for slot in class.properties.slice_mut().iter_mut() {
            let mut prop = core::mem::take(slot);
            if prop.kind == PropertyKind::ClassStaticBlock {
                members.push(prop);
                continue;
            }

            let key = prop.key.expect("a class member has a key");
            let private_ref = match &key.data {
                js_ast::ExprData::EPrivateIdentifier(private) => Some(private.ref_),
                _ => None,
            };
            let decorators: ExprNodeList = bun_alloc::AstAlloc::take(&mut prop.ts_decorators);
            // An undecorated `accessor #x` behaves like the field `#x`.
            if private_ref.is_some()
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
                kind + if is_static { 8 } else { 0 } + if private_ref.is_some() { 16 } else { 0 },
            );
            let group = usize::from(!is_static) + if kind == 5 { 2 } else { 0 };

            let dec_ref = if decorators.len_u32() > 0 {
                let dec = p.declared_temp(b"_dec");
                let list = p.new_expr(
                    E::Array {
                        items: decorators,
                        ..Default::default()
                    },
                    key.loc,
                );
                key_effects.push(p.assign_to(dec, list, key.loc));
                Some(dec)
            } else {
                None
            };

            // ── A decorated `#private` method, getter or setter ──
            if is_method
                && let Some(private_ref) = private_ref
                && let Some(dec) = dec_ref
            {
                let private_name: &'a [u8] = p.symbols[private_ref.inner_index() as usize]
                    .original_name
                    .slice();
                let suffix: &[u8] = match kind {
                    2 => b"_get",
                    3 => b"_set",
                    _ => b"_fn",
                };
                let function = p.declared_temp(p.bump_name3(b"_", &private_name[1..], suffix));
                let body = prop.value.expect("a method has a value");

                // The name gives what the decorators returned.
                let decorated = p.use_ref(function, GENERATED);
                let (setter_param, value) = match kind {
                    2 => (None, p.call_with_this(decorated, None)),
                    3 => {
                        let param = p.value_param(&mut generated);
                        (Some(param), p.call_with_this(decorated, Some(param)))
                    }
                    _ => (None, decorated),
                };
                members.push(p.private_accessor_member(
                    private_ref,
                    is_static,
                    setter_param,
                    value,
                ));

                let name_expr = p.new_expr(E::EString::init(private_name), loc);
                let target = p.private_brand(private_ref, &mut generated);
                let decorated =
                    p.decorate_element(init_ref, flags, name_expr, dec, target, Some(body), loc);
                decorate[group].push(p.assign_to(function, decorated, loc));
                continue;
            }

            // ── Fields, accessors and the members that stay as written ──
            let mut field_name = FieldName::Unknown;
            let mut name_expr = key;
            // `__decorateElement` takes `this`, or the access object of a `#private` member.
            let mut decorate_target: Option<Expr> = None;
            let mut descriptor: Option<Ref> = None;
            // The `get` and `set` follow the field, so a stack frame in them has the place of the field.
            let mut accessor_pair: Option<(Property, Property)> = None;
            let mut accessor_key_temp: Option<Option<Expr>> = None;
            if kind == 4 {
                let storage_name = match private_ref {
                    Some(private) => {
                        let name: &'a [u8] = p.symbols[private.inner_index() as usize]
                            .original_name
                            .slice();
                        p.bump_name3(b"#_", &name[1..], b"")
                    }
                    None => p.accessor_storage_name(b"#", prop.key),
                };
                let storage_kind = if is_static {
                    js_ast::symbol::Kind::PrivateStaticField
                } else {
                    js_ast::symbol::Kind::PrivateField
                };
                let storage = p.new_private_name(&mut generated, storage_name, storage_kind);
                let param = p.value_param(&mut generated);

                if let Some(private_ref) = private_ref {
                    // `get #x() { return _x_acc.get.call(this) }` and the `set`, over what the decorators return.
                    let private_name: &'a [u8] = p.symbols[private_ref.inner_index() as usize]
                        .original_name
                        .slice();
                    let descriptor_name = p.bump_name3(b"_", &private_name[1..], b"_acc");
                    let descriptor_ref = p.declared_temp(descriptor_name);
                    let getter = p.use_ref(descriptor_ref, GENERATED);
                    let getter = p.member(getter, b"get", GENERATED);
                    let value = p.call_with_this(getter, None);
                    let getter = p.private_accessor_member(private_ref, is_static, None, value);
                    let setter = p.use_ref(descriptor_ref, GENERATED);
                    let setter = p.member(setter, b"set", GENERATED);
                    let value = p.call_with_this(setter, Some(param));
                    let setter =
                        p.private_accessor_member(private_ref, is_static, Some(param), value);
                    accessor_pair = Some((getter, setter));
                    name_expr = p.new_expr(E::EString::init(private_name), loc);
                    decorate_target =
                        Some(p.private_accessor_access(private_ref, storage, &mut generated));
                    descriptor = Some(descriptor_ref);
                } else {
                    // Hosting key effects makes the getter's key computed; the setter repeats the key as it was.
                    let mut setter_flags = prop.flags;
                    setter_flags.insert(Flags::Property::IsMethod);
                    let key_temp;
                    (name_expr, key_temp) = p.host_key_effects(&mut prop, &mut key_effects, true);
                    let mut getter_flags = prop.flags;
                    getter_flags.insert(Flags::Property::IsMethod);
                    // A key that evaluates nothing has no place in the source for the getter.
                    let getter_key = if getter_flags.contains(Flags::Property::IsComputed) {
                        prop.key
                    } else {
                        Some(Expr {
                            loc: GENERATED,
                            data: key.data,
                        })
                    };
                    let getter = Property {
                        key: getter_key,
                        value: Some(p.accessor_getter(storage)),
                        kind: PropertyKind::Get,
                        flags: getter_flags,
                        ..Default::default()
                    };
                    let setter = Property {
                        key: Some(Expr {
                            loc: GENERATED,
                            data: name_expr.data,
                        }),
                        value: Some(p.accessor_setter(storage, param)),
                        kind: PropertyKind::Set,
                        flags: setter_flags,
                        ..Default::default()
                    };
                    accessor_pair = Some((getter, setter));
                    accessor_key_temp = Some(key_temp);
                    // The accessor names its function, not the storage field.
                    if dec_ref.is_none()
                        && prop
                            .initializer
                            .is_some_and(|value| value.is_anonymous_named())
                    {
                        let accessor_name = if is_constant_key(&name_expr) {
                            FieldName::Key(name_expr)
                        } else {
                            FieldName::Computed(name_expr)
                        };
                        prop.initializer =
                            Some(p.hosted_initializer(prop.initializer, accessor_name, loc));
                    }
                }

                p.record_usage(storage);
                let mut storage_flags =
                    Flags::PropertySet::from(Flags::Property::IsAccessorStorage);
                if is_static {
                    storage_flags.insert(Flags::Property::IsStatic);
                }
                prop = Property {
                    key: Some(p.new_expr(E::PrivateIdentifier { ref_: storage }, key.loc)),
                    initializer: prop.initializer,
                    flags: storage_flags,
                    ..Default::default()
                };
            } else if is_constructor(&prop) {
                constructor = Some(members.len());
            } else if let Some(private_ref) = private_ref {
                let name: &'a [u8] = p.symbols[private_ref.inner_index() as usize]
                    .original_name
                    .slice();
                name_expr = p.new_expr(E::EString::init(name), loc);
                field_name = FieldName::Key(name_expr);
                if dec_ref.is_some() {
                    decorate_target = Some(p.private_field_access(private_ref, &mut generated));
                }
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
                if is_constant_key(&name_expr) {
                    field_name = FieldName::Key(name_expr);
                } else if names_function {
                    field_name = FieldName::Computed(name_expr);
                }
            }

            let mut extra_initializer: Option<Expr> = None;
            if let Some(dec) = dec_ref {
                let target = decorate_target.unwrap_or_else(|| p.new_expr(E::This {}, loc));
                let mut decorated =
                    p.decorate_element(init_ref, flags, name_expr, dec, target, None, loc);
                if let Some(descriptor) = descriptor {
                    decorated = p.assign_to(descriptor, decorated, loc);
                }
                decorate[group].push(decorated);
                if !is_method {
                    let DecoratedInitializer { value, extra } = p.decorated_initializer(
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
            if let Some((getter, setter)) = accessor_pair {
                if let Some(key_temp) = accessor_key_temp {
                    last_key_host = Some((members.len(), key_temp));
                }
                members.push(getter);
                members.push(setter);
            }
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
        let mut instance_prologue = BumpVec::<Expr>::new_in(bump);
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

        let leading = (!leading.is_empty()).then(|| p.make_static_block(&leading, loc));

        let mut new_constructor = None;
        if !constructor_effects.is_empty() {
            let is_derived = class.extends.is_some();
            match constructor {
                Some(constructor) => {
                    let stmts = p.effect_stmts(&constructor_effects, loc);
                    if !insert_after_fields(&mut members[constructor], is_derived, &stmts, p.arena)
                    {
                        // No `super()` statement: one more field runs where `super()` returns.
                        let host = p.new_private_name(
                            &mut generated,
                            b"#_",
                            js_ast::symbol::Kind::PrivateField,
                        );
                        p.record_usage(host);
                        constructor_effects.push(p.new_expr(E::Undefined {}, loc));
                        members.push(Property {
                            key: Some(p.new_expr(E::PrivateIdentifier { ref_: host }, loc)),
                            initializer: Some(Expr::join_all_with_comma(&constructor_effects)),
                            ..Default::default()
                        });
                    }
                }
                None => {
                    new_constructor =
                        Some(p.new_constructor(is_derived, &constructor_effects, loc));
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

        class_decorators_result
    }

    /// A temporary that `drain_temp_decls` declares for the class.
    fn declared_temp(&mut self, name: &'a [u8]) -> Ref {
        let ref_ = self.generate_temp_var(name);
        self.temp_refs_to_declare.push(TempRef { r#ref: ref_ });
        ref_
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
            !prop.flags.contains(Flags::Property::IsComputed) || is_constant_key(&key);
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
        } else if !prop.flags.contains(Flags::Property::IsComputed) || is_constant_key(&key) {
            parts.extend_from_slice(effects);
            parts.push(self.key_as_value(prop, key));
        } else if let js_ast::ExprData::EBinary(comma) = &key.data
            && comma.op == js_ast::OpCode::BinComma
            && is_constant_key(&comma.right)
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
    ) -> DecoratedInitializer {
        let mut args = BumpVec::<Expr>::with_capacity_in(4, self.arena);
        args.push(self.use_ref(init_ref, loc));
        args.push(self.new_expr(E::Number::new(((4 + 2 * index) << 1) as f64), loc));
        args.push(self.new_expr(E::This {}, loc));
        args.extend(initializer);
        let value = self.call_runtime(loc, b"__runInitializers", ExprNodeList::from_bump_vec(args));
        let this = self.new_expr(E::This {}, loc);
        let extra = self.run_initializers(init_ref, (((5 + 2 * index) << 1) | 1) as f64, this, loc);
        DecoratedInitializer { value, extra }
    }

    /// `function(param) { return value }`: a call that `value` forwards to is a tail call, with no frame here.
    fn returning_fn(&mut self, param: Option<Ref>, value: Expr) -> Expr {
        let body = self
            .arena
            .alloc_slice_copy(&[self.s(S::Return { value: Some(value) }, GENERATED)]);
        let args = match param {
            Some(param) => {
                bun_ast::StoreSlice::new_mut(core::slice::from_mut(self.arena.alloc(G::Arg {
                    binding: self.b(B::Identifier { r#ref: param }, GENERATED),
                    ..Default::default()
                })))
            }
            None => bun_ast::StoreSlice::EMPTY,
        };
        let func = G::Fn {
            args,
            body: G::FnBody {
                stmts: bun_ast::StoreSlice::new_mut(body),
                loc: GENERATED,
            },
            ..Default::default()
        };
        self.new_expr(E::Function { func }, GENERATED)
    }

    fn setter_fn(&mut self, param: Ref, effect: Expr) -> Expr {
        let body = self.effect_stmts(&[effect], GENERATED);
        let arg = self.arena.alloc(G::Arg {
            binding: self.b(B::Identifier { r#ref: param }, GENERATED),
            ..Default::default()
        });
        let func = G::Fn {
            args: bun_ast::StoreSlice::new_mut(core::slice::from_mut(arg)),
            body: G::FnBody {
                stmts: bun_ast::StoreSlice::from_bump(body),
                loc: GENERATED,
            },
            ..Default::default()
        };
        self.new_expr(E::Function { func }, GENERATED)
    }

    /// `function() { return this.#storage }`
    fn accessor_getter(&mut self, storage: Ref) -> Expr {
        let this = self.new_expr(E::This {}, GENERATED);
        let get = self.private_member(this, storage, GENERATED);
        self.returning_fn(None, get)
    }

    /// `function(param) { this.#storage = param }`
    fn accessor_setter(&mut self, storage: Ref, param: Ref) -> Expr {
        let this = self.new_expr(E::This {}, GENERATED);
        let member = self.private_member(this, storage, GENERATED);
        let set = Expr::assign(member, self.use_ref(param, GENERATED));
        self.setter_fn(param, set)
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
