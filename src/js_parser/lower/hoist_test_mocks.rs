//! `bun test` hoists top-level `vi.mock()`, `jest.mock()` and `vi.hoisted()` above imports, which become `await import()`.
//! A Vitest test file's imports become `await import()` even without such a call, because one import may mock what the next loads.

use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{self as js_ast, B, E, Expr, G, ImportKind, Ref, S, Stmt};
use bun_collections::VecExt;

use crate::p::P;
use crate::parser::{Jest, RefMap};

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

pub(crate) use bun_ast::import_record::is_test_module;

#[derive(Clone, Copy)]
pub(crate) enum MockHoistOrder {
    BeforeHoisted,
    Hoisted,
    LoweredImport,
    InPlace,
}

/// Rewrites a lowered import's callee to `(0, ns.fn)`, so the call doesn't pass `ns` as `this`.
pub(crate) fn drop_namespace_of_lowered_callee(
    symbols: &[js_ast::Symbol],
    callee: &mut Expr,
) -> bool {
    let ExprData::EImportIdentifier(import) = callee.data else {
        return false;
    };
    let symbol = &symbols[import.ref_.inner_index() as usize];
    // A TypeScript namespace member from another block also has a `namespace_alias`, but keeps its `this`.
    let is_lowered = import.was_originally_identifier()
        && symbol.kind == js_ast::symbol::Kind::Import
        && symbol.namespace_alias.is_some();
    if is_lowered {
        *callee = Expr {
            data: crate::prefill::data::ZERO,
            loc: callee.loc,
        }
        .join_with_comma(*callee);
    }
    is_lowered
}

impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    /// Picks the transpiler cache key, so `bun test` and `bun run` have to compute the same answer.
    pub(crate) fn uses_test_api(&self) -> bool {
        self.has_hoisted_mock_stmt
            || self
                .import_records
                .items()
                .iter()
                .any(|record| is_test_module(record.path.text))
            || Jest::GLOBALS.iter().any(|global| {
                self.module_scope()
                    .members
                    .get(global.as_bytes())
                    .is_some_and(|member| {
                        self.symbols[member.ref_.inner_index() as usize].kind
                            == js_ast::symbol::Kind::Unbound
                    })
            })
    }

    pub(crate) fn imports_vitest(&self) -> bool {
        self.import_records
            .items()
            .iter()
            .any(|record| record.path.text == b"vitest")
    }

    /// Vitest finishes running each import before it starts the next. Static imports are all linked before any of them
    /// runs, and once a module is linked the only way to mock it is to overwrite its exports.
    fn runs_imports_in_turn(&self, stmts: &[Stmt]) -> bool {
        self.options.features.is_test_entry_point
            && self.has_globals_of_vitest()
            && stmts
                .iter()
                .filter(|stmt| match stmt.data {
                    StmtData::SImport(import) => !is_test_module(
                        self.import_records.items()[import.import_record_index as usize]
                            .path
                            .text,
                    ),
                    _ => false,
                })
                .nth(1)
                .is_some()
    }

    pub(crate) fn has_globals_of_vitest(&self) -> bool {
        self.options.features.vitest_globals || self.imports_vitest()
    }

    fn global_mock_api(&self, name: &[u8]) -> Option<MockApi> {
        match MockApi::from_export_name(name)? {
            MockApi::Jest if self.has_globals_of_vitest() => None,
            api => Some(api),
        }
    }

    #[optimize(size)]
    fn mock_api(&self, ref_: Ref) -> Option<MockApi> {
        if let Some(global) = self.jest.refs.iter().position(|global| global.eql(ref_)) {
            return self.global_mock_api(Jest::GLOBALS[global].as_bytes());
        }
        self.imported_mock_apis.get(&ref_).copied()
    }

    #[optimize(size)]
    fn unvisited_top_level_symbol(&self, name: Ref) -> Option<Ref> {
        self.module_scope()
            .members
            .get(self.load_name_from_ref(name))
            .map(|member| member.ref_)
    }

    /// Globals have no symbol before the visit pass, so an unbound identifier is matched by name.
    fn unvisited_top_level_mock_api(&self, name: Ref) -> Option<MockApi> {
        match self.unvisited_top_level_symbol(name) {
            Some(symbol) => self.mock_api(symbol),
            None => self.global_mock_api(self.load_name_from_ref(name)),
        }
    }

    /// Returns (api, method). For a `jest.mock(...).unmock(...)` chain, that's the last method.
    #[optimize(size)]
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
            // Like babel-jest, one call that can't be hoisted keeps the whole chain in place.
            if is_chain && !matches!(dot.name.slice(), b"mock" | b"unmock") {
                return None;
            }
            let last_name = *last_name.get_or_insert_with(|| dot.name.slice());
            match dot.target.data {
                ExprData::EIdentifier(id) => {
                    let api = self.unvisited_top_level_mock_api(id.ref_)?;
                    return (!is_chain || matches!(api, MockApi::Jest)).then_some((api, last_name));
                }
                ExprData::ECall(_) => callee = dot.target,
                _ => return None,
            }
        }
    }

    #[optimize(size)]
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

    fn is_unvisited_primitive_literal(&self, expr: Expr) -> bool {
        match expr.data {
            ExprData::EString(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EBoolean(_)
            | ExprData::ENull(_) => true,
            ExprData::EUnary(unary) => {
                unary.op == js_ast::OpCode::UnNeg
                    && matches!(
                        unary.value.data,
                        ExprData::ENumber(_) | ExprData::EBigInt(_)
                    )
            }
            ExprData::EIdentifier(id) => {
                self.load_name_from_ref(id.ref_) == b"undefined"
                    && self.unvisited_top_level_symbol(id.ref_).is_none()
            }
            _ => false,
        }
    }

    /// Like babel-jest, `const a = "a"` is hoisted with the mocks so their factories can read it.
    fn is_primitive_literal_declaration(&self, stmt: &Stmt) -> bool {
        let StmtData::SLocal(local) = stmt.data else {
            return false;
        };
        matches!(local.kind, S::Kind::KConst | S::Kind::KLet)
            && local.decls.slice().iter().all(|decl| {
                matches!(decl.binding.data, js_ast::binding::Data::BIdentifier(_))
                    && decl
                        .value
                        .is_some_and(|value| self.is_unvisited_primitive_literal(value))
            })
    }

    /// Must run before the visit pass.
    #[optimize(size)]
    pub(crate) fn plan_mock_hoisting(&mut self, stmts: &[Stmt]) -> Option<&'a [MockHoistOrder]> {
        self.has_hoisted_mock_stmt = stmts.iter().any(|stmt| self.is_hoisted_mock_stmt(stmt));
        if !self.options.features.inject_jest_globals
            || !(self.has_hoisted_mock_stmt || self.runs_imports_in_turn(stmts))
        {
            return None;
        }
        self.did_apply_test_feature = true;

        let mut exported = RefMap::default();
        for stmt in stmts {
            if let StmtData::SExportClause(clause) = stmt.data {
                for item in clause.items.iter() {
                    if let Some(ref_) = self.unvisited_top_level_symbol(item.name.ref_) {
                        exported.insert(ref_, ());
                    }
                }
            }
        }

        let mut order = BumpVec::with_capacity_in(stmts.len(), self.arena);
        for stmt in stmts {
            order.push(match stmt.data {
                StmtData::SImport(import) => self.plan_import(&import, &exported),
                _ if self.is_hoisted_mock_stmt(stmt)
                    || self.is_primitive_literal_declaration(stmt) =>
                {
                    MockHoistOrder::Hoisted
                }
                _ => MockHoistOrder::InPlace,
            });
        }
        Some(order.into_bump_slice())
    }

    /// Aliases a lowered import's names to its namespace, so `a` prints as `ns.a`.
    #[optimize(size)]
    pub(crate) fn plan_import(&mut self, import: &S::Import, exported: &RefMap) -> MockHoistOrder {
        let record = &self.import_records.items()[import.import_record_index as usize];
        // An import of "bun" prints as `var`s that read `globalThis.Bun`.
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
        if bindings().any(|(ref_, _)| exported.contains_key(&ref_)) {
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

    /// `ImportKind::Dynamic` on an `S::Import`'s record tells `ImportScanner` to lower it.
    #[optimize(size)]
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

    #[optimize(size)]
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

    /// Rewrites `vi.mock(import("./a"))` to `vi.mock("./a")`. Returns true if it visited the first argument.
    pub(crate) fn visit_import_in_mock_path(&mut self, call: &mut E::Call) -> bool {
        if self.is_control_flow_dead {
            return false;
        }
        let ExprData::EDot(dot) = call.target.data else {
            return false;
        };
        let api = match dot.target.data {
            ExprData::EIdentifier(id) => id.ref_,
            ExprData::EImportIdentifier(id) => id.ref_,
            _ => return false,
        };
        let Some(path) = call.args.slice_mut().first_mut() else {
            return false;
        };
        let path = match &mut path.data {
            ExprData::EAwait(awaited) => &mut awaited.value,
            _ => path,
        };
        let ExprData::EImport(mut import) = path.data else {
            return false;
        };
        if !matches!(
            dot.name.slice(),
            b"mock" | b"unmock" | b"doMock" | b"doUnmock"
        ) || self.mock_api(api).is_none()
        {
            return false;
        }
        self.visit_expr(&mut import.expr);
        // The options are dropped, so visit them as dead code to keep them from adding import records.
        let was_control_flow_dead = core::mem::replace(&mut self.is_control_flow_dead, true);
        self.visit_expr(&mut import.options);
        self.is_control_flow_dead = was_control_flow_dead;
        *path = import.expr;
        self.did_apply_test_feature = true;
        true
    }
}
