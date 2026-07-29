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
                let path =
                    self.import_records.items()[st.import_record_index as usize].path.text;
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

        if let Some(cache) = self.options.features.runtime_transpiler_cache_mut() {
            cache.input_hash = None;
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
                    // hoisted calls, and keep `with { type: ... }` / `import defer`
                    // since `await import()` drops those and mock.module() cannot
                    // affect asset or deferred modules anyway.
                    if is_bun_test_path(path)
                        || record.loader.is_some()
                        || import_data.phase_defer
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

        if has_star {
            // import [d,] * as ns from "m" -> var ns = await import("m")[; var d = ns.default]
            let ns_ref = st.namespace_ref;
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
            if let Some(default) = st.default_name {
                let ns_id = self.new_expr(
                    E::Identifier {
                        ref_: ns_ref,
                        ..Default::default()
                    },
                    loc,
                );
                let dot = self.new_expr(
                    E::Dot {
                        target: ns_id,
                        name: b"default".into(),
                        name_loc: loc,
                        ..Default::default()
                    },
                    loc,
                );
                let mut decls = G::DeclList::init_capacity(1);
                decls.append_assume_capacity(G::Decl {
                    binding: Binding::alloc(
                        bump,
                        B::Identifier {
                            r#ref: default.ref_,
                        },
                        default.loc,
                    ),
                    value: Some(dot),
                });
                out.push(self.s(
                    S::Local {
                        kind: js_ast::LocalKind::KVar,
                        decls,
                        ..Default::default()
                    },
                    loc,
                ));
            }
            return;
        }

        if !has_default && !has_named {
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

        // import d, { a, b as c } from "m" -> var { default: d, a, b: c } = await import("m")
        let mut props =
            BumpVec::<B::Property>::with_capacity_in(items.len() + usize::from(has_default), bump);
        if let Some(default) = st.default_name {
            let key = self.new_expr(
                E::String {
                    data: b"default".into(),
                    ..Default::default()
                },
                loc,
            );
            let value = self.b(
                B::Identifier {
                    r#ref: default.ref_,
                },
                default.loc,
            );
            props.push(B::Property {
                flags: bun_ast::flags::PROPERTY_NONE,
                key,
                value,
                default_value: None,
            });
        }
        for item in items.iter() {
            let alias: &'static [u8] = item.alias.slice();
            let key = self.new_expr(
                E::String {
                    data: alias.into(),
                    ..Default::default()
                },
                loc,
            );
            let value = self.b(
                B::Identifier {
                    r#ref: item.name.ref_,
                },
                item.name.loc,
            );
            props.push(B::Property {
                flags: bun_ast::flags::PROPERTY_NONE,
                key,
                value,
                default_value: None,
            });
        }
        let props = bun_ast::StoreSlice::from_bump(props);
        let binding = self.b(
            B::Object {
                properties: props,
                is_single_line: true,
            },
            loc,
        );
        let mut decls = G::DeclList::init_capacity(1);
        decls.append_assume_capacity(G::Decl {
            binding,
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
    }
}
