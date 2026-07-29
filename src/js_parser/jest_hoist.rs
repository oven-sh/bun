//! Hoist top-level `jest.mock()` / `vi.mock()` / `mock.module()` above a test
//! file's imports (babel-plugin-jest-hoist / Vitest semantics). Static ESM
//! imports evaluate before any body code, so the remaining imports are also
//! lowered to `await import(...)` so they run after the hoisted mocks.

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVec as BumpVec;
use bun_collections::VecExt;

use bun_ast as js_ast;
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{B, Binding, E, Expr, G, Ref, S, Stmt};

use crate::p::P;

fn is_bun_test_path(path: &[u8]) -> bool {
    matches!(path, b"bun:test" | b"@jest/globals" | b"vitest")
}

impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    /// Refs that are valid `jest`/`vi`/`mock` callees: the auto-injected
    /// Unbound symbols plus any `import { jest | vi | mock }` item that
    /// actually came from bun:test / @jest/globals / vitest.
    fn collect_bun_test_mock_refs<'bump>(
        &self,
        parts: &BumpVec<'bump, js_ast::Part>,
        bump: &'bump Bump,
    ) -> BumpVec<'bump, Ref> {
        let mut refs = BumpVec::<Ref>::with_capacity_in(6, bump);
        for r in [self.jest.jest, self.jest.vi, self.jest.mock] {
            if !r.is_null() {
                refs.push(r);
            }
        }
        for part in parts.iter() {
            for stmt in part.stmts.iter() {
                let StmtData::SImport(st) = stmt.data else {
                    continue;
                };
                let path = self.import_records.items()[st.import_record_index as usize]
                    .path
                    .text;
                if !is_bun_test_path(path) {
                    continue;
                }
                for item in st.items.iter() {
                    if matches!(item.alias.slice(), b"jest" | b"vi" | b"mock") {
                        refs.push(item.name.ref_);
                    }
                }
            }
        }
        refs
    }

    fn is_hoistable_mock_stmt(&self, stmt: &Stmt, allowed: &[Ref]) -> bool {
        let StmtData::SExpr(sexpr) = stmt.data else {
            return false;
        };
        let ExprData::ECall(call) = sexpr.value.data else {
            return false;
        };
        let ExprData::EDot(dot) = call.target.data else {
            return false;
        };
        let ref_ = match dot.target.data {
            ExprData::EIdentifier(id) => id.ref_,
            ExprData::EImportIdentifier(id) => id.ref_,
            _ => return false,
        };
        if ref_.is_source_contents_slice() || !allowed.iter().any(|r| r.eql(ref_)) {
            return false;
        }
        let obj = self.symbols.as_slice()[ref_.inner_index() as usize]
            .original_name
            .slice();
        let method = dot.name.slice();
        match obj {
            b"jest" | b"vi" => matches!(method, b"mock" | b"unmock"),
            b"mock" => method == b"module",
            _ => false,
        }
    }

    /// Mirrors the TypeScript cull in ImportScanner: every binding is used only
    /// in type position, so leave the `S::Import` in place for ImportScanner to
    /// elide instead of forcing a runtime `await import()` on a module that may
    /// only exist in the type system.
    fn import_is_ts_type_only(&self, st: &S::Import) -> bool {
        if !TS
            || !self.options.features.trim_unused_imports
            || self.options.preserve_unused_imports_ts
        {
            return false;
        }
        let mut found = false;
        let used = |r: Ref| self.ts_use_counts[r.inner_index() as usize] != 0;
        if let Some(d) = st.default_name {
            found = true;
            if used(d.ref_) {
                return false;
            }
        }
        if !st.star_name_loc.is_empty() {
            found = true;
            if used(st.namespace_ref) {
                return false;
            }
        }
        for item in st.items.iter() {
            found = true;
            if used(item.name.ref_) {
                return false;
            }
        }
        found
    }

    pub fn hoist_jest_module_mocks<'bump>(
        &mut self,
        parts: &mut BumpVec<'bump, js_ast::Part>,
        before: &mut BumpVec<'bump, js_ast::Part>,
        bump: &'bump Bump,
    ) {
        let allowed = self.collect_bun_test_mock_refs(parts, bump);

        let mut has_hoistable = false;
        'scan: for part in parts.iter() {
            for stmt in part.stmts.iter() {
                if self.is_hoistable_mock_stmt(stmt, &allowed) {
                    has_hoistable = true;
                    break 'scan;
                }
            }
        }
        if !has_hoistable {
            return;
        }

        let mut hoisted = BumpVec::<Stmt>::new_in(bump);
        let mut lowered_any_import = false;

        for part in parts.iter_mut() {
            let old_len = part.stmts.len();
            let mut kept = BumpVec::<Stmt>::with_capacity_in(old_len, bump);
            for stmt in part.stmts.iter() {
                if self.is_hoistable_mock_stmt(stmt, &allowed) {
                    hoisted.push(*stmt);
                    continue;
                }
                if let StmtData::SImport(import_data) = stmt.data {
                    let record =
                        &self.import_records.items()[import_data.import_record_index as usize];
                    let path: &'static [u8] = record.path.text;
                    // Keep bun:test static so `jest`/`vi`/`mock` bind before the
                    // hoisted calls; keep `with { type: ... }` / `import defer`
                    // since lowering would drop the attribute/phase; keep
                    // TS-type-only imports so ImportScanner can elide them.
                    if is_bun_test_path(path)
                        || record.loader.is_some()
                        || import_data.phase_defer
                        || self.import_is_ts_type_only(&import_data)
                    {
                        kept.push(*stmt);
                        continue;
                    }
                    self.lower_import_to_await_import(
                        &import_data,
                        path,
                        stmt.loc,
                        &mut kept,
                        bump,
                    );
                    lowered_any_import = true;
                    continue;
                }
                kept.push(*stmt);
            }
            part.stmts = bun_ast::StoreSlice::from_bump(kept);
        }

        // The isolation ModuleInfo path reads `top_level_await_keyword` to set
        // `has_tla`; we just emitted top-level `await import()`.
        if lowered_any_import && self.top_level_await_keyword.is_empty() {
            self.top_level_await_keyword = bun_ast::Range {
                loc: bun_ast::Loc::EMPTY,
                len: 1,
            };
        }

        before.push(js_ast::Part {
            stmts: bun_ast::StoreSlice::from_bump(hoisted),
            tag: bun_ast::PartTag::BunTest,
            ..Default::default()
        });
    }

    /// Emit `var ns = await import("m")` and point every named/default binding
    /// at `ns.<alias>` via `namespace_alias` so existing `E::ImportIdentifier`
    /// uses print as property reads on the (mutable) namespace object. This
    /// keeps `mock.module()` re-mocks live for the test file's own imports.
    fn lower_import_to_await_import<'bump>(
        &mut self,
        st: &S::Import,
        path: &'static [u8],
        loc: bun_ast::Loc,
        out: &mut BumpVec<'bump, Stmt>,
        bump: &'bump Bump,
    ) {
        let str_expr = self.new_expr(
            E::String {
                data: path.into(),
                ..Default::default()
            },
            loc,
        );
        let import_expr = self.new_expr(
            E::Import {
                expr: str_expr,
                options: Expr::EMPTY,
                import_record_index: u32::MAX,
            },
            loc,
        );
        let await_expr = self.new_expr(E::Await { value: import_expr }, loc);

        self.import_records.items_mut()[st.import_record_index as usize]
            .flags
            .insert(bun_ast::ImportRecordFlags::IS_UNUSED);

        let items: &[bun_ast::ClauseItem] = st.items.slice();
        let has_star = !st.star_name_loc.is_empty();
        let has_default = st.default_name.is_some();
        let has_named = !items.is_empty();

        if !has_star && !has_default && !has_named {
            // import "m" -> await import("m")
            out.push(self.s(
                S::SExpr {
                    value: await_expr,
                    ..Default::default()
                },
                loc,
            ));
            return;
        }

        let ns_ref = st.namespace_ref;
        // For non-star imports the parser synthesised `namespace_ref` with a
        // non-unique `import_<basename>` name that was never meant to be
        // printed; two paths sharing a basename would collide at runtime.
        if !has_star {
            let unique: &'a [u8] = bun_alloc::arena_format!(
                in self.arena,
                "__bun_import_{:x}$",
                st.import_record_index
            )
            .into_bump_str()
            .as_bytes();
            self.symbols[ns_ref.inner_index() as usize].original_name =
                js_ast::StoreStr::new(unique);
        }
        let mut decls = G::DeclList::init_capacity(1);
        decls.append_assume_capacity(G::Decl {
            binding: Binding::alloc(bump, B::Identifier { r#ref: ns_ref }, loc),
            value: Some(await_expr),
        });
        out.push(self.s(
            S::Local {
                kind: js_ast::LocalKind::KVar,
                decls,
                ..Default::default()
            },
            loc,
        ));

        let record_index = st.import_record_index;
        if let Some(default) = st.default_name {
            self.symbols[default.ref_.inner_index() as usize].namespace_alias =
                Some(bun_alloc::ast_box(G::NamespaceAlias {
                    namespace_ref: ns_ref,
                    alias: js_ast::StoreStr::new(b"default"),
                    import_record_index: record_index,
                    was_originally_property_access: true,
                }));
        }
        for item in items.iter() {
            self.symbols[item.name.ref_.inner_index() as usize].namespace_alias =
                Some(bun_alloc::ast_box(G::NamespaceAlias {
                    namespace_ref: ns_ref,
                    alias: item.alias,
                    import_record_index: record_index,
                    was_originally_property_access: true,
                }));
        }
    }
}
