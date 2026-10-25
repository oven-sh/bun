use super::main_module::find_main_module_comparison;
use super::*;
use crate::atom::{Atom, Interner, known};
use crate::bind::{BindOptions, Bound, RuntimeBindOptions, bind};
use crate::file_analysis::{FileInputs, analyze_file};
use crate::fold::{FoldError, FoldErrorKind, FoldInputs, FoldOptions};
use crate::hir::{
    BinOp, Call, Chain, ExprId, ExprKind, File, FileBuilder, Flags, FnBody, FnKind, Func, Import,
    ListAt, NameKind, NodeData, Param, ParamId, PatKind, Prop, PropKey, PropKind, ResolutionMode,
    Span, StmtId, StmtKind, TextRange, TypeNodeId, rare,
};
use crate::import_sites::JsxMode;
use crate::session::Session;

const MAX_STRING_BYTES: usize = 1 << 16;

const DEFAULT_INPUTS: FileInputs<'static> = FileInputs {
    declared_module_type: DeclaredModuleType::Unknown,
    import_meta_main: None,
    is_library: false,
    host_values: &[],
    jsx: JsxMode::Classic,
};

struct Summary {
    format: ModuleFormat,
    site_count: usize,
    errors: Vec<FoldError>,
}

struct Comparison {
    comparison: ExprId,
    module: ExprId,
}

#[derive(Copy, Clone, Debug)]
enum Evidence {
    Module,
    Exports,
    ExportAssignment,
    With,
}

fn runtime_bind_options() -> BindOptions {
    BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    }
}

fn module_file() -> FileBuilder {
    FileBuilder {
        has_module_syntax: true,
        ..Default::default()
    }
}

fn file_with_await_bit() -> FileBuilder {
    FileBuilder {
        rare_syntax: rare::TOP_LEVEL_AWAIT,
        ..Default::default()
    }
}

fn with_file<R>(mut file: FileBuilder, body: &[StmtId], check: impl FnOnce(&File<'_>) -> R) -> R {
    let session = Session::new();
    file.body = file.list(body);
    let (hir, _) = file.into_arena(session.arena(), &session);
    check(&hir)
}

fn with_bound<R>(
    mut file: FileBuilder,
    body: &[StmtId],
    check: impl FnOnce(&File<'_>, &Bound<'_>) -> R,
) -> R {
    let session = Session::new();
    let arena = session.arena();
    let atoms = Interner::new_in(&session);
    file.body = file.list(body);
    let (mut hir, _) = file.into_arena(arena, &session);
    hir.finish_nodes();
    let bound = bind(&hir, runtime_bind_options(), &atoms, arena);
    check(&hir, &bound)
}

fn analyze(file: FileBuilder, body: &[StmtId]) -> Summary {
    analyze_with_inputs(file, body, DEFAULT_INPUTS)
}

fn analyze_with_inputs(
    mut file: FileBuilder,
    body: &[StmtId],
    file_inputs: FileInputs<'static>,
) -> Summary {
    let session = Session::new();
    let arena = session.arena();
    let atoms = Interner::new_in(&session);
    file.body = file.list(body);
    let (mut hir, _) = file.into_arena(arena, &session);
    hir.finish_nodes();
    let options = runtime_bind_options();
    let fold_options = FoldOptions {
        max_string_bytes: MAX_STRING_BYTES,
        ..FoldOptions::default()
    };
    let inputs = FoldInputs::new(fold_options, arena);
    let (_, analysis) = analyze_file(&mut hir, options, &inputs, file_inputs, &atoms, arena);
    Summary {
        format: analysis.module_format,
        site_count: analysis.import_sites.len(),
        errors: analysis.errors.to_vec(),
    }
}

fn add_macro_attributes(file: &mut FileBuilder) -> ExprId {
    let import_type = Prop {
        kind: PropKind::Init,
        key: PropKey::Name(known::r#type),
        name_kind: NameKind::Identifier,
        value: file.expr(ExprKind::String(known::r#macro), 0, 0),
        pos: 0,
        start: 0,
        end: 0,
        postfix_token: 0,
    };
    let props = file.add_props(&[import_type]);
    let attributes = file.expr(ExprKind::Object(props), 0, 0);
    file.import_attributes.push((0, attributes));
    attributes
}

fn add_import(file: &mut FileBuilder, spec: Atom, type_only: bool, attributes: ExprId) -> StmtId {
    let import = file.add_import(Import {
        spec,
        default: known::value,
        default_pos: 0,
        namespace: Atom::NONE,
        namespace_pos: 0,
        clause_start: 0,
        clause_end: 0,
        namespace_start: 0,
        named: Span::EMPTY,
        has_named_imports: false,
        type_only,
        is_deferred: false,
        mode: ResolutionMode::default(),
        stmt: StmtId::NONE,
        attributes,
    });
    file.stmt(StmtKind::Import(import), 0)
}

fn add_member(file: &mut FileBuilder, object: Atom, name: Atom) -> ExprId {
    let obj = file.expr(ExprKind::Ident(object), 0, 0);
    let member = file.dot((obj, Chain::No), (name, 0), 0);
    file.expr(member, 0, 0)
}

fn add_call(file: &mut FileBuilder, callee: ExprId) -> StmtId {
    let specifier = file.expr(ExprKind::String(known::module), 0, 0);
    let call = Call {
        callee,
        args: file.list(&[specifier]),
        type_args: ListAt::EMPTY,
        close_pos: 0,
        chain: Chain::No,
        is_pure: false,
    };
    let call = file.add_call(call);
    let call = file.expr(ExprKind::Call(call), 0, 0);
    file.stmt(StmtKind::Expr(call), 0)
}

fn add_require_call(file: &mut FileBuilder) -> StmtId {
    let callee = file.expr(ExprKind::Ident(known::require), 0, 0);
    add_call(file, callee)
}

fn add_identifier_statement(file: &mut FileBuilder, name: Atom) -> StmtId {
    let identifier = file.expr(ExprKind::Ident(name), 0, 0);
    file.stmt(StmtKind::Expr(identifier), 0)
}

fn add_export_assignment(file: &mut FileBuilder) -> StmtId {
    let value = file.expr(ExprKind::Null, 0, 0);
    file.stmt(StmtKind::ExportAssign(value), 0)
}

fn add_with_statement(file: &mut FileBuilder) -> StmtId {
    let object = file.expr(ExprKind::Null, 0, 0);
    let body = file.stmt(StmtKind::Empty, 0);
    file.stmt(StmtKind::With { object, body }, 0)
}

fn add_await_statement(file: &mut FileBuilder) -> StmtId {
    let operand = file.expr(ExprKind::Null, 0, 0);
    let awaited = file.expr(ExprKind::Await(operand), 0, 0);
    file.stmt(StmtKind::Expr(awaited), 0)
}

fn add_evidence(file: &mut FileBuilder, evidence: Evidence) -> StmtId {
    match evidence {
        Evidence::Module => add_identifier_statement(file, known::module),
        Evidence::Exports => add_identifier_statement(file, known::exports),
        Evidence::ExportAssignment => add_export_assignment(file),
        Evidence::With => add_with_statement(file),
    }
}

fn add_dead_statement(file: &mut FileBuilder, add: fn(&mut FileBuilder) -> StmtId) -> StmtId {
    let test = file.expr(ExprKind::False, 0, 0);
    let yes = add(file);
    let no = StmtId::NONE;
    file.stmt(StmtKind::If { test, yes, no }, 0)
}

fn add_comparison(
    file: &mut FileBuilder,
    require_member: Atom,
    op: BinOp,
    is_module_first: bool,
) -> Comparison {
    let member = add_member(file, known::require, require_member);
    let module = file.expr(ExprKind::Ident(known::module), 0, 0);
    let asserted_module = file.expr(ExprKind::NonNull(module), 0, 0);
    let (left, right) = if is_module_first {
        (asserted_module, member)
    } else {
        (member, asserted_module)
    };
    let comparison = file.expr(ExprKind::Binary { op, left, right }, 0, 0);
    Comparison { comparison, module }
}

fn add_main_module_comparison(file: &mut FileBuilder) -> StmtId {
    let comparison = add_comparison(file, known::main, BinOp::EqEqEq, false).comparison;
    file.stmt(StmtKind::Expr(comparison), 0)
}

fn add_function(file: &mut FileBuilder, parameter: Atom, body: &[StmtId]) -> StmtId {
    let pat = file.pat(PatKind::Ident(parameter), 0, 0);
    let params = file.add_params(&[Param {
        pat,
        ty: TypeNodeId::NONE,
        default: ExprId::NONE,
        flags: Flags::empty(),
        pos: 0,
        loc: TextRange::default(),
    }]);
    let function = Func {
        kind: FnKind::Decl,
        flags: Flags::empty(),
        name: known::main,
        name_pos: 0,
        type_params: Span::EMPTY,
        params,
        this_param: ParamId::NONE,
        ret: TypeNodeId::NONE,
        body: FnBody::Block(file.list(body)),
        anchor: 0,
        start: 0,
        text_start: 0,
        is_strict: false,
        is_strict_by_syntax: false,
    };
    let function = file.add_fn(function);
    file.stmt(StmtKind::Fn(function), 0)
}

#[test]
fn only_runtime_imports_outweigh_require() {
    let cases = [
        (known::module, false, false, ModuleFormat::Esm),
        (known::module, true, false, ModuleFormat::CommonJs),
        (known::bun_bundle, false, false, ModuleFormat::CommonJs),
        (known::module, false, true, ModuleFormat::CommonJs),
        (Atom::NONE, false, false, ModuleFormat::CommonJs),
    ];
    for (spec, type_only, is_macro, format) in cases {
        let mut file = module_file();
        let attributes = match is_macro {
            true => add_macro_attributes(&mut file),
            false => ExprId::NONE,
        };
        let body = [
            add_import(&mut file, spec, type_only, attributes),
            add_require_call(&mut file),
        ];
        let case = (spec, type_only, is_macro);
        assert_eq!(analyze(file, &body).format, format, "{case:?}");
    }
}

#[test]
fn esm_syntax() {
    let syntax = with_file(FileBuilder::default(), &[], file_esm_syntax);
    assert_eq!(syntax, EsmSyntax::None);

    let mut file = FileBuilder::default();
    let body = [add_import(&mut file, known::module, true, ExprId::NONE)];
    let syntax = with_file(file, &body, file_esm_syntax);
    assert_eq!(syntax, EsmSyntax::ImportOrImportMeta);

    let mut file = FileBuilder::default();
    let import_meta = file.expr(ExprKind::ImportMeta, 0, 0);
    let body = [file.stmt(StmtKind::Expr(import_meta), 0)];
    let syntax = with_file(file, &body, file_esm_syntax);
    assert_eq!(syntax, EsmSyntax::ImportOrImportMeta);

    let mut file = FileBuilder::default();
    let value = file.expr(ExprKind::Null, 0, 0);
    let body = [
        add_import(&mut file, known::module, false, ExprId::NONE),
        file.stmt(StmtKind::ExportDefault(value), 0),
    ];
    let syntax = with_file(file, &body, file_esm_syntax);
    assert_eq!(syntax, EsmSyntax::ExportOrTopLevelAwait);
}

#[test]
fn top_level_await_syntax_needs_await_node() {
    let mut file = file_with_await_bit();
    let body = [add_await_statement(&mut file)];
    let syntax = with_file(file, &body, file_esm_syntax);
    assert_eq!(syntax, EsmSyntax::ExportOrTopLevelAwait);

    let syntax = with_file(file_with_await_bit(), &[], file_esm_syntax);
    assert_eq!(syntax, EsmSyntax::None);
}

#[test]
fn statement_syntax_by_kind() {
    let mut file = FileBuilder::default();
    let value = file.expr(ExprKind::Null, 0, 0);
    let cases = [
        (
            add_import(&mut file, known::module, false, ExprId::NONE),
            EsmSyntax::ImportOrImportMeta,
        ),
        (
            file.stmt(StmtKind::ExportDefault(value), 0),
            EsmSyntax::ExportOrTopLevelAwait,
        ),
        (
            file.stmt(StmtKind::ExportAsNamespace(known::value), 0),
            EsmSyntax::ExportOrTopLevelAwait,
        ),
        (add_export_assignment(&mut file), EsmSyntax::None),
        (add_require_call(&mut file), EsmSyntax::None),
    ];
    let body = cases.map(|case| case.0);
    with_file(file, &body, |hir| {
        for (statement, syntax) in cases {
            assert_eq!(
                statement_esm_syntax(hir, statement),
                syntax,
                "{statement:?}"
            );
        }
    });
}

#[test]
fn export_assignment_evidence() {
    let cases = [(false, ModuleFormat::CommonJs), (true, ModuleFormat::Esm)];
    for (is_nested, format) in cases {
        let mut file = module_file();
        let mut statement = add_export_assignment(&mut file);
        if is_nested {
            let statements = file.list(&[statement]);
            statement = file.stmt(StmtKind::Block(statements), 0);
        }
        let found = analyze(file, &[statement]).format;
        assert_eq!(found, format, "nested: {is_nested}");
    }
}

#[test]
fn use_strict_directive_is_weak_evidence() {
    let cases = [
        (
            known::use_strict,
            DeclaredModuleType::Unknown,
            ModuleFormat::CommonJs,
        ),
        (
            known::use_strict,
            DeclaredModuleType::Esm,
            ModuleFormat::Esm,
        ),
        (
            known::module,
            DeclaredModuleType::Unknown,
            ModuleFormat::Esm,
        ),
    ];
    for (raw, declared_module_type, format) in cases {
        let mut file = FileBuilder::default();
        let expr = file.expr(ExprKind::String(raw), 0, 0);
        let body = [file.stmt(StmtKind::Directive { expr, raw }, 0)];
        let inputs = FileInputs {
            declared_module_type,
            ..DEFAULT_INPUTS
        };
        let found = analyze_with_inputs(file, &body, inputs).format;
        assert_eq!(found, format, "{raw:?}, {declared_module_type:?}");
    }
}

#[test]
fn unused_import_selects_esm() {
    let mut file = FileBuilder::default();
    let body = [add_require_call(&mut file)];
    let summary = analyze(file, &body);
    assert_eq!(summary.format, ModuleFormat::CommonJs);
    assert_eq!(summary.site_count, 1);

    let mut file = module_file();
    let body = [
        add_import(&mut file, known::module, false, ExprId::NONE),
        add_require_call(&mut file),
    ];
    let summary = analyze(file, &body);
    assert_eq!(summary.format, ModuleFormat::Esm);
    assert_eq!(summary.site_count, 1);
}

#[test]
fn commonjs_with_unused_import_has_no_error() {
    let mut file = module_file();
    let body = [
        add_import(&mut file, known::module, false, ExprId::NONE),
        add_identifier_statement(&mut file, known::module),
    ];
    let summary = analyze(file, &body);
    assert_eq!(summary.format, ModuleFormat::CommonJs);
    assert_eq!(summary.site_count, 0);
    assert!(summary.errors.is_empty(), "{:?}", summary.errors);
}

#[test]
fn import_statement_in_commonjs_names_evidence() {
    let cases: [(&[Evidence], CommonJsEvidence); 5] = [
        (&[Evidence::Module], CommonJsEvidence::MODULE),
        (&[Evidence::Exports], CommonJsEvidence::EXPORTS),
        (&[Evidence::ExportAssignment], CommonJsEvidence::MODULE),
        (&[Evidence::With], CommonJsEvidence::WITH_STATEMENT),
        (
            &[Evidence::Module, Evidence::Exports, Evidence::With],
            CommonJsEvidence::all(),
        ),
    ];
    for (statements, evidence) in cases {
        let mut file = FileBuilder {
            is_js: true,
            has_module_syntax: true,
            ..Default::default()
        };
        let import = add_import(&mut file, known::module, false, ExprId::NONE);
        let mut body = vec![import];
        for &statement in statements {
            body.push(add_evidence(&mut file, statement));
        }
        let summary = analyze(file, &body);
        let expected = FoldError {
            kind: FoldErrorKind::ImportStatementInCommonJs(evidence),
            node: NodeData::Stmt(import),
        };
        assert_eq!(summary.format, ModuleFormat::CommonJs, "{statements:?}");
        assert_eq!(summary.site_count, 1, "{statements:?}");
        assert_eq!(summary.errors, [expected], "{statements:?}");
    }
}

#[test]
fn dead_module_use_is_no_evidence() {
    let add_module_use: fn(&mut FileBuilder) -> StmtId =
        |file| add_identifier_statement(file, known::module);
    let mut file = FileBuilder::default();
    let body = [add_module_use(&mut file)];
    assert_eq!(analyze(file, &body).format, ModuleFormat::CommonJs);

    let mut file = FileBuilder::default();
    let body = [add_dead_statement(&mut file, add_module_use)];
    assert_eq!(analyze(file, &body).format, ModuleFormat::Esm);
}

#[test]
fn dead_with_statement_selects_commonjs() {
    let mut file = FileBuilder::default();
    let body = [add_dead_statement(&mut file, add_with_statement)];
    assert_eq!(analyze(file, &body).format, ModuleFormat::CommonJs);
}

#[test]
fn unreached_with_statement_is_no_evidence() {
    let mut file = FileBuilder::default();
    add_with_statement(&mut file);
    assert_eq!(analyze(file, &[]).format, ModuleFormat::Esm);
}

#[test]
fn top_level_await_outweighs_commonjs_evidence() {
    let cases = [(true, ModuleFormat::Esm), (false, ModuleFormat::CommonJs)];
    for (has_await, format) in cases {
        let mut file = file_with_await_bit();
        let mut body = vec![add_identifier_statement(&mut file, known::module)];
        if has_await {
            body.push(add_await_statement(&mut file));
        }
        let summary = analyze(file, &body);
        assert_eq!(summary.format, format, "await: {has_await}");
        assert!(summary.errors.is_empty(), "{:?}", summary.errors);
    }
}

#[test]
fn top_level_return_is_no_evidence() {
    let mut file = FileBuilder::default();
    let body = [file.stmt(StmtKind::Return(ExprId::NONE), 0)];
    assert_eq!(analyze(file, &body).format, ModuleFormat::Esm);
}

#[test]
fn module_require_is_no_evidence() {
    let mut file = FileBuilder::default();
    let callee = add_member(&mut file, known::module, known::require);
    let body = [add_call(&mut file, callee)];
    let summary = analyze(file, &body);
    assert_eq!(summary.format, ModuleFormat::Esm);
    assert_eq!(summary.site_count, 1);

    let mut file = FileBuilder::default();
    let callee = add_member(&mut file, known::module, known::require);
    let body = [
        add_call(&mut file, callee),
        add_identifier_statement(&mut file, known::module),
    ];
    assert_eq!(analyze(file, &body).format, ModuleFormat::CommonJs);
}

#[test]
fn main_module_comparison_is_weak_evidence() {
    let cases = [
        (DeclaredModuleType::Unknown, false, ModuleFormat::CommonJs),
        (DeclaredModuleType::Unknown, true, ModuleFormat::Esm),
        (DeclaredModuleType::Esm, false, ModuleFormat::Esm),
    ];
    for (declared_module_type, is_dead, format) in cases {
        for import_meta_main in [None, Some(true), Some(false)] {
            let mut file = FileBuilder::default();
            let body = [match is_dead {
                true => add_dead_statement(&mut file, add_main_module_comparison),
                false => add_main_module_comparison(&mut file),
            }];
            let inputs = FileInputs {
                declared_module_type,
                import_meta_main,
                ..DEFAULT_INPUTS
            };
            let found = analyze_with_inputs(file, &body, inputs).format;
            let case = (declared_module_type, is_dead, import_meta_main);
            assert_eq!(found, format, "{case:?}");
        }
    }
}

#[test]
fn other_comparison_with_module_selects_commonjs() {
    let mut file = FileBuilder::default();
    let comparison = add_comparison(&mut file, known::resolve, BinOp::EqEqEq, false).comparison;
    let body = [file.stmt(StmtKind::Expr(comparison), 0)];
    let inputs = FileInputs {
        declared_module_type: DeclaredModuleType::Esm,
        import_meta_main: Some(true),
        ..DEFAULT_INPUTS
    };
    let summary = analyze_with_inputs(file, &body, inputs);
    assert_eq!(summary.format, ModuleFormat::CommonJs);
}

#[test]
fn main_module_operand_accepts_equalities_in_either_order() {
    for op in [BinOp::EqEq, BinOp::EqEqEq, BinOp::NotEq, BinOp::NotEqEq] {
        for is_module_first in [false, true] {
            let mut file = FileBuilder::default();
            let added = add_comparison(&mut file, known::main, op, is_module_first);
            let Comparison { comparison, module } = added;
            let body = [file.stmt(StmtKind::Expr(comparison), 0)];
            with_bound(file, &body, |hir, bound| {
                let case = (op, is_module_first);
                let operand = main_module_operand(hir, bound, comparison);
                assert_eq!(operand, Some(module), "{case:?}");
                let found = find_main_module_comparison(hir, bound, module);
                assert_eq!(found, Some(comparison), "{case:?}");
            });
        }
    }
}

#[test]
fn other_comparisons_have_no_main_module_operand() {
    let cases = [
        (known::main, BinOp::Lt),
        (known::main, BinOp::Add),
        (known::resolve, BinOp::EqEqEq),
    ];
    for (require_member, op) in cases {
        let mut file = FileBuilder::default();
        let added = add_comparison(&mut file, require_member, op, false);
        let Comparison { comparison, module } = added;
        let body = [file.stmt(StmtKind::Expr(comparison), 0)];
        with_bound(file, &body, |hir, bound| {
            let case = (require_member, op);
            assert_eq!(
                main_module_operand(hir, bound, comparison),
                None,
                "{case:?}"
            );
            assert_eq!(
                find_main_module_comparison(hir, bound, module),
                None,
                "{case:?}"
            );
        });
    }
}

#[test]
fn shadowed_variable_is_no_main_module_operand() {
    let cases = [
        (known::module, false),
        (known::require, false),
        (known::value, true),
    ];
    for (parameter, is_main_module) in cases {
        let mut file = FileBuilder::default();
        let added = add_comparison(&mut file, known::main, BinOp::EqEqEq, false);
        let Comparison { comparison, module } = added;
        let statement = file.stmt(StmtKind::Expr(comparison), 0);
        let body = [add_function(&mut file, parameter, &[statement])];
        with_bound(file, &body, |hir, bound| {
            let expected = is_main_module.then_some(module);
            let operand = main_module_operand(hir, bound, comparison);
            assert_eq!(operand, expected, "{parameter:?}");
        });
    }
}
