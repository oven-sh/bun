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
fn a_union_that_lost_members_has_a_map_of_its_tags_only_where_tsc_makes_one() {
    for (second, third, codes) in [("c", "\"a\" | \"b\"", &[2339][..]), ("k", "\"a\"", &[])] {
        let text = format!(
            "enum E {{ Zero, One }}
type C1 = {{ kind: \"c\"; c1: number }}; type C2 = {{ kind: \"{second}\"; c2: number }}; type AB = {{ kind: {third} }};
type D = {{ kind: \"d\" }}; type Ee = {{ kind: \"e\" }}; type N1 = {{ kind: 1; one: number }}; type NE = {{ kind: E.One; other: string }};
type F = {{ kind: \"f\" }}; type G = {{ kind: \"g\" }}; type H = {{ kind: \"h\" }}; type I = {{ kind: \"i\" }}; type J = {{ kind: \"j\" }};
type U = C1 | C2 | AB | D | Ee | N1 | NE | F | G | H | I | J;
function read(x: U): number {{
  if (x.kind === \"d\") return 0;
  if (x.kind === \"e\") return 0;
  if (x.kind === 1) return x.one;
  return -1;
}}
export const answer = read({{ kind: 1, one: 5 }});
"
        );
        with_look_for_type_errors(&[("main.ts", &text[..])], &["./main.ts"], |program| {
            assert_eq!(check_only(program).codes(), codes, "{text}");
        });
    }
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

#[test]
fn the_check_of_a_build_takes_a_script_of_the_project_for_a_module() {
    let files = [
        (
            "main.ts",
            "/// <reference path=\"./declared.d.ts\" />\nclass Held {\n  own = 1;\n}\nenum Level {\n  Own = 4,\n}\nfunction show(level: Level): string {\n  return level + \" \" + Level[level];\n}\nconst all = [new Held().own, new Held().declared, show(Level.Own), show(3)];\n",
        ),
        (
            "declared.d.ts",
            "interface Held {\n  declared?: number;\n}\ndeclare enum Level {\n  One = 1,\n  Three = 3,\n}\n",
        ),
    ];
    with_look_for_type_errors(&files, &["./main.ts"], |program| {
        assert_eq!(check_only(program).codes(), [2339, 2345]);
    });
}
