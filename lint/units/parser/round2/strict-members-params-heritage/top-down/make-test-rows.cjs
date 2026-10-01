// usage: node make-test-rows.cjs [--go /tmp/rr/parsediag-bu] > test-rows.txt
// The rows of the Rust tests: (source, loader, code, start, end, text) of the first parse diagnostic of tsc 6.0.2, and a
// mark where typescript-go 89d5d5b differs.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const { spawnSync } = require("node:child_process");
const goAt = process.argv.indexOf("--go");
const goBin = goAt > 0 ? process.argv[goAt + 1] : null;
const groups = [
  ["A1 heritage entry that starts no left-hand-side expression: class extends", [
    "class C extends -a {}", "class C extends !a {}", "class C extends typeof a {}", "class C extends void 0 {}", "class C extends ++a {}",
    "class C extends delete a.b {}", "async function f() { class C extends await a {} }", "function* f() { class C extends yield {} }",
    "class C extends <T>a {}", "class C extends @dec class {} {}", "class C { #a; m() { class D extends #a {} } }", "class C extends import {}",
    "class C extends + {}", "class C extends {}.x {}", "tsx:class C extends <div/> {}",
  ]],
  ["A1 class implements", [
    "class C implements typeof A {}", "class C implements -1 {}", "class C implements void {}", "class C implements #a {}", "class C implements if {}",
    "class C implements A | B {}", "class C implements keyof A {}", "class C implements () => void {}", "class C implements A extends B ? C : D {}",
    "function* g() { class C implements yield {} }", "async function f() { class C implements await {} }", "class C implements class {}",
  ]],
  ["A1 decorator expression", [
    "@-a class C {}", "@typeof a class C {}", "@<T>a class C {}", "class C { @-a m() {} }", "class C { m(@-a x) {} }", "async function f() { @await x class C {} }",
    "async function f() { @await class C {} }", "function* g() { @yield class C {} }",
  ]],
  ["A3 interface extends (needs the interface to be read by the sink that builds)", [
    "interface I extends typeof A {}", "interface I extends A | B {}", "interface I extends void {}", "interface I extends -1 {}", "interface I extends keyof A {}",
    "interface I extends () => void {}", "interface I extends A & B {}", "interface I extends A extends B ? C : D {}", "interface I extends +a {}",
    "interface I extends <T>a {}", "interface I { a A }", "interface I { x: A & | B }", "type T = A | () => void;",
  ]],
  ["A4 the token after the name of a class member", [
    "class C { x!() {} }", "class C { m!() }", "class C { x!(): void }", "class C { static x!() {} }", "class C { [k]!() {} }", "class C { #x!() {} }",
    "class C { accessor x!() {} }", "class C { declare x!() }", "abstract class C { abstract x!(): void }", "class C { 'constructor'!() {} }", "class C { get!() {} }",
    "class C { get x?() { return 1 } }", "class C { set x?(v) {} }", "class C { static get x?() { return 1 } }", "class C { get x?: number }", "class C { get x? }",
    "class C { constructor?() {} }", "class C { constructor!() {} }", "class C { static constructor?() {} }", "class C { public constructor?() {} }",
    "declare class C { constructor?() }", "class C { constructor?(): void }",
  ]],
  ["A5 a modifier of a constructor parameter", [
    "class C { constructor(public\n x) {} }", "class C { constructor(readonly\n x) {} }", "class C { constructor(public readonly\n x) {} }",
    "class C { constructor(public\n readonly x) {} }", "class C { constructor(override\n x) {} }", "class C { constructor(private\n[x]) {} }",
    "class C { constructor(public // c\n x) {} }", "class C { constructor(...public x) {} }",
  ]],
  ["A6 an index signature after get, set or *", [
    "class C { get [k: string]: any }", "class C { set [k: string]: any }", "class C { *[k: string]: any }", "class C { static get [k: string]: any }",
    "class C { async *[k: string]: any }", "class C { get [k: string] }", "class C { get [...k]: any }", "class C { get []: any }", "class C { *[] }",
    "class C { get [k?]: any }", "class C { get [k, j]: any }", "class C { get [k: string]() { return 1 } }", "class C { *[k: string]() {} }",
  ]],
  ["A7 [modifier name in a class", ["class C { [async x => x]: any }", "class C { [async x => x] = 1 }", "js:class C { [async x => x]() {} }"]],
  ["A8 a binding property that is one reserved word", [
    "var {class} = x", "let {if} = x", "const {this} = x", "var {true} = x", "var {in} = x", "var {class = 1} = x", "function f({class}) {}", "function f({this}) {}",
    "try {} catch ({class}) {}", "for (var {class} of x) {}", "var [{class}] = x", "var {a: {class}} = x", "var {class,} = x", "js:var {enum} = x",
  ]],
  ["A9 an arrow parameter that is more than a binding", [
    "(a!) => 1", "(a as T) => 1", "(<T>a) => 1", "((a)) => 1", "(a satisfies T) => 1", "(a!, b) => 1", "async (a!) => 1", "([a!]) => 1", "({a: b!}) => 1",
    "(a! = 1) => 1", "((a) = 1) => 1", "([(a)]) => 1", "({a: (b)}) => 1", "<T>(a!) => 1", "(a, (b)) => 1", "(((a))) => 1", "x = (a!) => 1", "f((a!) => 1)",
    "js:((a)) => 1", "(1) => 1", "(a.b) => 1",
  ]],
];
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS };
const all = [];
for (const [, list] of groups) for (const raw of list) { const m = /^(tsx|js):(.*)$/s.exec(raw); all.push(m ? { l: m[1], s: m[2] } : { l: "ts", s: raw }); }
let go = new Map();
if (goBin) {
  const p = spawnSync(goBin, [], { input: all.map((r, id) => JSON.stringify({ id, name: "input." + r.l, src: r.s })).join("\n") + "\n", maxBuffer: 1 << 28 });
  for (const line of String(p.stdout).split("\n")) { if (!line) continue; const r = JSON.parse(line); go.set(r.id, r); }
}
let id = 0;
for (const [title, list] of groups) {
  console.log("// " + title);
  for (const raw of list) {
    const r = all[id];
    const sf = ts.createSourceFile("a." + r.l, r.s, ts.ScriptTarget.Latest, false, kinds[r.l]);
    const d = sf.parseDiagnostics[0];
    const g = go.get(id); const gd = g && (g.diags || [])[0];
    const loader = r.l === "ts" ? "Loader::Ts" : r.l === "tsx" ? "Loader::Tsx" : "Loader::Js";
    const lit = "b" + JSON.stringify(r.s);
    if (!d) console.log(`(${lit}, ${loader}) // tsc parses`);
    else {
      const text = ts.flattenDiagnosticMessageText(d.messageText, "\n");
      const differs = gd && (gd[0] !== d.code || gd[1] !== d.start || gd[2] !== d.length) ? `   // typescript-go: TS${gd[0]} ${gd[1]} ${gd[1] + gd[2]}` : (g && !gd ? "   // typescript-go parses" : "");
      console.log(`(${lit}, ${loader}, ${d.code}, ${d.start}, ${d.start + d.length}, ${JSON.stringify(text)}),${differs}`);
    }
    id++;
  }
}
