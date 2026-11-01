use bstr::ByteSlice;
use bun_sema::bind::Decl;
use bun_sema::hir::{EnumId, VarDeclId};
use bun_sema::program::{FileId, Files};

use super::testing::{default_settings, with_loaded_build};
use crate::load::ProjectId;
use crate::lower::LeftOutDeclarations;

fn find_file_if_loaded(files: &Files<'_>, path: &str) -> Option<FileId> {
    let mut compiled = files.compiled_files().iter().copied();
    compiled.find(|&file| files.module(file).file_name().as_bstr() == path)
}

fn find_file(files: &Files<'_>, path: &str) -> FileId {
    find_file_if_loaded(files, path).unwrap_or_else(|| panic!("{path} is no file of the program"))
}

fn with_left_out_declarations<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(&Files<'_>, &LeftOutDeclarations) -> R,
) -> R {
    with_loaded_build(files, &default_settings(), |build, loaded| {
        let Ok(bound) = build.bind_modules(loaded) else {
            panic!("the modules were not bound");
        };
        let files = loaded.project(ProjectId::Application).loaded.files();
        then(files, &bound.projects.application.left_out.declarations)
    })
}

const DATA: (&str, &str) = (
    "data.json",
    r#"{ "version": "1.2.3", "nested": { "port": 80 }, "list": [1, 2] }"#,
);

// `reader.ts` reads the file by names alone, whatever else the program does with it.
const DATA_READER: (&str, &str) = (
    "reader.ts",
    "import data from './data.json'; export const read = () => [data.version, data.nested.port];",
);

fn makes_object_of_data(files: &[(&str, &str)]) -> bool {
    let mut all = files.to_vec();
    all.extend([DATA_READER, DATA]);
    with_left_out_declarations(&all, |files, left_out| {
        let data = find_file(files, "/project/data.json");
        !left_out.is_declarator_left_out(data, VarDeclId(0))
    })
}

const USES_READER: &str = "import { read } from './reader'; console.log(read());";

#[test]
fn object_of_a_json_file_that_is_read_by_names_alone_is_not_made() {
    for main in [
        "",
        "import data from './data.json'; console.log(data.version, data['version'], data.nested.port);",
        "import data from './data.json'; console.log((data as any).version, data!.nested!.port);",
        "import { version } from './data.json'; console.log(version);",
        "import data, { nested, list } from './data.json'; console.log(data.version);",
        "import { default as data } from './data.json'; console.log(data.version);",
        "import * as all from './data.json'; console.log(all.version);",
        "import './data.json';",
        "export { version } from './data.json';",
    ] {
        let main = format!("{USES_READER} {main}");
        assert!(!makes_object_of_data(&[("main.ts", &main)]), "{main}");
    }
}

#[test]
fn whoever_names_the_object_of_a_json_file_gets_it() {
    for main in [
        "import data from './data.json'; console.log(data);",
        "import data from './data.json'; const { version } = data; console.log(version);",
        "import data from './data.json'; (data as any).version = '9';",
        "import data from './data.json'; data.nested.port++;",
        "import data from './data.json'; delete (data as any).version;",
        "import data from './data.json'; [(data as any).version] = ['9'];",
        "import data from './data.json'; (data as any).version();",
        "import data from './data.json'; console.log(data.nested);",
        "import data from './data.json'; console.log((data as any).missing);",
        "import data from './data.json'; console.log((data as any)[process.argv[2]]);",
        "import data from './data.json'; console.log(data?.version);",
        "import data from './data.json'; console.log(data.version, eval('data'));",
        "import { nested } from './data.json'; console.log(nested);",
        "import { nested } from './data.json'; console.log(nested.port);",
        "import * as all from './data.json'; console.log(all.default);",
        "import * as all from './data.json'; console.log(all.nested);",
        "import * as all from './data.json'; console.log(all);",
        "import * as all from './data.json'; console.log((all as any)[process.argv[2]]);",
        "export { default } from './data.json';",
        "export { nested } from './data.json';",
        "export * from './data.json';",
        "export * as all from './data.json';",
    ] {
        let main = format!("{USES_READER} {main}");
        assert!(makes_object_of_data(&[("main.ts", &main)]), "{main}");
    }
}

#[test]
fn whatever_asks_a_loader_for_a_json_file_gets_its_object() {
    for main in [
        "console.log(require('./data.json'));",
        "console.log(require('./data.json').version);",
        "console.log(require('./data.json').nested.port);",
        "const { version } = require('./data.json'); console.log(version);",
        "const data = require('./data.json'); console.log(data.version);",
        "require('./data.json');",
        "console.log(require('./data').version);",
        "console.log(import.meta.require('./data.json').version);",
        "import { createRequire } from 'node:module'; console.log(createRequire(import.meta.url)('./data.json').version);",
        "console.log((await import('./data.json')).version);",
        "console.log((await import('./data.json')).default.version);",
        "const { version } = await import('./data.json'); console.log(version);",
        "import('./data.json');",
        "console.log(require.resolve('./data.json'));",
        "console.log(import.meta.resolve('./data.json'));",
        "console.log(require(`./${process.argv[2]}.json`).version);",
        "console.log((await import(`./${process.argv[2]}.json`)).version);",
        "console.log(require(process.argv[2]).version);",
        "console.log((await import(process.argv[2])).version);",
        "const load = require; console.log(load(process.argv[2]));",
        "export function never() { return require('./data.json').version; }",
    ] {
        let main = format!("{USES_READER} {main}");
        assert!(makes_object_of_data(&[("main.ts", &main)]), "{main}");
    }
    for required in [
        "console.log(require('./data.json').version);",
        "const { version } = require('./data.json'); console.log(version);",
        "module.exports = require('./data.json');",
        "console.log(module.require('./data.json').version);",
        "exports.version = require('./data.json').version;",
        "exports.version = eval(\"require('./data.json').version\");",
    ] {
        let main = format!("{USES_READER} import './required.cjs';");
        let files = [("main.ts", main.as_str()), ("required.cjs", required)];
        assert!(makes_object_of_data(&files), "{required}");
    }
    let main = format!("{USES_READER} import './required.cts';");
    let required = "import data = require('./data.json'); console.log(data.version);";
    let files = [("main.ts", main.as_str()), ("required.cts", required)];
    assert!(makes_object_of_data(&files));
}

#[test]
fn helper_that_wraps_require_gets_the_object_of_a_json_file() {
    let chunk = "export var __require = /* @__PURE__ */ (x => typeof require !== 'undefined' ? require : typeof Proxy !== 'undefined' ? new Proxy(x, { get: (a, b) => (typeof require !== 'undefined' ? require : a)[b] }) : x)(function (x) { if (typeof require !== 'undefined') return require.apply(this, arguments); throw Error('Dynamic require of \"' + x + '\" is not supported'); });";
    let main = "import { read } from './reader'; import { __require } from './chunk.mjs'; console.log(read(), __require('./data.json').version);";
    assert!(makes_object_of_data(&[
        ("main.mjs", main),
        ("chunk.mjs", chunk)
    ]));
}

const COLOR: (&str, &str) = (
    "color.ts",
    "export enum Color { Red, Green = 5, Blue = 'blue' }",
);

const COLOR_READER: (&str, &str) = (
    "reader.ts",
    "import { Color } from './color'; export const read = () => [Color.Red, Color.Green, Color['Blue']];",
);

// Whether something that the program can run may store to a member of `Color`, so that `reader.ts` reads the object.
fn hands_on_enum(files: &[(&str, &str)]) -> bool {
    let mut all = files.to_vec();
    all.push(COLOR_READER);
    if files.iter().all(|file| file.0 != COLOR.0) {
        all.push(COLOR);
    }
    with_left_out_declarations(&all, |files, left_out| {
        let color = find_file(files, "/project/color.ts");
        let name = files.bound(color).declared_symbol(Decl::Enum(EnumId(0)));
        !left_out.is_object_never_handed_on(color, name)
    })
}

#[test]
fn enum_that_is_read_by_its_members_and_looked_up_in_is_not_handed_on() {
    for main in [
        "",
        "import { Color } from './color'; console.log(Color.Green, Color['Blue']);",
        "import { Color as Paint } from './color'; console.log(Paint.Green);",
        "import * as all from './color'; console.log(all.Color.Green, all['Color']['Blue']);",
        "import { Color } from './color'; console.log(Color[process.argv.length]);",
        "import { Color } from './color'; console.log('Red' in Color);",
        "import { Color } from './color'; console.log((Color as any).Missing);",
        "import { Color } from './color'; for (const key in Color) console.log(key);",
        "import type { Color } from './color'; export const color: Color = 5;",
    ] {
        let main = format!("{USES_READER} {main}");
        assert!(!hands_on_enum(&[("main.ts", &main)]), "{main}");
    }
}

#[test]
fn whatever_gets_hold_of_the_object_of_an_enum_is_seen() {
    for main in [
        "import { Color } from './color'; console.log(Color);",
        "import { Color } from './color'; (Color as any).Green = 9;",
        "import { Color } from './color'; (Color as any)[process.argv[2]] = 9;",
        "import { Color } from './color'; delete (Color as any).Green;",
        "import { Color } from './color'; (Color as any).Green++;",
        "import { Color } from './color'; [(Color as any).Green] = [9];",
        "import { Color } from './color'; (Color as any).Green();",
        "import { Color } from './color'; const { Green } = Color; console.log(Green);",
        "import { Color } from './color'; console.log({ Color }, [Color], { ...Color });",
        "import { Color } from './color'; console.log(Color.Green, eval('Color'));",
        "import { Color } from './color'; import Alias = Color; console.log(Alias);",
        "import * as all from './color'; console.log(all);",
        "import * as all from './color'; console.log(all.Color);",
        "import * as all from './color'; import Alias = all.Color; console.log(Alias);",
        "import * as all from './color'; console.log((all as any)[process.argv[2]]);",
        "export { Color } from './color';",
        "export * from './color';",
        "export * as all from './color';",
        "console.log(require('./color'));",
        "console.log(require('./color').Color);",
        "const { Color } = require('./color'); console.log(Color);",
        "console.log(import.meta.require('./color').Color);",
        "import { createRequire } from 'node:module'; console.log(createRequire(import.meta.url)('./color').Color);",
        "console.log((await import('./color')).Color);",
        "const { Color } = await import('./color'); console.log(Color);",
        "import('./color').then(console.log);",
        "console.log(require(`./${process.argv[2]}.ts`));",
    ] {
        let main = format!("{USES_READER} {main}");
        assert!(hands_on_enum(&[("main.ts", &main)]), "{main}");
    }
}

#[test]
fn file_of_an_enum_that_names_the_enum_hands_it_on() {
    let calls_spoil = "import { spoil } from './color'; spoil('Color.Green = 9');";
    for (rest, main) in [
        (
            "export const spoil = () => { (Color as any).Green = 9; };",
            calls_spoil,
        ),
        ("export const spoil = () => Color;", calls_spoil),
        (
            "import Alias = Color; export const spoil = () => { (Alias as any).Green = 9; };",
            calls_spoil,
        ),
        (
            "export const spoil = (text: string) => eval(text);",
            calls_spoil,
        ),
        (
            "export import Alias = Color;",
            "import { Alias } from './color'; console.log(Alias);",
        ),
        (
            "export default Color;",
            "import Whole from './color'; console.log(Whole);",
        ),
        (
            "export { Color as Paint };",
            "import { Paint } from './color'; console.log(Paint);",
        ),
    ] {
        let color = format!("{} {rest}", COLOR.1);
        let main = format!("{USES_READER} {main}");
        let files = [("main.ts", main.as_str()), ("color.ts", color.as_str())];
        assert!(hands_on_enum(&files), "{rest}");
    }
}

#[test]
fn function_of_the_file_of_an_enum_that_nobody_calls_hands_nothing_on() {
    let color = format!(
        "{} export const spoil = () => {{ (Color as any).Green = 9; }};",
        COLOR.1
    );
    let files = [("main.ts", USES_READER), ("color.ts", color.as_str())];
    assert!(!hands_on_enum(&files));
}

// Whether the executable makes the object of the first enum of a file. A file that nothing imports is no file of the program.
fn makes_object_of_enum(files: &[(&str, &str)], path: &str) -> bool {
    with_left_out_declarations(files, |files, left_out| {
        find_file_if_loaded(files, path).is_some_and(|file| {
            !left_out.is_statement_left_out(file, files.hir(file)[EnumId(0)].stmt)
        })
    })
}

const LENGTHS: &str = "export enum Size { Length = 'text'.length, More = Length + 1, InBrackets = ('a' + 'b')['length'] }";

#[test]
fn member_that_is_the_length_of_a_text_is_known_to_another_file() {
    for main in [
        "import { Size } from './size'; console.log(Size.Length, Size.More, Size['InBrackets']);",
        "import * as all from './size'; console.log(all.Size.Length);",
        "import './size';",
    ] {
        let files = [("main.ts", main), ("size.ts", LENGTHS)];
        assert!(!makes_object_of_enum(&files, "/project/size.ts"), "{main}");
    }
}

// An executable reads the object there: the read throws before the enum has run, and finds what the program has stored.
#[test]
fn member_that_is_the_length_of_a_text_is_read_from_the_object_in_the_file_of_the_enum() {
    for read in [
        "console.log(Size.Length);",
        "console.log(Size.More);",
        "export const read = () => Size.InBrackets; console.log(read());",
    ] {
        let main = format!("{LENGTHS} {read}");
        let files = [("main.ts", main.as_str())];
        assert!(makes_object_of_enum(&files, "/project/main.ts"), "{read}");
    }
}

#[test]
fn enum_with_a_member_that_the_build_cannot_work_out_is_made() {
    for members in [
        "Length = process.argv.length",
        "Length = 'text'.length, Other = process.argv.length",
        "Length = ('text' as any).size",
        "Length = (5 as any).length",
    ] {
        let size = format!("export enum Size {{ {members} }}");
        let files = [("main.ts", "import './size';"), ("size.ts", size.as_str())];
        assert!(
            makes_object_of_enum(&files, "/project/size.ts"),
            "{members}"
        );
    }
}

const ENUMS_MADE_OF_ENUMS: [(&str, &str); 3] = [
    ("base.ts", "export enum Base { One = 1, Two }"),
    (
        "made.ts",
        "import { Base } from './base'; export enum Made { Three = Base.One + Base.Two, Four = Three + 1 }",
    ),
    (
        "third.ts",
        "import { Made } from './made'; export enum Third { Eight = Made.Four * 2 }",
    ),
];

// Which of the three objects the executable makes: that of `Base`, of `Made`, of `Third`.
fn makes_objects_of_enums_made_of_enums(main: &str) -> [bool; 3] {
    let mut files = vec![("main.ts", main)];
    files.extend(ENUMS_MADE_OF_ENUMS);
    ["/project/base.ts", "/project/made.ts", "/project/third.ts"]
        .map(|path| makes_object_of_enum(&files, path))
}

#[test]
fn enum_made_of_enums_of_other_files_is_known_over_any_number_of_steps() {
    for main in [
        "import { Made } from './made'; console.log(Made.Three, Made.Four);",
        "import { Third } from './third'; console.log(Third.Eight);",
        "import { Base } from './base'; import { Third } from './third'; console.log(Base.Two, Third.Eight);",
    ] {
        assert_eq!(
            makes_objects_of_enums_made_of_enums(main),
            [false; 3],
            "{main}"
        );
    }
}

#[test]
fn whoever_gets_hold_of_an_enum_spoils_the_enums_that_are_made_of_it() {
    for (main, expected) in [
        (
            "import { Base } from './base'; import { Third } from './third'; console.log(Base); console.log(Third.Eight);",
            [true; 3],
        ),
        (
            "import { Base } from './base'; import { Third } from './third'; console.log(Third.Eight); console.log(Base);",
            [true; 3],
        ),
        (
            "import { Made } from './made'; import { Third } from './third'; console.log(Third.Eight, Made);",
            [false, true, true],
        ),
        (
            "import { Made } from './made'; import { Third } from './third'; console.log(Made.Four, Third);",
            [false, false, true],
        ),
        (
            "import { Base } from './base'; import { Made } from './made'; (Base as any).One = 9; console.log(Made.Three);",
            [true, true, false],
        ),
    ] {
        assert_eq!(
            makes_objects_of_enums_made_of_enums(main),
            expected,
            "{main}"
        );
    }
}

// A transpiler knows nothing of another file, so the file of such an enum reads the object.
#[test]
fn member_made_of_an_enum_of_another_file_is_read_from_the_object_in_its_own_file() {
    let main = "import { Base } from './base'; enum Made { Three = Base.One + Base.Two } console.log(Made.Three);";
    let files = [("main.ts", main), ENUMS_MADE_OF_ENUMS[0]];
    assert!(makes_object_of_enum(&files, "/project/main.ts"));
    assert!(!makes_object_of_enum(&files, "/project/base.ts"));
}

#[test]
fn enums_that_name_each_other_are_known_as_far_as_each_has_run() {
    let main = "enum First { A = 1, B = (Second as any).C } enum Second { C = First.A + 1, D = First.B } console.log(Second.C);";
    assert!(makes_object_of_enum(
        &[("main.ts", main)],
        "/project/main.ts"
    ));
    let files = [
        (
            "main.ts",
            "import { Left } from './left'; console.log(Left.A);",
        ),
        (
            "left.ts",
            "import { Right } from './right'; export const enum Left { A = Right.B + 1, C = 1 }",
        ),
        (
            "right.ts",
            "import { Left } from './left'; export const enum Right { B = Left.C + 1 }",
        ),
    ];
    with_left_out_declarations(&files, |_, _| {});
}

#[test]
fn enum_whose_members_are_templates_over_its_members_is_known() {
    let texts = "export enum Text { A = 1, B = 'b', C = `a${A}b${B}c`, D = `${Text.C}!`, E = `plain`, F = `n${1 + 2}` }";
    let files = [
        (
            "main.ts",
            "import { Text } from './text'; console.log(Text.C, Text.D, Text.E, Text.F);",
        ),
        ("text.ts", texts),
    ];
    assert!(!makes_object_of_enum(&files, "/project/text.ts"));
    // A transpiler works these out too, so that the values stand in the place of the reads in the file of the enum as well.
    let main = format!(
        "{} console.log(Text.C, Text.D, Text.E, Text.F);",
        texts.trim_start_matches("export ")
    );
    let files = [("main.ts", main.as_str())];
    assert!(!makes_object_of_enum(&files, "/project/main.ts"));
    let unknown = "export enum Text { A = `a${process.argv.length}` }";
    let files = [("main.ts", "import './text';"), ("text.ts", unknown)];
    assert!(makes_object_of_enum(&files, "/project/text.ts"));
}
