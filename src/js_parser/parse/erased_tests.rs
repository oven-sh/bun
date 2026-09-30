//! What a lint parse records of sources whose dropped statements and class members are known.

use super::erased::{
    ErasedData, ErasedFlags, ErasedMemberData, ModuleName, Name, Place, StringLiteral,
};
use super::parse_entry::{Options, ParsedForLint, Parser};
use crate::defines::Define;
use bun_alloc::Arena;
use bun_ast::{ExprData, G, LocRef, StmtData};

struct Case {
    name: &'static str,
    path: &'static [u8],
    text: &'static [u8],
    /// How many statements the file keeps.
    kept: usize,
    /// One line for each record, by where the records start.
    records: &'static [&'static str],
}

/// The count of statements that the lint parse of `text` as the file `path` keeps, and a line for each record.
fn lint_parse(path: &'static [u8], text: &'static [u8]) -> Option<(usize, Vec<String>)> {
    let arena = Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(path, text);
    let mut options = Options::init(Default::default(), bun_ast::Loader::Ts);
    options.features.no_macros = true;
    options.features.dont_bundle_twice = true;
    let define = Define::default();
    let mut log = bun_ast::Log::init();
    let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
    parser
        .parse_for_lint(|parsed| (parsed.stmts.len(), describe(parsed)))
        .ok()
}

fn describe(parsed: &ParsedForLint<'_, '_>) -> Vec<String> {
    let erased = &parsed.sidecar.erased;
    let mut lines: Vec<(u32, String)> = Vec::new();
    for record in &erased.statements {
        let (kind, detail) = statement(parsed, record.data);
        let (start, end) = (record.start, record.end);
        let place = place(record.place);
        let flags = words(record.flags);
        lines.push((
            start,
            format!("{kind} [{start},{end}) {place}{flags}{detail}"),
        ));
    }
    for member in &erased.members {
        let kind = member_kind(&member.data);
        let (start, end) = (member.start, member.end);
        let (body, index) = (member.class_body, member.index);
        let flags = words(member.flags - ErasedFlags::NO_BODY);
        lines.push((
            start,
            format!("member {kind} [{start},{end}) scope@{body}#{index}{flags}"),
        ));
    }
    lines.sort_by_key(|(start, _)| *start);
    lines.into_iter().map(|(_, line)| line).collect()
}

fn statement(parsed: &ParsedForLint<'_, '_>, data: ErasedData) -> (&'static str, String) {
    match data {
        ErasedData::Interface(name) => ("interface", named(name)),
        ErasedData::TypeAlias(name) => ("type-alias", named(name)),
        ErasedData::NamespaceExport(name) => ("export-as-namespace", named(name)),
        ErasedData::Declaration(declared) => match declared.data {
            StmtData::SFunction(function) => ("function", located(parsed, function.func.name)),
            StmtData::SClass(class) => ("class", located(parsed, class.class.class_name)),
            StmtData::SEnum(declared) => ("enum", located(parsed, Some(declared.name))),
            StmtData::SLocal(_) => ("var", String::new()),
            _ => ("declare-empty", String::new()),
        },
        ErasedData::Module(module) => match module.name {
            ModuleName::Identifier(name) => ("module", named(name)),
            ModuleName::String(name) => ("module", literal("name", name)),
        },
        ErasedData::Import(import) => ("import", literal("path", import.module_specifier)),
        ErasedData::ImportEquals(import) => ("import-equals", named(import.name)),
        ErasedData::Export(export) => match export.module_specifier {
            Some(path) => ("export", literal("path", path)),
            None => ("export", String::new()),
        },
    }
}

fn named(name: Name) -> String {
    let text = bstr::BStr::new(name.text.slice());
    format!(" name={text}@[{},{})", name.start, name.end)
}

fn located(parsed: &ParsedForLint<'_, '_>, name: Option<LocRef>) -> String {
    let Some(name) = name else {
        return String::new();
    };
    let text = parsed.name_of(name.ref_);
    let start = name.loc.start;
    let end = start + text.len() as i32;
    format!(" name={}@[{start},{end})", bstr::BStr::new(text))
}

fn literal(label: &str, literal: StringLiteral) -> String {
    let mut value = String::new();
    for &byte in literal.value.slice() {
        if byte == b'"' || byte == b'\\' {
            value.push('\\');
        }
        value.push(char::from(byte));
    }
    format!(" {label}=\"{value}\"@[{},{})", literal.start, literal.end)
}

fn place(place: Place) -> String {
    match place {
        Place::Module { index } => format!("module#{index}"),
        Place::Scope { scope, index } => format!("scope@{scope}#{index}"),
        Place::Erased { parent, index } => format!("child@{parent}#{index}"),
        Place::InTree { loc } => format!("in-tree@{loc}"),
    }
}

fn words(flags: ErasedFlags) -> String {
    let names = [
        (ErasedFlags::EXPORT, " export"),
        (ErasedFlags::DEFAULT, " default"),
        (ErasedFlags::DECLARE, " declare"),
        (ErasedFlags::AMBIENT, " ambient"),
        (ErasedFlags::ABSTRACT, " abstract"),
        (ErasedFlags::STATIC, " static"),
        (ErasedFlags::TYPE_ONLY, " type-only"),
        (ErasedFlags::NESTED, " nested"),
        (ErasedFlags::STAND_IN, " stand-in"),
        (ErasedFlags::NO_BODY, " no-body"),
    ];
    let mut words = String::new();
    for (flag, word) in names {
        if flags.contains(flag) {
            words.push_str(word);
        }
    }
    words
}

fn member_kind(data: &ErasedMemberData) -> &'static str {
    let ErasedMemberData::Property(property) = data else {
        return "index-signature";
    };
    let is_method = property.flags.contains(bun_ast::flags::Property::IsMethod);
    let is_static = property.flags.contains(bun_ast::flags::Property::IsStatic);
    let is_constructor = !is_static
        && matches!(
            property.key.map(|key| key.data),
            Some(ExprData::EString(name)) if name.eql_comptime(b"constructor")
        );
    match property.kind {
        G::PropertyKind::Get => "getter",
        G::PropertyKind::Set => "setter",
        _ if !is_method => "property",
        _ if is_constructor => "constructor",
        _ => "method",
    }
}

#[test]
fn records_are_those_of_the_known_sources() {
    let mut failed = Vec::new();
    for case in CASES {
        let records = case.records.iter().map(|line| (*line).to_owned()).collect();
        let expected = Some((case.kept, records));
        let found = lint_parse(case.path, case.text);
        if found != expected {
            failed.push(format!("{}: {found:#?}", case.name));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

const CASES: &[Case] = &[
    Case {
        name: "only-erased",
        path: b"/a.ts",
        text: b"interface A<T> extends B<T> { a: T }\ntype C = A<string> | undefined;\ndeclare var v1: number, v2: string;\ndeclare let l1: A<number>;\ndeclare const c1: unique symbol;\ndeclare function f1<T>(a: T, ...rest: T[]): T;\ndeclare async function f2(): Promise<void>;\ndeclare function* f3(): Generator<number>;\nfunction over(a: string): void;\nfunction over(a: number): void;\ndeclare class K1<T> extends Base<T> implements A<T> { x: T; static y: number; m(): void; constructor(a: T); }\ndeclare abstract class K2 { abstract m(): void }\ndeclare enum E1 { A = 1, B, C = 'c' }\ndeclare const enum E2 { A }\ndeclare namespace N1 { const a: number; function g(): void; interface I {} }\ndeclare namespace N2.N3.N4 { type T = 1 }\ndeclare module M1 { export let z: number }\ndeclare module 'mod-a' { export function h(): void; export default h; }\ndeclare module \"*.css\";\ndeclare module '*!text' { const content: string; export = content; }\ndeclare global { interface Window { w: number } var gv: number }\nnamespace TypesOnly { export interface I {} export type T = I }\nnamespace Empty {}\nexport as namespace Lib;\nimport type D1 from 'm1';\nimport type * as S1 from 'm2';\nimport type { A1, B1 as B2 } from 'm3';\nimport { type T1, type T2 as T3 } from 'm4';\nimport type Q1 = require('m5');\nimport type Q2 = N1.I;\nexport type { A1 } from 'm6';\nexport type * from 'm7';\nexport type * as S2 from 'm8';\nexport { type T4 } from 'm9';\nexport { type C };\nexport type { A };\nexport type X1 = 1;\nexport interface X2 {}\nexport declare const x3: number;\nexport declare function x4(): void;\nexport declare class X5 {}\nexport declare namespace X6 { const a: number }\nexport namespace X7 { export type T = 1 }\nexport default interface X8 {}\n",
        kept: 0,
        records: &[
            "interface [0,36) module#0 name=A@[10,11)",
            "type-alias [37,68) module#0 name=C@[42,43)",
            "var [69,104) module#0 declare ambient",
            "var [105,131) module#0 declare ambient",
            "var [132,164) module#0 declare ambient",
            "function [165,211) module#0 declare ambient no-body name=f1@[182,184)",
            "function [212,255) module#0 declare ambient no-body name=f2@[235,237)",
            "function [256,298) module#0 declare ambient no-body name=f3@[274,276)",
            "function [299,330) module#0 no-body name=over@[308,312)",
            "function [331,362) module#0 no-body name=over@[340,344)",
            "class [363,472) module#0 declare ambient name=K1@[377,379)",
            "member method [441,451) scope@415#2",
            "member constructor [452,470) scope@415#2",
            "class [473,521) module#0 declare ambient abstract name=K2@[496,498)",
            "member method [501,519) scope@499#0 abstract",
            "enum [522,559) module#0 declare ambient name=E1@[535,537)",
            "enum [560,587) module#0 declare ambient name=E2@[579,581)",
            "module [588,664) module#0 declare ambient name=N1@[606,608)",
            "function [628,647) child@588#1 ambient no-body name=g@[637,638)",
            "interface [648,662) child@588#1 ambient name=I@[658,659)",
            "module [665,706) module#0 declare ambient name=N2@[683,685)",
            "module [686,706) in-tree@685 ambient nested name=N3@[686,688)",
            "module [689,706) in-tree@688 ambient nested name=N4@[689,691)",
            "type-alias [694,704) child@689#0 ambient name=T@[699,700)",
            "module [707,749) module#0 declare ambient name=M1@[722,724)",
            "module [750,821) module#0 declare ambient name=\"mod-a\"@[765,772)",
            "function [775,801) child@750#0 export ambient no-body name=h@[791,792)",
            "module [822,845) module#0 declare ambient no-body name=\"*.css\"@[837,844)",
            "module [846,914) module#0 declare ambient name=\"*!text\"@[861,869)",
            "module [915,979) module#0 declare ambient name=global@[923,929)",
            "interface [932,962) child@915#0 ambient name=Window@[942,948)",
            "module [980,1043) module#0 name=TypesOnly@[990,999)",
            "interface [1002,1023) child@980#0 export name=I@[1019,1020)",
            "type-alias [1024,1041) child@980#0 export name=T@[1036,1037)",
            "module [1044,1062) module#0 name=Empty@[1054,1059)",
            "export-as-namespace [1063,1087) module#0 name=Lib@[1083,1086)",
            "import [1088,1113) module#0 type-only path=\"m1\"@[1108,1112)",
            "import [1114,1144) module#0 type-only path=\"m2\"@[1139,1143)",
            "import [1145,1184) module#0 type-only path=\"m3\"@[1179,1183)",
            "import [1185,1229) module#0 path=\"m4\"@[1224,1228)",
            "import-equals [1230,1261) module#0 type-only name=Q1@[1242,1244)",
            "import-equals [1262,1284) module#0 type-only name=Q2@[1274,1276)",
            "export [1285,1314) module#0 type-only path=\"m6\"@[1309,1313)",
            "export [1315,1339) module#0 type-only path=\"m7\"@[1334,1338)",
            "export [1340,1370) module#0 type-only path=\"m8\"@[1365,1369)",
            "export [1371,1400) module#0 path=\"m9\"@[1395,1399)",
            "export [1401,1419) module#0",
            "export [1420,1438) module#0 type-only",
            "type-alias [1439,1458) module#0 export name=X1@[1451,1453)",
            "interface [1459,1481) module#0 export name=X2@[1476,1478)",
            "var [1482,1514) module#0 export declare ambient",
            "function [1515,1550) module#0 export declare ambient no-body name=x4@[1539,1541)",
            "class [1551,1577) module#0 export declare ambient name=X5@[1572,1574)",
            "module [1578,1625) module#0 export declare ambient name=X6@[1603,1605)",
            "module [1626,1667) module#0 export name=X7@[1643,1645)",
            "type-alias [1648,1665) child@1626#0 export name=T@[1660,1661)",
            "interface [1668,1698) module#0 export default name=X8@[1693,1695)",
        ],
    },
    Case {
        name: "interleaved",
        path: b"/a.ts",
        text: b"interface A {}\nconst a = 1;\ntype B = A;\ndeclare const b: B;\nlet c = a;\nfunction f(x: string): void;\nfunction f(x: number): void;\nfunction f(x: any) {}\nexport type { A };\nexport { c };\ninterface Z {}\n",
        kept: 4,
        records: &[
            "interface [0,14) module#0 name=A@[10,11)",
            "type-alias [28,39) module#1 name=B@[33,34)",
            "var [40,59) module#1 declare ambient",
            "function [71,99) module#2 no-body name=f@[80,81)",
            "function [100,128) module#2 no-body name=f@[109,110)",
            "export [151,169) module#3 type-only",
            "interface [184,198) module#4 name=Z@[194,195)",
        ],
    },
    Case {
        name: "leading-directive-and-empty",
        path: b"/a.ts",
        text: b"'use strict';\ninterface A {}\n;\ntype B = 1;\n'other';\ndeclare var x: number;\nfoo();\n",
        kept: 2,
        records: &[
            "interface [14,28) module#0 name=A@[24,25)",
            "type-alias [31,42) module#0 name=B@[36,37)",
            "var [52,74) module#1 declare ambient",
        ],
    },
    Case {
        name: "trailing",
        path: b"/a.ts",
        text: b"foo();\ninterface A {}\ntype B = 1",
        kept: 1,
        records: &[
            "interface [7,21) module#1 name=A@[17,18)",
            "type-alias [22,32) module#1 name=B@[27,28)",
        ],
    },
    Case {
        name: "block",
        path: b"/a.ts",
        text: b"{ interface A {} let a = 1; type B = 1; { type C = 2 } declare const d: number; }",
        kept: 1,
        records: &[
            "interface [2,16) scope@0#0 name=A@[12,13)",
            "type-alias [28,39) scope@0#1 name=B@[33,34)",
            "type-alias [42,52) scope@40#0 name=C@[47,48)",
            "var [55,79) scope@0#2 declare ambient",
        ],
    },
    Case {
        name: "function-bodies",
        path: b"/a.ts",
        text: b"function f() { interface A {} return 1; type B = 1 }\nconst g = function () { type C = 1; };\nconst h = () => { declare const d: number; return d; };\nconst o = { m() { interface E {} }, get p() { type F = 1; return 1 } };\nclass K { m() { type G = 1 } static { interface H {} foo(); type J = 1 } constructor() { type L = 1 } }",
        kept: 5,
        records: &[
            "interface [15,29) scope@13#0 name=A@[25,26)",
            "type-alias [40,50) scope@13#1 name=B@[45,46)",
            "type-alias [77,88) scope@75#0 name=C@[82,83)",
            "var [110,134) scope@108#0 declare ambient",
            "interface [166,180) scope@164#0 name=E@[176,177)",
            "type-alias [194,205) scope@192#0 name=F@[199,200)",
            "type-alias [236,246) scope@234#0 name=G@[241,242)",
            "interface [258,272) scope@256#0 name=H@[268,269)",
            "type-alias [280,290) scope@256#1 name=J@[285,286)",
            "type-alias [309,319) scope@307#0 name=L@[314,315)",
        ],
    },
    Case {
        name: "try-catch-finally",
        path: b"/a.ts",
        text: b"try { type A = 1; a() } catch (e) { interface B {} b() } finally { c(); declare let d: number }",
        kept: 1,
        records: &[
            "type-alias [6,17) scope@0#0 name=A@[11,12)",
            "interface [36,50) scope@34#0 name=B@[46,47)",
            "var [72,93) scope@57#1 declare ambient",
        ],
    },
    Case {
        name: "kept-namespace",
        path: b"/a.ts",
        text: b"namespace N { export const a = 1; interface I {} export type T = I; export function f(): void; export function f() {} namespace Inner { type U = 1 } }",
        kept: 1,
        records: &[
            "interface [34,48) scope@0#1 name=I@[44,45)",
            "type-alias [49,67) scope@0#1 export name=T@[61,62)",
            "function [68,94) scope@0#1 export no-body name=f@[84,85)",
            "module [118,148) scope@0#2 name=Inner@[128,133)",
            "type-alias [136,146) child@118#0 name=U@[141,142)",
        ],
    },
    Case {
        name: "kept-namespace-dotted",
        path: b"/a.ts",
        text: b"namespace A.B.C { interface X {} export const c = 1; type Y = X }\nnamespace D.E { interface Z {} }\nmodule F.G { export type T = 1 }",
        kept: 3,
        records: &[
            "interface [18,32) scope@13#0 name=X@[28,29)",
            "type-alias [53,63) scope@13#1 name=Y@[58,59)",
            "module [78,98) in-tree@77 nested name=E@[78,79)",
            "interface [82,96) child@78#0 name=Z@[92,93)",
            "module [108,131) in-tree@107 nested name=G@[108,109)",
            "type-alias [112,129) child@108#0 export name=T@[124,125)",
        ],
    },
    Case {
        name: "deep",
        path: b"/a.ts",
        text: b"function outer() { if (a) { for (;;) { try { interface A {} } finally { type B = 1 } } } else { switch (b) { default: { type C = 1 } } } }",
        kept: 1,
        records: &[
            "interface [45,59) scope@39#0 name=A@[55,56)",
            "type-alias [72,82) scope@62#0 name=B@[77,78)",
            "type-alias [120,130) scope@118#0 name=C@[125,126)",
        ],
    },
    Case {
        name: "in-tree-single-statement",
        path: b"/a.ts",
        text: b"if (a) interface A {}\nif (b) type B = 1; else declare var c: number;\nwhile (d) declare function e(): void;\ndo type F = 1; while (g);\nfor (;;) interface H {}\nfor (const i in j) type K = 1;\nfor (const l of m) declare const n: number;\nlabel: interface O {}\nif (p) function q(): void;",
        kept: 9,
        records: &[
            "interface [7,21) in-tree@7 name=A@[17,18)",
            "type-alias [29,40) in-tree@29 name=B@[34,35)",
            "var [46,68) in-tree@46 declare ambient",
            "function [79,106) in-tree@79 declare ambient no-body name=e@[96,97)",
            "type-alias [110,121) in-tree@110 name=F@[115,116)",
            "interface [142,156) in-tree@142 name=H@[152,153)",
            "type-alias [176,187) in-tree@176 name=K@[181,182)",
            "var [207,231) in-tree@207 declare ambient",
            "interface [239,253) in-tree@239 name=O@[249,250)",
            "function [261,280) in-tree@261 no-body name=q@[270,271)",
        ],
    },
    Case {
        name: "in-tree-switch-case",
        path: b"/a.ts",
        text: b"switch (a) { case 1: type A = 1; interface B {} b(); declare const c: number; break; default: type D = 1 }",
        kept: 1,
        records: &[
            "type-alias [21,32) in-tree@21 name=A@[26,27)",
            "interface [33,47) in-tree@33 name=B@[43,44)",
            "var [53,77) in-tree@53 declare ambient",
            "type-alias [94,104) in-tree@94 name=D@[99,100)",
        ],
    },
    Case {
        name: "in-tree-dotted",
        path: b"/a.ts",
        text: b"namespace A.B { type T = 1 }\ndeclare namespace C.D.E { const e: number }\nexport namespace F.G { export interface I {} }",
        kept: 2,
        records: &[
            "module [12,28) in-tree@11 nested name=B@[12,13)",
            "type-alias [16,26) child@12#0 name=T@[21,22)",
            "module [29,72) module#1 declare ambient name=C@[47,48)",
            "module [49,72) in-tree@48 ambient nested name=D@[49,50)",
            "module [51,72) in-tree@50 ambient nested name=E@[51,52)",
            "module [92,119) in-tree@91 nested name=G@[92,93)",
            "interface [96,117) child@92#0 export name=I@[113,114)",
        ],
    },
    Case {
        name: "prefix-export",
        path: b"/a.ts",
        text: b"export interface A {}\nexport type B = 1;\nexport declare const c: number;\nexport declare function d(): void;\nexport declare class E {}\nexport declare abstract class F {}\nexport declare enum G {}\nexport declare const enum H {}\nexport declare namespace I {}\nexport declare module J {}\nexport function k(): void;\nexport async function l(): Promise<void>;\nexport namespace M {}\nexport import type N = require('n');",
        kept: 0,
        records: &[
            "interface [0,21) module#0 export name=A@[17,18)",
            "type-alias [22,40) module#0 export name=B@[34,35)",
            "var [41,72) module#0 export declare ambient",
            "function [73,107) module#0 export declare ambient no-body name=d@[97,98)",
            "class [108,133) module#0 export declare ambient name=E@[129,130)",
            "class [134,168) module#0 export declare ambient abstract name=F@[164,165)",
            "enum [169,193) module#0 export declare ambient name=G@[189,190)",
            "enum [194,224) module#0 export declare ambient name=H@[220,221)",
            "module [225,254) module#0 export declare ambient name=I@[250,251)",
            "module [255,281) module#0 export declare ambient name=J@[277,278)",
            "function [282,308) module#0 export no-body name=k@[298,299)",
            "function [309,350) module#0 export no-body name=l@[331,332)",
            "module [351,372) module#0 export name=M@[368,369)",
            "import-equals [373,409) module#0 export type-only name=N@[392,393)",
        ],
    },
    Case {
        name: "prefix-export-default",
        path: b"/a.ts",
        text: b"export default interface A {}\nexport default function f(a: string): void;\nexport default function f(a: any) {}",
        kept: 1,
        records: &[
            "interface [0,29) module#0 export default name=A@[25,26)",
            "function [30,73) module#0 export default no-body name=f@[54,55)",
        ],
    },
    Case {
        name: "prefix-export-default-async",
        path: b"/a.ts",
        text: b"export default async function f(a: string): Promise<void>;\nexport default async function f(a: any) {}",
        kept: 1,
        records: &[
            "function [0,58) module#0 export default no-body name=f@[30,31)",
        ],
    },
    Case {
        name: "prefix-declare-order",
        path: b"/a.ts",
        text: b"declare export class A {}\ndeclare export function b(): void;\ndeclare abstract class C {}\ndeclare type D = 1;\ndeclare interface E {}\ndeclare import F = G.H;\ndeclare import type I from 'i';\ndeclare;",
        kept: 0,
        records: &[
            "class [0,25) module#0 export declare ambient name=A@[21,22)",
            "function [26,60) module#0 export declare ambient no-body name=b@[50,51)",
            "class [61,88) module#0 declare ambient abstract name=C@[84,85)",
            "type-alias [89,108) module#0 declare ambient name=D@[102,103)",
            "interface [109,131) module#0 declare ambient name=E@[127,128)",
            "import-equals [132,155) module#0 declare ambient name=F@[147,148)",
            "import [156,187) module#0 declare ambient type-only path=\"i\"@[183,186)",
            "declare-empty [188,196) module#0 declare ambient",
        ],
    },
    Case {
        name: "prefix-decorators",
        path: b"/a.ts",
        text: b"@a declare class A {}\n@b.c(1) @(d) export declare abstract class B {}\nexport @e declare class C {}\n@f declare abstract class D { @g m(): void }",
        kept: 0,
        records: &[
            "class [0,21) module#0 declare ambient name=A@[17,18)",
            "class [22,69) module#0 export declare ambient abstract name=B@[65,66)",
            "class [70,98) module#0 export declare ambient name=C@[94,95)",
            "class [99,143) module#0 declare ambient abstract name=D@[125,126)",
            "member method [129,141) scope@127#0",
        ],
    },
    Case {
        name: "prefix-async-generator",
        path: b"/a.ts",
        text: b"async function a(): Promise<void>;\nasync function a() {}\nfunction* b(): Generator;\nfunction* b() {}\ndeclare async function c(): Promise<void>;",
        kept: 2,
        records: &[
            "function [0,34) module#0 no-body name=a@[15,16)",
            "function [57,82) module#1 no-body name=b@[67,68)",
            "function [100,142) module#2 declare ambient no-body name=c@[123,124)",
        ],
    },
    Case {
        name: "nested-declare-namespace",
        path: b"/a.ts",
        text: b"declare namespace N { interface A {} const a: number; type B = A; function f(): void; class K { m(): void; [k: string]: any } enum E { X } namespace Inner { interface C {} let c: C } import q = Inner.C; export import r = Inner.C; export { a }; foo(); }",
        kept: 0,
        records: &[
            "module [0,252) module#0 declare ambient name=N@[18,19)",
            "interface [22,36) child@0#0 ambient name=A@[32,33)",
            "type-alias [54,65) child@0#1 ambient name=B@[59,60)",
            "function [66,85) child@0#1 ambient no-body name=f@[75,76)",
            "class [86,125) child@0#1 ambient name=K@[92,93)",
            "member method [96,106) scope@94#0",
            "member index-signature [107,123) scope@94#0",
            "enum [126,138) child@0#1 ambient name=E@[131,132)",
            "module [139,182) child@0#1 ambient name=Inner@[149,154)",
            "interface [157,171) child@139#0 ambient name=C@[167,168)",
            "import-equals [183,202) child@0#1 ambient name=q@[190,191)",
            "import-equals [203,229) child@0#1 export ambient name=r@[217,218)",
        ],
    },
    Case {
        name: "nested-ambient-module",
        path: b"/a.ts",
        text: b"declare module 'pkg' { import type { T } from 'dep'; import v from 'dep2'; export function f(t: T): void; export default f; global { interface G {} var gg: number; } export as namespace pkgNs; }",
        kept: 0,
        records: &[
            "module [0,194) module#0 declare ambient name=\"pkg\"@[15,20)",
            "import [23,52) child@0#0 ambient type-only path=\"dep\"@[46,51)",
            "function [75,105) child@0#1 export ambient no-body name=f@[91,92)",
            "module [124,165) child@0#2 ambient name=global@[124,130)",
            "interface [133,147) child@124#0 ambient name=G@[143,144)",
            "export-as-namespace [166,192) child@0#2 ambient name=pkgNs@[186,191)",
        ],
    },
    Case {
        name: "nested-global",
        path: b"/a.ts",
        text: b"declare global { interface A {} var a: A; namespace NS { type T = 1 } function f(): void; declare global { type Inner = 1 } }",
        kept: 0,
        records: &[
            "module [0,125) module#0 declare ambient name=global@[8,14)",
            "interface [17,31) child@0#0 ambient name=A@[27,28)",
            "module [42,69) child@0#1 ambient name=NS@[52,54)",
            "type-alias [57,67) child@42#0 ambient name=T@[62,63)",
            "function [70,89) child@0#1 ambient no-body name=f@[79,80)",
            "module [90,123) child@0#1 declare ambient name=global@[98,104)",
            "type-alias [107,121) child@90#0 ambient name=Inner@[112,117)",
        ],
    },
    Case {
        name: "nested-kept-in-erased",
        path: b"/a.ts",
        text: b"declare function f() { interface A {} return 1; type B = 1 }\ndeclare class K { m() { type C = 1 } static { interface D {} } x = () => { type E = 1 } }\ndeclare namespace N { const o = { m() { interface F {} } }; class L { n() { type G = 1 } } }",
        kept: 0,
        records: &[
            "function [0,60) module#0 declare ambient name=f@[17,18)",
            "interface [23,37) scope@21#0 name=A@[33,34)",
            "type-alias [48,58) scope@21#1 name=B@[53,54)",
            "class [61,150) module#0 declare ambient name=K@[75,76)",
            "type-alias [85,95) scope@83#0 name=C@[90,91)",
            "interface [107,121) scope@105#0 name=D@[117,118)",
            "type-alias [136,146) scope@134#0 name=E@[141,142)",
            "module [151,243) module#0 declare ambient name=N@[169,170)",
            "interface [191,205) scope@189#0 name=F@[201,202)",
            "class [211,241) child@151#1 ambient name=L@[217,218)",
            "type-alias [227,237) scope@225#0 name=G@[232,233)",
        ],
    },
    Case {
        name: "stand-in",
        path: b"/a.ts",
        text: b"namespace N { export declare const a: number; export declare let { b, c }: T, [d]: U; interface I {} export declare var e: string; export const f = 1 }\ndeclare namespace M { export declare const g: number; interface J {} }",
        kept: 1,
        records: &[
            "var [14,45) in-tree@21 export declare ambient stand-in",
            "var [46,85) in-tree@53 export declare ambient stand-in",
            "interface [86,100) scope@0#2 name=I@[96,97)",
            "var [101,130) in-tree@108 export declare ambient stand-in",
            "module [152,222) module#1 declare ambient name=M@[170,171)",
            "var [174,205) in-tree@181 export declare ambient stand-in",
            "interface [206,220) child@152#1 ambient name=J@[216,217)",
        ],
    },
    Case {
        name: "speculation-arrow-kept",
        path: b"/a.ts",
        text: b"const r = a ? (b): c => { type T = 1; interface I {} declare const d: number; return d } : e;",
        kept: 1,
        records: &[
            "type-alias [26,37) scope@24#0 name=T@[31,32)",
            "interface [38,52) scope@24#0 name=I@[48,49)",
            "var [53,77) scope@24#0 declare ambient",
        ],
    },
    Case {
        name: "speculation-arrow-dropped",
        path: b"/a.ts",
        text: b"const r = a ? (b) : c => { type T = 1; interface I {} return c };",
        kept: 1,
        records: &[
            "type-alias [27,38) scope@25#0 name=T@[32,33)",
            "interface [39,53) scope@25#0 name=I@[49,50)",
        ],
    },
    Case {
        name: "speculation-arrow-nested",
        path: b"/a.ts",
        text: b"const r = a ? (b): c => { type T = 1; return x ? (y): z => { interface I {} return 1 } : w } : e;",
        kept: 1,
        records: &[
            "type-alias [26,37) scope@24#0 name=T@[31,32)",
            "interface [61,75) scope@59#0 name=I@[71,72)",
        ],
    },
    Case {
        name: "members-overloads",
        path: b"/a.ts",
        text: b"class C { m(): void; m(a: string): void; m(a?: string) {} static s(): void; static s() {} async n(): Promise<void>; async n() {} *g(): Generator; *g() {} [k](): void; [k]() {} 'q'(): void; 'q'() {} 1(): void; 1() {} #p(): void; #p() {} constructor(); constructor(a: string); constructor(a?: any) {} get x(): number; set x(v: number); }",
        kept: 1,
        records: &[
            "member method [10,20) scope@8#0",
            "member method [21,40) scope@8#0",
            "member method [58,75) scope@8#1 static",
            "member method [90,115) scope@8#2",
            "member method [129,145) scope@8#3",
            "member method [154,166) scope@8#4",
            "member method [176,188) scope@8#5",
            "member method [198,208) scope@8#6",
            "member method [216,227) scope@8#7",
            "member constructor [236,250) scope@8#8",
            "member constructor [251,274) scope@8#8",
            "member getter [299,315) scope@8#9",
            "member setter [316,333) scope@8#9",
        ],
    },
    Case {
        name: "members-abstract",
        path: b"/a.ts",
        text: b"abstract class C { abstract a: number; abstract b(): void; abstract get c(): number; abstract set c(v: number); protected abstract d?: string; abstract static e: number; private abstract f(): void; abstract g() {} abstract [h]: number; kept = 1; abstract i: number }",
        kept: 1,
        records: &[
            "member property [19,38) scope@17#0 abstract",
            "member method [39,58) scope@17#0 abstract",
            "member getter [59,84) scope@17#0 abstract",
            "member setter [85,111) scope@17#0 abstract",
            "member property [112,142) scope@17#0 abstract",
            "member property [143,169) scope@17#0 abstract static",
            "member method [170,197) scope@17#0 abstract",
            "member method [198,213) scope@17#0 abstract",
            "member property [214,235) scope@17#0 abstract",
            "member property [246,264) scope@17#1 abstract",
        ],
    },
    Case {
        name: "members-declare",
        path: b"/a.ts",
        text: b"class C { declare a: number; declare readonly b: string; declare static c: number; static declare d: number; declare e; kept() {} declare f(): void }",
        kept: 1,
        records: &[
            "member property [10,28) scope@8#0 declare",
            "member property [29,56) scope@8#0 declare",
            "member property [57,82) scope@8#0 declare static",
            "member property [83,108) scope@8#0 declare static",
            "member property [109,119) scope@8#0 declare",
            "member method [130,147) scope@8#1 declare",
        ],
    },
    Case {
        name: "members-index-signatures",
        path: b"/a.ts",
        text: b"class C { [k: string]: any; static [k: number]: string; readonly [k: symbol]: unknown; a = 1; static readonly [k: string]: number; declare [k: string]: any }",
        kept: 1,
        records: &[
            "member index-signature [10,27) scope@8#0",
            "member index-signature [28,55) scope@8#0 static",
            "member index-signature [56,86) scope@8#0",
            "member index-signature [94,130) scope@8#1 static",
            "member index-signature [131,155) scope@8#1 declare",
        ],
    },
    Case {
        name: "members-decorated",
        path: b"/a.ts",
        text: b"abstract class C { @d abstract a: number; @d declare b: number; @d abstract c(): void; @d m(): void; @d m() {} }",
        kept: 1,
        records: &[
            "member method [64,86) scope@17#2 abstract",
            "member method [87,100) scope@17#2",
        ],
    },
    Case {
        name: "members-class-expression",
        path: b"/a.ts",
        text: b"const C = class { m(): void; m() {} [k: string]: any; declare x: number };\nexport default class { n(): void; n() {} }",
        kept: 2,
        records: &[
            "member method [18,28) scope@16#0",
            "member index-signature [36,53) scope@16#1",
            "member property [54,71) scope@16#1 declare",
            "member method [98,108) scope@96#0",
        ],
    },
    Case {
        name: "members-semicolons",
        path: b"/a.ts",
        text: b"class C { ; m(): void;; m() {}; ; [k: string]: any;; }",
        kept: 1,
        records: &[
            "member method [12,22) scope@8#0",
            "member index-signature [34,51) scope@8#1",
        ],
    },
    Case {
        name: "ends",
        path: b"/a.ts",
        text: b"type A = 1\ntype B = 2;\ninterface C {}\ninterface D {};\ndeclare const e: number\ndeclare function f(): void\nexport type { A }\nexport type { B } from 'b'\nimport type G from 'g'\nimport type H = require('h')\nexport as namespace ns\ndeclare namespace I {}\ndeclare module 'j'\ndeclare enum K {}\n{ type L = 1 }\nfunction m() { type N = 1 }",
        kept: 2,
        records: &[
            "type-alias [0,10) module#0 name=A@[5,6)",
            "type-alias [11,22) module#0 name=B@[16,17)",
            "interface [23,37) module#0 name=C@[33,34)",
            "interface [38,52) module#0 name=D@[48,49)",
            "var [54,77) module#0 declare ambient",
            "function [78,104) module#0 declare ambient no-body name=f@[95,96)",
            "export [105,122) module#0 type-only",
            "export [123,149) module#0 type-only path=\"b\"@[146,149)",
            "import [150,172) module#0 type-only path=\"g\"@[169,172)",
            "import-equals [173,201) module#0 type-only name=H@[185,186)",
            "export-as-namespace [202,224) module#0 name=ns@[222,224)",
            "module [225,247) module#0 declare ambient name=I@[243,244)",
            "module [248,266) module#0 declare ambient no-body name=\"j\"@[263,266)",
            "enum [267,284) module#0 declare ambient name=K@[280,281)",
            "type-alias [287,297) scope@285#0 name=L@[292,293)",
            "type-alias [315,325) scope@313#0 name=N@[320,321)",
        ],
    },
    Case {
        name: "paths-and-attributes",
        path: b"/a.ts",
        text: b"import type A from 'a' with { 'resolution-mode': 'import' };\nimport type { B } from \"b\" with { type: 'json' };\nexport type { C } from 'c' with { 'resolution-mode': 'require' };\nexport type * as D from 'd';\nexport type * as 'e-e' from 'e';\nimport { type default as F, type 'g-g' as G } from 'f';\nexport { type H as default, type I as 'i-i' } from 'h';",
        kept: 0,
        records: &[
            "import [0,60) module#0 type-only path=\"a\"@[19,22)",
            "import [61,110) module#0 type-only path=\"b\"@[84,87)",
            "export [111,176) module#0 type-only path=\"c\"@[134,137)",
            "export [177,205) module#0 type-only path=\"d\"@[201,204)",
            "export [206,238) module#0 type-only path=\"e\"@[234,237)",
            "import [239,294) module#0 path=\"f\"@[290,293)",
            "export [295,350) module#0 path=\"h\"@[346,349)",
        ],
    },
    Case {
        name: "contextual-names",
        path: b"/a.ts",
        text: b"type type = 1;\ninterface of {}\ndeclare namespace global { }\ndeclare module async { }\nimport type from_ from 'x';\nimport type type from 'y';\nimport type * as as from 'z';",
        kept: 0,
        records: &[
            "type-alias [0,14) module#0 name=type@[5,9)",
            "interface [15,30) module#0 name=of@[25,27)",
            "module [31,59) module#0 declare ambient name=global@[49,55)",
            "module [60,84) module#0 declare ambient name=async@[75,80)",
            "import [85,112) module#0 type-only path=\"x\"@[108,111)",
            "import [113,139) module#0 type-only path=\"y\"@[135,138)",
            "import [140,169) module#0 type-only path=\"z\"@[165,168)",
        ],
    },
    Case {
        name: "export-scan-traps",
        path: b"/a.ts",
        text: b"export declare global { interface A {} var v: typeof a.export\ninterface B {} }\nnamespace N.export.C { type T = 1 }\nexport\ninterface D {}\nfoo.export\ninterface E {}",
        kept: 2,
        records: &[
            "module [0,78) module#0 export declare ambient name=global@[15,21)",
            "interface [24,38) child@0#0 ambient name=A@[34,35)",
            "interface [62,76) child@0#1 ambient name=B@[72,73)",
            "module [98,114) in-tree@97 nested name=C@[98,99)",
            "type-alias [102,112) child@98#0 name=T@[107,108)",
            "interface [115,136) module#1 export name=D@[132,133)",
            "interface [148,162) module#2 name=E@[158,159)",
        ],
    },
    Case {
        name: "ambient-module-names",
        path: b"/a.ts",
        text: b"declare module \"a\\u0062c\" {}\ndeclare module '*.svg' { const s: string; export default s }\ndeclare module \"quote\\\"d\";\ndeclare module Foo.Bar {}",
        kept: 0,
        records: &[
            "module [0,28) module#0 declare ambient name=\"abc\"@[15,25)",
            "module [29,89) module#0 declare ambient name=\"*.svg\"@[44,51)",
            "module [90,116) module#0 declare ambient no-body name=\"quote\\\"d\"@[105,115)",
            "module [117,142) module#0 declare ambient name=Foo@[132,135)",
            "module [136,142) in-tree@135 ambient nested name=Bar@[136,139)",
        ],
    },
    Case {
        name: "import-equals-forms",
        path: b"/a.ts",
        text: b"import type A = require('a');\nexport import type B = C.D.E;\ndeclare namespace N { import F = G; import H = require('h'); export import I = J.K; }\ndeclare import /* c */ L = M;\nnamespace O { import P = Q.R; }",
        kept: 0,
        records: &[
            "import-equals [0,29) module#0 type-only name=A@[12,13)",
            "import-equals [30,59) module#0 export type-only name=B@[49,50)",
            "module [60,145) module#0 declare ambient name=N@[78,79)",
            "import-equals [82,95) child@60#0 ambient name=F@[89,90)",
            "import-equals [96,120) child@60#0 ambient name=H@[103,104)",
            "import-equals [121,143) child@60#0 export ambient name=I@[135,136)",
            "import-equals [146,175) module#0 declare ambient name=L@[169,170)",
            "module [176,207) module#0 name=O@[186,187)",
        ],
    },
    Case {
        name: "dts",
        path: b"/a.d.ts",
        text: b"export function f(a: string): void;\nexport const c: number;\nexport class K { m(): void; x: number }\ninterface I {}\ndeclare namespace N { const a: number }\nexport as namespace lib;\nexport default f;\n",
        kept: 2,
        records: &[
            "function [0,35) module#0 export ambient no-body name=f@[16,17)",
            "class [60,99) module#1 export ambient name=K@[73,74)",
            "member method [77,87) scope@75#0",
            "interface [100,114) module#1 ambient name=I@[110,111)",
            "module [115,154) module#1 declare ambient name=N@[133,134)",
            "export-as-namespace [155,179) module#1 ambient name=lib@[175,178)",
        ],
    },
];
