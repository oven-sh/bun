use super::support::{GLOBAL_TYPES, check, with_program};
use crate::typed_files::{ModuleTypes, Named, Target, module_types};
use std::sync::Mutex;

fn word_at(text: &[u8], at: usize) -> String {
    let is_in_word = |byte: &&u8| byte.is_ascii_alphanumeric() || **byte == b'#';
    let length = text[at..].iter().take_while(is_in_word).count();
    String::from_utf8(text[at..at + length].to_vec()).unwrap()
}

fn of_main<T: Send>(files: &[(&str, &str)], show: impl Fn(&ModuleTypes) -> T + Sync) -> T {
    with_program(files, &["./main.ts"], 1, |program| {
        let main = program.file("main.ts");
        let shown = Mutex::new(None);
        check(program, &|checker, file| {
            if file == main {
                let types = module_types(checker, file).unwrap();
                *shown.lock().unwrap() = Some(show(&types));
            }
        });
        shown.into_inner().unwrap().unwrap()
    })
}

/// Each stated member of main.ts: its name, `: ` and its type or ` = ` and its value, then what each name in that is.
fn stated_members(files: &[(&str, &str)]) -> Vec<String> {
    of_main(files, |types| {
        let shown = types.stated_members.iter().map(|member| {
            let text = String::from_utf8(member.text.to_vec()).unwrap();
            let names = member.names.iter().map(|(at, end, named)| {
                let written = member.text[*at as usize..*end as usize].to_vec();
                let word = String::from_utf8(written).unwrap();
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
        "hidden: items.Hidden [items.Hidden is Hidden of /project/item.ts]",
        "through: Item [Item is Item of /project/item.ts]",
        "bound: <U>(u: U) => U",
        "reads: (other: number) => typeof shadowed [shadowed is shadowed of /project/main.ts]",
        "onlyThrough: items.Hidden | null [items.Hidden is Hidden of /project/item.ts]",
        "shallow: { head: number; rest: { head: number; rest: number; }; }",
        "shared: number",
        "held: number",
        "count: number",
        "label: string",
    ];
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn a_module_that_is_not_checked_has_no_stated_member() {
    let unchecked = format!("// @ts-nocheck\n{MEMBERS}");
    let files = [("main.ts", &unchecked[..]), ("item.ts", ITEM)];
    assert_eq!(stated_members(&files), [""; 0]);
}

#[test]
fn a_name_that_is_declared_outside_the_sources_is_global() {
    let globals = format!(
        "{GLOBAL_TYPES}interface Pair<A, B> {{ a: A; b: B }}\ndeclare function pair<A, B>(a: A, b: B): Pair<A, B>;\ndeclare namespace Formats {{ interface Format {{ f: string }} }}\ndeclare function format(): Formats.Format;\n"
    );
    let main = "import { Item } from './item';
export class Stated {
    pair = pair('a', new Item());
    format = format();
}
";
    let files = [
        ("main.ts", main),
        ("item.ts", ITEM),
        ("globals.d.ts", &globals[..]),
    ];
    let expected = [
        "pair: Pair<string, Item> [Pair is global] [Item is Item of /project/item.ts]",
        "format: Formats.Format [Formats is global]",
    ];
    assert_eq!(stated_members(&files), expected);
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
        "valued: number",
    ];
    assert_eq!(stated_members(&[("main.ts", WITHOUT_VALUES)]), expected);
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
    assert_eq!(stated_members(&files), expected);
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
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn without_no_implicit_any_a_member_with_no_value_is_any() {
    let loose = options(r#", "noImplicitAny": false"#);
    let files = [("main.ts", OPTIONAL), ("tsconfig.json", &loose[..])];
    let expected = ["first: any", "label: any", "maybe: any"];
    assert_eq!(stated_members(&files), expected);
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
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn a_word_that_the_printer_wrote_for_another_symbol_states_no_member() {
    let shadowing = format!("type Uppercase<T> = T;\n{NAMES}");
    let files = with_intrinsic_types(&shadowing);
    let files = files.each_ref().map(|file| (file.0, &file.1[..]));
    let stated = stated_members(&files);
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
    assert_eq!(stated_members(&[("main.ts", main)]), expected);
}

#[test]
fn a_class_with_no_constructor_is_listed_where_its_base_class_takes_no_argument() {
    let main = "class Plain { a = 1; }
class Taking { constructor(public n: number) {} }
class Optional { constructor(public n?: number) {} }
class Rest { constructor(...all: number[]) {} }
export class OfPlain extends Plain { x = 1; }
export class OfTaking extends Taking { x = 1; }
export class OfOptional extends Optional { x = 1; }
export class OfRest extends Rest { x = 1; }
export class WithOwn extends Plain { x = 1; constructor() { super(); } }
export class OfDerived extends OfPlain { y = 2; }
";
    let listed = || {
        of_main(&[("main.ts", main)], |types| {
            let names = types.classes_of_bases_without_parameters.iter().map(|&at| {
                let header = &types.text[..at as usize];
                let class = bun_core::strings::last_index_of(header, b"class ").unwrap();
                word_at(&types.text, class + 6)
            });
            names.collect::<Vec<String>>()
        })
    };
    assert_eq!(listed(), ["OfPlain", "OfDerived"]);
}

const SCOPES: &str = "import { hide } from './item';
interface U { u: number }
namespace Outer {
    export namespace Inner { export class P { p = 1; } export interface I { i: number } }
    export interface Entry { e: number }
    export class Q {
        q = new Inner.P();
        i = null as Inner.I | null;
        entry = null as Entry | null;
    }
}
namespace Outer {
    export class Other {
        entries = [] as Entry[];
    }
}
export class Holder {
    hidden = hide();
    own = <U>(u: U) => u;
    plain = <V>(v: V) => v;
}
";

#[test]
fn a_name_is_stated_only_where_the_bundle_has_it_in_scope() {
    let files = [("main.ts", SCOPES), ("item.ts", ITEM)];
    // In the bundle a namespace below the top level is a variable, and each block of a namespace a function.
    let expected = [
        "p: number",
        "entry: Entry | null [Entry is Entry below]",
        "hidden: import(\"./item\").Hidden [import(\"./item\").Hidden is Hidden of /project/item.ts]",
        "plain: <V>(v: V) => V",
    ];
    assert_eq!(stated_members(&files), expected);
}

const PACKAGE: [(&str, &str); 3] = [
    (
        "node_modules/ext/package.json",
        r#"{ "name": "ext", "version": "1.0.0", "main": "index.js", "types": "index.d.ts" }"#,
    ),
    ("node_modules/ext/index.js", "export {};\n"),
    (
        "node_modules/ext/index.d.ts",
        "export interface Request { url: string }\n",
    ),
];

const WRAPPER: &str = "import type { Request as Raw } from 'ext';
export type { Request as Outside } from 'ext';
export interface Request { wrapped: boolean }
export interface Other { o: number }
export function pair(): { raw: Raw; wrapped: Request } { return null as any; }
export function own(): { wrapped: Request; other: Other } { return null as any; }
";

#[test]
fn a_name_behind_import_is_what_the_module_of_that_specifier_exports() {
    let main = "import { pair, own } from './wrapper';
export class Stated {
    mixed = pair();
    own = own();
}
";
    let mut files = vec![("main.ts", main), ("wrapper.ts", WRAPPER)];
    files.extend(PACKAGE);
    // `mixed` has `import("ext").Request`, which is no `Request` of wrapper.ts.
    let expected = [
        "own: { wrapped: import(\"./wrapper\").Request; other: import(\"./wrapper\").Other; } [import(\"./wrapper\").Request is Request of /project/wrapper.ts] [import(\"./wrapper\").Other is Other of /project/wrapper.ts]",
    ];
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn a_name_behind_a_namespace_import_is_what_that_module_exports() {
    let again = "export interface Outside { again: boolean }
export function again(): Outside { return { again: true }; }
";
    let main = "import * as wrapper from './wrapper';
import { again } from './again';
declare const outside: unknown;
export class Stated {
    outside = { outside: outside as wrapper.Outside, again: again() };
    other = null as wrapper.Other | null;
}
";
    let mut files = vec![
        ("main.ts", main),
        ("wrapper.ts", WRAPPER),
        ("again.ts", again),
    ];
    files.extend(PACKAGE);
    // `wrapper.Outside` is a type of the package, and no `Outside` of again.ts.
    let expected = ["other: wrapper.Other | null [wrapper.Other is Other of /project/wrapper.ts]"];
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn a_specifier_is_the_module_that_the_printer_wrote_it_for() {
    let paths = options(r#", "paths": { "@/*": ["./*"] }"#);
    // The file of the module, the specifier of its import in main.ts, and the specifier as the printer writes it.
    let cases = [
        ("item.ts", "@/item", "@/item"),
        ("lib/index.ts", "./lib", "./lib"),
        ("index.ts", ".", "."),
        ("größe.ts", "./größe", "./gr\\u00F6\\u00DFe"),
    ];
    for (path, specifier, printed) in cases {
        let main = format!(
            "import {{ hide }} from '{specifier}';\nexport class Stated {{\n    hidden = hide();\n}}\n"
        );
        let files = [
            ("main.ts", &main[..]),
            (path, ITEM),
            ("tsconfig.json", &paths[..]),
        ];
        let name = format!("import(\"{printed}\").Hidden");
        let expected = [format!(
            "hidden: {name} [{name} is Hidden of /project/{path}]"
        )];
        assert_eq!(stated_members(&files), expected, "{specifier}");
    }
}

#[test]
fn a_specifier_that_the_printer_wrote_for_two_modules_states_no_member() {
    let entry = "import type { Name as OfIndex } from './index';
export interface Name { entry: true }
export interface Alone { alone: true }
export function both(): { entry: Name; index: OfIndex } { return null as any; }
export function alone(): Alone { return { alone: true }; }
";
    let main = "import { both, alone } from './lib';
export class Stated {
    both = both();
    alone = alone();
}
";
    let files = [
        ("main.ts", main),
        ("lib/package.json", r#"{ "main": "./entry.ts" }"#),
        ("lib/entry.ts", entry),
        ("lib/index.ts", "export interface Name { index: true }\n"),
    ];
    // `./lib` is entry.ts for the import of main.ts, and index.ts for the printer, which cuts `/index` off.
    let expected = [
        "alone: import(\"./lib\").Alone [import(\"./lib\").Alone is Alone of /project/lib/entry.ts]",
    ];
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn a_module_that_is_no_source_states_no_member_by_a_source_of_its_stem() {
    let scripts = options(r#", "allowJs": true"#);
    let pair = "import { Shape as OfScript } from './shape.mjs';
import type { Shape as OfSource } from './shape';
export function pair(): { script: OfScript; source: OfSource } { return null as any; }
export function source(): OfSource { return { source: true }; }
";
    let main = "import { pair, source } from './pair';
export class Stated {
    pair = pair();
    source = source();
}
";
    let files = [
        ("main.ts", main),
        ("pair.ts", pair),
        ("shape.mjs", "export class Shape { script = true }\n"),
        ("shape.ts", "export interface Shape { source: boolean }\n"),
        ("tsconfig.json", &scripts[..]),
    ];
    let expected = [
        "source: import(\"./shape\").Shape [import(\"./shape\").Shape is Shape of /project/shape.ts]",
    ];
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn an_export_that_is_an_alias_merged_with_a_type_states_no_member() {
    let wrapper = "import { handlers } from './handlers';
export { handlers as Handlers };
export interface Handlers { h: number }
export interface Plain { p: number }
export function get(): Handlers { return { h: 1 }; }
export function plain(): Plain { return { p: 1 }; }
";
    let main = "import { get, plain } from './wrapper';
export class Stated {
    handlers = get();
    plain = plain();
}
";
    let files = [
        ("main.ts", main),
        ("wrapper.ts", wrapper),
        ("handlers.ts", "export const handlers = { h: 1 };\n"),
    ];
    let expected = [
        "plain: import(\"./wrapper\").Plain [import(\"./wrapper\").Plain is Plain of /project/wrapper.ts]",
    ];
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn a_name_behind_a_module_has_the_meaning_of_its_place() {
    let wrapper = "import { handlers } from './handlers';
export { handlers as Handlers };
export interface Handlers { h: number }
export function nested(): { inner: Handlers } { return { inner: handlers }; }
";
    let main = "import { nested } from './wrapper';
import * as barrel from './barrel';
import * as items from './item';
export class Stated {
    nested = nested();
    query = null as unknown as typeof barrel.Handlers;
    hidden = null as items.Hidden | null;
}
";
    let files = [
        ("main.ts", main),
        ("wrapper.ts", wrapper),
        ("barrel.ts", "export { Handlers } from './wrapper';\n"),
        ("handlers.ts", "export const handlers = { h: 1 };\n"),
        ("item.ts", ITEM),
    ];
    // For `nested` the printer follows the alias to the constant. Behind `typeof`, `barrel.Handlers` is the interface.
    let expected = ["hidden: items.Hidden | null [items.Hidden is Hidden of /project/item.ts]"];
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn a_specifier_of_two_modules_states_no_member_where_one_of_them_refuses_the_name() {
    let entry = "import type { Name as OfIndex } from './index';
export interface Name { entry: true }
declare const ofEntry: Name;
declare const ofIndex: OfIndex;
export function both() { return { entry: ofEntry, index: ofIndex }; }
";
    let index = "import { handlers } from './handlers';
export { handlers as Name };
export interface Name { index: true }
";
    let main = "import { both } from './lib';
export class Stated {
    both = both();
    plain = 1;
}
";
    let files = [
        ("main.ts", main),
        ("lib/package.json", r#"{ "main": "./entry.ts" }"#),
        ("lib/entry.ts", entry),
        ("lib/index.ts", index),
        ("lib/handlers.ts", "export const handlers = { h: 1 };\n"),
    ];
    assert_eq!(stated_members(&files), ["plain: number"]);
}

const VERSIONS: [(&str, &str); 3] = [
    (
        "types.ts",
        "export interface Request { legacy: true }\nexport interface RequestV2 { v2: true }\n",
    ),
    (
        "api.ts",
        "export { RequestV2 as Request } from './types';\n",
    ),
    (
        "pairs.ts",
        "import type { Request as Legacy } from './types';
export declare function pair(): { now: import('./api').Request; old: Legacy };
export declare function now(): { now: import('./api').Request };
",
    ),
];

#[test]
fn a_name_that_the_printer_copies_behind_a_new_specifier_is_the_one_of_its_source() {
    let main = "import { pair, now } from './pairs';
export class Stated {
    pair = pair();
    now = now();
}
";
    let mut files = vec![("main.ts", main)];
    files.extend(VERSIONS);
    // The printer writes `./types` for `./api` and keeps `Request`, which api.ts has for `RequestV2`.
    let name = "import(\"./types\").Request";
    let expected = [format!(
        "now: {{ now: {name}; }} [{name} is RequestV2 of /project/types.ts]"
    )];
    assert_eq!(stated_members(&files), expected);
}

#[test]
fn an_import_type_that_a_source_wrote_is_the_module_of_its_specifier() {
    let make =
        "export function make(): { held: import('./item').Hidden } { return null as any; }\n";
    let main = "import type { Hidden } from './lib/item';
import { make } from './lib/make';
export class Stated {
    made = make();
    both = { kept: null as import('./lib/item').Hidden | null, named: null as Hidden | null };
}
";
    let files = [
        ("main.ts", main),
        ("lib/make.ts", make),
        ("lib/item.ts", ITEM),
    ];
    let hidden = "is Hidden of /project/lib/item.ts";
    let expected = [
        format!(
            "made: {{ held: import(\"./lib/item\").Hidden; }} [import(\"./lib/item\").Hidden {hidden}]"
        ),
        format!(
            "both: {{ kept: import('./lib/item').Hidden | null; named: Hidden | null; }} [import('./lib/item').Hidden {hidden}] [Hidden {hidden}]"
        ),
    ];
    assert_eq!(stated_members(&files), expected);
}
