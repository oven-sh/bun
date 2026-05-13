#![allow(unused_imports, unused_variables, dead_code, unused_mut, unused_unsafe)]
#![warn(unused_must_use)]
use bun_alloc::AllocError;
use bun_ast::import_record;
use bun_collections::StringArrayHashMap;
use bun_collections::VecExt;

use crate::p::P;
use crate::parser::{ReactRefresh, Ref, TempRef};
use bun_ast::{self as js_ast, B, Binding, E, Expr, G, S, Stmt};

// PORT NOTE: `P::generate_temp_ref` is ``-gated in P.rs (round-6
// re-gate); replicate it here so this file can un-gate independently. Body is
// a 1:1 port of P.zig `generateTempRefWithScope` with `scope = current_scope`.
// `P::will_use_renamer` is private — its body is inlined.
fn generate_temp_ref<'p, const TS: bool, const SCAN: bool>(
    p: &mut P<'p, TS, SCAN>,
    default_name: Option<&'p [u8]>,
) -> Ref {
    let will_use_renamer = p.options.bundle || p.options.features.minify_identifiers;
    let name: &'p [u8] =
        (if will_use_renamer { default_name } else { None }).unwrap_or_else(|| {
            p.temp_ref_count += 1;
            bun_alloc::arena_format!(in p.arena, "__bun_temp_ref_{:x}$", p.temp_ref_count)
                .into_bump_str()
                .as_bytes()
        });
    let r#ref = p
        .new_symbol(js_ast::symbol::Kind::Other, name)
        .expect("oom");

    p.temp_refs_to_declare.push(TempRef {
        r#ref,
        ..Default::default()
    });

    VecExt::append(&mut p.current_scope_mut().generated, r#ref);

    r#ref
}

pub struct ConvertESMExportsForHmr<'a> {
    pub last_part: &'a mut js_ast::Part,
    /// files in node modules will not get hot updates, so the code generation
    /// can be a bit more concise for re-exports
    pub is_in_node_modules: bool,
    pub imports_seen: StringArrayHashMap<ImportRef>,
    pub export_star_props: Vec<G::Property>,
    pub export_props: Vec<G::Property>,
    pub stmts: Vec<Stmt>,
}
// PORT NOTE: Zig used `std.ArrayListUnmanaged` with `p.arena` for the four
// collections; in Rust the parser arena is a `bumpalo::Bump`, but the consumers
// (`Vec::move_from_list` for `export_props`, arena copy for `stmts`) want
// global-heap `Vec<T>` anyway. Kept as `Vec` so callers can construct via
// `Default::default()` without needing `&'a Bump`. See P.zig:6389.

#[derive(Default)]
pub struct ImportRef {
    /// Index into ConvertESMExportsForHmr.stmts
    pub stmt_index: u32,
}

pub struct DeduplicatedImportResult {
    pub namespace_ref: Ref,
    pub import_record_index: u32,
}

impl<'a> ConvertESMExportsForHmr<'a> {
    // PORT NOTE: round-E un-gate — `<P>` unbounded generic → concrete `P<'p, TS, SCAN>`.
    // TODO(b2-ast-E): Zig `p: anytype` also accepts AstBuilder; add `ParserLike` trait bound
    //   when bundle_v2 lands.
    pub fn convert_stmt<'p, const TS: bool, const SCAN: bool>(
        &mut self,
        p: &mut P<'p, TS, SCAN>,
        stmt: Stmt,
    ) -> Result<(), AllocError> {
        let new_stmt: Stmt = match stmt.data {
            js_ast::StmtData::SLocal(mut st) => 'stmt: {
                if !st.is_export {
                    break 'stmt stmt;
                }

                st.is_export = false;

                let mut new_len: usize = 0;
                // PORT NOTE: reshaped for borrowck — index loop instead of `|*decl_ptr|`.
                let decls_len = st.decls.len_u32() as usize;
                for i in 0..decls_len {
                    // explicit field copies (G::Decl is not `Copy`) to avoid aliasing
                    let binding = st.decls.slice()[i].binding;
                    let value = st.decls.slice()[i].value;
                    let Some(value) = value else {
                        *st.decls.mut_(new_len) = G::Decl {
                            binding,
                            value: None,
                        };
                        new_len += 1;
                        self.visit_binding_to_export(p, binding)?;
                        continue;
                    };

                    match binding.data {
                        B::B::BMissing(_) => {}

                        B::B::BIdentifier(id) => {
                            let id_ref = id.r#ref;
                            let symbol = &p.symbols[id_ref.inner_index() as usize];

                            // if the symbol is not used, we don't need to preserve
                            // a binding in this scope. we can move it to the exports object.
                            if symbol.use_count_estimate == 0 && value.can_be_moved() {
                                self.export_props.push(G::Property {
                                    key: Some(Expr::init(
                                        // SAFETY: arena-owned name slice valid for the parse.
                                        E::EString::init(symbol.original_name.slice()),
                                        binding.loc,
                                    )),
                                    value: Some(value),
                                    ..Default::default()
                                });
                            } else {
                                *st.decls.mut_(new_len) = G::Decl {
                                    binding,
                                    value: Some(value),
                                };
                                new_len += 1;
                                self.visit_binding_to_export(p, binding)?;
                            }
                        }

                        _ => {
                            *st.decls.mut_(new_len) = G::Decl {
                                binding,
                                value: Some(value),
                            };
                            new_len += 1;
                            self.visit_binding_to_export(p, binding)?;
                        }
                    }
                }
                if new_len == 0 {
                    return Ok(());
                }
                st.decls.truncate(new_len);

                break 'stmt stmt;
            }
            js_ast::StmtData::SExportDefault(st) => 'stmt: {
                // When React Fast Refresh needs to tag the default export, the statement
                // cannot be moved, since a local reference is required.
                if p.options.features.react_fast_refresh
                    && matches!(st.value, js_ast::StmtOrExpr::Stmt(s) if matches!(s.data, js_ast::StmtData::SFunction(_)))
                {
                    'fast_refresh_edge_case: {
                        let js_ast::StmtOrExpr::Stmt(s) = &st.value else {
                            unreachable!()
                        };
                        let js_ast::StmtData::SFunction(f) = s.data else {
                            unreachable!()
                        };
                        let Some(symbol) = f.func.name else {
                            break 'fast_refresh_edge_case;
                        };
                        let name = p.symbols
                            [symbol.ref_.expect("infallible: ref bound").inner_index() as usize]
                            .original_name;
                        if ReactRefresh::is_componentish_name(name.slice()) {
                            // Lower to a function statement, and reference the function in the export list.
                            self.export_props.push(G::Property {
                                key: Some(Expr::init(E::EString::init(b"default"), stmt.loc)),
                                value: Some(Expr::init_identifier(
                                    symbol.ref_.expect("infallible: ref bound"),
                                    stmt.loc,
                                )),
                                ..Default::default()
                            });
                            break 'stmt *s;
                        }
                        // All other functions can be properly moved.
                    }
                }

                // Try to move the export default expression to the end.
                let can_be_moved_to_inner_scope = match &st.value {
                    js_ast::StmtOrExpr::Stmt(s) => match s.data {
                        js_ast::StmtData::SClass(c) => {
                            c.class.can_be_moved()
                                && (if let Some(name) = c.class.class_name {
                                    p.symbols[name
                                        .ref_
                                        .expect("infallible: ref bound")
                                        .inner_index()
                                        as usize]
                                        .use_count_estimate
                                        == 0
                                } else {
                                    true
                                })
                        }
                        js_ast::StmtData::SFunction(f) => {
                            if let Some(name) = f.func.name {
                                p.symbols[name.ref_.expect("infallible: ref bound").inner_index()
                                    as usize]
                                    .use_count_estimate
                                    == 0
                            } else {
                                true
                            }
                        }
                        _ => unreachable!(),
                    },
                    js_ast::StmtOrExpr::Expr(e) => match e.data {
                        js_ast::ExprData::EIdentifier(_) => true,
                        _ => e.can_be_moved(),
                    },
                };
                if can_be_moved_to_inner_scope {
                    // PORT NOTE: `StmtOrExpr` is not `Copy`; read by ptr to avoid moving
                    // out of the StoreRef deref.
                    // SAFETY: StoreRef points into a live arena; value is POD-shaped.
                    let value = unsafe { core::ptr::read(&raw const st.value) }.to_expr();
                    self.export_props.push(G::Property {
                        key: Some(Expr::init(E::EString::init(b"default"), stmt.loc)),
                        value: Some(value),
                        ..Default::default()
                    });
                    // no statement emitted
                    return Ok(());
                }

                // Otherwise, an identifier must be exported
                match &st.value {
                    js_ast::StmtOrExpr::Expr(_) => {
                        let temp_id = generate_temp_ref(p, Some(b"default_export"));
                        self.last_part
                            .declared_symbols
                            .append(js_ast::DeclaredSymbol {
                                ref_: temp_id,
                                is_top_level: true,
                            })?;
                        self.last_part
                            .symbol_uses
                            .put_no_clobber(temp_id, js_ast::symbol::Use { count_estimate: 1 })?;
                        // SAFETY: `current_scope` is a live arena ptr for the parser lifetime.
                        VecExt::append(&mut p.current_scope_mut().generated, temp_id);

                        self.export_props.push(G::Property {
                            key: Some(Expr::init(E::EString::init(b"default"), stmt.loc)),
                            value: Some(Expr::init_identifier(temp_id, stmt.loc)),
                            ..Default::default()
                        });

                        // SAFETY: as above — POD-shaped read out of arena.
                        let value = unsafe { core::ptr::read(&raw const st.value) }.to_expr();
                        let mut decls = bun_alloc::AstAlloc::vec();
                        VecExt::append(
                            &mut decls,
                            G::Decl {
                                binding: Binding::alloc(
                                    p.arena,
                                    B::Identifier { r#ref: temp_id },
                                    stmt.loc,
                                ),
                                value: Some(value),
                            },
                        );
                        break 'stmt Stmt::alloc(
                            S::Local {
                                kind: js_ast::LocalKind::KConst,
                                decls,
                                ..Default::default()
                            },
                            stmt.loc,
                        );
                    }
                    js_ast::StmtOrExpr::Stmt(s) => {
                        self.export_props.push(G::Property {
                            key: Some(Expr::init(E::EString::init(b"default"), stmt.loc)),
                            value: Some(Expr::init_identifier(
                                match s.data {
                                    js_ast::StmtData::SClass(class) => class
                                        .class
                                        .class_name
                                        .unwrap()
                                        .ref_
                                        .expect("infallible: ref bound"),
                                    js_ast::StmtData::SFunction(func) => {
                                        func.func.name.unwrap().ref_.expect("infallible: ref bound")
                                    }
                                    _ => unreachable!(),
                                },
                                stmt.loc,
                            )),
                            ..Default::default()
                        });
                        break 'stmt *s;
                    }
                }
            }
            js_ast::StmtData::SClass(mut st) => 'stmt: {
                // Strip the "export" keyword
                if !st.is_export {
                    break 'stmt stmt;
                }

                let class_name_ref = st
                    .class
                    .class_name
                    .unwrap()
                    .ref_
                    .expect("infallible: ref bound");
                // Export as CommonJS
                self.export_props.push(G::Property {
                    key: Some(Expr::init(
                        // SAFETY: arena-owned name slice valid for the parse.
                        E::EString::init(
                            p.symbols[class_name_ref.inner_index() as usize]
                                .original_name
                                .slice(),
                        ),
                        stmt.loc,
                    )),
                    value: Some(Expr::init_identifier(class_name_ref, stmt.loc)),
                    ..Default::default()
                });

                st.is_export = false;

                break 'stmt stmt;
            }
            js_ast::StmtData::SFunction(mut st) => 'stmt: {
                // Strip the "export" keyword
                if !st.func.flags.contains(bun_ast::flags::Function::IsExport) {
                    break 'stmt stmt;
                }

                st.func.flags.remove(bun_ast::flags::Function::IsExport);

                self.visit_ref_to_export(
                    p,
                    st.func.name.unwrap().ref_.expect("infallible: ref bound"),
                    None,
                    stmt.loc,
                    false,
                )?;

                break 'stmt stmt;
            }
            js_ast::StmtData::SExportClause(st) => {
                for item in st.items.iter() {
                    let ref_ = item.name.ref_.expect("infallible: ref bound");
                    self.visit_ref_to_export(p, ref_, Some(item.alias), item.name.loc, false)?;
                }

                return Ok(()); // do not emit a statement here
            }
            js_ast::StmtData::SExportFrom(mut st) => {
                let deduped = self.deduplicated_import(
                    p,
                    st.import_record_index,
                    st.namespace_ref,
                    st.items,
                    Some(stmt.loc),
                    None,
                    stmt.loc,
                )?;
                for item in st.items.slice_mut().iter_mut() {
                    let ref_ = item.name.ref_.expect("infallible: ref bound");
                    let symbol = &mut p.symbols[ref_.inner_index() as usize];
                    // Always set the namespace alias using the deduplicated import
                    // record. When two `export { ... } from` statements reference
                    // the same source, the second import record is marked unused
                    // and its items are merged into the first. The symbols may
                    // already have a namespace_alias from ImportScanner pointing at
                    // the now-unused record, so we must update it.
                    symbol.namespace_alias = Some(G::NamespaceAlias {
                        namespace_ref: deduped.namespace_ref,
                        alias: item.original_name,
                        import_record_index: deduped.import_record_index,
                        ..Default::default()
                    });
                    self.visit_ref_to_export(
                        p,
                        ref_,
                        Some(item.alias),
                        item.name.loc,
                        !self.is_in_node_modules, // live binding when this may be replaced
                    )?;

                    // imports and export statements have their alias +
                    // original_name swapped. this is likely a design bug in
                    // the parser but since everything uses these
                    // assumptions, this hack is simpler than making it
                    // proper
                    let alias = item.alias;
                    item.alias = item.original_name;
                    item.original_name = alias;
                }
                return Ok(());
            }
            js_ast::StmtData::SExportStar(st) => {
                let deduped = self.deduplicated_import(
                    p,
                    st.import_record_index,
                    st.namespace_ref,
                    bun_ast::StoreSlice::EMPTY,
                    Some(stmt.loc),
                    None,
                    stmt.loc,
                )?;

                if let Some(alias) = &st.alias {
                    // 'export * as ns from' creates one named property.
                    self.export_props.push(G::Property {
                        // SAFETY: arena-owned name slice valid for the parse.
                        key: Some(Expr::init(
                            E::EString::init(alias.original_name.slice()),
                            stmt.loc,
                        )),
                        value: Some(Expr::init_identifier(deduped.namespace_ref, stmt.loc)),
                        ..Default::default()
                    });
                } else {
                    // 'export * from' creates a spread, hoisted at the top.
                    self.export_star_props.push(G::Property {
                        kind: G::PropertyKind::Spread,
                        value: Some(Expr::init_identifier(deduped.namespace_ref, stmt.loc)),
                        ..Default::default()
                    });
                }
                return Ok(());
            }
            // De-duplicate import statements. It is okay to disregard
            // named/default imports here as we always rewrite them as
            // full qualified property accesses (needed for live-bindings)
            js_ast::StmtData::SImport(st) => {
                let _ = self.deduplicated_import(
                    p,
                    st.import_record_index,
                    st.namespace_ref,
                    st.items,
                    st.star_name_loc,
                    st.default_name,
                    stmt.loc,
                )?;
                return Ok(());
            }
            _ => stmt,
        };

        self.stmts.push(new_stmt);
        Ok(())
    }

    /// Deduplicates imports, returning a previously used Ref and import record
    /// index if present.
    fn deduplicated_import<'p, const TS: bool, const SCAN: bool>(
        &mut self,
        p: &mut P<'p, TS, SCAN>,
        import_record_index: u32,
        namespace_ref: Ref,
        items: js_ast::StoreSlice<js_ast::ClauseItem>,
        star_name_loc: Option<bun_ast::Loc>,
        default_name: Option<js_ast::LocRef>,
        loc: bun_ast::Loc,
    ) -> Result<DeduplicatedImportResult, AllocError> {
        let path_text = p.import_records.items()[import_record_index as usize]
            .path
            .text;
        let gop = self.imports_seen.get_or_put(path_text)?;
        if gop.found_existing {
            let stmt_index = gop.value_ptr.stmt_index;
            // Disable this one since an older record is getting used.  It isn't
            // practical to delete this import record entry since an import or
            // require expression can exist.
            p.import_records.items_mut()[import_record_index as usize]
                .flags
                .insert(import_record::Flags::IS_UNUSED);

            let js_ast::StmtData::SImport(mut stmt) = self.stmts[stmt_index as usize].data else {
                unreachable!()
            };
            // The surviving record may have been marked is_unused by barrel
            // optimization (when the first export-from statement's exports
            // were all deferred). Since we are merging new items into it,
            // clear is_unused so the import is actually emitted.
            p.import_records.items_mut()[stmt.import_record_index as usize]
                .flags
                .remove(import_record::Flags::IS_UNUSED);

            let items_len = items.len();
            if items_len > 0 {
                if stmt.items.is_empty() {
                    stmt.items = items;
                } else {
                    // PORT NOTE: Zig `std.mem.concat` — allocate concatenated slice in arena.
                    // ClauseItem fields are all bitwise-copyable; copy raw to avoid Clone bound.
                    let prev_len = stmt.items.len();
                    let concat = p.arena.alloc_slice_fill_with(prev_len + items_len, |_| {
                        js_ast::ClauseItem::default()
                    });
                    // SAFETY: src/dst non-overlapping arena allocations of correct length;
                    // ClauseItem is POD-shaped.
                    unsafe {
                        core::ptr::copy_nonoverlapping(
                            stmt.items.as_ptr(),
                            concat.as_mut_ptr(),
                            prev_len,
                        );
                        core::ptr::copy_nonoverlapping(
                            items.as_ptr(),
                            concat.as_mut_ptr().add(prev_len),
                            items_len,
                        );
                    }
                    stmt.items = bun_ast::StoreSlice::new_mut(concat);
                }
            }
            if namespace_ref.is_valid() {
                if !stmt.namespace_ref.is_valid() {
                    stmt.namespace_ref = namespace_ref;
                    return Ok(DeduplicatedImportResult {
                        namespace_ref,
                        import_record_index: stmt.import_record_index,
                    });
                } else {
                    // Erase this namespace ref, but since it may be used in
                    // existing AST trees, a link must be established.
                    let symbol = &mut p.symbols[namespace_ref.inner_index() as usize];
                    symbol.use_count_estimate = 0;
                    symbol.link.set(stmt.namespace_ref);
                    // PORT NOTE: Zig `@hasField(@typeInfo(@TypeOf(p)).pointer.child, "symbol_uses")`
                    // gated this on whether the concrete `p` type carries `symbol_uses`. The
                    // concrete `P` always does; once a `ParserLike` trait is introduced for
                    // AstBuilder, that variant should override this to a no-op.
                    p.symbol_uses.swap_remove(&namespace_ref);
                }
            }
            if stmt.star_name_loc.is_none() {
                if let Some(stl) = star_name_loc {
                    stmt.star_name_loc = Some(stl);
                }
            }
            if stmt.default_name.is_none() {
                if let Some(dn) = default_name {
                    stmt.default_name = Some(dn);
                }
            }
            return Ok(DeduplicatedImportResult {
                namespace_ref: stmt.namespace_ref,
                import_record_index: stmt.import_record_index,
            });
        }

        self.stmts.push(Stmt::alloc(
            S::Import {
                import_record_index,
                is_single_line: true,
                default_name,
                items,
                namespace_ref,
                star_name_loc,
            },
            loc,
        ));

        *gop.value_ptr = ImportRef {
            stmt_index: u32::try_from(self.stmts.len() - 1).expect("int cast"),
        };
        Ok(DeduplicatedImportResult {
            namespace_ref,
            import_record_index,
        })
    }

    fn visit_binding_to_export<'p, const TS: bool, const SCAN: bool>(
        &mut self,
        p: &mut P<'p, TS, SCAN>,
        binding: Binding,
    ) -> Result<(), AllocError> {
        match binding.data {
            B::B::BMissing(_) => {}
            B::B::BIdentifier(id) => {
                self.visit_ref_to_export(p, id.r#ref, None, binding.loc, false)?;
            }
            B::B::BArray(array) => {
                for item in array.items.iter() {
                    self.visit_binding_to_export(p, item.binding)?;
                }
            }
            B::B::BObject(object) => {
                for item in object.properties.iter() {
                    self.visit_binding_to_export(p, item.value)?;
                }
            }
        }
        Ok(())
    }

    fn visit_ref_to_export<'p, const TS: bool, const SCAN: bool>(
        &mut self,
        p: &mut P<'p, TS, SCAN>,
        ref_: Ref,
        export_symbol_name: Option<js_ast::StoreStr>,
        loc: bun_ast::Loc,
        is_live_binding_source: bool,
    ) -> Result<(), AllocError> {
        let (kind, has_been_assigned_to, original_name) = {
            let symbol = &p.symbols[ref_.inner_index() as usize];
            (
                symbol.kind,
                symbol.has_been_assigned_to,
                symbol.original_name,
            )
        };
        let id = if kind == js_ast::symbol::Kind::Import {
            Expr::init(
                E::ImportIdentifier {
                    ref_,
                    ..Default::default()
                },
                loc,
            )
        } else {
            Expr::init_identifier(ref_, loc)
        };
        if is_live_binding_source
            || (kind == js_ast::symbol::Kind::Import && !self.is_in_node_modules)
            || has_been_assigned_to
        {
            // TODO (2024-11-24) instead of requiring getters for live-bindings,
            // a callback propagation system should be considered.  mostly
            // because here, these might not even be live bindings, and
            // re-exports are so, so common.
            //
            // update(2025-03-05): HMRModule in ts now contains an exhaustive map
            // of importers. For local live bindings, these can just remember to
            // mutate the field in the exports object. Re-exports can just be
            // encoded into the module format, propagated in `replaceModules`
            let key = Expr::init(
                E::EString::init(export_symbol_name.unwrap_or(original_name).slice()),
                loc,
            );

            // This is technically incorrect in that we've marked this as a
            // top level symbol. but all we care about is preventing name
            // collisions, not necessarily the best minificaiton (dev only)
            let arg1 = generate_temp_ref(p, Some(original_name.slice()));
            self.last_part
                .declared_symbols
                .append(js_ast::DeclaredSymbol {
                    ref_: arg1,
                    is_top_level: true,
                })?;
            self.last_part
                .symbol_uses
                .put_no_clobber(arg1, js_ast::symbol::Use { count_estimate: 1 })?;
            // SAFETY: `current_scope` is a live arena ptr for the parser lifetime.
            VecExt::append(&mut p.current_scope_mut().generated, arg1);

            // 'get abc() { return abc }'
            let body_stmts = p
                .arena
                .alloc_slice_copy(&[Stmt::alloc(S::Return { value: Some(id) }, loc)]);
            self.export_props.push(G::Property {
                kind: G::PropertyKind::Get,
                key: Some(key),
                value: Some(Expr::init(
                    E::Function {
                        func: G::Fn {
                            body: G::FnBody {
                                stmts: bun_ast::StoreSlice::new_mut(body_stmts),
                                loc,
                            },
                            ..Default::default()
                        },
                    },
                    loc,
                )),
                ..Default::default()
            });
            // no setter is added since live bindings are read-only
        } else {
            // 'abc,'
            self.export_props.push(G::Property {
                key: Some(Expr::init(
                    E::EString::init(export_symbol_name.unwrap_or(original_name).slice()),
                    loc,
                )),
                value: Some(id),
                ..Default::default()
            });
        }
        Ok(())
    }

    pub fn finalize<'p, const TS: bool, const SCAN: bool>(
        &mut self,
        p: &mut P<'p, TS, SCAN>,
        // PORT NOTE: Zig took `all_parts: []Part` and freely re-derived
        // `&mut all_parts[len-1]` while `ctx.last_part` aliased the same slot.
        // Rust forbids that aliasing (Stacked Borrows: `&mut [Part]` asserts
        // exclusive access to every element). Caller passes the `[0..len-1]`
        // prefix obtained via `split_last_mut`, disjoint from `self.last_part`.
        head_parts: &mut [js_ast::Part],
    ) -> Result<(), AllocError> {
        if !self.export_star_props.is_empty() {
            if self.export_props.is_empty() {
                core::mem::swap(&mut self.export_props, &mut self.export_star_props);
            } else {
                bun_collections::prepend_from(&mut self.export_props, &mut self.export_star_props);
            }
        }

        if !self.export_props.is_empty() {
            let obj = Expr::init(
                E::Object {
                    properties: G::PropertyList::move_from_list(core::mem::take(
                        &mut self.export_props,
                    )),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );

            // `hmr.exports = ...`
            self.stmts.push(Stmt::alloc(
                S::SExpr {
                    value: Expr::assign(
                        Expr::init(
                            E::Dot {
                                target: Expr::init_identifier(p.hmr_api_ref, bun_ast::Loc::EMPTY),
                                name: b"exports".into(),
                                name_loc: bun_ast::Loc::EMPTY,
                                ..Default::default()
                            },
                            bun_ast::Loc::EMPTY,
                        ),
                        obj,
                    ),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            ));

            // mark a dependency on module_ref so it is renamed
            self.last_part
                .symbol_uses
                .put(p.module_ref, js_ast::symbol::Use { count_estimate: 1 })?;
            self.last_part
                .declared_symbols
                .append(js_ast::DeclaredSymbol {
                    ref_: p.module_ref,
                    is_top_level: true,
                })?;
        }

        if p.options.features.react_fast_refresh && p.react_refresh.register_used {
            self.stmts.push(Stmt::alloc(
                S::SExpr {
                    value: Expr::init(
                        E::Call {
                            target: Expr::init(
                                E::Dot {
                                    target: Expr::init_identifier(
                                        p.hmr_api_ref,
                                        bun_ast::Loc::EMPTY,
                                    ),
                                    name: b"reactRefreshAccept".into(),
                                    name_loc: bun_ast::Loc::EMPTY,
                                    ..Default::default()
                                },
                                bun_ast::Loc::EMPTY,
                            ),
                            args: bun_alloc::AstAlloc::vec(),
                            ..Default::default()
                        },
                        bun_ast::Loc::EMPTY,
                    ),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            ));
        }

        // Merge all part metadata into the first part.
        let last_idx = head_parts.len();
        for part in head_parts.iter_mut() {
            self.last_part
                .declared_symbols
                .append_list(core::mem::take(&mut part.declared_symbols))?;
            self.last_part
                .import_record_indices
                .append_slice(part.import_record_indices.slice());
            // PORT NOTE: reshaped for borrowck — Zig zipped keys()/values(); index loop avoids
            // holding two shared borrows of `part.symbol_uses` while &mut-borrowing `last_part`.
            for i in 0..part.symbol_uses.count() {
                let k = part.symbol_uses.keys()[i];
                let v = part.symbol_uses.values()[i];
                let gop = self.last_part.symbol_uses.get_or_put(k)?;
                if !gop.found_existing {
                    *gop.value_ptr = v;
                } else {
                    gop.value_ptr.count_estimate += v.count_estimate;
                }
            }
            part.stmts = bun_ast::StoreSlice::EMPTY;
            // PORT NOTE: `declared_symbols` already cleared via `mem::take` above
            // (Zig set `entries.len = 0` after `appendList`).
            part.tag = bun_ast::PartTag::DeadDueToInlining;
            part.dependencies.clear_retaining_capacity();
            part.dependencies.push(bun_ast::Dependency {
                part_index: u32::try_from(last_idx).expect("int cast"),
                source_index: p.source.index,
            });
        }

        self.last_part
            .import_record_indices
            .append_slice(p.import_records_for_current_part.as_slice());
        self.last_part
            .declared_symbols
            .append_list(core::mem::take(&mut p.declared_symbols))?;

        // PORT NOTE: Zig assigned the ArrayList's `items` slice directly. `Stmt` is `Copy`;
        // copy into the parser arena so the `StoreSlice<Stmt>` outlives this struct.
        let stmts = core::mem::take(&mut self.stmts);
        self.last_part.stmts = bun_ast::StoreSlice::new_mut(p.arena.alloc_slice_copy(&stmts));
        self.last_part.tag = bun_ast::PartTag::None;
        Ok(())
    }
}

// ported from: src/js_parser/ast/ConvertESMExportsForHmr.zig
