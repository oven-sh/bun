use super::*;
use crate::bind::{BindOptions, RuntimeBindOptions, bind};
use crate::fold::{FoldOptions, slice_in};
use crate::hir::{
    Branches, Call, Chain, FileBuilder, Flags, FnBody, FnKind, Func, Import, ImportId, ImportSpec,
    ListAt, Module, ModuleName, NameKind, ParamId, PatKind, Prop, PropKey, PropKind,
    ResolutionMode, Span, TextRange, TypeNodeId, VarDecl, VarKind,
};
use crate::session::{Arena, Session};

const VALUE: bool = false;
const TYPE_ONLY: bool = true;

struct Workspace<'s> {
    atoms: Interner<'s>,
    arena: &'s Arena,
}

impl<'s> Workspace<'s> {
    fn new(session: &'s Session) -> Workspace<'s> {
        Workspace {
            atoms: Interner::new_in(session),
            arena: session.arena(),
        }
    }

    fn atom(&self, text: &str) -> Atom {
        self.atoms.intern(text.as_bytes())
    }

    fn empty_inputs(&self) -> FoldInputs<'s> {
        FoldInputs::new(FoldOptions::default(), self.arena)
    }

    fn feature_inputs(&self, flag: Atom) -> FoldInputs<'s> {
        let options = FoldOptions {
            features: slice_in(&[flag], self.arena),
            ..FoldOptions::default()
        };
        FoldInputs::new(options, self.arena)
    }

    fn compiler_function_inputs(&self, names: &[Atom]) -> FoldInputs<'s> {
        let options = FoldOptions {
            compiler_functions: slice_in(names, self.arena),
            ..FoldOptions::default()
        };
        FoldInputs::new(options, self.arena)
    }

    fn bind_module(&self, mut file: FileBuilder, body: &[StmtId]) -> (File<'s>, Bound<'s>) {
        file.has_module_syntax = true;
        file.body = file.list(body);
        let (mut hir, _) = file.into_arena(self.arena, self.atoms.session());
        hir.finish_nodes();
        let options = BindOptions {
            runtime: Some(RuntimeBindOptions::default()),
            ..BindOptions::default()
        };
        let bound = bind(&hir, options, &self.atoms, self.arena);
        (hir, bound)
    }
}

fn add_bundle_import(
    file: &mut FileBuilder,
    is_type_only: bool,
    names: &[(Atom, Atom, bool)],
) -> StmtId {
    let import = ImportId(file.imports.len() as u32);
    let specifiers: Vec<ImportSpec> = names
        .iter()
        .map(|&(imported, local, type_only)| ImportSpec {
            start: 0,
            imported,
            local,
            pos: 0,
            type_only,
            imported_pos: 0,
            end: 0,
            import,
        })
        .collect();
    let named = file.add_import_specs(&specifiers);
    let added = file.add_import(Import {
        spec: known::bun_bundle,
        default: Atom::NONE,
        default_pos: 0,
        namespace: Atom::NONE,
        namespace_pos: 0,
        clause_start: 0,
        clause_end: 0,
        namespace_start: 0,
        named,
        has_named_imports: true,
        type_only: is_type_only,
        is_deferred: false,
        mode: ResolutionMode::None,
        stmt: StmtId::NONE,
        attributes: ExprId::NONE,
    });
    assert_eq!(added, import);
    file.stmt(StmtKind::Import(import), 0)
}

fn specifier_symbol(bound: &Bound<'_>, index: u32) -> SymbolId {
    bound.declared_symbol(Decl::ImportSpec(ImportSpecId(index)))
}

struct FeatureCall {
    call: ExprId,
    argument: ExprId,
}

fn add_call(file: &mut FileBuilder, callee: ExprId, arguments: &[ExprId]) -> ExprId {
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

fn add_feature_call(file: &mut FileBuilder, flag: ExprKind) -> FeatureCall {
    let callee = file.expr(ExprKind::Ident(known::feature), 0, 0);
    let flag = file.expr(flag, 0, 0);
    let argument = file.expr(ExprKind::NonNull(flag), 0, 0);
    FeatureCall {
        call: add_call(file, callee, &[argument]),
        argument,
    }
}

fn add_if(file: &mut FileBuilder, test: ExprId) -> StmtId {
    let yes = file.stmt(StmtKind::Empty, 0);
    let no = StmtId::NONE;
    file.stmt(StmtKind::If { test, yes, no }, 0)
}

fn add_conditional(file: &mut FileBuilder, test: ExprId, yes: ExprId) -> ExprId {
    let no = file.expr(ExprKind::Null, 0, 0);
    let branches = file.store_branches(Branches { yes, no });
    file.expr(ExprKind::Cond { test, branches }, 0, 0)
}

fn add_invoked_arrow_function(file: &mut FileBuilder, body: FnBody) -> ExprId {
    let function = file.add_fn(Func {
        kind: FnKind::Arrow,
        flags: Flags::empty(),
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
        is_strict: true,
        is_strict_by_syntax: false,
    });
    let callee = file.expr(ExprKind::Fn(function), 0, 0);
    add_call(file, callee, &[])
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

struct FeatureCalls {
    accepted: Vec<ExprId>,
    rejected: Vec<ExprId>,
}

fn check_branch_conditions(
    build: impl FnOnce(&mut FileBuilder, Atom, &mut Vec<StmtId>) -> FeatureCalls,
) {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let on = workspace.atom("ON");
    let inputs = workspace.feature_inputs(on);
    let mut file = FileBuilder::default();
    let names = [(known::feature, known::feature, VALUE)];
    let mut body = vec![add_bundle_import(&mut file, VALUE, &names)];
    let calls = build(&mut file, on, &mut body);
    let (hir, bound) = workspace.bind_module(file, &body);
    let mut errors = Vec::new();
    let mut evaluate =
        |call| evaluate_feature_call(&hir, &bound, &inputs, &workspace.atoms, call, &mut errors);
    for &call in &calls.accepted {
        assert!(evaluate(call), "{call:?}");
    }
    for &call in &calls.rejected {
        assert!(!evaluate(call), "{call:?}");
    }
    let expected: Vec<FoldError> = calls
        .rejected
        .iter()
        .map(|&call| FoldError {
            kind: FoldErrorKind::FeatureOutsideCondition,
            node: NodeData::Expr(call),
        })
        .collect();
    assert_eq!(errors, expected);
}

fn add_object(file: &mut FileBuilder, key: PropKey, value: ExprId) -> ExprId {
    let props = file.add_props(&[Prop {
        kind: PropKind::Init,
        key,
        name_kind: NameKind::default(),
        value,
        pos: 0,
        start: 0,
        end: 0,
        postfix_token: 0,
    }]);
    file.expr(ExprKind::Object(props), 0, 0)
}

#[test]
#[cfg_attr(miri, ignore)]
fn bundle_import_errors_name_specifier() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let (again, nope) = (workspace.atom("again"), workspace.atom("nope"));
    let mut file = FileBuilder::default();
    let names = [
        (known::feature, known::feature, VALUE),
        (known::feature, again, VALUE),
        (nope, nope, VALUE),
    ];
    let import = add_bundle_import(&mut file, VALUE, &names);
    let (hir, bound) = workspace.bind_module(file, &[import]);
    let inputs = workspace.compiler_function_inputs(&[workspace.atom("validate")]);
    let mut errors = Vec::new();
    let symbol = find_feature_import(&hir, &bound, &inputs, &mut errors);
    assert!(symbol.is_some());
    assert_eq!(symbol, specifier_symbol(&bound, 0));
    let expected = [
        (FoldErrorKind::FeatureImportedTwice, ImportSpecId(1)),
        (FoldErrorKind::UnknownBundleExport(nope), ImportSpecId(2)),
    ];
    let expected = expected.map(|(kind, specifier)| FoldError {
        kind,
        node: NodeData::ImportSpec(specifier),
    });
    assert_eq!(errors, expected);
}

#[test]
#[cfg_attr(miri, ignore)]
fn type_only_bundle_imports_are_skipped() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let (registry, flag) = (workspace.atom("Registry"), workspace.atom("flag"));
    let mut file = FileBuilder::default();
    let types = add_bundle_import(&mut file, TYPE_ONLY, &[(registry, registry, VALUE)]);
    let names = [
        (known::feature, known::feature, TYPE_ONLY),
        (known::feature, flag, VALUE),
        (registry, workspace.atom("Renamed"), TYPE_ONLY),
    ];
    let values = add_bundle_import(&mut file, VALUE, &names);
    let (hir, bound) = workspace.bind_module(file, &[types, values]);
    let mut errors = Vec::new();
    let symbol = find_feature_import(&hir, &bound, &workspace.empty_inputs(), &mut errors);
    assert!(errors.is_empty(), "{errors:?}");
    assert!(symbol.is_some());
    assert_eq!(symbol, specifier_symbol(&bound, 2));
    assert_ne!(symbol, specifier_symbol(&bound, 1));
}

#[test]
#[cfg_attr(miri, ignore)]
fn ambient_module_bundle_import_is_skipped() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let (registry, flag) = (workspace.atom("Registry"), workspace.atom("flag"));
    let mut file = FileBuilder::default();
    let names = [
        (known::feature, known::feature, VALUE),
        (registry, registry, VALUE),
    ];
    let nested = add_bundle_import(&mut file, VALUE, &names);
    let body = file.list(&[nested]);
    let module = file.add_module(Module {
        name: ModuleName::String(workspace.atom("m")),
        name_pos: 0,
        flags: Flags::AMBIENT,
        body,
        has_body: true,
        specifies_module: true,
        stmt: StmtId::NONE,
    });
    let module = file.stmt(StmtKind::Module(module), 0);
    let import = add_bundle_import(&mut file, VALUE, &[(known::feature, flag, VALUE)]);
    let (hir, bound) = workspace.bind_module(file, &[module, import]);
    let mut errors = Vec::new();
    let symbol = find_feature_import(&hir, &bound, &workspace.empty_inputs(), &mut errors);
    assert!(errors.is_empty(), "{errors:?}");
    assert!(symbol.is_some());
    assert_eq!(symbol, specifier_symbol(&bound, 2));
    assert_ne!(symbol, specifier_symbol(&bound, 0));
}

#[test]
#[cfg_attr(miri, ignore)]
fn flag_argument_reads_through_cast() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let on = workspace.atom("ON");
    let inputs = workspace.feature_inputs(on);
    let mut file = FileBuilder::default();
    let names = [(known::feature, known::feature, VALUE)];
    let import = add_bundle_import(&mut file, VALUE, &names);
    let enabled = add_feature_call(&mut file, ExprKind::String(on));
    let enabled_test = add_if(&mut file, enabled.call);
    let one = file.number(1.0);
    let numeric = add_feature_call(&mut file, ExprKind::Number(one));
    let numeric_test = add_if(&mut file, numeric.call);
    let body = [import, enabled_test, numeric_test];
    let (hir, bound) = workspace.bind_module(file, &body);
    let mut errors = Vec::new();
    let mut evaluate =
        |call| evaluate_feature_call(&hir, &bound, &inputs, &workspace.atoms, call, &mut errors);
    assert!(evaluate(enabled.call));
    assert!(!evaluate(numeric.call));
    let expected = FoldError {
        kind: FoldErrorKind::FeatureArgumentNotString,
        node: NodeData::Expr(numeric.argument),
    };
    assert_eq!(errors, [expected]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn flag_argument_count_must_be_one() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let on = workspace.atom("ON");
    let inputs = workspace.feature_inputs(on);
    let mut file = FileBuilder::default();
    let names = [(known::feature, known::feature, VALUE)];
    let import = add_bundle_import(&mut file, VALUE, &names);
    let callee = file.expr(ExprKind::Ident(known::feature), 0, 0);
    let without_arguments = add_call(&mut file, callee, &[]);
    let without_arguments_test = add_if(&mut file, without_arguments);
    let callee = file.expr(ExprKind::Ident(known::feature), 0, 0);
    let flags = [ExprKind::String(on); 2].map(|flag| file.expr(flag, 0, 0));
    let with_two_arguments = add_call(&mut file, callee, &flags);
    let with_two_arguments_test = add_if(&mut file, with_two_arguments);
    let body = [import, without_arguments_test, with_two_arguments_test];
    let (hir, bound) = workspace.bind_module(file, &body);
    let mut errors = Vec::new();
    let calls = [without_arguments, with_two_arguments];
    for call in calls {
        let atoms = &workspace.atoms;
        assert!(!evaluate_feature_call(
            &hir,
            &bound,
            &inputs,
            atoms,
            call,
            &mut errors
        ));
    }
    let expected = calls.map(|call| FoldError {
        kind: FoldErrorKind::FeatureArgumentCount,
        node: NodeData::Expr(call),
    });
    assert_eq!(errors, expected);
}

#[test]
#[cfg_attr(miri, ignore)]
fn flag_must_be_ascii() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let accented = workspace.atom("\u{e9}");
    let inputs = workspace.feature_inputs(accented);
    let mut file = FileBuilder::default();
    let names = [(known::feature, known::feature, VALUE)];
    let import = add_bundle_import(&mut file, VALUE, &names);
    let found = add_feature_call(&mut file, ExprKind::String(accented));
    let test = add_if(&mut file, found.call);
    let (hir, bound) = workspace.bind_module(file, &[import, test]);
    let mut errors = Vec::new();
    let atoms = &workspace.atoms;
    assert!(!evaluate_feature_call(
        &hir,
        &bound,
        &inputs,
        atoms,
        found.call,
        &mut errors
    ));
    let expected = FoldError {
        kind: FoldErrorKind::FeatureFlagNotAscii,
        node: NodeData::Expr(found.argument),
    };
    assert_eq!(errors, [expected]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn disabled_flag_is_false_without_error() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let inputs = workspace.feature_inputs(workspace.atom("ON"));
    let mut file = FileBuilder::default();
    let names = [(known::feature, known::feature, VALUE)];
    let import = add_bundle_import(&mut file, VALUE, &names);
    let disabled = add_feature_call(&mut file, ExprKind::String(workspace.atom("OFF"))).call;
    let test = add_if(&mut file, disabled);
    let (hir, bound) = workspace.bind_module(file, &[import, test]);
    let mut errors = Vec::new();
    let atoms = &workspace.atoms;
    assert!(!evaluate_feature_call(
        &hir,
        &bound,
        &inputs,
        atoms,
        disabled,
        &mut errors
    ));
    assert!(errors.is_empty(), "{errors:?}");
}

#[test]
#[cfg_attr(miri, ignore)]
fn file_without_bundle_import_has_no_feature_symbol() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let mut file = FileBuilder::default();
    let call = add_feature_call(&mut file, ExprKind::String(workspace.atom("ON"))).call;
    let test = add_if(&mut file, call);
    let (hir, bound) = workspace.bind_module(file, &[test]);
    let mut errors = Vec::new();
    let symbol = find_feature_import(&hir, &bound, &workspace.empty_inputs(), &mut errors);
    assert!(symbol.is_none());
    assert!(errors.is_empty(), "{errors:?}");
}

#[test]
#[cfg_attr(miri, ignore)]
fn branch_condition_includes_object_literal() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let on = workspace.atom("ON");
    let inputs = workspace.feature_inputs(on);
    let mut file = FileBuilder::default();
    let names = [(known::feature, known::feature, VALUE)];
    let import = add_bundle_import(&mut file, VALUE, &names);
    let value = add_feature_call(&mut file, ExprKind::String(on)).call;
    let object = add_object(&mut file, PropKey::Name(known::default), value);
    let value_test = add_if(&mut file, object);
    let key = add_feature_call(&mut file, ExprKind::String(on)).call;
    let null = file.expr(ExprKind::Null, 0, 0);
    let object = add_object(&mut file, PropKey::Computed(key), null);
    let key_test = add_if(&mut file, object);
    let unconditional = add_feature_call(&mut file, ExprKind::String(on)).call;
    let object = add_object(&mut file, PropKey::Name(known::default), unconditional);
    let statement = file.stmt(StmtKind::Expr(object), 0);
    let body = [import, value_test, key_test, statement];
    let (hir, bound) = workspace.bind_module(file, &body);
    let mut errors = Vec::new();
    let mut evaluate =
        |call| evaluate_feature_call(&hir, &bound, &inputs, &workspace.atoms, call, &mut errors);
    assert!(evaluate(value));
    assert!(evaluate(key));
    assert!(!evaluate(unconditional));
    let expected = FoldError {
        kind: FoldErrorKind::FeatureOutsideCondition,
        node: NodeData::Expr(unconditional),
    };
    assert_eq!(errors, [expected]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn compiler_functions_are_bundle_exports() {
    let session = Session::new();
    let workspace = Workspace::new(&session);
    let validate = workspace.atom("validate");
    let mut file = FileBuilder::default();
    let import = add_bundle_import(&mut file, VALUE, &[(validate, validate, VALUE)]);
    let (hir, bound) = workspace.bind_module(file, &[import]);
    let mut errors = Vec::new();
    let inputs = workspace.compiler_function_inputs(&[validate]);
    assert!(find_feature_import(&hir, &bound, &inputs, &mut errors).is_none());
    assert!(errors.is_empty(), "{errors:?}");

    let inputs = workspace.compiler_function_inputs(&[]);
    assert!(find_feature_import(&hir, &bound, &inputs, &mut errors).is_none());
    let expected = FoldError {
        kind: FoldErrorKind::UnknownBundleExport(validate),
        node: NodeData::ImportSpec(ImportSpecId(0)),
    };
    assert_eq!(errors, [expected]);
}

#[test]
#[cfg_attr(miri, ignore)]
fn branch_condition_excludes_arms() {
    check_branch_conditions(|file, on, body| {
        let add_call = |file: &mut FileBuilder| add_feature_call(file, ExprKind::String(on)).call;
        let direct_test = add_call(file);
        let null = file.expr(ExprKind::Null, 0, 0);
        let conditional = add_conditional(file, direct_test, null);
        body.push(file.stmt(StmtKind::Expr(conditional), 0));

        let arm_in_test = add_call(file);
        let null = file.expr(ExprKind::Null, 0, 0);
        let conditional = add_conditional(file, null, arm_in_test);
        body.push(add_if(file, conditional));

        let conditional_arm = add_call(file);
        let null = file.expr(ExprKind::Null, 0, 0);
        let conditional = add_conditional(file, null, conditional_arm);
        body.push(file.stmt(StmtKind::Expr(conditional), 0));

        let statement_arm = add_call(file);
        let test = file.expr(ExprKind::Null, 0, 0);
        let yes = file.stmt(StmtKind::Expr(statement_arm), 0);
        let no = StmtId::NONE;
        body.push(file.stmt(StmtKind::If { test, yes, no }, 0));

        FeatureCalls {
            accepted: vec![direct_test, arm_in_test],
            rejected: vec![conditional_arm, statement_arm],
        }
    });
}

#[test]
#[cfg_attr(miri, ignore)]
fn branch_condition_includes_function_bodies() {
    check_branch_conditions(|file, on, body| {
        let add_call = |file: &mut FileBuilder| add_feature_call(file, ExprKind::String(on)).call;
        let expression_body = add_call(file);
        let invoked = add_invoked_arrow_function(file, FnBody::Expr(expression_body));
        body.push(add_if(file, invoked));

        let returned = add_call(file);
        let initializer = add_call(file);
        let statements = [
            add_constant(file, known::value, initializer),
            file.stmt(StmtKind::Return(returned), 0),
        ];
        let statements = file.list(&statements);
        let invoked = add_invoked_arrow_function(file, FnBody::Block(statements));
        let null = file.expr(ExprKind::Null, 0, 0);
        let conditional = add_conditional(file, invoked, null);
        body.push(file.stmt(StmtKind::Expr(conditional), 0));

        let outside_test = add_call(file);
        let invoked = add_invoked_arrow_function(file, FnBody::Expr(outside_test));
        body.push(file.stmt(StmtKind::Expr(invoked), 0));

        let in_arm = add_call(file);
        let invoked = add_invoked_arrow_function(file, FnBody::Expr(in_arm));
        let test = file.expr(ExprKind::Null, 0, 0);
        let yes = file.stmt(StmtKind::Expr(invoked), 0);
        let no = StmtId::NONE;
        body.push(file.stmt(StmtKind::If { test, yes, no }, 0));

        FeatureCalls {
            accepted: vec![expression_body, returned, initializer],
            rejected: vec![outside_test, in_arm],
        }
    });
}
