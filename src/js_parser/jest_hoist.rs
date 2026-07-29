//! Hoist `jest.mock()` / `vi.mock()` / `mock.module()` above imports in test
//! files, matching babel-plugin-jest-hoist and Vitest's transform.
//!
//! Static ESM imports are evaluated before any module body code, so a bare
//! reorder is not enough: when a hoistable call is present we also rewrite the
//! test file's remaining static imports to `var {...} = await import("...")`
//! so they evaluate in statement order after the mocks are installed.
//!
//! Only applied when `inject_jest_globals` is on (bun test) and only to files
//! that actually contain a hoistable call, so the common case is untouched.

use bun_alloc::Arena as Bump;
use bun_alloc::ArenaVec as BumpVec;
use bun_collections::VecExt;

use bun_ast as js_ast;
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{B, Binding, E, Expr, G, S, Stmt};

use crate::p::P;

impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    fn is_hoistable_mock_stmt(&self, stmt: &Stmt) -> bool {
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
        if ref_.is_source_contents_slice() {
            return false;
        }
        let symbol = &self.symbols.as_slice()[ref_.inner_index() as usize];
        // Only hoist when `jest`/`vi`/`mock` refers to the bun:test binding:
        // either the auto-injected Unbound symbol or a user `import {...}` item.
        if !matches!(
            symbol.kind,
            js_ast::symbol::Kind::Unbound | js_ast::symbol::Kind::Import
        ) {
            return false;
        }
        let obj = symbol.original_name.slice();
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
        let mut has_hoistable = false;
        'scan: for part in parts.iter() {
            for stmt in part.stmts.iter() {
                if self.is_hoistable_mock_stmt(stmt) {
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

        for part in parts.iter_mut() {
            let old_len = part.stmts.len();
            let mut kept = BumpVec::<Stmt>::with_capacity_in(old_len, bump);
            for stmt in part.stmts.iter() {
                if self.is_hoistable_mock_stmt(stmt) {
                    hoisted.push(*stmt);
                    continue;
                }
                if let StmtData::SImport(import_data) = stmt.data {
                    let path: &'static [u8] = self.import_records.items()
                        [import_data.import_record_index as usize]
                        .path
                        .text;
                    // Keep bun:test / @jest/globals / vitest as static imports so
                    // `jest` / `vi` / `mock` are bound (engine-hoisted) before the
                    // hoisted mock calls run.
                    if matches!(path, b"bun:test" | b"@jest/globals" | b"vitest") {
                        kept.push(*stmt);
                        continue;
                    }
                    self.lower_import_to_await_import(&import_data, path, stmt.loc, &mut kept, bump);
                    continue;
                }
                kept.push(*stmt);
            }
            part.stmts = bun_ast::StoreSlice::from_bump(kept);
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

        // The original S::Import record is now dead; mark it so later passes
        // don't resolve it as a static dependency.
        self.import_records.items_mut()[st.import_record_index as usize]
            .flags
            .insert(bun_ast::ImportRecordFlags::IS_UNUSED);

        let items: &[bun_ast::ClauseItem] = st.items.slice();
        let has_star = !st.star_name_loc.is_empty();
        let has_default = st.default_name.is_some();
        let has_named = !items.is_empty();

        if has_star {
            // import * as ns from "m"            -> var ns = await import("m")
            // import d, * as ns from "m"         -> var ns = await import("m"); var d = ns.default;
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
                    binding: Binding::alloc(bump, B::Identifier { r#ref: default.ref_ }, default.loc),
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
            let value = self.b(B::Identifier { r#ref: default.ref_ }, default.loc);
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
            let value = self.b(B::Identifier { r#ref: item.name.ref_ }, item.name.loc);
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
