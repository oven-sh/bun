use std::borrow::Cow;

use bstr::BStr;
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{BindOptions, Binding, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir::StmtId;
use bun_sema::import_sites::JsxMode;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use super::{ExportScan, ModuleValue};

fn with_scan<R>(text: &str, then: impl FnOnce(&ExportScan<'_, '_>) -> R) -> R {
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
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
    };
    let (bound, _) = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
    then(&ExportScan {
        hir: &hir,
        bound: &bound,
        atoms: &atoms,
    })
}

fn find_module_value(text: &str) -> ModuleValue {
    with_scan(text, |scan| scan.find_module_value())
}

fn top_level_statements(scan: &ExportScan<'_, '_>) -> Vec<StmtId> {
    scan.hir.ids(scan.hir.body).collect()
}

#[test]
fn default_expression_is_module_value() {
    with_scan("const a = 1;\nexport default { a };\nprobe();", |scan| {
        let statements = top_level_statements(scan);
        assert_eq!(statements.len(), 3);
        let expected = ModuleValue::DefaultExpression(statements[1]);
        assert_eq!(scan.find_module_value(), expected);
    });
}

#[test]
fn first_default_expression_wins() {
    with_scan("export default 1;\nexport default 2;", |scan| {
        let statements = top_level_statements(scan);
        assert_eq!(statements.len(), 2);
        let expected = ModuleValue::DefaultExpression(statements[0]);
        assert_eq!(scan.find_module_value(), expected);
    });
}

#[test]
fn default_declaration_is_module_value() {
    for text in [
        "export default function probe() {}",
        "export default class Probe {}",
    ] {
        let value = find_module_value(text);
        let is_declaration = matches!(value, ModuleValue::DefaultDeclaration(Binding::Symbol(_)));
        assert!(is_declaration, "{text}: {value:?}");
    }
}

#[test]
fn default_export_hides_named_exports() {
    let expression = find_module_value("export const a = 1;\nexport default 2;");
    assert!(
        matches!(expression, ModuleValue::DefaultExpression(_)),
        "{expression:?}"
    );
    let declaration = find_module_value("export const a = 1;\nexport default function b() {}");
    assert!(
        matches!(declaration, ModuleValue::DefaultDeclaration(_)),
        "{declaration:?}"
    );
}

#[test]
fn named_exports_are_sorted_and_unique() {
    let text = r#"
        export function b() {}
        export const { a, nested: [d] } = probe();
        export class C {}
        export enum E { X }
        export namespace N { export const member = 1; }
        const z = 1, y = 2;
        export { z, y as B };
        export function overloaded(value: string): void;
        export function overloaded(value: any) {}
    "#;
    with_scan(text, |scan| {
        let ModuleValue::NamedExports(exports) = scan.find_module_value() else {
            panic!("the module has named exports");
        };
        let text_of = |atom: Atom| BStr::new(scan.atoms.bytes(atom));
        let exported: Vec<&BStr> = exports.iter().map(|it| text_of(it.exported)).collect();
        let local: Vec<&BStr> = exports.iter().map(|it| text_of(it.local)).collect();
        assert_eq!(
            exported,
            ["B", "C", "E", "N", "a", "b", "d", "overloaded", "z"]
        );
        assert_eq!(
            local,
            ["y", "C", "E", "N", "a", "b", "d", "overloaded", "z"]
        );
        for export in &exports {
            assert!(matches!(export.binding, Binding::Symbol(_)), "{export:?}");
        }
    });
}

#[test]
fn types_ambient_declarations_and_exports_of_other_modules_are_no_module_value() {
    let types = r#"
        export interface Shape {}
        export type Alias = number;
        export type { Shape as Renamed };
        export declare const ambient: number;
        export declare function declared(): void;
        export namespace OnlyTypes { export type Member = number; }
        probe();
    "#;
    let ambient_declaration = "export declare const a: number;";
    let exports_of_other_modules = r#"
        export { a } from "./other";
        export * as all from "./other";
        export * from "./other";
    "#;
    let no_exports = "const a = 1;\nprobe(a);";
    for text in [
        types,
        ambient_declaration,
        exports_of_other_modules,
        no_exports,
    ] {
        assert_eq!(find_module_value(text), ModuleValue::Nothing, "{text}");
    }
}
