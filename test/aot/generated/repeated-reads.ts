// A value that is read a second time is the value that is there at that moment. Each case reads a location, lets other code run in a way that does not look like a store to the function that reads, and reads again.
// The table: what is read x how the other code gets to run. How the reader reaches the object, the form of the reader and the kind of the change rotate, three holders for each pair.
//
//   bun repeated-reads.ts <folder> [--typed] [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/read-again-<location>.mjs, with --typed the locations that have a type as .ts.
import { writeCaseFiles, type CaseFile } from "./case-files";

interface Location {
  name: string;
  /** Defines `o`. */
  setup: string;
  /** `H` stands for the object as the reader names it. */
  read: string;
  change: string;
  /** Leaves a value of another type, or another state. */
  changeOfKind: string;
  store?: string;
  type?: string;
  isVariable?: true;
}

const locations: Location[] = [
  { name: "literal-field", setup: "const o = { x: 1, y: 2 };", read: "H.x", change: "o.x = o.x + 1;", changeOfKind: `o.x = "s";`, store: "H.x = 5;", type: "{ x: number; y: number }" },
  { name: "class-field", setup: "class C { x = 1; y = 2; } const o = new C();", read: "H.x", change: "o.x = o.x + 1;", changeOfKind: `o.x = "s";`, store: "H.x = 5;", type: "C" },
  { name: "constructor-field", setup: "class C { constructor() { this.x = 1; } } const o = new C();", read: "H.x", change: "o.x = o.x + 1;", changeOfKind: `o.x = "s";`, store: "H.x = 5;" },
  { name: "private-field", setup: "class C { #x = 1; get() { return this.#x; } set(v) { this.#x = v; } } const o = new C();", read: "H.get()", change: "o.set(o.get() + 1);", changeOfKind: `o.set("s");`, store: "H.set(5);" },
  { name: "array-element", setup: "const o = [1, 2, 3];", read: "H[0]", change: "o[0] = o[0] + 1;", changeOfKind: `o[0] = "s";`, store: "H[0] = 5;", type: "number[]" },
  { name: "array-length", setup: "const o = [1, 2, 3];", read: "H.length", change: "o.push(9);", changeOfKind: "o.length = 0;", store: "H.length = 2;", type: "number[]" },
  { name: "map-entry", setup: `const o = new Map([["k", 1]]);`, read: `H.get("k")`, change: `o.set("k", o.get("k") + 1);`, changeOfKind: `o.delete("k");`, store: `H.set("k", 5);` },
  { name: "set-size", setup: "const o = new Set([1]);", read: "H.size", change: "o.add(o.size + 10);", changeOfKind: "o.clear();", type: "Set<number>" },
  { name: "typed-array-element", setup: "const o = new Int32Array([1, 2]);", read: "H[0]", change: "o[0]++;", changeOfKind: "o[0] = 2 ** 31;", store: "H[0] = 5;", type: "Int32Array" },
  { name: "inherited", setup: "const above = { x: 1 }; const o = Object.create(above);", read: "H.x", change: "above.x = above.x + 1;", changeOfKind: `o.x = "own";` },
  { name: "accessor", setup: "let v = 1; const o = { get x() { return v; } };", read: "H.x", change: "v++;", changeOfKind: `Object.defineProperty(o, "x", { value: "s" });`, type: "{ readonly x: number }" },
  { name: "static-field", setup: "class C { static x = 1; } const o = C;", read: "H.x", change: "C.x++;", changeOfKind: `C.x = "s";`, store: "H.x = 5;", type: "typeof C" },
  { name: "nested-field", setup: "const o = { in: { x: 1 } };", read: "H.in.x", change: "o.in = { x: o.in.x + 1 };", changeOfKind: `o.in.x = "s";`, store: "H.in.x = 5;", type: "{ in: { x: number } }" },
  { name: "method", setup: "const o = { m() { return 1; } };", read: "H.m()", change: "o.m = () => 2;", changeOfKind: `o.m = function () { return "s"; };`, type: "{ m(): number }" },
  { name: "presence", setup: "const o = { x: 1 };", read: `("x" in H) + "/" + Object.keys(H).length`, change: "delete o.x;", changeOfKind: "o.z = 1;" },
  { name: "text-length", setup: `const o = { x: "a" };`, read: "H.x.length", change: `o.x += "b";`, changeOfKind: "o.x = [1, 2, 3];", store: `H.x = "five";`, type: "{ x: string }" },
  { name: "prototype-link", setup: `class A { k() { return "A"; } } class B { k() { return "B"; } } const o = new A();`, read: "H.k()", change: "Object.setPrototypeOf(o, B.prototype);", changeOfKind: `A.prototype.k = () => "patched";` },
  { name: "last-index", setup: "const o = /a/g;", read: "H.lastIndex", change: `o.test("aaaaaaaa");`, changeOfKind: "o.lastIndex = 0.5;", store: "H.lastIndex = 1;", type: "RegExp" },
  { name: "buffer-length", setup: "const o = new ArrayBuffer(8, { maxByteLength: 64 });", read: "H.byteLength", change: "o.resize(o.byteLength + 8);", changeOfKind: "if (!o.detached) o.transfer();" },
  { name: "view-length", setup: "const buffer = new ArrayBuffer(8, { maxByteLength: 64 }); const o = new Uint8Array(buffer);", read: "H.length", change: "buffer.resize(buffer.byteLength + 8);", changeOfKind: "buffer.resize(0);" },
  { name: "frozen", setup: "const o = { x: 1 };", read: `Object.isFrozen(H) + "/" + Object.isExtensible(H)`, change: "Object.preventExtensions(o);", changeOfKind: "Object.freeze(o);" },
  { name: "captured-variable", setup: "let v = 1; const o = null;", read: "v", change: "v++;", changeOfKind: `v = "s";`, store: "v = 5;", isVariable: true },
  { name: "module-variable", setup: "moduleVariable = 1; const o = null;", read: "moduleVariable", change: "moduleVariable++;", changeOfKind: `moduleVariable = "s";`, store: "moduleVariable = 5;", isVariable: true },
  { name: "global-property", setup: "globalThis.globalProperty = 1; const o = null;", read: "globalProperty", change: "globalThis.globalProperty++;", changeOfKind: `globalThis.globalProperty = "s";`, isVariable: true },
];

export interface Holder {
  name: string;
  /** Stands behind the definition of `o`. */
  setup: string;
  parameters: string;
  /** `T` stands for the type of the object. */
  typedParameters: string;
  arguments: string;
  /** How the reader names the object. */
  object: string;
  isReceiver?: true;
  /** The reader makes the object itself. */
  isMadeByTheReader?: true;
}

export const holders: Holder[] = [
  { name: "parameter", setup: "", parameters: "h", typedParameters: "h: T", arguments: "o", object: "h" },
  { name: "captured", setup: "", parameters: "", typedParameters: "", arguments: "", object: "o" },
  { name: "field", setup: "const w = { inner: o };", parameters: "w", typedParameters: "w: { inner: T }", arguments: "w", object: "w.inner" },
  { name: "element", setup: "const list = [o];", parameters: "list", typedParameters: "list: T[]", arguments: "list", object: "list[0]" },
  { name: "this", setup: "", parameters: "", typedParameters: "this: T", arguments: "", object: "this", isReceiver: true },
  { name: "fresh", setup: "", parameters: "", typedParameters: "", arguments: "", object: "o", isMadeByTheReader: true },
  { name: "function", setup: "const get = () => o;", parameters: "", typedParameters: "", arguments: "", object: "get()" },
  { name: "destructured", setup: "", parameters: "{ h }", typedParameters: "{ h }: { h: T }", arguments: "{ h: o }", object: "h" },
  { name: "rest", setup: "", parameters: "...all", typedParameters: "...all: T[]", arguments: "o", object: "all[0]" },
];

type Reader = "sync" | "async" | "generator" | "generator-alone" | "async-generator";

export interface Mutator {
  name: string;
  reader: Reader;
  setup: string;
  /** Stands between the reads and gets `change` called. */
  act: string;
}

export const mutators: Mutator[] = [
  { name: "call", reader: "sync", setup: "", act: "change();" },
  { name: "call-from-a-table", reader: "sync", setup: "const table = [() => 0, () => change()]; const pick = Date.now() > 0 ? 1 : 0;", act: "table[pick]();" },
  { name: "getter", reader: "sync", setup: "const other = { get p() { change(); return 0; } };", act: "sink = other.p;" },
  { name: "setter", reader: "sync", setup: "const other = { set p(v) { change(); } };", act: "other.p = 1;" },
  { name: "inherited-setter", reader: "sync", setup: "const other = Object.create({ set p(v) { change(); } });", act: "other.p = 1;" },
  { name: "to-string", reader: "sync", setup: `const other = { toString() { change(); return ""; } };`, act: "sink = `${other}`;" },
  { name: "value-of", reader: "sync", setup: "const other = { valueOf() { change(); return 1; } };", act: "sink = other + 1;" },
  { name: "comparison", reader: "sync", setup: "const other = { valueOf() { change(); return 1; } };", act: "sink = other < 2;" },
  { name: "loose-equality", reader: "sync", setup: "const other = { valueOf() { change(); return 1; } };", act: "sink = other == 1;" },
  { name: "to-primitive", reader: "sync", setup: "const other = { [Symbol.toPrimitive]() { change(); return 1; } };", act: "sink = +other;" },
  { name: "increment", reader: "sync", setup: "let other = { valueOf() { change(); return 1; } }; const kept = other;", act: "other = kept; other++;" },
  { name: "iteration", reader: "sync", setup: "const other = { [Symbol.iterator]() { return { next() { change(); return { done: true }; } }; } };", act: "for (const each of other) sink = each;" },
  { name: "spread", reader: "sync", setup: "const other = { [Symbol.iterator]() { return { next() { change(); return { done: true }; } }; } };", act: "sink = [...other];" },
  { name: "destructuring", reader: "sync", setup: "const other = { [Symbol.iterator]() { return { next() { change(); return { done: true }; } }; } };", act: "{ const [first] = other; sink = first; }" },
  { name: "iterator-return", reader: "sync", setup: "const other = { [Symbol.iterator]() { return { next() { return { done: false, value: 0 }; }, return() { change(); return {}; } }; } };", act: "for (const each of other) break;" },
  { name: "for-each", reader: "sync", setup: "", act: "[0].forEach(() => change());" },
  { name: "sort", reader: "sync", setup: "", act: "[2, 1].sort((a, b) => { change(); return a - b; });" },
  { name: "array-from", reader: "sync", setup: "", act: "sink = Array.from([0], () => change());" },
  { name: "to-json", reader: "sync", setup: "const other = { toJSON() { change(); return 0; } };", act: "sink = JSON.stringify(other);" },
  { name: "reviver", reader: "sync", setup: "", act: `sink = JSON.parse("0", () => change());` },
  { name: "proxy-get", reader: "sync", setup: "const other = new Proxy({}, { get() { change(); return 0; } });", act: "sink = other.p;" },
  { name: "proxy-has", reader: "sync", setup: "const other = new Proxy({}, { has() { change(); return true; } });", act: `sink = "p" in other;` },
  { name: "proxy-keys", reader: "sync", setup: "const other = new Proxy({}, { ownKeys() { change(); return []; } });", act: "sink = { ...other };" },
  { name: "constructor", reader: "sync", setup: "class Other { constructor() { change(); } }", act: "sink = new Other();" },
  { name: "field-initializer", reader: "sync", setup: "class Other { p = change(); }", act: "sink = new Other();" },
  { name: "has-instance", reader: "sync", setup: "const Other = { [Symbol.hasInstance]() { change(); return true; } };", act: "sink = 1 instanceof Other;" },
  { name: "default-parameter", reader: "sync", setup: "function other(p = change()) {}", act: "other();" },
  { name: "tagged-template", reader: "sync", setup: "const other = () => change();", act: "other`text`;" },
  { name: "catch", reader: "sync", setup: "", act: "try { throw 1; } catch { change(); }" },
  { name: "finally", reader: "sync", setup: "", act: "try { sink = 1; } finally { change(); }" },
  { name: "call-that-throws", reader: "sync", setup: "const other = () => { change(); throw 1; };", act: "try { other(); } catch {}" },
  { name: "optional-call", reader: "sync", setup: "const other = Date.now() > 0 ? () => change() : undefined;", act: "other?.();" },
  { name: "replace", reader: "sync", setup: "", act: `sink = "a".replace("a", () => { change(); return "b"; });` },
  { name: "computed-key", reader: "sync", setup: `const other = { toString() { change(); return "k"; } };`, act: "sink = ({})[other];" },
  { name: "class-member-name", reader: "sync", setup: "", act: `sink = class { [(change(), "k")]() {} };` },
  { name: "reflect-apply", reader: "sync", setup: "", act: "Reflect.apply(() => change(), undefined, []);" },
  { name: "bound", reader: "sync", setup: "const other = (() => change()).bind(null);", act: "other();" },
  { name: "generator-step", reader: "sync", setup: "function* other() { change(); yield 1; }", act: "sink = other().next();" },
  { name: "length-getter", reader: "sync", setup: "const other = { get length() { change(); return 0; } };", act: "sink = Array.prototype.slice.call(other);" },
  { name: "species", reader: "sync", setup: "class Other extends Array { static get [Symbol.species]() { change(); return Array; } } const other = new Other();", act: "sink = other.map(each => each);" },
  { name: "await-microtask", reader: "async", setup: "", act: "queueMicrotask(() => change()); await null;" },
  { name: "await-then", reader: "async", setup: "", act: "await Promise.resolve().then(() => change());" },
  { name: "await-thenable", reader: "async", setup: "const other = { then(resolve) { change(); resolve(0); } };", act: "await other;" },
  { name: "await-timer", reader: "async", setup: "", act: "await new Promise(done => setTimeout(() => { change(); done(); }, 0));" },
  { name: "await-async-function", reader: "async", setup: "async function other() { await null; change(); }", act: "await other();" },
  { name: "for-await", reader: "async", setup: "async function* other() { change(); yield 1; }", act: "for await (const each of other()) sink = each;" },
  { name: "next-tick", reader: "async", setup: "", act: "process.nextTick(() => change()); await new Promise(done => setImmediate(done));" },
  { name: "yield", reader: "generator", setup: "", act: "yield;" },
  { name: "yield-star", reader: "generator-alone", setup: "function* other() { change(); yield; }", act: "yield* other();" },
  { name: "async-yield", reader: "async-generator", setup: "", act: "yield;" },
];

export const typedSetup = (setup: string) =>
  setup
    .replaceAll("set p(v)", "set p(v: number)")
    .replaceAll("then(resolve)", "then(resolve: (v: number) => void)")
    .replaceAll("const other = ", "const other: any = ")
    .replaceAll("let other = ", "let other: any = ")
    .replaceAll("const Other = ", "const Other: any = ");

export const typedAct = (act: string) =>
  act
    .replaceAll("sink = ({})[other];", "sink = ({} as any)[other];")
    .replaceAll("each => each", "(each: unknown) => each")
    .replaceAll("new Promise(done =>", "new Promise<void>(done =>")
    .replaceAll("1 instanceof Other", "(1 as any) instanceof Other");

export const keywordOf: Record<Reader, string> = { "sync": "function", "async": "async function", "generator": "function*", "generator-alone": "function*", "async-generator": "async function*" };

export const callOf = (holder: Holder) => (holder.isReceiver ? "read.call(o)" : `read(${holder.arguments})`);

/** Statements that run the reader to its end. `result` takes an expression for what it returned. */
export function driverOf(reader: Reader, call: string, result: (value: string) => string) {
  if (reader === "sync") return result(call);
  if (reader === "async") return result(`await ${call}`);
  const step = reader === "async-generator" ? "await steps.next()" : "steps.next()";
  return `const steps = ${call}; let step; while (!(step = ${step}).done)${reader === "generator-alone" ? "" : " change()"}; ${result("step.value")}`;
}

type Shape = "straight" | "loop" | "store";
type Kind = "same" | "other";

function caseOf(location: Location, holder: Holder, mutator: Mutator, shape: Shape, kind: Kind, isTyped: boolean) {
  if (shape === "store" && !location.store) shape = "straight";
  if (isTyped) kind = "same";
  const act = isTyped ? typedAct(mutator.act) : mutator.act;
  const read = location.read.replaceAll("H", holder.object);
  const define = `${location.setup} change = () => { ${kind === "same" ? location.change : location.changeOfKind} };`;
  const body = {
    straight: `const a = ${read}; ${act} const b = ${read}; return [a, b];`,
    loop: `const seen${isTyped ? ": unknown[]" : ""} = []; for (let i = 0; i < 3; i++) { seen.push(${read}); ${act} } return seen;`,
    store: `${location.store?.replaceAll("H", holder.object)} ${act} const b = ${read}; return [b];`,
  }[shape];
  const parts = [
    isTyped ? "let change: () => void = () => {};" : "let change;",
    isTyped ? typedSetup(mutator.setup) : mutator.setup,
    holder.isMadeByTheReader ? "" : define + (holder.setup ? " " + holder.setup : ""),
    `${keywordOf[mutator.reader]} read(${isTyped ? holder.typedParameters.replaceAll("T", location.type!) : holder.parameters}) { ${holder.isMadeByTheReader ? define + " " : ""}${body} }`,
    driverOf(mutator.reader, callOf(holder), value => `return ${value};`),
  ];
  const name = `${location.name} ${holder.name} ${mutator.name} ${shape} ${kind}`;
  return { name, line: `await t("${name}", async () => { ${parts.filter(part => part).join(" ")} });` };
}

const declarations = `declare const console: { log(...values: unknown[]): void };
declare function queueMicrotask(f: () => void): void;
declare function setTimeout(f: () => void, ms: number): unknown;
declare function setImmediate(f: () => void): unknown;
declare const process: { nextTick(f: () => void): void };
`;

export const headOf = (title: string, isTyped: boolean, more = "") =>
  isTyped
    ? `// ${title}
${declarations}${more}let sink: unknown, moduleVariable: number = 1;
const show = (v: unknown) => JSON.stringify(v, (key, each) => each === undefined ? "undefined" : typeof each === "bigint" ? String(each) : each);
async function t(name: string, f: () => unknown) { let r; try { r = show(await f()); } catch (e) { r = "threw " + (e as Error).name; } console.log(name, r); }
`
    : `// ${title}
let sink, moduleVariable = 1;
const show = (v) => JSON.stringify(v, (key, each) => each === undefined ? "undefined" : typeof each === "bigint" ? String(each) : each);
async function t(name, f) { let r; try { r = show(await f()); } catch (e) { r = "threw " + (e).name; } console.log(name, r); }
`;

export function caseFiles(isTyped: boolean): CaseFile[] {
  const shapes: Shape[] = ["straight", "loop", "store"];
  const kinds: Kind[] = ["same", "other"];
  const captured = holders.find(holder => holder.name === "captured")!;
  return locations.flatMap((location, i) => {
    if (isTyped && !location.type) return [];
    const cases = mutators.flatMap((mutator, j) =>
      Array.from({ length: location.isVariable ? 1 : 3 }, (_, k) => caseOf(location, location.isVariable ? captured : holders[(i + j + 3 * k) % holders.length], mutator, shapes[(i + j + k) % 3], kinds[(j + k) % 2], isTyped)),
    );
    return {
      name: `read-again-${location.name}.${isTyped ? "ts" : "mjs"}`,
      head: headOf("A value that is read a second time is the value that is there at that moment: other code ran between the two reads, in a way that does not look like a store to the function that reads.", isTyped),
      cases: cases.filter(({ name }, at) => cases.findIndex(other => other.name === name) === at),
    };
  });
}

if (import.meta.main) writeCaseFiles(caseFiles(process.argv.includes("--typed")));
