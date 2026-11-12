use super::support::{GLOBAL_TYPES, check, with_program};
use crate::typed_files::{ModuleTypes, Named, Target, module_types};
use std::sync::Mutex;

fn word_at(text: &[u8], at: usize) -> String {
    let is_in_word = |byte: &&u8| byte.is_ascii_alphanumeric() || **byte == b'#';
    let length = text[at..].iter().take_while(is_in_word).count();
    String::from_utf8(text[at..at + length].to_vec()).unwrap()
}

fn of_main<T: Send>(
    files: &[(&str, &str)],
    assigns_class_fields: bool,
    show: impl Fn(&ModuleTypes) -> T + Sync,
) -> T {
    with_program(files, &["./main.ts"], 1, |program| {
        let main = program.file("main.ts");
        let shown = Mutex::new(None);
        check(program, &|checker, file| {
            if file == main {
                let types = module_types(checker, file, assigns_class_fields).unwrap();
                *shown.lock().unwrap() = Some(show(&types));
            }
        });
        shown.into_inner().unwrap().unwrap()
    })
}

/// The name of each member of main.ts that its stores in the bundle type in another way than the sources.
fn members_with_other_stores(files: &[(&str, &str)]) -> Vec<String> {
    of_main(files, true, |types| {
        let keys = types.members_with_other_stores.iter();
        keys.map(|&key| word_at(&types.text, key as usize))
            .collect()
    })
}

/// Each stated member of main.ts: its name, `: ` and its type or ` = ` and its value, then what each name in that is.
fn stated_members(files: &[(&str, &str)], assigns_class_fields: bool) -> Vec<String> {
    of_main(files, assigns_class_fields, |types| {
        let shown = types.stated_members.iter().map(|member| {
            let text = String::from_utf8(member.text.to_vec()).unwrap();
            let names = member.names.iter().map(|(at, named)| {
                let word = word_at(&member.text, *at as usize);
                match named {
                    Named::Target(Target::Declaration { path, name }) => {
                        let path = String::from_utf8(path.to_vec()).unwrap();
                        let name = String::from_utf8(name.to_vec()).unwrap();
                        format!(" [{word} is {name} of {path}]")
                    }
                    Named::Target(Target::Module { .. }) => format!(" [{word} is a module]"),
                    Named::Global => format!(" [{word} is global]"),
                    Named::Local(at) => {
                        format!(" [{word} is {} below]", word_at(&types.text, *at as usize))
                    }
                }
            });
            let separator = if member.is_value { " = " } else { ": " };
            let name = word_at(&types.text, member.key as usize);
            format!("{name}{separator}{text}{}", names.collect::<String>())
        });
        shown.collect()
    })
}

const ITEM: &str = "export class Item { a = 1; }
export interface Hidden { h: string }
export function hide(): Hidden { return { h: '' }; }
";

const MEMBERS: &str = "import { Item, hide } from './item';
import * as items from './item';
enum Unit { Px, Em }
function helper(a: number): string { return ''; }
const shadowed = 'a';
declare const sym: unique symbol;
function cons<H, R>(head: H, rest: R) { return { head, rest }; }
export class Stated<T> {
    n = 1;
    text = 'a';
    readonly kind = 'circle';
    readonly one = 1;
    readonly minus = -1;
    readonly big = 10n;
    readonly yes = true;
    readonly far = 1e999;
    unit = Unit.Px;
    readonly fixed = Unit.Px;
    item = new Item();
    list = [new Item()];
    pattern = /x/;
    value = null as T | null;
    private secret = 1;
    #hidden = 'h';
    maybe? = 1;
    level;
    both = { item: new Item(), unit: Unit.Em };
    call = helper;
    hidden = hide();
    through = new items.Item();
    bound = <U>(u: U) => u;
    shadows = (shadowed: number): typeof shadowed => shadowed;
    reads = (other: number): typeof shadowed => shadowed;
    // `{ low: -Infinity; }` is no type. It is refused alone.
    limits = { low: -1e999 as const };
    onlyThrough = null as items.Hidden | null;
    keyed = { [sym]: 1 };
    // The printer writes `any` for what is below ten levels, and for a type inside itself.
    deep = cons(1, cons(2, cons(3, cons(4, cons(5, cons(6, cons(7, cons(8, cons(9, cons(10, cons(11, cons(12, 0))))))))))));
    itself = { count: 0, add() { return this; } };
    shallow = cons(1, cons(2, 0));
    annotated: number = 1;
    static shared = 1;
    accessor held = 1;
    declare ambient: string;
    constructor(public count = 0, readonly label = 'x', plain = 1, public typed: string = '') {
        this.level = 'warn';
    }
}
";

#[test]
fn a_member_with_no_annotation_is_stated_with_the_type_that_the_check_has_for_it() {
    let files = [("main.ts", MEMBERS), ("item.ts", ITEM)];
    let expected = [
        "n: number",
        "text: string",
        "kind = \"circle\"",
        "one = 1",
        "minus = -1",
        "big = 10n",
        "yes = true",
        "far: number",
        "unit: Unit [Unit is Unit of /project/main.ts]",
        "fixed = Unit.Px [Unit is Unit of /project/main.ts]",
        "item: Item [Item is Item of /project/item.ts]",
        "list: Item[] [Item is Item of /project/item.ts]",
        "pattern: RegExp [RegExp is global]",
        "value: T | null [T is T below]",
        "secret: number",
        "#hidden: string",
        "maybe: number | undefined",
        "level: string",
        "both: { item: Item; unit: Unit; } [Item is Item of /project/item.ts] [Unit is Unit of /project/main.ts]",
        "call: typeof helper [helper is helper of /project/main.ts]",
        "through: Item [Item is Item of /project/item.ts]",
        "reads: (other: number) => typeof shadowed [shadowed is shadowed of /project/main.ts]",
        "shallow: { head: number; rest: { head: number; rest: number; }; }",
        "shared: number",
        "held: number",
        "count: number",
        "label: string",
    ];
    assert_eq!(stated_members(&files, true), expected);
}

#[test]
fn a_module_whose_fields_the_build_defines_states_only_a_member_with_no_value() {
    let files = [("main.ts", MEMBERS), ("item.ts", ITEM)];
    assert_eq!(stated_members(&files, false), ["level: string"]);
}

#[test]
fn a_module_that_is_not_checked_has_no_stated_member() {
    let unchecked = format!("// @ts-nocheck\n{MEMBERS}");
    let files = [("main.ts", &unchecked[..]), ("item.ts", ITEM)];
    assert_eq!(stated_members(&files, true), [""; 0]);
}

#[test]
fn a_name_that_is_declared_outside_the_sources_is_global() {
    let globals = format!(
        "{GLOBAL_TYPES}interface Pair<A, B> {{ a: A; b: B }}\ndeclare function pair<A, B>(a: A, b: B): Pair<A, B>;\n"
    );
    let main = "import { Item } from './item';
export class Stated {
    pair = pair('a', new Item());
}
";
    let files = [
        ("main.ts", main),
        ("item.ts", ITEM),
        ("globals.d.ts", &globals[..]),
    ];
    let expected = ["pair: Pair<string, Item> [Pair is global] [Item is Item of /project/item.ts]"];
    assert_eq!(stated_members(&files, true), expected);
}

const WITHOUT_VALUES: &str = "type Mode = 'fast' | 'slow';
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
declare const quoted: 'two words' | \"it's\";
declare const template: `${string}-x`;
declare const indexed: { [key: string]: Named };
export class Stated {
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
    quoted;
    template;
    indexed;
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
        this.quoted = quoted;
        this.template = template;
        this.indexed = indexed;
        if (on) this.optional = 'a';
        this.#hidden = 1;
        this.ambient = 1;
        this.declared = 1;
    }
}
";

#[test]
fn a_member_with_no_value_is_stated_with_the_type_of_its_stores() {
    let expected = [
        "toggled: boolean",
        "maybe: boolean | undefined",
        "words: string | null",
        "yes: true | null | undefined",
        "minus: -1 | false",
        "big: -2n | 10n",
        "far: number | undefined",
        "mode: Mode | undefined [Mode is Mode of /project/main.ts]",
        "loose: any",
        "color: Color [Color is Color of /project/main.ts]",
        "shade: Color.Red [Color is Color of /project/main.ts]",
        "named: Named [Named is Named of /project/main.ts]",
        "list: string[]",
        "quoted: \"it's\" | \"two words\"",
        "template: `${string}-x`",
        "indexed: { [key: string]: Named; } [Named is Named of /project/main.ts]",
        "optional: string | undefined",
        "count: number | undefined",
        "#hidden: number",
    ];
    assert_eq!(
        stated_members(&[("main.ts", WITHOUT_VALUES)], false),
        expected
    );
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
fn an_index_that_may_have_no_entry_is_undefined_in_a_stated_type() {
    let unchecked = options(r#", "noUncheckedIndexedAccess": true"#);
    let files = [("main.ts", OPTIONAL), ("tsconfig.json", &unchecked[..])];
    let expected = [
        "first: string | undefined",
        "label: string | undefined",
        "maybe: string | undefined",
    ];
    assert_eq!(stated_members(&files, false), expected);
}

#[test]
fn the_question_mark_says_that_a_member_can_be_absent_under_exact_optional_property_types() {
    let exact =
        options(r#", "noUncheckedIndexedAccess": true, "exactOptionalPropertyTypes": true"#);
    let files = [("main.ts", OPTIONAL), ("tsconfig.json", &exact[..])];
    let expected = [
        "first: string | undefined",
        "label: string",
        "maybe: string | undefined",
    ];
    assert_eq!(stated_members(&files, false), expected);
    assert_eq!(stated_members(&files, true), expected);
}

#[test]
fn without_no_implicit_any_only_a_member_that_the_build_moves_is_stated() {
    let loose = options(r#", "noImplicitAny": false"#);
    let files = [("main.ts", OPTIONAL), ("tsconfig.json", &loose[..])];
    assert_eq!(stated_members(&files, false), [""; 0]);
    let expected = ["first: any", "label: any", "maybe: any"];
    assert_eq!(stated_members(&files, true), expected);
}

const LOUD: &str = "export function shout(): Uppercase<string> { return 'A' as Uppercase<string>; }
";

const NAMES: &str = "import { shout } from './loud';
namespace Shapes {
    export enum Kind { Circle, Square }
    export class Item { size = 1; }
    export interface Options { wide: boolean }
    export namespace Inner { export interface Deep { d: number } export const v = 1; }
}
import Kind = Shapes.Kind;
import Alias = Shapes.Item;
enum Top { A, B }
enum Merged { A, B }
namespace Merged { export function parse(): Merged { return Merged.A; } }
function make() {
    enum Local { A, B }
    class Near { n = 1; }
    return class Box {
        local = Local.A;
        readonly fixed = Local.B;
        near = new Near();
    };
}
export class Holder {
    readonly kind = Shapes.Kind.Circle;
    plain = Shapes.Kind.Square;
    item = new Shapes.Item();
    options = { wide: true } as Shapes.Options;
    deep = { d: 1 } as Shapes.Inner.Deep;
    viaAlias = Kind.Circle;
    readonly fixedAlias = Kind.Square;
    aliased = new Alias();
    space = Shapes;
    top = Top.A;
    readonly fixedTop = Top.B;
    loud = shout();
    made = make();
    merged = Merged.parse();
    readonly fixedMerged = Merged.A;
    constructor(public first = 1, readonly name: string, public last = 'z') {}
}
";

fn with_intrinsic_types(main: &str) -> [(&str, String); 3] {
    let globals = format!("{GLOBAL_TYPES}type Uppercase<S extends string> = intrinsic;\n");
    [
        ("main.ts", main.to_string()),
        ("loud.ts", LOUD.to_string()),
        ("globals.d.ts", globals),
    ]
}

#[test]
fn a_name_that_the_typed_file_has_as_a_variable_states_no_member() {
    let files = with_intrinsic_types(NAMES);
    let files = files.each_ref().map(|file| (file.0, &file.1[..]));
    // An enum below the top level and a value of a namespace are variables in the bundle. A type of a namespace is one.
    let expected = [
        "size: number",
        "n: number",
        "near: Near [Near is Near below]",
        "options: Shapes.Options [Shapes is Shapes of /project/main.ts]",
        "deep: Shapes.Inner.Deep [Shapes is Shapes of /project/main.ts]",
        "top: Top [Top is Top of /project/main.ts]",
        "fixedTop = Top.B [Top is Top of /project/main.ts]",
        "loud: Uppercase<string> [Uppercase is global]",
        "merged: Merged [Merged is Merged of /project/main.ts]",
        "fixedMerged = Merged.A [Merged is Merged of /project/main.ts]",
        "first: number",
        "last: string",
    ];
    assert_eq!(stated_members(&files, true), expected);
    let expected = [
        "local",
        "fixed",
        "kind",
        "plain",
        "item",
        "options",
        "deep",
        "viaAlias",
        "fixedAlias",
        "aliased",
        "space",
        "top",
        "fixedTop",
        "made",
        "merged",
        "fixedMerged",
    ];
    assert_eq!(members_with_other_stores(&files), expected);
}

#[test]
fn a_word_that_the_printer_wrote_for_another_symbol_states_no_member() {
    let shadowing = format!("type Uppercase<T> = T;\n{NAMES}");
    let files = with_intrinsic_types(&shadowing);
    let files = files.each_ref().map(|file| (file.0, &file.1[..]));
    let stated = stated_members(&files, true);
    assert!(stated.contains(&"last: string".to_string()), "{stated:?}");
    assert!(
        !stated.iter().any(|member| member.starts_with("loud")),
        "{stated:?}"
    );
}

#[test]
fn a_member_of_a_class_expression_names_that_class_by_its_own_name() {
    let main = "const Counter = class Inner {
    count = 0;
    twin = new Inner();
};
export class Holder {
    counter = new Counter();
}
";
    // Inside the class expression its name is a type. Outside, no name is, and the class has a member of its own type.
    let expected = ["count: number", "twin: Inner [Inner is Inner below]"];
    assert_eq!(stated_members(&[("main.ts", main)], true), expected);
}
