use super::*;
use crate::compile::testing::{default_settings, with_bind_input};
use crate::ir::run_serially;
use crate::modules::bind_modules;

// The lines of `main.ts` on which the parameters of a function begin that is left out, in order.
fn find_lines_left_out(main: &str) -> Vec<String> {
    with_bind_input(&[("main.ts", main)], &default_settings(), |bind_input| {
        let graph = bind_modules(bind_input).graph;
        assert!(graph.errors().is_empty(), "the program links");
        let input = ProgramReachInput {
            files: bind_input.files,
            sources: bind_input.sources,
            graph: &graph,
            known_helpers: bind_input.known_helpers,
            removable: RemovableOptions::default(),
            any_file_is_named_at_run_time: false,
            code_on_disk_names_files: false,
            isolates_code_from_disk: false,
            mocks_any_module: false,
            files_started_by_runner: &[],
            starts_of_workers: &[],
            beside: bind_input.beside,
        };
        let (left_out, _) = find_left_out_code(&input, &run_serially);
        let functions = left_out.functions.iter();
        let mut positions: Vec<usize> = functions
            .map(|it| input.files.hir(it.file)[it.function].anchor as usize)
            .collect();
        positions.sort_unstable();
        let line_at = |position: usize| {
            let start = main[..position].rfind('\n').map_or(0, |end| end + 1);
            let end = main[position..]
                .find('\n')
                .map_or(main.len(), |end| position + end);
            main[start..end].trim().to_owned()
        };
        positions.into_iter().map(line_at).collect()
    })
}

#[test]
fn function_in_a_function_waits_for_a_reference() {
    let left_out = find_lines_left_out(
        "function outer() {
            function inner() { return 1; }
            function other() { return deeper(); }
            const deeper = () => 2;
            return inner();
        }
        console.log(outer());",
    );
    assert_eq!(
        left_out,
        [
            "function other() { return deeper(); }",
            "const deeper = () => 2;"
        ]
    );
}

#[test]
fn function_that_goes_somewhere_as_a_value_stays_with_the_code_around_it() {
    let left_out = find_lines_left_out(
        "function outer(list: number[]) {
            return list.map(function (item) { return item + 1; });
        }
        console.log(outer([1]));",
    );
    assert!(left_out.is_empty(), "{left_out:?}");
}

#[test]
fn what_a_namespace_exports_stays_with_the_namespace() {
    let left_out = find_lines_left_out(
        "namespace Zoo {
            export function paintZebra() { return 1; }
            export class Llama {
                constructor() { console.log(2); }
            }
            function feedYak() { return 3; }
        }
        enum Kind { Wild }
        namespace Kind {
            export function washLlama() { return 4; }
        }
        console.log(Zoo.paintZebra(), new Zoo.Llama(), Kind.washLlama());",
    );
    assert_eq!(left_out, ["function feedYak() { return 3; }"]);
}

#[test]
fn member_under_a_name_stays_with_its_class() {
    let left_out = find_lines_left_out(
        "class Zoo {
            paintZebra() { return 1; }
            get sizeOfHerd() { return 2; }
            set sizeOfHerd(size: number) { console.log(size); }
            static washLlama() { return 3; }
            static get nameOfZoo() { return 'zoo'; }
        }
        console.log(JSON.stringify(new Zoo(), process.argv));",
    );
    assert!(left_out.is_empty(), "{left_out:?}");
}

#[test]
fn class_that_nothing_gets_hold_of_takes_its_members_along() {
    let left_out = find_lines_left_out(
        "export function make(zoo: { paintZebra(): number }) {
            class Zoo {
                paintZebra() { return 1; }
            }
            return zoo.paintZebra();
        }",
    );
    assert_eq!(left_out, ["paintZebra() { return 1; }"]);
}

#[test]
fn function_that_becomes_a_property_stays_with_the_code_around_it() {
    for main in [
        "const zoo = {
            paintZebra() { return 1; },
            washLlama: () => 2,
        };
        console.log(zoo.paintZebra());",
        "export function make() {
            return {
                washLlama() { return 2; },
            };
        }",
        "class Zoo {
            static keepers = {
                washLlama() { return 2; },
            };
        }
        console.log(Zoo);",
        "const routes: any = {};
        routes['/hello'] = function () { return new Response('hi'); };
        Bun.serve({ routes });",
        "class Routes {
            '/hello' = () => new Response('hi');
        }
        Bun.serve({ routes: new Routes() as any });",
        "function Zoo() {}
        Zoo.prototype.washLlama = function () { return 2; };
        console.log(new (Zoo as any)());",
    ] {
        let left_out = find_lines_left_out(main);
        assert!(left_out.is_empty(), "{left_out:?}");
    }
}

#[test]
fn private_method_waits_for_a_reference() {
    let left_out = find_lines_left_out(
        "class Zoo {
            #paint() { return 1; }
            #wash() { return 2; }
            paintZebra() { return this.#paint(); }
        }
        console.log(new Zoo().paintZebra());",
    );
    assert_eq!(left_out, ["#wash() { return 2; }"]);
}

#[test]
fn class_that_is_only_compared_with_keeps_no_constructor() {
    let left_out = find_lines_left_out(
        "export function make() {
            class Zoo {
                constructor() { console.log(1); }
            }
            return (value: unknown) => value instanceof Zoo;
        }",
    );
    assert_eq!(left_out, ["constructor() { console.log(1); }"]);
}

#[test]
fn extended_class_waits_for_somebody_who_gets_hold_of_the_extending_one() {
    let source = |last: &str| {
        format!(
            "export function make() {{
                class Animal {{
                    constructor() {{ console.log(1); }}
                }}
                class Zebra extends Animal {{}}
                return {last};
            }}"
        )
    };
    let left_out = find_lines_left_out(&source("(value: unknown) => value instanceof Zebra"));
    assert_eq!(left_out, ["constructor() { console.log(1); }"]);
    let left_out = find_lines_left_out(&source("new Zebra()"));
    assert!(left_out.is_empty(), "{left_out:?}");
}

#[test]
fn variable_that_a_function_in_a_function_names_stays_with_the_outer_function() {
    let main = "const table = [1, 2];
        function outer() {
            function other() { return table; }
            return 1;
        }
        console.log(outer());";
    with_bind_input(&[("main.ts", main)], &default_settings(), |bind_input| {
        let graph = bind_modules(bind_input).graph;
        let input = ProgramReachInput {
            files: bind_input.files,
            sources: bind_input.sources,
            graph: &graph,
            known_helpers: bind_input.known_helpers,
            removable: RemovableOptions::default(),
            any_file_is_named_at_run_time: false,
            code_on_disk_names_files: false,
            isolates_code_from_disk: false,
            mocks_any_module: false,
            files_started_by_runner: &[],
            starts_of_workers: &[],
            beside: bind_input.beside,
        };
        let (left_out, _) = find_left_out_code(&input, &run_serially);
        assert_eq!(left_out.functions.len(), 1);
        let file = left_out.functions.iter().next().expect("one").file;
        let declarations = &left_out.declarations;
        assert!(!declarations.is_declarator_left_out(file, VarDeclId(0)));
    });
}

// The names of the files that are left out, in order.
fn find_files_left_out(files: &[(&str, &str)]) -> Vec<String> {
    with_bind_input(files, &default_settings(), |bind_input| {
        let graph = bind_modules(bind_input).graph;
        assert!(graph.errors().is_empty(), "the program links");
        let input = ProgramReachInput {
            files: bind_input.files,
            sources: bind_input.sources,
            graph: &graph,
            known_helpers: bind_input.known_helpers,
            removable: RemovableOptions::default(),
            any_file_is_named_at_run_time: false,
            code_on_disk_names_files: false,
            isolates_code_from_disk: false,
            mocks_any_module: false,
            files_started_by_runner: &[],
            starts_of_workers: &[],
            beside: bind_input.beside,
        };
        let (left_out, _) = find_left_out_code(&input, &run_serially);
        let names = left_out.files.iter().map(|&file| {
            let name = input.files.module(file).file_name();
            let name = name.rsplit(|&byte| byte == b'/').next().expect("a name");
            String::from_utf8_lossy(name).into_owned()
        });
        names.collect()
    })
}

// `import()` in `never` is what brings the two files into the program.
#[test]
fn text_spells_a_file_for_a_load_by_an_unknown_name_where_it_is_reached() {
    let files = [
        (
            "main.ts",
            "import { used } from './holder';
            function load(name: string) { return require(name); }
            console.log(used(), load(process.argv[2]));",
        ),
        (
            "holder.ts",
            "export function used() { return './kept'; }
            export function never() { return ['./spelled', import('./spelled'), import('./kept')]; }",
        ),
        ("spelled.ts", "export const a = 1;"),
        ("kept.ts", "export const b = 2;"),
    ];
    assert_eq!(find_files_left_out(&files), ["spelled.ts"]);
}
