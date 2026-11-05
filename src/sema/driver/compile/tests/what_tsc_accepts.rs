use super::support::{check_only, with_look_for_type_errors};

#[test]
fn a_script_of_the_project_declares_the_modules_that_it_names() {
    let list = "class List<T> {\n  first?: T;\n}\n";
    let shapes = "declare module \"shapes\" {\n  class Square {}\n}\n";
    let drawings = "declare module \"drawings\" {\n  import shapes = require(\"shapes\");\n  export var squares: List<shapes.Square>;\n}\n";
    let cases: [(String, &[u32]); 3] = [
        (format!("{list}{shapes}{drawings}"), &[]),
        (format!("{list}{drawings}"), &[2307]),
        (
            format!("{list}{shapes}{drawings}export {{}};\n"),
            &[2664, 2664, 2307],
        ),
    ];
    for (text, codes) in cases {
        with_look_for_type_errors(&[("main.ts", &text[..])], &["./main.ts"], |program| {
            assert_eq!(check_only(program).codes(), codes, "{text}");
        });
    }
}

#[test]
fn another_file_imports_the_module_that_a_script_of_the_project_declares() {
    let files = [
        (
            "main.ts",
            "import \"./declares\";\nimport { side } from \"shapes\";\nexport const twice: number = side;\n",
        ),
        (
            "declares.ts",
            "class Kept {}\nnew Kept();\ndeclare module \"shapes\" {\n  const side: number;\n}\n",
        ),
    ];
    with_look_for_type_errors(&files, &["./main.ts"], |program| {
        assert_eq!(check_only(program).codes(), [0; 0]);
    });
}

#[test]
fn what_is_required_out_of_a_data_file_is_its_value() {
    let cases: [(&str, &[u32]); 3] = [
        (
            "import list = require(\"./list.json\");\nexport const nothing: null = list;\n",
            &[],
        ),
        (
            "import list = require(\"./list.json\");\nexport const count: number = list;\n",
            &[2322],
        ),
        (
            "import * as all from \"./list.json\";\nexport const nothing: null = all.default;\n",
            &[],
        ),
    ];
    for (text, codes) in cases {
        let files = [("main.ts", text), ("list.json", "[1, 2]\n")];
        with_look_for_type_errors(&files, &["./main.ts"], |program| {
            assert_eq!(check_only(program).codes(), codes, "{text}");
        });
    }
}
