//! Parameter properties, `useDefineForClassFields: false` and `experimentalDecorators`, as TypeScript compiles them.

use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt as _;

use crate::lower::decorator_metadata::{AccessorPair, accessor_pair};
use crate::lower::lower_decorators::{
    has_super_statement, insert_after_super, insert_stmts, is_constant_key, is_constructor,
};
use crate::p::P;
use crate::parser::TempRef;
use bun_ast::g::PropertyKind;
use bun_ast::{self as js_ast, B, E, Expr, ExprNodeList, Flags, G, Ref, S, Stmt, StoreRef};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

/// Block scoped, so that a class evaluated in a loop gets its own. Its constructor and methods read them later.
const CLASS_TEMP_KIND: js_ast::s::Kind = js_ast::s::Kind::KLet;

/// The function of `constructor() {}`, if `prop` is that.
fn constructor_function(prop: &G::Property) -> Option<StoreRef<E::Function>> {
    let value = prop.value.filter(|_| is_constructor(prop))?;
    value.data.e_function()
}

/// The parameter of `constructor(public x)`.
fn parameter_property(arg: &G::Arg) -> Option<Ref> {
    match arg.binding.data {
        js_ast::b::B::BIdentifier(id) if arg.is_typescript_ctor_field => Some(id.r#ref),
        _ => None,
    }
}

fn is_field(prop: &G::Property) -> bool {
    prop.kind == PropertyKind::Normal
        && !prop.flags.contains(Flags::Property::IsMethod)
        && prop.value.is_none()
        && prop.key.is_some()
}

fn is_static(prop: &G::Property) -> bool {
    prop.flags.contains(Flags::Property::IsStatic)
}

fn is_private(prop: &G::Property) -> bool {
    matches!(
        prop.key.map(|key| key.data),
        Some(js_ast::ExprData::EPrivateIdentifier(_))
    )
}

/// `this.name = value` throws in a class, as for the other names of `checkClassForStaticPropertyNameConflicts`.
fn initializes_function_property(prop: &G::Property) -> bool {
    let names: [&[u8]; 4] = [b"name", b"length", b"caller", b"arguments"];
    is_static(prop)
        && prop.initializer.is_some()
        && matches!(
            prop.key.map(|key| key.data),
            Some(js_ast::ExprData::EString(s)) if names.iter().any(|name| s.eql_bytes(name))
        )
}

/// True if the class evaluates the key of `prop`. `lower_class` removes a field that is there for its decorators.
fn has_evaluated_key(prop: &G::Property) -> bool {
    prop.flags.contains(Flags::Property::IsComputed)
        && !matches!(prop.kind, PropertyKind::Declare | PropertyKind::Abstract)
}

/// True if `key` has only what is listed here, which means the same in a `static {}` of its class. `this` doesn't.
fn can_move_to_static_block(key: &Expr, symbols: &[js_ast::Symbol]) -> bool {
    use js_ast::ExprData as Data;
    let can_move = |expr: &Expr| can_move_to_static_block(expr, symbols);
    match &key.data {
        Data::EIdentifier(id) => !matches!(
            symbols[id.ref_.inner_index() as usize]
                .original_name
                .slice(),
            b"arguments" | b"await"
        ),
        Data::EImportIdentifier(_)
        | Data::EPrivateIdentifier(_)
        | Data::EString(_)
        | Data::ENumber(_)
        | Data::EBigInt(_)
        | Data::EBoolean(_)
        | Data::ENull(_)
        | Data::EUndefined(_)
        | Data::ERegExp(_)
        | Data::EFunction(_) => true,
        Data::EDot(dot) => can_move(&dot.target),
        Data::EIndex(index) => can_move(&index.target) && can_move(&index.index),
        Data::ECall(call) => {
            !call.is_direct_eval && can_move(&call.target) && call.args.slice().iter().all(can_move)
        }
        Data::ENew(new) => can_move(&new.target) && new.args.slice().iter().all(can_move),
        Data::ESpread(spread) => can_move(&spread.value),
        Data::EArray(array) => array.items.slice().iter().all(can_move),
        Data::EUnary(unary) => can_move(&unary.value),
        Data::EBinary(binary) => can_move(&binary.left) && can_move(&binary.right),
        Data::EIf(it) => can_move(&it.test) && can_move(&it.yes) && can_move(&it.no),
        Data::ETemplate(template) => {
            template.tag.as_ref().is_none_or(can_move)
                && template.parts().iter().all(|part| can_move(&part.value))
        }
        _ => false,
    }
}

/// `classOrConstructorParameterIsDecorated`, with `experimentalDecorators`.
pub(crate) fn class_or_constructor_parameter_is_decorated(class: &G::Class) -> bool {
    if !class.has_decorators || class.should_lower_standard_decorators {
        return false;
    }
    let has_decorated_parameter = |func: StoreRef<E::Function>| {
        let mut args = func.func.args.iter();
        args.any(|arg| arg.ts_decorators.len_u32() > 0)
    };
    class.ts_decorators.len_u32() > 0
        || (class.properties.iter())
            .filter_map(constructor_function)
            .any(has_decorated_parameter)
}

/// For the scope of a `super()` call. `var __super` is in the body of the constructor, which the parameters don't see.
pub(crate) fn is_in_constructor_parameters(mut scope: js_ast::StoreRef<js_ast::Scope>) -> bool {
    let mut came_from = scope.kind;
    while scope
        .parent
        .is_some_and(|parent| parent.kind != js_ast::scope::Kind::ClassBody)
    {
        came_from = scope.kind;
        scope = scope.parent.unwrap();
    }
    came_from != js_ast::scope::Kind::FunctionBody
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// `target.key` or `target[key]`
    fn member_access(&mut self, target: Expr, key: Expr) -> Expr {
        match &key.data {
            js_ast::ExprData::EString(name) if name.is_utf8() && name.next.is_none() => self
                .new_expr(
                    E::Dot {
                        target,
                        name: name.data,
                        name_loc: key.loc,
                        ..Default::default()
                    },
                    key.loc,
                ),
            _ => self.new_expr(
                E::Index {
                    target,
                    index: key,
                    optional_chain: None,
                    is_import_property_use: false,
                },
                key.loc,
            ),
        }
    }

    /// Standard decorator lowering wraps field initializers where they are.
    fn defines_fields(&self, class: &G::Class) -> bool {
        self.options.use_define_for_class_fields || class.should_lower_standard_decorators
    }

    /// `__super`, if the constructor of `class` has no `super()` statement for `lower_class_fields` to add to.
    pub(crate) fn super_shim_of(&mut self, class: &G::Class) -> Ref {
        let Some(constructor) = class.properties.iter().find_map(constructor_function) else {
            return Ref::NONE;
        };
        let is_initialized =
            |prop: &G::Property| is_field(prop) && !is_static(prop) && prop.initializer.is_some();
        let adds_to_constructor = (constructor.func.args.iter())
            .any(|arg| parameter_property(arg).is_some())
            || (!self.defines_fields(class) && class.properties.iter().any(is_initialized));
        if class.extends.is_none()
            || !adds_to_constructor
            || has_super_statement(constructor.func.body.stmts.slice())
        {
            return Ref::NONE;
        }
        self.generate_temp_var(b"__super")
    }

    /// `var __super = (...args) => { super(...args); effects; return this; };`
    fn declare_super_shim(&mut self, shim: Ref, effects: &[Expr], loc: bun_ast::Loc) -> Stmt {
        let args = self.generate_temp_var(b"args");
        let spread = E::Spread {
            value: self.use_ref(args, loc),
        };
        let call = E::Call {
            target: self.new_expr(E::Super {}, loc),
            args: ExprNodeList::init_one(self.new_expr(spread, loc)),
            ..Default::default()
        };
        let call = self.new_expr(call, loc);
        let mut stmts = BumpVec::<Stmt>::with_capacity_in(effects.len() + 2, self.arena);
        stmts.push(self.expr_stmt(call, loc));
        stmts.extend(self.effect_stmts(effects, loc));
        let this = self.new_expr(E::This {}, loc);
        stmts.push(self.s(S::Return { value: Some(this) }, loc));
        let arg = G::Arg {
            binding: self.b(B::Identifier { r#ref: args }, loc),
            ..Default::default()
        };
        let arrow = E::Arrow {
            args: bun_ast::StoreSlice::new_mut(self.arena.alloc_slice_fill_iter([arg])),
            body: G::FnBody {
                loc,
                stmts: bun_ast::StoreSlice::from_bump(stmts),
            },
            has_rest_arg: true,
            ..Default::default()
        };
        let decl = G::Decl {
            binding: self.b(B::Identifier { r#ref: shim }, loc),
            value: Some(self.new_expr(arrow, loc)),
        };
        self.s(
            S::Local {
                kind: js_ast::s::Kind::KVar,
                decls: G::DeclList::init_one(decl),
                ..Default::default()
            },
            loc,
        )
    }

    /// `static { _A = this; }`: what the body of a decorated class reads until the decorators have returned.
    pub(crate) fn capture_decorated_class(&mut self, class: &mut G::Class) {
        let inner_class_ref = class.inner_class_ref;
        if class.should_lower_standard_decorators
            || !inner_class_ref.is_symbol()
            || self.symbols[inner_class_ref.inner_index() as usize].use_count_estimate == 0
        {
            return;
        }
        self.temp_refs_to_declare.push(TempRef {
            r#ref: inner_class_ref,
        });
        let loc = class.body_loc;
        let this = self.new_expr(E::This {}, loc);
        let capture = self.assign_to(inner_class_ref, this, loc);
        let mut properties =
            BumpVec::<G::Property>::with_capacity_in(class.properties.len() + 1, self.arena);
        properties.push(self.make_static_block(&[capture], loc));
        properties.extend(class.properties.slice_mut().iter_mut().map(core::mem::take));
        class.properties = bun_ast::StoreSlice::from_bump(properties);
    }

    /// `constructor(public x)` and, with `useDefineForClassFields: false`, `x = 1` become `this.x = ...`.
    pub(crate) fn lower_class_fields(&mut self, class: &mut G::Class, super_shim: Ref) {
        let use_define = self.defines_fields(class);
        let constructor = class.properties.iter().find_map(constructor_function);
        let args = constructor.map_or(bun_ast::StoreSlice::EMPTY, |it| it.func.args);
        // A private field is only assigned to keep its place among the initializers of those that aren't private.
        let has_initialized_public_field = (class.properties.iter()).any(|prop| {
            is_field(prop) && !is_static(prop) && !is_private(prop) && prop.initializer.is_some()
        });
        let can_lower_field = |prop: &G::Property| {
            is_field(prop)
                && !initializes_function_property(prop)
                && (!is_private(prop) || (!is_static(prop) && has_initialized_public_field))
        };
        let key_to_hoist = |prop: &G::Property| {
            let is_computed = prop.flags.contains(Flags::Property::IsComputed);
            (prop.key).filter(|key| can_lower_field(prop) && is_computed && !is_constant_key(key))
        };
        // A key is evaluated with the next key that stays, or else in a `static {}`. If it can't be, its fields stay.
        let has_own_stmt_list = !self.is_param_default_or_field_initializer();
        let mut lower_static_fields = !use_define;
        let mut lower_instance_fields = !use_define;
        for prop in class.properties.iter() {
            let can_hoist = key_to_hoist(prop).is_none_or(|key| {
                has_own_stmt_list && can_move_to_static_block(&key, &self.symbols)
            });
            if !can_hoist && is_static(prop) {
                lower_static_fields = false;
            } else if !can_hoist {
                lower_instance_fields = false;
            }
        }
        // A decorator can put an accessor on the prototype, which only an assignment reaches.
        let is_lowered_for_decorators = |prop: &G::Property| {
            !use_define && prop.ts_decorators.len() > 0 && key_to_hoist(prop).is_none()
        };
        let should_lower_field = |prop: &G::Property| {
            let lowers_all = if is_static(prop) {
                lower_static_fields
            } else {
                lower_instance_fields
            };
            can_lower_field(prop) && (lowers_all || is_lowered_for_decorators(prop))
        };
        if !super_shim.is_symbol()
            && !args.iter().any(|arg| parameter_property(arg).is_some())
            && !class.properties.iter().any(should_lower_field)
        {
            return;
        }

        let loc = class.body_loc;
        let mut properties = BumpVec::<G::Property>::with_capacity_in(
            class.properties.len() + args.len(),
            self.arena,
        );
        let mut constructor_effects = BumpVec::<Expr>::new_in(self.arena);

        for arg in args.iter() {
            let Some(id_ref) = parameter_property(arg) else {
                continue;
            };
            let bind_loc = arg.binding.loc;
            let name: &'a [u8] = self.symbols[id_ref.inner_index() as usize]
                .original_name
                .slice();
            let arg_ident = self.new_expr(E::Identifier::init(id_ref), bind_loc);
            let this_target = self.new_expr(E::This {}, bind_loc);
            let dot = self.new_expr(
                E::Dot {
                    target: this_target,
                    name: name.into(),
                    name_loc: bind_loc,
                    ..Default::default()
                },
                bind_loc,
            );
            constructor_effects.push(Expr::assign(dot, arg_ident));

            if use_define {
                // New symbol so renaming can't desync the field from the arg.
                let field_symbol_ref = self
                    .declare_symbol(js_ast::symbol::Kind::Other, bind_loc, name)
                    .unwrap_or(id_ref);
                self.symbols[field_symbol_ref.inner_index() as usize].set_must_not_be_renamed(true);
                let field_ident = self.new_expr(E::Identifier::init(field_symbol_ref), bind_loc);
                properties.push(G::Property {
                    key: Some(field_ident),
                    ..Default::default()
                });
            }
        }

        // The keys of the fields that are gone. The constructor runs later and more than once, so it reads variables.
        let mut pending_keys = BumpVec::<Expr>::new_in(self.arena);

        for slot in class.properties.slice_mut().iter_mut() {
            let mut prop = core::mem::take(slot);
            if !should_lower_field(&prop) {
                if has_evaluated_key(&prop) {
                    self.host_key_effects(&mut prop, &mut pending_keys, false);
                }
                properties.push(prop);
                continue;
            }

            let mut key = prop.key.expect("infallible: a field has a key");
            let is_kept_for_decorators = !is_private(&prop) && prop.ts_decorators.len_u32() > 0;
            let hoists_key = key_to_hoist(&prop).is_some();
            let initializer = prop.initializer.take();
            if hoists_key && (initializer.is_some() || is_kept_for_decorators) {
                let temp = self.declared_temp(b"_computedKey");
                pending_keys.push(self.assign_key_to(temp, key));
                key = self.use_ref(temp, key.loc);
            } else if hoists_key {
                pending_keys.push(key);
            }

            if let Some(initializer) = initializer {
                let this = self.new_expr(E::This {}, key.loc);
                let assign = Expr::assign(self.member_access(this, key), initializer);
                if is_static(&prop) {
                    properties.push(self.make_static_block(&[assign], key.loc));
                } else {
                    constructor_effects.push(assign);
                }
            }
            if is_kept_for_decorators {
                prop.kind = PropertyKind::Declare;
                prop.key = Some(key);
            }
            // "#x;" declares the name.
            if is_private(&prop) || is_kept_for_decorators {
                properties.push(prop);
            }
        }

        if !pending_keys.is_empty() {
            properties.insert(0, self.make_static_block(&pending_keys, loc));
        }

        match constructor {
            Some(mut constructor) if super_shim.is_symbol() => {
                // A constructor that never calls `super()` has no `this` to initialize.
                if self.symbols[super_shim.inner_index() as usize].use_count_estimate > 0 {
                    let shim = self.declare_super_shim(super_shim, &constructor_effects, loc);
                    insert_stmts(&mut constructor.func.body.stmts, 0, &[shim], self.arena);
                }
            }
            Some(mut constructor) => {
                let stmts = self.effect_stmts(&constructor_effects, loc);
                insert_after_super(&mut constructor.func, &stmts, self.arena);
            }
            None if constructor_effects.is_empty() => {}
            None => {
                let is_derived = class.extends.is_some();
                properties.insert(
                    0,
                    self.new_constructor(is_derived, &constructor_effects, loc),
                );
            }
        }
        class.properties = bun_ast::StoreSlice::from_bump(properties);
    }

    /// Without a renamer, an initializer now in the constructor would read the constructor's variable of the same name.
    pub(crate) fn rename_constructor_variables(
        &mut self,
        constructor_args: StoreRef<js_ast::Scope>,
        uses: core::ops::Range<usize>,
    ) {
        // `eval` finds a variable by its name.
        if constructor_args.contains_direct_eval {
            return;
        }
        let is_body =
            |scope: &&StoreRef<js_ast::Scope>| scope.kind == js_ast::scope::Kind::FunctionBody;
        let body = constructor_args
            .children
            .slice()
            .iter()
            .find(is_body)
            .copied();
        for i in uses {
            let used = self.field_initializer_uses[i];
            let name: &'a [u8] = self.symbols[used as usize].original_name.slice();
            for scope in [Some(constructor_args), body].into_iter().flatten() {
                let Some(member) = scope.members.get(name) else {
                    continue;
                };
                let variable = js_ast::symbol::follow_symbols(&self.symbols, member.ref_);
                let variable = variable.inner_index() as usize;
                if variable != used as usize && self.symbols[variable].original_name.slice() == name
                {
                    self.symbols[variable].original_name = self.numbered_name(name).into();
                }
            }
        }
    }

    fn class_temps(&mut self, loc: bun_ast::Loc) -> Option<Stmt> {
        self.drain_capture_temp_decls(0, CLASS_TEMP_KIND, loc)
    }

    /// Declares the temporaries of a class expression.
    pub(crate) fn declare_class_expr_temps(&mut self, loc: bun_ast::Loc) {
        let temps = self.class_temps(loc);
        if let Some(stmts) = self.nearest_stmt_list_mut() {
            stmts.extend(temps);
        }
    }

    /// What replaces the class statement `stmt`.
    pub(crate) fn lower_class(&mut self, stmt: Stmt) -> &'a mut [Stmt] {
        let mut s_class: StoreRef<S::Class> = stmt.data.s_class().unwrap();
        let mut stmts = BumpVec::<Stmt>::new_in(self.arena);

        if s_class.class.should_lower_standard_decorators {
            self.lower_standard_decorators_stmt(stmt, &mut stmts);
            return stmts.into_bump_slice_mut();
        }
        if !s_class.class.has_decorators {
            stmts.push(stmt);
            if let Some(temps) = self.class_temps(stmt.loc) {
                stmts.insert(0, temps);
            }
            return stmts.into_bump_slice_mut();
        }

        let emit_metadata = self.options.features.emit_decorator_metadata;
        let class_name = s_class.class.class_name.unwrap();

        let mut constructor: Option<StoreRef<E::Function>> = None;
        let mut instance_decorators = BumpVec::<Expr>::new_in(self.arena);
        let mut static_decorators = BumpVec::<Expr>::new_in(self.arena);
        let mut class_properties = BumpVec::<G::Property>::new_in(self.arena);

        let mut accessor_pairs = BumpVec::<AccessorPair>::new_in(self.arena);
        {
            let properties = s_class.class.properties.slice();
            accessor_pairs.extend((0..properties.len()).map(|i| match properties[i].kind {
                PropertyKind::Get | PropertyKind::Set => accessor_pair(properties, i),
                _ => AccessorPair::default(),
            }));
        }

        for (index, prop) in s_class.class.properties.slice_mut().iter_mut().enumerate() {
            let accessors = accessor_pairs[index];
            let is_accessor = matches!(prop.kind, PropertyKind::Get | PropertyKind::Set);
            let is_method = prop.flags.contains(Flags::Property::IsMethod);
            let mut decorators = BumpVec::<Expr>::new_in(self.arena);
            decorators.extend_from_slice(prop.ts_decorators.slice());
            // `None` for a method that the visit pass skipped after a stack overflow.
            let function = prop
                .value
                .filter(|_| is_method)
                .and_then(|value| value.data.e_function());
            let is_constructor = constructor_function(prop).is_some();
            // The one that `lower_class_fields` adds is nowhere in the source.
            if is_constructor {
                constructor = function.filter(|it| !it.func.open_parens_loc.is_empty());
            }

            if let Some(func) = function {
                if is_accessor
                    && emit_metadata
                    && (func.func.args.iter()).any(|arg| arg.ts_decorators.len_u32() > 0)
                {
                    self.keep_imports_of_signature(&func.func);
                }

                // TypeScript allows decorators on one accessor of a pair, which also gets those of the setter's parameter.
                let parameters_of = if !is_accessor {
                    Some(func)
                } else if accessors.is_first_with_decorators {
                    accessors.setter
                } else {
                    None
                };
                let args = parameters_of.map_or(&[][..], |it| it.func.args.slice());
                for (i, arg) in args.iter().enumerate() {
                    for arg_decorator in arg.ts_decorators.slice() {
                        let index = self.new_expr(E::Number::new(i as f64), arg_decorator.loc);
                        let call = self.call_rt(
                            arg_decorator.loc,
                            b"__legacyDecorateParamTS",
                            &[index, *arg_decorator],
                        );
                        if is_constructor {
                            s_class.class.ts_decorators.push(call);
                        } else {
                            decorators.push(call);
                        }
                    }
                }
            }

            let is_removed = matches!(prop.kind, PropertyKind::Declare | PropertyKind::Abstract);

            if !decorators.is_empty() {
                let loc = prop.key.expect("infallible: prop has key").loc;
                let no_effects = &mut BumpVec::<Expr>::new_in(self.arena);
                let (key, _) = self.host_key_effects(prop, no_effects, !is_removed);

                let descriptor: Expr = if is_method {
                    self.new_expr(E::Null {}, loc)
                } else {
                    self.new_expr(E::Undefined {}, loc)
                };
                let class = self.use_ref(class_name.ref_, class_name.loc);
                let target: Expr = if is_static(prop) {
                    class
                } else {
                    self.new_expr(
                        E::Dot {
                            target: class,
                            name: b"prototype".into(),
                            name_loc: loc,
                            ..Default::default()
                        },
                        loc,
                    )
                };

                if emit_metadata {
                    match function {
                        Some(_) if is_accessor => {
                            self.push_accessor_metadata(loc, prop.kind, accessors, &mut decorators);
                        }
                        Some(method) => {
                            self.push_method_metadata(loc, &method.func, &mut decorators);
                        }
                        None if !is_method => {
                            self.push_property_metadata(loc, prop.ts_metadata, &mut decorators);
                        }
                        None => {}
                    }
                }

                let array = self.new_expr(
                    E::Array {
                        items: ExprNodeList::from_bump_vec(decorators),
                        ..Default::default()
                    },
                    loc,
                );
                let call = self.call_rt(
                    loc,
                    b"__legacyDecorateClassTS",
                    &[array, target, key, descriptor],
                );
                if is_static(prop) {
                    static_decorators.push(call);
                } else {
                    instance_decorators.push(call);
                }
            }

            if !is_removed {
                class_properties.push(core::mem::take(prop));
            }
        }

        instance_decorators.extend_from_slice(&static_decorators);
        let member_decorators = instance_decorators;
        // Only the class body can use a private name.
        let in_class_body = s_class.class.decorators_use_private_name;
        if in_class_body && !member_decorators.is_empty() {
            class_properties.push(self.make_static_block(&member_decorators, stmt.loc));
        }
        s_class.class.properties = bun_ast::StoreSlice::from_bump(class_properties);

        stmts.push(stmt);
        if !in_class_body {
            stmts.extend(self.effect_stmts(&member_decorators, stmt.loc));
        }

        if s_class.class.ts_decorators.len_u32() > 0 {
            let mut array: Vec<Expr> = s_class.class.ts_decorators.move_to_list_managed();
            if let Some(constructor) = constructor.filter(|_| emit_metadata) {
                self.push_class_metadata(stmt.loc, &constructor.func, &mut array);
            }
            let array = self.new_expr(
                E::Array {
                    items: ExprNodeList::move_from_list(array),
                    ..Default::default()
                },
                stmt.loc,
            );
            let class = self.use_ref(class_name.ref_, class_name.loc);
            let mut decorated = self.call_rt(stmt.loc, b"__legacyDecorateClassTS", &[array, class]);
            let inner_class_ref = s_class.class.inner_class_ref;
            if inner_class_ref.is_symbol() {
                decorated = self.assign_to(inner_class_ref, decorated, stmt.loc);
            }
            let rebind = self.assign_to(class_name.ref_, decorated, class_name.loc);
            stmts.push(self.expr_stmt(rebind, stmt.loc));
        }

        if let Some(temps) = self.class_temps(stmt.loc) {
            stmts.insert(0, temps);
        }
        stmts.into_bump_slice_mut()
    }
}
