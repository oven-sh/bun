//! Under `bun test`, top-level `vi.mock()` / `jest.mock()` / `vi.hoisted()` statements run before
//! the imports of their file, which become `await import()`.

use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{self as js_ast, B, E, Expr, G, ImportKind, Ref, S, Stmt};
use bun_collections::VecExt;

use crate::p::P;
use crate::parser::Jest;

#[derive(Clone, Copy)]
pub(crate) enum MockApi {
    Vi,
    Jest,
}

impl MockApi {
    pub(crate) fn from_export_name(name: &[u8]) -> Option<MockApi> {
        match name {
            b"vi" | b"vitest" => Some(MockApi::Vi),
            b"jest" => Some(MockApi::Jest),
            _ => None,
        }
    }
}

pub(crate) fn is_test_module(path: &[u8]) -> bool {
    matches!(path, b"bun:test" | b"vitest" | b"@jest/globals")
}

/// When a top-level statement runs, in a file that hoists mocks.
#[derive(Clone, Copy)]
pub(crate) enum MockHoistOrder {
    BeforeHoisted,
    Hoisted,
    LoweredImport,
    InPlace,
}

impl<'a, const TS: bool, const SCAN: bool, const SEMA: bool> P<'a, TS, SCAN, SEMA> {
    fn mock_api(&self, ref_: Ref) -> Option<MockApi> {
        if let Some(global) = self.jest.refs.iter().position(|global| global.eql(ref_)) {
            return MockApi::from_export_name(Jest::GLOBALS[global].as_bytes());
        }
        self.imported_mock_apis
            .iter()
            .find(|(imported, _)| imported.eql(ref_))
            .map(|(_, api)| *api)
    }

    /// What an identifier of a top-level statement is bound to, before the visit pass.
    fn unvisited_top_level_symbol(&self, name: Ref) -> Option<Ref> {
        self.module_scope()
            .members
            .get(self.load_name_from_ref(name))
            .map(|member| member.ref_)
    }

    /// The `vi` and `mock` of `vi.mock(...)` or `await vi.mock(...)`, before the visit pass.
    /// `jest.mock()` returns `jest`: of `jest.mock(...).unmock(...)`, the `jest` and `unmock`.
    fn unvisited_top_level_mock_call(&self, expr: Expr) -> Option<(MockApi, &'a [u8])> {
        let mut callee = match expr.data {
            ExprData::EAwait(awaited) => awaited.value,
            _ => expr,
        };
        let mut last_name = None;
        loop {
            let ExprData::ECall(call) = callee.data else {
                return None;
            };
            let ExprData::EDot(dot) = call.target.data else {
                return None;
            };
            if call.optional_chain.is_some() || dot.optional_chain.is_some() {
                return None;
            }
            let is_chain = last_name.is_some();
            // Like babel-jest: one call that is not hoisted keeps the whole chain in its place.
            if is_chain && !matches!(dot.name.slice(), b"mock" | b"unmock") {
                return None;
            }
            let last_name = *last_name.get_or_insert(dot.name.slice());
            match dot.target.data {
                ExprData::EIdentifier(id) => {
                    let api = self.mock_api(self.unvisited_top_level_symbol(id.ref_)?)?;
                    return (!is_chain || matches!(api, MockApi::Jest)).then_some((api, last_name));
                }
                ExprData::ECall(_) => callee = dot.target,
                _ => return None,
            }
        }
    }

    fn is_hoisted_mock_stmt(&self, stmt: &Stmt) -> bool {
        match stmt.data {
            StmtData::SExpr(expr) => matches!(
                self.unvisited_top_level_mock_call(expr.value),
                Some((_, b"mock" | b"unmock") | (MockApi::Vi, b"hoisted"))
            ),
            StmtData::SLocal(local) => {
                !local.kind.is_using()
                    && local.decls.slice().iter().any(|decl| {
                        decl.value.is_some_and(|value| {
                            matches!(
                                self.unvisited_top_level_mock_call(value),
                                Some((MockApi::Vi, b"hoisted"))
                            )
                        })
                    })
            }
            _ => false,
        }
    }

    /// Runs before the visit pass. `None` when no statement is hoisted.
    pub(crate) fn plan_mock_hoisting(&mut self, stmts: &[Stmt]) -> Option<&'a [MockHoistOrder]> {
        if !stmts.iter().any(|stmt| self.is_hoisted_mock_stmt(stmt)) {
            return None;
        }

        let mut exported = BumpVec::<Ref>::new_in(self.arena);
        for stmt in stmts {
            if let StmtData::SExportClause(clause) = stmt.data {
                exported.extend(
                    clause
                        .items
                        .iter()
                        .filter_map(|item| self.unvisited_top_level_symbol(item.name.ref_)),
                );
            }
        }

        let mut order = BumpVec::with_capacity_in(stmts.len(), self.arena);
        for stmt in stmts {
            order.push(match stmt.data {
                StmtData::SImport(import) => self.plan_import(&import, &exported),
                _ if self.is_hoisted_mock_stmt(stmt) => MockHoistOrder::Hoisted,
                _ => MockHoistOrder::InPlace,
            });
        }
        Some(order.into_bump_slice())
    }

    /// The names of a lowered import become reads of its namespace. Any other import stays static.
    pub(crate) fn plan_import(&mut self, import: &S::Import, exported: &[Ref]) -> MockHoistOrder {
        let record = &self.import_records.items()[import.import_record_index as usize];
        // "bun" prints as `var`s that read `globalThis.Bun`.
        if is_test_module(record.path.text) || record.path.text == b"bun" {
            return MockHoistOrder::BeforeHoisted;
        }
        if import.phase_defer
            || record.loader.is_some()
            || record.tag != js_ast::ImportRecordTag::None
        {
            return MockHoistOrder::InPlace;
        }

        let bindings = || {
            import
                .default_name
                .iter()
                .map(|name| (name.ref_, js_ast::StoreStr::new(b"default")))
                .chain(import.items.iter().map(|item| (item.name.ref_, item.alias)))
        };
        // `export { a }` needs `a` to be a binding.
        if bindings().any(|(ref_, _)| exported.iter().any(|exported| exported.eql(ref_))) {
            return MockHoistOrder::InPlace;
        }

        if import.star_name_loc.is_empty() && bindings().next().is_some() {
            self.temp_ref_count += 1;
            let namespace = &mut self.symbols[import.namespace_ref.inner_index() as usize];
            namespace.original_name = js_ast::StoreStr::new(
                bun_alloc::arena_format!(
                    in self.arena,
                    "{}${}",
                    bstr::BStr::new(namespace.original_name.slice()),
                    self.temp_ref_count
                )
                .into_bump_str()
                .as_bytes(),
            );
        }
        for (ref_, alias) in bindings() {
            self.symbols[ref_.inner_index() as usize].namespace_alias =
                Some(bun_alloc::ast_box(G::NamespaceAlias {
                    namespace_ref: import.namespace_ref,
                    alias,
                    import_record_index: import.import_record_index,
                    was_originally_property_access: false,
                }));
        }
        MockHoistOrder::LoweredImport
    }

    /// `ImportScanner` lowers an `S::Import` whose record is dynamic.
    pub(crate) fn append_hoisted_mocks(
        &mut self,
        before: &mut BumpVec<'a, js_ast::Part>,
        hoisted: &mut BumpVec<'a, js_ast::Part>,
        imports: &mut BumpVec<'a, js_ast::Part>,
        exports_kind: js_ast::ExportsKind,
    ) {
        if exports_kind != js_ast::ExportsKind::Cjs {
            for stmt in imports.iter().flat_map(|part| part.stmts.iter()) {
                if let StmtData::SImport(import) = stmt.data {
                    self.import_records.items_mut()[import.import_record_index as usize].kind =
                        ImportKind::Dynamic;
                }
            }
        }
        before.append(hoisted);
        before.append(imports);
    }

    /// `const ns = await import("a")`, after the unused names of `import` were removed.
    pub(crate) fn lower_import_to_dynamic(&mut self, import: &S::Import, loc: js_ast::Loc) -> Stmt {
        let record = &self.import_records.items()[import.import_record_index as usize];
        let (path, path_loc) = (record.path.text, record.range.loc);
        let path = self.new_expr(E::String::init(path), path_loc);
        let namespace = self.new_expr(
            E::Import {
                expr: path,
                options: Expr::EMPTY,
                import_record_index: import.import_record_index,
                namespace_ref: Ref::NONE,
            },
            loc,
        );
        let value = self.new_expr(E::Await { value: namespace }, loc);

        if self.top_level_await_keyword.is_empty() {
            self.top_level_await_keyword = js_ast::Range {
                loc,
                len: b"import".len() as i32,
            };
        }

        if import.default_name.is_none()
            && import.items.is_empty()
            && import.star_name_loc.is_empty()
        {
            return self.s(
                S::SExpr {
                    value,
                    ..Default::default()
                },
                loc,
            );
        }
        let binding = self.b(
            B::Identifier {
                r#ref: import.namespace_ref,
            },
            loc,
        );
        self.s(
            S::Local {
                kind: S::Kind::KConst,
                decls: G::DeclList::init_one(G::Decl {
                    binding,
                    value: Some(value),
                }),
                ..Default::default()
            },
            loc,
        )
    }

    /// `vi.mock(import("./a"))` means `vi.mock("./a")`. Runs before the arguments are visited.
    pub(crate) fn unwrap_import_in_mock_path(&self, call: &mut E::Call) {
        let Some(path) = call.args.slice_mut().first_mut() else {
            return;
        };
        let path = match &mut path.data {
            ExprData::EAwait(awaited) => &mut awaited.value,
            _ => path,
        };
        let ExprData::EImport(import) = path.data else {
            return;
        };
        let ExprData::EDot(dot) = call.target.data else {
            return;
        };
        let api = match dot.target.data {
            ExprData::EIdentifier(id) => id.ref_,
            ExprData::EImportIdentifier(id) => id.ref_,
            _ => return,
        };
        if matches!(
            dot.name.slice(),
            b"mock" | b"unmock" | b"doMock" | b"doUnmock"
        ) && self.mock_api(api).is_some()
        {
            *path = import.expr;
        }
    }
}
