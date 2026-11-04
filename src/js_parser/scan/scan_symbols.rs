use crate::js_lexer;
use crate::p::P;
use crate::parser::FindSymbolResult;
use bun_ast as js_ast;
use bun_ast::{Ref, Scope};

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub(crate) fn find_symbol(
        &mut self,
        loc: bun_ast::Loc,
        name: &'a [u8],
    ) -> Result<FindSymbolResult, crate::Error> {
        self.find_symbol_with_record_usage::<true>(loc, name)
    }

    pub(crate) fn find_symbol_with_record_usage<const RECORD_USAGE: bool>(
        &mut self,
        loc: bun_ast::Loc,
        name: &'a [u8],
    ) -> Result<FindSymbolResult, crate::Error> {
        // Every `break 'brk` below assigns `declare_loc` first; the one
        // early-`return` builds its own `FindSymbolResult` without reading it.
        let declare_loc: bun_ast::Loc;
        // The scope that lists the symbol.
        let mut found_in: Option<js_ast::StoreRef<Scope>> = None;
        let mut scope_use = true;
        // This function can show up in profiling.
        // That's part of why we do this.
        // Instead of rehashing `name` for every scope, we do it just once.
        let hash = Scope::get_member_hash(name);

        let ref_: Ref = 'brk: {
            // `Scope.parent` is an arena-backref `Option<StoreRef<Scope>>`; walk via the
            // safe `StoreRef` wrapper (Deref) instead of a raw-ptr loop.
            let mut current: Option<js_ast::StoreRef<Scope>> = Some(self.current_scope);

            let mut did_forbid_arguments = false;

            while let Some(scope) = current {
                // Forbid referencing "arguments" inside class bodies
                if scope.forbid_arguments && !did_forbid_arguments && name == b"arguments" {
                    let r = js_lexer::range_of_identifier(self.source, loc);
                    self.log().add_range_error_fmt(
                        Some(self.source),
                        r,
                        format_args!("Cannot access \"{}\" here", bstr::BStr::new(name)),
                    );
                    did_forbid_arguments = true;
                }

                // Is the symbol a member of this scope?
                if let Some(member) = scope.get_member_with_hash(name, hash) {
                    declare_loc = member.loc;
                    found_in = current;
                    // Unbound globals live in the module scope.
                    scope_use = self.track_scope_uses
                        && (scope.parent.is_some()
                            || self.symbols[member.ref_.inner_index() as usize].kind
                                != js_ast::symbol::Kind::Unbound);
                    break 'brk member.ref_;
                }

                // Is the symbol a member of this scope's TypeScript namespace?
                // `scope.ts_namespace` is only assigned behind `IS_TYPESCRIPT_ENABLED`
                // guards, so the probe is dead for JS inputs — gate it so the
                // load+branch fold away in the `TYPESCRIPT == false` monomorphization.
                if Self::IS_TYPESCRIPT_ENABLED {
                    if let Some(mut ts_namespace) = scope.ts_namespace {
                        let ts = &*ts_namespace;
                        let exported: &js_ast::TSNamespaceMemberMap = &ts.exported_members;
                        if let Some(member) = exported.get(name) {
                            if member.data.is_enum() == ts.is_enum_scope {
                                declare_loc = member.loc;
                                found_in = current;
                                // If this is an identifier from a sibling TypeScript namespace, then we're
                                // going to have to generate a property access instead of a simple reference.
                                // Lazily-generate an identifier that represents this property access.
                                // Split into get-then-insert so the &mut self borrow
                                // (self.new_symbol) does not overlap the map borrow.
                                if let Some(existing) = ts.property_accesses.get(name) {
                                    break 'brk *existing;
                                }
                                let arg_ref = ts.arg_ref;
                                let new_ref = self.new_symbol(js_ast::symbol::Kind::Other, name);
                                // Re-borrow ts_namespace mutably after &mut self.
                                let ts_mut = &mut *ts_namespace;
                                ts_mut.property_accesses.insert(name, new_ref);
                                self.symbols[new_ref.inner_index() as usize].namespace_alias =
                                    Some(bun_alloc::ast_box(js_ast::NamespaceAlias {
                                        namespace_ref: arg_ref,
                                        alias: js_ast::StoreStr::new(name),
                                        ..Default::default()
                                    }));
                                break 'brk new_ref;
                            }
                        }
                    }
                }

                current = scope.parent;
            }

            // Allocate an "unbound" symbol
            self.check_for_non_bmp_code_point(loc, name);
            if !RECORD_USAGE {
                return Ok(FindSymbolResult {
                    r#ref: Ref::NONE,
                    declare_loc: Some(loc),
                    is_inside_with_scope: self.module_scope().contains_with
                        && self.lookup_asks_with_target(None, Ref::NONE),
                });
            }

            // SAFETY: `name` is a slice of the source or the lexer's string table.
            let gpe = unsafe {
                self.module_scope_mut()
                    .get_or_put_member_with_hash(name, hash)
            };

            // I don't think this happens?
            if gpe.found_existing {
                let existing = *gpe.value_ptr;
                declare_loc = existing.loc;
                break 'brk existing.ref_;
            }

            // gpe borrows self.module_scope while self.new_symbol needs &mut self.
            // Drop gpe, allocate, then re-insert.
            let new_ref = self.new_symbol(js_ast::symbol::Kind::Unbound, name);
            if self.options.features.inject_jest_globals {
                self.jest.did_declare_unbound(name, new_ref);
            }

            // SAFETY: as above.
            *unsafe {
                self.module_scope_mut()
                    .get_or_put_member_with_hash(name, hash)
            }
            .value_ptr = js_ast::scope::Member { ref_: new_ref, loc };

            declare_loc = loc;
            scope_use = false;

            break 'brk new_ref;
        };

        // Only a file that has a "with" statement takes the walk.
        let is_inside_with_scope =
            self.module_scope().contains_with && self.lookup_asks_with_target(found_in, ref_);

        // If we had to pass through a "with" statement body to get to the symbol
        // declaration, then this reference could potentially also refer to a
        // property on the target object of the "with" statement. We must not rename
        // it or we risk changing the behavior of the code.
        if is_inside_with_scope {
            self.set_must_not_be_renamed_through_links(ref_);
        }

        // Track how many times we've referenced this symbol
        if RECORD_USAGE {
            self.record_usage_impl(ref_, scope_use);
        }

        Ok(FindSymbolResult {
            r#ref: ref_,
            declare_loc: Some(declare_loc),
            is_inside_with_scope,
        })
    }

    /// True when a store to the `var` `ref_`, which the current scope declares, asks the
    /// target of a "with" statement for the name.
    pub(crate) fn var_store_asks_with_target(&self, ref_: Ref) -> bool {
        self.module_scope().contains_with
            && self.lookup_asks_with_target(Some(self.current_scope), ref_)
    }

    /// True when a lookup from the current scope asks the target of a "with" statement.
    /// `found_in` is the scope that lists the symbol `ref_`, or `None` for a name that no
    /// scope lists. A `var` is a variable of the nearest scope that stops hoisting, so a
    /// "with" scope between `found_in` and that scope counts too:
    ///
    ///   with (obj) { var foo; foo }
    #[cold]
    #[inline(never)]
    fn lookup_asks_with_target(
        &self,
        found_in: Option<js_ast::StoreRef<Scope>>,
        ref_: Ref,
    ) -> bool {
        let mut current = Some(self.current_scope);
        while let Some(scope) = current {
            if scope.kind == js_ast::scope::Kind::With {
                return true;
            }
            if current == found_in {
                break;
            }
            current = scope.parent;
        }
        if current.is_none()
            || self.symbols[ref_.inner_index() as usize].kind != js_ast::symbol::Kind::Hoisted
        {
            return false;
        }

        while let Some(scope) = current {
            if scope.kind_stops_hoisting() {
                return false;
            }
            if scope.kind == js_ast::scope::Kind::With {
                return true;
            }
            current = scope.parent;
        }
        false
    }
}
