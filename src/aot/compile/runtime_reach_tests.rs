use super::testing::{BUNDLED_LIBS, TestProject, default_settings, run_build, with_bound_build};
use crate::builtins::RuntimeModule;
use crate::load::source_provider::WithoutServices;

const LIBRARY: &str = "/$bun/js/node/punycode.ts";

fn reaches_node_dgram(program: &str, library: &[(&str, &str)]) -> bool {
    let mut files = vec![("a.js", program)];
    files.extend_from_slice(library);
    let project = TestProject::new(&files, &default_settings());
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            build.check_and_lower(loaded, bound);
            let sources = &loaded.projects.runtime.sources;
            let file = sources.runtime_module_file(RuntimeModule::NodeDgram);
            let file = file.expect("what a function of a loaded module requires is loaded");
            build.unreached_runtime_files.binary_search(&file).is_err()
        })
    })
}

const DECODE: &str = "function decode() { return require(\"node:dgram\"); }\n";

#[test]
fn import_of_the_module_reaches_every_export() {
    let library =
        format!("{DECODE}function encode() {{ return 1; }}\nexport default {{ encode, decode }};");
    let program = "import punycode from \"node:punycode\";\nconsole.log(punycode);";
    assert!(reaches_node_dgram(program, &[(LIBRARY, library.as_str())]));
    let program = "import { encode } from \"node:punycode\";\nconsole.log(encode);";
    assert!(!reaches_node_dgram(program, &[(LIBRARY, library.as_str())]));
}

#[test]
fn name_exported_again_reaches_no_other_export() {
    let library =
        format!("{DECODE}function encode() {{ return 1; }}\nexport default {{ encode, decode }};");
    let library = [(LIBRARY, library.as_str())];
    let reaches = |exports: &str| {
        let mut files = vec![("b.js", exports)];
        files.extend_from_slice(&library);
        reaches_node_dgram("import * as b from \"./b.js\";\nconsole.log(b);", &files)
    };
    assert!(!reaches("export { encode } from \"node:punycode\";"));
    assert!(!reaches(
        "export { encode as other } from \"node:punycode\";"
    ));
    assert!(reaches("export { decode } from \"node:punycode\";"));
    assert!(reaches(
        "export { encode as decode, decode as encode } from \"node:punycode\";"
    ));
    assert!(reaches("export { default } from \"node:punycode\";"));
    assert!(reaches(
        "export { default as encode } from \"node:punycode\";"
    ));
    assert!(reaches("export * from \"node:punycode\";"));
    assert!(reaches("export * as encode from \"node:punycode\";"));
}

#[test]
fn imported_name_that_holds_no_function_of_the_module_reaches_no_other_export() {
    let library = format!(
        "{DECODE}const native = {{ encode() {{ return 1; }} }};\n\
         const encode = native.encode.bind(native);\n\
         const ucs2 = {{}};\n\
         export default {{ encode, decode, ucs2, version: \"1\" }};"
    );
    for name in ["encode", "ucs2", "version"] {
        let program = format!("import {{ {name} }} from \"node:punycode\";\nconsole.log({name});");
        assert!(
            !reaches_node_dgram(&program, &[(LIBRARY, library.as_str())]),
            "{name}"
        );
    }
    let spread =
        format!("{DECODE}const rest = {{ encode: 1 }};\nexport default {{ decode, ...rest }};");
    let program = "import { encode } from \"node:punycode\";\nconsole.log(encode);";
    assert!(reaches_node_dgram(program, &[(LIBRARY, spread.as_str())]));
}

#[test]
fn function_handed_to_a_helper_that_only_defines_a_property_of_it_is_not_entered() {
    let program = "import { encode } from \"node:punycode\";\nconsole.log(encode);";
    for define in ["Object.defineProperty", "Object.$defineProperty"] {
        let library = format!(
            "{DECODE}function encode() {{ return 1; }}\n\
             function setName(fn, value) {{ {define}(fn, \"name\", {{ value }}); }}\n\
             setName(encode, \"encode\");\n\
             setName(decode, \"decode\");\n\
             export default {{ encode, decode }};"
        );
        assert!(
            !reaches_node_dgram(program, &[(LIBRARY, library.as_str())]),
            "{define}"
        );
    }
    let keeps = format!(
        "{DECODE}function encode() {{ return 1; }}\n\
         const kept = [];\n\
         function keep(fn) {{ kept.push(fn); }}\n\
         keep(decode);\n\
         export default {{ encode, decode }};"
    );
    assert!(reaches_node_dgram(program, &[(LIBRARY, keeps.as_str())]));
}

#[test]
fn pattern_over_a_name_that_holds_a_module_reads_its_keys() {
    let library =
        format!("{DECODE}function encode() {{ return 1; }}\nexport default {{ encode, decode }};");
    let reaches_through = |reader: &str| {
        let reader = format!("{reader}\nexport default {{ EOL: encode }};");
        let files = [
            (LIBRARY, library.as_str()),
            ("/$bun/js/node/os.ts", reader.as_str()),
        ];
        reaches_node_dgram("import \"node:os\";", &files)
    };
    assert!(!reaches_through(
        "const { encode } = require(\"node:punycode\");"
    ));
    assert!(!reaches_through(
        "const held = require(\"node:punycode\");\nconst { encode } = held;"
    ));
    assert!(!reaches_through(
        "const held = require(\"node:punycode\");\nconst { encode: { length: encode } } = held;"
    ));
    assert!(reaches_through(
        "const held = require(\"node:punycode\");\nconst { encode, ...rest } = held;"
    ));
    assert!(reaches_through(
        "const held = require(\"node:punycode\");\nconst other = held, encode = other.encode;"
    ));
}

#[test]
fn file_that_is_left_out_and_imports_only_files_asks_for_nothing() {
    let manifest = r#"{ "name": "tools", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }"#;
    let package = [
        ("node_modules/tools/package.json", manifest),
        (
            "node_modules/tools/index.js",
            "export { used } from \"./used.js\";\nexport { unused } from \"./unused.js\";\n",
        ),
        ("node_modules/tools/used.js", "export const used = 1;\n"),
        (
            "node_modules/tools/unused.js",
            "export const unused = message => process.send(message);\n",
        ),
    ];
    let program = "import { used } from \"tools\";\nconsole.log(used);";
    assert!(!reaches_node_dgram(program, &package));
    let program = "import { unused } from \"tools\";\nconsole.log(unused);";
    assert!(reaches_node_dgram(program, &package));
}

#[test]
fn file_that_is_left_out_still_hands_on_a_name_of_a_module_of_bun() {
    let library =
        format!("{DECODE}function encode() {{ return 1; }}\nexport default {{ encode, decode }};");
    let manifest = r#"{ "name": "tools", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }"#;
    let files = [
        (LIBRARY, library.as_str()),
        ("node_modules/tools/package.json", manifest),
        (
            "node_modules/tools/index.js",
            "export { decode } from \"node:punycode\";\n",
        ),
    ];
    let program = "import { decode } from \"tools\";\nconsole.log(decode);";
    assert!(reaches_node_dgram(program, &files));
}

#[test]
fn computed_load_in_a_file_that_is_left_out_finds_no_module() {
    let library =
        format!("{DECODE}function encode() {{ return 1; }}\nexport default {{ encode, decode }};");
    let manifest = r#"{ "name": "tools", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }"#;
    let files = [
        (LIBRARY, library.as_str()),
        ("node_modules/tools/package.json", manifest),
        (
            "node_modules/tools/index.js",
            "export { used } from \"./used.js\";\nexport { unused } from \"./unused.js\";\n",
        ),
        ("node_modules/tools/used.js", "export const used = 1;\n"),
        (
            "node_modules/tools/unused.js",
            "export const unused = name => require(name);\n",
        ),
    ];
    let reaches = |name: &str| {
        let program = format!(
            "import {{ {name} }} from \"tools\";\nimport {{ encode }} from \"node:punycode\";\nconsole.log({name}, encode);"
        );
        reaches_node_dgram(&program, &files)
    };
    assert!(!reaches("used"));
    assert!(reaches("unused"));
}

#[test]
fn load_whose_every_name_is_written_finds_the_modules_of_those_names_alone() {
    let library =
        format!("{DECODE}function encode() {{ return 1; }}\nexport default {{ encode, decode }};");
    let reaches = |name: &str| {
        let program = format!(
            "import {{ encode }} from \"node:punycode\";\nconst load = name => import(name);\nconsole.log(encode, load({name}));"
        );
        reaches_node_dgram(&program, &[(LIBRARY, library.as_str())])
    };
    assert!(!reaches("\"node:os\""));
    assert!(reaches("\"node:punycode\""));
    assert!(reaches("process.argv[2]"));
}

#[test]
fn load_whose_name_can_only_be_a_path_finds_no_module_of_the_library() {
    let library =
        format!("{DECODE}function encode() {{ return 1; }}\nexport default {{ encode, decode }};");
    let reaches = |head: &str, name: &str| {
        let program = format!(
            "import {{ encode }} from \"node:punycode\";\n{head}\nconst name = process.argv[2];\nconsole.log(encode, import({name}));"
        );
        reaches_node_dgram(&program, &[(LIBRARY, library.as_str())])
    };
    assert!(!reaches("", "\"./\" + name"));
    assert!(!reaches(
        "import path from \"node:path\";",
        "path.resolve(name)"
    ));
    assert!(reaches("", "\"node:\" + name"));
    assert!(reaches(
        "Bun.plugin({ name: \"p\", setup() {} });",
        "\"./\" + name"
    ));
}

fn count_lowered_files_of_bun(source: &str) -> usize {
    let mut project = TestProject::new(&[("a.js", source)], &default_settings());
    project.keeps_library_code_without_names = true;
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        with_bound_build(build, |build, loaded, bound| {
            let units = build.check_and_lower(loaded, bound);
            units.len()
                - loaded
                    .projects
                    .application
                    .loaded
                    .files()
                    .compiled_files()
                    .len()
        })
    })
}

#[test]
fn one_name_of_the_file_system_module_lowers_little_of_bun() {
    let baseline_file_count = count_lowered_files_of_bun("console.log(1);\nexport {};\n");
    let module_file_count =
        count_lowered_files_of_bun("import fs from \"node:fs\";\nconsole.log(fs);\n");
    assert!(
        module_file_count > baseline_file_count + 50,
        "{module_file_count} files for the module, {baseline_file_count} without an import"
    );
    for name in ["existsSync", "readFileSync", "constants"] {
        let source = format!("import {{ {name} }} from \"node:fs\";\nconsole.log({name});\n");
        let name_file_count = count_lowered_files_of_bun(&source);
        assert!(
            name_file_count < baseline_file_count + 15,
            "{name_file_count} files for {name}, {baseline_file_count} without an import"
        );
    }
}
