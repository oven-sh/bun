use super::*;
use crate::atom::{Atom, Interner, known};
use crate::bind::{BindOptions, RuntimeBindOptions, bind};
use crate::file_analysis::FileInputs;
use crate::fold::{FoldError, FoldErrorKind, FoldInputs, FoldOptions, fold_file};
use crate::hir::{
    Call, Chain, Export, ExportId, ExportSpec, ExprFlags, ExprId, ExprKind, FileBuilder, Flags,
    FnBody, FnKind, Func, IdList, Import, ImportEquals, ImportEqualsTarget, ImportId, Jsx, Keyword,
    ListAt, Module, ModuleName, NameKind, NodeData, Param, ParamId, PatKind, Prop, PropId, PropKey,
    PropKind, ResolutionMode, Span, StmtId, StmtKind, TextRange, TypeNodeId, TypeNodeKind,
};
use crate::module_format::{DeclaredModuleType, ModuleFormat, decide_module_format};
use crate::session::Session;

const MAX_STRING_BYTES: usize = 1 << 16;

const AUTOMATIC_JSX: JsxMode = JsxMode::Automatic(AutomaticJsx {
    runtime_specifier: known::JSX,
    package_specifier: known::React,
    is_development: false,
});

const RUNTIME_SITE: ImportSite = ImportSite {
    kind: ImportSiteKind::JsxRuntime,
    specifier: ImportSpecifier::Constant(known::JSX),
    specifier_node: ExprId::NONE,
    attributes: ExprId::NONE,
    consults_resolver: true,
    is_host_value: false,
};

const PACKAGE_SITE: ImportSite = ImportSite {
    kind: ImportSiteKind::JsxPackage,
    specifier: ImportSpecifier::Constant(known::React),
    specifier_node: ExprId::NONE,
    attributes: ExprId::NONE,
    consults_resolver: true,
    is_host_value: false,
};

fn module_file() -> FileBuilder {
    FileBuilder {
        has_module_syntax: true,
        ..Default::default()
    }
}

fn add_member_of(file: &mut FileBuilder, obj: ExprId, name: Atom) -> ExprId {
    let member = file.dot((obj, Chain::No), (name, 0), 0);
    file.expr(member, 0, 0)
}

fn add_member(file: &mut FileBuilder, object: Atom, name: Atom) -> (ExprId, ExprId) {
    let obj = file.expr(ExprKind::Ident(object), 0, 0);
    (obj, add_member_of(file, obj, name))
}

fn add_call_in_chain(
    file: &mut FileBuilder,
    callee: ExprId,
    argument: ExprId,
    chain: Chain,
) -> ExprId {
    let call = Call {
        callee,
        args: file.list(&[argument]),
        type_args: ListAt::EMPTY,
        close_pos: 0,
        chain,
        is_pure: false,
    };
    let call = file.add_call(call);
    let call = file.expr(ExprKind::Call(call), 0, 0);
    if chain == Chain::Start {
        file.add_flags(call, ExprFlags::OPTIONAL_CHAIN_LINK);
    }
    call
}

fn add_call(file: &mut FileBuilder, callee: ExprId, argument: ExprId) -> ExprId {
    add_call_in_chain(file, callee, argument, Chain::No)
}

fn add_process(file: &mut FileBuilder) -> ExprId {
    file.expr(ExprKind::Ident(known::process), 0, 0)
}

fn add_process_of_global_this(file: &mut FileBuilder) -> ExprId {
    add_member(file, known::globalThis, known::process).1
}

fn add_process_of_global(file: &mut FileBuilder) -> ExprId {
    add_member(file, known::global, known::process).1
}

fn add_process_of_global_this_assertion(file: &mut FileBuilder) -> ExprId {
    let expr = file.expr(ExprKind::Ident(known::globalThis), 0, 0);
    let ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), 0, 0);
    let assertion = file.expr(ExprKind::As { expr, ty }, 0, 0);
    file.add_flags(assertion, ExprFlags::PARENTHESIZED);
    file.parens.push((assertion, 0, 0));
    add_member_of(file, assertion, known::process)
}

fn add_parenthesized_process_assertion(file: &mut FileBuilder) -> ExprId {
    let expr = add_process(file);
    let ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), 0, 0);
    let assertion = file.expr(ExprKind::As { expr, ty }, 0, 0);
    file.add_flags(assertion, ExprFlags::PARENTHESIZED);
    file.parens.push((assertion, 0, 0));
    assertion
}

fn add_builtin_module_call(file: &mut FileBuilder, object: Atom) -> ExprId {
    let (_, callee) = add_member(file, object, known::getBuiltinModule);
    let specifier = file.expr(ExprKind::String(known::module), 0, 0);
    add_call(file, callee, specifier)
}

fn add_import_meta_call(file: &mut FileBuilder, member: Atom, argument: ExprKind) -> ExprId {
    let import_meta = file.expr(ExprKind::ImportMeta, 0, 0);
    let callee = add_member_of(file, import_meta, member);
    let argument = file.expr(argument, 0, 0);
    add_call(file, callee, argument)
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

fn add_process_member_alias(file: &mut FileBuilder, flags: Flags) -> StmtId {
    let names = [(known::process, 0), (known::main, 0)];
    let alias = ImportEquals {
        name: known::value,
        name_pos: 0,
        target: ImportEqualsTarget::Entity(file.entity_name(names.into_iter())),
        expression: ExprId::NONE,
        flags,
        stmt: StmtId::NONE,
    };
    let alias = file.add_import_equals(alias);
    file.stmt(StmtKind::ImportEquals(alias), 0)
}

fn add_namespace(file: &mut FileBuilder, alias: StmtId, has_value: bool) -> StmtId {
    let mut body = vec![alias];
    if has_value {
        let value = file.expr(ExprKind::Null, 0, 0);
        body.push(file.stmt(StmtKind::Expr(value), 0));
    }
    let namespace = Module {
        name: ModuleName::Ident(known::object),
        name_pos: 0,
        flags: Flags::empty(),
        body: file.list(&body),
        has_body: true,
        specifies_module: false,
        stmt: StmtId::NONE,
    };
    let namespace = file.add_module(namespace);
    file.stmt(StmtKind::Module(namespace), 0)
}

fn property(kind: PropKind, key: PropKey, name_kind: NameKind, value: ExprId) -> Prop {
    Prop {
        kind,
        key,
        name_kind,
        value,
        pos: 0,
        start: 0,
        end: 0,
        postfix_token: 0,
    }
}

fn add_macro_attributes(file: &mut FileBuilder) -> ExprId {
    let value = file.expr(ExprKind::String(known::r#macro), 0, 0);
    let key = PropKey::Name(known::r#type);
    let import_type = property(PropKind::Init, key, NameKind::Identifier, value);
    let props = file.add_props(&[import_type]);
    let attributes = file.expr(ExprKind::Object(props), 0, 0);
    file.import_attributes.push((0, attributes));
    attributes
}

fn add_import(file: &mut FileBuilder, default: Atom, attributes: ExprId) -> StmtId {
    let import = file.add_import(Import {
        spec: known::module,
        default,
        default_pos: 0,
        namespace: Atom::NONE,
        namespace_pos: 0,
        clause_start: 0,
        clause_end: 0,
        namespace_start: 0,
        named: Span::EMPTY,
        has_named_imports: false,
        type_only: false,
        is_deferred: false,
        mode: ResolutionMode::default(),
        stmt: StmtId::NONE,
        attributes,
    });
    file.stmt(StmtKind::Import(import), 0)
}

fn add_export_star(file: &mut FileBuilder, type_only: bool, attributes: ExprId) -> StmtId {
    let export_star = StmtKind::ExportStar {
        spec: known::module,
        alias: Atom::NONE,
        type_only,
        mode: ResolutionMode::default(),
        star_pos: 0,
        alias_pos: 0,
    };
    let statement = file.stmt(export_star, 0);
    if attributes.is_some() {
        file.export_star_attributes.push((statement, attributes));
    }
    statement
}

fn add_export_from(
    file: &mut FileBuilder,
    name: Atom,
    type_only: bool,
    attributes: ExprId,
) -> StmtId {
    let export = ExportId(file.exports.len() as u32);
    let items = file.add_export_specs(&[ExportSpec {
        start: 0,
        local: name,
        exported: name,
        pos: 0,
        type_only,
        local_pos: 0,
        end: 0,
        export,
    }]);
    file.add_export(Export {
        spec: known::module,
        has_module_specifier: true,
        items,
        type_only: false,
        mode: ResolutionMode::default(),
        stmt: StmtId::NONE,
        attributes,
    });
    file.stmt(StmtKind::ExportNamed(export), 0)
}

fn add_element(file: &mut FileBuilder, tag: ExprId, attrs: Span<PropId>) -> ExprId {
    let jsx = file.add_jsx(Jsx {
        tag,
        close_tag: ExprId::NONE,
        attrs,
        children: IdList::EMPTY,
        type_args: IdList::EMPTY,
        opening_end: 0,
        close_pos: if tag.is_none() { 0 } else { u32::MAX },
        end: 0,
    });
    file.expr(ExprKind::Jsx(jsx), 0, 0)
}

fn add_fragment(file: &mut FileBuilder) -> ExprId {
    add_element(file, ExprId::NONE, Span::EMPTY)
}

fn add_keyed_spread_element(file: &mut FileBuilder, is_key_first: bool) -> ExprId {
    let tag = file.expr(ExprKind::Ident(known::object), 0, 0);
    let props = file.expr(ExprKind::Ident(known::props), 0, 0);
    let key = file.expr(ExprKind::String(known::value), 0, 0);
    let mut attributes = [
        property(PropKind::Spread, PropKey::None, NameKind::Jsx, props),
        property(
            PropKind::Init,
            PropKey::Name(known::key),
            NameKind::Jsx,
            key,
        ),
    ];
    if is_key_first {
        attributes.reverse();
    }
    let attributes = file.add_props(&attributes);
    add_element(file, tag, attributes)
}

struct FragmentProgram {
    file: FileBuilder,
    body: [StmtId; 3],
    require_call: ExprId,
}

fn fragment_program() -> FragmentProgram {
    let mut file = module_file();
    let import = add_import(&mut file, Atom::NONE, ExprId::NONE);
    let require = file.expr(ExprKind::Ident(known::require), 0, 0);
    let specifier = file.expr(ExprKind::String(known::module), 0, 0);
    let require_call = add_call(&mut file, require, specifier);
    let fragment = add_fragment(&mut file);
    let body = [
        import,
        file.stmt(StmtKind::Expr(require_call), 0),
        file.stmt(StmtKind::Expr(fragment), 0),
    ];
    FragmentProgram {
        file,
        body,
        require_call,
    }
}

fn scan_file(
    mut file: FileBuilder,
    body: &[StmtId],
    jsx: JsxMode,
    check: impl FnOnce(&ImportScan<'_>, ModuleFormat),
) {
    let session = Session::new();
    let arena = session.arena();
    let atoms = Interner::new_in(&session);
    file.body = file.list(body);
    let (mut hir, _) = file.into_arena(arena, &session);
    hir.finish_nodes();
    let options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let fold_options = FoldOptions {
        max_string_bytes: MAX_STRING_BYTES,
        ..FoldOptions::default()
    };
    let fold = FoldInputs::new(fold_options, arena);
    let file_inputs = FileInputs {
        declared_module_type: DeclaredModuleType::Unknown,
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx,
    };
    let bound = bind(&hir, options, &atoms, arena);
    let decisions = fold_file(&hir, &bound, &fold, &file_inputs, &atoms, arena).decisions;
    let inputs = ScanInputs {
        hir: &hir,
        bound: &bound,
        decisions: &decisions,
        fold: &fold,
        file: &file_inputs,
        atoms: &atoms,
    };
    let scan = collect_import_sites(&inputs, arena);
    let declared = file_inputs.declared_module_type;
    let format = decide_module_format(&hir, &bound, &decisions, &scan, declared).format;
    check(&scan, format);
}

fn with_scan_and_format(
    file: FileBuilder,
    body: &[StmtId],
    check: impl FnOnce(&ImportScan<'_>, ModuleFormat),
) {
    scan_file(file, body, JsxMode::Classic, check);
}

fn with_scan(file: FileBuilder, body: &[StmtId], check: impl FnOnce(&ImportScan<'_>)) {
    with_scan_and_format(file, body, |scan, _| check(scan));
}

fn with_automatic_jsx_scan(
    file: FileBuilder,
    body: &[StmtId],
    check: impl FnOnce(&ImportScan<'_>),
) {
    scan_file(file, body, AUTOMATIC_JSX, |scan, _| check(scan));
}

fn site_kinds(scan: &ImportScan<'_>) -> Vec<ImportSiteKind> {
    scan.sites.iter().map(|site| site.kind).collect()
}

fn jsx_imports(scan: &ImportScan<'_>) -> Vec<JsxImport> {
    scan.jsx_imports.iter().collect()
}

#[test]
fn module_require_objects_are_sorted() {
    let mut file = FileBuilder::default();
    let (outer_module, outer_callee) = add_member(&mut file, known::module, known::require);
    let (inner_module, inner_callee) = add_member(&mut file, known::module, known::require);
    let specifier = file.expr(ExprKind::String(known::module), 0, 0);
    let inner_call = add_call(&mut file, inner_callee, specifier);
    let outer_call = add_call(&mut file, outer_callee, inner_call);
    let body = [file.stmt(StmtKind::Expr(outer_call), 0)];
    with_scan(file, &body, |scan| {
        let expected = [inner_call, outer_call].map(ImportSiteKind::Require);
        assert_eq!(site_kinds(scan), expected);
        assert_eq!(scan.module_require_objects, [outer_module, inner_module]);
    });
}

#[test]
fn module_behind_an_optional_link_is_read() {
    let mut file = FileBuilder::default();
    let (_, callee) = add_member(&mut file, known::module, known::require);
    file.add_flags(callee, ExprFlags::OPTIONAL_CHAIN_LINK);
    let specifier = file.expr(ExprKind::String(known::module), 0, 0);
    let call = add_call(&mut file, callee, specifier);
    let body = [file.stmt(StmtKind::Expr(call), 0)];
    with_scan(file, &body, |scan| {
        assert_eq!(site_kinds(scan), [ImportSiteKind::Require(call)]);
        assert!(scan.module_require_objects.is_empty());
    });
}

#[test]
fn other_requires_have_no_module_object() {
    let mut file = FileBuilder::default();
    let require = file.expr(ExprKind::Ident(known::require), 0, 0);
    let (_, other_callee) = add_member(&mut file, known::value, known::require);
    let (_, resolve_callee) = add_member(&mut file, known::require, known::resolve);
    let mut body = Vec::new();
    for callee in [require, other_callee, resolve_callee] {
        let specifier = file.expr(ExprKind::String(known::module), 0, 0);
        let call = add_call(&mut file, callee, specifier);
        body.push(file.stmt(StmtKind::Expr(call), 0));
    }
    with_scan(file, &body, |scan| {
        assert_eq!(scan.sites.len(), 2);
        assert!(scan.module_require_objects.is_empty());
    });
}

#[test]
fn get_builtin_module_with_literal_is_site() {
    type AddObject = fn(&mut FileBuilder) -> ExprId;
    let cases: [(AddObject, Chain); 7] = [
        (add_process, Chain::No),
        (add_process, Chain::Start),
        (add_parenthesized_process_assertion, Chain::No),
        (add_process_of_global_this, Chain::No),
        (add_process_of_global_this, Chain::Start),
        (add_process_of_global, Chain::No),
        (add_process_of_global_this_assertion, Chain::Start),
    ];
    for (index, (add_object, chain)) in cases.into_iter().enumerate() {
        let mut file = FileBuilder::default();
        let object = add_object(&mut file);
        let callee = add_member_of(&mut file, object, known::getBuiltinModule);
        let specifier = file.expr(ExprKind::String(known::module), 0, 0);
        let call = add_call_in_chain(&mut file, callee, specifier, chain);
        let body = [file.stmt(StmtKind::Expr(call), 0)];
        with_scan_and_format(file, &body, |scan, format| {
            let expected = ImportSite {
                kind: ImportSiteKind::GetBuiltinModule(call),
                specifier: ImportSpecifier::Constant(known::module),
                specifier_node: specifier,
                attributes: ExprId::NONE,
                consults_resolver: true,
                is_host_value: false,
            };
            assert_eq!(scan.sites, [expected], "case {index}");
            assert_eq!(scan.first_call_site, 0);
            assert_eq!(format, ModuleFormat::Esm, "case {index}");
        });
    }
}

#[test]
fn get_builtin_module_with_computed_name_is_no_site() {
    for is_spread in [false, true] {
        let mut file = FileBuilder::default();
        let (_, callee) = add_member(&mut file, known::process, known::getBuiltinModule);
        let mut argument = file.expr(ExprKind::Ident(known::value), 0, 0);
        if is_spread {
            argument = file.expr(ExprKind::Spread(argument), 0, 0);
        }
        let call = add_call(&mut file, callee, argument);
        let body = [file.stmt(StmtKind::Expr(call), 0)];
        with_scan(file, &body, |scan| {
            assert!(scan.sites.is_empty(), "spread: {is_spread}");
            assert!(scan.sites_by_kind.is_empty(), "spread: {is_spread}");
        });
    }
}

#[test]
fn get_builtin_module_of_other_object_is_no_site() {
    let mut file = FileBuilder::default();
    let call = add_builtin_module_call(&mut file, known::value);
    let body = [file.stmt(StmtKind::Expr(call), 0)];
    with_scan(file, &body, |scan| assert!(scan.sites.is_empty()));
}

#[test]
fn get_builtin_module_of_process_of_other_object_is_no_site() {
    let mut file = FileBuilder::default();
    let (_, object) = add_member(&mut file, known::value, known::process);
    let callee = add_member_of(&mut file, object, known::getBuiltinModule);
    let specifier = file.expr(ExprKind::String(known::module), 0, 0);
    let call = add_call(&mut file, callee, specifier);
    let body = [file.stmt(StmtKind::Expr(call), 0)];
    with_scan(file, &body, |scan| assert!(scan.sites.is_empty()));
}

#[test]
fn get_builtin_module_of_process_of_parameter_named_global_this_is_no_site() {
    let mut file = FileBuilder::default();
    let object = add_process_of_global_this(&mut file);
    let callee = add_member_of(&mut file, object, known::getBuiltinModule);
    let specifier = file.expr(ExprKind::String(known::module), 0, 0);
    let call = add_call(&mut file, callee, specifier);
    let statement = file.stmt(StmtKind::Expr(call), 0);
    let body = [add_function(&mut file, known::globalThis, &[statement])];
    with_scan(file, &body, |scan| assert!(scan.sites.is_empty()));
}

#[test]
fn get_builtin_module_of_parameter_is_no_site() {
    for (parameter, is_site) in [(known::process, false), (known::value, true)] {
        let mut file = FileBuilder::default();
        let call = add_builtin_module_call(&mut file, known::process);
        let statement = file.stmt(StmtKind::Expr(call), 0);
        let body = [add_function(&mut file, parameter, &[statement])];
        with_scan(file, &body, |scan| {
            let expected = is_site.then_some(ImportSiteKind::GetBuiltinModule(call));
            assert_eq!(site_kinds(scan), Vec::from_iter(expected));
        });
    }
}

#[test]
fn get_builtin_module_in_with_body_is_no_site() {
    let mut file = FileBuilder::default();
    let object = add_builtin_module_call(&mut file, known::process);
    let call_in_body = add_builtin_module_call(&mut file, known::process);
    let body = file.stmt(StmtKind::Expr(call_in_body), 0);
    let body = [file.stmt(StmtKind::With { object, body }, 0)];
    with_scan(file, &body, |scan| {
        assert_eq!(site_kinds(scan), [ImportSiteKind::GetBuiltinModule(object)]);
    });
}

#[test]
fn host_value_call_is_marked() {
    for is_resolved_at_runtime in [true, false] {
        let mut file = FileBuilder::default();
        let specifier = ExprKind::String(known::module);
        let call = add_import_meta_call(&mut file, known::require, specifier);
        if is_resolved_at_runtime {
            file.add_flags(call, ExprFlags::RESOLVED_AT_RUNTIME);
        }
        let body = [file.stmt(StmtKind::Expr(call), 0)];
        with_scan(file, &body, |scan| {
            let [site] = scan.sites else {
                panic!("sites: {:?}", scan.sites);
            };
            assert_eq!(site.kind, ImportSiteKind::ImportMetaRequire(call));
            assert_eq!(site.specifier, ImportSpecifier::Constant(known::module));
            assert_eq!(site.is_host_value, is_resolved_at_runtime);
            assert!(site.consults_resolver);
        });
    }
}

#[test]
fn host_value_has_constant_specifier() {
    let mut file = FileBuilder::default();
    let specifier = ExprKind::Ident(known::value);
    let call = add_import_meta_call(&mut file, known::require, specifier);
    file.add_flags(call, ExprFlags::RESOLVED_AT_RUNTIME);
    let body = [file.stmt(StmtKind::Expr(call), 0)];
    with_scan(file, &body, |scan| {
        let [site] = scan.sites else {
            panic!("sites: {:?}", scan.sites);
        };
        assert_eq!(site.kind, ImportSiteKind::ImportMetaRequire(call));
        assert_eq!(site.specifier, ImportSpecifier::Unknown);
        assert!(!site.is_host_value);
    });
}

#[test]
fn import_meta_resolve_consults_resolver_for_bare_specifier() {
    let cases = [
        (ExprKind::String(known::path), true),
        (ExprKind::String(known::node_path), false),
        (ExprKind::Ident(known::value), false),
    ];
    for (index, (specifier, consults_resolver)) in cases.into_iter().enumerate() {
        let mut file = FileBuilder::default();
        let call = add_import_meta_call(&mut file, known::resolve, specifier);
        let body = [file.stmt(StmtKind::Expr(call), 0)];
        with_scan(file, &body, |scan| {
            assert_eq!(site_kinds(scan), [ImportSiteKind::ImportMetaResolve(call)]);
            assert_eq!(
                scan.sites[0].consults_resolver, consults_resolver,
                "case {index}"
            );
        });
    }
}

#[test]
fn jsx_sites_come_first() {
    let program = fragment_program();
    with_automatic_jsx_scan(program.file, &program.body, |scan| {
        let expected = [
            ImportSiteKind::JsxRuntime,
            ImportSiteKind::Import(ImportId(0)),
            ImportSiteKind::Require(program.require_call),
        ];
        assert_eq!(site_kinds(scan), expected);
        assert_eq!(scan.sites[0], RUNTIME_SITE);
        assert_eq!(scan.first_call_site, 2);
        assert_eq!(scan.sites_by_kind, [0, 1, 2]);
        assert_eq!(jsx_imports(scan), [JsxImport::Jsx, JsxImport::Fragment]);
    });
}

#[test]
fn classic_jsx_has_no_site() {
    let program = fragment_program();
    with_scan(program.file, &program.body, |scan| {
        let expected = [
            ImportSiteKind::Import(ImportId(0)),
            ImportSiteKind::Require(program.require_call),
        ];
        assert_eq!(site_kinds(scan), expected);
        assert_eq!(scan.first_call_site, 1);
        assert!(scan.jsx_imports.is_empty());
    });
}

#[test]
fn dead_element_has_no_site() {
    let mut file = FileBuilder::default();
    let test = file.expr(ExprKind::False, 0, 0);
    let fragment = add_fragment(&mut file);
    let yes = file.stmt(StmtKind::Expr(fragment), 0);
    let no = StmtId::NONE;
    let body = [file.stmt(StmtKind::If { test, yes, no }, 0)];
    with_automatic_jsx_scan(file, &body, |scan| {
        assert!(scan.sites.is_empty(), "{:?}", scan.sites);
        assert!(scan.jsx_imports.is_empty());
    });
}

#[test]
fn unreached_element_has_no_site() {
    let mut file = FileBuilder::default();
    add_fragment(&mut file);
    with_automatic_jsx_scan(file, &[], |scan| {
        assert!(scan.sites.is_empty(), "{:?}", scan.sites);
        assert!(scan.jsx_imports.is_empty());
    });
}

#[test]
fn package_site_needs_create_element() {
    let cases: [(&[bool], &[ImportSite], &[JsxImport]); 3] = [
        (&[false], &[PACKAGE_SITE], &[JsxImport::CreateElement]),
        (&[true], &[RUNTIME_SITE], &[JsxImport::Jsx]),
        (
            &[false, true],
            &[RUNTIME_SITE, PACKAGE_SITE],
            &[JsxImport::Jsx, JsxImport::CreateElement],
        ),
    ];
    for (elements, sites, imports) in cases {
        let mut file = FileBuilder::default();
        let mut body = Vec::new();
        for &is_key_first in elements {
            let element = add_keyed_spread_element(&mut file, is_key_first);
            body.push(file.stmt(StmtKind::Expr(element), 0));
        }
        with_automatic_jsx_scan(file, &body, |scan| {
            assert_eq!(scan.sites, sites, "{elements:?}");
            assert_eq!(scan.first_call_site as usize, sites.len(), "{elements:?}");
            assert_eq!(jsx_imports(scan), imports, "{elements:?}");
        });
    }
}

#[test]
fn evaluated_alias_of_global_is_used() {
    let cases = [
        (Flags::EXPORT, None, 0),
        (Flags::empty(), None, 1),
        (Flags::empty(), Some(true), 0),
        (Flags::empty(), Some(false), 1),
    ];
    for (flags, namespace_has_value, unused_count) in cases {
        let mut file = FileBuilder {
            has_module_syntax: flags.contains(Flags::EXPORT),
            ..Default::default()
        };
        let mut statement = add_process_member_alias(&mut file, flags);
        if let Some(has_value) = namespace_has_value {
            statement = add_namespace(&mut file, statement, has_value);
        }
        with_scan(file, &[statement], |scan| {
            let case = (flags, namespace_has_value);
            assert_eq!(scan.unused_import_symbols.len(), unused_count, "{case:?}");
        });
    }
}

#[test]
fn macro_exports_are_errors() {
    let mut file = module_file();
    let star_attributes = add_macro_attributes(&mut file);
    let from_attributes = add_macro_attributes(&mut file);
    let star = add_export_star(&mut file, false, star_attributes);
    let from = add_export_from(&mut file, known::value, false, from_attributes);
    with_scan(file, &[star, from], |scan| {
        let expected = [
            (FoldErrorKind::MacroInExportStar, star),
            (FoldErrorKind::MacroInExportFrom, from),
        ]
        .map(|(kind, statement)| FoldError {
            kind,
            node: NodeData::Stmt(statement),
        });
        assert_eq!(scan.errors, expected);
        assert_eq!(scan.sites.len(), 2);
    });
}

#[test]
fn other_statements_are_no_macro_errors() {
    let mut file = module_file();
    let import_attributes = add_macro_attributes(&mut file);
    let star_attributes = add_macro_attributes(&mut file);
    let from_attributes = add_macro_attributes(&mut file);
    let body = [
        add_import(&mut file, known::value, import_attributes),
        add_export_star(&mut file, false, ExprId::NONE),
        add_export_from(&mut file, known::value, false, ExprId::NONE),
        add_export_star(&mut file, true, star_attributes),
        add_export_from(&mut file, known::main, true, from_attributes),
    ];
    with_scan(file, &body, |scan| {
        assert!(scan.errors.is_empty(), "{:?}", scan.errors);
        assert_eq!(scan.sites.len(), 2);
    });
}
