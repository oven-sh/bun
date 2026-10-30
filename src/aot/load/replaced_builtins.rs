//! A test run that is compiled in several builds has to know, before the first of them, which members of built-in objects its files replace.
//! This reads one file by itself: what it imports from other files names nothing, what it imports from Bun does.

use std::borrow::Cow;

use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, Binding, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::{FoldInputs, FoldOptions};
use bun_sema::hir::{ExprId, ExprKind};
use bun_sema::import_sites::{ImportSiteKind, ImportSpecifier, JsxMode};
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use crate::builtins::{
    BuiltinNames, ImportTargets, ResolveInput, RuntimeModule, SourceDialect, resolve_file, table,
};
use crate::load::host_platform;

// A name of a member is short.
const MAX_FOLDED_STRING_BYTES: usize = 256;

#[derive(Default)]
pub struct FoundInFile {
    /// `LoadOptions::replaced_builtins` as far as the file spells them.
    pub members: Vec<u32>,
    /// The files beside it that it names, as it writes them: `import "./helper"`, `require("../stubs.js")`, `new URL("./worker.ts", import.meta.url)`.
    pub files_named: Vec<Vec<u8>>,
}

pub fn find_in_file(path: &[u8], text: &[u8]) -> Vec<u32> {
    look_at_file(path, text).members
}

fn is_relative(specifier: &[u8]) -> bool {
    specifier.starts_with(b"./") || specifier.starts_with(b"../")
}

/// Nothing for a file with a syntax error: its build says so.
pub fn look_at_file(path: &[u8], text: &[u8]) -> FoundInFile {
    let session = Session::new();
    let (arena, atoms) = (session.arena(), Interner::new_in(&session));
    let names = BuiltinNames::new(&atoms);
    let parse_options = CompileParseOptions {
        path,
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        keeps_function_directives: false,
    };
    let mut hir = parse_for_compile(arena, &parse_options, text, &atoms);
    if hir.has_errors {
        return FoundInFile::default();
    }
    hir.text = Cow::Borrowed(text);
    let fold_options = FoldOptions {
        max_string_bytes: MAX_FOLDED_STRING_BYTES,
        ..FoldOptions::default()
    };
    let fold = FoldInputs::new(fold_options, arena);
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let file = FileInputs {
        declared_module_type: match path.ends_with(b".cjs") || path.ends_with(b".cts") {
            true => DeclaredModuleType::CommonJs,
            false => DeclaredModuleType::Unknown,
        },
        import_meta_main: None,
        is_library: false,
        host_values: &[],
        jsx: JsxMode::Classic,
    };
    let (bound, analysis) = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
    let module_of = |specifier: ImportSpecifier| match specifier {
        ImportSpecifier::Constant(text) => match atoms.bytes(text) {
            b"@jest/globals" | b"vitest" => Some(RuntimeModule::BunTest),
            text => table::module_by_specifier(text),
        },
        ImportSpecifier::Pattern { .. } | ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => {
            None
        }
    };
    let sites = analysis.import_sites.iter();
    let mut targets: Vec<(ImportSiteKind, Option<RuntimeModule>)> = sites
        .map(|site| (site.kind, module_of(site.specifier)))
        .collect();
    targets.sort_unstable_by_key(|target| target.0);
    let resolved = resolve_file(&ResolveInput {
        hir: &hir,
        bound: &bound,
        decisions: &analysis.decisions,
        module_format: analysis.module_format,
        targets: &ImportTargets::new(&targets),
        names: &names,
        platform: host_platform(),
        dialect: SourceDialect::Program,
        replaced: &[],
        finds_replaced_members: true,
    });
    let imported = analysis
        .import_sites
        .iter()
        .filter_map(|site| match site.specifier {
            ImportSpecifier::Constant(text) => Some(text),
            _ => None,
        });
    let urls = (0..hir.exprs.len() as u32).map(ExprId).filter_map(|expr| {
        let ExprKind::New(call) = hir[expr].kind else {
            return None;
        };
        let call = hir[call];
        let ExprKind::Ident(callee) = hir[call.callee].kind else {
            return None;
        };
        let is_global_url =
            atoms.bytes(callee) == b"URL" && bound.binding(call.callee) == Binding::Free;
        match hir[hir.ids(call.args).next()?].kind {
            ExprKind::String(text) if is_global_url => Some(text),
            _ => None,
        }
    });
    let files_named = imported.chain(urls).map(|text| atoms.bytes(text));
    FoundInFile {
        members: (resolved.replaced_members().iter())
            .map(|&member| member as u32)
            .collect(),
        files_named: (files_named.filter(|text| is_relative(text)))
            .map(<[u8]>::to_vec)
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::BuiltinId;

    fn find(text: &str) -> Vec<BuiltinId> {
        let numbers = find_in_file(b"/project/a.test.ts", text.as_bytes());
        numbers
            .into_iter()
            .map(|number| BuiltinId::from_wire(number).expect("it is in the table"))
            .collect()
    }

    #[test]
    fn finds_spies_stores_definitions_and_deletions() {
        let found = find(
            r#"
            import { spyOn, jest } from "bun:test";
            import { vi } from "vitest";
            spyOn(String.prototype, "indexOf");
            jest.spyOn(Map.prototype, "get");
            vi.spyOn(Promise, "race");
            Array.from = () => [];
            Object.defineProperty(Array.prototype, "includes", { value() {} });
            Reflect.set(Buffer, "concat", () => {});
            delete (Atomics as any).store;
            "#,
        );
        let mut expected = vec![
            BuiltinId::StringPrototypeIndexOf,
            BuiltinId::MapPrototypeGet,
            BuiltinId::PromiseRace,
            BuiltinId::ArrayFrom,
            BuiltinId::ArrayPrototypeIncludes,
            BuiltinId::BufferConcat,
            BuiltinId::AtomicsStore,
        ];
        expected.sort_unstable();
        assert_eq!(found, expected);
    }

    #[test]
    fn decides_by_binding() {
        let shadowed = r#"
            import { spyOn } from "bun:test";
            const String = { prototype: { indexOf() {} } };
            spyOn(String.prototype, "indexOf");
            String.prototype.indexOf = () => {};
            "#;
        assert_eq!(find(shadowed), []);
        let renamed = r#"
            import { spyOn as watch } from "bun:test";
            const texts = String.prototype;
            const name = "normalize";
            watch(texts, name);
            "#;
        assert_eq!(find(renamed), [BuiltinId::StringPrototypeNormalize]);
    }

    #[test]
    fn takes_an_object_beside_the_name_of_its_member() {
        let text = r#"
            import { stub } from "./my-stubs";
            stub(Array.prototype, "join");
            const rows = [[Map.prototype, "get"], ["keys", Object]];
            const row = { holder: Reflect, key: "has", other: "join" };
            stub(Array.prototype, "mine", "get");
            Object.getOwnPropertyDescriptor(String.prototype, "indexOf");
            console.log(Promise, "race");
            "#;
        let mut expected = vec![
            BuiltinId::ArrayPrototypeJoin,
            BuiltinId::MapPrototypeGet,
            // Every object of a table meets every name of it.
            BuiltinId::MapPrototypeKeys,
            BuiltinId::ObjectKeys,
            BuiltinId::ReflectHas,
        ];
        expected.sort_unstable();
        assert_eq!(find(text), expected);
    }

    #[test]
    fn lists_the_files_beside_it_that_it_names() {
        let text = r#"
            import "./a";
            import { b } from "../b.js";
            import "bun:test";
            import "package";
            const c = require("./c.cjs")(b);
            const d = await import("./d.ts");
            new Worker(new URL("./worker.ts", import.meta.url));
            "#;
        let mut found = look_at_file(b"/project/a.test.ts", text.as_bytes()).files_named;
        found.sort_unstable();
        let expected: [&[u8]; 5] = [b"../b.js", b"./a", b"./c.cjs", b"./d.ts", b"./worker.ts"];
        assert_eq!(found, expected);
    }

    #[test]
    fn passes_by_new_names_and_members_that_are_open() {
        let text = r#"
            Array.prototype.last = function () {};
            Date.now = () => 0;
            JSON.parse = () => 0;
            "#;
        assert_eq!(find(text), []);
    }
}
