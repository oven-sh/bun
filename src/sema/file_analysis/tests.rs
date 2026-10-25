use super::*;
use crate::atom::{Atom, known};
use crate::bind::RuntimeBindOptions;
use crate::fold::{Constant, Decision, FoldErrorKind, FoldOptions, FoldedValue};
use crate::hir::{
    BinOp, Call, Chain, ExportId, ExprKind, FileBuilder, Flags, FnBody, FnKind, Func, Import,
    ImportId, ImportSpec, ImportSpecId, ListAt, NameKind, NodeData, ParamId, PatKind, Prop,
    PropKey, PropKind, ResolutionMode, Span, StmtId, StmtKind, TextRange, TypeNodeId, VarDecl,
    VarKind, rare,
};
use crate::hir_from_data::DataValue;
use crate::import_sites::ImportSpecifier;
use crate::module_format::CommonJsEvidence;
use crate::session::Session;

const MAX_STRING_BYTES: usize = 1 << 16;

const FILE_INPUTS: FileInputs<'static> = FileInputs {
    declared_module_type: DeclaredModuleType::Unknown,
    import_meta_main: None,
    is_library: false,
    host_values: &[],
    jsx: JsxMode::Classic,
};

struct Workspace<'s> {
    session: &'s Session,
    atoms: Interner<'s>,
    arena: &'s Arena,
}

struct Analyzed<'s> {
    hir: File<'s>,
    bound: Bound<'s>,
    analysis: FileAnalysis<'s>,
}

fn runtime_bind_options() -> BindOptions {
    BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    }
}

impl<'s> Workspace<'s> {
    fn new(session: &'s Session) -> Workspace<'s> {
        Workspace {
            session,
            atoms: Interner::new_in(session),
            arena: session.arena(),
        }
    }

    fn fold_inputs(&self, max_string_bytes: usize) -> FoldInputs<'s> {
        let options = FoldOptions {
            max_string_bytes,
            ..FoldOptions::default()
        };
        FoldInputs::new(options, self.arena)
    }

    fn finish_tree(&self, mut file: FileBuilder, body: &[StmtId]) -> File<'s> {
        file.body = file.list(body);
        let (mut hir, _) = file.into_arena(self.arena, self.session);
        hir.finish_nodes();
        hir
    }

    fn analyze_tree(
        &self,
        mut hir: File<'s>,
        fold: &FoldInputs<'s>,
        file: FileInputs<'s>,
    ) -> Analyzed<'s> {
        let (options, atoms) = (runtime_bind_options(), &self.atoms);
        let (bound, analysis) = analyze_file(&mut hir, options, fold, file, atoms, self.arena);
        assert!(!bound.ran_out_of_stack);
        Analyzed {
            hir,
            bound,
            analysis,
        }
    }

    fn analyze(&self, file: FileBuilder, body: &[StmtId]) -> Analyzed<'s> {
        self.analyze_with(file, body, FILE_INPUTS)
    }

    fn analyze_with(
        &self,
        file: FileBuilder,
        body: &[StmtId],
        inputs: FileInputs<'s>,
    ) -> Analyzed<'s> {
        let fold = self.fold_inputs(MAX_STRING_BYTES);
        self.analyze_tree(self.finish_tree(file, body), &fold, inputs)
    }

    fn host_values(&self, values: &[(ExprId, HostValue<'s>)]) -> FileInputs<'s> {
        FileInputs {
            host_values: self.arena.alloc_slice_copy(values),
            ..FILE_INPUTS
        }
    }
}

fn site(kind: ImportSiteKind) -> ImportSite {
    ImportSite {
        kind,
        specifier: ImportSpecifier::Unknown,
        specifier_node: ExprId::NONE,
        attributes: ExprId::NONE,
        consults_resolver: true,
        is_host_value: false,
    }
}

fn add_import(
    file: &mut FileBuilder,
    spec: Atom,
    default: Atom,
    named: Span<ImportSpecId>,
) -> StmtId {
    file.has_module_syntax = true;
    let import = file.add_import(Import {
        spec,
        default,
        default_pos: 0,
        namespace: Atom::NONE,
        namespace_pos: 0,
        clause_start: 0,
        clause_end: 0,
        namespace_start: 0,
        named,
        has_named_imports: !named.is_empty(),
        type_only: false,
        is_deferred: false,
        mode: ResolutionMode::default(),
        stmt: StmtId::NONE,
        attributes: ExprId::NONE,
    });
    file.stmt(StmtKind::Import(import), 0)
}

fn add_default_import(file: &mut FileBuilder) -> StmtId {
    add_import(file, known::module, known::value, Span::EMPTY)
}

fn add_repeated_feature_import(file: &mut FileBuilder) -> StmtId {
    let import = ImportId(file.imports.len() as u32);
    let specifiers = [known::feature, known::meta].map(|local| ImportSpec {
        start: 0,
        imported: known::feature,
        local,
        pos: 0,
        type_only: false,
        imported_pos: 0,
        end: 0,
        import,
    });
    let named = file.add_import_specs(&specifiers);
    add_import(file, known::bun_bundle, Atom::NONE, named)
}

fn add_macro_export_star(file: &mut FileBuilder) -> StmtId {
    file.has_module_syntax = true;
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
    let export_star = StmtKind::ExportStar {
        spec: known::module,
        alias: Atom::NONE,
        type_only: false,
        mode: ResolutionMode::default(),
        star_pos: 0,
        alias_pos: 0,
    };
    let statement = file.stmt(export_star, 0);
    file.export_star_attributes.push((statement, attributes));
    statement
}

fn add_call(file: &mut FileBuilder, callee: Atom, arguments: &[ExprId]) -> ExprId {
    let callee = file.expr(ExprKind::Ident(callee), 0, 0);
    let args = file.list(arguments);
    let call = file.add_call(Call {
        callee,
        args,
        type_args: ListAt::EMPTY,
        close_pos: 0,
        chain: Chain::No,
        is_pure: false,
    });
    file.expr(ExprKind::Call(call), 0, 0)
}

fn add_sum(file: &mut FileBuilder, left: Atom, right: Atom) -> ExprId {
    let left = file.expr(ExprKind::String(left), 0, 0);
    let right = file.expr(ExprKind::String(right), 0, 0);
    let op = BinOp::Add;
    file.expr(ExprKind::Binary { op, left, right }, 0, 0)
}

fn add_constant(file: &mut FileBuilder, name: Atom, init: ExprId) -> StmtId {
    let pat = file.pat(PatKind::Ident(name), 0, 0);
    let declarations = file.add_var_decls(&[VarDecl {
        pat,
        ty: TypeNodeId::NONE,
        init,
        kind: VarKind::Const,
        flags: Flags::empty(),
        loc: TextRange::default(),
    }]);
    file.stmt(StmtKind::Var(declarations), 0)
}

fn add_await_statement(file: &mut FileBuilder) -> StmtId {
    let operand = file.expr(ExprKind::Null, 0, 0);
    let awaited = file.expr(ExprKind::Await(operand), 0, 0);
    file.stmt(StmtKind::Expr(awaited), 0)
}

fn add_async_arrow_function(file: &mut FileBuilder, body: &[StmtId]) -> StmtId {
    let body = FnBody::Block(file.list(body));
    let function = file.add_fn(Func {
        kind: FnKind::Arrow,
        flags: Flags::ASYNC,
        name: Atom::NONE,
        name_pos: 0,
        type_params: Span::EMPTY,
        params: Span::EMPTY,
        this_param: ParamId::NONE,
        ret: TypeNodeId::NONE,
        body,
        anchor: 0,
        start: 0,
        text_start: 0,
        is_strict: false,
        is_strict_by_syntax: false,
    });
    let function = file.expr(ExprKind::Fn(function), 0, 0);
    file.stmt(StmtKind::Expr(function), 0)
}

fn number(value: f64) -> Constant {
    Constant::Number(value)
}

#[test]
fn import_site_lookups() {
    let kinds = [
        ImportSiteKind::JsxRuntime,
        ImportSiteKind::ExportFrom(ExportId(0)),
        ImportSiteKind::Import(ImportId(0)),
        ImportSiteKind::Require(ExprId(2)),
        ImportSiteKind::ImportCall(ExprId(5)),
        ImportSiteKind::RequireResolve(ExprId(9)),
    ];
    let sites = kinds.map(site);
    let analysis = FileAnalysis {
        import_sites: &sites,
        sites_by_kind: &[0, 2, 1, 4, 3, 5],
        first_call_site: 3,
        ..FileAnalysis::default()
    };
    for (index, kind) in kinds.into_iter().enumerate() {
        assert_eq!(analysis.import_site_index(kind), Some(index), "{kind:?}");
        if let Some(call) = kind.call() {
            assert_eq!(analysis.import_site_of_call(call), Some(index), "{kind:?}");
        }
    }
    for absent in [
        ImportSiteKind::Require(ExprId(5)),
        ImportSiteKind::JsxPackage,
    ] {
        assert_eq!(analysis.import_site_index(absent), None, "{absent:?}");
    }
    for call in [ExprId(0), ExprId(6), ExprId(10)] {
        assert_eq!(analysis.import_site_of_call(call), None, "{call:?}");
    }
}

#[test]
fn lookups_without_sites() {
    let analysis = FileAnalysis::default();
    let kind = ImportSiteKind::Import(ImportId(0));
    assert_eq!(analysis.import_site_index(kind), None);
    assert_eq!(analysis.import_site_of_call(ExprId(0)), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn empty_file_format() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let fold = workspace.fold_inputs(MAX_STRING_BYTES);
    let cases = [
        (DeclaredModuleType::Unknown, ModuleFormat::Esm),
        (DeclaredModuleType::CommonJs, ModuleFormat::CommonJs),
        (DeclaredModuleType::Esm, ModuleFormat::Esm),
    ];
    let mut hir = File::empty_in(workspace.arena, &session);
    hir.finish_nodes();
    for (declared_module_type, format) in cases {
        let file = FileInputs {
            declared_module_type,
            ..FILE_INPUTS
        };
        let analyzed = workspace.analyze_tree(hir, &fold, file);
        let analysis = &analyzed.analysis;
        assert_eq!(analysis.module_format, format);
        assert_eq!(
            analyzed.hir.is_strict,
            format == ModuleFormat::Esm,
            "{format:?}"
        );
        assert!(analysis.import_sites.is_empty());
        assert!(analysis.jsx_imports.is_empty());
        assert!(analysis.errors.is_empty());
        assert!(!analysis.has_live_top_level_await);
        assert!(analysis.strings_over_limit.is_empty());
        hir = analyzed.hir;
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn fold_errors_precede_scan_errors() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let mut file = FileBuilder::default();
    let export_star = add_macro_export_star(&mut file);
    let feature_import = add_repeated_feature_import(&mut file);
    let analyzed = workspace.analyze(file, &[export_star, feature_import]);
    let expected = [
        FoldError {
            kind: FoldErrorKind::FeatureImportedTwice,
            node: NodeData::ImportSpec(ImportSpecId(1)),
        },
        FoldError {
            kind: FoldErrorKind::MacroInExportStar,
            node: NodeData::Stmt(export_star),
        },
    ];
    assert_eq!(analyzed.analysis.errors, expected);
}

#[test]
#[cfg_attr(miri, ignore)]
fn fold_errors_precede_format_error() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let mut file = FileBuilder::default();
    let import = add_default_import(&mut file);
    let feature_import = add_repeated_feature_import(&mut file);
    let uses = [known::value, known::module].map(|name| {
        let ident = file.expr(ExprKind::Ident(name), 0, 0);
        file.stmt(StmtKind::Expr(ident), 0)
    });
    let analyzed = workspace.analyze(file, &[import, feature_import, uses[0], uses[1]]);
    let expected = [
        FoldError {
            kind: FoldErrorKind::FeatureImportedTwice,
            node: NodeData::ImportSpec(ImportSpecId(1)),
        },
        FoldError {
            kind: FoldErrorKind::ImportStatementInCommonJs(CommonJsEvidence::MODULE),
            node: NodeData::Stmt(import),
        },
    ];
    assert_eq!(analyzed.analysis.errors, expected);
    assert_eq!(analyzed.analysis.module_format, ModuleFormat::CommonJs);
}

#[test]
#[cfg_attr(miri, ignore)]
fn macro_export_error_reaches_analysis() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let mut file = FileBuilder::default();
    let export_star = add_macro_export_star(&mut file);
    let analyzed = workspace.analyze(file, &[export_star]);
    let expected = FoldError {
        kind: FoldErrorKind::MacroInExportStar,
        node: NodeData::Stmt(export_star),
    };
    assert_eq!(analyzed.analysis.errors, [expected]);
    assert_eq!(analyzed.analysis.module_format, ModuleFormat::Esm);
    assert_eq!(analyzed.analysis.import_sites.len(), 1);
}

#[test]
#[cfg_attr(miri, ignore)]
fn string_over_limit_names_the_sum() {
    for (length, is_over_limit) in [(MAX_STRING_BYTES / 2, false), (MAX_STRING_BYTES, true)] {
        let session = Session::new();
        let workspace = Workspace::new(&session);
        let text = workspace.atoms.intern(&vec![b'a'; length]);
        let mut file = FileBuilder::default();
        let sum = add_sum(&mut file, text, text);
        let statement = file.stmt(StmtKind::Expr(sum), 0);
        let analyzed = workspace.analyze(file, &[statement]);
        let subjects = if is_over_limit { vec![sum] } else { Vec::new() };
        assert_eq!(analyzed.analysis.strings_over_limit, subjects, "{length}");
        let found = analyzed.analysis.decisions.constant(&analyzed.hir, sum);
        assert_eq!(found == FoldedValue::Unknown, is_over_limit, "{length}");
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn second_fold_replaces_limit_subjects() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let text = workspace.atoms.intern(&vec![b'a'; MAX_STRING_BYTES]);
    let mut file = FileBuilder::default();
    let eval = add_call(&mut file, known::eval, &[]);
    let sum = add_sum(&mut file, text, text);
    let body = [eval, sum].map(|e| file.stmt(StmtKind::Expr(e), 0));
    let analyzed = workspace.analyze(file, &body);
    assert!(analyzed.hir.is_strict);
    let eval_scopes = analyzed.bound.runtime.eval_scopes();
    assert_eq!(eval_scopes.len(), 1);
    assert!(!eval_scopes[0].1.is_sloppy);
    assert_eq!(analyzed.analysis.strings_over_limit, [sum]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn default_options_fold_no_computed_string() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let (a, b) = (workspace.atoms.intern(b"a"), workspace.atoms.intern(b"b"));
    let mut file = FileBuilder::default();
    let sum = add_sum(&mut file, a, b);
    let statement = file.stmt(StmtKind::Expr(sum), 0);
    let hir = workspace.finish_tree(file, &[statement]);
    let fold = FoldInputs::new(FoldOptions::default(), workspace.arena);
    let analyzed = workspace.analyze_tree(hir, &fold, FILE_INPUTS);
    let decisions = &analyzed.analysis.decisions;
    assert_eq!(decisions.constant(&analyzed.hir, sum), FoldedValue::Unknown);
    assert_eq!(analyzed.analysis.strings_over_limit, [sum]);
    assert_eq!(workspace.atoms.lookup(b"ab"), None);
}

#[test]
#[cfg_attr(miri, ignore)]
fn host_value_decides_expression() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let text = workspace.atoms.intern(b"text");
    let properties = workspace
        .arena
        .alloc_slice_copy(&[(known::value, DataValue::Null)]);
    let object: &DataValue<'_> = workspace.arena.alloc(DataValue::Object(properties));
    let string: &DataValue<'_> = workspace.arena.alloc(DataValue::String(text));
    let cases = [
        (HostValue::Data(object), Decision::Data(object), true),
        (
            HostValue::Data(string),
            Decision::Constant(Constant::String(text)),
            false,
        ),
        (HostValue::Deferred, Decision::DeferredData, false),
    ];
    for (host_value, expected, is_data_literal) in cases {
        let mut file = FileBuilder::default();
        let argument = file.expr(ExprKind::Ident(known::value), 0, 0);
        let call = add_call(&mut file, known::get, &[argument]);
        let statement = file.stmt(StmtKind::Expr(call), 0);
        let inputs = workspace.host_values(&[(call, host_value)]);
        let analyzed = workspace.analyze_with(file, &[statement], inputs);
        let decisions = &analyzed.analysis.decisions;
        assert_eq!(decisions.decision(call), expected);
        assert_eq!(
            decisions.is_data_literal(call),
            is_data_literal,
            "{expected:?}"
        );
        assert!(!decisions.is_dead_expr(call), "{expected:?}");
        assert!(decisions.is_dead_expr(argument), "{expected:?}");
        let ExprKind::Call(id) = analyzed.hir[call].kind else {
            panic!("{:?} is no call", analyzed.hir[call].kind);
        };
        assert!(
            decisions.is_dead_expr(analyzed.hir[id].callee),
            "{expected:?}"
        );
        let constant = match expected {
            Decision::Constant(constant) => FoldedValue::Constant(constant),
            _ => FoldedValue::Unknown,
        };
        assert_eq!(decisions.constant(&analyzed.hir, call), constant);
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn host_value_of_unreached_expression_is_skipped() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let one: &DataValue<'_> = workspace.arena.alloc(DataValue::Number(1.0));
    let two: &DataValue<'_> = workspace.arena.alloc(DataValue::Number(2.0));
    let mut file = FileBuilder::default();
    let unreached = add_call(&mut file, known::get, &[]);
    let reached = add_call(&mut file, known::get, &[]);
    let statement = file.stmt(StmtKind::Expr(reached), 0);
    let values = [
        (unreached, HostValue::Data(one)),
        (reached, HostValue::Data(two)),
    ];
    let inputs = workspace.host_values(&values);
    let analyzed = workspace.analyze_with(file, &[statement], inputs);
    let decisions = &analyzed.analysis.decisions;
    assert_eq!(decisions.decision(unreached), Decision::Unknown);
    assert_eq!(
        decisions.constant(&analyzed.hir, unreached),
        FoldedValue::Unknown
    );
    assert_eq!(decisions.decision(reached), Decision::Constant(number(2.0)));
}

#[test]
#[cfg_attr(miri, ignore)]
fn library_decides_file_scope_constant_reads() {
    for is_library in [false, true] {
        let session = Session::new();
        let workspace = Workspace::new(&session);
        let mut file = FileBuilder::default();
        let one = file.number(1.0);
        let init = file.expr(ExprKind::Number(one), 0, 0);
        let declaration = add_constant(&mut file, known::value, init);
        let read = file.expr(ExprKind::Ident(known::value), 0, 0);
        let statement = file.stmt(StmtKind::Expr(read), 0);
        let inputs = FileInputs {
            is_library,
            ..FILE_INPUTS
        };
        let analyzed = workspace.analyze_with(file, &[declaration, statement], inputs);
        let decisions = &analyzed.analysis.decisions;
        let (decision, constant) = if is_library {
            let constant = FoldedValue::Constant(number(1.0));
            (Decision::Constant(number(1.0)), constant)
        } else {
            let constant = FoldedValue::ConstantOutsideDeadZone(number(1.0));
            (Decision::Unknown, constant)
        };
        assert_eq!(decisions.decision(read), decision, "{is_library}");
        assert_eq!(
            decisions.constant(&analyzed.hir, read),
            constant,
            "{is_library}"
        );
    }
}

#[test]
#[cfg_attr(miri, ignore)]
fn top_level_await_needs_parser_bit_and_node() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let nothing_dead = Decisions::default();

    let mut file = FileBuilder {
        rare_syntax: rare::TOP_LEVEL_AWAIT,
        ..FileBuilder::default()
    };
    let statement = add_await_statement(&mut file);
    let hir = workspace.finish_tree(file, &[statement]);
    assert!(has_live_top_level_await(&hir, &nothing_dead));

    let mut file = FileBuilder::default();
    let statement = add_await_statement(&mut file);
    let hir = workspace.finish_tree(file, &[statement]);
    assert!(!has_live_top_level_await(&hir, &nothing_dead));

    let mut file = FileBuilder {
        rare_syntax: rare::TOP_LEVEL_AWAIT,
        ..FileBuilder::default()
    };
    let statement = file.stmt(StmtKind::Empty, 0);
    let hir = workspace.finish_tree(file, &[statement]);
    assert!(!has_live_top_level_await(&hir, &nothing_dead));
}

#[test]
#[cfg_attr(miri, ignore)]
fn await_in_function_is_not_top_level() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let mut file = FileBuilder {
        rare_syntax: rare::TOP_LEVEL_AWAIT,
        ..FileBuilder::default()
    };
    let awaited = add_await_statement(&mut file);
    let function = add_async_arrow_function(&mut file, &[awaited]);
    let hir = workspace.finish_tree(file, &[function]);
    assert!(!has_live_top_level_await(&hir, &Decisions::default()));
}

#[test]
#[cfg_attr(miri, ignore)]
fn dead_top_level_await_decides_format_only() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let mut file = FileBuilder {
        rare_syntax: rare::TOP_LEVEL_AWAIT,
        ..FileBuilder::default()
    };
    let test = file.expr(ExprKind::False, 0, 0);
    let yes = add_await_statement(&mut file);
    let no = StmtId::NONE;
    let branch = file.stmt(StmtKind::If { test, yes, no }, 0);
    let inputs = FileInputs {
        declared_module_type: DeclaredModuleType::CommonJs,
        ..FILE_INPUTS
    };
    let analyzed = workspace.analyze_with(file, &[branch], inputs);
    assert!(analyzed.analysis.decisions.is_dead_stmt(yes));
    assert!(!analyzed.analysis.has_live_top_level_await);
    assert!(has_live_top_level_await(
        &analyzed.hir,
        &Decisions::default()
    ));
    assert_eq!(analyzed.analysis.module_format, ModuleFormat::Esm);
}
