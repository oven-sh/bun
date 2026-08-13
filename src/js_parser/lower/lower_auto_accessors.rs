//! In-place lowering of `accessor` class members (auto-accessors).
//!
//! JavaScriptCore does not implement the keyword, so every auto-accessor has
//! to be desugared. Classes that go through the standard-decorator lowering
//! (`lower_decorators.rs`) get that done there. This pass covers the classes
//! it never sees: TypeScript files compiled with `experimentalDecorators` /
//! `emitDecoratorMetadata`, whose decorators `P::lower_class` lowers instead.
//! Each accessor is replaced, at its own position in the class body, by the
//! desugaring the decorators proposal defines for it (and the one tsc emits),
//! so the order of keys and initializers is preserved and nothing leaves the
//! class body:
//!
//! ```js
//! class A { accessor x = 1; }
//! // becomes
//! class A { #x = 1; get x() { return this.#x; } set x(v) { this.#x = v; } }
//! ```
//!
//! Legacy decorators on an accessor move to the generated getter, which is
//! marked `IsLoweredAutoAccessor`. tsc decorates an auto-accessor the way it
//! decorates a getter/setter pair (the decorator receives the property
//! descriptor), which is what `lower_class` emits for a decorated method-like
//! member; the flag makes its `emitDecoratorMetadata` output describe the
//! member's declared type, as tsc's does.

use bun_collections::VecExt;

use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::Ref;
use bun_ast::g::{DeclList, Property, PropertyKind};
use bun_ast::{self as js_ast, B, DeclaredSymbol, E, Expr, Flags, G, S};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Replaces every `PropertyKind::AutoAccessor` member of `class` with a
    /// private backing field plus a getter/setter pair.
    ///
    /// Runs from `visit_class`, after the members have been visited and while
    /// the class body scope is still the current scope: the backing fields are
    /// declared in that scope, and the collision check has to see the private
    /// names of this class and of the classes enclosing it.
    pub(crate) fn lower_auto_accessors_in_place(&mut self, class: &mut G::Class) {
        let accessor_count = class
            .properties
            .iter()
            .filter(|prop| prop.kind == PropertyKind::AutoAccessor)
            .count();
        if accessor_count == 0 {
            return;
        }

        let bump = self.arena;
        let mut properties = BumpVec::<Property>::with_capacity_in(
            class.properties.len() + 2 * accessor_count,
            bump,
        );
        let mut generated_private_names =
            BumpVec::<&'a [u8]>::with_capacity_in(accessor_count, bump);
        let mut computed_key_decls = BumpVec::<G::Decl>::new_in(bump);

        for slot in class.properties.slice_mut() {
            let prop = core::mem::take(slot);
            if prop.kind == PropertyKind::AutoAccessor {
                self.lower_auto_accessor(
                    prop,
                    &mut properties,
                    &mut generated_private_names,
                    &mut computed_key_decls,
                );
            } else {
                properties.push(prop);
            }
        }
        class.properties = bun_ast::StoreSlice::from_bump(properties);

        if !computed_key_decls.is_empty() {
            let decl = self.s(
                S::Local {
                    decls: DeclList::from_bump_vec(computed_key_decls),
                    ..Default::default()
                },
                class.body_loc,
            );
            self.nearest_stmt_list_mut()
                .expect("classes are only visited from within a statement list")
                .push(decl);
        }
    }

    fn lower_auto_accessor(
        &mut self,
        mut accessor: Property,
        out: &mut BumpVec<'a, Property>,
        generated_private_names: &mut BumpVec<'a, &'a [u8]>,
        computed_key_decls: &mut BumpVec<'a, G::Decl>,
    ) {
        let key = accessor
            .key
            .expect("infallible: auto-accessors always have a key");
        let loc = key.loc;
        let is_computed = accessor.flags.contains(Flags::Property::IsComputed);
        let is_static = accessor.flags.contains(Flags::Property::IsStatic);

        let preferred_name: &'a [u8] = match &key.data {
            js_ast::ExprData::EString(name)
                if !is_computed
                    && name.is_utf8()
                    && js_lexer::is_identifier(&name.data)
                    && !name.eql_comptime(b"constructor") =>
            {
                self.bump_name2(b"#", &name.data)
            }
            // `accessor #p` keeps `#p` for its getter/setter pair.
            js_ast::ExprData::EPrivateIdentifier(private) => {
                let name = self.load_name_from_ref(private.ref_);
                self.bump_name2(b"#_", &name[1..])
            }
            _ => b"#_accessor_storage",
        };
        let backing_name = self.unused_private_name(preferred_name, generated_private_names);
        generated_private_names.push(backing_name);

        let backing_kind = if is_static {
            js_ast::symbol::Kind::PrivateStaticField
        } else {
            js_ast::symbol::Kind::PrivateField
        };
        let backing_ref = self.new_sym(backing_kind, backing_name);
        self.record_declared_symbol(backing_ref);

        // #x = <initializer>;
        let mut backing_flags = accessor.flags;
        backing_flags.remove(Flags::Property::IsComputed);
        let backing_key = self.new_expr(E::PrivateIdentifier { ref_: backing_ref }, loc);
        out.push(Property {
            kind: PropertyKind::Normal,
            flags: backing_flags,
            key: Some(backing_key),
            initializer: accessor.initializer.take(),
            ..Default::default()
        });

        // A computed key expression must still be evaluated exactly once, at
        // the accessor's position in the class body:
        //   get [_computedKey = expr]() {} set [_computedKey]() {}
        let needs_key_temp = is_computed
            && !matches!(
                key.data,
                js_ast::ExprData::EString(_) | js_ast::ExprData::ENumber(_)
            );
        let (getter_key, setter_key) = if needs_key_temp {
            let temp_ref = self.declare_var_temp_ref(b"_computedKey");
            let binding = self.b(B::Identifier { r#ref: temp_ref }, loc);
            computed_key_decls.push(G::Decl {
                binding,
                value: None,
            });
            let temp_for_getter = self.use_ref(temp_ref, loc);
            let temp_for_setter = self.use_ref(temp_ref, loc);
            (Expr::assign(temp_for_getter, key), temp_for_setter)
        } else {
            (key, key)
        };

        let mut pair_flags = accessor.flags;
        pair_flags.insert(Flags::Property::IsMethod);
        pair_flags.insert(Flags::Property::IsLoweredAutoAccessor);

        // get x() { return this.#x; }
        // The getter also takes over the member's legacy decorators and declared
        // type, so `lower_class` decorates it the way tsc decorates an accessor:
        // with the property descriptor, and with the declared type as metadata.
        let getter_value = self.backing_field_access(backing_ref, loc);
        let getter_body = self.s(
            S::Return {
                value: Some(getter_value),
            },
            loc,
        );
        let getter = G::Fn {
            body: G::FnBody {
                stmts: bun_ast::StoreSlice::new_mut(self.arena.alloc_slice_copy(&[getter_body])),
                loc,
            },
            ..Default::default()
        };
        let getter_fn = self.new_expr(E::Function { func: getter }, loc);
        out.push(Property {
            kind: PropertyKind::Get,
            flags: pair_flags,
            key: Some(getter_key),
            value: Some(getter_fn),
            ts_decorators: bun_alloc::AstAlloc::take(&mut accessor.ts_decorators),
            ts_metadata: core::mem::take(&mut accessor.ts_metadata),
            ..Default::default()
        });

        // set x(v) { this.#x = v; }
        let value_ref = self.new_sym(js_ast::symbol::Kind::Other, b"v");
        let value_binding = self.b(B::Identifier { r#ref: value_ref }, loc);
        let setter_arg = self.arena.alloc(G::Arg {
            binding: value_binding,
            ..Default::default()
        });
        let assignment_target = self.backing_field_access(backing_ref, loc);
        let assigned_value = self.use_ref(value_ref, loc);
        let setter_body = self.s(
            S::SExpr {
                value: Expr::assign(assignment_target, assigned_value),
                ..Default::default()
            },
            loc,
        );
        let setter = G::Fn {
            args: bun_ast::StoreSlice::new_mut(core::slice::from_mut(setter_arg)),
            body: G::FnBody {
                stmts: bun_ast::StoreSlice::new_mut(self.arena.alloc_slice_copy(&[setter_body])),
                loc,
            },
            ..Default::default()
        };
        let setter_fn = self.new_expr(E::Function { func: setter }, loc);
        out.push(Property {
            kind: PropertyKind::Set,
            flags: pair_flags,
            key: Some(setter_key),
            value: Some(setter_fn),
            ..Default::default()
        });
    }

    /// `preferred`, or `preferred2`, `preferred3`, ... if that spelling is
    /// taken. Private names keep their spelling unless identifiers are
    /// minified, so the generated name must differ from every private name
    /// declared by this class or by an enclosing class (code in this class
    /// body may refer to those) and from the ones generated earlier for this
    /// class.
    fn unused_private_name(&self, preferred: &'a [u8], generated: &[&'a [u8]]) -> &'a [u8] {
        let mut candidate = preferred;
        let mut suffix: usize = 2;
        while generated.contains(&candidate) || self.is_declared_in_enclosing_scopes(candidate) {
            candidate = self.bump_name(preferred, Some(suffix));
            suffix += 1;
        }
        candidate
    }

    /// Creates the symbol for a `var` that `lower_auto_accessors_in_place`
    /// declares in front of the statement containing the class. The symbol is
    /// registered in the scope such a `var` hoists to, and recorded as a
    /// top-level declaration of the current part when that scope is the module
    /// scope, so the bundler's renamer treats it like any other top-level
    /// `var` instead of letting a later file's top-level binding take the same
    /// name.
    fn declare_var_temp_ref(&mut self, name: &'a [u8]) -> Ref {
        let mut scope = self.current_scope;
        while !scope.kind_stops_hoisting() {
            scope = scope
                .parent
                .expect("infallible: the module scope stops hoisting");
        }
        let ref_ = self.generate_temp_ref_with_scope(Some(name), scope);
        self.declared_symbols
            .append(DeclaredSymbol {
                ref_,
                is_top_level: scope == self.module_scope,
            })
            .expect("oom");
        ref_
    }

    fn is_declared_in_enclosing_scopes(&self, name: &[u8]) -> bool {
        let hash = js_ast::Scope::get_member_hash(name);
        let mut scope = Some(self.current_scope);
        while let Some(current) = scope {
            if current.get_member_with_hash(name, hash).is_some() {
                return true;
            }
            scope = current.parent;
        }
        false
    }

    /// `this.#x`
    fn backing_field_access(&mut self, backing_ref: Ref, loc: bun_ast::Loc) -> Expr {
        self.record_usage(backing_ref);
        let target = self.new_expr(E::This {}, loc);
        let index = self.new_expr(E::PrivateIdentifier { ref_: backing_ref }, loc);
        self.new_expr(
            E::Index {
                target,
                index,
                optional_chain: None,
            },
            loc,
        )
    }
}
