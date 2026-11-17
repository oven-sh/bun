// Object.assign() to arrays, functions, classes, errors, collections and expressions: again and again from sources of one shape and of several, with symbols, getters, setters that change the source, names that the receiver refuses.
let digest = 0, cases = 0;
const add = (t: string): void => { cases++; for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
const S = Symbol("s"), T = Symbol.for("t");
const show = (v: any): string => typeof v === "function" ? "fn" : typeof v === "symbol" ? "sym" : v === null || typeof v !== "object" ? String(v) : Array.isArray(v) ? "[" + v.length + "]" : "{" + Object.keys(v).length + "}";
const own = (o: any): string => Reflect.ownKeys(o).filter(k => !/^(stack|line|column|sourceURL|originalLine|originalColumn|callee|caller|arguments)$/.test(String(k))).map(k => String(k) + ":" + (Object.getOwnPropertyDescriptor(o, k)!.get ? "get" : show(o[k]))).join(",");
class Taking { log: string[] = []; set pos(v: any) { this.log.push("pos" + v); } }
class Failure extends Error { code = 1; set detail(v: any) { (this as any).taken = v; } }
class List extends Array<any> { set kind(v: any) { (this as any).taken = v; } }
const targets: Record<string, (i: number) => any> = {
  array: i => [i, 2], doubles: i => [i + 0.5], empty: () => [], match: i => /(\w)(\d)/.exec("a" + i), list: i => { const l = new List(); l.push(i); return l; }, frozen: i => Object.freeze([i]), closed: i => Object.preventExtensions([i]),
  arrow: i => () => i, plain: i => function named(a: any) { return a ?? i; }, method: i => ({ m() { return i; } }).m, async: i => async () => i, generator: i => function* () { yield i; }, bound: i => function (this: any) { return i; }.bind(1), cls: i => class K { static own = i; static get pos(): any { return "static"; } static set pos(v: any) { (this as any).taken = v; } }, plainClass: () => class P { },
  error: i => new Error("e" + i), failure: () => new Failure("f"), map: i => new Map([[i, i]]), set: i => new Set([i]), date: i => new Date(i), regexp: () => /a/g, promise: i => Promise.resolve(i), bytes: i => new Uint8Array(i % 5), args: i => (function (..._: any[]) { return arguments; })(i, 1), boxed: () => new String("ab"), heir: i => Object.create([i]), dictionary: () => Object.create(null), taking: () => new Taking(), literal: i => ({ a: i }),
};
const sources: Record<string, (i: number) => any> = {
  literal: i => ({ kind: "k", pos: i, deps: null }), other: i => ({ pos: i, title: "t", at: 1, concat: 2 }), many: i => ({ a: 1, b: 2, c: 3, d: 4, e: 5, f: i, g: 7, h: 8, j: 9 }), symbols: i => ({ kind: i, [S]: 1, pos: 2, [T]: 3 }), indices: i => ({ 0: "z", kind: i, 2: "y" }), names: i => ({ name: "n" + i, length: 1, displayName: "d" }), lengthOnly: () => ({ length: 2 }),
  getters: i => ({ kind: 1, get pos() { return i * 2; }, deps: 3 }), message: i => ({ message: "m" + i, code: "E", stack: "s" }), lastIndex: i => ({ lastIndex: i, kind: 1 }), instance: i => new (class { x = i; kind = "c"; m(): number { return 1; } })(), spread: i => ({ ...{ kind: 1, pos: i }, more: 2 }), undef: () => ({ kind: undefined, pos: undefined }), array: i => ["p", i], text: () => "uv", nothing: () => null, func: i => Object.assign(() => 1, { kind: i }), error: i => Object.assign(new Error("x"), { code: i }), dictionary: i => Object.assign(Object.create(null), { kind: i, pos: 1 }), big: i => { const o: any = {}; for (let k = 0; k < 40; k++) o["k" + k] = k + i; return o; },
  proto: i => JSON.parse('{"kind":1,"__proto__":{"x":' + i + '},"pos":2}'), deleted: i => { const o: any = { a: 1, kind: 2, b: i }; delete o.a; return o; }, proxy: i => new Proxy({ kind: i, pos: 2 }, {}), prototypeName: i => ({ prototype: i, kind: 1 }), call: i => ({ call: i, bind: 2, apply: 3 }),
};
for (let round = 0; round < 9; round++) for (const [t, makeTarget] of Object.entries(targets)) for (const [s, makeSource] of Object.entries(sources)) {
  const target = makeTarget(round), source = makeSource(round);
  let got = "";
  try { got = Object.assign(target, source) === target ? "same" : "other"; } catch (e) { got = (e as Error).name; }
  add(t + s + got + own(target) + "|" + (source && typeof source === "object" ? own(source) : ""));
}
console.log(cases, digest);
for (let round = 0; round < 6; round++) {
  const source: any = { first: 1, second: 2, third: 3, fourth: 4 };
  const target: any = Object.defineProperty([round], "second", { set(v: any) { if (round % 2) delete source.third; else source.third = "changed"; source.fifth = 5; this.seen = v; }, configurable: true });
  Object.assign(target, source, { last: round });
  console.log(own(target), own(source));
}
function hot(n: number): number {
  let r = 0;
  const kept = { title: "x", pos: 3, deps: null }, otherShape = { pos: 5, extra: 1 };
  for (let i = 0; i < n; i++) {
    const f: any = Object.assign(() => i, { title: "x", pos: i }); r += f.pos + f() + f.title.length;
    const g: any = Object.assign(function (a: number) { return a + i; }, i % 2 ? kept : otherShape); r += g.pos + g(1);
    const a: any = Object.assign([i, i + 1], kept); r += a.pos + a.length + a[1];
    const e: any = Object.assign(new Error("x"), { code: "ENOENT", errno: i }); r += e.errno + e.code.length;
    const m: any = Object.assign(/(\d+)/.exec("x" + i)!, { kind: 1, pos: i }); r += m.pos + m[1].length + m.index;
    const c: any = Object.assign(new Map([[i, i]]), otherShape); r += c.pos + c.size;
    const t: any = Object.assign(new Taking(), { pos: i, more: 1 }); r += t.log.length + t.more;
    r %= 1000003;
  }
  return r;
}
console.log(hot(3000), cases, digest);
const all: any[] = [];
for (let i = 0; i < 12000; i++) { const f: any = Object.assign(() => i, { owner: { i }, list: ["l" + i], a: [i], b: [i], c: [i] }); if (i % 6 === 0) all.push(f); }
let sum = 0; for (const f of all) sum += f() + f.owner.i + f.list[0].length + f.a[0] + f.b[0] + f.c[0];
console.log(all.length, sum);
