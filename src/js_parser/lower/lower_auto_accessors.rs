//! Lowering for `accessor` class fields in classes that do not go through the
//! standard decorator lowering, i.e. TypeScript files compiled with
//! `experimentalDecorators` / `emitDecoratorMetadata`. Mirrors what tsc emits:
//!
//! ```ts
//! class A { @dec accessor x = 1 }
//! // becomes
//! class A {
//!   #x_accessor_storage = 1;
//!   get x() { return this.#x_accessor_storage; }
//!   set x(v) { this.#x_accessor_storage = v; }
//! }
//! ```
//!
//! The accessor's legacy decorators move onto the getter, so `lower_class`
//! decorates the name as an accessor (`__legacyDecorateClassTS(..., null)`),
//! and the declared type becomes the getter's return type so
//! `emitDecoratorMetadata` still reports it as `design:type`.

use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt;

use crate::lexer as js_lexer;
use crate::p::P;
use crate::parser::Ref;
use bun_ast::g::{DeclList, Property, PropertyKind};
use bun_ast::{self as js_ast, B, E, Expr, ExprData, Flags, G, S};

type BumpVec<'a, T> = bun_alloc::ArenaVec<'a, T>;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Replaces every auto-accessor in `class` with its storage field and
    /// getter/setter pair. Must run while the class body scope is the current
    /// scope: the storage field is declared as a private member of it.
    pub(crate) fn lower_auto_accessors(&mut self, class: &mut G::Class) {
        let accessor_count = class
            .properties
            .iter()
            .filter(|prop| prop.kind == PropertyKind::AutoAccessor)
            .count();
        if accessor_count == 0 {
            return;
        }

        let old_properties = class.properties.slice_mut();
        let mut properties = BumpVec::<Property>::with_capacity_in(
            old_properties.len() + 2 * accessor_count,
            self.arena,
        );
        for slot in old_properties.iter_mut() {
            let prop = core::mem::take(slot);
            if prop.kind == PropertyKind::AutoAccessor {
                self.lower_auto_accessor(prop, &mut properties);
            } else {
                properties.push(prop);
            }
        }
        class.properties = js_ast::StoreSlice::from_bump(properties);
    }

    fn lower_auto_accessor(&mut self, prop: Property, out: &mut BumpVec<'a, Property>) {
        let key = prop.key.expect("auto-accessor fields always have a key");
        let loc = key.loc;
        let is_static = prop.flags.contains(Flags::Property::IsStatic);

        let storage_ref = self.declare_auto_accessor_storage(key, is_static);
        let storage_key = self.new_expr(E::PrivateIdentifier { ref_: storage_ref }, loc);
        out.push(Property {
            key: Some(storage_key),
            initializer: prop.initializer,
            flags: prop.flags & Flags::Property::IsStatic,
            ..Default::default()
        });

        // A computed key must only be evaluated once, so the getter evaluates it
        // into a temporary that the setter reuses: `get [_k = key]()`, `set [_k](v)`.
        let (getter_key, setter_key) = if prop.flags.contains(Flags::Property::IsComputed)
            && !matches!(key.data, ExprData::EString(_) | ExprData::ENumber(_))
        {
            let tmp_ref = self.declare_hoisted_temp(b"_computedKey", loc);
            self.record_usage(tmp_ref);
            self.record_usage(tmp_ref);
            (
                Expr::assign(Expr::init_identifier(tmp_ref, loc), key),
                Expr::init_identifier(tmp_ref, loc),
            )
        } else {
            (key, key)
        };

        let mut method_flags = prop.flags;
        method_flags.insert(Flags::Property::IsMethod);

        // get key() { return this.#storage; }
        self.record_usage(storage_ref);
        let read = self.auto_accessor_storage_access(storage_ref, loc);
        let return_stmt = self.s(S::Return { value: Some(read) }, loc);
        let getter = G::Fn {
            body: G::FnBody {
                stmts: js_ast::StoreSlice::new_mut(self.arena.alloc_slice_copy(&[return_stmt])),
                loc,
            },
            return_ts_metadata: prop.ts_metadata,
            ..Default::default()
        };
        out.push(Property {
            kind: PropertyKind::Get,
            flags: method_flags,
            key: Some(getter_key),
            value: Some(self.new_expr(E::Function { func: getter }, loc)),
            ts_decorators: prop.ts_decorators,
            ..Default::default()
        });

        // set key(v) { this.#storage = v; }
        let value_ref = self.new_symbol(js_ast::symbol::Kind::Other, b"v");
        VecExt::append(&mut self.current_scope_mut().generated, value_ref);
        self.record_usage(value_ref);
        self.record_usage(storage_ref);
        let write = self.auto_accessor_storage_access(storage_ref, loc);
        let assign_stmt = js_ast::Stmt::assign(write, Expr::init_identifier(value_ref, loc));
        let value_binding = self.b(B::Identifier { r#ref: value_ref }, loc);
        let value_arg = self.arena.alloc(G::Arg {
            binding: value_binding,
            ..Default::default()
        });
        let setter = G::Fn {
            args: js_ast::StoreSlice::new_mut(core::slice::from_mut(value_arg)),
            body: G::FnBody {
                stmts: js_ast::StoreSlice::new_mut(self.arena.alloc_slice_copy(&[assign_stmt])),
                loc,
            },
            ..Default::default()
        };
        out.push(Property {
            kind: PropertyKind::Set,
            flags: method_flags,
            key: Some(setter_key),
            value: Some(self.new_expr(E::Function { func: setter }, loc)),
            ..Default::default()
        });
    }

    /// Declares the `#<name>_accessor_storage` private field backing an accessor
    /// in the class body scope. Paths that skip the renamer (runtime transpiler,
    /// `Bun.Transpiler`, `bun build --no-bundle`) print private names verbatim,
    /// so the name is checked against the members the class already declares.
    fn declare_auto_accessor_storage(&mut self, key: Expr, is_static: bool) -> Ref {
        let base: &[u8] = match key.data {
            ExprData::EString(mut str) => {
                let text = str.slice(self.arena);
                if js_lexer::is_identifier(text) {
                    text
                } else {
                    b""
                }
            }
            ExprData::EPrivateIdentifier(private) => &self.load_name_from_ref(private.ref_)[1..],
            _ => b"",
        };

        let mut underscores: usize = 0;
        let name: &'a [u8] = loop {
            let mut candidate = BumpVec::<u8>::with_capacity_in(
                1 + underscores + base.len() + b"_accessor_storage".len(),
                self.arena,
            );
            candidate.push(b'#');
            candidate.extend(core::iter::repeat_n(b'_', underscores));
            candidate.extend_from_slice(base);
            candidate.extend_from_slice(b"_accessor_storage");
            let candidate = candidate.into_bump_slice();
            if !self.current_scope().members.contains_key(candidate) {
                break candidate;
            }
            underscores += 1;
        };

        let kind = if is_static {
            js_ast::symbol::Kind::PrivateStaticField
        } else {
            js_ast::symbol::Kind::PrivateField
        };
        let storage_ref = self
            .declare_symbol(kind, key.loc, name)
            .expect("private names are never reserved words");
        self.record_declared_symbol(storage_ref);
        storage_ref
    }

    /// `this.#storage`
    fn auto_accessor_storage_access(&mut self, storage_ref: Ref, loc: bun_ast::Loc) -> Expr {
        let target = self.new_expr(E::This {}, loc);
        let index = self.new_expr(E::PrivateIdentifier { ref_: storage_ref }, loc);
        self.new_expr(
            E::Index {
                target,
                index,
                optional_chain: None,
            },
            loc,
        )
    }

    /// Creates a temporary in the nearest scope that `var` declarations hoist to
    /// and emits its `var` declaration in front of the statement being visited.
    fn declare_hoisted_temp(&mut self, name: &'static [u8], loc: bun_ast::Loc) -> Ref {
        let mut scope = self.current_scope_ref();
        while !scope.kind_stops_hoisting() {
            scope = scope.parent.expect("the module scope stops hoisting");
        }
        let tmp_ref = self.generate_temp_ref_with_scope(Some(name), scope);
        self.declared_symbols
            .append(bun_ast::DeclaredSymbol {
                ref_: tmp_ref,
                is_top_level: scope == self.module_scope_ref(),
            })
            .expect("oom");

        let binding = self.b(B::Identifier { r#ref: tmp_ref }, loc);
        let decl = self.s(
            S::Local {
                decls: DeclList::from_slice(&[G::Decl {
                    binding,
                    value: None,
                }]),
                ..Default::default()
            },
            loc,
        );
        self.nearest_stmt_list_mut()
            .expect("classes are only visited from within a statement list")
            .push(decl);
        tmp_ref
    }
}
