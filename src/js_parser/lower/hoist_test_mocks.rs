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

/// One `.importActual`, `.requireActual` or call of a variable of either name.
#[derive(Clone, Copy)]
pub(crate) struct OriginalRequest<'a> {
    /// Where the name is.
    loc: js_ast::Loc,
    /// What it is called with, and where its variables are looked up. `None`: it may request any module.
    module: Option<(Literal<'a>, js_ast::StoreRef<js_ast::Scope>)>,
}

/// The requests in the body of one function.
pub(crate) struct FunctionRequests<'a> {
    body_loc: js_ast::Loc,
    requests: &'a [OriginalRequest<'a>],
}

/// An expression that is written with strings, numbers and names alone. It is evaluated once every declaration is
/// parsed: see `evaluate_literal`.
#[derive(Clone, Copy)]
pub(crate) enum Literal<'a> {
    /// A lone surrogate is a NUL here.
    String(&'a [u8]),
    Number(f64),
    Variable(&'a [u8]),
    /// `object.name` or `object["name"]`
    Member(&'a [u8], &'a [u8]),
    Sum(&'a [Literal<'a>; 2]),
    /// The strings and the holes, in order.
    Template(&'a [Literal<'a>]),
}

/// A `const`, or a member of an enum, that is initialized with a `Literal`.
pub(crate) struct Constant<'a> {
    declared: Ref,
    enum_member: Option<&'a [u8]>,
    value: Literal<'a>,
}

enum LiteralValue {
    String(Vec<u8>),
    Number(f64),
}

impl LiteralValue {
    /// As JavaScript converts it to a string. `None` for a number that JavaScript may print otherwise than Rust.
    fn into_string(self) -> Option<Vec<u8>> {
        match self {
            LiteralValue::String(value) => Some(value),
            LiteralValue::Number(value) => (value == 0.0
                || (1e-6..9007199254740992.0).contains(&value))
            .then(|| value.to_string().into_bytes()),
        }
    }
}

fn requests_original(name: &[u8]) -> bool {
    matches!(name, b"importActual" | b"requireActual")
}

/// Whether `test` is truthy, if it is written with literals alone.
#[cold]
#[inline(never)]
fn find_literal_truth(test: &Expr) -> Option<bool> {
    match test.data {
        ExprData::EBoolean(literal) => Some(literal.value),
        ExprData::ENumber(literal) => Some(literal.value() != 0.0),
        ExprData::EString(literal) => Some(literal.len() != 0),
        ExprData::ENull(_) => Some(false),
        ExprData::EUnary(unary) => match unary.op {
            js_ast::OpCode::UnNot => find_literal_truth(&unary.value).map(|is_true| !is_true),
            js_ast::OpCode::UnVoid => Some(false),
            js_ast::OpCode::UnNeg | js_ast::OpCode::UnPos => match unary.value.data {
                ExprData::ENumber(literal) => Some(literal.value() != 0.0),
                _ => None,
            },
            _ => None,
        },
        ExprData::EBinary(either)
            if matches!(
                either.op,
                js_ast::OpCode::BinLogicalAnd | js_ast::OpCode::BinLogicalOr
            ) =>
        {
            let left = find_literal_truth(&either.left)?;
            match left == (either.op == js_ast::OpCode::BinLogicalOr) {
                true => Some(left),
                false => find_literal_truth(&either.right),
            }
        }
        _ => None,
    }
}

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

    /// These find the file or the position of the call in the frame of their caller, which a tail call drops.
    fn reads_frame_of_caller(&self, call: &E::Call) -> bool {
        let ExprData::EDot(dot) = call.target.data else {
            return false;
        };
        let api = match dot.name.slice() {
            b"toMatchInlineSnapshot" | b"toThrowErrorMatchingInlineSnapshot" => return true,
            b"mock" | b"doMock" | b"unmock" => None,
            b"doUnmock" | b"importActual" | b"importMock" => Some(MockApi::Vi),
            b"dontMock" | b"requireActual" | b"requireMock" | b"createMockFromModule" => {
                Some(MockApi::Jest)
            }
            _ => return false,
        };
        let found = match dot.target.data {
            ExprData::EIdentifier(id) => self.mock_api(id.ref_),
            ExprData::EImportIdentifier(id) => self.mock_api(id.ref_),
            _ => None,
        };
        match (api, found) {
            (_, None) => false,
            (None, Some(_)) => true,
            (Some(MockApi::Vi), Some(found)) => matches!(found, MockApi::Vi),
            (Some(MockApi::Jest), Some(found)) => matches!(found, MockApi::Jest),
        }
    }

    fn ends_in_call_that_reads_frame_of_caller(&self, value: &Expr) -> bool {
        match &value.data {
            ExprData::ECall(call) => self.reads_frame_of_caller(call),
            ExprData::EIf(either) => {
                self.ends_in_call_that_reads_frame_of_caller(&either.yes)
                    || self.ends_in_call_that_reads_frame_of_caller(&either.no)
            }
            ExprData::EBinary(binary) => {
                matches!(
                    binary.op,
                    js_ast::OpCode::BinComma
                        | js_ast::OpCode::BinLogicalAnd
                        | js_ast::OpCode::BinLogicalOr
                        | js_ast::OpCode::BinNullishCoalescing
                ) && self.ends_in_call_that_reads_frame_of_caller(&binary.right)
            }
            _ => false,
        }
    }

    /// Whether `value` has to stay out of a `return`, where its last call would be a tail call.
    pub(crate) fn keeps_frame_for_call(&mut self, value: &Expr) -> bool {
        let keeps = self.options.features.inject_jest_globals
            && self.ends_in_call_that_reads_frame_of_caller(value);
        self.did_apply_test_feature |= keeps;
        keeps
    }

    /// Splits `return vi.importActual("./a")` into `const value = vi.importActual("./a"); return value`. Returns the first statement.
    pub(crate) fn keep_frame_for_returned_call(&mut self, returned: &mut Expr) -> Option<Stmt> {
        if self.is_control_flow_dead || !self.keeps_frame_for_call(returned) {
            return None;
        }
        let loc = returned.loc;
        let r#ref = self.generate_temp_ref(None);
        let binding = self.b(B::Identifier { r#ref }, loc);
        let value = core::mem::replace(returned, self.new_expr(E::Identifier::init(r#ref), loc));
        self.record_usage(r#ref);
        Some(self.s(
            S::Local {
                kind: S::Kind::KConst,
                decls: G::DeclList::init_one(G::Decl {
                    binding,
                    value: Some(value),
                }),
                ..Default::default()
            },
            loc,
        ))
    }

    /// A function requests the original of a module where its body says `.importActual` or `.requireActual`, or calls
    /// a variable of either name. Decided in the parse pass, so that it doesn't depend on what the visit pass folds,
    /// inlines or drops: `bun test --aot` decides the same from a tree of its own.
    /// Code that plainly never runs doesn't count: see `drop_requests_in_dead_stmt` and `drop_requests_unless`.
    #[cold]
    pub(crate) fn did_parse_member_name(&mut self, name: &[u8], loc: js_ast::Loc) {
        if requests_original(name) {
            self.original_requests
                .push(OriginalRequest { loc, module: None });
        }
    }

    fn find_literal(&self, expr: &Expr) -> Option<Literal<'a>> {
        let arena = self.arena;
        let string = |literal: &E::String| -> Literal<'a> {
            if literal.is_utf8() {
                return Literal::String(literal.data.slice());
            }
            Literal::String(match String::from_utf16(literal.slice16()) {
                Ok(literal) => arena.alloc_slice_copy(literal.as_bytes()),
                Err(_) => b"\0",
            })
        };
        Some(match expr.data {
            ExprData::EString(literal) => string(&literal),
            ExprData::ENumber(literal) => Literal::Number(literal.value()),
            ExprData::EIdentifier(id) => Literal::Variable(self.load_name_from_ref(id.ref_)),
            ExprData::EDot(dot) if dot.optional_chain.is_none() => {
                let ExprData::EIdentifier(object) = dot.target.data else {
                    return None;
                };
                Literal::Member(self.load_name_from_ref(object.ref_), dot.name.slice())
            }
            ExprData::EIndex(index) if index.optional_chain.is_none() => {
                let (ExprData::EIdentifier(object), ExprData::EString(name)) =
                    (index.target.data, index.index.data)
                else {
                    return None;
                };
                let Literal::String(name) = string(&name) else {
                    return None;
                };
                Literal::Member(self.load_name_from_ref(object.ref_), name)
            }
            ExprData::EBinary(sum) if sum.op == js_ast::OpCode::BinAdd => {
                let operands = [
                    self.find_literal(&sum.left)?,
                    self.find_literal(&sum.right)?,
                ];
                Literal::Sum(arena.alloc(operands))
            }
            ExprData::ETemplate(template) if template.tag.is_none() => {
                let E::TemplateContents::Cooked(head) = &template.head else {
                    return None;
                };
                let mut pieces = vec![string(head)];
                for part in template.parts.slice() {
                    let E::TemplateContents::Cooked(tail) = &part.tail else {
                        return None;
                    };
                    pieces.push(self.find_literal(&part.value)?);
                    pieces.push(string(tail));
                }
                Literal::Template(arena.alloc_slice_copy(&pieces))
            }
            _ => return None,
        })
    }

    /// A name has a value if it is a `Constant`. The initializer of a `Constant` is evaluated without a `scope`, so a
    /// name in it has none.
    fn evaluate_literal(
        &self,
        literal: Literal<'a>,
        scope: Option<js_ast::StoreRef<js_ast::Scope>>,
    ) -> Option<LiteralValue> {
        let (variable, enum_member) = match literal {
            Literal::String(value) => return Some(LiteralValue::String(value.to_vec())),
            Literal::Number(value) => return Some(LiteralValue::Number(value)),
            Literal::Sum(&[left, right]) => {
                let left = self.evaluate_literal(left, scope)?;
                let right = self.evaluate_literal(right, scope)?;
                if let (&LiteralValue::Number(left), &LiteralValue::Number(right)) = (&left, &right)
                {
                    return Some(LiteralValue::Number(left + right));
                }
                let mut joined = left.into_string()?;
                joined.extend_from_slice(&right.into_string()?);
                return Some(LiteralValue::String(joined));
            }
            Literal::Template(pieces) => {
                let mut joined = Vec::new();
                for &piece in pieces {
                    joined.extend_from_slice(&self.evaluate_literal(piece, scope)?.into_string()?);
                }
                return Some(LiteralValue::String(joined));
            }
            Literal::Variable(variable) => (variable, None),
            Literal::Member(object, name) => (object, Some(name)),
        };
        let hash = js_ast::Scope::get_member_hash(variable);
        let mut scope = scope;
        let declared = loop {
            let current = scope?;
            if let Some(member) = current.get_member_with_hash(variable, hash) {
                break member.ref_;
            }
            scope = current.parent;
        };
        let constant = (self.constants.iter())
            .find(|it| it.declared == declared && it.enum_member == enum_member)?;
        self.evaluate_literal(constant.value, None)
    }

    #[cold]
    pub(crate) fn did_parse_declarator(
        &mut self,
        kind: js_ast::symbol::Kind,
        binding: &js_ast::Binding,
        value: Option<&Expr>,
    ) {
        if kind == js_ast::symbol::Kind::Constant
            && let js_ast::binding::Data::BIdentifier(id) = binding.data
        {
            self.did_parse_constant(id.r#ref, None, value);
        }
    }

    #[cold]
    pub(crate) fn did_parse_constant(
        &mut self,
        declared: Ref,
        enum_member: Option<&'a [u8]>,
        value: Option<&Expr>,
    ) {
        if let Some(value) = value.and_then(|value| self.find_literal(value)) {
            self.constants.push(Constant {
                declared,
                enum_member,
                value,
            });
        }
    }

    #[cold]
    pub(crate) fn did_parse_call(&mut self, callee: &Expr, args: &[Expr]) {
        let member_loc = match callee.data {
            ExprData::EDot(dot) if requests_original(dot.name.slice()) => Some(dot.name_loc),
            ExprData::EIdentifier(id) if requests_original(self.load_name_from_ref(id.ref_)) => {
                None
            }
            _ => return,
        };
        let module = args.first().and_then(|arg| self.find_literal(arg));
        let module = module.map(|module| (module, self.current_scope));
        let Some(member_loc) = member_loc else {
            self.original_requests.push(OriginalRequest {
                loc: callee.loc,
                module,
            });
            return;
        };
        let member = self
            .original_requests
            .iter_mut()
            .rfind(|request| request.loc == member_loc);
        if let Some(member) = member {
            member.module = module;
        }
    }

    /// `stmt` holds the requests from `first_request` on, and follows `before` in a list of statements. It never runs
    /// if TypeScript erases it, or if it comes after a `return`, `throw`, `break` or `continue`, unless it is a
    /// function declaration, which is hoisted.
    #[cold]
    pub(crate) fn drop_requests_in_dead_stmt(
        &mut self,
        stmt: &Stmt,
        before: &[Stmt],
        first_request: usize,
    ) {
        let is_dead = match stmt.data {
            StmtData::STypeScript(_) => true,
            StmtData::SFunction(_) => false,
            _ => before.iter().any(|earlier| {
                matches!(
                    earlier.data,
                    StmtData::SReturn(_)
                        | StmtData::SThrow(_)
                        | StmtData::SBreak(_)
                        | StmtData::SContinue(_)
                )
            }),
        };
        if is_dead {
            self.original_requests.truncate(first_request);
        }
    }

    /// The requests from `first_request` on are in code that runs only if `test` is `runs_if`. Drops them if `test`
    /// is written with literals that say otherwise.
    #[inline]
    pub(crate) fn drop_requests_unless(
        &mut self,
        test: &Expr,
        runs_if: bool,
        first_request: usize,
    ) {
        if self.original_requests.len() > first_request
            && find_literal_truth(test) == Some(!runs_if)
        {
            self.original_requests.truncate(first_request);
        }
    }

    #[inline]
    pub(crate) fn is_always_true(&self, test: &Expr) -> bool {
        self.may_request_originals && find_literal_truth(test) == Some(true)
    }

    /// `first_request` is the length of `original_requests` where the body started.
    #[inline]
    pub(crate) fn did_parse_fn_body(&mut self, body_loc: js_ast::Loc, first_request: usize) {
        if self.original_requests.len() > first_request {
            self.add_requested_originals(body_loc, first_request);
        }
    }

    #[cold]
    fn add_requested_originals(&mut self, body_loc: js_ast::Loc, first_request: usize) {
        let requests = &self.original_requests[first_request..];
        let requests = self.arena.alloc_slice_copy(requests);
        self.requested_originals
            .push(FunctionRequests { body_loc, requests });
    }

    /// Looks names up in the parser's scopes, so `to_ast` calls it before it moves the module scope out.
    pub(crate) fn take_requested_originals(
        &mut self,
    ) -> js_ast::StoreSlice<js_ast::RequestedOriginals> {
        let mut functions = BumpVec::new_in(self.arena);
        for function in &self.requested_originals {
            let mut names = BumpVec::new_in(self.arena);
            let mut may_be_any_module = false;
            for request in function.requests {
                let module = request.module;
                match module.and_then(|(name, scope)| self.evaluate_literal(name, Some(scope))) {
                    // Any other is a name that no module has.
                    Some(LiteralValue::String(name)) => {
                        if !name.is_empty() && name.iter().all(|byte| *byte >= b' ') {
                            let name: &'a [u8] = self.arena.alloc_slice_copy(&name);
                            names.push(js_ast::StoreStr::new(name));
                        }
                    }
                    _ => may_be_any_module = true,
                }
            }
            if may_be_any_module {
                names.clear();
            } else if names.is_empty() {
                continue;
            }
            functions.push(js_ast::RequestedOriginals {
                body_loc: function.body_loc,
                printed_at: js_ast::RequestedOriginals::NOT_PRINTED.into(),
                names: js_ast::StoreSlice::new_mut(names.into_bump_slice_mut()),
            });
        }
        let functions = functions.into_bump_slice_mut();
        functions.sort_unstable_by_key(|function| function.body_loc.start);
        js_ast::StoreSlice::new_mut(functions)
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
