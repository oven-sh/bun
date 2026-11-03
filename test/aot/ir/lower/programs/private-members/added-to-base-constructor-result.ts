// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 1

// FILE: main.ts
// Private fields and methods are added to whatever object a base constructor returns, including typed objects.
declare const console: { log(...values: unknown[]): void };
import { run } from "./untyped.js";
run((line: string) => console.log(line));

// FILE: untyped.js
class ReturnsArgument { constructor(o) { return o; } }
class PrivateField extends ReturnsArgument { #stamp = "stamp"; static read(o) { return o.#stamp; } static write(o, v) { o.#stamp = v; } static has(o) { return #stamp in o; } }
class PrivateMethod extends ReturnsArgument { #m() { return "method"; } static call(o) { return o.#m(); } static has(o) { return #m in o; } }
class PrivateAccessor extends ReturnsArgument { #v = 1; get #a() { return "got " + this.#v; } set #a(v) { this.#v = v; } static get(o) { return o.#a; } static set(o, v) { o.#a = v; } }
const key = "computed", symbol = Symbol("s");
class PublicFields extends ReturnsArgument { plain = 1; [key] = 2; 0 = 3; [symbol] = 4; "quoted name" = 5; }
class ManyFields extends ReturnsArgument { a = 1; b = 2; c = 3; d = 4; e = 5; f = 6; g = 7; h = 8; i = 9; #j = 10; static j(o) { return o.#j; } }

function makers() {
  let one = 1, two = 2, three = 3;
  const holder = { method() { return one; }, get getter() { return () => two; } };
  return [
    ["function", () => function () { return 7; }],
    ["named function", () => function named(a, b) { return 7; }],
    ["arrow", () => () => 7],
    ["arrow with one capture", () => () => 6 + one],
    ["arrow with three captures", () => () => one + two + three + 1],
    ["async arrow", () => async () => 7],
    ["async function", () => async function later() { return 7; }],
    ["method", () => ({ method() { return 6 + one; } }).method],
    ["bound", () => (function () { return this.v; }).bind({ v: 7 })],
    ["bound arrow", () => (() => 6 + one).bind(null)],
    ["from a getter", () => holder.getter],
  ];
}

function show(v) {
  if (typeof v === "function") return "function";
  if (typeof v === "symbol") return v.toString();
  if (v && typeof v.then === "function") return "promise";
  return JSON.stringify(v);
}
function attempt(f) { try { return show(f()); } catch (e) { return "throws " + e.constructor.name; } }

const doors = [
  ["private field", f => { new PrivateField(f); return [PrivateField.read(f), PrivateField.has(f)]; }],
  ["private field written", f => { new PrivateField(f); PrivateField.write(f, "again"); return PrivateField.read(f); }],
  ["private field twice", f => { new PrivateField(f); new PrivateField(f); }],
  ["private field never given", f => PrivateField.read(f)],
  ["private field asked for", f => PrivateField.has(f)],
  ["private method", f => { new PrivateMethod(f); return [PrivateMethod.call(f), PrivateMethod.has(f)]; }],
  ["private method twice", f => { new PrivateMethod(f); new PrivateMethod(f); }],
  ["private accessor", f => { new PrivateAccessor(f); const first = PrivateAccessor.get(f); PrivateAccessor.set(f, 2); return [first, PrivateAccessor.get(f)]; }],
  ["public fields", f => { new PublicFields(f); return [f.plain, f.computed, f[0], f[symbol], f["quoted name"], Object.keys(f), Object.getOwnPropertySymbols(f).length]; }],
  ["many fields", f => { new ManyFields(f); return [Object.keys(f).join(""), ManyFields.j(f)]; }],
  ["private, then public, then private", f => { new PrivateField(f); new PublicFields(f); new PrivateMethod(f); return [PrivateField.read(f), f.plain, PrivateMethod.call(f), Object.keys(f)]; }],
  ["a property, then private", f => { f.x = 1; new PrivateField(f); return [f.x, PrivateField.read(f)]; }],
  ["name asked, then private", f => { const n = f.name, l = f.length; new PrivateField(f); return [n, l, f.name, f.length, PrivateField.read(f)]; }],
  ["frozen, then private", f => { Object.freeze(f); new PrivateField(f); return PrivateField.read(f); }],
  ["frozen, then public", f => { Object.freeze(f); new PublicFields(f); }],
  ["not extensible, then private method", f => { Object.preventExtensions(f); new PrivateMethod(f); return PrivateMethod.call(f); }],
  ["private names are not listed", f => { new PrivateField(f); new PrivateMethod(f); return [Reflect.ownKeys(f).map(String), Object.getOwnPropertyNames(f)]; }],
  ["Object.assign", f => { Object.assign(f, { a: 1, [symbol]: 2 }); return [f.a, f[symbol]]; }],
  ["Object.defineProperties", f => { Object.defineProperties(f, { a: { value: 1 }, b: { get() { return 2; } } }); return [f.a, f.b, Object.keys(f)]; }],
  ["Reflect.set with it as the receiver", f => [Reflect.set({}, "x", 1, f), f.x]],
  ["Reflect.defineProperty", f => [Reflect.defineProperty(f, "x", { value: 1 }), f.x]],
  ["an index", f => { f[0] = 1; f[5] = 2; return [f[0], f[5], Object.keys(f)]; }],
  ["a large index", f => { const n = Number("4294967295"); f[n] = 1; f[n - 1] = 2; return Object.keys(f); }],
  ["an index with a getter", f => { Object.defineProperty(f, 1, { get() { return "got"; } }); return f[1]; }],
  ["Error.captureStackTrace", f => { Error.captureStackTrace(f); return typeof f.stack; }],
  ["another prototype", f => { const p = { inherited: 1 }; Object.setPrototypeOf(f, p); return [f.inherited, typeof f.call]; }],
  ["no prototype", f => { Object.setPrototypeOf(f, null); return [typeof f.call, typeof f]; }],
  ["__proto__ assigned", f => { f.__proto__ = { inherited: 2 }; return f.inherited; }],
  ["sealed", f => { Object.seal(f); f.x = 1; return [Object.isSealed(f), f.x, Object.isExtensible(f)]; }],
  ["as a prototype", f => { const o = Object.create(f); f.given = 1; return [o.given, typeof o, Object.getPrototypeOf(o) === f]; }],
  ["as a prototype, then private", f => { const o = Object.create(f); new PrivateField(f); return [PrivateField.has(f), PrivateField.has(o)]; }],
  ["weak holders", f => { const m = new WeakMap([[f, 1]]), s = new WeakSet([f]), r = new WeakRef(f); new FinalizationRegistry(() => { }).register(f, 1); return [m.get(f), s.has(f), r.deref() === f]; }],
  ["behind a proxy", f => { const p = new Proxy(f, {}); p.x = 1; new PrivateField(p); return [f.x, PrivateField.has(p), PrivateField.has(f), typeof p]; }],
  ["deleted name", f => [delete f.name, delete f.length, f.name, f.length, Object.getOwnPropertyNames(f).filter(n => n !== "prototype")]],
];

export function run(log) {
  for (const [door, pass] of doors) {
    const answers = [];
    for (const [kind, make] of makers()) {
      const f = make();
      const answer = attempt(() => pass(f));
      let called;
      try { const r = f(); called = r && typeof r.then === "function" ? "promise" : r; } catch (e) { called = "throws " + e.constructor.name; }
      answers.push([kind, answer + " | typeof " + typeof f + " | called " + called]);
    }
    const first = answers[0][1];
    if (answers.every(a => a[1] === first)) log(door + ": all: " + first);
    else for (const [kind, answer] of answers) log(door + ": " + kind + ": " + answer);
  }
  for (const [kind, make] of makers()) {
    let right = 0;
    for (let i = 0; i < 400; i++) { const f = make(); if (i % 3 === 0) new PrivateField(f); if (i % 5 === 0) new PublicFields(f); if (PrivateField.has(f) === (i % 3 === 0) && (f.plain === 1) === (i % 5 === 0)) right++; }
    log("many of them: " + kind + ": " + right);
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="run"
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="run"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3, v0 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
