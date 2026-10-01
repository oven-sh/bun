// Writes inputs5.json: class members whose name is a keyword, and the last rows. usage: node make-inputs5.cjs
const rows = [];
const g = (group, list) => { for (const e of list) rows.push(typeof e === "string" ? { g: group, s: e } : { g: group, l: e[0], s: e[1] }); };
g("class members named by a keyword", [
  "class C { static interface x }", "class C { readonly interface x }", "class C { public type x }", "class C { static let x }", "class C { static var x }", "class C { type? x }", "class C { is! x }", "class C { async interface x }",
  "class C { declare type x }", "class C { get x y }", "class C { set x y }", "class C { get y }", "class C { abstract interface x }", "class C { override type x }", "class C { accessor interface x }", "class C { private interface x }",
  "class C { protected module x }", "class C { static static x }", "class C { static public x }", "class C { public static x y }", "class C { if x }", "class C { for x }", "class C { class x }", "class C { function x }", "class C { new x }",
  "class C { typeof x }", "class C { delete x }", "class C { in x }", "class C { of x }", "class C { as x }", "class C { any x }", "class C { string x }", "class C { async x y }", "class C { await x }", "class C { yield x }", "class C { constructor x }",
  "class C { static x }", "class C { static ) }", "class C { interface: 1 y }", "class C { interface = 1 y }", "class C { interface() bar }", "class C { interface }", "class C { interface; }", "class C { interface\nx }", "class C { type\nx y }",
  "class C { interface x; }", "class C { type x = 1 }", "class C { undefined x }", "class C { require x }", "class C { global x }", "class C { from x }", "class C { using x }", "class C { out x }", "class C { in x y }", "class C { const x y }", "class C { export x }", "class C { default x }",
  ["js", "class C { interface x }"], ["js", "class C { static interface x }"], ["js", "class C { x y }"], ["js", "class C { x: number y }"], ["js", "class C { x @dec y }"],
]);
g("statements in a block at the end of the file, and other rows", [
  "{ )", "{ foo; )", "function f() { )", "if (x) { else", "switch (x) { case 1: foo; )", "switch (x) { case 1: { )", "class C { m() { ) } }", "x = () => { )", "try { ) } catch {}", "namespace N { ) }", "label: { ) }",
  "for (;;) { ) }", "{ { ) } }", "{ default }", "{ case 1: }", "function f() { default: }", "namespace N { default }", "{ catch }", "{ finally }", "{ else }", "{ in }", "{ * }", "{ = }", "{ , }", "{ : }", "{ . }", "{ => }", "{ ] }", "{ ? }",
  "interface I { ) }", "interface I { a: 1 ) }", "interface I { a: 1; }  )", "declare module 'a' { ) }", "declare global { ) }", "enum E { A } )", "class C {} )", "function f() {} )", "x = 1 )", "x = 1; )", ";)",
  "import x from 'y' )", "export {} )", "type T = 1 )", "if (x) ; else )", "do ; while (x) )", "var a = 1 )", "return )", "throw x )", "break )", "debugger )",
]);
require("node:fs").writeFileSync(__dirname + "/inputs5.json", JSON.stringify(rows, null, 0).replace(/\},\{/g, "},\n{"));
console.log(rows.length + " inputs");
