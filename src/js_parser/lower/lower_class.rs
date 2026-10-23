//! What TypeScript adds to classes: parameter properties, `useDefineForClassFields: false` and
//! `experimentalDecorators`. The output runs like that of the TypeScript compiler for `target: "esnext"`.

use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt as _;

use crate::lower::decorator_metadata::{AccessorPair, accessor_pair};
use crate::lower::lower_decorators::insert_after_super;
use crate::p::P;
use crate::parser::{Ref, TempRef};
use bun_ast::g::PropertyKind;
use bun_ast::{self as js_ast, E, Expr, ExprNodeList, Flags, G, S, Stmt, StoreRef};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

/// Block scoped, so that a class evaluated in a loop gets its own. Its constructor and methods read them later.
const CLASS_TEMPS: js_ast::s::Kind = js_ast::s::Kind::KLet;

/// The function of `constructor() {}`, if `prop` is that.
fn constructor_function(prop: &G::Property) -> Option<StoreRef<E::Function>> {
    let is_constructor = prop.kind == PropertyKind::Normal
        && prop.flags.contains(Flags::Property::IsMethod)
        && !prop.flags.contains(Flags::Property::IsComputed)
        && !prop.flags.contains(Flags::Property::IsStatic)
        && matches!(prop.key, Some(key) if matches!(key.data, js_ast::ExprData::EString(name) if name.eql_comptime(b"constructor")));
    if !is_constructor {
        return None;
    }
    prop.value.and_then(|value| value.data.e_function())
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

/// True if evaluating `key` again gives the same property key and does nothing else.
fn is_constant_key(key: &Expr) -> bool {
    matches!(
        key.data,
        js_ast::ExprData::EString(_) | js_ast::ExprData::ENumber(_)
    )
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

    /// Turns parameter properties into fields. With `useDefineForClassFields: false`, also turns `x = 1` into
    /// `this.x = 1`, in the constructor or in a static block where the field was, and removes `x;`.
    ///
    /// Runs in the scope of the class body, once the class is visited. A field with decorators stays, without its
    /// initializer, for `lower_class` to remove. `lower_class` or `declare_class_expr_temps` declares what this adds
    /// to `temp_refs_to_declare`.
    pub(crate) fn lower_class_fields(&mut self, class: &mut G::Class, is_expr: bool) {
        // Standard decorator lowering wraps field initializers where they are.
        let use_define =
            self.options.use_define_for_class_fields || class.should_lower_standard_decorators;
        let is_field = |prop: &G::Property| {
            prop.kind == PropertyKind::Normal
                && !prop.flags.contains(Flags::Property::IsMethod)
                && prop.value.is_none()
                && prop.key.is_some()
        };
        let is_parameter_property = |arg: &G::Arg| {
            arg.is_typescript_ctor_field && matches!(arg.binding.data, js_ast::b::B::BIdentifier(_))
        };
        let constructor = class.properties.iter().find_map(constructor_function);
        let args = constructor.map_or(bun_ast::StoreSlice::EMPTY, |it| it.func.args);
        if !args.iter().any(is_parameter_property)
            && (use_define || !class.properties.iter().any(is_field))
        {
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

        // The keys of the fields that are gone, to evaluate where the next key is. A constructor runs later than
        // that and more than once, so it reads its keys from variables.
        let mut keys = BumpVec::<Expr>::new_in(self.arena);
        let first_member = properties.len();

        for slot in class.properties.slice_mut().iter_mut() {
            let mut prop = core::mem::take(slot);
            let is_static = prop.flags.contains(Flags::Property::IsStatic);
            let is_computed = prop.flags.contains(Flags::Property::IsComputed);
            let is_private = matches!(
                prop.key.map(|key| key.data),
                Some(js_ast::ExprData::EPrivateIdentifier(_))
            );
            if use_define || !is_field(&prop) || (is_private && is_static) {
                if let Some(key) = prop.key.filter(|_| is_computed && !keys.is_empty()) {
                    keys.push(key);
                    prop.key = Some(Expr::join_all_with_comma(&keys));
                    keys.clear();
                }
                properties.push(prop);
                continue;
            }

            let key = prop.key.expect("infallible: a field has a key");
            let is_decorated = !is_expr && prop.ts_decorators.len_u32() > 0;
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
            // "#x;" declares the name.
            if is_private || is_decorated {
                prop.key = Some(key_ref.map_or(key, |temp| self.use_ref(temp, key.loc)));
                properties.push(prop);
            }
        }

        // No key is left to evaluate them with. Static blocks run after every key, in order.
        if !keys.is_empty() {
            properties.insert(first_member, self.make_static_block(&keys, loc));
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

    /// Declares the temporaries of the class expression `expr`: those past `temps_before`, which is how many there
    /// were before the visit pass got to it. Returns what to replace it with.
    pub(crate) fn declare_class_expr_temps(&mut self, expr: Expr, temps_before: usize) -> Expr {
        if self.temp_refs_to_declare.len() == temps_before {
            return expr;
        }
        if self.is_param_default_or_field_initializer() {
            let mut temps = BumpVec::<Ref>::new_in(self.arena);
            temps.extend(
                self.temp_refs_to_declare
                    .drain(temps_before..)
                    .map(|it| it.r#ref),
            );
            return self.with_own_bindings(expr, &temps);
        }
        let temps = self.drain_capture_temp_decls(temps_before, CLASS_TEMPS, expr.loc);
        if let Some(stmts) = self.nearest_stmt_list_mut() {
            stmts.extend(temps);
        }
        expr
    }

    /// Applies the decorators of a class statement. Returns the statements to replace it with, which declare its
    /// temporaries: those past `temps_before`, which is how many there were before the visit pass got to it.
    pub(crate) fn lower_class(&mut self, stmt: Stmt, temps_before: usize) -> &'a mut [Stmt] {
        let mut s_class: StoreRef<S::Class> = stmt.data.s_class().unwrap();
        let mut stmts = BumpVec::<Stmt>::new_in(self.arena);

        if s_class.class.should_lower_standard_decorators {
            self.lower_standard_decorators_stmt(stmt, &mut stmts);
            return stmts.into_bump_slice_mut();
        }
        if !s_class.class.has_decorators {
            stmts.extend(self.drain_capture_temp_decls(temps_before, CLASS_TEMPS, stmt.loc));
            stmts.push(stmt);
            return stmts.into_bump_slice_mut();
        }

        let use_define = self.options.use_define_for_class_fields;
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
                if is_accessor && emit_metadata {
                    if !decorators.is_empty() {
                        self.keep_imports_of_accessor(prop.kind, accessors);
                    }
                    if (func.func.args.iter()).any(|arg| arg.ts_decorators.len_u32() > 0) {
                        self.keep_imports_of_signature(&func.func);
                    }
                }

                // The decorators of a setter's parameter belong to the first accessor of the pair that has
                // decorators. In TypeScript no other one can have them.
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
                        let args = self.arena.alloc_slice_copy(&[index, *arg_decorator]);
                        let call = self.call_runtime(
                            arg_decorator.loc,
                            b"__legacyDecorateParamTS",
                            ExprNodeList::from_arena_slice(args),
                        );
                        if is_constructor {
                            s_class.class.ts_decorators.push(call);
                        } else {
                            decorators.push(call);
                        }
                    }
                }
            }

            // `lower_class_fields` left the field for its decorators.
            let is_removed = matches!(prop.kind, PropertyKind::Declare | PropertyKind::Abstract)
                || (!use_define
                    && prop.kind == PropertyKind::Normal
                    && !is_method
                    && !matches!(
                        prop.key.map(|key| key.data),
                        Some(js_ast::ExprData::EPrivateIdentifier(_))
                    ));

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
                            self.push_accessor_metadata(loc, accessors, &mut decorators);
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
                let args = self
                    .arena
                    .alloc_slice_copy(&[array, target, key, descriptor]);
                let call = self.call_runtime(
                    loc,
                    b"__legacyDecorateClassTS",
                    ExprNodeList::from_arena_slice(args),
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
            if emit_metadata {
                let constructor = constructor.as_ref().map(|it| &it.func);
                self.push_class_metadata(stmt.loc, constructor, &mut array);
            }
            let array = self.new_expr(
                E::Array {
                    items: ExprNodeList::move_from_list(array),
                    ..Default::default()
                },
                stmt.loc,
            );
            let class = self.use_ref(class_name.ref_, class_name.loc);
            let args = self.arena.alloc_slice_copy(&[array, class]);
            let mut decorated = self.call_runtime(
                stmt.loc,
                b"__legacyDecorateClassTS",
                ExprNodeList::from_arena_slice(args),
            );
            if inner_class_ref.is_symbol() {
                decorated = self.assign_to(inner_class_ref, decorated, stmt.loc);
            }
            let rebind = self.assign_to(class_name.ref_, decorated, class_name.loc);
            stmts.push(self.expr_stmt(rebind, stmt.loc));
        }

        if let Some(temps) = self.drain_capture_temp_decls(temps_before, CLASS_TEMPS, stmt.loc) {
            stmts.insert(0, temps);
        }
        stmts.into_bump_slice_mut()
    }
}
