// Every kind of source copied in every way that copies own members, alone and two sources into one target: which members arrive, in which
// order, with which attributes, which getters, setters and traps run on the way, and in which order.
import type { Cell } from "./cells";

const sources: Record<string, string> = {
  literal: `{ a: 1, b: 2 }`,
  "other order": `{ b: 3, a: 4 }`,
  "one more": `{ a: 5, c: 6 }`,
  empty: `{}`,
  instance: `new (class { a = 1; b = 2; get c() { return 3; } })()`,
  getter: `{ get a() { log("get a"); return 1; }, b: 2 }`,
  "getter that deletes": `{ get a() { delete this.b; return 1; }, b: 2, c: 3 }`,
  "getter that adds": `{ get a() { this.z = 9; return 1; }, b: 2 }`,
  "getter that throws": `{ b: 2, get a() { throw "from a getter"; }, c: 3 }`,
  hidden: `Object.defineProperty({ a: 1 }, "b", { value: 2, enumerable: false })`,
  symbols: `{ [Symbol.for("s")]: 1, a: 2, [Symbol.for("t")]: 3 }`,
  indexes: `{ b: 1, 2: 2, a: 3, 1: 4, "-1": 5, "01": 6 }`,
  inherits: `Object.create({ a: 1 }, { b: { value: 2, enumerable: true } })`,
  bare: `{ __proto__: null, a: 1 }`,
  "own __proto__": `JSON.parse('{"__proto__":{"z":1},"a":2}')`,
  frozen: `Object.freeze({ a: 1, b: 2 })`,
  list: `[7, 8]`,
  "list with holes": `[7, , 9]`,
  text: `"hi"`,
  number: `5`,
  null: `null`,
  undefined: `undefined`,
  function: `Object.assign(function f() {}, { a: 1 })`,
  map: `new Map([["a", 1]])`,
  bytes: `new Uint8Array([1, 2])`,
  arguments: `(function () { return arguments; })(1, 2)`,
  proxy: `new Proxy({ a: 1, b: 2 }, { ownKeys(t) { log("keys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { log("desc " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, get(t, k, r) { log("get " + String(k)); return Reflect.get(t, k, r); } })`,
  "undefined values": `{ a: undefined, b: null }`,
};

const one: Record<string, string> = {
  spread: `look({ ...s });`,
  "spread behind a": `look({ a: 0, ...s });`,
  "spread in front of a": `look({ ...s, a: 0 });`,
  "spread twice": `look({ ...s, ...s });`,
  "spread under a getter": `look({ get a() { return "mine"; }, ...s });`,
  assign: `look(Object.assign({}, s));`,
  "assign onto a": `look(Object.assign({ a: 0, q: 0 }, s));`,
  "assign onto a setter": `look(Object.assign({ set a(v) { log("set a " + text(v)); } }, s));`,
  "assign onto frozen": `look(Object.assign(Object.freeze({ a: 0 }), s));`,
  "assign onto an instance": `look(Object.assign(new (class { a = 0; #p = 1; })(), s));`,
  rest: `const { a, ...rest } = s; log(text(a)); look(rest);`,
  "rest of all": `const { ...rest } = s; look(rest);`,
  "rest behind a computed name": `const { [tag("b")]: got, ...rest } = s; log(text(got)); look(rest);`,
  entries: `look(Object.fromEntries(Object.entries(s)));`,
  descriptors: `look(Object.defineProperties({}, Object.getOwnPropertyDescriptors(s)));`,
  "for in": `const copy = {}; for (const k in s) copy[k] = s[k]; look(copy);`,
  "in a call": `look(((o) => ({ ...o, z: 1 }))(s));`,
  "in a loop": `let copy = {}; for (let i = 0; i < 3; i++) copy = { ...copy, ...s, ["k" + i]: i }; look(copy);`,
};
const two: Record<string, string> = {
  "two spreads": `look({ ...s, ...t });`,
  "two assigned": `look(Object.assign({}, s, t));`,
  "assign onto the first": `look(Object.assign(s, t));`,
  "spread and rest": `const { a, ...rest } = { ...s, ...t }; log(text(a)); look(rest);`,
};

export const helpers = `const tag = v => v;
function text(v) { return typeof v === "function" ? "function" : typeof v === "object" && v !== null ? Object.prototype.toString.call(v) : Object.is(v, -0) ? "-0" : String(v); }
function look(o) {
  log(Object.prototype.toString.call(o) + (Object.getPrototypeOf(o) === Object.prototype ? "" : Object.getPrototypeOf(o) === null ? " bare" : " other"));
  for (const k of Reflect.ownKeys(o)) { const d = Object.getOwnPropertyDescriptor(o, k); log(String(k) + (d.get ? "G" : "") + (d.set ? "S" : "") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "") + ("value" in d ? "=" + text(d.value) : "")); }
  log("z" in o);
}
`;
export const call = `try { run(); } catch (e) { log("threw " + (e instanceof Error ? e.name : e)); }`;

export function cells(): Cell[] {
  const all: Cell[] = [];
  const add = (what: string, body: string) => {
    const id = "c" + (all.length + 1);
    all.push({ id, what, text: `function ${id}() { ${body} }` });
  };
  for (const [source, made] of Object.entries(sources))
    for (const [way, done] of Object.entries(one)) add(`${source} | ${way}`, `const s = ${made}; ${done}`);
  for (const [first, made] of Object.entries(sources))
    for (const [second, other] of Object.entries(sources))
      for (const [way, done] of Object.entries(two))
        add(`${first} + ${second} | ${way}`, `const s = ${made}; const t = ${other}; ${done}`);
  return all;
}
