// The programs of untyped-code that are mostly a loop written out: thousands of fields, variables or functions that differ in a number.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "closures-as-prototypes-then-changed.js": text(
      `// Functions that serve as prototypes of other objects and then get, lose or change properties.
const T = v => typeof v === "function" ? "function" : typeof v === "object" && v !== null ? "object" : String(v);
const out = [];`,
      [
        `delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;	deleted
delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;	deleted, another name takes the slot
delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;	deleted, two names added
Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });	made an accessor
F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;	made another value
F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;	made a function
Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });	made read-only
delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;	its own parent changed
for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;	many names added
Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { 	frozen`,
        (n, a, b) => `{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r${n + 1} = x => x.bar, i${n + 1} = x => "bar" in x, c${n + 1} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 1} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 1}(x)), i${n + 1}(x), T(c${n + 1}(x)), o${n + 1}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${a} } catch (e) { out.push(e.name); } const d = all();
  console.log('arrow, ${b}' + ": " + [a, b, d].join(" | ")); }`,
      ],
      `{ const F = () => 1, H = Object.create(F), HH = Object.create(H);
  const r11 = x => x.bar, i11 = x => "bar" in x, c11 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o11 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r11(x)), i11(x), T(c11(x)), o11(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `arrow, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
capturing arrow, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
capturing arrow, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
capturing arrow, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
capturing arrow, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
capturing arrow, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
capturing arrow, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
capturing arrow, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
capturing arrow, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
capturing arrow, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log('${a}].join(" | ")); }
{ const F = (c => () => c)(${n + 12}), H = Object.create(F), HH = Object.create(H);
  const r${n + 12} = x => x.bar, i${n + 12} = x => "bar" in x, c${n + 12} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 12} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 12}(x)), i${n + 12}(x), T(c${n + 12}(x)), o${n + 12}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('capturing arrow, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = (c => () => c)(22), H = Object.create(F), HH = Object.create(H);
  const r22 = x => x.bar, i22 = x => "bar" in x, c22 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o22 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r22(x)), i22(x), T(c22(x)), o22(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `capturing arrow, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function expression, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
function expression, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function expression, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
function expression, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function expression, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function expression, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
function expression, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
function expression, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function expression, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log('${a}].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r${n + 23} = x => x.bar, i${n + 23} = x => "bar" in x, c${n + 23} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 23} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 23}(x)), i${n + 23}(x), T(c${n + 23}(x)), o${n + 23}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('function expression, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = function () { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r33 = x => x.bar, i33 = x => "bar" in x, c33 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o33 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r33(x)), i33(x), T(c33(x)), o33(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `function expression, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
named expression, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
named expression, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
named expression, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
named expression, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
named expression, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
named expression, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
named expression, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
named expression, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
named expression, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log('${a}].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r${n + 34} = x => x.bar, i${n + 34} = x => "bar" in x, c${n + 34} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 34} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 34}(x)), i${n + 34}(x), T(c${n + 34}(x)), o${n + 34}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('named expression, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = function named() { return 1; }, H = Object.create(F), HH = Object.create(H);
  const r44 = x => x.bar, i44 = x => "bar" in x, c44 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o44 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r44(x)), i44(x), T(c44(x)), o44(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `named expression, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
method, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
method, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
method, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
method, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
method, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
method, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
method, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
method, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
method, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log('${a}].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r${n + 45} = x => x.bar, i${n + 45} = x => "bar" in x, c${n + 45} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 45} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 45}(x)), i${n + 45}(x), T(c${n + 45}(x)), o${n + 45}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('method, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = ({ m() { return 1; } }).m, H = Object.create(F), HH = Object.create(H);
  const r55 = x => x.bar, i55 = x => "bar" in x, c55 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o55 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r55(x)), i55(x), T(c55(x)), o55(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `'method, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
"getter's function, deleted" + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
"getter's function, deleted, another name takes the slot" + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
"getter's function, deleted, two names added" + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
"getter's function, made an accessor" + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
"getter's function, made another value" + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
"getter's function, made a function" + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
"getter's function, made read-only" + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
"getter's function, its own parent changed" + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
"getter's function, many names added" + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log(${a}].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r${n + 56} = x => x.bar, i${n + 56} = x => "bar" in x, c${n + 56} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 56} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 56}(x)), i${n + 56}(x), T(c${n + 56}(x)), o${n + 56}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log("getter's function, frozen" + ": " + [a, b, d].join(" | ")); }
{ const F = Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, H = Object.create(F), HH = Object.create(H);
  const r66 = x => x.bar, i66 = x => "bar" in x, c66 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o66 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r66(x)), i66(x), T(c66(x)), o66(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `"getter's function, absent first, then stored" + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
'async arrow, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
'async arrow, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
'async arrow, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
'async arrow, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
'async arrow, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
'async arrow, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
'async arrow, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
'async arrow, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
'async arrow, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log(${a}].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r${n + 67} = x => x.bar, i${n + 67} = x => "bar" in x, c${n + 67} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 67} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 67}(x)), i${n + 67}(x), T(c${n + 67}(x)), o${n + 67}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('async arrow, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = async () => 1, H = Object.create(F), HH = Object.create(H);
  const r77 = x => x.bar, i77 = x => "bar" in x, c77 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o77 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r77(x)), i77(x), T(c77(x)), o77(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `arrow, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
function, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
function, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
function, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
function, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
function, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log('async ${a}].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r${n + 78} = x => x.bar, i${n + 78} = x => "bar" in x, c${n + 78} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 78} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 78}(x)), i${n + 78}(x), T(c${n + 78}(x)), o${n + 78}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('async function, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = async function () {}, H = Object.create(F), HH = Object.create(H);
  const r88 = x => x.bar, i88 = x => "bar" in x, c88 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o88 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r88(x)), i88(x), T(c88(x)), o88(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `async function, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
generator function, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
generator function, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
generator function, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
generator function, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
generator function, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
generator function, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
generator function, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
generator function, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
generator function, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log('${a}].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r${n + 89} = x => x.bar, i${n + 89} = x => "bar" in x, c${n + 89} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 89} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 89}(x)), i${n + 89}(x), T(c${n + 89}(x)), o${n + 89}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('generator function, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = function* () {}, H = Object.create(F), HH = Object.create(H);
  const r99 = x => x.bar, i99 = x => "bar" in x, c99 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o99 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r99(x)), i99(x), T(c99(x)), o99(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `generator function, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
class, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
class, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
class, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
class, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
class, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
class, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
class, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
class, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
class, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log('${a}].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r${n + 100} = x => x.bar, i${n + 100} = x => "bar" in x, c${n + 100} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 100} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 100}(x)), i${n + 100}(x), T(c${n + 100}(x)), o${n + 100}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('class, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = class { static s() {} }, H = Object.create(F), HH = Object.create(H);
  const r110 = x => x.bar, i110 = x => "bar" in x, c110 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o110 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r110(x)), i110(x), T(c110(x)), o110(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
 with a parent, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
 with a parent, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
 with a parent, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
 with a parent, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
 with a parent, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
 with a parent, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
 with a parent, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
 with a parent, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
 with a parent, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log('class${a}].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r${n + 111} = x => x.bar, i${n + 111} = x => "bar" in x, c${n + 111} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 111} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 111}(x)), i${n + 111}(x), T(c${n + 111}(x)), o${n + 111}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('class with a parent, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = class extends Object {}, H = Object.create(F), HH = Object.create(H);
  const r121 = x => x.bar, i121 = x => "bar" in x, c121 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o121 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r121(x)), i121(x), T(c121(x)), o121(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();`,
      [
        `class with a parent, absent first, then stored' + ": " + [a, b, d, e	delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
bound, deleted' + ": " + [a, b, d	delete F.bar; F.baz = "other"; } catch (e) { out.push(e.name); } const b = all(); try { delete F.baz; F.bar = 7;
bound, deleted, another name takes the slot' + ": " + [a, b, d	delete F.bar; F.b1 = "o1"; F.b2 = "o2"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
bound, deleted, two names added' + ": " + [a, b, d	Object.defineProperty(F, "bar", { get() { return "got"; }, configurable: true }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true, configurable: true });
bound, made an accessor' + ": " + [a, b, d	F.bar = "second"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
bound, made another value' + ": " + [a, b, d	F.bar = () => "called"; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
bound, made a function' + ": " + [a, b, d	Object.defineProperty(F, "bar", { value: 8, writable: false }); } catch (e) { out.push(e.name); } const b = all(); try { Object.defineProperty(F, "bar", { value: 7, writable: true });
bound, made read-only' + ": " + [a, b, d	delete F.bar; Object.setPrototypeOf(F, { bar: "from the new parent" }); } catch (e) { out.push(e.name); } const b = all(); try { Object.setPrototypeOf(F, Function.prototype); F.bar = 7;
bound, its own parent changed' + ": " + [a, b, d	for (let i = 0; i < 70; i++) F["k" + i] = i; delete F.bar; } catch (e) { out.push(e.name); } const b = all(); try { F.bar = 7;
bound, many names added' + ": " + [a, b, d	Object.freeze(F); } catch (e) { out.push(e.name); } const b = all(); try { `,
        (n, a, b) => `  console.log('${a}].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r${n + 122} = x => x.bar, i${n + 122} = x => "bar" in x, c${n + 122} = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o${n + 122} = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r${n + 122}(x)), i${n + 122}(x), T(c${n + 122}(x)), o${n + 122}(x)].join("/")).join(" ");
  F.bar = 7; let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; try { ${b} } catch (e) { out.push(e.name); } const d = all();`,
      ],
      `  console.log('bound, frozen' + ": " + [a, b, d].join(" | ")); }
{ const F = (() => 1).bind(null), H = Object.create(F), HH = Object.create(H);
  const r132 = x => x.bar, i132 = x => "bar" in x, c132 = x => { const f = x.bar; return typeof f === "function" ? f() : "no call"; }, o132 = x => Object.hasOwn(x, "bar");
  const all = () => [F, H, HH].map(x => [T(r132(x)), i132(x), T(c132(x)), o132(x)].join("/")).join(" ");
  let s = ""; for (let q = 0; q < 4; q++) s = all(); const a = s; F.bar = 7; const b = all(); delete F.bar; const d = all(); H.bar = "on the heir"; const e = all();
  console.log('bound, absent first, then stored' + ": " + [a, b, d, e].join(" | ")); }
const shown = x => [T(x.name), T(x.length), T(x.prototype), "prototype" in x, Object.hasOwn(x, "prototype")].join("/");
for (const F of [() => 1, (c => () => c)(0), function () { return 1; }, function named() { return 1; }, ({ m() { return 1; } }).m, Object.getOwnPropertyDescriptor({ get g() { return 1; } }, "g").get, async () => 1, async function () {}, function* () {}, class { static s() {} }, class extends Object {}, (() => 1).bind(null)]) console.log("shown: " + [F, Object.create(F)].map(shown).join(" "));
console.log("errors " + out.join());
`,
    ),
    "every-queried-name-has-own-slot.js": text(
      `// More names are asked of one object than any power of two below the number of names can keep apart. Each name has a place of its own in the table by name: once a name has been asked of a kind of object, the run time is not asked again.
function read0(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n} | 0; s += o.a${10 * n + 1} | 0; s += o.a${10 * n + 2} | 0; s += o.a${10 * n + 3} | 0; s += o.a${10 * n + 4} | 0; s += o.a${10 * n + 5} | 0; s += o.a${10 * n + 6} | 0; s += o.a${10 * n + 7} | 0; s += o.a${10 * n + 8} | 0; s += o.a${10 * n + 9} | 0;`,
      ],
      `  return s;
}
function read1(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n + 460} | 0; s += o.a${10 * n + 461} | 0; s += o.a${10 * n + 462} | 0; s += o.a${10 * n + 463} | 0; s += o.a${10 * n + 464} | 0; s += o.a${10 * n + 465} | 0; s += o.a${10 * n + 466} | 0; s += o.a${10 * n + 467} | 0; s += o.a${10 * n + 468} | 0; s += o.a${10 * n + 469} | 0;`,
      ],
      `  return s;
}
function read2(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n + 920} | 0; s += o.a${10 * n + 921} | 0; s += o.a${10 * n + 922} | 0; s += o.a${10 * n + 923} | 0; s += o.a${10 * n + 924} | 0; s += o.a${10 * n + 925} | 0; s += o.a${10 * n + 926} | 0; s += o.a${10 * n + 927} | 0; s += o.a${10 * n + 928} | 0; s += o.a${10 * n + 929} | 0;`,
      ],
      `  return s;
}
function read3(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n + 1380} | 0; s += o.a${10 * n + 1381} | 0; s += o.a${10 * n + 1382} | 0; s += o.a${10 * n + 1383} | 0; s += o.a${10 * n + 1384} | 0; s += o.a${10 * n + 1385} | 0; s += o.a${10 * n + 1386} | 0; s += o.a${10 * n + 1387} | 0; s += o.a${10 * n + 1388} | 0; s += o.a${10 * n + 1389} | 0;`,
      ],
      `  return s;
}
function read4(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n + 1840} | 0; s += o.a${10 * n + 1841} | 0; s += o.a${10 * n + 1842} | 0; s += o.a${10 * n + 1843} | 0; s += o.a${10 * n + 1844} | 0; s += o.a${10 * n + 1845} | 0; s += o.a${10 * n + 1846} | 0; s += o.a${10 * n + 1847} | 0; s += o.a${10 * n + 1848} | 0; s += o.a${10 * n + 1849} | 0;`,
      ],
      `  return s;
}
function read5(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n + 2300} | 0; s += o.a${10 * n + 2301} | 0; s += o.a${10 * n + 2302} | 0; s += o.a${10 * n + 2303} | 0; s += o.a${10 * n + 2304} | 0; s += o.a${10 * n + 2305} | 0; s += o.a${10 * n + 2306} | 0; s += o.a${10 * n + 2307} | 0; s += o.a${10 * n + 2308} | 0; s += o.a${10 * n + 2309} | 0;`,
      ],
      `  return s;
}
function read6(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n + 2760} | 0; s += o.a${10 * n + 2761} | 0; s += o.a${10 * n + 2762} | 0; s += o.a${10 * n + 2763} | 0; s += o.a${10 * n + 2764} | 0; s += o.a${10 * n + 2765} | 0; s += o.a${10 * n + 2766} | 0; s += o.a${10 * n + 2767} | 0; s += o.a${10 * n + 2768} | 0; s += o.a${10 * n + 2769} | 0;`,
      ],
      `  return s;
}
function read7(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n + 3220} | 0; s += o.a${10 * n + 3221} | 0; s += o.a${10 * n + 3222} | 0; s += o.a${10 * n + 3223} | 0; s += o.a${10 * n + 3224} | 0; s += o.a${10 * n + 3225} | 0; s += o.a${10 * n + 3226} | 0; s += o.a${10 * n + 3227} | 0; s += o.a${10 * n + 3228} | 0; s += o.a${10 * n + 3229} | 0;`,
      ],
      `  return s;
}
function read8(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n + 3680} | 0; s += o.a${10 * n + 3681} | 0; s += o.a${10 * n + 3682} | 0; s += o.a${10 * n + 3683} | 0; s += o.a${10 * n + 3684} | 0; s += o.a${10 * n + 3685} | 0; s += o.a${10 * n + 3686} | 0; s += o.a${10 * n + 3687} | 0; s += o.a${10 * n + 3688} | 0; s += o.a${10 * n + 3689} | 0;`,
      ],
      `  return s;
}
function read9(o) {
  let s = 0;`,
      [
        46,
        n =>
          `  s += o.a${10 * n + 4140} | 0; s += o.a${10 * n + 4141} | 0; s += o.a${10 * n + 4142} | 0; s += o.a${10 * n + 4143} | 0; s += o.a${10 * n + 4144} | 0; s += o.a${10 * n + 4145} | 0; s += o.a${10 * n + 4146} | 0; s += o.a${10 * n + 4147} | 0; s += o.a${10 * n + 4148} | 0; s += o.a${10 * n + 4149} | 0;`,
      ],
      `  return s;
}
const readers = [read0, read1, read2, read3, read4, read5, read6, read7, read8, read9];
const readAll = o => { let s = 0; for (const read of readers) s = Math.imul(s, 31) + read(o) | 0; return s; };
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const visits = () => count("operationAOTGetByIdAndCache");
class Parent {
  get a7() { return 7; } get a2055() { return 2055; } get a4103() { return 4103; }
  a11() { return 11; } a2059() { return 2059; }
}
Parent.prototype.a13 = 13;
Parent.prototype.a2061 = 2061;
Parent.prototype.a4109 = 4109;
class Child extends Parent { constructor() { super(); this.a17 = 17; this.a2065 = 2065; this.a4113 = 4113; } }
const kinds = [{}, { a1: 1, a2049: 2049, a4097: 4097 }, new Parent(), new Child(), Object.create(null)];
const sums = () => kinds.map(readAll).join();
console.log(sums());
sums();
const before = visits();
let same = true;
const first = sums();
for (let round = 0; round < 4; round++) same = sums() === first && same;
const visited = visits() - before;
console.log("every round reads the same:", same);
console.log("23000 names of five kinds of objects, five rounds: the run time is asked at most a hundred times:", typeof aotOperationCount !== "function" || visited <= 100);
Parent.prototype.a4300 = 4300;
Object.defineProperty(Parent.prototype, "a2252", { get() { return 2252; }, configurable: true });
console.log(sums());
delete Parent.prototype.a2061;
kinds[1].a204 = 204;
console.log(sums());
`,
    ),
    "every-queried-name-has-own-slot.json": text(
      `{
  "env": {
    "JSC_aotCountsPath": "/dev/null"
  }
}
`,
    ),
    "more-escaped-literals-than-walk-limit.ts": text(
      `// Three hundred object literals, each with a literal within, are let out as \`unknown\` and changed by code that says nothing of its types. Nobody wrote their types. Every seventh has the structure of another one far off. Typed code reads them afterwards.
function alter(value: any, to: unknown) {
  value.inner.shared = to;
  value.inner.added = true;
  delete value.own;
}
const seen: string[] = [];`,
      [
        51,
        n => `const kept${3 * n} = { own: ${3 * n}, inner: { shared: ${3 * n}, m${3 * n}: "m${3 * n}" } };
const out${3 * n}: unknown = [kept${3 * n}].at(0);
alter(out${3 * n}, "text ${3 * n}");
seen.push(typeof kept${3 * n}.inner.shared + " " + String(kept${3 * n}.inner.shared) + " " + kept${3 * n}.inner.m${3 * n} + " " + ("own" in kept${3 * n}) + " " + Object.keys(kept${3 * n}.inner).join());
const kept${3 * n + 1} = { own: ${3 * n + 1}, inner: { shared: ${3 * n + 1}, m${3 * n + 1}: "m${3 * n + 1}" } };
const out${3 * n + 1}: unknown = [kept${3 * n + 1}].at(0);
alter(out${3 * n + 1}, null);
seen.push(typeof kept${3 * n + 1}.inner.shared + " " + String(kept${3 * n + 1}.inner.shared) + " " + kept${3 * n + 1}.inner.m${3 * n + 1} + " " + ("own" in kept${3 * n + 1}) + " " + Object.keys(kept${3 * n + 1}.inner).join());
const kept${3 * n + 2} = { own: ${3 * n + 2}, inner: { shared: ${3 * n + 2}, m${3 * n + 2}: "m${3 * n + 2}" } };
const out${3 * n + 2}: unknown = [kept${3 * n + 2}].at(0);
alter(out${3 * n + 2}, [${3 * n + 2}]);
seen.push(typeof kept${3 * n + 2}.inner.shared + " " + String(kept${3 * n + 2}.inner.shared) + " " + kept${3 * n + 2}.inner.m${3 * n + 2} + " " + ("own" in kept${3 * n + 2}) + " " + Object.keys(kept${3 * n + 2}.inner).join());`,
      ],
      [
        2,
        n => `const kept${9 * n + 153} = { own: ${9 * n + 153}, inner: { shared: ${9 * n + 153}, m${9 * n + 153}: "m${9 * n + 153}" } };
const out${9 * n + 153}: unknown = [kept${9 * n + 153}].at(0);
alter(out${9 * n + 153}, "text ${9 * n + 153}");
seen.push(typeof kept${9 * n + 153}.inner.shared + " " + String(kept${9 * n + 153}.inner.shared) + " " + kept${9 * n + 153}.inner.m${9 * n + 153} + " " + ("own" in kept${9 * n + 153}) + " " + Object.keys(kept${9 * n + 153}.inner).join());
const kept${9 * n + 154} = { own: ${9 * n + 154}, inner: { shared: ${9 * n + 154}, m${159 * n + 4}: "m${159 * n + 4}" } };
const out${9 * n + 154}: unknown = [kept${9 * n + 154}].at(0);
alter(out${9 * n + 154}, null);
seen.push(typeof kept${9 * n + 154}.inner.shared + " " + String(kept${9 * n + 154}.inner.shared) + " " + kept${9 * n + 154}.inner.m${159 * n + 4} + " " + ("own" in kept${9 * n + 154}) + " " + Object.keys(kept${9 * n + 154}.inner).join());
const kept${9 * n + 155} = { own: ${9 * n + 155}, inner: { shared: ${9 * n + 155}, m${9 * n + 155}: "m${9 * n + 155}" } };
const out${9 * n + 155}: unknown = [kept${9 * n + 155}].at(0);
alter(out${9 * n + 155}, [${9 * n + 155}]);
seen.push(typeof kept${9 * n + 155}.inner.shared + " " + String(kept${9 * n + 155}.inner.shared) + " " + kept${9 * n + 155}.inner.m${9 * n + 155} + " " + ("own" in kept${9 * n + 155}) + " " + Object.keys(kept${9 * n + 155}.inner).join());
const kept${9 * n + 156} = { own: ${9 * n + 156}, inner: { shared: ${9 * n + 156}, m${9 * n + 156}: "m${9 * n + 156}" } };
const out${9 * n + 156}: unknown = [kept${9 * n + 156}].at(0);
alter(out${9 * n + 156}, "text ${9 * n + 156}");
seen.push(typeof kept${9 * n + 156}.inner.shared + " " + String(kept${9 * n + 156}.inner.shared) + " " + kept${9 * n + 156}.inner.m${9 * n + 156} + " " + ("own" in kept${9 * n + 156}) + " " + Object.keys(kept${9 * n + 156}.inner).join());
const kept${9 * n + 157} = { own: ${9 * n + 157}, inner: { shared: ${9 * n + 157}, m${9 * n + 157}: "m${9 * n + 157}" } };
const out${9 * n + 157}: unknown = [kept${9 * n + 157}].at(0);
alter(out${9 * n + 157}, null);
seen.push(typeof kept${9 * n + 157}.inner.shared + " " + String(kept${9 * n + 157}.inner.shared) + " " + kept${9 * n + 157}.inner.m${9 * n + 157} + " " + ("own" in kept${9 * n + 157}) + " " + Object.keys(kept${9 * n + 157}.inner).join());
const kept${9 * n + 158} = { own: ${9 * n + 158}, inner: { shared: ${9 * n + 158}, m${9 * n + 158}: "m${9 * n + 158}" } };
const out${9 * n + 158}: unknown = [kept${9 * n + 158}].at(0);
alter(out${9 * n + 158}, [${9 * n + 158}]);
seen.push(typeof kept${9 * n + 158}.inner.shared + " " + String(kept${9 * n + 158}.inner.shared) + " " + kept${9 * n + 158}.inner.m${9 * n + 158} + " " + ("own" in kept${9 * n + 158}) + " " + Object.keys(kept${9 * n + 158}.inner).join());
const kept${9 * n + 159} = { own: ${9 * n + 159}, inner: { shared: ${9 * n + 159}, m${159 - 141 * n}: "m${159 - 141 * n}" } };
const out${9 * n + 159}: unknown = [kept${9 * n + 159}].at(0);
alter(out${9 * n + 159}, "text ${9 * n + 159}");
seen.push(typeof kept${9 * n + 159}.inner.shared + " " + String(kept${9 * n + 159}.inner.shared) + " " + kept${9 * n + 159}.inner.m${159 - 141 * n} + " " + ("own" in kept${9 * n + 159}) + " " + Object.keys(kept${9 * n + 159}.inner).join());
const kept${9 * n + 160} = { own: ${9 * n + 160}, inner: { shared: ${9 * n + 160}, m${9 * n + 160}: "m${9 * n + 160}" } };
const out${9 * n + 160}: unknown = [kept${9 * n + 160}].at(0);
alter(out${9 * n + 160}, null);
seen.push(typeof kept${9 * n + 160}.inner.shared + " " + String(kept${9 * n + 160}.inner.shared) + " " + kept${9 * n + 160}.inner.m${9 * n + 160} + " " + ("own" in kept${9 * n + 160}) + " " + Object.keys(kept${9 * n + 160}.inner).join());
const kept${9 * n + 161} = { own: ${9 * n + 161}, inner: { shared: ${9 * n + 161}, m${159 * n + 11}: "m${159 * n + 11}" } };
const out${9 * n + 161}: unknown = [kept${9 * n + 161}].at(0);
alter(out${9 * n + 161}, [${9 * n + 161}]);
seen.push(typeof kept${9 * n + 161}.inner.shared + " " + String(kept${9 * n + 161}.inner.shared) + " " + kept${9 * n + 161}.inner.m${159 * n + 11} + " " + ("own" in kept${9 * n + 161}) + " " + Object.keys(kept${9 * n + 161}.inner).join());`,
      ],
      [
        2,
        n => `const kept${9 * n + 171} = { own: ${9 * n + 171}, inner: { shared: ${9 * n + 171}, m${9 * n + 171}: "m${9 * n + 171}" } };
const out${9 * n + 171}: unknown = [kept${9 * n + 171}].at(0);
alter(out${9 * n + 171}, "text ${9 * n + 171}");
seen.push(typeof kept${9 * n + 171}.inner.shared + " " + String(kept${9 * n + 171}.inner.shared) + " " + kept${9 * n + 171}.inner.m${9 * n + 171} + " " + ("own" in kept${9 * n + 171}) + " " + Object.keys(kept${9 * n + 171}.inner).join());
const kept${9 * n + 172} = { own: ${9 * n + 172}, inner: { shared: ${9 * n + 172}, m${9 * n + 172}: "m${9 * n + 172}" } };
const out${9 * n + 172}: unknown = [kept${9 * n + 172}].at(0);
alter(out${9 * n + 172}, null);
seen.push(typeof kept${9 * n + 172}.inner.shared + " " + String(kept${9 * n + 172}.inner.shared) + " " + kept${9 * n + 172}.inner.m${9 * n + 172} + " " + ("own" in kept${9 * n + 172}) + " " + Object.keys(kept${9 * n + 172}.inner).join());
const kept${9 * n + 173} = { own: ${9 * n + 173}, inner: { shared: ${9 * n + 173}, m${173 - 141 * n}: "m${173 - 141 * n}" } };
const out${9 * n + 173}: unknown = [kept${9 * n + 173}].at(0);
alter(out${9 * n + 173}, [${9 * n + 173}]);
seen.push(typeof kept${9 * n + 173}.inner.shared + " " + String(kept${9 * n + 173}.inner.shared) + " " + kept${9 * n + 173}.inner.m${173 - 141 * n} + " " + ("own" in kept${9 * n + 173}) + " " + Object.keys(kept${9 * n + 173}.inner).join());
const kept${9 * n + 174} = { own: ${9 * n + 174}, inner: { shared: ${9 * n + 174}, m${9 * n + 174}: "m${9 * n + 174}" } };
const out${9 * n + 174}: unknown = [kept${9 * n + 174}].at(0);
alter(out${9 * n + 174}, "text ${9 * n + 174}");
seen.push(typeof kept${9 * n + 174}.inner.shared + " " + String(kept${9 * n + 174}.inner.shared) + " " + kept${9 * n + 174}.inner.m${9 * n + 174} + " " + ("own" in kept${9 * n + 174}) + " " + Object.keys(kept${9 * n + 174}.inner).join());
const kept${9 * n + 175} = { own: ${9 * n + 175}, inner: { shared: ${9 * n + 175}, m${159 * n + 25}: "m${159 * n + 25}" } };
const out${9 * n + 175}: unknown = [kept${9 * n + 175}].at(0);
alter(out${9 * n + 175}, null);
seen.push(typeof kept${9 * n + 175}.inner.shared + " " + String(kept${9 * n + 175}.inner.shared) + " " + kept${9 * n + 175}.inner.m${159 * n + 25} + " " + ("own" in kept${9 * n + 175}) + " " + Object.keys(kept${9 * n + 175}.inner).join());
const kept${9 * n + 176} = { own: ${9 * n + 176}, inner: { shared: ${9 * n + 176}, m${9 * n + 176}: "m${9 * n + 176}" } };
const out${9 * n + 176}: unknown = [kept${9 * n + 176}].at(0);
alter(out${9 * n + 176}, [${9 * n + 176}]);
seen.push(typeof kept${9 * n + 176}.inner.shared + " " + String(kept${9 * n + 176}.inner.shared) + " " + kept${9 * n + 176}.inner.m${9 * n + 176} + " " + ("own" in kept${9 * n + 176}) + " " + Object.keys(kept${9 * n + 176}.inner).join());
const kept${9 * n + 177} = { own: ${9 * n + 177}, inner: { shared: ${9 * n + 177}, m${9 * n + 177}: "m${9 * n + 177}" } };
const out${9 * n + 177}: unknown = [kept${9 * n + 177}].at(0);
alter(out${9 * n + 177}, "text ${9 * n + 177}");
seen.push(typeof kept${9 * n + 177}.inner.shared + " " + String(kept${9 * n + 177}.inner.shared) + " " + kept${9 * n + 177}.inner.m${9 * n + 177} + " " + ("own" in kept${9 * n + 177}) + " " + Object.keys(kept${9 * n + 177}.inner).join());
const kept${9 * n + 178} = { own: ${9 * n + 178}, inner: { shared: ${9 * n + 178}, m${9 * n + 178}: "m${9 * n + 178}" } };
const out${9 * n + 178}: unknown = [kept${9 * n + 178}].at(0);
alter(out${9 * n + 178}, null);
seen.push(typeof kept${9 * n + 178}.inner.shared + " " + String(kept${9 * n + 178}.inner.shared) + " " + kept${9 * n + 178}.inner.m${9 * n + 178} + " " + ("own" in kept${9 * n + 178}) + " " + Object.keys(kept${9 * n + 178}.inner).join());
const kept${9 * n + 179} = { own: ${9 * n + 179}, inner: { shared: ${9 * n + 179}, m${9 * n + 179}: "m${9 * n + 179}" } };
const out${9 * n + 179}: unknown = [kept${9 * n + 179}].at(0);
alter(out${9 * n + 179}, [${9 * n + 179}]);
seen.push(typeof kept${9 * n + 179}.inner.shared + " " + String(kept${9 * n + 179}.inner.shared) + " " + kept${9 * n + 179}.inner.m${9 * n + 179} + " " + ("own" in kept${9 * n + 179}) + " " + Object.keys(kept${9 * n + 179}.inner).join());`,
      ],
      [
        2,
        n => `const kept${9 * n + 189} = { own: ${9 * n + 189}, inner: { shared: ${9 * n + 189}, m${159 * n + 39}: "m${159 * n + 39}" } };
const out${9 * n + 189}: unknown = [kept${9 * n + 189}].at(0);
alter(out${9 * n + 189}, "text ${9 * n + 189}");
seen.push(typeof kept${9 * n + 189}.inner.shared + " " + String(kept${9 * n + 189}.inner.shared) + " " + kept${9 * n + 189}.inner.m${159 * n + 39} + " " + ("own" in kept${9 * n + 189}) + " " + Object.keys(kept${9 * n + 189}.inner).join());
const kept${9 * n + 190} = { own: ${9 * n + 190}, inner: { shared: ${9 * n + 190}, m${9 * n + 190}: "m${9 * n + 190}" } };
const out${9 * n + 190}: unknown = [kept${9 * n + 190}].at(0);
alter(out${9 * n + 190}, null);
seen.push(typeof kept${9 * n + 190}.inner.shared + " " + String(kept${9 * n + 190}.inner.shared) + " " + kept${9 * n + 190}.inner.m${9 * n + 190} + " " + ("own" in kept${9 * n + 190}) + " " + Object.keys(kept${9 * n + 190}.inner).join());
const kept${9 * n + 191} = { own: ${9 * n + 191}, inner: { shared: ${9 * n + 191}, m${9 * n + 191}: "m${9 * n + 191}" } };
const out${9 * n + 191}: unknown = [kept${9 * n + 191}].at(0);
alter(out${9 * n + 191}, [${9 * n + 191}]);
seen.push(typeof kept${9 * n + 191}.inner.shared + " " + String(kept${9 * n + 191}.inner.shared) + " " + kept${9 * n + 191}.inner.m${9 * n + 191} + " " + ("own" in kept${9 * n + 191}) + " " + Object.keys(kept${9 * n + 191}.inner).join());
const kept${9 * n + 192} = { own: ${9 * n + 192}, inner: { shared: ${9 * n + 192}, m${9 * n + 192}: "m${9 * n + 192}" } };
const out${9 * n + 192}: unknown = [kept${9 * n + 192}].at(0);
alter(out${9 * n + 192}, "text ${9 * n + 192}");
seen.push(typeof kept${9 * n + 192}.inner.shared + " " + String(kept${9 * n + 192}.inner.shared) + " " + kept${9 * n + 192}.inner.m${9 * n + 192} + " " + ("own" in kept${9 * n + 192}) + " " + Object.keys(kept${9 * n + 192}.inner).join());
const kept${9 * n + 193} = { own: ${9 * n + 193}, inner: { shared: ${9 * n + 193}, m${9 * n + 193}: "m${9 * n + 193}" } };
const out${9 * n + 193}: unknown = [kept${9 * n + 193}].at(0);
alter(out${9 * n + 193}, null);
seen.push(typeof kept${9 * n + 193}.inner.shared + " " + String(kept${9 * n + 193}.inner.shared) + " " + kept${9 * n + 193}.inner.m${9 * n + 193} + " " + ("own" in kept${9 * n + 193}) + " " + Object.keys(kept${9 * n + 193}.inner).join());
const kept${9 * n + 194} = { own: ${9 * n + 194}, inner: { shared: ${9 * n + 194}, m${194 - 141 * n}: "m${194 - 141 * n}" } };
const out${9 * n + 194}: unknown = [kept${9 * n + 194}].at(0);
alter(out${9 * n + 194}, [${9 * n + 194}]);
seen.push(typeof kept${9 * n + 194}.inner.shared + " " + String(kept${9 * n + 194}.inner.shared) + " " + kept${9 * n + 194}.inner.m${194 - 141 * n} + " " + ("own" in kept${9 * n + 194}) + " " + Object.keys(kept${9 * n + 194}.inner).join());
const kept${9 * n + 195} = { own: ${9 * n + 195}, inner: { shared: ${9 * n + 195}, m${9 * n + 195}: "m${9 * n + 195}" } };
const out${9 * n + 195}: unknown = [kept${9 * n + 195}].at(0);
alter(out${9 * n + 195}, "text ${9 * n + 195}");
seen.push(typeof kept${9 * n + 195}.inner.shared + " " + String(kept${9 * n + 195}.inner.shared) + " " + kept${9 * n + 195}.inner.m${9 * n + 195} + " " + ("own" in kept${9 * n + 195}) + " " + Object.keys(kept${9 * n + 195}.inner).join());
const kept${9 * n + 196} = { own: ${9 * n + 196}, inner: { shared: ${9 * n + 196}, m${159 * n + 46}: "m${159 * n + 46}" } };
const out${9 * n + 196}: unknown = [kept${9 * n + 196}].at(0);
alter(out${9 * n + 196}, null);
seen.push(typeof kept${9 * n + 196}.inner.shared + " " + String(kept${9 * n + 196}.inner.shared) + " " + kept${9 * n + 196}.inner.m${159 * n + 46} + " " + ("own" in kept${9 * n + 196}) + " " + Object.keys(kept${9 * n + 196}.inner).join());
const kept${9 * n + 197} = { own: ${9 * n + 197}, inner: { shared: ${9 * n + 197}, m${9 * n + 197}: "m${9 * n + 197}" } };
const out${9 * n + 197}: unknown = [kept${9 * n + 197}].at(0);
alter(out${9 * n + 197}, [${9 * n + 197}]);
seen.push(typeof kept${9 * n + 197}.inner.shared + " " + String(kept${9 * n + 197}.inner.shared) + " " + kept${9 * n + 197}.inner.m${9 * n + 197} + " " + ("own" in kept${9 * n + 197}) + " " + Object.keys(kept${9 * n + 197}.inner).join());`,
      ],
      [
        2,
        n => `const kept${9 * n + 207} = { own: ${9 * n + 207}, inner: { shared: ${9 * n + 207}, m${9 * n + 207}: "m${9 * n + 207}" } };
const out${9 * n + 207}: unknown = [kept${9 * n + 207}].at(0);
alter(out${9 * n + 207}, "text ${9 * n + 207}");
seen.push(typeof kept${9 * n + 207}.inner.shared + " " + String(kept${9 * n + 207}.inner.shared) + " " + kept${9 * n + 207}.inner.m${9 * n + 207} + " " + ("own" in kept${9 * n + 207}) + " " + Object.keys(kept${9 * n + 207}.inner).join());
const kept${9 * n + 208} = { own: ${9 * n + 208}, inner: { shared: ${9 * n + 208}, m${208 - 141 * n}: "m${208 - 141 * n}" } };
const out${9 * n + 208}: unknown = [kept${9 * n + 208}].at(0);
alter(out${9 * n + 208}, null);
seen.push(typeof kept${9 * n + 208}.inner.shared + " " + String(kept${9 * n + 208}.inner.shared) + " " + kept${9 * n + 208}.inner.m${208 - 141 * n} + " " + ("own" in kept${9 * n + 208}) + " " + Object.keys(kept${9 * n + 208}.inner).join());
const kept${9 * n + 209} = { own: ${9 * n + 209}, inner: { shared: ${9 * n + 209}, m${9 * n + 209}: "m${9 * n + 209}" } };
const out${9 * n + 209}: unknown = [kept${9 * n + 209}].at(0);
alter(out${9 * n + 209}, [${9 * n + 209}]);
seen.push(typeof kept${9 * n + 209}.inner.shared + " " + String(kept${9 * n + 209}.inner.shared) + " " + kept${9 * n + 209}.inner.m${9 * n + 209} + " " + ("own" in kept${9 * n + 209}) + " " + Object.keys(kept${9 * n + 209}.inner).join());
const kept${9 * n + 210} = { own: ${9 * n + 210}, inner: { shared: ${9 * n + 210}, m${159 * n + 60}: "m${159 * n + 60}" } };
const out${9 * n + 210}: unknown = [kept${9 * n + 210}].at(0);
alter(out${9 * n + 210}, "text ${9 * n + 210}");
seen.push(typeof kept${9 * n + 210}.inner.shared + " " + String(kept${9 * n + 210}.inner.shared) + " " + kept${9 * n + 210}.inner.m${159 * n + 60} + " " + ("own" in kept${9 * n + 210}) + " " + Object.keys(kept${9 * n + 210}.inner).join());
const kept${9 * n + 211} = { own: ${9 * n + 211}, inner: { shared: ${9 * n + 211}, m${9 * n + 211}: "m${9 * n + 211}" } };
const out${9 * n + 211}: unknown = [kept${9 * n + 211}].at(0);
alter(out${9 * n + 211}, null);
seen.push(typeof kept${9 * n + 211}.inner.shared + " " + String(kept${9 * n + 211}.inner.shared) + " " + kept${9 * n + 211}.inner.m${9 * n + 211} + " " + ("own" in kept${9 * n + 211}) + " " + Object.keys(kept${9 * n + 211}.inner).join());
const kept${9 * n + 212} = { own: ${9 * n + 212}, inner: { shared: ${9 * n + 212}, m${9 * n + 212}: "m${9 * n + 212}" } };
const out${9 * n + 212}: unknown = [kept${9 * n + 212}].at(0);
alter(out${9 * n + 212}, [${9 * n + 212}]);
seen.push(typeof kept${9 * n + 212}.inner.shared + " " + String(kept${9 * n + 212}.inner.shared) + " " + kept${9 * n + 212}.inner.m${9 * n + 212} + " " + ("own" in kept${9 * n + 212}) + " " + Object.keys(kept${9 * n + 212}.inner).join());
const kept${9 * n + 213} = { own: ${9 * n + 213}, inner: { shared: ${9 * n + 213}, m${9 * n + 213}: "m${9 * n + 213}" } };
const out${9 * n + 213}: unknown = [kept${9 * n + 213}].at(0);
alter(out${9 * n + 213}, "text ${9 * n + 213}");
seen.push(typeof kept${9 * n + 213}.inner.shared + " " + String(kept${9 * n + 213}.inner.shared) + " " + kept${9 * n + 213}.inner.m${9 * n + 213} + " " + ("own" in kept${9 * n + 213}) + " " + Object.keys(kept${9 * n + 213}.inner).join());
const kept${9 * n + 214} = { own: ${9 * n + 214}, inner: { shared: ${9 * n + 214}, m${9 * n + 214}: "m${9 * n + 214}" } };
const out${9 * n + 214}: unknown = [kept${9 * n + 214}].at(0);
alter(out${9 * n + 214}, null);
seen.push(typeof kept${9 * n + 214}.inner.shared + " " + String(kept${9 * n + 214}.inner.shared) + " " + kept${9 * n + 214}.inner.m${9 * n + 214} + " " + ("own" in kept${9 * n + 214}) + " " + Object.keys(kept${9 * n + 214}.inner).join());
const kept${9 * n + 215} = { own: ${9 * n + 215}, inner: { shared: ${9 * n + 215}, m${215 - 141 * n}: "m${215 - 141 * n}" } };
const out${9 * n + 215}: unknown = [kept${9 * n + 215}].at(0);
alter(out${9 * n + 215}, [${9 * n + 215}]);
seen.push(typeof kept${9 * n + 215}.inner.shared + " " + String(kept${9 * n + 215}.inner.shared) + " " + kept${9 * n + 215}.inner.m${215 - 141 * n} + " " + ("own" in kept${9 * n + 215}) + " " + Object.keys(kept${9 * n + 215}.inner).join());`,
      ],
      [
        2,
        n => `const kept${9 * n + 225} = { own: ${9 * n + 225}, inner: { shared: ${9 * n + 225}, m${9 * n + 225}: "m${9 * n + 225}" } };
const out${9 * n + 225}: unknown = [kept${9 * n + 225}].at(0);
alter(out${9 * n + 225}, "text ${9 * n + 225}");
seen.push(typeof kept${9 * n + 225}.inner.shared + " " + String(kept${9 * n + 225}.inner.shared) + " " + kept${9 * n + 225}.inner.m${9 * n + 225} + " " + ("own" in kept${9 * n + 225}) + " " + Object.keys(kept${9 * n + 225}.inner).join());
const kept${9 * n + 226} = { own: ${9 * n + 226}, inner: { shared: ${9 * n + 226}, m${9 * n + 226}: "m${9 * n + 226}" } };
const out${9 * n + 226}: unknown = [kept${9 * n + 226}].at(0);
alter(out${9 * n + 226}, null);
seen.push(typeof kept${9 * n + 226}.inner.shared + " " + String(kept${9 * n + 226}.inner.shared) + " " + kept${9 * n + 226}.inner.m${9 * n + 226} + " " + ("own" in kept${9 * n + 226}) + " " + Object.keys(kept${9 * n + 226}.inner).join());
const kept${9 * n + 227} = { own: ${9 * n + 227}, inner: { shared: ${9 * n + 227}, m${9 * n + 227}: "m${9 * n + 227}" } };
const out${9 * n + 227}: unknown = [kept${9 * n + 227}].at(0);
alter(out${9 * n + 227}, [${9 * n + 227}]);
seen.push(typeof kept${9 * n + 227}.inner.shared + " " + String(kept${9 * n + 227}.inner.shared) + " " + kept${9 * n + 227}.inner.m${9 * n + 227} + " " + ("own" in kept${9 * n + 227}) + " " + Object.keys(kept${9 * n + 227}.inner).join());
const kept${9 * n + 228} = { own: ${9 * n + 228}, inner: { shared: ${9 * n + 228}, m${9 * n + 228}: "m${9 * n + 228}" } };
const out${9 * n + 228}: unknown = [kept${9 * n + 228}].at(0);
alter(out${9 * n + 228}, "text ${9 * n + 228}");
seen.push(typeof kept${9 * n + 228}.inner.shared + " " + String(kept${9 * n + 228}.inner.shared) + " " + kept${9 * n + 228}.inner.m${9 * n + 228} + " " + ("own" in kept${9 * n + 228}) + " " + Object.keys(kept${9 * n + 228}.inner).join());
const kept${9 * n + 229} = { own: ${9 * n + 229}, inner: { shared: ${9 * n + 229}, m${229 - 141 * n}: "m${229 - 141 * n}" } };
const out${9 * n + 229}: unknown = [kept${9 * n + 229}].at(0);
alter(out${9 * n + 229}, null);
seen.push(typeof kept${9 * n + 229}.inner.shared + " " + String(kept${9 * n + 229}.inner.shared) + " " + kept${9 * n + 229}.inner.m${229 - 141 * n} + " " + ("own" in kept${9 * n + 229}) + " " + Object.keys(kept${9 * n + 229}.inner).join());
const kept${9 * n + 230} = { own: ${9 * n + 230}, inner: { shared: ${9 * n + 230}, m${9 * n + 230}: "m${9 * n + 230}" } };
const out${9 * n + 230}: unknown = [kept${9 * n + 230}].at(0);
alter(out${9 * n + 230}, [${9 * n + 230}]);
seen.push(typeof kept${9 * n + 230}.inner.shared + " " + String(kept${9 * n + 230}.inner.shared) + " " + kept${9 * n + 230}.inner.m${9 * n + 230} + " " + ("own" in kept${9 * n + 230}) + " " + Object.keys(kept${9 * n + 230}.inner).join());
const kept${9 * n + 231} = { own: ${9 * n + 231}, inner: { shared: ${9 * n + 231}, m${159 * n + 81}: "m${159 * n + 81}" } };
const out${9 * n + 231}: unknown = [kept${9 * n + 231}].at(0);
alter(out${9 * n + 231}, "text ${9 * n + 231}");
seen.push(typeof kept${9 * n + 231}.inner.shared + " " + String(kept${9 * n + 231}.inner.shared) + " " + kept${9 * n + 231}.inner.m${159 * n + 81} + " " + ("own" in kept${9 * n + 231}) + " " + Object.keys(kept${9 * n + 231}.inner).join());
const kept${9 * n + 232} = { own: ${9 * n + 232}, inner: { shared: ${9 * n + 232}, m${9 * n + 232}: "m${9 * n + 232}" } };
const out${9 * n + 232}: unknown = [kept${9 * n + 232}].at(0);
alter(out${9 * n + 232}, null);
seen.push(typeof kept${9 * n + 232}.inner.shared + " " + String(kept${9 * n + 232}.inner.shared) + " " + kept${9 * n + 232}.inner.m${9 * n + 232} + " " + ("own" in kept${9 * n + 232}) + " " + Object.keys(kept${9 * n + 232}.inner).join());
const kept${9 * n + 233} = { own: ${9 * n + 233}, inner: { shared: ${9 * n + 233}, m${9 * n + 233}: "m${9 * n + 233}" } };
const out${9 * n + 233}: unknown = [kept${9 * n + 233}].at(0);
alter(out${9 * n + 233}, [${9 * n + 233}]);
seen.push(typeof kept${9 * n + 233}.inner.shared + " " + String(kept${9 * n + 233}.inner.shared) + " " + kept${9 * n + 233}.inner.m${9 * n + 233} + " " + ("own" in kept${9 * n + 233}) + " " + Object.keys(kept${9 * n + 233}.inner).join());`,
      ],
      [
        2,
        n => `const kept${9 * n + 243} = { own: ${9 * n + 243}, inner: { shared: ${9 * n + 243}, m${243 - 141 * n}: "m${243 - 141 * n}" } };
const out${9 * n + 243}: unknown = [kept${9 * n + 243}].at(0);
alter(out${9 * n + 243}, "text ${9 * n + 243}");
seen.push(typeof kept${9 * n + 243}.inner.shared + " " + String(kept${9 * n + 243}.inner.shared) + " " + kept${9 * n + 243}.inner.m${243 - 141 * n} + " " + ("own" in kept${9 * n + 243}) + " " + Object.keys(kept${9 * n + 243}.inner).join());
const kept${9 * n + 244} = { own: ${9 * n + 244}, inner: { shared: ${9 * n + 244}, m${9 * n + 244}: "m${9 * n + 244}" } };
const out${9 * n + 244}: unknown = [kept${9 * n + 244}].at(0);
alter(out${9 * n + 244}, null);
seen.push(typeof kept${9 * n + 244}.inner.shared + " " + String(kept${9 * n + 244}.inner.shared) + " " + kept${9 * n + 244}.inner.m${9 * n + 244} + " " + ("own" in kept${9 * n + 244}) + " " + Object.keys(kept${9 * n + 244}.inner).join());
const kept${9 * n + 245} = { own: ${9 * n + 245}, inner: { shared: ${9 * n + 245}, m${159 * n + 95}: "m${159 * n + 95}" } };
const out${9 * n + 245}: unknown = [kept${9 * n + 245}].at(0);
alter(out${9 * n + 245}, [${9 * n + 245}]);
seen.push(typeof kept${9 * n + 245}.inner.shared + " " + String(kept${9 * n + 245}.inner.shared) + " " + kept${9 * n + 245}.inner.m${159 * n + 95} + " " + ("own" in kept${9 * n + 245}) + " " + Object.keys(kept${9 * n + 245}.inner).join());
const kept${9 * n + 246} = { own: ${9 * n + 246}, inner: { shared: ${9 * n + 246}, m${9 * n + 246}: "m${9 * n + 246}" } };
const out${9 * n + 246}: unknown = [kept${9 * n + 246}].at(0);
alter(out${9 * n + 246}, "text ${9 * n + 246}");
seen.push(typeof kept${9 * n + 246}.inner.shared + " " + String(kept${9 * n + 246}.inner.shared) + " " + kept${9 * n + 246}.inner.m${9 * n + 246} + " " + ("own" in kept${9 * n + 246}) + " " + Object.keys(kept${9 * n + 246}.inner).join());
const kept${9 * n + 247} = { own: ${9 * n + 247}, inner: { shared: ${9 * n + 247}, m${9 * n + 247}: "m${9 * n + 247}" } };
const out${9 * n + 247}: unknown = [kept${9 * n + 247}].at(0);
alter(out${9 * n + 247}, null);
seen.push(typeof kept${9 * n + 247}.inner.shared + " " + String(kept${9 * n + 247}.inner.shared) + " " + kept${9 * n + 247}.inner.m${9 * n + 247} + " " + ("own" in kept${9 * n + 247}) + " " + Object.keys(kept${9 * n + 247}.inner).join());
const kept${9 * n + 248} = { own: ${9 * n + 248}, inner: { shared: ${9 * n + 248}, m${9 * n + 248}: "m${9 * n + 248}" } };
const out${9 * n + 248}: unknown = [kept${9 * n + 248}].at(0);
alter(out${9 * n + 248}, [${9 * n + 248}]);
seen.push(typeof kept${9 * n + 248}.inner.shared + " " + String(kept${9 * n + 248}.inner.shared) + " " + kept${9 * n + 248}.inner.m${9 * n + 248} + " " + ("own" in kept${9 * n + 248}) + " " + Object.keys(kept${9 * n + 248}.inner).join());
const kept${9 * n + 249} = { own: ${9 * n + 249}, inner: { shared: ${9 * n + 249}, m${9 * n + 249}: "m${9 * n + 249}" } };
const out${9 * n + 249}: unknown = [kept${9 * n + 249}].at(0);
alter(out${9 * n + 249}, "text ${9 * n + 249}");
seen.push(typeof kept${9 * n + 249}.inner.shared + " " + String(kept${9 * n + 249}.inner.shared) + " " + kept${9 * n + 249}.inner.m${9 * n + 249} + " " + ("own" in kept${9 * n + 249}) + " " + Object.keys(kept${9 * n + 249}.inner).join());
const kept${9 * n + 250} = { own: ${9 * n + 250}, inner: { shared: ${9 * n + 250}, m${250 - 141 * n}: "m${250 - 141 * n}" } };
const out${9 * n + 250}: unknown = [kept${9 * n + 250}].at(0);
alter(out${9 * n + 250}, null);
seen.push(typeof kept${9 * n + 250}.inner.shared + " " + String(kept${9 * n + 250}.inner.shared) + " " + kept${9 * n + 250}.inner.m${250 - 141 * n} + " " + ("own" in kept${9 * n + 250}) + " " + Object.keys(kept${9 * n + 250}.inner).join());
const kept${9 * n + 251} = { own: ${9 * n + 251}, inner: { shared: ${9 * n + 251}, m${9 * n + 251}: "m${9 * n + 251}" } };
const out${9 * n + 251}: unknown = [kept${9 * n + 251}].at(0);
alter(out${9 * n + 251}, [${9 * n + 251}]);
seen.push(typeof kept${9 * n + 251}.inner.shared + " " + String(kept${9 * n + 251}.inner.shared) + " " + kept${9 * n + 251}.inner.m${9 * n + 251} + " " + ("own" in kept${9 * n + 251}) + " " + Object.keys(kept${9 * n + 251}.inner).join());`,
      ],
      [
        2,
        n => `const kept${9 * n + 261} = { own: ${9 * n + 261}, inner: { shared: ${9 * n + 261}, m${9 * n + 261}: "m${9 * n + 261}" } };
const out${9 * n + 261}: unknown = [kept${9 * n + 261}].at(0);
alter(out${9 * n + 261}, "text ${9 * n + 261}");
seen.push(typeof kept${9 * n + 261}.inner.shared + " " + String(kept${9 * n + 261}.inner.shared) + " " + kept${9 * n + 261}.inner.m${9 * n + 261} + " " + ("own" in kept${9 * n + 261}) + " " + Object.keys(kept${9 * n + 261}.inner).join());
const kept${9 * n + 262} = { own: ${9 * n + 262}, inner: { shared: ${9 * n + 262}, m${9 * n + 262}: "m${9 * n + 262}" } };
const out${9 * n + 262}: unknown = [kept${9 * n + 262}].at(0);
alter(out${9 * n + 262}, null);
seen.push(typeof kept${9 * n + 262}.inner.shared + " " + String(kept${9 * n + 262}.inner.shared) + " " + kept${9 * n + 262}.inner.m${9 * n + 262} + " " + ("own" in kept${9 * n + 262}) + " " + Object.keys(kept${9 * n + 262}.inner).join());
const kept${9 * n + 263} = { own: ${9 * n + 263}, inner: { shared: ${9 * n + 263}, m${9 * n + 263}: "m${9 * n + 263}" } };
const out${9 * n + 263}: unknown = [kept${9 * n + 263}].at(0);
alter(out${9 * n + 263}, [${9 * n + 263}]);
seen.push(typeof kept${9 * n + 263}.inner.shared + " " + String(kept${9 * n + 263}.inner.shared) + " " + kept${9 * n + 263}.inner.m${9 * n + 263} + " " + ("own" in kept${9 * n + 263}) + " " + Object.keys(kept${9 * n + 263}.inner).join());
const kept${9 * n + 264} = { own: ${9 * n + 264}, inner: { shared: ${9 * n + 264}, m${264 - 141 * n}: "m${264 - 141 * n}" } };
const out${9 * n + 264}: unknown = [kept${9 * n + 264}].at(0);
alter(out${9 * n + 264}, "text ${9 * n + 264}");
seen.push(typeof kept${9 * n + 264}.inner.shared + " " + String(kept${9 * n + 264}.inner.shared) + " " + kept${9 * n + 264}.inner.m${264 - 141 * n} + " " + ("own" in kept${9 * n + 264}) + " " + Object.keys(kept${9 * n + 264}.inner).join());
const kept${9 * n + 265} = { own: ${9 * n + 265}, inner: { shared: ${9 * n + 265}, m${9 * n + 265}: "m${9 * n + 265}" } };
const out${9 * n + 265}: unknown = [kept${9 * n + 265}].at(0);
alter(out${9 * n + 265}, null);
seen.push(typeof kept${9 * n + 265}.inner.shared + " " + String(kept${9 * n + 265}.inner.shared) + " " + kept${9 * n + 265}.inner.m${9 * n + 265} + " " + ("own" in kept${9 * n + 265}) + " " + Object.keys(kept${9 * n + 265}.inner).join());
const kept${9 * n + 266} = { own: ${9 * n + 266}, inner: { shared: ${9 * n + 266}, m${159 * n + 116}: "m${159 * n + 116}" } };
const out${9 * n + 266}: unknown = [kept${9 * n + 266}].at(0);
alter(out${9 * n + 266}, [${9 * n + 266}]);
seen.push(typeof kept${9 * n + 266}.inner.shared + " " + String(kept${9 * n + 266}.inner.shared) + " " + kept${9 * n + 266}.inner.m${159 * n + 116} + " " + ("own" in kept${9 * n + 266}) + " " + Object.keys(kept${9 * n + 266}.inner).join());
const kept${9 * n + 267} = { own: ${9 * n + 267}, inner: { shared: ${9 * n + 267}, m${9 * n + 267}: "m${9 * n + 267}" } };
const out${9 * n + 267}: unknown = [kept${9 * n + 267}].at(0);
alter(out${9 * n + 267}, "text ${9 * n + 267}");
seen.push(typeof kept${9 * n + 267}.inner.shared + " " + String(kept${9 * n + 267}.inner.shared) + " " + kept${9 * n + 267}.inner.m${9 * n + 267} + " " + ("own" in kept${9 * n + 267}) + " " + Object.keys(kept${9 * n + 267}.inner).join());
const kept${9 * n + 268} = { own: ${9 * n + 268}, inner: { shared: ${9 * n + 268}, m${9 * n + 268}: "m${9 * n + 268}" } };
const out${9 * n + 268}: unknown = [kept${9 * n + 268}].at(0);
alter(out${9 * n + 268}, null);
seen.push(typeof kept${9 * n + 268}.inner.shared + " " + String(kept${9 * n + 268}.inner.shared) + " " + kept${9 * n + 268}.inner.m${9 * n + 268} + " " + ("own" in kept${9 * n + 268}) + " " + Object.keys(kept${9 * n + 268}.inner).join());
const kept${9 * n + 269} = { own: ${9 * n + 269}, inner: { shared: ${9 * n + 269}, m${9 * n + 269}: "m${9 * n + 269}" } };
const out${9 * n + 269}: unknown = [kept${9 * n + 269}].at(0);
alter(out${9 * n + 269}, [${9 * n + 269}]);
seen.push(typeof kept${9 * n + 269}.inner.shared + " " + String(kept${9 * n + 269}.inner.shared) + " " + kept${9 * n + 269}.inner.m${9 * n + 269} + " " + ("own" in kept${9 * n + 269}) + " " + Object.keys(kept${9 * n + 269}.inner).join());`,
      ],
      [
        2,
        n => `const kept${9 * n + 279} = { own: ${9 * n + 279}, inner: { shared: ${9 * n + 279}, m${9 * n + 279}: "m${9 * n + 279}" } };
const out${9 * n + 279}: unknown = [kept${9 * n + 279}].at(0);
alter(out${9 * n + 279}, "text ${9 * n + 279}");
seen.push(typeof kept${9 * n + 279}.inner.shared + " " + String(kept${9 * n + 279}.inner.shared) + " " + kept${9 * n + 279}.inner.m${9 * n + 279} + " " + ("own" in kept${9 * n + 279}) + " " + Object.keys(kept${9 * n + 279}.inner).join());
const kept${9 * n + 280} = { own: ${9 * n + 280}, inner: { shared: ${9 * n + 280}, m${159 * n + 130}: "m${159 * n + 130}" } };
const out${9 * n + 280}: unknown = [kept${9 * n + 280}].at(0);
alter(out${9 * n + 280}, null);
seen.push(typeof kept${9 * n + 280}.inner.shared + " " + String(kept${9 * n + 280}.inner.shared) + " " + kept${9 * n + 280}.inner.m${159 * n + 130} + " " + ("own" in kept${9 * n + 280}) + " " + Object.keys(kept${9 * n + 280}.inner).join());
const kept${9 * n + 281} = { own: ${9 * n + 281}, inner: { shared: ${9 * n + 281}, m${9 * n + 281}: "m${9 * n + 281}" } };
const out${9 * n + 281}: unknown = [kept${9 * n + 281}].at(0);
alter(out${9 * n + 281}, [${9 * n + 281}]);
seen.push(typeof kept${9 * n + 281}.inner.shared + " " + String(kept${9 * n + 281}.inner.shared) + " " + kept${9 * n + 281}.inner.m${9 * n + 281} + " " + ("own" in kept${9 * n + 281}) + " " + Object.keys(kept${9 * n + 281}.inner).join());
const kept${9 * n + 282} = { own: ${9 * n + 282}, inner: { shared: ${9 * n + 282}, m${9 * n + 282}: "m${9 * n + 282}" } };
const out${9 * n + 282}: unknown = [kept${9 * n + 282}].at(0);
alter(out${9 * n + 282}, "text ${9 * n + 282}");
seen.push(typeof kept${9 * n + 282}.inner.shared + " " + String(kept${9 * n + 282}.inner.shared) + " " + kept${9 * n + 282}.inner.m${9 * n + 282} + " " + ("own" in kept${9 * n + 282}) + " " + Object.keys(kept${9 * n + 282}.inner).join());
const kept${9 * n + 283} = { own: ${9 * n + 283}, inner: { shared: ${9 * n + 283}, m${9 * n + 283}: "m${9 * n + 283}" } };
const out${9 * n + 283}: unknown = [kept${9 * n + 283}].at(0);
alter(out${9 * n + 283}, null);
seen.push(typeof kept${9 * n + 283}.inner.shared + " " + String(kept${9 * n + 283}.inner.shared) + " " + kept${9 * n + 283}.inner.m${9 * n + 283} + " " + ("own" in kept${9 * n + 283}) + " " + Object.keys(kept${9 * n + 283}.inner).join());
const kept${9 * n + 284} = { own: ${9 * n + 284}, inner: { shared: ${9 * n + 284}, m${9 * n + 284}: "m${9 * n + 284}" } };
const out${9 * n + 284}: unknown = [kept${9 * n + 284}].at(0);
alter(out${9 * n + 284}, [${9 * n + 284}]);
seen.push(typeof kept${9 * n + 284}.inner.shared + " " + String(kept${9 * n + 284}.inner.shared) + " " + kept${9 * n + 284}.inner.m${9 * n + 284} + " " + ("own" in kept${9 * n + 284}) + " " + Object.keys(kept${9 * n + 284}.inner).join());
const kept${9 * n + 285} = { own: ${9 * n + 285}, inner: { shared: ${9 * n + 285}, m${285 - 141 * n}: "m${285 - 141 * n}" } };
const out${9 * n + 285}: unknown = [kept${9 * n + 285}].at(0);
alter(out${9 * n + 285}, "text ${9 * n + 285}");
seen.push(typeof kept${9 * n + 285}.inner.shared + " " + String(kept${9 * n + 285}.inner.shared) + " " + kept${9 * n + 285}.inner.m${285 - 141 * n} + " " + ("own" in kept${9 * n + 285}) + " " + Object.keys(kept${9 * n + 285}.inner).join());
const kept${9 * n + 286} = { own: ${9 * n + 286}, inner: { shared: ${9 * n + 286}, m${9 * n + 286}: "m${9 * n + 286}" } };
const out${9 * n + 286}: unknown = [kept${9 * n + 286}].at(0);
alter(out${9 * n + 286}, null);
seen.push(typeof kept${9 * n + 286}.inner.shared + " " + String(kept${9 * n + 286}.inner.shared) + " " + kept${9 * n + 286}.inner.m${9 * n + 286} + " " + ("own" in kept${9 * n + 286}) + " " + Object.keys(kept${9 * n + 286}.inner).join());
const kept${9 * n + 287} = { own: ${9 * n + 287}, inner: { shared: ${9 * n + 287}, m${159 * n + 137}: "m${159 * n + 137}" } };
const out${9 * n + 287}: unknown = [kept${9 * n + 287}].at(0);
alter(out${9 * n + 287}, [${9 * n + 287}]);
seen.push(typeof kept${9 * n + 287}.inner.shared + " " + String(kept${9 * n + 287}.inner.shared) + " " + kept${9 * n + 287}.inner.m${159 * n + 137} + " " + ("own" in kept${9 * n + 287}) + " " + Object.keys(kept${9 * n + 287}.inner).join());`,
      ],
      `const kept297 = { own: 297, inner: { shared: 297, m297: "m297" } };
const out297: unknown = [kept297].at(0);
alter(out297, "text 297");
seen.push(typeof kept297.inner.shared + " " + String(kept297.inner.shared) + " " + kept297.inner.m297 + " " + ("own" in kept297) + " " + Object.keys(kept297.inner).join());
const kept298 = { own: 298, inner: { shared: 298, m298: "m298" } };
const out298: unknown = [kept298].at(0);
alter(out298, null);
seen.push(typeof kept298.inner.shared + " " + String(kept298.inner.shared) + " " + kept298.inner.m298 + " " + ("own" in kept298) + " " + Object.keys(kept298.inner).join());
const kept299 = { own: 299, inner: { shared: 299, m299: "m299" } };
const out299: unknown = [kept299].at(0);
alter(out299, [299]);
seen.push(typeof kept299.inner.shared + " " + String(kept299.inner.shared) + " " + kept299.inner.m299 + " " + ("own" in kept299) + " " + Object.keys(kept299.inner).join());
console.log(seen.length, seen.slice(0, 9).join(" | "));
console.log(seen.slice(140, 155).join(" | "));
console.log(seen.filter(line => line.startsWith("string")).length, seen.filter(line => line.startsWith("object")).length, seen.filter(line => line.includes("true")).length, seen.at(-1));
`,
    ),
    "more-names-than-cache-columns.js": text(
      `// Thousands of constant names are asked of one object: every answer is that of the language.
function readAll(o) {
  let s = 0;`,
      [
        433,
        n =>
          `  s = s * 3 + (o.a${6 * n} | 0) | 0; s = s * 3 + (o.a${6 * n + 1} | 0) | 0; s = s * 3 + (o.a${6 * n + 2} | 0) | 0; s = s * 3 + (o.a${6 * n + 3} | 0) | 0; s = s * 3 + (o.a${6 * n + 4} | 0) | 0; s = s * 3 + (o.a${6 * n + 5} | 0) | 0;`,
      ],
      `  s = s * 3 + (o.a2598 | 0) | 0; s = s * 3 + (o.a2599 | 0) | 0;
  return s;
}
function storeSome(o, v) {
  o.a0 = v + 0; o.a131 = v + 131; o.a262 = v + 262; o.a393 = v + 393; o.a524 = v + 524; o.a655 = v + 655; o.a786 = v + 786; o.a917 = v + 917; o.a1048 = v + 1048; o.a1179 = v + 1179; o.a1310 = v + 1310; o.a1441 = v + 1441; o.a1572 = v + 1572; o.a1703 = v + 1703; o.a1834 = v + 1834; o.a1965 = v + 1965; o.a2096 = v + 2096; o.a2227 = v + 2227; o.a2358 = v + 2358; o.a2489 = v + 2489;
}
function callSome(o) {
  return o.a7() + o.a218() + o.a429() + o.a640() + o.a851() + o.a1062() + o.a1273() + o.a1484() + o.a1695() + o.a1906() + o.a2117() + o.a2328() + o.a2539();
}
const parent = {};
for (let i = 0; i < 2600; i += 101) parent["a" + i] = i + 1;
const makers = [
  () => ({}),
  () => { const o = {}; for (let i = 0; i < 2600; i += 97) o["a" + i] = i + 2; return o; },
  () => Object.create(parent),
  () => { const o = Object.create(parent); for (let i = 0; i < 2600; i += 103) Object.defineProperty(o, "a" + i, { get() { return i + 3; }, set(v) { this.caught = v; }, configurable: true }); return o; },
  () => Object.create(null),
];
const out = [];
for (let round = 0; round < 4; round++) {
  for (const make of makers) {
    const o = make();
    const before = readAll(o);
    storeSome(o, round);
    out.push(before + ":" + readAll(o) + ":" + Object.keys(o).length + ":" + o.caught);
  }
  if (round === 1) parent.a202 = 7;
  if (round === 2) delete parent.a303;
}
console.log(out.join("\\n"));
const methods = {};
for (let i = 7; i < 2600; i += 211) methods["a" + i] = function () { return this.base + i; };
const callers = [Object.assign({ base: 1 }, methods), Object.assign(Object.create(methods), { base: 2 })];
for (let round = 0; round < 3; round++) console.log(callers.map(callSome).join());
`,
    ),
    "prototypes-change-under-many-names.js": text(
      `// Many names are read through prototypes. The prototypes change under some of the names, are given another prototype, and collections run in between. Every read must see what plain JavaScript sees.
const collect = globalThis.Bun ? full => globalThis.Bun.gc(full) : full => (full ? globalThis.fullGC() : globalThis.edenGC());
function Base() {}
function Other() {}
function Derived() {}
Derived.prototype = Object.create(Base.prototype);`,
      [
        114,
        n => `Base.prototype.m${7 * n} = function () { return 0; };
Base.prototype.m${7 * n + 1} = function () { return 1; };
Base.prototype.m${7 * n + 2} = function () { return 2; };
Base.prototype.m${7 * n + 3} = function () { return 3; };
Base.prototype.m${7 * n + 4} = function () { return 4; };
Base.prototype.m${7 * n + 5} = function () { return 5; };
Base.prototype.m${7 * n + 6} = function () { return 6; };`,
      ],
      `Base.prototype.m798 = function () { return 0; };
Base.prototype.m799 = function () { return 1; };
Other.prototype.m3 = function () { return 100000; };
function readAll(o) {
  let t = 0;`,
      [
        160,
        n => `  t += o.m${5 * n} ? o.m${5 * n}() : -1;
  t += o.m${5 * n + 1} ? o.m${5 * n + 1}() : -1;
  t += o.m${5 * n + 2} ? o.m${5 * n + 2}() : -1;
  t += o.m${5 * n + 3} ? o.m${5 * n + 3}() : -1;
  t += o.absent${5 * n + 4} === undefined ? 1 : 1000000;
  t += o.m${5 * n + 4} ? o.m${5 * n + 4}() : -1;`,
      ],
      `  return t;
}
const objects = [new Derived(), Object.create(new Derived()), Object.assign(new Derived(), { own: 1 }), Object.assign(new Derived(), { other: 2, own: 1 })];
function round(label) {
  let line = label + ":";
  for (const o of objects) line += " " + readAll(o);
  console.log(line);
}
round("as made");
collect(false);
round("behind a collection of the young");`,
      [73, n => `Derived.prototype.m${11 * n} = function () { return 1000; };`],
      `round("shadowed");
collect(true);
round("behind a full collection");`,
      [37, n => `delete Derived.prototype.m${22 * n};`],
      [16, n => `Base.prototype.absent${50 * n + 4} = 1;`],
      `round("half of them deleted, some absent ones there");`,
      [62, n => `delete Base.prototype.m${13 * n + 1};`],
      `round("some gone");
Object.setPrototypeOf(Derived.prototype, Other.prototype);
round("another prototype");
Object.setPrototypeOf(Derived.prototype, Base.prototype);
objects.length = 2;
collect(true);
round("back again, fewer objects");
for (let i = 0; i < 12; i++) {
  objects.push(Object.assign(new Derived(), { ["key" + i]: i }));
  if (i % 4 === 3) collect(i % 8 === 7);
}
round("many shapes");
`,
    ),
  });
