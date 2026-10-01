// Research scratch of "rules-regex" (top-down pass): the edge lists of the five regex rules.
// usage: node gen-edge.cjs    writes edge-calls.json, edge-calls-ts.json, edge-escape.json, edge-escape-ts.json, edge-positions.json beside itself.
"use strict";
const fs = require("fs");
const path = require("path");
const R = String.raw;
// One pattern that four rules report: a forward reference, two spaces, a surrogate pair in a class, a control character.
const P = R`"\\1(a)  [👍]\x1f"`;
const L = R`/\1(a)  [👍]\x1f/`;
const calls = [];
// ---- how the target of a call reaches the name
for (const callee of [
	"RegExp", "new RegExp", "(RegExp)", "new (RegExp)", "((RegExp))", "RegExp?.", "(0, RegExp)", "(a, RegExp)", "(RegExp, a)", "(a, (b, RegExp))", "((a, RegExp), b)",
	"(a || RegExp)", "(RegExp || a)", "(a && RegExp)", "(a ?? RegExp)", "((a || RegExp) && b)", "(a ? RegExp : b)", "(a ? b : RegExp)", "(RegExp ? a : b)",
	"(x = RegExp)", "(x ||= RegExp)", "(x += RegExp)", "new (a || RegExp)", "new (x = RegExp)", "(a || (b, RegExp))", "(!RegExp)", "(void RegExp)", "(await RegExp)",
	"globalThis.RegExp", "new globalThis.RegExp", 'globalThis["RegExp"]', "globalThis[`RegExp`]", 'globalThis["Reg" + "Exp"]', "globalThis?.RegExp", "globalThis.RegExp?.", "(globalThis).RegExp",
	"(a || globalThis).RegExp", "(0, globalThis).RegExp", "(a || globalThis.RegExp)", "globalThis.globalThis.RegExp", "window.RegExp", "self.RegExp", "global.RegExp", "foo.RegExp",
	"RegExp.call", "RegExp.bind(null)", "this.RegExp", "globalThis.foo.RegExp", "globalThis[RegExp]", "new new RegExp", "Regexp", "regExp",
]) {
	const dot = callee.endsWith("?.") ? "" : "";
	calls.push(`${callee}${dot}(${P});`);
}
// ---- the arguments
for (const args of [
	"", `${P}, "u"`, `${P}, "v"`, `${P}, "uv"`, `${P}, "g"`, `${P}, \`u\``, `${P}, "g" + "u"`, `${P}, flags`, `${P}, undefined`, `${P}, null`, `${P}, 1`, `${P}, foo()`, `${P}, "u", extra`,
	`${P}, ...rest`, `...[${P}]`, `(${P})`, `((${P}), ("u"))`, `${P},`, `${P}, \`\${"u"}\``, `${P}, cond ? "u" : "u"`, `${P}, flags + "v"`, `${P}, "".concat("u")`, `${P}, String("u")`, `${P}, ["u"].join("")`,
	R`'\\1(a)  [👍]\x1f'`, R`${"`"}\\1(a)  [👍]\x1f${"`"}`, R`${"`"}\\1(a)  ${"${"}"[👍]"}\x1f${"`"}`, R`"\\1(a)" + "  [👍]\x1f"`, R`("\\1(a)" + "  [👍]\x1f")`, R`"\\1(a)  " + ("[👍]\x1f")`, R`"\\1(a)  [👍]\x1f" + x`, R`x + "\\1(a)  [👍]\x1f"`,
	R`String.raw${"`"}\1(a)  [👍]${"`"}`, R`cond ? "\\1(a)  [👍]" : "\\1(a)  [👍]"`, R`(0, "\\1(a)  [👍]")`, R`"\\1(a)  [👍]" || x`,
	L, `${L}, ""`, `${L}, "u"`, `${L}, flags`, `(${L}), "g"`, `${L}u`, `${L}u, "g"`, `${L}v, ""`, `${L}, "uv"`, R`/[👍]/ + ""`, `123`, `null`, `undefined`, `true`, `-1`, `1n`,
	`x`, `x, "u"`, `foo(${P})`, `[${P}]`, `{ source: ${P} }`,
]) {
	calls.push(`RegExp(${args});`);
	calls.push(`new RegExp(${args});`);
}
calls.push("new RegExp;", "new RegExp", `new RegExp\n(${P});`);
// ---- names that the file declares, writes, or only mentions
for (const before of [
	"var RegExp;", "let RegExp;", "const RegExp = x;", "function RegExp() {}", "class RegExp {}", 'import RegExp from "m";', 'import { RegExp } from "m";', 'import { a as RegExp } from "m";', 'import * as RegExp from "m";',
	"function f(RegExp) {}", "(RegExp) => 1;", "try {} catch (RegExp) {}", "{ let RegExp; }", "function f() { var RegExp; }", "var { RegExp } = x;", "var [RegExp] = x;", "var { a: RegExp = 1 } = x;",
	"(function RegExp() {});", "(class RegExp {});", "for (var RegExp in x);", "for (const RegExp of x);", "RegExp: for (;;) break RegExp;", "({ RegExp: 1 });", "a.RegExp = 1;", "({ RegExp } = x);",
	"RegExp = x;", "RegExp++;", "[RegExp] = x;", "({ a: RegExp } = x);", "for (RegExp of x);", "for (RegExp in x);", "RegExp ||= x;", "typeof RegExp;", "delete RegExp.a;", "RegExp.prototype.x = 1;",
	'export { RegExp } from "m";', 'export { a as RegExp } from "m";', 'export * as RegExp from "m";',
	"var globalThis;", "globalThis = x;", "function f(globalThis) {}", "var flags;", 'const flags = "u";', 'let flags = "u";', 'var x = "u";',
]) {
	calls.push(`${before} RegExp(${P}); globalThis.RegExp(${P}); RegExp(${P}, flags); RegExp(x);`);
}
// ---- names that resolve with scopes (D4)
calls.push(
	`const r = RegExp; r(${P}); new r(${P});`, `var r = RegExp; r(${P});`, `let r; r = RegExp; r(${P});`, `const { RegExp: R } = globalThis; R(${P});`, `const g = globalThis; g.RegExp(${P});`,
	`const p = ${P}; RegExp(p); new RegExp(p, "u");`, `const f = "u"; RegExp(${P}, f);`, `let p = ${P}; RegExp(p);`, `var p = ${P}; p = 1; RegExp(p);`, `const p = ${P}, q = p; RegExp(q);`,
	`function f() { const p = ${P}; return RegExp(p); }`, `const p = ${P}; function f(p) { return RegExp(p); }`, `const re = ${L}; RegExp(re, "");`,
);
const callsTs = [];
for (const callee of ["(RegExp as any)", "RegExp!", "(<any>RegExp)", "(RegExp satisfies any)", "(RegExp as any as X)", "((RegExp) as any)", "((RegExp as any))", "RegExp<string>", "new RegExp<string>", "new (RegExp as any)", "new RegExp!", "(RegExp<string>)", "(globalThis as any).RegExp", "globalThis!.RegExp", "(globalThis.RegExp as any)", "globalThis.RegExp!", "(a || (RegExp as any))", "((a || RegExp) as any)", "(x = RegExp!)"]) {
	callsTs.push(`${callee}(${P});`);
}
for (const args of [
	`${P} as string`, `${P}!`, `<string>${P}`, `${P} satisfies string`, `(${P}) as string`, `(${P} as string)`, `${P} as const`, `${P} as any as string`, `<any><string>${P}`, `(${P})!`,
	`${P}, "u" as string`, `${P}, "u"!`, `${P}, <string>"u"`, `${P}, ("u" satisfies string)`, `${P} as string, "u" as string`, `${P}, flags as string`, `${P}, flags!`,
	`${L} as any`, `${L} as any, ""`, `${L}!, "g"`, `<any>${L}, "u"`, `(${L} satisfies RegExp), ""`, `${L}, "" as string`,
	R`${"`"}\\1(a)  [👍]${"`"} as string`, R`("\\1(a)" + "  [👍]") as string`, R`<string>("\\1(a)" + "  [👍]")`, R`("\\1(a)" as string) + "  [👍]"`,
]) {
	callsTs.push(`RegExp(${args});`);
	callsTs.push(`new RegExp(${args});`);
}
for (const before of [
	"declare const RegExp: any;", "declare var RegExp: any;", "declare function RegExp(s: string): any;", "declare class RegExp {}", "declare namespace RegExp {}", "namespace RegExp { export const a = 1; }", "enum RegExp { A }", "declare enum RegExp { A }",
	"interface RegExp { a: 1 }", "type RegExp = string;", 'import type RegExp from "m";', 'import type { RegExp } from "m";', 'import { type RegExp } from "m";', 'import RegExp = require("m");', "import RegExp = A.B;", 'declare module "m" { const RegExp: any; }',
	"declare global { var RegExp: any; }", "function f<RegExp>() {}", "class A { RegExp = 1; }", "class A { constructor(private RegExp: any) {} }", "function f(this: RegExp) {}", "let a: RegExp;", "abstract class A { abstract RegExp(): void; }",
	"declare const flags: string;", 'const flags: string = "u";', 'const enum F { flags = "u" }', "export type { RegExp };", "export declare const RegExp: any;",
]) {
	callsTs.push(`${before} RegExp(${P}); globalThis.RegExp(${P}); RegExp(${P}, flags);`);
}
callsTs.push(
	`class A { @dec(RegExp(${P})) m() {} }`, `@dec(${L}) class A {}`, `enum E { A = RegExp(${P}).flags.length }`, `namespace N { RegExp(${P}); }`, `declare namespace N { const a = ${L}; }`, `abstract class A { x = ${L}; abstract y: any; }`,
	`class A { declare x: any; static { RegExp(${P}); } }`, `function f(a = ${L}): void {}`, `const a = <T,>(x: T) => RegExp(${P});`, `let a = ${L} as const;`, `export = ${L};`, `export default ${L} as any;`,
);
// ---- no-useless-escape: strings, templates, and what is no string for the rule
const esc = [
	R`"a\d";`, R`'a\d';`, R`"\'";`, R`'\"';`, R`"\"";`, R`'\'';`, R`"\n\r\v\t\b\f\u0041\x41\\";`, R`"\0\1\7\8\9";`, R`"\a\c\e\g\h\i\j\k\l\m\o\p\q\s\w\y\z";`, R`"\A\B\N\U\X";`, R`"\ ";`, "\"\\\t\";", R`"\!\#\$\%\&\(\)\*\+\,\-\.\/\:\;\<\=\>\?\@\[\]\^\_\{\|\}\~";`, "\"\\`\";",
	"\"a\\\nb\";", "\"a\\\r\nb\";", "\"a\\\rb\";", "\"a\\\u2028b\";", "\"a\\\u2029b\";", R`"\👍";`, R`"👍\d";`, R`"é\d\é";`, R`"\\\d";`, R`"\\\\d";`, R`"\\d";`, R`"\u{1F44D}\d";`,
	"`a\\d`;", "`\\``;", "`\\'\\\"`;", "`\\$`;", "`\\${a}`;", "`\\$\\{a}`;", "`$\\{a}`;", "`\\{`;", "`\\}`;", "`a${b}\\d${c}\\e`;", "`${a}\\{`;", "`${a}$\\{`;", "`\\$${a}`;", "`a\\\nb`;", "`a\nb\\d`;", "`a\r\nb\\d`;", "`\\👍`;", "`${`\\d`}`;", "`${'\\d'}\\e`;", "`a${b}`;", "`${a}${b}\\d`;",
	"tag`\\d`;", "tag`\\d${a}\\e`;", "String.raw`\\d`;", "a.b`\\d`;", "a()`\\d`;", "tag`${`\\d`}`;", "tag`${'\\d'}`;", "tag`a``\\d`;", "(tag)`\\d`;", "new tag`\\d`;", "a?.b`\\d`;",
	R`"use\d";`, R`"use\ strict";`, R`'use\ strict'; "a\d";`, R`"use strict"; "a\d";`, R`function f() { "use\ strict"; "b\d"; }`, R`function f() { "a\d"; }`, R`() => { "a\d"; };`, R`class A { static { "a\d"; } }`, R`"use\ asm";`, R`("use\ strict");`, R`"a\d", 1;`, R`x; "a\d";`,
	R`({ "a\d": 1 });`, R`({ 'a\d'() {} });`, R`({ get "a\d"() { return 1; } });`, R`({ ["a\d"]: 1 });`, R`class A { "a\d" = 1; static 'b\d'() {} }`, R`class A { ["a\d"]() {} }`, R`x["a\d"];`, R`x?.["a\d"];`, R`({ a: "b\d" });`, R`({ "a\d": b } = c);`, R`var { "a\d": b } = c;`, R`function f({ "a\d": b }) {}`,
	R`import a from "m\d";`, R`import "m\d";`, R`import * as a from 'm\d';`, R`import { a } from "m\d";`, R`export * from "m\d";`, R`export * as a from "m\d";`, R`export { a } from "m\d";`, R`import("m\d");`, R`require("m\d");`, R`import a from "m" with { type: "js\on" };`, R`import a from "m" with { "ty\pe": "json" };`,
	R`import { "a\d" as b } from "m";`, R`export { b as "a\d" }; var b;`, R`export { "a\d" as "b\e" } from "m";`, R`export * as "a\d" from "m";`, R`import("m", { with: { type: "js\on" } });`,
	R`switch (a) { case "a\d": }`, R`a = "b\d" + 'c\e';`, R`f("a\d", 'b\e');`, R`typeof a === "str\ing";`, R`label: "a\d";`, R`throw "a\d";`, R`for (var a = "b\d"; ; );`, R`if ("a\d");`, R`var a = ["b\d"];`, R`a ? "b\d" : 'c\e';`,
	R`/\a/;`, R`/[\a]/;`, R`/\//;`, R`/[\/]/;`, R`/\-/;`, R`/[a\-b]/;`, R`/[\-a]/;`, R`/[a\-]/;`, R`/[\^a]/;`, R`/[a\^]/;`, R`/\👍/;`, R`/\👍/u;`, R`/[\👍]/;`, R`/\é/;`, R`/é\a/;`, R`/👍\a/;`, R`/👍\a/u;`, R`/[👍\a]/v;`, R`/[\&&]/v;`, R`/[a\&\&b]/v;`, R`/[^\^a]/v;`, R`/[\^^]/v;`, R`/[[a]\-b]/v;`, R`/[a--\b]/v;`, R`/[\q{a\b}]/v;`,
	R`/(/;`, R`/\a(/;`, R`/[/;`, R`/a/uv;`, R`/\a/uv;`, R`/(?<a>\a)\k<a>/;`, R`/\k<a>\a/;`, R`/\a{/;`, R`/\a{/u;`, R`/\p{L}\a/u;`, R`/\p{L}\a/;`, R`/\cA\c1\a/;`, R`/\0\1\a/;`, R`/[\1\a]/;`, R`/(?i:\a)/;`, R`/\a/dgimsy;`,
	R`a = b / c; d = e /\a/ f;`, R`a++ /\a/ b;`, R`(a) /\a/ b;`, R`a\u0062c = "d\e";`, R`"\u{61}\e";`, R`var \u{61} = "b\e";`,
];
const escJsx = [
	R`<a b="c\d" />;`, R`<a b='c\d' />;`, R`<a b={"c\d"} />;`, R`<a b={'c\d'} />;`, "<a b={`c\\d`} />;", R`<a b = "c\d" />;`, R`<a b = {"c\d"} />;`, R`<a b=/* c */"c\d" />;`, R`<a b={/* c */"c\d"} />;`, R`<a b={/* { */"c\d"} />;`, R`<a b=/* { */"c\d" />;`, "<a b=// c\n\"c\\d\" />;", "<a b={// c\n\"c\\d\"} />;",
	R`<a>b\d</a>;`, R`<a>"b\d"</a>;`, R`<a>{"b\d"}</a>;`, R`<a>{'b\d'}</a>;`, "<a>{`b\\d`}</a>;", R`<a>{}"b\d"</a>;`, R`<a>{/* c */}'b\d'</a>;`, R`<a> {"b\d"} 'c\e' </a>;`, R`<>b\d</>;`, R`<>{"b\d"}</>;`, R`<a><b c="d\e" />{"f\g"}</a>;`, R`<a b={<c d="e\f" />} />;`, R`<a b=<c d="e\f" /> />;`,
	R`<a {...{ b: "c\d" }} />;`, R`<a b={{ c: "d\e" }} />;`, R`<a b={f("c\d")} />;`, R`<a b="c\d" e={"f\g"} h='i\j' />;`, R`<a-b c:d="e\f" />;`, R`<a.b c="d\e">{"f\g"}</a.b>;`, R`<a b="c" d={/\e/} />;`, R`<a>{/\e/}</a>;`, R`<a b="&amp;\d" />;`, R`<a b="c\"d" />;`, R`f(<a b="c\d" />, "e\f");`,
	R`<a b={"c\d"}>{"e\f"}<g h="i\j">k\l</g></a>;`, R`<a key="b\d" />;`, R`<a ref="b\d" children={"c\e"} />;`, R`<a b />;`, R`<a b="1" c={2} />; "d\e";`,
];
const escTs = [
	R`type A = "a\d";`, "type A = `a\\d`;", "type A = `a\\d${B}\\e`;", R`let a: "b\d";`, R`function f(a: "b\d"): 'c\e' {}`, R`a as "b\d";`, R`<"b\d">a;`, R`a satisfies "b\d";`, R`type A = { "b\d": 1 };`, R`interface A { "b\d": 1; 'c\e'(): void }`, R`type A = B["c\d"];`,
	R`enum E { "a\d" = 1 }`, R`enum E { A = "a\d" }`, R`enum E { 'a\d' }`, R`const enum E { "a\d" = "b\e" }`, R`declare enum E { "a\d" = "b\e" }`, R`declare module "m\d" {}`, R`declare module "m\d";`, R`declare module "m\d" { const a: "b\e"; }`, R`module "m\d" {}`, R`namespace N { "a\d"; }`,
	R`import a = require("m\d");`, R`export import a = require("m\d");`, R`import type A from "m\d";`, R`import type { A } from "m\d";`, R`import { type A } from "m\d";`, R`import { type A, b } from "m\d";`, R`export type { A } from "m\d";`, R`export type * from "m\d";`, R`export type * as a from "m\d";`, R`let a: import("m\d").B;`, R`type A = typeof import("m\d");`,
	R`declare const a = "b\d";`, R`declare function f(a?: "b\d"): void;`, R`abstract class A { abstract "a\d": 1; }`, R`class A { declare "a\d": 1; }`, R`class A { "a\d": string = "b\e"; }`, R`class A { "a\d"(): void; "a\d"() {} }`, R`function f(a: string = "b\d") {}`, R`class A { constructor(private a = "b\d") {} }`,
	R`"a\d" as string;`, R`"a\d"!;`, R`<string>"a\d";`, R`"a\d" satisfies string;`, "`a\\d` as string;", "`a\\d${b}\\e` as string;", R`@dec("a\d") class A {}`, R`class A { @dec("a\d") m() {} }`, R`let a = /\a/ as any;`, R`let a = <any>/\a/;`, R`/\a/!;`, R`export = "a\d";`, R`export default "a\d" as any;`,
	R`function f(this: "a\d") {}`, R`let a: { [k: string]: "b\d" };`, R`type A<T = "b\d"> = T;`, R`f<"a\d">("b\e");`, R`new A<"a\d">("b\e");`, "tag<string>`\\d`;", "tag<\"a\\d\">`\\e`;", R`let a = "b\d" as "c\e";`, R`type A = B extends "c\d" ? 'e\f' : never;`,
];
const escTsx = [R`const a = <B<"c\d"> e="f\g">{"h\i"}</B>;`, R`const a = <b c="d\e" />; type F = "g\h";`, R`const a = <b>{"c\d" as string}</b>;`, R`const a = <b c={"d\e"!} />;`, R`const a = <T,>(x: T) => <b c="d\e">{'f\g'}</b>;`];
// ---- where a report is, with text before it that is not ASCII
const pos = [
	R`var é = /a  b/;`, R`var 👍 = 1; /a  b/;`, R`"👍"; /\a/;`, R`/👍\a/;`, R`/é👍[👍]\a  b/;`, R`/* 👍 */ RegExp("a  b");`, R`"é👍\d";`, "`é👍\\d${a}👍\\e`;", R`RegExp("é👍[👍]");`, R`RegExp("\u00e9\ud83d\udc4d[👍]");`, R`RegExp("\x41[👍]");`, R`RegExp('\
[👍]');`, "RegExp(`\r\n[👍]`);", "RegExp(`\n👍[👍]`);", R`RegExp("[\uD83D\uDC4D]");`, R`RegExp("[\\uD83D\\uDC4D]");`, R`RegExp("[\u{1F44D}]");`, R`RegExp("[\\u{1F44D}]", "u");`, R`RegExp("[A\u0301]");`, R`RegExp("[A\\u0301]");`, R`RegExp("[Á]", "u");`,
	R`RegExp("[👶🏻]", "u");`, R`RegExp("[🇯🇵]", "u");`, R`RegExp("[👨‍👩‍👦]", "u");`, R`RegExp("[👨‍👩‍👦]");`, R`/[👨‍👩‍👦]/;`, R`/[👨‍👩‍👦]/u;`, R`/[👶🏻]/;`, R`/[🇯🇵]/;`, R`/[Á]/;`, R`/[👍]/;`, R`/[👍]/v;`, R`/[[👍]--[a]]/v;`, R`/[\q{👶🏻}]/v;`, R`/[a-👍]/;`, R`/[👍-👎]/;`, R`/[👍-👎]/u;`, R`/[\uD83D\uDC4D]/;`, R`/[\uD83D\uDC4D]/u;`, R`/[\u{1F44D}]/u;`,
	R`/[\u0041\u0301-\u0301]/;`, R`/[a\u0301]/i;`, R`/[^👍]/;`, R`/[👍]|[👎]/;`, R`/(?:[👍])[Á]/;`, R`/[👍]/; /[Á]/; RegExp("[🇯🇵]");`, "/[👍]/;\n  /[Á]/;\n\tRegExp(\"[🇯🇵]\");", "é;\r\n/[👍]/;\r/[Á]/;\u2028/[🇯🇵]/;",
	R`/\1(a)/; /(a)|\1/; /(?<!(a)\1)/; /(?!(a))\1/; /(a\1)/;`, R`/\k<a>(?<a>b)/; /(?<a>b)|(?<a>c)\k<a>/; /(?:(?<a>b)|(?<a>c))\k<a>/;`, R`RegExp("\\1(a)\n"); RegExp('(\n)|\\1');`, R`/(é👍)|\1/; RegExp("(👍)|\\1", "u");`,
	R`/\x00\x1f\u001f\u{1f}\t\n\cA\0/u;`, "/\t/;", R`RegExp("\t\\t\x09\\x09\u0009\\u0009\u{9}\\u{9}");`, R`RegExp("\\u{9}", "u");`, R`RegExp("\x1f(");`, R`RegExp("(\x1f");`, R`RegExp("(?<a>\x1f)\\k<a>");`, R`RegExp("\x1f", "uv");`, R`/(?<a>\x1f)\k<a>[\x1e-\x1f]/;`, R`RegExp("\0\x01");`,
	R`/a  b   c/;`, R`/a  +b/;`, R`/a   +b/;`, R`/a  {2}/;`, R`/a   ?/;`, R`/a  *b  c/;`, R`/[  ]  /;`, R`/  [  ]/;`, R`/a  /u;`, R`/[[  ]  ]  /v;`, R`/👍  a/;`, R`/👍  +a   b/u;`, R`RegExp("a  b"); RegExp('a \ b'); RegExp("a\x20\x20b"); RegExp("a  \\ b");`, R`RegExp("  👍  +  ");`, R`/(  )/;`, R`/a  |b   /;`, R`/  $/;`, R`/^  /;`,
];
const write = (name, list, ext) => fs.writeFileSync(path.join(__dirname, name), JSON.stringify(list.map(code => (ext ? { code, ext } : code)), null, "\t") + "\n");
write("edge-calls.json", calls);
write("edge-calls-ts.json", callsTs, "ts");
write("edge-escape.json", esc);
write("edge-escape-jsx.json", escJsx, "jsx");
write("edge-escape-ts.json", escTs, "ts");
write("edge-escape-tsx.json", escTsx, "tsx");
write("edge-positions.json", pos);
console.log(calls.length, callsTs.length, esc.length, escJsx.length, escTs.length, escTsx.length, pos.length);
