use std::borrow::Cow;

use bun_paths::resolve_path::basename;
use bun_sema::atom::Interner;
use bun_sema::bind::{BindOptions, RuntimeBindOptions};
use bun_sema::file_analysis::{FileInputs, analyze_file};
use bun_sema::fold::FoldOptions;
use bun_sema::hir::{FileKind, find_transpiled_mark};
use bun_sema::import_sites::JsxMode;
use bun_sema::module_format::DeclaredModuleType;
use bun_sema::resolve::{ScriptKind, is_declaration_file_name};
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use crate::builtins::table::{self, BuiltinId, BuiltinName, MemberLookup, Mutability, Scope};
use crate::load::fold_inputs::create_application_fold_inputs;
use crate::load::host_platform;
use crate::load::test_runner_names::{MODULE_OF_VITEST, imports};

pub(crate) fn imports_vitest(path: &[u8], text: &[u8]) -> bool {
    if find_transpiled_mark(text).is_some() {
        return false;
    }
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let has_declaration_file_name = is_declaration_file_name(path);
    let parse_options = CompileParseOptions {
        path,
        script_kind: has_declaration_file_name.then_some(ScriptKind::Ts),
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        ignores_pure_comments: false,
    };
    let mut hir = parse_for_compile(arena, &parse_options, text, &atoms);
    if hir.has_errors
        || hir.ran_out_of_stack
        || matches!(hir.kind, FileKind::Json | FileKind::Declaration)
        || (has_declaration_file_name && (hir.ids(hir.body).len() == 0 || hir.only_declares()))
    {
        return false;
    }
    hir.text = Cow::Borrowed(text);
    let runs_in_place = true;
    let fold = create_application_fold_inputs(
        &FoldOptions::default(),
        arena,
        &atoms,
        host_platform(),
        runs_in_place,
    );
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
        own_name: arena.alloc_slice_copy(basename(path)),
    };
    let (_, analysis) = analyze_file(&mut hir, bind_options, &fold, file, &atoms, arena);
    imports(analysis.import_sites, &hir, &atoms, |module| {
        module == MODULE_OF_VITEST
    })
}

fn find_locked_member_of(holder: BuiltinId, name: BuiltinName) -> Option<BuiltinId> {
    let MemberLookup::Found(member) = table::member(holder, name) else {
        return None;
    };
    let entry = table::entry(member);
    let is_own = entry.holder.map(table::canonical_id) == Some(holder);
    (is_own && entry.mutability != Mutability::ChangesOnItsOwn && entry.scope == Scope::Realm)
        .then_some(member)
}

fn find_locked_member_of_global(global: &[u8], name: &[u8]) -> Option<BuiltinId> {
    let holder = table::global(table::find_name(global)?)?;
    find_locked_member_of(table::canonical_id(holder), table::find_name(name)?)
}

pub(crate) fn lists_laid_anew_between_test_files() -> Vec<u32> {
    let holders = [&b"process"[..], b"Bun"].into_iter();
    let lists = holders.filter_map(|holder| find_locked_member_of_global(holder, b"argv"));
    let mut lists: Vec<u32> = lists.map(BuiltinId::to_wire).collect();
    lists.sort_unstable();
    lists
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_vitest_where_a_build_finds_it() {
        let rows = [
            ("a.test.ts", "import { test } from 'vitest'; test();", true),
            ("a.test.js", "import 'vitest';", true),
            ("a.test.js", "export * from 'vitest';", true),
            ("a.test.js", "await import('vitest');", true),
            ("a.test.cjs", "require('vitest');", true),
            ("a.test.cjs", "require('vi' + 'test');", true),
            ("a.test.js", "if (undefined) import('vitest');", false),
            ("a.test.ts", "import { vi } from 'vitest';", true),
            ("a.test.ts", "import vitest from 'vitest';", true),
            ("a.test.ts", "import * as vitest from 'vitest';", true),
            ("a.test.ts", "import type { Mock } from 'vitest';", false),
            ("a.test.ts", "import { type Mock } from 'vitest';", false),
            ("a.test.js", "import 'bun:test'; test('vitest');", false),
            ("a.test.js", "import 'vitest/config';", false),
            ("a.test.js", "vitest;", false),
            (
                "a.test.d.ts",
                "import { test } from 'vitest'; test();",
                true,
            ),
            (
                "types.d.ts",
                "import type { Mock } from 'vitest'; export type Spy = Mock;",
                false,
            ),
            ("data.json", "[\"vitest\"]", false),
            ("a.test.js", "// @bun\nimport 'vitest';", false),
            (
                "a.test.js",
                "#!/usr/bin/env bun\n// @bun\nimport 'vitest';",
                false,
            ),
            ("a.test.cjs", "// @bun @bun-cjs\nrequire('vitest');", false),
            ("a.test.js", "\n// @bun\nimport 'vitest';", true),
        ];
        for (name, text, expected) in rows {
            let path = format!("/project/{name}");
            let found = imports_vitest(path.as_bytes(), text.as_bytes());
            assert_eq!(found, expected, "{name}: {text}");
        }
    }

    #[test]
    fn names_the_lists_that_the_runner_lays_anew() {
        let mut expected = [BuiltinId::ProcessArgv as u32, BuiltinId::BunArgv as u32];
        expected.sort_unstable();
        assert_eq!(lists_laid_anew_between_test_files(), expected);
    }
}
