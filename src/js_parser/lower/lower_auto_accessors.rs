//! Lowers `accessor` members of classes that skip the standard-decorator
//! lowering (TypeScript with `experimentalDecorators`), in place:
//!
//! ```js
//! accessor x = 1;  // -> #x = 1; get x() { return this.#x; } set x(v) { this.#x = v; }
//! ```

use bun_collections::VecExt;

use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::Ref;
use bun_ast::g::{DeclList, Property, PropertyKind};
use bun_ast::{self as js_ast, B, DeclaredSymbol, E, Expr, Flags, G, S};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Call with the visited class body scope still current: the backing
    /// fields are declared in it.
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

        // `get [_computedKey = expr]() {} set [_computedKey]() {}`
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
            ..Default::default()
        });

        // set x(v) { this.#x = v; }
        // The decorators go on the setter because `lower_class` reuses the decorated
        // member's key, and the setter's is the one without the assignment.
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
            ts_decorators: bun_alloc::AstAlloc::take(&mut accessor.ts_decorators),
            ts_metadata: core::mem::take(&mut accessor.ts_metadata),
            ..Default::default()
        });
    }

    /// Private names are printed as written (only the minifier renames them), so
    /// the name must not be visible from this class body already.
    fn unused_private_name(&self, preferred: &'a [u8], generated: &[&'a [u8]]) -> &'a [u8] {
        let mut candidate = preferred;
        let mut suffix: usize = 2;
        while generated.contains(&candidate) || self.is_declared_in_enclosing_scopes(candidate) {
            candidate = self.bump_name(preferred, Some(suffix));
            suffix += 1;
        }
        candidate
    }

    /// Symbol for a `var` emitted next to the class: it lives in the scope the
    /// `var` hoists to, and the bundler's renamer only sees module-level
    /// symbols through `declared_symbols`.
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
