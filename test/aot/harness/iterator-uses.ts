// Every kind of source that can be iterated, taken by every construct that iterates: which of next() and return() are called, in which
// order, how often, and what comes out. A source that the program wrote logs its calls.
import type { Cell } from "./cells";

const logging = (extra = "") =>
  `{ at: 0, [Symbol.iterator]() { log("open"); return this; }, next() { log("next"); ${extra} return this.at < 3 ? { value: ++this.at, done: false } : { value: undefined, done: true }; }, return() { log("return"); return {}; } }`;

const sources: Record<string, string> = {
  list: `[1, 2, 3]`,
  holes: `[1, , 3]`,
  "list with its own iterator": `Object.assign([1, 2, 3], { [Symbol.iterator]() { log("own"); return [7, 8, 9].values(); } })`,
  logging: logging(),
  "next throws": logging(`if (this.at === 1) throw "from next";`),
  "return throws": `Object.assign(${logging()}, { return() { log("return"); throw "from return"; } })`,
  "return gives no object": `Object.assign(${logging()}, { return() { log("return"); return 0; } })`,
  "no return": `Object.assign(${logging()}, { return: undefined })`,
  generator: `(function* () { try { log("g1"); yield 1; log("g2"); yield 2; log("g3"); yield 3; log("g4"); } finally { log("gf"); } })()`,
  text: `"a\\u{1F600}c"`,
  set: `new Set([1, 2, 3])`,
  map: `new Map([[1, 2], [3, 4]])`,
  arguments: `(function () { return arguments; })(1, 2, 3)`,
  bytes: `new Uint8Array([1, 2, 3])`,
  "list that grows": `(() => { const list = [1, 2, 3]; let more = 2; return new Proxy(list, { get(target, key, self) { if (key === "length" && more-- > 0) target.push(9); return Reflect.get(target, key, self); } }); })()`,
  "not iterable": `{ length: 2, 0: 1, 1: 2 }`,
};

const show = (...names: string[]) => names.map(name => `log("${name}=" + text(${name}));`).join(" ");
const uses: Record<string, string> = {
  "[]": `const [] = s;`,
  "[x]": `const [x] = s; ${show("x")}`,
  "[x, y]": `const [x, y] = s; ${show("x", "y")}`,
  "[, y]": `const [, y] = s; ${show("y")}`,
  "[x, y, z, w]": `const [x, y, z, w] = s; ${show("x", "y", "z", "w")}`,
  "[x, ...rest]": `const [x, ...rest] = s; ${show("x", "rest")}`,
  "[...rest]": `const [...rest] = s; ${show("rest")}`,
  "[x = default]": `const [x = (log("dx"), 5), y = (log("dy"), 6)] = s; ${show("x", "y")}`,
  "[x = throws]": `const [x, y = 0, z = 0, w = thrower()] = s; ${show("x")}`,
  "[[x]]": `const [[x] = [4]] = s; ${show("x")}`,
  "[o.a, o.b]": `const o = { set a(v) { log("a<" + text(v)); }, set b(v) { log("b<" + text(v)); } }; [o.a, o.b] = s;`,
  "[o.a, o.bad]": `const o = { set a(v) { log("a<" + text(v)); }, set bad(v) { throw "from a setter"; } }; [o.a, o.bad] = s;`,
  "[target throws]": `[thrower().a] = s;`,
  "for of": `for (const x of s) log(text(x));`,
  "for of break": `for (const x of s) { log(text(x)); break; }`,
  "for of continue": `for (const x of s) { if (x === 2) continue; log(text(x)); }`,
  "for of throw": `for (const x of s) { log(text(x)); throw "from the body"; }`,
  "for of return": `log(text((() => { for (const x of s) return x; })()));`,
  "for of labelled": `outer: for (const x of s) for (const y of [1, 2]) { log(text(x) + "," + y); if (y === 1) continue outer; }`,
  "for of pattern": `for (const [x] of [s]) log(text(x));`,
  "[...s]": `log(text([...s]));`,
  "f(...s)": `log(text(((...all) => all.length + ":" + all)(...s)));`,
  "new (...s)": `log(text(new (class { constructor(...all) { this.all = all.join(); } })(...s).all));`,
  "Math.max": `log(text(Math.max(...s)));`,
  "Array.from": `log(text(Array.from(s)));`,
  "Array.from mapped": `log(text(Array.from(s, (x, i) => i + ":" + text(x))));`,
  "new Set": `log(text([...new Set(s)]));`,
  "new Map": `log(text([...new Map(s)]));`,
  fromEntries: `log(JSON.stringify(Object.fromEntries(s)));`,
  "yield*": `log(text([...(function* () { yield* s; })()]));`,
  "yield* left": `for (const x of (function* () { yield* s; })()) { log(text(x)); break; }`,
  "typed from": `log(text(Uint8Array.from(s)));`,
  concat: `log(text([0].concat(s)));`,
  "Promise.all": `Promise.all(s).then(() => {}, () => {}); log("asked");`,
};

export const helpers = `function thrower() { throw "from a call"; }
function text(v) { return Array.isArray(v) ? "[" + v.map(text).join() + "]" : typeof v === "object" && v !== null ? Object.prototype.toString.call(v) : String(v); }
`;
export const call = `try { run(); } catch (e) { log("threw " + (e instanceof Error ? e.name : e)); }`;

export function cells(): Cell[] {
  const all: Cell[] = [];
  for (const [source, made] of Object.entries(sources))
    for (const [use, done] of Object.entries(uses)) {
      const id = "i" + (all.length + 1);
      all.push({ id, what: `${source} | ${use}`, text: `function ${id}() { const s = ${made}; ${done} }` });
    }
  return all;
}
