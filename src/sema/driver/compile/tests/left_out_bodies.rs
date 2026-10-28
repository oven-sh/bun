use super::support::{CheckedBuild, DEPENDENCY_MANIFEST, TestProgram, check_only, with_program};
use crate::{CompileRequest, check_and_lower, decide_roles};
use bun_sema::check::aot::{FunctionRef, LeftOutBodies};
use bun_sema::hir::FnId;
use bun_sema::program::FileId;

const REPORTS_UNUSED: &str = r#"{
    "compilerOptions": {
        "strict": true,
        "noLib": true,
        "types": [],
        "module": "preserve",
        "moduleResolution": "bundler",
        "noUnusedLocals": true,
        "noUnusedParameters": true,
        "noImplicitReturns": true
    }
}"#;

fn offset_of(program: &TestProgram<'_, '_>, file: FileId, text: &str) -> u32 {
    let source = &program.files().hir(file).text;
    let mut offsets = (0..source.len()).filter(|&at| source[at..].starts_with(text.as_bytes()));
    let offset = offsets
        .next()
        .unwrap_or_else(|| panic!("{text} is not in the file"));
    assert!(offsets.next().is_none(), "{text} is in the file twice");
    offset as u32
}

fn function_starting_with(program: &TestProgram<'_, '_>, path: &str, text: &str) -> FunctionRef {
    let file = program.file(path);
    let start = offset_of(program, file, text);
    let functions = program.files().hir(file).fns.iter();
    let index = functions
        .clone()
        .position(|function| function.start == start);
    FunctionRef {
        file,
        function: FnId(index.unwrap_or_else(|| panic!("no function starts with {text}")) as u32),
    }
}

fn check_without(
    files: &[(&str, &str)],
    left_out: &[(&str, &str)],
    then: impl FnOnce(&TestProgram<'_, '_>, CheckedBuild<()>),
) {
    with_program(files, &["./main.ts"], 1, |program| {
        let functions = left_out.iter();
        let functions = functions.map(|(path, text)| function_starting_with(program, path, text));
        let bodies = LeftOutBodies::new(functions);
        let request = CompileRequest {
            left_out_bodies: Some(&bodies),
            ..*program.request
        };
        let program = TestProgram {
            request: &request,
            ..*program
        };
        then(&program, check_only(&program));
    });
}

fn starts_of(build: &CheckedBuild<()>, code: u32) -> Vec<u32> {
    let reported = build.diagnostics().filter(|it| it.diagnostic.code == code);
    reported.map(|it| it.diagnostic.start).collect()
}

#[test]
fn error_in_left_out_body_is_not_reported() {
    let text = "export function kept() { const first: string = 1; return first; }
export function dropped() { const second: string = 2; return second; }
";
    check_without(
        &[("main.ts", text)],
        &[("main.ts", "export function dropped")],
        |program, build| {
            let first = offset_of(program, program.file("main.ts"), "first: string");
            assert_eq!(build.codes(), [2322]);
            assert_eq!(starts_of(&build, 2322), [first]);
        },
    );
}

#[test]
fn nothing_left_out_reports_every_body() {
    let text = "export function kept() { const first: string = 1; return first; }
export function dropped() { const second: string = 2; return second; }
";
    check_without(&[("main.ts", text)], &[], |_, build| {
        assert_eq!(build.codes(), [2322, 2322]);
    });
}

#[test]
fn every_kind_of_function_can_be_left_out() {
    let text = "export const arrow = () => { const a: string = 1; return a; };
export const expression = function () { const b: string = 2; return b; };
export class Holder {
    constructor() { const c: string = 3; }
    method() { const d: string = 4; return d; }
    get read() { const e: string = 5; return e; }
    set write(value: number) { const f: string = value; }
    static made() { const g: string = 7; return g; }
}
export const literal = {
    method() { const h: string = 8; return h; },
    get read() { const i: string = 9; return i; },
};
";
    let left_out = [
        "() => { const a",
        "function () { const b",
        "constructor() { const c",
        "method() { const d",
        "get read() { const e",
        "set write(value: number) { const f",
        "static made() { const g",
        "method() { const h",
        "get read() { const i",
    ];
    check_without(&[("main.ts", text)], &[], |_, build| {
        assert_eq!(build.codes(), [2322; 9]);
    });
    check_without(
        &[("main.ts", text)],
        &left_out.map(|text| ("main.ts", text)),
        |_, build| {
            assert_eq!(build.codes(), [0; 0]);
        },
    );
}

#[test]
fn function_in_left_out_function_is_not_checked() {
    let text = "export function dropped() {
    const inner = () => { const a: string = 1; return a; };
    class Local { method() { const b: string = 2; return b; } }
    return [inner, Local];
}
";
    check_without(
        &[("main.ts", text)],
        &[("main.ts", "export function dropped")],
        |_, build| {
            assert_eq!(build.codes(), [0; 0]);
        },
    );
}

#[test]
fn parameters_of_left_out_function_are_not_checked() {
    let text = "export function dropped(a: string = 1, { b }: { b: Missing } = { b: 2 }): Absent { return a + b; }
";
    check_without(
        &[("main.ts", text)],
        &[("main.ts", "export function dropped")],
        |_, build| {
            assert_eq!(build.codes(), [0; 0]);
        },
    );
}

#[test]
fn computed_name_of_left_out_method_is_checked() {
    let text = "export class Holder {
    [missing]() { const a: string = 1; return a; }
}
";
    check_without(
        &[("main.ts", text)],
        &[("main.ts", "[missing]() {")],
        |_, build| {
            assert_eq!(build.codes(), [2304]);
        },
    );
}

#[test]
fn member_in_file_with_decorators_is_checked() {
    let tsconfig = r#"{
    "compilerOptions": {
        "strict": true,
        "noLib": true,
        "types": [],
        "module": "preserve",
        "moduleResolution": "bundler",
        "experimentalDecorators": true
    }
}"#;
    let text = "export class Holder {
    method(@missing value: number) { const a: string = value; return a; }
}
export function dropped() { const b: string = 2; return b; }
";
    let files = [("tsconfig.json", tsconfig), ("main.ts", text)];
    let left_out = [
        ("main.ts", "method(@missing"),
        ("main.ts", "export function dropped"),
    ];
    check_without(&files, &left_out, |_, build| {
        assert_eq!(build.codes(), [2304, 2322]);
    });
}

#[test]
fn call_of_left_out_function_has_inferred_return_type() {
    let text = "function dropped() { return 1; }
type Returned<F> = F extends () => infer R ? R : never;
export const count: number = dropped();
export const text: string = dropped();
export const other: Returned<typeof dropped> = \"\";
";
    check_without(
        &[("main.ts", text)],
        &[("main.ts", "function dropped")],
        |program, build| {
            let file = program.file("main.ts");
            let expected = [
                offset_of(program, file, "text: string"),
                offset_of(program, file, "other: "),
            ];
            assert_eq!(starts_of(&build, 2322), expected);
            assert_eq!(build.codes().len(), 2);
        },
    );
}

#[test]
fn assertion_signature_of_left_out_function_narrows() {
    let text = "function dropped(value: unknown): asserts value is string { if (typeof value !== \"string\") throw value; }
export function kept(value: unknown): string { dropped(value); return value; }
";
    check_without(
        &[("main.ts", text)],
        &[("main.ts", "function dropped")],
        |_, build| {
            assert_eq!(build.codes(), [0; 0]);
        },
    );
}

#[test]
fn field_assigned_in_left_out_constructor_is_initialized() {
    let text = "class Base { constructor(readonly name: string) {} }
export class Derived extends Base {
    count: number;
    constructor() { super(\"\"); this.count = 1; }
}
export class Unassigned {
    count: number;
    constructor() {}
}
";
    let left_out = [
        ("main.ts", "constructor() { super"),
        ("main.ts", "constructor() {}"),
    ];
    check_without(&[("main.ts", text)], &left_out, |program, build| {
        let unassigned = offset_of(
            program,
            program.file("main.ts"),
            "count: number;\n    constructor() {}",
        );
        assert_eq!(build.codes(), [2564]);
        assert_eq!(starts_of(&build, 2564), [unassigned]);
    });
}

#[test]
fn what_only_left_out_body_uses_is_not_unused() {
    let main = "import { imported } from \"./other\";
const local = 1;
function helper() { return 2; }
type Shape = { a: number };
class Holder {
    private field = 3;
    #hidden = 4;
    private method() { return 5; }
    dropped() { return this.field + this.#hidden + this.method(); }
}
function dropped(unused: number) { const shape: Shape = { a: local + helper() + imported }; return shape; }
export { Holder };
";
    let files = [
        ("tsconfig.json", REPORTS_UNUSED),
        ("main.ts", main),
        ("other.ts", "export const imported = 6;\n"),
    ];
    let left_out = [
        ("main.ts", "dropped() { return this.field"),
        ("main.ts", "function dropped(unused"),
    ];
    check_without(&files, &left_out, |_, build| {
        assert_eq!(build.codes(), [0; 0]);
    });
}

#[test]
fn left_out_overload_implementation_is_an_implementation() {
    let text = "export function pick(value: string): string;
export function pick(value: number): number;
export function pick(value: unknown): unknown { const wrong: string = 1; return value ?? wrong; }
export class Holder {
    pick(value: string): string;
    pick(value: number): number;
    pick(value: unknown): unknown { const wrong: string = 2; return value ?? wrong; }
}
export const text: string = pick(\"\");
export const count: string = pick(1);
";
    let left_out = [
        ("main.ts", "export function pick(value: unknown)"),
        (
            "main.ts",
            "pick(value: unknown): unknown { const wrong: string = 2",
        ),
    ];
    check_without(&[("main.ts", text)], &left_out, |program, build| {
        let count = offset_of(program, program.file("main.ts"), "count: string");
        assert_eq!(build.codes(), [2322]);
        assert_eq!(starts_of(&build, 2322), [count]);
    });
}

#[test]
fn left_out_function_need_not_return() {
    let text = "export function dropped(flag: boolean): number { if (flag) { return 1; } }
export function inferred(flag: boolean) { if (flag) { return 1; } }
export class Holder { get read(): number { } }
";
    let files = [("tsconfig.json", REPORTS_UNUSED), ("main.ts", text)];
    let left_out = [
        ("main.ts", "export function dropped"),
        ("main.ts", "export function inferred"),
        ("main.ts", "get read(): number"),
    ];
    check_without(&files, &left_out, |_, build| {
        assert!(!build.codes().contains(&2366));
        assert!(!build.codes().contains(&7030));
        assert!(!build.codes().contains(&2355));
    });
}

#[test]
fn circular_type_of_left_out_accessor_is_not_asked_for() {
    let text = "export class Holder { get read() { return this.read; } }\n";
    check_without(&[("main.ts", text)], &[], |_, build| {
        assert_eq!(build.codes(), [7023]);
    });
    let left_out = [("main.ts", "get read()")];
    check_without(&[("main.ts", text)], &left_out, |_, build| {
        assert_eq!(build.codes(), [0; 0]);
    });
}

#[test]
fn expected_error_in_left_out_function_is_not_unused() {
    let text = "export function dropped() {
    // @ts-expect-error
    const wrong: string = 1;
    return wrong;
}
// @ts-expect-error
export function short(value: Missing) { return value; }
// @ts-expect-error
export const kept = 1;
";
    let left_out = [
        ("main.ts", "export function dropped"),
        ("main.ts", "export function short"),
    ];
    check_without(&[("main.ts", text)], &left_out, |program, build| {
        let file = program.file("main.ts");
        let unused = offset_of(program, file, "// @ts-expect-error\nexport const kept");
        assert_eq!(build.codes(), [2578]);
        assert_eq!(starts_of(&build, 2578), [unused]);
    });
}

#[test]
fn early_error_in_left_out_function_is_reported() {
    let text = "export function dropped() { let twice; let twice; }\n";
    check_without(
        &[("main.ts", text)],
        &[("main.ts", "export function dropped")],
        |_, build| {
            assert!(build.codes().contains(&2451));
        },
    );
}

fn check_without_file(
    files: &[(&str, &str)],
    left_out: &str,
    tells_checker: bool,
    then: impl FnOnce(&TestProgram<'_, '_>, CheckedBuild<()>),
) {
    with_program(files, &["./main.ts"], 1, |program| {
        let left_out = program.file(left_out);
        let bodies = LeftOutBodies::default().with_files([left_out]);
        let request = CompileRequest {
            left_out_bodies: tells_checker.then_some(&bodies),
            ..*program.request
        };
        let compiled_files = program.files().compiled_files();
        let (loaded, host) = (program.loaded, program.host);
        let roles = decide_roles(loaded, host, &request, compiled_files);
        let files_to_lower: Vec<FileId> = compiled_files
            .iter()
            .copied()
            .filter(|&file| file != left_out)
            .collect();
        let checked = check_and_lower(loaded, host, &request, &roles, &files_to_lower, &|_, _| {
            Some(())
        });
        let build = CheckedBuild {
            roles,
            program: checked,
        };
        then(program, build);
    });
}

#[test]
fn left_out_file_is_not_checked() {
    let files = [
        (
            "main.ts",
            "import { unused } from \"./other\";\nexport const kept = 1;\nexport function dropped() { return unused; }\n",
        ),
        ("other.ts", "export const unused: string = 2;\n"),
    ];
    check_without_file(&files, "other.ts", false, |program, build| {
        assert_eq!(build.reported(program.file("other.ts"), 2322).len(), 1);
    });
    check_without_file(&files, "other.ts", true, |_, build| {
        assert_eq!(build.codes(), [0; 0]);
    });
}

#[test]
fn error_in_left_out_file_costs_dependency_no_trust() {
    let files = [
        (
            "main.ts",
            "import { value } from \"dep\";\nexport const copy = value;\n",
        ),
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        (
            "node_modules/dep/index.ts",
            "export { unused } from \"./unused\";\nexport const value = 2;\n",
        ),
        (
            "node_modules/dep/unused.ts",
            "export const unused: string = 3;\n",
        ),
    ];
    check_without_file(
        &files,
        "node_modules/dep/unused.ts",
        false,
        |program, build| {
            assert_eq!(
                build.demoted_files(),
                [program.file("node_modules/dep/unused.ts")]
            );
        },
    );
    check_without_file(&files, "node_modules/dep/unused.ts", true, |_, build| {
        assert_eq!(build.demoted_files(), []);
        assert_eq!(build.codes(), [0; 0]);
    });
}

#[test]
fn error_in_left_out_body_costs_dependency_no_trust() {
    let dependency = "export const value = 2;
export function dropped() { const wrong: string = 1; return wrong; }
";
    let files = [
        (
            "main.ts",
            "import { value } from \"dep\";\nexport const copy = value;\n",
        ),
        ("node_modules/dep/package.json", DEPENDENCY_MANIFEST),
        ("node_modules/dep/index.ts", dependency),
    ];
    check_without(&files, &[], |program, build| {
        assert_eq!(
            build.demoted_files(),
            [program.file("node_modules/dep/index.ts")]
        );
    });
    let left_out = [("node_modules/dep/index.ts", "export function dropped")];
    check_without(&files, &left_out, |_, build| {
        assert_eq!(build.demoted_files(), []);
        assert_eq!(build.codes(), [0; 0]);
    });
}
