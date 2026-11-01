use super::testing::with_loaded_test_run_of_project;
use crate::load::ProjectId;
use crate::load::sources::parsed_source;

const LOADER: &str = "node_modules/tool/lib/transform.js";

const TEST_FILE: (&str, &str) = (
    "tests/tool.test.ts",
    "import { test } from 'bun:test';\nimport { transform } from 'tool';\nimport { name } from '../src/product';\ntest(name, () => { transform('a', ['plugin']); });\n",
);
const MANIFEST: (&str, &str) = ("package.json", r#"{ "name": "project", "type": "module" }"#);
const PRODUCT: (&str, &str) = ("src/product.ts", "export const name: string = 'product';\n");
const TOOL: [(&str, &str); 3] = [
    (
        "node_modules/tool/package.json",
        r#"{ "name": "tool", "version": "1.0.0", "main": "index.js" }"#,
    ),
    (
        "node_modules/tool/index.js",
        "'use strict';\nmodule.exports = require('./lib/transform.js');\n",
    ),
    (
        LOADER,
        "'use strict';\nexports.transform = (text, plugins) => plugins.reduce((it, name) => require(name)(it), text);\n",
    ),
];
const WRAPPER: [(&str, &str); 2] = [
    (
        "node_modules/wrapper/package.json",
        r#"{ "name": "wrapper", "version": "1.0.0", "main": "index.js" }"#,
    ),
    (
        "node_modules/wrapper/index.js",
        "'use strict';\nexports.tool = require('tool');\n",
    ),
];

/// The project above with `changed` laid over it. True if the file of the package that writes `require(name)` may load code from disk.
fn tool_may_load(changed: &[(&str, &str)]) -> bool {
    let mut files = vec![TEST_FILE, MANIFEST, PRODUCT];
    files.extend(TOOL);
    for &(name, text) in changed {
        match files.iter_mut().find(|it| it.0 == name) {
            Some(file) => file.1 = text,
            None => files.push((name, text)),
        }
    }
    files.retain(|it| !it.1.is_empty());
    may_load(&files)
}

fn may_load(files: &[(&str, &str)]) -> bool {
    with_loaded_test_run_of_project(files, |_, loaded| {
        let files = loaded.project(ProjectId::Application).loaded.files();
        let is_of_tests = |name: &str| {
            let file = files.by_path.get(format!("/project/{name}").as_bytes());
            let file = file.unwrap_or_else(|| panic!("{name} is in the program"));
            parsed_source(files, file).is_some_and(|it| it.is_of_tests())
        };
        // Nothing else of the package asks to leave, and it stays as it is.
        assert!(!is_of_tests("node_modules/tool/index.js"));
        is_of_tests(LOADER)
    })
}

#[test]
fn a_package_that_only_the_tests_reach_loads_by_a_computed_name() {
    assert!(tool_may_load(&[]));
}

#[test]
fn a_package_that_the_product_reaches_finds_compiled_files_only() {
    let imports = |what: &str| format!("{what}\nexport const name: string = 'product';\n");
    assert!(!tool_may_load(&[(PRODUCT.0, &imports("import 'tool';"))]));
    let through_another = [
        WRAPPER[0],
        WRAPPER[1],
        (PRODUCT.0, &imports("import 'wrapper';")),
    ];
    assert!(!tool_may_load(&through_another));
    assert!(!tool_may_load(&[
        (
            "node_modules/tool/lib/version.js",
            "exports.version = '1.0.0';\n"
        ),
        (PRODUCT.0, &imports("import 'tool/lib/version.js';")),
    ]));
    // A package.json of its own lies in each half of a package that is published in two formats.
    assert!(!tool_may_load(&[
        (
            "node_modules/tool/esm/package.json",
            r#"{ "type": "module" }"#
        ),
        (
            "node_modules/tool/esm/version.js",
            "export const version = '1.0.0';\n"
        ),
        (PRODUCT.0, &imports("import 'tool/esm/version.js';")),
    ]));
}

#[test]
fn a_file_that_its_folder_alone_makes_the_tests_own_counts_as_the_product() {
    let helper = "export { transform } from 'tool';\n";
    let through_helper = TEST_FILE.1.replace("from 'tool'", "from './helper'");
    assert!(!tool_may_load(&[
        ("tests/helper.ts", helper),
        (TEST_FILE.0, &through_helper),
    ]));
    let of_runner =
        format!("import {{ mock }} from 'bun:test';\nexport const made = mock(() => 1);\n{helper}");
    assert!(tool_may_load(&[
        ("tests/helper.ts", &of_runner),
        (TEST_FILE.0, &through_helper),
    ]));
    // `tests/product.ts` lies beside the test file as `src/app.ts` lies beside `src/app.test.ts`.
    assert!(!tool_may_load(&[
        (
            "tests/product.ts",
            "import 'tool';\nexport const name: string = 'product';\n"
        ),
        (
            TEST_FILE.0,
            &TEST_FILE.1.replace("../src/product", "./product")
        ),
    ]));
}

#[test]
fn what_the_project_declares_that_it_needs_when_it_runs_is_the_products() {
    let manifest = |fields: &str| format!(r#"{{ "name": "project", "type": "module", {fields} }}"#);
    let with = |fields: &str| tool_may_load(&[(MANIFEST.0, &manifest(fields))]);
    assert!(!with(r#""dependencies": { "tool": "1.0.0" }"#));
    assert!(!with(r#""optionalDependencies": { "tool": "1.0.0" }"#));
    assert!(!with(
        r#""dependencies": { "tool": "1.0.0" }, "devDependencies": { "tool": "1.0.0" }"#
    ));
    assert!(with(r#""devDependencies": { "tool": "1.0.0" }"#));
    assert!(tool_may_load(&[(MANIFEST.0, "")]));
    let uses_wrapper = format!("import 'wrapper';\n{}", TEST_FILE.1);
    assert!(!tool_may_load(&[
        WRAPPER[0],
        WRAPPER[1],
        (TEST_FILE.0, &uses_wrapper),
        (
            MANIFEST.0,
            &manifest(r#""peerDependencies": { "wrapper": "1.0.0" }"#)
        ),
    ]));
}

#[test]
fn in_a_workspace_the_nearest_manifest_counts_and_the_roots() {
    let with = |root: &str, member: &str| {
        let root = format!(r#"{{ "name": "root", "workspaces": ["packages/*"]{root} }}"#);
        let member = format!(r#"{{ "name": "member", "type": "module"{member} }}"#);
        let mut files = vec![
            ("packages/member/tests/tool.test.ts", TEST_FILE.1),
            ("packages/member/src/product.ts", PRODUCT.1),
            ("packages/member/package.json", &member[..]),
            ("package.json", &root[..]),
        ];
        files.extend(TOOL);
        may_load(&files)
    };
    assert!(!with("", r#", "dependencies": { "tool": "1.0.0" }"#));
    assert!(!with(r#", "dependencies": { "tool": "1.0.0" }"#, ""));
    assert!(with(r#", "devDependencies": { "tool": "1.0.0" }"#, ""));
}
