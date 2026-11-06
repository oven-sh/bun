use super::testing::{BUNDLED_LIBS, TestProject, default_settings, run_build, with_bound_build};
use crate::builtins::RuntimeModule;
use crate::load::source_provider::WithoutServices;

// A module of the test's stands in the place of `node:punycode`. Its `decode` alone loads `node:dgram`.
const LIBRARY: &str = "/$bun/js/node/punycode.ts";

fn reaches_decode(program: &str, library: &[(&str, &str)]) -> bool {
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
    assert!(reaches_decode(program, &[(LIBRARY, library.as_str())]));
    let program = "import { encode } from \"node:punycode\";\nconsole.log(encode);";
    assert!(!reaches_decode(program, &[(LIBRARY, library.as_str())]));
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
            !reaches_decode(&program, &[(LIBRARY, library.as_str())]),
            "{name}"
        );
    }
    let spread =
        format!("{DECODE}const rest = {{ encode: 1 }};\nexport default {{ decode, ...rest }};");
    let program = "import { encode } from \"node:punycode\";\nconsole.log(encode);";
    assert!(reaches_decode(program, &[(LIBRARY, spread.as_str())]));
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
            !reaches_decode(program, &[(LIBRARY, library.as_str())]),
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
    assert!(reaches_decode(program, &[(LIBRARY, keeps.as_str())]));
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
        reaches_decode("import \"node:os\";", &files)
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

fn count_lowered_files_of_bun(source: &str) -> usize {
    let project = TestProject::new(&[("a.js", source)], &default_settings());
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
    let of_nothing = count_lowered_files_of_bun("console.log(1);\nexport {};\n");
    let of_module = count_lowered_files_of_bun("import fs from \"node:fs\";\nconsole.log(fs);\n");
    assert!(
        of_module > of_nothing + 50,
        "{of_module} files for the module, {of_nothing} for nothing"
    );
    for name in ["existsSync", "readFileSync", "constants"] {
        let source = format!("import {{ {name} }} from \"node:fs\";\nconsole.log({name});\n");
        let of_name = count_lowered_files_of_bun(&source);
        assert!(
            of_name < of_nothing + 15,
            "{of_name} files for {name}, {of_nothing} for nothing"
        );
    }
}
