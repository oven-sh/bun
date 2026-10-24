use std::borrow::Cow;

use bstr::BStr;
use bun_builtin_sources::{Archive, VIRTUAL_ROOT};
use bun_core::strings::index_of;
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::import_sites::JsxMode;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use super::{
    Directive, LibraryFunctionForm, LibraryItem, LibrarySource, LibraryStatement,
    PendingDirectives, parse_visibility,
};
use crate::builtins::id::RuntimeFunction;
use crate::builtins::{
    BuiltinNames, ImportTargets, Platforms, ResolveInput, SourceDialect, resolve_file, table,
};
use crate::compile::testing::lower_program;
use crate::diagnostic_codes::Code;
use crate::diagnostics::Diagnostic;
use crate::ir::generated::{
    Function, FunctionFlags, FunctionKind, FunctionRole, FunctionVisibility, RuntimeFunctionEntry,
};
use crate::ir::{DeclaredType, Mapped, PositionFlags, StringId, TypeTable};
use crate::load::host_platform;
use crate::lower::{Fragment, LoweredFile, LoweringOptions};

const ARRAY_PROTOTYPE: &str = "ArrayPrototype";
const OBJECT_MODELS: &str = "models/Objects";

fn with_runtime_source<R>(text: &str, then: impl FnOnce(&LibrarySource<'_, '_>) -> R) -> R {
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let parse_options = CompileParseOptions {
        path: b"/$bun/js/example.ts",
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: true,
        keeps_function_directives: false,
    };
    let mut hir = parse_for_compile(arena, &parse_options, text.as_bytes(), &atoms);
    hir.text = Cow::Borrowed(text.as_bytes());
    let fold_options = FoldOptions {
        max_string_bytes: 1 << 16,
        ..FoldOptions::default()
    };
    let fold = FoldInputs::new(fold_options, arena);
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let file = FileInputs {
        declared_module_type: DeclaredModuleType::Unknown,
        import_meta_main: None,
        is_library: true,
        host_values: &[],
        jsx: JsxMode::Classic,
    };
    let (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
    let names = BuiltinNames::new(&atoms);
    let builtins = resolve_file(&ResolveInput {
        hir: &hir,
        bound: &bound,
        decisions: &analysis.decisions,
        module_format: analysis.module_format,
        targets: &ImportTargets::new(&[]),
        names: &names,
        platform: Platforms::LINUX,
        dialect: SourceDialect::Runtime,
    });
    then(&LibrarySource {
        hir: &hir,
        analysis: &analysis,
        builtins: &builtins,
        atoms: &atoms,
    })
}

fn collect_directives(text: &str) -> Vec<PendingDirectives> {
    with_runtime_source(text, |source| {
        let items = source.library_items();
        items
            .map(|item| match item {
                LibraryItem::Function(_, directives) => directives,
                LibraryItem::TopLevelCode(_) => panic!("top-level code in: {text}"),
            })
            .collect()
    })
}

fn classify_statements(source: &LibrarySource<'_, '_>) -> Vec<LibraryStatement> {
    let statements = source.hir.ids(source.hir.body);
    statements
        .map(|statement| source.classify_library_statement(statement))
        .collect()
}

fn find_runtime_function(file: &str, export_name: &str) -> RuntimeFunction {
    let mut functions = table::runtime_functions().iter();
    let found = functions.find(|data| data.file == file && data.export_name == export_name);
    found
        .expect("the built-ins table lists the function")
        .function
}

fn lower_library_file(listed_function: RuntimeFunction, text: &str) -> LoweredFile {
    let manifest = Archive::embedded().manifest();
    let archive_name = manifest.function_file(listed_function.0);
    let archive_name = archive_name.expect("the manifest lists the file of the function");
    let path = [VIRTUAL_ROOT, archive_name].concat();
    let path = str::from_utf8(&path).expect("archive names are ASCII");
    let files = [("main.js", "export {};"), (path, text)];
    let options = LoweringOptions {
        platform: host_platform(),
        embeds_function_text: false,
        reports_type_mismatches: false,
        removable: Default::default(),
        minifies_identifiers: false,
    };
    let mut lowered = lower_program(&files, options);
    assert_eq!(lowered.len(), 2, "the entry point and the library file");
    lowered.remove(1).1
}

fn lower_array_prototype(text: &str) -> LoweredFile {
    lower_library_file(find_runtime_function(ARRAY_PROTOTYPE, "at"), text)
}

fn find_entry(fragment: &Fragment, function: RuntimeFunction) -> Option<RuntimeFunctionEntry> {
    let mut entries = fragment.runtime_functions.iter();
    entries.find(|entry| entry.id == function).copied()
}

fn find_array_entry(fragment: &Fragment, export_name: &str) -> RuntimeFunctionEntry {
    let function = find_runtime_function(ARRAY_PROTOTYPE, export_name);
    let entry = find_entry(fragment, function);
    entry.unwrap_or_else(|| panic!("{export_name} implements no built-in"))
}

fn header_of(fragment: &Fragment, entry: RuntimeFunctionEntry) -> &Function {
    let mut functions = fragment.functions.iter();
    let found = functions.find(|(id, _)| *id == entry.function);
    &found.expect("every declared function is lowered").1
}

fn array_header<'a>(fragment: &'a Fragment, export_name: &str) -> &'a Function {
    header_of(fragment, find_array_entry(fragment, export_name))
}

fn header_named<'a>(fragment: &'a Fragment, name: &str) -> &'a Function {
    let has_name = |id: StringId| fragment.strings.get(id) == name.as_bytes();
    let mut functions = fragment.functions.iter().map(|(_, function)| function);
    let found = functions.find(|function| function.name.is_some_and(has_name));
    found.unwrap_or_else(|| panic!("no function is named {name}"))
}

fn name_of<'a>(fragment: &'a Fragment, function: &Function) -> &'a BStr {
    let name = function.name.expect("a library function has a name");
    BStr::new(fragment.strings.get(name))
}

fn is_hidden(function: &Function) -> bool {
    let hidden = FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
    function.flags.contains(hidden)
}

#[test]
fn classifies_directives() {
    let text = r#"
        $visibility = "Private";
        $overriddenName = "require";
        $getter;
        $constructor;
        $nakedConstructor;
        $linkTimeConstant;
        $alwaysInline;
        export function probe() {}
    "#;
    with_runtime_source(text, |source| {
        let statements = classify_statements(source);
        let [
            LibraryStatement::Directive(Directive::Visibility(visibility)),
            LibraryStatement::Directive(Directive::OverriddenName(name)),
            LibraryStatement::Directive(Directive::Getter),
            LibraryStatement::Directive(Directive::Constructor),
            LibraryStatement::Directive(Directive::NakedConstructor),
            LibraryStatement::Directive(Directive::LinkTimeConstant),
            LibraryStatement::Directive(Directive::AlwaysInline),
            LibraryStatement::Function(_),
        ] = statements[..]
        else {
            panic!("{statements:?}");
        };
        assert_eq!(visibility, FunctionVisibility::Private);
        assert_eq!(BStr::new(source.atoms.bytes(name)), "require");
    });
}

#[test]
fn directives_apply_to_next_function() {
    let text = r#"
        $visibility = "Private";
        type Alias = number;
        declare function $probe(): void;
        const limit = 8;
        export function first() {}
        export function second() {}
        $linkTimeConstant;
        $getter;
        function third() {}
    "#;
    let private = PendingDirectives {
        visibility: Some(FunctionVisibility::Private),
        ..PendingDirectives::default()
    };
    let constant_getter = PendingDirectives {
        is_link_time_constant: true,
        is_getter: true,
        ..PendingDirectives::default()
    };
    assert_eq!(
        collect_directives(text),
        [private, PendingDirectives::default(), constant_getter]
    );
}

#[test]
fn directive_selects_function_form_and_without_one_it_is_method() {
    use LibraryFunctionForm::{Constructor, Method, NakedConstructor};
    let with_directives = r#"
        $constructor;
        export function first() {}
        $nakedConstructor;
        export function second() {}
    "#;
    let without_directive = r#"
        export function first() {}
        $constructor;
        export function second() {}
        $getter;
        export function third() {}
    "#;
    let cases: [(&str, &[LibraryFunctionForm]); 2] = [
        (with_directives, &[Constructor, NakedConstructor]),
        (without_directive, &[Method, Constructor, Method]),
    ];
    for (text, expected) in cases {
        let directives = collect_directives(text);
        let forms: Vec<LibraryFunctionForm> = directives.iter().map(|it| it.form).collect();
        assert_eq!(forms, expected, "{text}");
    }
}

#[test]
fn always_inline_changes_nothing() {
    let directives = collect_directives("$alwaysInline;\nexport function probe() {}");
    assert_eq!(directives, [PendingDirectives::default()]);
}

#[test]
fn top_level_code_keeps_pending_directives() {
    let text = r#"
        $constructor;
        probe();
        export function first() {}
    "#;
    with_runtime_source(text, |source| {
        let items: Vec<LibraryItem> = source.library_items().collect();
        let [
            LibraryItem::TopLevelCode(_),
            LibraryItem::Function(_, directives),
        ] = &items[..]
        else {
            panic!("{items:?}");
        };
        assert_eq!(directives.form, LibraryFunctionForm::Constructor);
    });
}

#[test]
fn statements_are_erased_or_top_level_code() {
    let malformed_directives = r#"
        $visibility;
        $visibility = "Hidden";
        $visibility = 1;
        $visibility += "Private";
        $overriddenName;
        $getter = "probe";
        $getter();
        $nakedConstructor = "probe";
    "#;
    let constants_with_primitive_values = r#"
        const limit = 8;
        const label: string = "probe";
        const enabled = true;
        const nothing = null;
        const wide = 10n;
        const negative = -1;
        const mask = 1 << 4;
        const first = 1, second = 2;
        const copy = limit;
    "#;
    let other_variable_declarations = r#"
        let variable = 1;
        var legacy = 1;
        const computed = probe();
        const list = [1];
        const record = { a: 1 };
        const { length } = "abc";
        const constant = 1, other = probe();
    "#;
    let statements_with_code = r#"
        let variable = 1;
        probe();
        probe;
        class Class {}
        enum Enum { A }
        namespace Namespace { export const member = 1; }
        import "side-effect";
        export { variable };
        export * from "star";
        export default 1;
        if (variable) {}
        debugger;
    "#;
    for (text, expected, count) in [
        (malformed_directives, LibraryStatement::TopLevelCode, 8),
        (constants_with_primitive_values, LibraryStatement::Erased, 9),
        (
            other_variable_declarations,
            LibraryStatement::TopLevelCode,
            7,
        ),
        (statements_with_code, LibraryStatement::TopLevelCode, 12),
    ] {
        let statements = with_runtime_source(text, classify_statements);
        assert_eq!(statements, vec![expected; count], "{text}");
    }
}

#[test]
fn declarations_without_code_are_erased() {
    let text = r#"
        "use strict";
        ;
        interface Shape {}
        type Alias = Imported;
        import type { OnlyType } from "a";
        import { Imported } from "b";
        export type { Alias };
        export {};
        declare function $probe(): void;
        declare const constant: number;
        declare class AmbientClass {}
        declare enum AmbientEnum {}
        const enum InlinedEnum { A }
        declare namespace AmbientNamespace {}
        function overloaded(value: string): void;
        function overloaded(value: any) {}
    "#;
    let statements = with_runtime_source(text, classify_statements);
    let (implementation, declarations) = statements.split_last().unwrap();
    assert_eq!(declarations, [LibraryStatement::Erased; 15]);
    assert!(matches!(implementation, LibraryStatement::Function(_)));
}

#[test]
fn parses_visibility_names() {
    let visibilities: [(&[u8], FunctionVisibility); 3] = [
        (b"Public", FunctionVisibility::Public),
        (b"Private", FunctionVisibility::Private),
        (b"PrivateRecursive", FunctionVisibility::PrivateRecursive),
    ];
    for (text, visibility) in visibilities {
        assert_eq!(parse_visibility(text), Some(visibility));
    }
    assert_eq!(parse_visibility(b"private"), None);
    assert_eq!(parse_visibility(b""), None);
    assert_eq!(parse_visibility(&[0xFF]), None);
}

#[test]
fn computes_default_visibility() {
    use FunctionVisibility::{Private, Public};
    let mut pending = PendingDirectives::default();
    assert_eq!(pending.compute_visibility(false), Public);
    assert_eq!(pending.compute_visibility(true), Private);
    pending.add(Directive::LinkTimeConstant);
    assert_eq!(pending.compute_visibility(false), Private);
    pending.add(Directive::Visibility(Public));
    assert_eq!(pending.compute_visibility(true), Public);
}

#[test]
fn function_form_decides_header_kind() {
    let text = r#"
        export function at() { return this; }
        $constructor;
        export function every() { return this; }
        $nakedConstructor;
        export function filter() { return this; }
    "#;
    let fragment = lower_array_prototype(text).fragment;
    let method = array_header(&fragment, "at");
    let constructor = array_header(&fragment, "every");
    let naked_constructor = array_header(&fragment, "filter");
    assert_eq!(method.kind, FunctionKind::Method);
    assert_eq!(constructor.kind, FunctionKind::Plain);
    assert_eq!(naked_constructor.kind, FunctionKind::BaseConstructor);

    for flags in [method.flags, constructor.flags] {
        assert!(flags.contains(FunctionFlags::HAS_THIS));
        assert!(!flags.contains(FunctionFlags::HAS_NEW_TARGET));
        assert!(!flags.contains(FunctionFlags::IS_NAKED_CONSTRUCTOR));
    }
    let flags = naked_constructor.flags;
    assert!(!flags.contains(FunctionFlags::HAS_THIS));
    assert!(flags.contains(FunctionFlags::HAS_NEW_TARGET));
    assert!(flags.contains(FunctionFlags::IS_NAKED_CONSTRUCTOR));
    assert_eq!(naked_constructor.this_type, DeclaredType::untyped());
    assert_eq!(
        naked_constructor.results,
        [DeclaredType::from_compiler(TypeTable::OBJECT)]
    );
}

#[test]
fn listed_export_implements_builtin() {
    let text = r#"
        export function at() {}
        export function unlisted() {}
        function every() {}
    "#;
    let fragment = lower_array_prototype(text).fragment;
    let at = find_runtime_function(ARRAY_PROTOTYPE, "at");
    let entries = fragment.runtime_functions.iter().map(|entry| entry.id);
    assert_eq!(entries.collect::<Vec<RuntimeFunction>>(), [at]);
    let builtin = array_header(&fragment, "at");
    assert_eq!(builtin.enclosing_runtime_function, Some(at));
    assert!(!is_hidden(builtin));
    for name in ["unlisted", "every"] {
        let local = header_named(&fragment, name);
        assert_eq!(local.enclosing_runtime_function, None, "{name}");
        assert_eq!(local.kind, FunctionKind::Plain, "{name}");
        assert!(is_hidden(local), "{name}");
    }
}

// Bun's own sources are lowered with their types: what they write holds, as in the program's code.
#[test]
fn listed_export_checks_written_types() {
    let text = "export function at(index: number): number { return index; }";
    let fragment = lower_array_prototype(text).fragment;
    let builtin = array_header(&fragment, "at");
    assert_eq!(builtin.role, FunctionRole::Library);
    assert!(builtin.flags.contains(FunctionFlags::IS_CHECKED));
    assert_eq!((builtin.parameters.len(), builtin.results.len()), (1, 1));
    for position in [builtin.parameters[0], builtin.results[0]] {
        assert_eq!(position.ty, TypeTable::NUMBER);
        assert!(!position.is_expected());
    }
}

#[test]
fn type_error_leaves_expected_types() {
    let text = "export function at(index: number): number { return \"text\"; }";
    let fragment = lower_array_prototype(text).fragment;
    let builtin = array_header(&fragment, "at");
    assert!(!builtin.flags.contains(FunctionFlags::IS_CHECKED));
    let number = Mapped::expected(TypeTable::NUMBER);
    let expected = DeclaredType::new(number, None, PositionFlags::default());
    assert_eq!(builtin.parameters, [expected]);
    assert_eq!(builtin.results, [expected]);
}

#[test]
fn directives_name_and_hide_builtins() {
    let text = r#"
        $getter;
        export function at() {}
        $overriddenName = "renamed";
        export function every() {}
        $visibility = "Private";
        export function filter() {}
        export async function find() {}
        export function findIndex() {}
    "#;
    let fragment = lower_array_prototype(text).fragment;
    for (export_name, name) in [
        ("at", "get at"),
        ("every", "renamed"),
        ("findIndex", "findIndex"),
    ] {
        let header = array_header(&fragment, export_name);
        assert_eq!(name_of(&fragment, header), name);
        assert!(header.flags.contains(FunctionFlags::HAS_EXPLICIT_NAME));
    }
    for (export_name, visibility) in [
        ("filter", FunctionVisibility::Private),
        ("find", FunctionVisibility::Private),
        ("findIndex", FunctionVisibility::Public),
    ] {
        let entry = find_array_entry(&fragment, export_name);
        assert_eq!(entry.visibility, visibility, "{export_name}");
        let is_private = visibility == FunctionVisibility::Private;
        assert_eq!(
            is_hidden(header_of(&fragment, entry)),
            is_private,
            "{export_name}"
        );
    }
}

#[test]
fn an_empty_overridden_name_leaves_a_builtin_without_a_name() {
    let text = r#"
        $overriddenName = "";
        export function at() {}
        export function every() {}
    "#;
    let fragment = lower_array_prototype(text).fragment;
    let header = array_header(&fragment, "at");
    assert_eq!(header.name, None);
    assert!(!header.flags.contains(FunctionFlags::HAS_EXPLICIT_NAME));
    assert_eq!(
        name_of(&fragment, array_header(&fragment, "every")),
        "every"
    );
}

#[test]
fn model_has_model_role() {
    let entries = find_runtime_function(OBJECT_MODELS, "entries");
    let fragment = lower_library_file(entries, "export function entries() {}").fragment;
    let entry = find_entry(&fragment, entries).expect("the model is listed");
    assert_eq!(header_of(&fragment, entry).role, FunctionRole::Model);

    let fragment = lower_array_prototype("export function at() {}").fragment;
    assert_eq!(array_header(&fragment, "at").role, FunctionRole::Library);
}

#[test]
fn top_level_code_is_reported_and_passed_over() {
    const TEXT: &str = "const limit = 8;\n\
        export function at() { return limit; }\n\
        let counter = 0;\n\
        export function every() {}\n";
    let lowered = lower_array_prototype(TEXT);
    let diagnostics: Vec<&Diagnostic> = lowered.diagnostics.iter().collect();
    let [diagnostic] = diagnostics[..] else {
        panic!("{diagnostics:?}");
    };
    assert_eq!(diagnostic.code, Code::LibraryFileHasTopLevelCode);
    let statement_start = index_of(TEXT.as_bytes(), b"let counter");
    let reported_start = diagnostic.span.map(|span| span.start as usize);
    assert_eq!(reported_start, statement_start);
    for export_name in ["at", "every"] {
        let function = find_runtime_function(ARRAY_PROTOTYPE, export_name);
        let entry = find_entry(&lowered.fragment, function);
        assert!(entry.is_some(), "{export_name}");
    }
}
