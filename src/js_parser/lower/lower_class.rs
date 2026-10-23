//! Parameter properties, `useDefineForClassFields: false` and `experimentalDecorators`, as TypeScript compiles them.

use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt as _;

use crate::lower::decorator_metadata::{AccessorPair, accessor_pair};
use crate::lower::lower_decorators::{
    has_super_statement, insert_after_super, is_constant_key, is_constructor,
};
use crate::p::P;
use crate::parser::TempRef;
use bun_ast::g::PropertyKind;
use bun_ast::{self as js_ast, E, Expr, ExprNodeList, Flags, G, S, Stmt, StoreRef};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

/// Block scoped, so that a class evaluated in a loop gets its own. Its constructor and methods read them later.
const CLASS_TEMP_KIND: js_ast::s::Kind = js_ast::s::Kind::KLet;

/// The function of `constructor() {}`, if `prop` is that.
fn constructor_function(prop: &G::Property) -> Option<StoreRef<E::Function>> {
    let value = prop.value.filter(|_| is_constructor(prop))?;
    value.data.e_function()
}

/// True if the class evaluates the key of `prop`. `lower_class` removes a field that is there for its decorators.
fn has_evaluated_key(prop: &G::Property) -> bool {
    prop.flags.contains(Flags::Property::IsComputed)
        && !matches!(prop.kind, PropertyKind::Declare | PropertyKind::Abstract)
}

/// True if `key` means the same in a `static {}` of its class: it has no `this`, `await` or arrow function, among others.
fn is_same_in_static_block(key: &Expr, symbols: &[js_ast::Symbol]) -> bool {
    use js_ast::ExprData as Data;
    let is_same = |expr: &Expr| is_same_in_static_block(expr, symbols);
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
        Data::EDot(dot) => is_same(&dot.target),
        Data::EIndex(index) => is_same(&index.target) && is_same(&index.index),
        Data::ECall(call) => {
            !call.is_direct_eval && is_same(&call.target) && call.args.slice().iter().all(is_same)
        }
        Data::ENew(new) => is_same(&new.target) && new.args.slice().iter().all(is_same),
        Data::ESpread(spread) => is_same(&spread.value),
        Data::EArray(array) => array.items.slice().iter().all(is_same),
        Data::EUnary(unary) => is_same(&unary.value),
        Data::EBinary(binary) => is_same(&binary.left) && is_same(&binary.right),
        Data::EIf(it) => is_same(&it.test) && is_same(&it.yes) && is_same(&it.no),
        Data::ETemplate(template) => {
            template.tag.as_ref().is_none_or(is_same)
                && template.parts().iter().all(|part| is_same(&part.value))
        }
        _ => false,
    }
}

/// True if `experimentalDecorators` assigns to the name of `class` what its decorators return.
pub(crate) fn has_experimental_class_decorators(class: &G::Class) -> bool {
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

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// `target.key` or `target[key]`
    fn member_of(&mut self, target: Expr, key: Expr, is_computed: bool) -> Expr {
        match &key.data {
            js_ast::ExprData::EString(name) if name.is_utf8() && !is_computed => self.new_expr(
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

    /// With `useDefineForClassFields: false`, `x = 1` becomes `this.x = 1`.
    pub(crate) fn lower_class_fields(&mut self, class: &mut G::Class) {
        // Standard decorator lowering wraps field initializers where they are.
        let use_define =
            self.options.use_define_for_class_fields || class.should_lower_standard_decorators;
        let is_field = |prop: &G::Property| {
            prop.kind == PropertyKind::Normal
                && !prop.flags.contains(Flags::Property::IsMethod)
                && prop.value.is_none()
                && prop.key.is_some()
        };
        let is_private = |prop: &G::Property| {
            matches!(
                prop.key.map(|key| key.data),
                Some(js_ast::ExprData::EPrivateIdentifier(_))
            )
        };
        let is_parameter_property = |arg: &G::Arg| {
            arg.is_typescript_ctor_field && matches!(arg.binding.data, js_ast::b::B::BIdentifier(_))
        };
        let constructor = class.properties.iter().find_map(constructor_function);
        let args = constructor.map_or(bun_ast::StoreSlice::EMPTY, |it| it.func.args);
        // Without a `super()` statement to follow, the constructor has no place for initializers.
        let has_no_place = class.extends.is_some()
            && constructor.is_some_and(|it| !has_super_statement(it.func.body.stmts.slice()));
        let is_static = |prop: &G::Property| prop.flags.contains(Flags::Property::IsStatic);
        let is_assignable = |prop: &G::Property| {
            is_field(prop)
                && match is_static(prop) {
                    true => !is_private(prop),
                    false => !(has_no_place && prop.initializer.is_some()),
                }
        };
        let hoisted_key = |prop: &G::Property| {
            let is_computed = prop.flags.contains(Flags::Property::IsComputed);
            (prop.key).filter(|key| is_assignable(prop) && is_computed && !is_constant_key(key))
        };
        // A key is evaluated with the next key that stays, or else in a `static {}`. If it can differ there, it stays.
        let members = class.properties.slice();
        let has_place_for_temps = !self.is_param_default_or_field_initializer();
        let can_hoist_keys = |of_static: bool| {
            (members.iter().filter(|prop| is_static(prop) == of_static))
                .filter_map(hoisted_key)
                .all(|key| has_place_for_temps && is_same_in_static_block(&key, &self.symbols))
        };
        let assigns_static = !use_define && can_hoist_keys(true);
        let assigns_instance = !use_define && can_hoist_keys(false);
        // A decorator can put an accessor on the prototype, which only an assignment reaches.
        let is_decorated = |prop: &G::Property| {
            !use_define && prop.ts_decorators.len() > 0 && hoisted_key(prop).is_none()
        };
        let is_assigned = |prop: &G::Property| {
            is_assignable(prop)
                && match is_static(prop) {
                    true => assigns_static || is_decorated(prop),
                    false => assigns_instance || is_decorated(prop),
                }
        };
        if !args.iter().any(is_parameter_property) && !members.iter().any(is_assigned) {
            return;
        }

        let loc = class.body_loc;
        let mut properties = BumpVec::<G::Property>::with_capacity_in(
            class.properties.len() + args.len(),
            self.arena,
        );
        let mut in_constructor = BumpVec::<Expr>::new_in(self.arena);

        for arg in args.iter().filter(|arg| is_parameter_property(arg)) {
            let js_ast::b::B::BIdentifier(id) = arg.binding.data else {
                continue;
            };
            let (id_ref, bind_loc) = (id.r#ref, arg.binding.loc);
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
            in_constructor.push(Expr::assign(dot, arg_ident));

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
        let mut keys = BumpVec::<Expr>::new_in(self.arena);

        for slot in class.properties.slice_mut().iter_mut() {
            let mut prop = core::mem::take(slot);
            let is_static = is_static(&prop);
            let is_computed = prop.flags.contains(Flags::Property::IsComputed);
            let is_private = is_private(&prop);
            if !is_assigned(&prop) {
                if let Some(key) = prop
                    .key
                    .filter(|_| has_evaluated_key(&prop) && !keys.is_empty())
                {
                    keys.push(key);
                    prop.key = Some(Expr::join_all_with_comma(&keys));
                    keys.clear();
                }
                properties.push(prop);
                continue;
            }

            let key = prop.key.expect("infallible: a field has a key");
            let is_decorated = !is_private && prop.ts_decorators.len_u32() > 0;
            let initializer = prop.initializer.take();
            let mut key_ref = None;
            if is_computed && !is_constant_key(&key) {
                if initializer.is_some() || is_decorated {
                    let temp = self.declared_temp(b"_a");
                    keys.push(self.assign_to(temp, key, key.loc));
                    key_ref = Some(temp);
                } else {
                    keys.push(key);
                }
            }

            if let Some(initializer) = initializer {
                let this = self.new_expr(E::This {}, key.loc);
                let key = key_ref.map_or(key, |temp| self.use_ref(temp, key.loc));
                let target = self.member_of(this, key, is_computed);
                let assign = Expr::assign(target, initializer);
                if is_static {
                    properties.push(self.make_static_block(&[assign], key.loc));
                } else {
                    in_constructor.push(assign);
                }
            }
            if is_decorated {
                prop.kind = PropertyKind::Declare;
                prop.key = Some(key_ref.map_or(key, |temp| self.use_ref(temp, key.loc)));
            }
            // "#x;" declares the name.
            if is_private || is_decorated {
                properties.push(prop);
            }
        }

        if !keys.is_empty() {
            properties.insert(0, self.make_static_block(&keys, loc));
        }

        if !in_constructor.is_empty() {
            match constructor {
                Some(mut constructor) => {
                    let stmts = self.effect_stmts(&in_constructor, loc);
                    insert_after_super(&mut constructor.func, &stmts, self.arena);
                }
                None => {
                    let is_derived = class.extends.is_some();
                    properties.insert(0, self.new_constructor(is_derived, &in_constructor, loc));
                }
            }
        }
        class.properties = bun_ast::StoreSlice::from_bump(properties);
    }

    /// Declares the temporaries of a class expression.
    pub(crate) fn declare_class_expr_temps(&mut self, loc: bun_ast::Loc) {
        let temps = self.drain_capture_temp_decls(0, CLASS_TEMP_KIND, loc);
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
            if let Some(temps) = self.drain_capture_temp_decls(0, CLASS_TEMP_KIND, stmt.loc) {
                stmts.insert(0, temps);
            }
            return stmts.into_bump_slice_mut();
        }

        let emit_metadata = self.options.features.emit_decorator_metadata;
        let class_name = s_class.class.class_name.unwrap();
        let body_loc = s_class.class.body_loc;

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
            let mut decorators = BumpVec::<Expr>::new_in(self.arena);
            decorators.extend_from_slice(prop.ts_decorators.slice());
            let accessors = accessor_pairs[index];
            let is_accessor = matches!(prop.kind, PropertyKind::Get | PropertyKind::Set);
            let is_method = prop.flags.contains(Flags::Property::IsMethod);
            let is_static = prop.flags.contains(Flags::Property::IsStatic);
            // `None` for a method that the visit pass skipped after a stack overflow.
            let function = prop
                .value
                .filter(|_| is_method)
                .and_then(|value| value.data.e_function());
            let is_constructor = constructor_function(prop).is_some();
            // `lower_class_fields` puts the one it adds where the class body starts.
            if is_constructor && prop.key.is_some_and(|key| key.loc != body_loc) {
                constructor = function;
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
                let mut key = prop.key.expect("infallible: prop has key");
                let loc = key.loc;
                if !is_removed
                    && prop.flags.contains(Flags::Property::IsComputed)
                    && !is_constant_key(&key)
                {
                    let temp = self.declared_temp(b"_a");
                    prop.key = Some(self.assign_to(temp, key, loc));
                    key = self.use_ref(temp, loc);
                }

                let descriptor: Expr = if is_method {
                    self.new_expr(E::Null {}, loc)
                } else {
                    self.new_expr(E::Undefined {}, loc)
                };
                let class = self.use_ref(class_name.ref_, class_name.loc);
                let target: Expr = if is_static {
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
                if is_static {
                    static_decorators.push(call);
                } else {
                    instance_decorators.push(call);
                }
            }

            if !is_removed {
                class_properties.push(core::mem::take(prop));
            }
        }

        let inner_class_ref = s_class.class.inner_class_ref;
        if inner_class_ref.is_symbol() {
            self.temp_refs_to_declare.push(TempRef {
                r#ref: inner_class_ref,
            });
            let this = self.new_expr(E::This {}, stmt.loc);
            let capture = self.assign_to(inner_class_ref, this, stmt.loc);
            class_properties.insert(0, self.make_static_block(&[capture], stmt.loc));
        }

        instance_decorators.extend_from_slice(&static_decorators);
        let member_decorators = instance_decorators;
        // Only the class body can name them.
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
            if inner_class_ref.is_symbol() {
                decorated = self.assign_to(inner_class_ref, decorated, stmt.loc);
            }
            let rebind = self.assign_to(class_name.ref_, decorated, class_name.loc);
            stmts.push(self.expr_stmt(rebind, stmt.loc));
        }

        if let Some(temps) = self.drain_capture_temp_decls(0, CLASS_TEMP_KIND, stmt.loc) {
            stmts.insert(0, temps);
        }
        stmts.into_bump_slice_mut()
    }
}
