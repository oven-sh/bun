mod support;
use support::*;

use Mode::{Classic, Development, Production};

const PATH: &str = "/project/main.jsx";
const KEY_AFTER_SPREAD: &str = "<a {...p} key=\"k\" />;";

#[derive(Copy, Clone, Debug)]
enum Mode {
    Classic,
    Production,
    Development,
}

fn jsx_mode(w: &Workspace<'_>, mode: Mode) -> JsxMode {
    match mode {
        Classic => JsxMode::Classic,
        Production => w.automatic_jsx(false),
        Development => w.automatic_jsx(true),
    }
}

fn with_file(text: &str, mode: Mode, test: impl for<'s> FnOnce(&Analyzed<'s>, JsxMode) + Send) {
    with_workspace(|w| {
        let jsx = jsx_mode(w, mode);
        let source = Source {
            jsx,
            reads_jsdoc: false,
            ..Source::new(PATH, text)
        };
        let s = w.analyze(&source, &w.fold_inputs(&Fold::NONE));
        assert!(!s.hir.has_errors, "syntax error in: {text}");
        test(&s, jsx);
    });
}

fn with_element(text: &str, test: impl for<'s> FnOnce(&File<'s>, JsxId) + Send) {
    with_file(text, Classic, |s, _| {
        assert_eq!(s.hir.jsx.len(), 1, "one element is expected in: {text}");
        test(&s.hir, JsxId(0));
    });
}

fn callee_of(text: &str, mode: Mode) -> JsxCallee {
    let mut callee = JsxCallee::Factory;
    with_file(text, mode, |s, jsx| {
        assert_eq!(s.hir.jsx.len(), 1, "one element is expected in: {text}");
        callee = jsx_callee(&s.hir, jsx, JsxId(0));
    });
    callee
}

fn imports_of(text: &str, mode: Mode) -> Vec<JsxImport> {
    let mut imports = Vec::new();
    with_file(text, mode, |s, _| {
        imports.extend(s.analysis.jsx_imports.iter())
    });
    imports
}

fn key_position(text: &str) -> (Option<usize>, bool) {
    let mut position = (None, false);
    with_element(text, |hir, jsx| {
        let found = find_key_attribute(hir, jsx);
        let index = found
            .key
            .and_then(|key| hir[jsx].attrs.iter().position(|attribute| attribute == key));
        position = (index, found.is_after_spread);
    });
    position
}

fn child_count(text: &str) -> usize {
    let mut count = 0;
    with_element(text, |hir, jsx| count = jsx_children(hir, jsx).count());
    count
}

fn site_specifiers(text: &str, mode: Mode) -> Vec<(ImportSiteKind, String)> {
    let mut sites = Vec::new();
    with_file(text, mode, |s, _| {
        for site in s.analysis.import_sites {
            let ImportSpecifier::Constant(specifier) = site.specifier else {
                panic!("{text}: {:?}", site.specifier);
            };
            sites.push((site.kind, s.workspace.text(specifier).to_owned()));
        }
    });
    sites
}

fn jsx_site(kind: ImportSiteKind, specifier: &str) -> (ImportSiteKind, String) {
    (kind, specifier.to_owned())
}

#[test]
fn imports_name_module_and_export() {
    let described: Vec<(ImportSiteKind, &[u8])> = JsxImport::ALL
        .into_iter()
        .map(|import| (import.site_kind(), import.export_name()))
        .collect();
    let expected: [(ImportSiteKind, &[u8]); 5] = [
        (ImportSiteKind::JsxRuntime, b"jsx"),
        (ImportSiteKind::JsxRuntime, b"jsxs"),
        (ImportSiteKind::JsxRuntime, b"jsxDEV"),
        (ImportSiteKind::JsxRuntime, b"Fragment"),
        (ImportSiteKind::JsxPackage, b"createElement"),
    ];
    assert_eq!(described, expected);
}

#[test]
fn set_iterates_in_declaration_order() {
    let mut set = JsxImportSet::default();
    assert!(set.is_empty());
    set.insert(JsxImport::CreateElement);
    set.insert(JsxImport::Jsx);
    set.insert(JsxImport::Fragment);
    set.insert(JsxImport::Jsx);
    assert!(!set.is_empty());
    assert!(set.contains(JsxImport::Fragment));
    assert!(!set.contains(JsxImport::Jsxs));
    let listed: Vec<JsxImport> = set.iter().collect();
    let expected = [
        JsxImport::Jsx,
        JsxImport::Fragment,
        JsxImport::CreateElement,
    ];
    assert_eq!(listed, expected);
}

#[test]
fn classic_runtime_calls_factory() {
    assert_eq!(callee_of("<a />;", Classic), JsxCallee::Factory);
    let after_spread = "<a {...p} key=\"k\">x{y}</a>;";
    assert_eq!(callee_of(after_spread, Classic), JsxCallee::Factory);
}

#[test]
fn production_callee_follows_children() {
    let jsx = JsxCallee::Import(JsxImport::Jsx);
    let jsxs = JsxCallee::Import(JsxImport::Jsxs);
    assert_eq!(callee_of("<a />;", Production), jsx);
    assert_eq!(callee_of("<a>x</a>;", Production), jsx);
    assert_eq!(callee_of("<a>{y}</a>;", Production), jsx);
    assert_eq!(callee_of("<a>x{y}</a>;", Production), jsxs);
    assert_eq!(callee_of("<>{x}{y}</>;", Production), jsxs);
}

#[test]
fn single_spread_child_is_static() {
    let jsxs = JsxCallee::Import(JsxImport::Jsxs);
    assert_eq!(callee_of("<a>{...c}</a>;", Production), jsxs);
}

#[test]
fn development_callee_ignores_children() {
    let jsx_dev = JsxCallee::Import(JsxImport::JsxDev);
    assert_eq!(callee_of("<a />;", Development), jsx_dev);
    assert_eq!(callee_of("<a>x{y}</a>;", Development), jsx_dev);
}

#[test]
fn key_after_spread_calls_create_element() {
    let create_element = JsxCallee::Import(JsxImport::CreateElement);
    assert_eq!(callee_of(KEY_AFTER_SPREAD, Production), create_element);
    assert_eq!(callee_of(KEY_AFTER_SPREAD, Development), create_element);
}

#[test]
fn key_before_spread_stays_automatic() {
    let text = "<a key=\"k\" {...p} />;";
    let jsx = JsxCallee::Import(JsxImport::Jsx);
    assert_eq!(callee_of(text, Production), jsx);
    assert_eq!(key_position(text), (Some(0), false));
}

#[test]
fn last_key_counts() {
    assert_eq!(
        key_position("<a key=\"1\" b key=\"2\" />;"),
        (Some(2), false)
    );
    let around_spread = "<a key=\"1\" {...p} key=\"2\" />;";
    assert_eq!(key_position(around_spread), (Some(2), true));
}

#[test]
fn other_attributes_are_not_keys() {
    assert_eq!(
        key_position("<a b=\"1\" keys=\"2\" {...p} />;"),
        (None, false)
    );
}

#[test]
fn key_without_value_is_ignored() {
    with_element("<a {...p} key b />;", |hir, jsx| {
        let found = find_key_attribute(hir, jsx);
        assert_eq!(found.key, None);
        assert!(!found.is_after_spread);
        let ignored: Vec<bool> = hir[jsx]
            .attrs
            .iter()
            .map(|attribute| is_ignored_key(hir, attribute))
            .collect();
        assert_eq!(ignored, [false, true, false]);
    });
    let jsx = JsxCallee::Import(JsxImport::Jsx);
    assert_eq!(callee_of("<a {...p} key />;", Production), jsx);
}

#[test]
fn key_with_value_is_not_ignored() {
    with_element("<a key=\"k\" />;", |hir, jsx| {
        assert!(!is_ignored_key(hir, hir[jsx].attrs.at(0)));
    });
}

#[test]
fn empty_expression_is_no_child() {
    assert_eq!(child_count("<a>{}</a>;"), 0);
    assert_eq!(child_count("<a>{/* c */}</a>;"), 0);
    assert_eq!(child_count("<a>{}{y}{}</a>;"), 1);
    let jsx = JsxCallee::Import(JsxImport::Jsx);
    assert_eq!(callee_of("<a>{}{y}{}</a>;", Production), jsx);
}

#[test]
fn blank_lines_are_no_children() {
    assert_eq!(child_count("<a>\n  {x}\n  {y}\n</a>;"), 2);
}

#[test]
fn collects_imports_of_every_live_element() {
    let text = "<><a>x{y}</a><b /><c {...p} key=\"k\" /></>;";
    let production = [
        JsxImport::Jsx,
        JsxImport::Jsxs,
        JsxImport::Fragment,
        JsxImport::CreateElement,
    ];
    assert_eq!(imports_of(text, Production), production);
    let development = [
        JsxImport::JsxDev,
        JsxImport::Fragment,
        JsxImport::CreateElement,
    ];
    assert_eq!(imports_of(text, Development), development);
}

#[test]
fn dead_element_adds_no_import() {
    let text = "if (false) { <><a>x{y}</a></>; } <b />;";
    assert_eq!(imports_of(text, Production), [JsxImport::Jsx]);
    assert!(imports_of("if (false) { <a />; }", Production).is_empty());
}

#[test]
fn file_without_elements_has_no_import() {
    assert!(imports_of("f();", Production).is_empty());
}

#[test]
fn classic_runtime_has_no_import() {
    assert!(imports_of("<><a {...p} key=\"k\" /></>;", Classic).is_empty());
}

#[test]
fn sites_of_live_elements() {
    let text = r#"import a from "./a"; a; require("./b"); <b />;"#;
    for (mode, runtime) in [
        (Production, "react/jsx-runtime"),
        (Development, "react/jsx-dev-runtime"),
    ] {
        let sites = site_specifiers(text, mode);
        let specifiers: Vec<&str> = sites.iter().map(|site| site.1.as_str()).collect();
        assert_eq!(specifiers, [runtime, "./a", "./b"], "{mode:?}");
        assert_eq!(sites[0].0, ImportSiteKind::JsxRuntime, "{mode:?}");
        assert_eq!(sites[1].0, ImportSiteKind::Import(ImportId(0)), "{mode:?}");
        assert!(matches!(sites[2].0, ImportSiteKind::Require(_)), "{mode:?}");
    }
    with_file(text, Production, |s, _| {
        let site = s.analysis.import_sites[0];
        assert_eq!(site.specifier_node, ExprId::NONE);
        assert_eq!(site.attributes, ExprId::NONE);
        assert!(site.consults_resolver);
        assert!(!site.is_host_value);
    });
}

#[test]
fn files_without_live_elements_have_no_jsx_site() {
    assert!(site_specifiers("<a />;", Classic).is_empty());
    assert!(site_specifiers(KEY_AFTER_SPREAD, Classic).is_empty());
    assert!(site_specifiers("f();", Production).is_empty());
    assert!(site_specifiers("if (false) { <a />; }", Production).is_empty());
    assert!(site_specifiers("false && <a {...p} key=\"k\" />;", Production).is_empty());
}

#[test]
fn package_site_only_for_create_element() {
    let runtime = jsx_site(ImportSiteKind::JsxRuntime, "react/jsx-runtime");
    let package = jsx_site(ImportSiteKind::JsxPackage, "react");
    assert_eq!(site_specifiers("<a />;", Production), [runtime.clone()]);
    assert_eq!(
        site_specifiers("<><a /></>;", Production),
        [runtime.clone()]
    );
    assert_eq!(
        site_specifiers(KEY_AFTER_SPREAD, Production),
        [package.clone()]
    );
    let both = "<><a {...p} key=\"k\" /></>;";
    assert_eq!(site_specifiers(both, Production), [runtime, package]);
}

#[test]
fn sites_are_found_by_kind() {
    let text = r#"import a from "./a"; a; <><a {...p} key="k" /></>;"#;
    with_file(text, Production, |s, _| {
        let index_of = |kind| s.analysis.import_site_index(kind);
        assert_eq!(index_of(ImportSiteKind::JsxRuntime), Some(0));
        assert_eq!(index_of(ImportSiteKind::JsxPackage), Some(1));
        assert_eq!(index_of(ImportSiteKind::Import(ImportId(0))), Some(2));
    });
    with_file("<a />; require(\"./b\");", Production, |s, _| {
        let index_of = |kind| s.analysis.import_site_index(kind);
        assert_eq!(index_of(ImportSiteKind::JsxRuntime), Some(0));
        assert_eq!(index_of(ImportSiteKind::JsxPackage), None);
        let ImportSiteKind::Require(call) = s.analysis.import_sites[1].kind else {
            panic!("{:?}", s.analysis.import_sites[1].kind);
        };
        assert_eq!(s.analysis.import_site_of_call(call), Some(1));
    });
    with_file("<a />;", Classic, |s, _| {
        assert_eq!(
            s.analysis.import_site_index(ImportSiteKind::JsxRuntime),
            None
        );
    });
}
