// Six faults that no generator here had found were each a conjunction of things that other generators draw one at a time: code laid on an object
// at run time, a second kind of value at the same place elsewhere in the program, a class that is evaluated twice, a callback that writes what
// is read right behind the call, a read in front of a store, an import that nothing uses.
// So each program here is one function over one object and one member of it, and draws every one of these independently: how the object is made,
// what else arrives at the same place, how it arrives, how the member is read first, what is done to it, how it is looked at, which module is
// imported beside it. A conjunction of five is only ever drawn if each draw has few outcomes, so every draw first picks a KIND, each as likely
// as the next, and then one spelling of that kind.
import type { Random } from "./random";

type Maker = { head?: string; prepare?: string; make: string; class?: string };
type Kinds<T> = readonly (readonly T[])[];
const drawn = <T>(random: Random, kinds: Kinds<T>): T => random.pick(random.pick(kinds));

const withSlots = ["Map", "Set", "WeakMap", "WeakSet", "Array", "Error", "TypeError", "RangeError", "AggregateError"];
const operands: Record<string, string> = { Date: "0", Promise: "() => {}", RegExp: `"a"`, AggregateError: "[]", DataView: "new ArrayBuffer(8)", URL: `"http://a.test/"`, Event: `"e"`, WeakRef: "{}" };
const withoutSlots = ["Object", "Date", "Promise", "RegExp", "EventTarget", "Event", "Uint8Array", "Float64Array", "ArrayBuffer", "DataView", "URL", "URLSearchParams", "Headers", "Blob", "AbortController", "WeakRef"];
const below = (base: string, body: string): Maker => ({ head: `class C extends ${base} {${body}}`, make: `new C(${operands[base] ?? ""})`, class: "C" });

// Every object has a member `z` that starts as 0, unless its kind is to declare none. `T` is the number of the turn.
const makers = (T: string): Kinds<Maker> => [
  [{ head: "class C { z = 0; }", make: "new C()", class: "C" }, { head: "class C { y = 7; z = 0; }", make: "new C()", class: "C" }],
  [{ head: "class C { constructor() { this.z = 0; } }", make: "new C()", class: "C" }, { head: "class C { constructor() { this.y = 7; this.z = 0; } }", make: "new C()", class: "C" }],
  [{ head: "function C() { this.z = 0; }", make: "new C()", class: "C" }],
  [{ make: "{ z: 0 }" }, { make: "{ y: 7, z: 0 }" }],
  [{ head: "class B { z = 0; }\nclass C extends B { y = 7; }", make: "new C()", class: "C" }, { head: "class B { constructor() { this.z = 0; } }\nclass C extends B { constructor() { super(); this.y = 7; } }", make: "new C()", class: "C" }],
  withSlots.map(base => below(base, " z = 0; ")),
  withSlots.map(base => below(base, "")),
  withoutSlots.flatMap(base => [below(base, " z = 0; "), below(base, "")]),
  [
    { head: "const Made = t => class { z = 0; t = t; };", prepare: `const D = Made(${T});`, make: "new D()", class: "D" },
    { head: "const Made = t => class { constructor() { this.z = 0; this.t = t; } };", prepare: `const D = Made(${T});`, make: "new D()", class: "D" },
  ],
  [
    { head: "const Base = t => class { constructor() { this.t = t; } };\nconst Heir = S => class extends S { constructor() { super(); this.z = 0; } };", prepare: `const D = Heir(Base(${T}));`, make: "new D()", class: "D" },
    { head: "const Base = t => class { t = t; };\nconst Heir = S => class extends S { z = 0; };", prepare: `const D = Heir(Base(${T}));`, make: "new D()", class: "D" },
    { prepare: `class D extends class { t = ${T}; } { z = 0; }`, make: "new D()", class: "D" },
    { head: "const Base = t => class { t = t; };\nconst Middle = S => class extends S { m = 3; };\nconst Heir = S => class extends S { z = 0; };", prepare: `const D = Heir(Middle(Base(${T})));`, make: "new D()", class: "D" },
  ],
  [{ make: "Object.assign(Object.create(null), { z: 0 })" }, { make: "Object.create({ z: 0 })" }, { make: "Object.assign((function () {}).bind(null), { z: 0 })" }, { make: "Object.assign([], { z: 0 })" }],
];

const others = (M: string): Kinds<string> => [
  ["{}"],
  [`{ ${M}: 5 }`, `{ ${M}: "t" }`, `{ w: 0, v: 0, ${M}: 1.5 }`],
  ["new (class P {})()", `new (class P { ${M} = 2; })()`, `new (class P { a = 1; ${M} = 2.5; })()`],
  ["[]", "[1.5]", `["t"]`],
  ["new Map()", "new Set()", "new WeakMap()", "new WeakSet()"],
  ["new Uint8Array(1)", "new Date(0)", `new Error("e")`, "/a/", "Promise.resolve()", "new URLSearchParams()"],
  ["new (class extends Map {})()", `new (class extends Set { ${M} = 1; })()`],
  ["Object.create(null)", "new Proxy({}, {})", "(function () {}).bind(null)", "Object(1)", `Object("s")`],
];

// [the parameter, the first statement, what the call hands in for the object itself]
const arrivals = (make: string): Kinds<[string, string, string]> => [
  [["given", `const o = given ?? ${make};`, ""]],
  [[`o = ${make}`, "", ""]],
  [["given", `const o = given || ${make};`, ""], ["given", `const o = given === undefined ? ${make} : given;`, ""], ["given", `let o = given;\n  if (!o) o = ${make};`, ""]],
  [["o", "", make]],
  [["given", `const o = [given, ${make}][given === undefined ? 1 : 0];`, ""], ["given", `const holder = { it: given ?? ${make} };\n  const o = holder.it;`, ""]],
];

const values: Kinds<string> = [["o"], ["1", "7"], ["1.5", "NaN", "-0", "2 ** 31"], [`"t"`, `""`], ["undefined", "null"], ["{}", "[]"], ["1n", "true", "Symbol.iterator"]];

const firstReads = (M: string): Kinds<string> => [[""], [""], ["see(o);", "told.push(typeof see(o));"], [`told.push(typeof o.${M});`, `told.push(o.${M} === undefined);`], [`told.push("${M}" in o);`, `told.push(Object.hasOwn(o, "${M}"));`], [`const before = o.${M};`]];

const setter = (M: string) => `set(v) { this.${M} = v; }`;
// What is done to the member M with the value V, each with what then makes it happen.
const deeds = (M: string, V: string, D: string | undefined): Kinds<string> => [
  [`o.${M} = ${V};`],
  [`o["${M}"] = ${V};`, `o.${M} ??= ${V};`, `Object.assign(o, { ${M}: ${V} });`, `Reflect.set(o, "${M}", ${V});`, `Object.defineProperty(o, "${M}", { value: ${V}, writable: true, configurable: true, enumerable: true });`],
  [`JSON.parse("0", () => Reflect.set)(o, "${M}", ${V});`, `o[JSON.parse('"${M}"')] = ${V};`, `JSON.parse("0", () => o).${M} = ${V};`],
  [
    `Object.defineProperty(o, "p", { ${setter(M)}, configurable: true });\n  o.p = ${V};`,
    `Reflect.defineProperty(o, "p", { ${setter(M)}, configurable: true });\n  o.p = ${V};`,
    `Object.defineProperty(o, "p", { set(v) { store(this, v); }, configurable: true });\n  o.p = ${V};`,
    `Object.defineProperty(o, "p", descriptor);\n  o.p = ${V};`,
    `Object.defineProperty(o, mark, { ${setter(M)}, configurable: true });\n  o[mark] = ${V};`,
  ],
  [
    `Object.defineProperty(o, "p", { get() { this.${M} = ${V}; return 0; }, configurable: true });\n  o.p;`,
    `Object.defineProperty(o, "p", { value(v) { this.${M} = v; }, configurable: true, writable: true });\n  o.p(${V});`,
    `Object.defineProperties(o, { p: { ${setter(M)}, configurable: true } });\n  o.p = ${V};`,
    `Object.defineProperty(o, "p", { set: v => { o.${M} = v; }, configurable: true });\n  o.p = ${V};`,
    `o.p = function (v) { this.${M} = v; };\n  o.p(${V});`,
    `Object.setPrototypeOf(o, { __proto__: Object.getPrototypeOf(o), ${setter(M).replace("set(", "set p(")} });\n  o.p = ${V};`,
    `Object.defineProperty(o, "p", { ${setter(M)}, configurable: true });\n  Reflect.set(o, "p", ${V});`,
  ],
  [
    `for (const e of Object.entries(laid)) Object.defineProperty(between, e[0], { get: () => laid[e[0]], configurable: true });\n  between.box(v => { state = v; }).set(${V});`,
    `for (const e of Object.entries(laid)) Object.defineProperty(between, e[0], { get: () => laid[e[0]], configurable: true });\n  between.box(v => { o.${M} = v; }).set(${V});`,
    `for (const e of Object.entries(laid)) Object.defineProperty(o, e[0], { get: () => laid[e[0]], configurable: true });\n  o.box(v => { state = v; }).set(${V});`,
  ],
  [
    `for (const k of Object.keys(laid)) Object.defineProperty(between, k, { get: () => laid[k], configurable: true });\n  between.box(v => { state = v; }).set(${V});`,
    `for (const k in laid) between[k] = laid[k];\n  between.box(v => { o.${M} = v; }).set(${V});`,
    `Object.assign(o, laid);\n  o.box(v => { state = v; }).set(${V});`,
    `laid.box(v => { state = v; }).set(${V});`,
    `[${V}].forEach(v => { o.${M} = v; });`,
    `[${V}].forEach(v => { state = v; });`,
  ],
  [`Math.max({ valueOf() { o.${M} = ${V}; return 0; } });`, `\`\${{ toString() { o.${M} = ${V}; return ""; } }}\`;`, `JSON.stringify({ toJSON() { o.${M} = ${V}; } });`, `JSON.stringify({ toJSON() { state = ${V}; } });`],
  [`delete o.${M};`, `Reflect.deleteProperty(o, "${M}");`, `Object.defineProperty(o, "${M}", { get() { return ${V}; }, set(v) {}, configurable: true });`],
  [`Object.setPrototypeOf(o, null);`, `Object.setPrototypeOf(o, Object.prototype);`, `Object.setPrototypeOf(o, { ${M}: 9 });`, `Object.freeze(o);`, `Object.preventExtensions(o);`, `Object.seal(o);`],
  ...(D
    ? ([
        [
          `delete ${D}.prototype.constructor;`,
          `Reflect.deleteProperty(${D}.prototype, "constructor");`,
          `Object.defineProperty(${D}.prototype, "constructor", { get() { return ${D}; }, configurable: true });`,
          `Object.defineProperty(${D}.prototype, "constructor", { value: Object, configurable: true, writable: true });`,
          `${D}.prototype.constructor = Object;`,
          `for (const k of Reflect.ownKeys(Other.prototype)) Object.defineProperty(${D}.prototype, k, Object.getOwnPropertyDescriptor(Other.prototype, k));`,
        ],
        [
          `Object.setPrototypeOf(${D}.prototype, { extra: 1 });`,
          `Object.setPrototypeOf(${D}, Function.prototype);`,
          `${D}.prototype.extra = 1;`,
          `Object.assign(${D}.prototype, { ${M}: 9 });`,
          `Object.defineProperty(${D}.prototype, "${M}", { get() { return 9; }, set(v) {}, configurable: true });`,
          `Object.defineProperty(${D}.prototype, "p", { ${setter(M)}, configurable: true });`,
          `Object.freeze(${D}.prototype);`,
          `${D}.prototype.toJSON = function () { return "json " + this.${M}; };`,
        ],
      ] as Kinds<string>)
    : []),
];

const keysAndKinds = 'Object.entries(o).map(e => e[0] + ":" + typeof e[1]).join()';
const looks = (M: string): Kinds<string> => [
  [`o.${M}`, `typeof o.${M}`, `String(o.${M})`],
  [`o.${M} + 1`, `o.${M} * 2`, `o.${M} < 0`, `Math.sqrt(o.${M})`, `-o.${M}`],
  ["JSON.stringify(o)", "Object.keys(o).join()", keysAndKinds, "Object.keys({ ...o }).join()", "Object.getOwnPropertyNames(o).join()", `(() => { let all = ""; for (const k in o) all += k + " "; return all; })()`, "Object.keys(Object.assign({}, o)).join()"],
  [`"${M}" in o`, `Object.hasOwn(o, "${M}")`, `o.${M} === o`, `o.${M} === undefined`, "o.constructor === Object"],
  ["o.t", `o.t + "," + typeof o.${M}`],
];
const looksAtState: readonly string[] = ["typeof state", "JSON.stringify(state)", "state === undefined", "state + 1"];

const arming = ["node:util", "node:sys", "node:zlib", "node:worker_threads", "node:child_process", "node:cluster", "node:readline", "node:repl", "node:stream", "node:net", "node:tls", "node:http", "node:https", "node:http2", "node:crypto", "node:inspector"];
const idle = ["node:fs", "node:path", "node:events", "node:os", "node:url", "node:buffer", "node:assert", "node:async_hooks", "node:dns", "node:dgram", "node:vm", "node:v8", "node:module", "node:perf_hooks", "node:querystring", "node:string_decoder", "node:timers", "node:tty", "bun", "bun:sqlite", "bun:jsc"];
const imports: ((name: string) => string)[] = [name => `import "${name}";`, name => `import "${name}";`, name => `import * as beside from "${name}";`, name => `if (process.argv.length > 99) require("${name}");`, name => `if (process.argv.length > 99) await import("${name}");`];

export function generate(random: Random): string {
  const inTurns = random.chance(0.4);
  const member = random.weighted([[5, "z"], [3, "self"], [1, "extra"]] as const);
  const maker = drawn(random, makers(inTurns ? "i" : "0"));
  // A class that the function itself makes is not there yet in a default, nor where the function is called.
  const ways = arrivals(maker.make);
  const [parameter, first, own] = drawn(random, maker.prepare ? ways.filter(kind => kind[0][1]) : ways);
  const value = () => drawn(random, values);

  const deed = () => drawn(random, deeds(member, value(), maker.class));
  const done = [deed(), ...(random.chance(0.3) ? [deed()] : [])];
  // What is done to a class stands in front of the `new`; the rest behind it.
  const onTheClass = maker.class ? done.filter(text => text.includes(`${maker.class}.prototype`) || text.includes(`(${maker.class}, `)) : [];
  const onTheObject = done.filter(text => !onTheClass.includes(text));
  const read = drawn(random, firstReads(member));
  const usesState = onTheObject.some(text => /\bstate\b/.test(text));
  const seen = [usesState && random.chance(0.7) ? random.pick(looksAtState) : drawn(random, looks(member)), ...(random.chance(0.3) ? [drawn(random, looks(member))] : [])];
  // How the function ends: it returns what it sees, it puts that on a list, or it says nothing at all.
  const ending = random.weighted([[6, "returns"], [3, "tells"], [1, "nothing"]] as const);
  const saysNothing = ending !== "returns";
  const inALoop = ending === "returns" && random.chance(0.12);

  const body = [
    ...(usesState ? [`let state${random.pick([" = {}", " = 0", ""])};`] : []),
    ...(maker.prepare ? [maker.prepare] : []),
    ...onTheClass,
    ...(first ? [first] : []),
    ...(read ? [read] : []),
    ...(inALoop ? [`let sum = "";`, `for (let turn = 0; turn < 3; turn++) {\n  sum += ${seen[0]} + " ";\n  ${onTheObject.join("\n  ")}\n  }`] : onTheObject),
    // What is seen goes into a text piece by piece: a list handed to `join` would hand the values to native code, and a compiler takes back what it believed of a value that it hands away.
    ...(ending === "returns" ? [`return "" + ${[...(inALoop ? ["sum"] : []), ...(read.startsWith("const before") ? ["typeof before"] : []), ...seen].map(look => `(${look})`).join(' + " | " + ')};`] : []),
    ...(ending === "tells" ? [`told.push(${seen.join(", ")});`] : []),
  ];
  const text = body.join("\n  ");

  const given = Array.from({ length: random.weighted([[1, 0], [6, 1], [2, 2]]) }, () => drawn(random, others(member)));
  const call = (operand: string) => {
    const handed = [...(inTurns ? ["i"] : []), operand].filter(Boolean).join(", ");
    return saysNothing ? `try { run(${handed}); } catch { console.log("threw"); }` : `console.log(guarded(() => run(${handed})));`;
  };
  const calls = [call(own), ...given.map(call)];
  if (random.chance(0.5)) calls.reverse();
  if (random.chance(0.25)) calls.push(call(own));
  const has = (word: RegExp) => word.test(text);
  return [
    ...(random.chance(0.6) ? [random.pick(imports)(random.pick(random.chance(0.65) ? arming : idle))] : []),
    ...(saysNothing ? [] : [`function guarded(f) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "another error"; } }`]),
    ...(maker.head ? [maker.head] : []),
    ...(has(/\bOther\b/) ? ["class Other { constructor() { this.other = 1; } more() { return 2; } }"] : []),
    ...(has(/\btold\b/) ? ["const told = [];"] : []),
    ...(has(/\bmark\b/) ? [`const mark = Symbol("p");`] : []),
    ...(has(/\bdescriptor\b/) ? [`const descriptor = { ${setter(member)}, configurable: true };`] : []),
    ...(has(/\bstore\(/) ? [`function store(it, v) { it.${member} = v; }`] : []),
    ...(has(/\bsee\(/) ? [`function see(o) { return o.${member}; }`] : []),
    ...(has(/\blaid\b/) ? ["const laid = { box: write => ({ set(v) { write(v); } }), unread: () => 2 };"] : []),
    ...(has(/\bbetween\b/) ? ["const between = {};"] : []),
    `function run(${[...(inTurns ? ["i"] : []), parameter].join(", ")}) {`,
    `  ${text}`,
    `}`,
    ...(inTurns ? [`for (let i = 0; i < 2; i++) {`, ...calls.map(line => "  " + line), `}`] : calls),
    ...(has(/\btold\b/) ? [`console.log(told.map(String).join());`] : []),
    ...(ending === "nothing" ? [`console.log("ok");`] : []),
    "export {};",
    "",
  ].join("\n");
}
