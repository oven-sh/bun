use super::*;
use crate::module_format::ModuleFormat;
use crate::program::code_test_host::TEXT_LOADER;
use crate::resolve::CodeOptions;

const INSTALLED: &str = "/p/node_modules/pkg/index.js";
const TYPED: &str = "/p/node_modules/pkg/typed.ts";
const DECLARATION: &str = "/p/node_modules/pkg/index.d.ts";
const TYPED_TEXT: &str = "import type t from \"m\"\na\nb";

type FileTexts = &'static [(&'static str, &'static str)];

fn typed_host(files: FileTexts) -> StatementsHost {
    StatementsHost {
        typed_versions: &[(INSTALLED, TYPED)],
        ..host_of(files)
    }
}

fn assert_has_no_typed_version(parsed: &ParsedCodeFile<'_, '_>) {
    assert!(!parsed.parse.hir.is_typed_version);
    let analyzed = &parsed.code.analyzed;
    assert_eq!(analyzed.typed_source_path, None);
    assert_eq!(analyzed.rejected_typed_version, None);
    assert_eq!(analyzed.typed_version_origin, None);
}

fn rejection_by(host: &StatementsHost, typed_path: &str) -> (ErasureMismatchKind, (u32, u32)) {
    with_context(host, |context| {
        let parsed = load(context, INSTALLED);
        assert!(!parsed.parse.hir.is_typed_version);
        assert_eq!(FileRole::of_tree(&parsed.parse.hir), FileRole::Inferred);
        let analyzed = &parsed.code.analyzed;
        assert_eq!(analyzed.typed_source_path, None);
        assert_eq!(
            analyzed.typed_version_origin,
            Some(TypedVersionOrigin::Host)
        );
        let rejected = analyzed.rejected_typed_version;
        let rejected = rejected.expect("the full types are rejected");
        assert_eq!(rejected.path, typed_path.as_bytes());
        (rejected.kind, rejected.installed_range)
    })
}

fn rejection(files: FileTexts) -> (ErasureMismatchKind, (u32, u32)) {
    rejection_by(&typed_host(files), TYPED)
}

#[test]
fn exact_typed_version_replaces_installed_tree() {
    let host = typed_host(&[(INSTALLED, "a\nb"), (TYPED, TYPED_TEXT)]);
    with_context(&host, |context| {
        let parsed = load(context, INSTALLED);
        let hir = &parsed.parse.hir;
        assert!(hir.is_typed_version);
        assert!(!hir.is_js);
        assert_eq!(FileRole::of_tree(hir), FileRole::Checked);
        assert_eq!(hir.text[..], *TYPED_TEXT.as_bytes());
        assert_eq!(hir.imports.len(), 1);
        let analyzed = &parsed.code.analyzed;
        assert_eq!(analyzed.typed_source_path, Some(TYPED.as_bytes()));
        assert_eq!(analyzed.rejected_typed_version, None);
        assert_eq!(
            analyzed.typed_version_origin,
            Some(TypedVersionOrigin::Host)
        );
        assert!(analyzed.analysis.import_sites.is_empty());
    });
}

#[test]
fn accepted_tree_keeps_own_payload() {
    let host = typed_host(&[(INSTALLED, "a\nb"), (TYPED, TYPED_TEXT)]);
    with_context(&host, |context| {
        let parsed = load(context, INSTALLED);
        assert_eq!(
            *downcast_payload(&parsed.payload),
            parse_payload(TYPED, false)
        );
    });
    assert_eq!(parsed_paths(&host), [TYPED, INSTALLED]);
}

#[test]
fn rejected_typed_version_leaves_payload_of_installed_tree() {
    let host = typed_host(&[(INSTALLED, "a"), (TYPED, "b")]);
    with_context(&host, |context| {
        let parsed = load(context, INSTALLED);
        assert_eq!(
            *downcast_payload(&parsed.payload),
            parse_payload(INSTALLED, true)
        );
        assert_eq!(parsed.parse.hir.text[..], *b"a");
    });
    assert_eq!(parsed_paths(&host), [TYPED, INSTALLED, INSTALLED]);
}

#[test]
fn mismatch_is_reported_at_installed_node() {
    use ErasureMismatchKind::{ChildCount, Name, NodeKind};
    let first_name = rejection(&[(INSTALLED, "a\nbb\nc"), (TYPED, "wide\nx\nc")]);
    assert_eq!(first_name, (Name, (0, 1)));
    let second_name = rejection(&[(INSTALLED, "a\nbb\nc"), (TYPED, "a\nx\nc")]);
    assert_eq!(second_name, (Name, (2, 4)));
    let last_name = rejection(&[(INSTALLED, "a\nbb\nc"), (TYPED, "a\nbb\ncc")]);
    assert_eq!(last_name, (Name, (5, 6)));
    let missing_statement = rejection(&[(INSTALLED, "a\nb"), (TYPED, "a")]);
    assert_eq!(missing_statement, (ChildCount, (0, 0)));
    let other_statement = rejection(&[(INSTALLED, "a\nb"), (TYPED, "a\nimport \"m\"")]);
    assert_eq!(other_statement, (NodeKind, (2, 3)));
    let property_name = rejection(&[
        (INSTALLED, "f(\"s\", { a: \"x\" })"),
        (TYPED, "f(\"s\", { b: \"x\" })"),
    ]);
    assert_eq!(property_name, (Name, (9, 9)));
}

#[test]
fn syntax_error_in_either_file_rejects_typed_version() {
    let expected = (ErasureMismatchKind::NodeKind, (0, 0));
    assert_eq!(rejection(&[(INSTALLED, "a"), (TYPED, "a\n1bad")]), expected);
    assert_eq!(rejection(&[(INSTALLED, "a\n1bad"), (TYPED, "a")]), expected);
    assert_eq!(rejection(&[(INSTALLED, "1bad"), (TYPED, "1bad")]), expected);
}

#[test]
fn declaration_file_is_rejected_as_typed_version() {
    let host = StatementsHost {
        typed_versions: &[(INSTALLED, DECLARATION)],
        ..host_of(&[(INSTALLED, "a"), (DECLARATION, "a")])
    };
    let rejected = rejection_by(&host, DECLARATION);
    assert_eq!(rejected, (ErasureMismatchKind::NodeKind, (0, 0)));
}

#[test]
fn file_with_other_loader_has_no_typed_version() {
    let host = typed_host(&[(INSTALLED, "a"), (TYPED, "a")]);
    with_context(&host, |context| {
        assert_has_no_typed_version(&load_with_loader(context, INSTALLED, TEXT_LOADER));
    });
    assert_eq!(parsed_paths(&host), [INSTALLED]);
}

#[test]
fn typescript_file_has_no_typed_version() {
    let host = StatementsHost {
        typed_versions: &[("/p/a.ts", TYPED)],
        ..host_of(&[("/p/a.ts", "a"), (TYPED, "a")])
    };
    with_context(&host, |context| {
        assert_has_no_typed_version(&load(context, "/p/a.ts"));
    });
    assert_eq!(parsed_paths(&host), ["/p/a.ts"]);
}

#[test]
fn build_without_typed_condition_has_no_typed_version() {
    let host = typed_host(&[(INSTALLED, "a"), (TYPED, "a")]);
    let build = TestBuild {
        code: CodeOptions {
            typed_condition: None,
            ..CodeOptions::bun_run(b"/")
        },
        ..TestBuild::new(&host, &[])
    };
    with_compile_context(&build, |context| {
        assert_has_no_typed_version(&load(context, INSTALLED));
    });
    assert_eq!(parsed_paths(&host), [INSTALLED]);
}

#[test]
fn deferred_typed_text_counts_as_no_typed_version() {
    let host = StatementsHost {
        deferred: &[(TYPED, ScriptKind::Ts)],
        ..typed_host(&[(INSTALLED, "a"), (TYPED, "a")])
    };
    with_context(&host, |context| {
        assert_has_no_typed_version(&load(context, INSTALLED));
    });
    assert_eq!(parsed_paths(&host), [INSTALLED]);
}

#[test]
fn file_unknown_to_host_has_no_typed_version() {
    let host = typed_host(&[("/p/node_modules/pkg/other.js", "a"), (TYPED, "a")]);
    with_context(&host, |context| {
        let parsed = load(context, "/p/node_modules/pkg/other.js");
        assert_has_no_typed_version(&parsed);
        assert_eq!(FileRole::of_tree(&parsed.parse.hir), FileRole::Inferred);
    });
}

#[test]
fn typed_version_keeps_unused_imports() {
    const TEXT: &str = "import m from \"m\"\na";
    let host = typed_host(&[(INSTALLED, TEXT), (TYPED, TEXT), ("/p/plain.ts", TEXT)]);
    with_context(&host, |context| {
        let typed = load(context, INSTALLED);
        assert!(typed.parse.hir.is_typed_version);
        let analysis = &typed.code.analyzed.analysis;
        assert_eq!(analysis.import_sites.len(), 1);
        assert!(analysis.unused_import_symbols.is_empty());

        let plain = load(context, "/p/plain.ts");
        let analysis = &plain.code.analyzed.analysis;
        assert!(analysis.import_sites.is_empty());
        assert_eq!(analysis.unused_import_symbols.len(), 1);
    });
}

#[test]
fn type_only_import_adds_no_esm_syntax_to_typed_version() {
    const INSTALLED_COMMON_JS: &str = "/p/node_modules/pkg/index.cjs";
    const TYPED_COMMON_JS: &str = "/p/node_modules/pkg/typed.cts";
    const TEXT: &str = "import type t from \"m\"\na";
    let host = StatementsHost {
        typed_versions: &[(INSTALLED_COMMON_JS, TYPED_COMMON_JS)],
        ..host_of(&[
            (INSTALLED_COMMON_JS, "a"),
            (TYPED_COMMON_JS, TEXT),
            ("/p/plain.cts", TEXT),
        ])
    };
    with_context(&host, |context| {
        let typed = load(context, INSTALLED_COMMON_JS);
        assert!(typed.parse.hir.is_typed_version);
        assert_eq!(
            typed.code.analyzed.analysis.module_format,
            ModuleFormat::CommonJs
        );

        let plain = load(context, "/p/plain.cts");
        assert_eq!(
            plain.code.analyzed.analysis.module_format,
            ModuleFormat::Esm
        );
    });
}

#[test]
fn replacement_after_stack_overflow_stays_typed_version() {
    let host = typed_host(&[(INSTALLED, "a\nb"), (TYPED, TYPED_TEXT)]);
    with_context(&host, |context| {
        let arena = context.session.arena();
        let key = LoadKey {
            path: INSTALLED.as_bytes(),
            loader: HostLoader::default(),
        };
        let settings = context.resolver.transpile_settings(key.path);
        let mut tree = accept_tree(context, arena, key, settings, Cow::Borrowed(b"a\nb"));
        assert!(!tree.hir.body.is_empty());
        tree.replace_after_stack_overflow(context, arena);
        let hir = &tree.hir;
        assert!(hir.body.is_empty());
        assert!(hir.is_typed_version);
        assert!(hir.has_module_syntax);
        assert!(hir.ran_out_of_stack && hir.has_errors && hir.has_parse_diagnostics);
        assert_eq!(hir.source_len as usize, TYPED_TEXT.len());
        assert_eq!(FileRole::of_tree(hir), FileRole::Checked);
        assert_eq!(
            *downcast_payload(&tree.payload),
            parse_payload(TYPED, false)
        );
    });
    assert_eq!(parsed_paths(&host), [TYPED, INSTALLED, TYPED]);
}
