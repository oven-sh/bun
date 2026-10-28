// An object, an array, a closure or an instance of a class is handed to a coroutine: to next(), throw() or return() of a generator or an async generator, directly, through yield*, through
// call, apply, bind, Reflect.apply or a built-in that calls back, awaited or not. The body changes what it was handed while the call is under way: it adds, stores, deletes and redefines
// properties, changes the prototype, freezes, grows and shrinks arrays, stores elements of another kind, calls the closure. The sender looks at the value before the call and behind it,
// with reads of its own, once or in a loop, in JavaScript and in TypeScript. Other programs keep what they were sent over later steps and hand it out after the sender has returned.
//
//   bun objects-handed-to-a-coroutine-that-changes-them.ts <folder>    writes the programs there
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Subject = { make: string; look: string; before?: string };
const object: Subject = {
  make: "{ a: 1, b: 2 }",
  look: `[o.a, o.b, o.r, o.p, o[0], typeof o.a, "a" in o, Object.keys(o).join("|"), Object.isFrozen(o), Object.isExtensible(o), Object.getPrototypeOf(o) === Object.prototype].join()`,
};
const array: Subject = {
  make: "[1, 2, 3]",
  look: `[o.length, o[0], o[1], o[2], o[3], 1 in o, o.r, o.extra, o.join("|"), sum(o), Object.isFrozen(o), Array.isArray(o)].join()`,
};
const instance: Subject = {
  before: "class P { a = 1; b = 2; #c = 3; get c() { return this.#c; } setC(v) { this.#c = v; } }",
  make: "new P()",
  look: `[o.a, o.b, o.c, o.r, typeof o.a, Object.keys(o).join("|"), o instanceof P].join()`,
};
type Change = { name: string; subject: Subject; text: string; after?: string };
const changes: Change[] = [
  { name: "add", subject: object, text: "x.r = 5;" },
  { name: "store-same-kind", subject: object, text: "x.a = 7;" },
  { name: "store-string", subject: object, text: 'x.a = "s";' },
  { name: "store-double", subject: object, text: "x.a = 1.5;" },
  { name: "store-object", subject: object, text: "x.a = { z: 1 };" },
  { name: "store-undefined", subject: object, text: "x.a = undefined;" },
  { name: "delete", subject: object, text: "delete x.a;" },
  { name: "delete-last", subject: object, text: "delete x.b;" },
  {
    name: "accessor",
    subject: object,
    text: 'Object.defineProperty(x, "a", { get() { return 9; }, configurable: true });',
  },
  {
    name: "read-only",
    subject: object,
    text: 'Object.defineProperty(x, "a", { value: 3, writable: false });',
    after: "try { o.a = 8; } catch (e) { log.push(e.name); }",
  },
  { name: "not-enumerable", subject: object, text: 'Object.defineProperty(x, "a", { enumerable: false });' },
  { name: "prototype", subject: object, text: "Object.setPrototypeOf(x, { p: 4 });" },
  { name: "prototype-null", subject: object, text: "Object.setPrototypeOf(x, null);" },
  {
    name: "freeze",
    subject: object,
    text: "Object.freeze(x);",
    after: "try { o.a = 8; } catch (e) { log.push(e.name); }",
  },
  {
    name: "prevent-extensions",
    subject: object,
    text: "Object.preventExtensions(x);",
    after: "try { o.r = 8; } catch (e) { log.push(e.name); }",
  },
  { name: "many-adds", subject: object, text: 'for (let i = 0; i < 70; i++) x["k" + i] = i;' },
  { name: "index", subject: object, text: "x[0] = 6;" },
  { name: "reorder", subject: object, text: "delete x.a; x.a = 1;" },
  { name: "assign", subject: object, text: "Object.assign(x, { r: 5, a: 'q' });" },
  { name: "push", subject: array, text: "x.push(4);" },
  { name: "length-zero", subject: array, text: "x.length = 0;" },
  { name: "length-one", subject: array, text: "x.length = 1;" },
  { name: "element-double", subject: array, text: "x[0] = 1.5;" },
  { name: "element-string", subject: array, text: 'x[0] = "s";' },
  { name: "hole", subject: array, text: "delete x[1];" },
  { name: "far-index", subject: array, text: "x[100] = 1;" },
  { name: "very-far-index", subject: array, text: "x[1000000] = 1; x.length = 4;" },
  { name: "element-accessor", subject: array, text: "Object.defineProperty(x, 0, { get() { return 9; } });" },
  {
    name: "freeze-array",
    subject: array,
    text: "Object.freeze(x);",
    after: "try { o[0] = 8; } catch (e) { log.push(e.name); }",
  },
  {
    name: "array-prototype",
    subject: array,
    text: "Object.setPrototypeOf(x, { __proto__: Array.prototype, extra: 1, 3: 33 });",
  },
  { name: "array-named", subject: array, text: "x.r = 5;" },
  { name: "reverse", subject: array, text: "x.reverse();" },
  { name: "shift", subject: array, text: "x.shift();" },
  { name: "unshift", subject: array, text: "x.unshift(0);" },
  { name: "splice", subject: array, text: "x.splice(1, 1);" },
  { name: "fill", subject: array, text: "x.fill(0.5);" },
  {
    name: "closure-writes-variable",
    subject: { make: "() => { n++; }", look: "[n].join()", before: "" },
    text: "x();",
  },
  {
    name: "closure-replaces-object",
    subject: { make: "() => { held = { a: held.a + 1 }; }", look: "[held.a].join()" },
    text: "x();",
  },
  {
    name: "closure-changes-object",
    subject: {
      make: "() => { held.a = 's'; held.r = 5; }",
      look: "[held.a, held.r, Object.keys(held).join('|')].join()",
    },
    text: "x();",
  },
  { name: "instance-store", subject: instance, text: 'x.a = "s";' },
  { name: "instance-private", subject: instance, text: "x.setC(9);" },
  { name: "instance-add", subject: instance, text: "x.r = 5;" },
  { name: "instance-delete", subject: instance, text: "delete x.a;" },
  { name: "instance-prototype", subject: instance, text: "Object.setPrototypeOf(x, Object.prototype);" },
  {
    name: "map-set",
    subject: { make: "new Map([[1, 1]])", look: "[o.size, o.get(1), o.get(2), o.has(2)].join()" },
    text: "x.set(1, 9); x.set(2, 2);",
  },
  { name: "set-clear", subject: { make: "new Set([1])", look: "[o.size, o.has(1)].join()" }, text: "x.clear();" },
  {
    name: "bytes",
    subject: { make: "new Uint8Array(4)", look: "[o.length, o[0], o[3], o.byteLength].join()" },
    text: "x[0] = 7; x[3] = 9;",
  },
  {
    name: "detach",
    subject: { make: "new Uint8Array(4)", look: "[o.length, o[0], o.byteLength].join()" },
    text: "x.buffer.transfer();",
  },
  {
    name: "resize",
    subject: {
      make: "new Uint8Array(new ArrayBuffer(4, { maxByteLength: 16 }))",
      look: "[o.length, o[0], o[7], o.byteLength].join()",
    },
    text: "x.buffer.resize(8); x[7] = 7;",
  },
  {
    name: "last-index",
    subject: { make: "/a/g", look: "[o.lastIndex, o.test('aaaa'), o.lastIndex].join()" },
    text: "x.lastIndex = 2;",
  },
  { name: "date", subject: { make: "new Date(0)", look: "[o.getTime()].join()" }, text: "x.setTime(5);" },
  {
    name: "function-members",
    subject: { make: "function () {}", look: "[o.r, typeof o.prototype, o.name, o.length].join()" },
    text: "x.r = 5; x.prototype = 1; Object.defineProperty(x, 'name', { value: 'q' });",
  },
  {
    name: "nested",
    subject: {
      make: "{ in: { a: 1 }, list: [1] }",
      look: "[o.in.a, o.in.r, o.list.length, o.list[0], o.list[1]].join()",
    },
    text: "x.in.a = 's'; x.in.r = 5; x.list.push(1.5);",
  },
];

// How the body gets what is sent, and how a step is written. STEP has `it` and `o`.
type Coroutine = {
  name: string;
  isAsync: boolean;
  awaits: boolean;
  fresh?: boolean;
  declare(change: string): string;
  method: string;
  maker: string;
};
const loopBody = (change: string) => `let x = yield 0; for (;;) { seen.push(describe(x)); ${change} x = yield 1; }`;
const catchBody = (change: string) => `for (;;) { try { yield 0; } catch (x) { seen.push(describe(x)); ${change} } }`;
const finallyBody = (change: string) =>
  `try { yield 0; } finally { const x = current; seen.push(describe(x)); ${change} }`;
const coroutines: Coroutine[] = [
  {
    name: "sync-next",
    isAsync: false,
    awaits: false,
    method: "next",
    maker: "g()",
    declare: c => `function* g() { ${loopBody(c)} }`,
  },
  {
    name: "async-next",
    isAsync: true,
    awaits: false,
    method: "next",
    maker: "g()",
    declare: c => `async function* g() { ${loopBody(c)} }`,
  },
  {
    name: "async-next-awaited",
    isAsync: true,
    awaits: true,
    method: "next",
    maker: "g()",
    declare: c => `async function* g() { ${loopBody(c)} }`,
  },
  {
    name: "sync-throw",
    isAsync: false,
    awaits: false,
    method: "throw",
    maker: "g()",
    declare: c => `function* g() { ${catchBody(c)} }`,
  },
  {
    name: "async-throw",
    isAsync: true,
    awaits: false,
    method: "throw",
    maker: "g()",
    declare: c => `async function* g() { ${catchBody(c)} }`,
  },
  {
    name: "async-throw-awaited",
    isAsync: true,
    awaits: true,
    method: "throw",
    maker: "g()",
    declare: c => `async function* g() { ${catchBody(c)} }`,
  },
  {
    name: "sync-return",
    isAsync: false,
    awaits: false,
    fresh: true,
    method: "return",
    maker: "g()",
    declare: c => `function* g() { ${finallyBody(c)} }`,
  },
  {
    name: "async-return",
    isAsync: true,
    awaits: false,
    fresh: true,
    method: "return",
    maker: "g()",
    declare: c => `async function* g() { ${finallyBody(c)} }`,
  },
  {
    name: "async-return-awaited",
    isAsync: true,
    awaits: true,
    fresh: true,
    method: "return",
    maker: "g()",
    declare: c => `async function* g() { ${finallyBody(c)} }`,
  },
  {
    name: "sync-delegate",
    isAsync: false,
    awaits: false,
    method: "next",
    maker: "outer()",
    declare: c => `function* g() { ${loopBody(c)} }\nfunction* outer() { yield* g(); }`,
  },
  {
    name: "async-delegate",
    isAsync: true,
    awaits: false,
    method: "next",
    maker: "outer()",
    declare: c => `async function* g() { ${loopBody(c)} }\nasync function* outer() { yield* g(); }`,
  },
  {
    name: "async-delegate-to-sync",
    isAsync: true,
    awaits: false,
    method: "next",
    maker: "outer()",
    declare: c => `function* g() { ${loopBody(c)} }\nasync function* outer() { yield* g(); }`,
  },
  {
    name: "async-delegate-to-sync-awaited",
    isAsync: true,
    awaits: true,
    method: "next",
    maker: "outer()",
    declare: c => `function* g() { ${loopBody(c)} }\nasync function* outer() { yield* g(); }`,
  },
  {
    name: "sync-delegate-to-object",
    isAsync: false,
    awaits: false,
    method: "next",
    maker: "outer()",
    declare: c =>
      `const inner = { [Symbol.iterator]() { return this; }, next(x) { if (x !== undefined) { seen.push(describe(x)); ${c} } return { done: false, value: 1 }; } };\nfunction* outer() { yield* inner; }`,
  },
  {
    name: "async-delegate-to-object",
    isAsync: true,
    awaits: false,
    method: "next",
    maker: "outer()",
    declare: c =>
      `const inner = { [Symbol.asyncIterator]() { return this; }, next(x) { if (x !== undefined) { seen.push(describe(x)); ${c} } return Promise.resolve({ done: false, value: 1 }); } };\nasync function* outer() { yield* inner; }`,
  },
  {
    name: "sync-delegate-throw",
    isAsync: false,
    awaits: false,
    method: "throw",
    maker: "outer()",
    declare: c => `function* g() { ${catchBody(c)} }\nfunction* outer() { yield* g(); }`,
  },
  {
    name: "method-of-a-class",
    isAsync: false,
    awaits: false,
    method: "next",
    maker: "new Source().run()",
    declare: c => `class Source { *run() { ${loopBody(c)} } }`,
  },
  {
    name: "async-method-of-a-class",
    isAsync: true,
    awaits: false,
    method: "next",
    maker: "new Source().run()",
    declare: c => `class Source { async *run() { ${loopBody(c)} } }`,
  },
  {
    name: "sync-in-an-expression",
    isAsync: false,
    awaits: false,
    method: "next",
    maker: "g()",
    declare: c =>
      `function change(x) { seen.push(describe(x)); ${c} return 1; }\nfunction* g() { for (;;) change(yield 0); }`,
  },
  {
    name: "async-behind-an-await",
    isAsync: true,
    awaits: true,
    method: "next",
    maker: "g()",
    declare: c =>
      `async function* g() { let x = yield 0; for (;;) { await null; seen.push(describe(x)); ${c} x = yield 1; } }`,
  },
];

type Form = { name: string; step(method: string): string; before?: string };
const forms: Form[] = [
  { name: "direct", step: m => `it.${m}(o)` },
  { name: "call", step: m => `it.${m}.call(it, o)` },
  { name: "reflect-apply", step: m => `Reflect.apply(it.${m}, it, [o])` },
  { name: "apply", step: m => `it.${m}.apply(it, [o])` },
  { name: "bound", step: m => `it.${m}.bind(it)(o)` },
  { name: "bound-operand", step: m => `it.${m}.bind(it, o)()` },
  { name: "destructured", step: m => `(({ ${m}: step }) => step.call(it, o))(it)` },
  { name: "computed-key", step: m => `it[names[0]](o)`, before: "" },
  { name: "native-callback", step: m => `[o].forEach(it.${m}, it)` },
  { name: "native-callback-map", step: m => `[o].map(it.${m}, it)[0]` },
  { name: "helper", step: m => `stepOf(it, o)`, before: "" },
  { name: "field", step: m => `{ it }.it.${m}(o)` },
  { name: "call-call", step: m => `Function.prototype.call.call(it.${m}, it, o)` },
  { name: "spread", step: m => `it.${m}(...[o])` },
  { name: "optional", step: m => `it.${m}?.(o)` },
  {
    name: "from-the-prototype",
    step: m => `Object.getPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(it))).${m}.call(it, o)`,
  },
  { name: "unknown-iterator", step: m => `table.get("it").${m}(o)` },
  { name: "unknown-operand", step: m => `it.${m}(table.get("o"))` },
];

type Shape = "once" | "loop" | "stores-around";

function program(coroutine: Coroutine, change: Change, form: Form, shape: Shape): string {
  const { subject } = change;
  const asyncWord = coroutine.awaits ? "async " : "";
  const awaitWord = coroutine.awaits ? "await " : "";
  const start = coroutine.isAsync ? "await it.next();" : "it.next();";
  const settle = coroutine.isAsync ? "for (let i = 0; i < 6; i++) await null;" : "";
  const step = form.step(coroutine.method);
  const lines: string[] = [];
  lines.push(`const seen = [], log = [], names = [${JSON.stringify(coroutine.method)}], table = new Map();`);
  lines.push(`let current;`);
  lines.push(
    `function describe(x) { return typeof x === "function" ? "function" : Array.isArray(x) ? "[" + x.join() + "]" : x instanceof Map || x instanceof Set ? "size " + x.size : ArrayBuffer.isView(x) ? "bytes " + x.join() : x instanceof Date ? "date" : x instanceof RegExp ? "regexp" : JSON.stringify(x); }`,
  );
  lines.push(`function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }`);
  if (subject.before) lines.push(subject.before);
  lines.push(coroutine.declare(change.text));
  if (form.name === "helper")
    lines.push(
      `function stepOf(i, v) { return i.${coroutine.method}(v); }\nstepOf({ ${coroutine.method}(v) { return v; } }, 1);`,
    );
  const body: string[] = [];
  body.push(`let n = 0, held = { a: 1 };`);
  body.push(`const o = ${subject.make};`);
  if (form.name === "unknown-iterator") body.push(`table.set("it", it);`);
  if (form.name === "unknown-operand") body.push(`table.set("o", o);`);
  if (coroutine.fresh) body.push(`current = o;`);
  if (shape === "stores-around" && subject === object) body.push(`o.a = 41; o.b = 40;`);
  if (shape === "stores-around" && subject === array) body.push(`o[0] = 41; o[2] = 40;`);
  body.push(`const before = ${subject.look};`);
  body.push(`let outcome;`);
  body.push(`try { outcome = typeof (${awaitWord}${step}); } catch (e) { outcome = "throws " + (e === o); }`);
  body.push(`const behind = ${subject.look};`);
  if (change.after) body.push(change.after);
  if (shape === "stores-around" && subject === object) body.push(`try { o.b = 43; } catch (e) { log.push(e.name); }`);
  if (shape === "stores-around" && subject === array) body.push(`try { o[2] = 43; } catch (e) { log.push(e.name); }`);
  body.push(`const last = ${subject.look};`);
  body.push(`return before + " ; " + outcome + " ; " + behind + " ; " + last;`);
  lines.push(`${asyncWord}function look(it) {\n  ${body.join("\n  ")}\n}`);
  const makeIt = `const it = ${coroutine.maker}; ${start}`;
  const rounds = shape === "loop" ? 4000 : 3;
  lines.push(`let hash = 0, text = "";`);
  if (!coroutine.fresh) lines.push(makeIt);
  lines.push(`for (let round = 0; round < ${rounds}; round++) {`);
  if (coroutine.fresh) lines.push(`  ${makeIt}`);
  lines.push(`  const line = ${awaitWord}look(it);`);
  lines.push(`  ${settle}`);
  lines.push(`  if (round < 3 || round === ${rounds - 1}) console.log(line);`);
  lines.push(`  for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;`);
  lines.push(`  if (seen.length > 8) seen.length = 8; if (log.length > 8) log.length = 8;`);
  lines.push(`}`);
  lines.push(`console.log(hash, seen.join(" "), log.join(" "));`);
  return lines.join("\n") + "\n";
}

// The same in TypeScript: the sender, the body and what is sent have declared types; the body changes what it was sent through `any`.
function typedProgram(coroutine: Coroutine, change: Change, shape: Shape): string | null {
  const typeOf =
    change.subject === object ? "T" : change.subject === array ? "number[]" : change.subject === instance ? "P" : null;
  if (typeOf === null || /object$/.test(coroutine.name)) return null;
  const keepsType = [
    "store-same-kind",
    "push",
    "length-zero",
    "length-one",
    "reverse",
    "shift",
    "unshift",
    "splice",
    "fill",
    "element-double",
    "instance-private",
    "store-double",
  ].includes(change.name);
  const text = keepsType ? change.text : change.text.replace(/\bx\b/g, "(x as any)");
  const typedChange = { ...change, text, after: change.after?.replace(/\bo\.r\b/g, "(o as any).r") };
  let out = program(coroutine, typedChange, forms[0], shape);
  const iterator = `${coroutine.isAsync ? "Async" : ""}Generator<number, ${typeOf} | void, ${typeOf}>`;
  out = out
    .replace(
      "const seen = [], log = [],",
      "interface T { a: number; b: number }\nconst seen: string[] = [], log: string[] = [],",
    )
    .replace("let current;", `let current: ${typeOf};`)
    .replace("function describe(x)", "function describe(x: unknown): string")
    .replace("JSON.stringify(x); }", "JSON.stringify(x)!; }")
    .replace('"bytes " + x.join()', '"bytes " + (x as any).join()')
    .replace("function sum(list)", "function sum(list: number[]): number")
    .replace(/setC\(v\)/, "setC(v: number)")
    .replace(
      /(async )?function\* (g|outer)\(\)/g,
      (_, a, n) =>
        `${a ?? ""}function* ${n}(): ${"$&".length ? (a ? "Async" : "") : ""}Generator<number, ${typeOf} | void, ${typeOf}>`,
    )
    .replace(
      /(async )?\*run\(\)/,
      (_, a) => `${a ?? ""}*run(): ${a ? "Async" : ""}Generator<number, ${typeOf} | void, ${typeOf}>`,
    )
    .replace(/let x = yield 0;/g, `let x: ${typeOf} = yield 0;`)
    .replace(/catch \(x\) \{/g, `catch (thrown) { const x = thrown as ${typeOf};`)
    .replace("function change(x)", `function change(x: ${typeOf}): number`)
    .replace("function look(it)", `function look(it: ${iterator})`)
    .replace(/const o = (.*);\n/, (_, make) => `const o: ${typeOf} = ${make};\n`)
    .replace(/let outcome;/, "let outcome: string;")
    .replace(/catch \(e\) \{ log\.push\(e\.name\); \}/g, "catch (e) { log.push((e as Error).name); }")
    .replace(/\bo\.(r|p|extra)\b/g, "(o as any).$1")
    .replace(/, o\[0\], typeof o\.a/g, ", (o as any)[0], typeof o.a");
  return out;
}

// The body keeps what it was sent over later steps and hands it out again, long after the frame of the sender is gone.
function keptProgram(isAsync: boolean, awaits: boolean, make: string, look: string): string {
  const a = isAsync ? "async " : "";
  const w = isAsync ? "await " : "";
  return `
${a}function* g() { const kept = []; let x = yield 0; for (;;) { kept.push(x); if (kept.length > 5) { const old = kept.shift(); x = yield old; } else x = yield null; } }
function fill(depth) { const junk = [depth, depth + 1, { d: depth }]; return depth > 0 ? fill(depth - 1) + junk.length : 0; }
${awaits ? "async " : ""}function send(it, i) { const o = ${make}; return ${awaits ? "await " : ""}it.next(o); }
const it = g(); ${w}it.next();
let hash = 0;
for (let i = 0; i < 3000; i++) {
  const step = ${w}send(it, i);
  fill(20);
  if (i % 500 === 0) Bun.gc(true);
  const o = step.value;
  const line = o === null ? "null" : ${look};
  if (i < 8 || i === 2999) console.log(line);
  for (let k = 0; k < line.length; k++) hash = (hash * 31 + line.charCodeAt(k)) | 0;
}
console.log(hash);
`;
}

export type Written = { name: string; file: string; text: string };

export function programs(): Written[] {
  const written: Written[] = [];
  const write = (name: string, text: string, extension = "mjs") =>
    written.push({ name, file: `main.${extension}`, text });
  const direct = forms[0];
  for (const coroutine of coroutines)
    for (const change of changes)
      write(`${coroutine.name}, ${change.name}`, program(coroutine, change, direct, "once"));
  const fewChanges = changes.filter(c =>
    [
      "add",
      "store-string",
      "delete",
      "push",
      "element-string",
      "closure-writes-variable",
      "instance-store",
      "freeze",
    ].includes(c.name),
  );
  const fewCoroutines = coroutines.filter(c =>
    ["sync-next", "async-next", "async-next-awaited", "sync-throw", "async-throw", "async-delegate-to-sync"].includes(
      c.name,
    ),
  );
  for (const form of forms.slice(1))
    for (const coroutine of fewCoroutines)
      for (const change of fewChanges)
        write(`${coroutine.name}, ${change.name}, stepped by ${form.name}`, program(coroutine, change, form, "once"));
  for (const shape of ["loop", "stores-around"] as Shape[])
    for (const coroutine of fewCoroutines)
      for (const change of changes.filter(
        c => c.subject === object || c.subject === array || c.name.startsWith("closure") || c.subject === instance,
      ))
        write(`${coroutine.name}, ${change.name}, ${shape}`, program(coroutine, change, direct, shape));
  for (const [isAsync, awaits, name] of [
    [false, false, "sync"],
    [true, false, "async"],
    [true, true, "async-awaited"],
  ] as const) {
    write(
      `${name}, object kept over later steps`,
      keptProgram(isAsync, awaits, "{ a: i, b: i + 0.5, c: 'x' + i }", "[o.a, o.b, o.c].join()"),
    );
    write(`${name}, array kept over later steps`, keptProgram(isAsync, awaits, "[i, i + 1, i + 2]", "o.join()"));
    write(`${name}, closure kept over later steps`, keptProgram(isAsync, awaits, "() => i * 2", "String(o())"));
    write(
      `${name}, nested kept over later steps`,
      keptProgram(isAsync, awaits, "{ in: { a: i }, list: [i, { z: i }] }", "[o.in.a, o.list[0], o.list[1].z].join()"),
    );
  }
  for (const shape of ["once", "loop"] as Shape[])
    for (const coroutine of coroutines)
      for (const change of changes) {
        const text = typedProgram(coroutine, change, shape);
        if (text !== null && (shape === "once" || fewCoroutines.includes(coroutine)))
          write(`${coroutine.name}, ${change.name}, ${shape}, typed`, text, "ts");
      }
  return written;
}

if (import.meta.main) {
  const folder = process.argv[2];
  mkdirSync(folder, { recursive: true });
  for (const { name, file, text } of programs())
    writeFileSync(join(folder, name.replace(/[^\w-]+/g, "_") + file.slice(4)), text);
}
