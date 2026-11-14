use super::support::{check, with_program};
use crate::typed_files::module_types;
use std::sync::Mutex;

fn noted_members(files: &[(&str, &str)]) -> Vec<(String, String)> {
    with_program(files, &["./main.ts"], 1, |program| {
        let main = program.file("main.ts");
        let noted = Mutex::new(Vec::new());
        check(program, &|checker, file| {
            if file != main {
                return;
            }
            let types = module_types(checker, file).unwrap();
            let name_at = |key: u32| {
                let rest = &types.text[key as usize..];
                let is_in_name = |byte: &&u8| byte.is_ascii_alphanumeric() || **byte == b'#';
                let length = rest.iter().take_while(is_in_name).count();
                String::from_utf8(rest[..length].to_vec()).unwrap()
            };
            let members = types.members.iter();
            *noted.lock().unwrap() = members
                .map(|(key, text)| (name_at(*key), String::from_utf8(text.to_vec()).unwrap()))
                .collect();
        });
        noted.into_inner().unwrap()
    })
}

const MEMBERS: &str = "type Mode = 'fast' | 'slow';
enum Color { Red, Blue }
interface Named { name: string }
declare const on: boolean;
declare const flag: boolean;
declare const words: string | null;
declare const yes: true | null;
declare const minus: -1 | false;
declare const big: 10n | -2n;
declare const far: 1e999 | -1e999;
declare const mode: Mode;
declare const anything: any;
declare const color: Color;
declare const shade: Color.Red;
declare const named: Named;
declare const list: string[];
export class Noted {
    toggled;
    maybe;
    words;
    yes;
    minus;
    big;
    far;
    mode;
    loose;
    color;
    shade;
    named;
    list;
    optional?;
    static count;
    #hidden;
    declare ambient;
    declared: number;
    annotated: string = 'a';
    valued = 1;
    get size() {
        return 1;
    }
    static {
        if (on) this.count = 1;
    }
    constructor() {
        this.toggled = on;
        if (on) this.maybe = flag;
        this.words = words;
        if (on) this.yes = yes;
        this.minus = minus;
        this.big = big;
        if (on) this.far = far;
        if (on) this.mode = mode;
        this.loose = anything;
        this.color = color;
        this.shade = shade;
        this.named = named;
        this.list = list;
        if (on) this.optional = 'a';
        this.#hidden = 1;
        this.ambient = 1;
        this.declared = 1;
    }
}
";

fn assert_noted(files: &[(&str, &str)], expected: &[(&str, &str)]) {
    let noted = noted_members(files);
    let noted: Vec<(&str, &str)> = noted.iter().map(|it| (&it.0[..], &it.1[..])).collect();
    assert_eq!(noted, expected);
}

#[test]
fn a_member_with_no_annotation_and_no_value_is_noted_with_a_type_that_names_nothing() {
    let expected = [
        ("toggled", "boolean"),
        ("maybe", "boolean | undefined"),
        ("words", "string | null"),
        ("yes", "true | null | undefined"),
        ("minus", "-1 | false"),
        ("big", "-2n | 10n"),
        ("far", "number | undefined"),
        ("mode", "\"fast\" | \"slow\" | undefined"),
        ("loose", "any"),
        ("optional", "string | undefined"),
        ("count", "number | undefined"),
        ("#hidden", "number"),
    ];
    assert_noted(&[("main.ts", MEMBERS)], &expected);
}

const OPTIONAL: &str = "export class Holder {
    first;
    label?;
    maybe?;
    constructor(items: string[], on: boolean) {
        this.first = items[0];
        this.label = 'a';
        this.maybe = on ? 'a' : undefined;
    }
}
";

fn options(more: &str) -> String {
    format!(r#"{{ "compilerOptions": {{ "strict": true, "noLib": true, "types": []{more} }} }}"#)
}

#[test]
fn an_index_that_may_have_no_entry_is_undefined_in_a_note() {
    let unchecked = options(r#", "noUncheckedIndexedAccess": true"#);
    let files = [("main.ts", OPTIONAL), ("tsconfig.json", &unchecked[..])];
    let expected = [
        ("first", "string | undefined"),
        ("label", "string | undefined"),
        ("maybe", "string | undefined"),
    ];
    assert_noted(&files, &expected);
}

#[test]
fn the_question_mark_says_that_a_member_can_be_absent_under_exact_optional_property_types() {
    let exact =
        options(r#", "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true"#);
    let files = [("main.ts", OPTIONAL), ("tsconfig.json", &exact[..])];
    let expected = [
        ("first", "string | undefined"),
        ("label", "string"),
        ("maybe", "string | undefined"),
    ];
    assert_noted(&files, &expected);
}

const WITHOUT_NO_IMPLICIT_ANY: &str = r#"{
    "compilerOptions": { "strict": true, "noImplicitAny": false, "noLib": true, "types": [] }
}"#;

#[test]
fn without_no_implicit_any_a_member_is_any_and_is_not_noted() {
    let files = [
        ("main.ts", MEMBERS),
        ("tsconfig.json", WITHOUT_NO_IMPLICIT_ANY),
    ];
    assert_noted(&files, &[]);
}
