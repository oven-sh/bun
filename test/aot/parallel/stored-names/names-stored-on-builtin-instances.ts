// Names stored on arrays, results of exec(), functions, errors, maps, views, promises and instances of subclasses: by name, by key, by Object.assign and Reflect.set, names that a prototype has, frozen and sealed receivers.
const source = { kind: "x", pos: 3, rule: null }, other = { pos: 7, type: "t", at: 9, concat: 1 };
class List extends Array<number> { tag = "list"; }
class Failure extends Error { code = 1; set detail(v: any) { (this as any).stored = v; } get detail(): any { return (this as any).stored; } }
const S = Symbol("s");
const makers: Record<string, () => any> = {
  array: () => [1, 2], empty: () => [], doubles: () => [1.5], holes: () => [1, , 3], match: () => /(\w+)=(\d+)/.exec("key=12"), list: () => { const l = new List(); l.push(1); return l; },
  arrow: () => () => 1, fn: () => function named(a: any, b: any) { return a ?? b; }, method: () => ({ m() { return 1; } }).m, bound: () => function (this: any) { return this; }.bind(1), cls: () => class K { static own = 1; },
  error: () => new Error("e"), failure: () => new Failure("f"), map: () => new Map([[1, 2]]), set: () => new Set([1]), date: () => new Date(0), regexp: () => /a/g, promise: () => Promise.resolve(1), bytes: () => new Uint8Array(3), floats: () => new Float64Array(2), buffer: () => new ArrayBuffer(2),
  object: () => ({ a: 1 }), dictionary: () => Object.create(null), heir: () => Object.create({ pos: 5, get rule() { return "r"; }, set rule(v: any) { (this as any).set = v; } }), args: () => (function (..._: any[]) { return arguments; })(1, 2), boxed: () => new String("abc"), number: () => Object(5),
  frozen: () => Object.freeze([1, 2]), sealed: () => Object.seal([1, 2]), closed: () => Object.preventExtensions([1]), frozenFn: () => Object.freeze(() => 1), iterator: () => [1][Symbol.iterator](),
};
const show = (v: any): string => typeof v === "function" ? "fn" : typeof v === "symbol" ? "sym" : v === null || typeof v !== "object" ? String(v) : Array.isArray(v) ? "[" + v.length + "]" : Object.prototype.toString.call(v);
const keysOf = (o: any): string => Reflect.ownKeys(o).filter(k => k !== "stack" && k !== "line" && k !== "column" && k !== "sourceURL" && k !== "originalLine" && k !== "originalColumn").map(k => String(k) + ":" + (Object.getOwnPropertyDescriptor(o, k)!.get ? "get" : show(o[k]))).join(",");
const attempt = (f: () => any): string => { try { return show(f()); } catch (e) { return (e as Error).name; } };
const keys = ["kind", "pos", "rule", "at", "length", "name", "size", "0", "concat", "toString", "lastIndex", "then"];
const ways: Record<string, (o: any, i: number) => any> = {
  byName: (o, i) => { o.kind = i; o.pos = "p" + i; o.rule = null; return o.pos; },
  shadowed: (o, i) => { o.at = i; o.concat = "c"; o.call = 5; o.toString = () => "t" + i; return o.at; },
  byKey: (o, i) => { const k = keys[i % 6]!; if (k !== "length" && k !== "name") o[k] = i; return o[k]; },
  assign: o => Object.assign(o, source).pos,
  assignTwo: o => Object.assign(o, source, other).at,
  assignFresh: (o, i) => Object.assign(o, { kind: i, pos: i + 1 }).kind,
  assignArray: o => Object.assign(o, ["a", "b"]).length,
  reflect: (o, i) => Reflect.set(o, "pos", i) && o.pos,
  reflectReceiver: (o, i) => Reflect.set([], "pos", i, o) && o.pos,
  reflectAbove: (o, i) => Reflect.set(Object.getPrototypeOf(o) ?? {}, "pos", i, o) && o.pos,
  symbol: (o, i) => { o[S] = i; return o[S]; },
  twice: (o, i) => { o.pos = 1; o.pos = i; delete o.pos; o.pos = "again"; return o.pos; },
  defined: (o, i) => { Object.defineProperty(o, "pos", { value: i, writable: false, configurable: true }); o.pos = 5; return o.pos; },
  proto: (o, i) => { o.__proto__ = o.__proto__; o.pos = i; return o.pos; },
};
let digest = 0;
const add = (t: string): string => { for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; return t; };
for (let turn = 0; turn < 12; turn++) for (const [w, way] of Object.entries(ways)) {
  let line = w;
  for (const [m, make] of Object.entries(makers)) {
    const o = make(), got = attempt(() => way(o, turn)), after = attempt(() => keysOf(o));
    line += " " + m + "=" + got + "{" + after + "}";
  }
  add(line); if (turn === 0 || turn === 11) console.log(line);
}
function hot(n: number): string {
  let r = 0;
  for (let i = 0; i < n; i++) {
    const a: any = [i, i + 1]; a.kind = i; a.pos = 2; r += a.kind + a.length;
    const m: any = /(\d+)/.exec("x" + i); Object.assign(m, source); r += m.pos + m[1].length;
    const f: any = () => i; f.title = "t"; f.pos = i; r += f.pos + f.title.length;
    const b: any = new Uint8Array(2); b.pos = i; r += b.pos;
    const p: any = Promise.resolve(i); p.pos = i; r += p.pos;
    const x: any = new RegExp("a"); x.pos = i; r += x.pos;
    const s: any = [i]; s[S] = i; s.at = i; r += s[S] + s.at;
    r %= 1000003;
  }
  return "" + r;
}
console.log(hot(3000), digest, [1, 2, 3].concat([4]).at(-1), Array.prototype.concat.length, ("pos" in Array.prototype) || ("kind" in Function.prototype));
for (const name of ["pos", "kind", "rule", "type"]) console.log(name, name in [], name in (() => 1), name in {}, name in new Map());
