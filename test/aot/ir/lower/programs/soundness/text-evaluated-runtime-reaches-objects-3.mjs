// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.mjs
// Text evaluated at run time reaches objects 3.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// Text evaluated at run time reaches objects of the program: through its operands, through what they reach, through the global object, and through functions it made that travel on.
// Each case has a class of its own, an instance that the text can reach and one that it cannot.
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
const make = (...parts) => Function(...parts.slice(0, -1), glue(parts[parts.length - 1], ""));
const sleep = () => new Promise(r => setTimeout(r, 2));
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { globalThis.give = () => o; make('const o = give(); o.n = "x"; o.list.push("y")')(); delete globalThis.give; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('the global object holds a function that gives the object', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const h = { [Symbol.for('soundness')]: o }; make('h', 'const o = h[Symbol.for("soundness")]; o.n = "x"; o.list.push("y")')(h); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('a registered symbol names the field', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const D = make('B', 'return class extends B { twice() { this.n = "x"; this.list.push("y"); return 0; } }')(C); const d = new D(21); d.twice(); note(typeof d.n, d.total(), d instanceof C); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text subclasses the class', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const f = v => { o.n = v; o.list.push('y'); }; make('f', 'f("x")')(f); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text calls a function of the program with other arguments', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { note(String(make('m', 'return m.call({ n: "s" })')(o.twice))); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text calls a method of the program on another receiver', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const p = make('K', 'return new K("s")')(C); note(String(p.twice()), typeof p.n); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text constructs the class with other arguments', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { try { make('o', 'o.n = "x"; o.list.push("y"); throw o')(o); } catch (e) { note(e === o); }; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text throws the operand changed', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('o', 'delete o.n; Object.freeze(o.list); Object.setPrototypeOf(o, { twice() { return "reparented"; }, total() { return -1; } })')(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text deletes, freezes and reparents', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('o', 'let n = 0; Object.defineProperty(o, "n", { get() { return "g" + n++; } }); o.list.length = 0')(o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('text redefines a field as an accessor', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { globalThis.shared = o; (0, eval)(glue('shared.n = "x"; shared.list', '.push("y")')); delete globalThis.shared; } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('indirect eval reads the global object', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { eval(glue('o.n = "x"; o.list', '.push("y")')); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('direct eval reads a local variable', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { let local = 1; eval(glue('local', ' = "s"')); note(typeof local, local + 1); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('direct eval assigns a local variable', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { eval(glue('var fresh', ' = 5')); note(typeof fresh); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('direct eval declares a variable', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { require('node:vm').runInNewContext(glue('o.n = "x"; o.list', '.push("y")'), { o }); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('vm runs text on a sandbox', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { const vm = require('node:vm'); vm.createContext(o); vm.runInContext(glue('n = "x"; list', '.push("y")'), o); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('vm contextifies the object itself', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();
await (async () => {
  class C { constructor(n) { this.n = n; this.list = [1, 2]; } twice() { return this.n * 2; } total() { let s = 0; for (let i = 0; i < this.list.length; i++) s += this.list[i]; return s; } }
  const o = new C(21), other = new C(1), notes = [];
  const note = (...a) => notes.push(a.map(String).join(" "));
  const first = () => note(o.twice(), o.total());
  first();
  try { make('return 1')(); } catch (e) { note("threw " + e.name); }
  let after; try { after = [String(o.twice()), typeof o.n, String(o.total())].join(" "); } catch (e) { after = "threw " + e.name; }
  console.log('nothing is handed over', "|", notes.join(", "), "|", after, "|", String(other.twice()), typeof other.n, other.total());
})();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: glue make sleep f
// CHECK-LABEL: function {{*}}name="glue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="join"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="never"
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v7 = String string="x"
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = String string=""
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = Call v2, v0, v10 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=undefined|null|function flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="Function" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v4 = NewArray contents=anything
// CHECK-NEXT: v5 = PropGet v0 key="slice"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = Integer integer=-1
// CHECK-NEXT: v9 = Call v6, v0, v7, v8 calleeKey="slice" calleeName="parts.slice"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: AppendSpread v4, v10
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="glue"
// CHECK-NEXT: v14 = PropGet v0 key="length"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = Sub v15, v16
// CHECK-NEXT: v18 = ElemGet v0, v17
// CHECK-NEXT: v19 = String string=""
// CHECK-NEXT: v20 = Call v13, -, v18, v19 calleeName="glue"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: AppendElement v4, v21
// CHECK-NEXT: v23 = CallList v3, -, v4 calleeName="Function"
// CHECK-NEXT: ReturnCall v23 casts=[{declared={type=undefined|null|function flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sleep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Promise" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v3 = NewClosure function=[[f_8]]
// CHECK-NEXT: v4 = Construct v2, -, v3 calleeName="Promise"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="f"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 captures=[{type=undefined|null|[[L_9]] flags=[IsExpected]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: PropSet v0, v1 key="n"
// CHECK-NEXT: v3 = PropGet v0 key="list"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="y"
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="push" calleeName="o.list.push"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
