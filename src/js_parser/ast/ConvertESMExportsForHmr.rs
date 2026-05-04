use bumpalo::collections::Vec as BumpVec;
use bun_alloc::AllocError;
use bun_collections::StringArrayHashMap;
use bun_logger as logger;

use crate::ast::{self as js_ast, Binding, Expr, Stmt, B, E, G, S};
use crate::{ReactRefresh, Ref};

pub struct ConvertESMExportsForHmr<'a> {
    pub last_part: &'a mut js_ast::Part,
    /// files in node modules will not get hot updates, so the code generation
    /// can be a bit more concise for re-exports
    pub is_in_node_modules: bool,
    pub imports_seen: StringArrayHashMap<ImportRef>,
    pub export_star_props: BumpVec<'a, G::Property>,
    pub export_props: BumpVec<'a, G::Property>,
    pub stmts: BumpVec<'a, Stmt>,
}
// TODO(port): Zig used field defaults `= .{}` for the four collections; in Rust the
// bumpalo Vecs need `&'a Bump` at construction, so callers must build via a `new()`
// that takes `(last_part, is_in_node_modules, bump)`. See P.zig:6389.

pub struct ImportRef {
    /// Index into ConvertESMExportsForHmr.stmts
    pub stmt_index: u32,
}

pub struct DeduplicatedImportResult {
    pub namespace_ref: Ref,
    pub import_record_index: u32,
}

impl<'a> ConvertESMExportsForHmr<'a> {
    // TODO(port): `p: anytype` is the generic parser `P`. Phase B should add a trait
    // bound covering: symbols, allocator(), options, generate_temp_ref, current_scope,
    // import_records, symbol_uses, hmr_api_ref, module_ref, react_refresh, source,
    // import_records_for_current_part, declared_symbols.
    pub fn convert_stmt<P>(&mut self, p: &mut P, stmt: Stmt) -> Result<(), AllocError> {
        let new_stmt = match stmt.data {
            js_ast::StmtData::SLocal(st) => 'stmt: {
                if !st.is_export {
                    break 'stmt stmt;
                }

                st.is_export = false;

                let mut new_len: usize = 0;
                // PORT NOTE: reshaped for borrowck — index loop instead of `|*decl_ptr|`
                let decls_len = st.decls.len();
                for i in 0..decls_len {
                    let decl = st.decls.as_slice()[i]; // explicit copy to avoid aliasing
                    let Some(value) = decl.value else {
                        st.decls.as_mut_slice()[new_len] = decl;
                        new_len += 1;
                        self.visit_binding_to_export(p, decl.binding)?;
                        continue;
                    };

                    match decl.binding.data {
                        js_ast::BindingData::BMissing => {}

                        js_ast::BindingData::BIdentifier(id) => {
                            let symbol = p.symbols.items[id.ref_.inner_index()];

                            // if the symbol is not used, we don't need to preserve
                            // a binding in this scope. we can move it to the exports object.
                            if symbol.use_count_estimate == 0 && value.can_be_moved() {
                                self.export_props.push(G::Property {
                                    key: Some(Expr::init(
                                        E::String { data: symbol.original_name },
                                        decl.binding.loc,
                                    )),
                                    value: Some(value),
                                    ..Default::default()
                                });
                            } else {
                                st.decls.as_mut_slice()[new_len] = decl;
                                new_len += 1;
                                self.visit_binding_to_export(p, decl.binding)?;
                            }
                        }

                        _ => {
                            st.decls.as_mut_slice()[new_len] = decl;
                            new_len += 1;
                            self.visit_binding_to_export(p, decl.binding)?;
                        }
                    }
                }
                if new_len == 0 {
                    return Ok(());
                }
                // TODO(port): BabyList len truncation API
                st.decls.len = u32::try_from(new_len).unwrap();

                break 'stmt stmt;
            }
            js_ast::StmtData::SExportDefault(st) => 'stmt: {
                // When React Fast Refresh needs to tag the default export, the statement
                // cannot be moved, since a local reference is required.
                if p.options.features.react_fast_refresh
                    && matches!(st.value, js_ast::StmtOrExpr::Stmt(s) if matches!(s.data, js_ast::StmtData::SFunction(_)))
                {
                    'fast_refresh_edge_case: {
                        let js_ast::StmtOrExpr::Stmt(s) = st.value else { unreachable!() };
                        let js_ast::StmtData::SFunction(f) = s.data else { unreachable!() };
                        let Some(symbol) = f.func.name else {
                            break 'fast_refresh_edge_case;
                        };
                        let name = p.symbols.items[symbol.ref_.unwrap().inner_index()].original_name;
                        if ReactRefresh::is_componentish_name(name) {
                            // Lower to a function statement, and reference the function in the export list.
                            self.export_props.push(G::Property {
                                key: Some(Expr::init(E::String { data: b"default" }, stmt.loc)),
                                value: Some(Expr::init_identifier(symbol.ref_.unwrap(), stmt.loc)),
                                ..Default::default()
                            });
                            break 'stmt s;
                        }
                        // All other functions can be properly moved.
                    }
                }

                // Try to move the export default expression to the end.
                let can_be_moved_to_inner_scope = match st.value {
                    js_ast::StmtOrExpr::Stmt(s) => match s.data {
                        js_ast::StmtData::SClass(c) => {
                            c.class.can_be_moved()
                                && (if let Some(name) = c.class.class_name {
                                    p.symbols.items[name.ref_.unwrap().inner_index()]
                                        .use_count_estimate
                                        == 0
                                } else {
                                    true
                                })
                        }
                        js_ast::StmtData::SFunction(f) => {
                            if let Some(name) = f.func.name {
                                p.symbols.items[name.ref_.unwrap().inner_index()]
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
                    self.export_props.push(G::Property {
                        key: Some(Expr::init(E::String { data: b"default" }, stmt.loc)),
                        value: Some(st.value.to_expr()),
                        ..Default::default()
                    });
                    // no statement emitted
                    return Ok(());
                }

                // Otherwise, an identifier must be exported
                match st.value {
                    js_ast::StmtOrExpr::Expr(_) => {
                        let temp_id = p.generate_temp_ref(b"default_export");
                        self.last_part
                            .declared_symbols
                            .push(js_ast::DeclaredSymbol { ref_: temp_id, is_top_level: true });
                        self.last_part
                            .symbol_uses
                            .put_no_clobber(temp_id, js_ast::SymbolUse { count_estimate: 1 })?;
                        p.current_scope.generated.push(temp_id);

                        self.export_props.push(G::Property {
                            key: Some(Expr::init(E::String { data: b"default" }, stmt.loc)),
                            value: Some(Expr::init_identifier(temp_id, stmt.loc)),
                            ..Default::default()
                        });

                        break 'stmt Stmt::alloc(
                            S::Local {
                                kind: js_ast::LocalKind::KConst,
                                decls: G::Decl::List::from_slice(
                                    p.allocator(),
                                    &[G::Decl {
                                        binding: Binding::alloc(
                                            p.allocator(),
                                            B::Identifier { ref_: temp_id },
                                            stmt.loc,
                                        ),
                                        value: Some(st.value.to_expr()),
                                    }],
                                )?,
                                ..Default::default()
                            },
                            stmt.loc,
                        );
                    }
                    js_ast::StmtOrExpr::Stmt(s) => {
                        self.export_props.push(G::Property {
                            key: Some(Expr::init(E::String { data: b"default" }, stmt.loc)),
                            value: Some(Expr::init_identifier(
                                match s.data {
                                    js_ast::StmtData::SClass(class) => {
                                        class.class.class_name.unwrap().ref_.unwrap()
                                    }
                                    js_ast::StmtData::SFunction(func) => {
                                        func.func.name.unwrap().ref_.unwrap()
                                    }
                                    _ => unreachable!(),
                                },
                                stmt.loc,
                            )),
                            ..Default::default()
                        });
                        break 'stmt s;
                    }
                }
            }
            js_ast::StmtData::SClass(st) => 'stmt: {
                // Strip the "export" keyword
                if !st.is_export {
                    break 'stmt stmt;
                }

                // Export as CommonJS
                self.export_props.push(G::Property {
                    key: Some(Expr::init(
                        E::String {
                            data: p.symbols.items
                                [st.class.class_name.unwrap().ref_.unwrap().inner_index()]
                            .original_name,
                        },
                        stmt.loc,
                    )),
                    value: Some(Expr::init_identifier(
                        st.class.class_name.unwrap().ref_.unwrap(),
                        stmt.loc,
                    )),
                    ..Default::default()
                });

                st.is_export = false;

                break 'stmt stmt;
            }
            js_ast::StmtData::SFunction(st) => 'stmt: {
                // Strip the "export" keyword
                if !st.func.flags.contains(js_ast::FnFlags::IS_EXPORT) {
                    break 'stmt stmt;
                }

                st.func.flags.remove(js_ast::FnFlags::IS_EXPORT);

                self.visit_ref_to_export(
                    p,
                    st.func.name.unwrap().ref_.unwrap(),
                    None,
                    stmt.loc,
                    false,
                )?;

                break 'stmt stmt;
            }
            js_ast::StmtData::SExportClause(st) => {
                for item in st.items.iter() {
                    let ref_ = item.name.ref_.unwrap();
                    self.visit_ref_to_export(p, ref_, Some(item.alias), item.name.loc, false)?;
                }

                return Ok(()); // do not emit a statement here
            }
            js_ast::StmtData::SExportFrom(st) => {
                let deduped = self.deduplicated_import(
                    p,
                    st.import_record_index,
                    st.namespace_ref,
                    st.items,
                    Some(stmt.loc),
                    None,
                    stmt.loc,
                )?;
                for item in st.items.iter_mut() {
                    let ref_ = item.name.ref_.unwrap();
                    let symbol = &mut p.symbols.items[ref_.inner_index()];
                    // Always set the namespace alias using the deduplicated import
                    // record. When two `export { ... } from` statements reference
                    // the same source, the second import record is marked unused
                    // and its items are merged into the first. The symbols may
                    // already have a namespace_alias from ImportScanner pointing at
                    // the now-unused record, so we must update it.
                    symbol.namespace_alias = Some(js_ast::NamespaceAlias {
                        namespace_ref: deduped.namespace_ref,
                        alias: item.original_name,
                        import_record_index: deduped.import_record_index,
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
                    &mut [],
                    Some(stmt.loc),
                    None,
                    stmt.loc,
                )?;

                if let Some(alias) = st.alias {
                    // 'export * as ns from' creates one named property.
                    self.export_props.push(G::Property {
                        key: Some(Expr::init(E::String { data: alias.original_name }, stmt.loc)),
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
    fn deduplicated_import<P>(
        &mut self,
        p: &mut P,
        import_record_index: u32,
        namespace_ref: Ref,
        items: &'a mut [js_ast::ClauseItem],
        star_name_loc: Option<logger::Loc>,
        default_name: Option<js_ast::LocRef>,
        loc: logger::Loc,
    ) -> Result<DeduplicatedImportResult, AllocError> {
        let ir = &mut p.import_records.items[import_record_index as usize];
        let gop = self.imports_seen.get_or_put(ir.path.text)?;
        if gop.found_existing {
            // Disable this one since an older record is getting used.  It isn't
            // practical to delete this import record entry since an import or
            // require expression can exist.
            ir.flags.is_unused = true;

            let stmt = match self.stmts[gop.value_ptr.stmt_index as usize].data {
                js_ast::StmtData::SImport(s) => s,
                _ => unreachable!(),
            };
            // The surviving record may have been marked is_unused by barrel
            // optimization (when the first export-from statement's exports
            // were all deferred). Since we are merging new items into it,
            // clear is_unused so the import is actually emitted.
            p.import_records.items[stmt.import_record_index as usize]
                .flags
                .is_unused = false;

            if !items.is_empty() {
                if stmt.items.is_empty() {
                    stmt.items = items;
                } else {
                    // TODO(port): std.mem.concat — allocate concatenated slice in arena
                    let mut concat =
                        BumpVec::with_capacity_in(stmt.items.len() + items.len(), p.allocator());
                    concat.extend_from_slice(stmt.items);
                    concat.extend_from_slice(items);
                    stmt.items = concat.into_bump_slice_mut();
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
                    let symbol = &mut p.symbols.items[namespace_ref.inner_index()];
                    symbol.use_count_estimate = 0;
                    symbol.link = stmt.namespace_ref;
                    // TODO(port): Zig `@hasField(@typeInfo(@TypeOf(p)).pointer.child, "symbol_uses")`
                    // — comptime reflection to check if P has `symbol_uses`. In Rust, make this
                    // a trait method with a default no-op impl that the parser overrides.
                    p.symbol_uses_swap_remove(namespace_ref);
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
            stmt_index: u32::try_from(self.stmts.len() - 1).unwrap(),
        };
        Ok(DeduplicatedImportResult { namespace_ref, import_record_index })
    }

    fn visit_binding_to_export<P>(
        &mut self,
        p: &mut P,
        binding: Binding,
    ) -> Result<(), AllocError> {
        match binding.data {
            js_ast::BindingData::BMissing => {}
            js_ast::BindingData::BIdentifier(id) => {
                self.visit_ref_to_export(p, id.ref_, None, binding.loc, false)?;
            }
            js_ast::BindingData::BArray(array) => {
                for item in array.items.iter() {
                    self.visit_binding_to_export(p, item.binding)?;
                }
            }
            js_ast::BindingData::BObject(object) => {
                for item in object.properties.iter() {
                    self.visit_binding_to_export(p, item.value)?;
                }
            }
        }
        Ok(())
    }

    fn visit_ref_to_export<P>(
        &mut self,
        p: &mut P,
        ref_: Ref,
        export_symbol_name: Option<&[u8]>,
        loc: logger::Loc,
        is_live_binding_source: bool,
    ) -> Result<(), AllocError> {
        let symbol = p.symbols.items[ref_.inner_index()];
        let id = if symbol.kind == js_ast::SymbolKind::Import {
            Expr::init(E::ImportIdentifier { ref_, ..Default::default() }, loc)
        } else {
            Expr::init_identifier(ref_, loc)
        };
        if is_live_binding_source
            || (symbol.kind == js_ast::SymbolKind::Import && !self.is_in_node_modules)
            || symbol.has_been_assigned_to
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
                E::String { data: export_symbol_name.unwrap_or(symbol.original_name) },
                loc,
            );

            // This is technically incorrect in that we've marked this as a
            // top level symbol. but all we care about is preventing name
            // collisions, not necessarily the best minificaiton (dev only)
            let arg1 = p.generate_temp_ref(symbol.original_name);
            self.last_part
                .declared_symbols
                .push(js_ast::DeclaredSymbol { ref_: arg1, is_top_level: true });
            self.last_part
                .symbol_uses
                .put_no_clobber(arg1, js_ast::SymbolUse { count_estimate: 1 })?;
            p.current_scope.generated.push(arg1);

            // 'get abc() { return abc }'
            self.export_props.push(G::Property {
                kind: G::PropertyKind::Get,
                key: Some(key),
                value: Some(Expr::init(
                    E::Function {
                        func: G::Fn {
                            body: G::FnBody {
                                stmts: p.allocator().alloc_slice_copy(&[Stmt::alloc(
                                    S::Return { value: Some(id) },
                                    loc,
                                )]),
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
                    E::String { data: export_symbol_name.unwrap_or(symbol.original_name) },
                    loc,
                )),
                value: Some(id),
                ..Default::default()
            });
        }
        Ok(())
    }

    pub fn finalize<P>(
        &mut self,
        p: &mut P,
        all_parts: &mut [js_ast::Part],
    ) -> Result<(), AllocError> {
        if !self.export_star_props.is_empty() {
            if self.export_props.is_empty() {
                core::mem::swap(&mut self.export_props, &mut self.export_star_props);
            } else {
                let export_star_len = self.export_star_props.len();
                self.export_props.reserve(export_star_len);
                let len = self.export_props.len();
                // SAFETY: capacity reserved above; the next two copies fully initialize
                // [0..len+export_star_len). G::Property is arena POD with no Drop.
                // TODO(port): verify G::Property is Copy/no-Drop for set_len safety.
                unsafe {
                    self.export_props.set_len(len + export_star_len);
                }
                // bun.copy with overlapping src/dst within same buffer
                self.export_props.copy_within(0..len, export_star_len);
                self.export_props[0..export_star_len]
                    .copy_from_slice(&self.export_star_props);
            }
        }

        if !self.export_props.is_empty() {
            let obj = Expr::init(
                E::Object {
                    properties: G::Property::List::move_from_list(&mut self.export_props),
                    ..Default::default()
                },
                logger::Loc::EMPTY,
            );

            // `hmr.exports = ...`
            self.stmts.push(Stmt::alloc(
                S::SExpr {
                    value: Expr::assign(
                        Expr::init(
                            E::Dot {
                                target: Expr::init_identifier(p.hmr_api_ref, logger::Loc::EMPTY),
                                name: b"exports",
                                name_loc: logger::Loc::EMPTY,
                                ..Default::default()
                            },
                            logger::Loc::EMPTY,
                        ),
                        obj,
                    ),
                    ..Default::default()
                },
                logger::Loc::EMPTY,
            ));

            // mark a dependency on module_ref so it is renamed
            self.last_part
                .symbol_uses
                .put(p.module_ref, js_ast::SymbolUse { count_estimate: 1 })?;
            self.last_part
                .declared_symbols
                .push(js_ast::DeclaredSymbol { ref_: p.module_ref, is_top_level: true });
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
                                        logger::Loc::EMPTY,
                                    ),
                                    name: b"reactRefreshAccept",
                                    name_loc: logger::Loc::EMPTY,
                                    ..Default::default()
                                },
                                logger::Loc::EMPTY,
                            ),
                            args: js_ast::ExprNodeList::EMPTY,
                            ..Default::default()
                        },
                        logger::Loc::EMPTY,
                    ),
                    ..Default::default()
                },
                logger::Loc::EMPTY,
            ));
        }

        // Merge all part metadata into the first part.
        let last_idx = all_parts.len() - 1;
        for part in all_parts[0..last_idx].iter_mut() {
            self.last_part
                .declared_symbols
                .append_list(&part.declared_symbols)?;
            self.last_part
                .import_record_indices
                .append_slice(p.allocator(), part.import_record_indices.as_slice())?;
            for (k, v) in part.symbol_uses.iter() {
                let gop = self.last_part.symbol_uses.get_or_put(*k)?;
                if !gop.found_existing {
                    *gop.value_ptr = *v;
                } else {
                    gop.value_ptr.count_estimate += v.count_estimate;
                }
            }
            part.stmts = &mut [];
            part.declared_symbols.entries.len = 0;
            part.tag = js_ast::PartTag::DeadDueToInlining;
            part.dependencies.clear();
            part.dependencies.push(
                p.allocator(),
                js_ast::Dependency {
                    part_index: u32::try_from(last_idx).unwrap(),
                    source_index: p.source.index,
                },
            )?;
        }

        self.last_part
            .import_record_indices
            .append_slice(p.allocator(), p.import_records_for_current_part.as_slice())?;
        self.last_part
            .declared_symbols
            .append_list(&p.declared_symbols)?;

        // TODO(port): self.stmts is BumpVec<'a, Stmt>; into_bump_slice() consumes by value,
        // but we hold &mut self. Phase B may need mem::take or change finalize to consume self.
        self.last_part.stmts = core::mem::take(&mut self.stmts).into_bump_slice_mut();
        self.last_part.tag = js_ast::PartTag::None;
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/ConvertESMExportsForHmr.zig (548 lines)
//   confidence: medium
//   todos:      7
//   notes:      `p: anytype` ported as unbounded generic <P>; needs trait in Phase B. AST enum variant names (StmtData/BindingData/ExprData) and G::Property struct-init shape are guessed from Zig tags. @hasField reflection mapped to a trait method stub.
// ──────────────────────────────────────────────────────────────────────────
