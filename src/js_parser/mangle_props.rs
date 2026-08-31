//! The parser half of `--mangle-props`: a mangled property becomes a
//! `Kind::MangledProp` symbol (one per name per file) referenced from
//! `E::NameOfSymbol` nodes; `LinkerContext::mangle_props` (or
//! `js_printer::mangle_props` when not bundling) picks the names. Names seen
//! but not mangled go into `reserved_props` so no generated name collides with
//! them (`{ foo_: 1, a: 2 }` must not become `{ a: 1, a: 2 }`).

use crate::p::P;
use bun_ast::{self as js_ast, E, Expr, ExprData, Ref};

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline]
    pub(crate) fn is_mangling_props(&self) -> bool {
        self.options.mangle_props.is_some()
    }

    /// Whether the property `name` is mangled; if not, it becomes reserved.
    pub(crate) fn is_mangled_prop(&mut self, name: &'a [u8]) -> bool {
        let Some(mangler) = self.options.mangle_props else {
            return false;
        };
        // The regex runs once per distinct name per file.
        if self.mangled_props.contains(name) {
            return true;
        }
        if self.unmangled_props.contains(&name) {
            return false;
        }
        if mangler.should_mangle(name) {
            return true;
        }
        self.unmangled_props.insert(name, ());
        self.reserved_props.insert(name, ());
        false
    }

    /// `name` stays in the output as written (even if it is mangled elsewhere,
    /// e.g. `x["foo_"]` next to `x.foo_`), so no property may be renamed to it.
    pub(crate) fn reserve_prop(&mut self, name: &[u8]) {
        if self.is_mangling_props() {
            self.reserved_props.insert(name, ());
        }
    }

    /// This file's symbol for the mangled property `name`; each call counts one
    /// use, which decides how short a name the property gets.
    pub(crate) fn symbol_for_mangled_prop(&mut self, name: &'a [u8]) -> Ref {
        let ref_ = match self.mangled_props.get(name) {
            Some(ref_) => *ref_,
            None => {
                let ref_ = self.new_symbol(js_ast::symbol::Kind::MangledProp, name);
                self.mangled_props.insert(name, ref_);
                ref_
            }
        };

        if !self.is_control_flow_dead && !self.is_revisit_for_substitution {
            self.symbols[ref_.inner_index() as usize].use_count_estimate += 1;
        }

        ref_
    }

    /// `Some(E::NameOfSymbol)` if the property `name` is mangled.
    pub(crate) fn mangled_prop_expr(
        &mut self,
        name: &'a [u8],
        loc: bun_ast::Loc,
        has_property_key_comment: bool,
    ) -> Option<Expr> {
        if !self.is_mangled_prop(name) {
            return None;
        }
        let ref_ = self.symbol_for_mangled_prop(name);
        Some(self.new_expr(
            E::NameOfSymbol {
                ref_,
                has_property_key_comment,
            },
            loc,
        ))
    }

    /// Key expression for an unquoted property name (object, class, binding or JSX key).
    pub(crate) fn property_key_for_name(&mut self, name: &'a [u8], loc: bun_ast::Loc) -> Expr {
        if self.is_mangling_props() {
            if let Some(key) = self.mangled_prop_expr(name, loc, false) {
                return key;
            }
        }
        self.new_expr(E::EString::init(name), loc)
    }

    /// A string literal in a property position (quoted key, index, `in`): mangled
    /// with `mangle_quoted`, reserved otherwise. Other expressions pass through.
    pub(crate) fn mangle_string_as_prop(&mut self, expr: Expr) -> Expr {
        let Some(mangler) = self.options.mangle_props else {
            return expr;
        };
        let ExprData::EString(mut string) = expr.data else {
            return expr;
        };
        let name: &'a [u8] = string.slice(self.arena);
        if mangler.mangle_quoted {
            if let Some(mangled) = self.mangled_prop_expr(name, expr.loc, false) {
                return mangled;
            }
        } else {
            self.reserve_prop(name);
        }
        expr
    }

    /// `/* @__KEY__ */ "name"`: a string literal explicitly marked as a property name.
    pub(crate) fn mangle_property_key_comment_string(&mut self, expr: Expr) -> Expr {
        let ExprData::EString(mut string) = expr.data else {
            return expr;
        };
        let name: &'a [u8] = string.slice(self.arena);
        self.mangled_prop_expr(name, expr.loc, true).unwrap_or(expr)
    }

    /// `a.name` => `a[E::NameOfSymbol]` (printed as a member access again later).
    /// Runs after defines, import items and enum inlining had their chance.
    pub(crate) fn mangled_dot_to_index(&mut self, expr: Expr) -> Option<Expr> {
        let dot = expr.data.e_dot()?;
        let index = self.mangled_prop_expr(dot.name.slice(), dot.name_loc, false)?;
        Some(self.new_expr(
            E::Index {
                target: dot.target,
                index,
                optional_chain: dot.optional_chain,
            },
            expr.loc,
        ))
    }

    /// `target.name` for accesses the parser generates itself (parameter
    /// properties, namespace exports, enum members). These never reach `e_dot`,
    /// so the name is mangled here to stay consistent with user-written accesses.
    pub(crate) fn dot_or_mangled_prop(
        &mut self,
        target: Expr,
        name: &'a [u8],
        name_loc: bun_ast::Loc,
        loc: bun_ast::Loc,
    ) -> Expr {
        if self.is_mangling_props() {
            if let Some(index) = self.mangled_prop_expr(name, name_loc, false) {
                return self.new_expr(
                    E::Index {
                        target,
                        index,
                        optional_chain: None,
                    },
                    loc,
                );
            }
        }
        self.new_expr(
            E::Dot {
                target,
                name: name.into(),
                name_loc,
                ..Default::default()
            },
            loc,
        )
    }
}
