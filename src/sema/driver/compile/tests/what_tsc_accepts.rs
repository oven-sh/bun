use super::check::codes_beside_declarations;
use super::support::{
    BringsBunTypes, PROJECT, check_only, project_disk, with_host, with_look_for_type_errors,
};

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

fn codes_beside_brought(of_project: &str, brought: &str, main: &str) -> Vec<u32> {
    let folder = format!("{}/bun", BringsBunTypes::TYPE_ROOT);
    let manifest = format!("{folder}/package.json");
    let declarations = format!("{folder}/index.d.ts");
    let files = [
        ("main.ts", main),
        ("first.d.ts", of_project),
        (
            &manifest[..],
            "{ \"name\": \"@types/bun\", \"version\": \"1.0.0\", \"types\": \"index.d.ts\" }",
        ),
        (&declarations[..], brought),
    ];
    let disk = project_disk(&files, 1);
    let mut codes = Vec::new();
    with_host(&BringsBunTypes(&disk), PROJECT, "./main.ts", |program| {
        codes = check_only(program).codes();
    });
    codes
}

#[test]
fn a_member_that_the_brought_declarations_add_to_a_name_is_asked_last_and_stops_nothing() {
    let of_project =
        "declare function parse(text: string): number;\ninterface Meta { url: string }\n";
    let brought = "declare namespace parse { function strictly(text: string): number; }\n\
                   interface Meta { dirname: string }\n";
    let main = "function own(text: string): number { return 1; }\n\
                function wrong(text: number): number { return text; }\n\
                function take(given: typeof parse) {}\n\
                take(own);\n\
                take(wrong);\n\
                export const meta: Meta = { url: \"a\" };\n\
                export const lacks: Meta = {};\n\
                declare const made: { url: number };\n\
                export const other: Meta = made;\n\
                class Kept implements Meta { url = \"a\"; }\n\
                class Lost implements Meta { url = 1; }\n\
                export const all = [new Kept(), new Lost()];\n";
    assert_eq!(
        codes_beside_brought(of_project, brought, main),
        [2345, 2739, 2322, 2416]
    );
}

#[test]
fn a_declaration_of_the_program_is_held_against_no_brought_declaration() {
    let declared = "interface ImportMeta { dirname: string; main: boolean }\n\
                    declare var exports: any;\n\
                    interface Dict<T> { [key: string]: T | undefined }\n\
                    interface Settings extends Dict<string> {}\n\
                    interface Pair<A> { a: A }\n";
    let main = "declare global {\n\
                interface ImportMeta { readonly dirname: string; main?: boolean }\n\
                var exports: { made: number };\n\
                interface Settings { port: number }\n\
                interface Pair<A, B> { b: B }\n\
                }\nexport {};\n";
    let installed = codes_beside_declarations(true, declared, main, "");
    assert_eq!(installed, [2687, 2687, 2717, 2403, 2411, 2428]);
    assert_eq!(codes_beside_declarations(false, declared, main, ""), [0; 0]);

    let main = "declare global {\n\
                interface ImportMeta { dirname: string; main: boolean }\n\
                interface ImportMeta { dirname: number; readonly main: boolean }\n\
                interface Pair<A> { c: A }\n\
                interface Pair<A, B> { b: B }\n\
                }\nexport {};\n";
    let brought = codes_beside_declarations(false, declared, main, "");
    assert_eq!(brought, [2717, 2687, 2428, 2428]);
}

#[test]
fn a_merge_with_a_brought_declaration_that_is_refused_stops_nothing() {
    let declared = "declare var process: { argv: string[] };\n\
                    declare var Buffer: { size: number };\n\
                    interface Timer { id: number }\n";
    let main = "declare global {\n\
                const process: { readonly argv: readonly string[] };\n\
                enum Buffer { Small }\n\
                type Timer = number;\n\
                const made: number;\n\
                const made: string;\n\
                }\nexport {};\n";
    let installed = codes_beside_declarations(true, declared, main, "");
    assert_eq!(installed, [2451, 2567, 2300, 2451, 2451]);
    assert_eq!(
        codes_beside_declarations(false, declared, main, ""),
        [2451, 2451]
    );
}
