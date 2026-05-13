use crate::js_lexer;
use crate::p::P;
use crate::parser::{FindSymbolResult};
use bun_ast as js_ast;
use bun_ast::{Ref, Scope};

// PORT NOTE: Zig's `fn Symbols(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// is the file-split mixin pattern: a fieldless namespace whose associated fns all take `*P` as the
// first arg, where `P = js_parser.NewParser_(ts, jsx, scan_only)`. In Rust this is a plain
// `impl<const ...> P<...> { }` block — multiple impl blocks on the same type across files in one
// crate are allowed.
//
// adt_const_params: round-C lowered `const JSX: JSXTransformType` → `J: JsxT` (sealed trait + ZST).

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub fn find_symbol(
        &mut self,
        loc: bun_ast::Loc,
        name: &'a [u8],
    ) -> Result<FindSymbolResult, bun_core::Error> {
        self.find_symbol_with_record_usage::<true>(loc, name)
    }

    pub fn find_symbol_with_record_usage<const RECORD_USAGE: bool>(
        &mut self,
        loc: bun_ast::Loc,
        name: &'a [u8],
    ) -> Result<FindSymbolResult, bun_core::Error> {
        // Every `break 'brk` below assigns `declare_loc` first; the one
        // early-`return` builds its own `FindSymbolResult` without reading it.
        let declare_loc: bun_ast::Loc;
        let mut is_inside_with_scope = false;
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
                // Track if we're inside a "with" statement body
                if scope.kind == js_ast::scope::Kind::With {
                    is_inside_with_scope = true;
                }

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
                    break 'brk member.ref_;
                }

                // Is the symbol a member of this scope's TypeScript namespace?
                if let Some(mut ts_namespace) = scope.ts_namespace {
                    let ts = &*ts_namespace;
                    let exported: &js_ast::TSNamespaceMemberMap = &ts.exported_members;
                    if let Some(member) = exported.get(name) {
                        if member.data.is_enum() == ts.is_enum_scope {
                            declare_loc = member.loc;
                            // If this is an identifier from a sibling TypeScript namespace, then we're
                            // going to have to generate a property access instead of a simple reference.
                            // Lazily-generate an identifier that represents this property access.
                            // PORT NOTE: reshaped for borrowck — Zig's getOrPut returns key/value
                            // pointers while we also call self.new_symbol (&mut self). Split into
                            // get-then-insert so the &mut self borrow does not overlap the map borrow.
                            if let Some(existing) = ts.property_accesses.get(name) {
                                break 'brk *existing;
                            }
                            let arg_ref = ts.arg_ref;
                            let new_ref = self.new_symbol(js_ast::symbol::Kind::Other, name)?;
                            // Re-borrow ts_namespace mutably after &mut self.
                            let ts_mut = &mut *ts_namespace;
                            ts_mut.property_accesses.insert(name, new_ref);
                            self.symbols[new_ref.inner_index() as usize].namespace_alias =
                                Some(js_ast::NamespaceAlias {
                                    namespace_ref: arg_ref,
                                    alias: js_ast::StoreStr::new(name),
                                    ..Default::default()
                                });
                            break 'brk new_ref;
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
                    is_inside_with_scope,
                });
            }

            let gpe = self
                .module_scope_mut()
                .get_or_put_member_with_hash(name, hash);

            // I don't think this happens?
            if gpe.found_existing {
                let existing = *gpe.value_ptr;
                declare_loc = existing.loc;
                break 'brk existing.ref_;
            }

            // PORT NOTE: reshaped for borrowck — gpe borrows self.module_scope while
            // self.new_symbol needs &mut self. Drop gpe, allocate, then re-insert.
            drop(gpe);
            let new_ref = self
                .new_symbol(js_ast::symbol::Kind::Unbound, name)
                .expect("unreachable");

            *self
                .module_scope_mut()
                .get_or_put_member_with_hash(name, hash)
                .value_ptr = js_ast::scope::Member { ref_: new_ref, loc };
            // TODO(port): the line above conflates key_ptr/value_ptr writes from Zig's
            // `gpe.key_ptr.* = name; gpe.value_ptr.* = Scope.Member{...}` — verify
            // get_or_put_member_with_hash's Rust API shape in Phase B.

            declare_loc = loc;

            break 'brk new_ref;
        };

        // If we had to pass through a "with" statement body to get to the symbol
        // declaration, then this reference could potentially also refer to a
        // property on the target object of the "with" statement. We must not rename
        // it or we risk changing the behavior of the code.
        if is_inside_with_scope {
            self.symbols[ref_.inner_index() as usize].must_not_be_renamed = true;
        }

        // Track how many times we've referenced this symbol
        if RECORD_USAGE {
            self.record_usage(ref_);
        }

        Ok(FindSymbolResult {
            r#ref: ref_,
            declare_loc: Some(declare_loc),
            is_inside_with_scope,
        })
    }
}

// ported from: src/js_parser/ast/symbols.zig
