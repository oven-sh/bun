// Names stored on arrays, views, arguments, functions and collections, so that storage grows beside elements of every kind and length; names that a prototype has, which end what is known of the object; displayName.
const S = Symbol("s"), T = Symbol.for("t");
let digest = 0, cases = 0;
const add = (t: string): void => { cases++; for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
const makers: Record<string, (n: number) => any> = {
  ints: n => { const a: any[] = []; for (let i = 0; i < n; i++) a.push(i); return a; },
  doubles: n => { const a: any[] = []; for (let i = 0; i < n; i++) a.push(i + 0.5); return a; },
  texts: n => { const a: any[] = []; for (let i = 0; i < n; i++) a.push("t" + i); return a; },
  holes: n => { const a: any[] = new Array(n); for (let i = 0; i < n; i += 3) a[i] = i; return a; },
  far: n => { const a: any[] = []; a[n * 40] = 1; return a; },
  shifted: n => { const a: any[] = []; for (let i = 0; i < n + 3; i++) a.push({ i }); a.shift(); a.shift(); a.shift(); return a; },
  literal: n => [n, n + 1, n + 2],
  pair: n => [n, "x"],
  single: n => [n / 2],
  empty: () => [],
  constant: () => [1, 2, 3],
  mapped: n => Array.from({ length: n }, (_, i) => i * 2),
  sliced: n => [9, 8, 7, 6, 5, 4, 3].slice(0, n % 8),
  split: n => "a,b,c,d,e,f".split(",", n % 7),
  match: n => /(\d)(\d*)/.exec("x" + n),
  args: n => (function (..._: any[]) { return arguments; })(n, 1, 2),
  rest: n => ((...r: any[]) => r)(n, 1, "z"),
  bytes: n => new Uint8Array(n),
  wasteful: n => { const v = new Float64Array(n); void v.buffer; return v; },
  view: n => new Uint16Array(new ArrayBuffer(2 * n)),
  object: n => { const o: any = {}; for (let i = 0; i < n; i++) o[i] = i; return o; },
  heir: n => { class L extends Array<any> { } const l = new L(); for (let i = 0; i < n; i++) l.push(i); return l; },
  map: n => new Map([[n, n]]), set: n => new Set([n]), date: n => new Date(n), promise: n => Promise.resolve(n), regexp: () => /a/g, error: n => new Error("e" + n),
  arrow: n => () => n, method: n => ({ m() { return n; } }).m, plain: n => function named(a: any) { return a ?? n; }, bound: n => function (this: any) { return n; }.bind(1), async: n => async () => n, generator: n => function* () { yield n; }, cls: n => class K { static own = n; },
};
const show = (v: any): string => typeof v === "function" ? "fn" : v === null || typeof v !== "object" ? String(v) : Array.isArray(v) ? "[" + v.length + "]" : Object.prototype.toString.call(v);
const attempt = (f: () => any): string => { try { return show(f()); } catch (e) { return (e as Error).name; } };
const elements = (o: any): string => { let t = ""; const n = typeof o.length === "number" ? Math.min(o.length, 80) : 12; for (let i = 0; i < n; i++) t += (i in o ? show(o[i]) : "-") + ";"; return t; };
const own = (o: any): string => Reflect.ownKeys(o).filter(k => typeof k !== "string" || !/^(stack|line|column|sourceURL|originalLine|originalColumn|callee|caller|arguments|\d+)$/.test(k)).map(k => String(k) + ":" + show(o[k])).join(",");
const shadows: Record<string, (o: any, i: number) => any> = {
  at: (o: any, i: number) => { o.at = () => "at" + i; return o.at(0); },
  push: (o: any, i: number) => { o.push = (x: any) => "push" + x; return o.push(i); },
  map: (o: any, i: number) => { o.map = () => "map" + i; return o.map((x: any) => x); },
  iterator: (o: any) => { o[Symbol.iterator] = function* () { yield "own"; }; return [...o].join(); },
  toString: (o: any, i: number) => { o.toString = () => "text" + i; return o + ""; },
  toJSON: (o: any, i: number) => { o.toJSON = () => "json" + i; return JSON.stringify(o); },
  has: (o: any, i: number) => { o.has = () => "has" + i; return o.has(1); },
  get: (o: any, i: number) => { o.get = () => "get" + i; return o.get(1); },
  concat: (o: any, i: number) => { o[Symbol.isConcatSpreadable] = i % 2 === 0; return [0].concat(o).length; },
  constructor: (o: any, i: number) => { o.constructor = { [Symbol.species]: class { x = i; } }; return typeof o.slice === "function" ? attempt(() => Object.prototype.toString.call(o.slice(0, 1))) : "none"; },
  includes: (o: any, i: number) => { o.includes = () => i; return o.includes(1); },
  displayName: (o: any, i: number) => { o.displayName = "shown" + i; o.displayName = "again" + i; return o.displayName; },
  then: (o: any, i: number) => { o.then = 1 + i; return o.then; },
  bind: (o: any, i: number) => { o.bind = () => "bind" + i; return o.bind(1); },
  hasOwnProperty: (o: any, i: number) => { o.hasOwnProperty = () => "own" + i; return o.hasOwnProperty("x"); },
  numeric: (o: any, i: number) => { o["1.5"] = i; o["-0"] = 2; return o["1.5"]; },
  fill: (o: any, i: number) => { o.fill = i; return o.fill; },
  length: (o: any, i: number) => { o.length = 1; return o.length; },
};
const names = Array.from({ length: 70 }, (_, i) => "n" + i);
function storeFew(o: any, i: number): void { o.first = i; o.second = "s" + i; o.third = null; o.fourth = i + 0.5; o.fifth = o; o.sixth = undefined; o.seventh = 7; o.eighth = 8; o.ninth = [9]; }
function storeMany(o: any, count: number): void { for (let k = 0; k < count; k++) o[names[k]!] = k; }
function check(label: string, o: any): void { add(label + own(o) + "|" + elements(o) + "|" + attempt(() => JSON.stringify(Array.isArray(o) ? o.slice(0, 3) : 1))); }
for (let n = 0; n <= 70; n += n < 12 ? 1 : 7) {
  for (const [m, make] of Object.entries(makers)) {
    const a = make(n); attempt(() => storeFew(a, n)); check(m + n + "few", a);
    attempt(() => { a.push?.(1); a.push?.("z"); }); check(m + n + "pushed", a);
    const b = make(n); attempt(() => storeMany(b, n)); check(m + n + "many", b);
    const c = make(n); attempt(() => { c[S] = n; c[T] = 1; c.x = 2; }); check(m + n + "symbols", c);
    attempt(() => { delete c.x; c.y = 3; c.x = 4; c[0] = 5; c.length = 2; }); check(m + n + "changed", c);
  }
}
console.log(cases, digest);
for (const [s, shadow] of Object.entries(shadows)) {
  let line = s + ":";
  for (const [m, make] of Object.entries(makers)) {
    let last = "";
    for (let n = 1; n < 9; n++) {
      const a = make(n), before = attempt(() => a.size ?? a.length);
      if (n % 2) attempt(() => { a.kind = n; a.pos = 1; });
      if (n % 3 === 0) attempt(() => storeFew(a, n));
      last = attempt(() => shadow(a, n)) + "/" + before + "/" + attempt(() => [...a].length) + "/" + attempt(() => a.map((x: any) => x)) + "/" + attempt(() => a.includes(n)) + "/" + attempt(() => a.has(n)) + "/" + attempt(() => a.slice(0, 2).length);
      add(last); check(m + s + n, a);
      const clean = make(n); add(attempt(() => [...clean].length) + attempt(() => clean.at(0)) + attempt(() => clean.has(n)) + attempt(() => clean.get(n)) + attempt(() => clean.includes(n)));
    }
    line += " " + m + "=" + last;
  }
  console.log(line);
}
function hot(n: number): number {
  let r = 0;
  for (let i = 0; i < n; i++) {
    const a: any = [i, i + 1]; a.kind = i; a.pos = 2; a.x = 3; a.y = 4; a.z = 5; r += a.kind + a.length + a[0] + a[1] + a.z;
    const d: any = [i + 0.25, 0.5, 0.75]; d.total = d[0] + d[2]; r += d.total + d.length;
    const s: any = [i]; s.at = i; r += s.at + s[0]; s.push(1); r += s.length;
    const v: any = new Uint8Array(4); v.set = i; v[1] = i; r += v.set + v[1];
    const f: any = () => i; f.displayName = "d" + (i % 7); r += f.displayName.length + f();
    const m: any = new Map([[i, i]]); m.get = () => 3; r += m.get(i) + m.size;
    const it: any = [i, 2]; it[Symbol.iterator] = function* () { yield 1; }; for (const x of it) r += x;
    const g = (...rest: any[]): number => { (rest as any).total = rest.length; return (rest as any).total + rest[0]; }; r += g(i, 2, 3);
    r %= 1000003;
  }
  return r;
}
console.log(hot(4000), cases, digest);
function kept(n: number): string {
  const all: any[] = [];
  for (let i = 0; i < n; i++) { const a: any = [{ i }, "e" + i]; a.owner = { name: "o" + i }; a.at = { deep: [i] }; a.p1 = [i]; a.p2 = [i]; a.p3 = { x: [i] }; if (i % 5 === 0) all.push(a); }
  let sum = 0;
  for (const a of all) sum += a[0].i + a[1].length + a.owner.name.length + a.at.deep[0] + a.p1[0] + a.p2[0] + a.p3.x[0];
  return all.length + " " + sum;
}
console.log(kept(20000), [1, 2, 3].at(-1), new Map([[1, 2]]).get(1), [...[1, 2]].length);
class Shown { static displayName = "declared"; static other = 1; }
class Named { } (Named as any).displayName = "stored"; (Named as any).extra = 2;
const component = Object.assign(() => 1, { displayName: "assigned" });
console.log(Shown.displayName, (Named as any).displayName, (Named as any).extra, component.displayName, Object.keys(component), Object.keys(Named), Bun.inspect(component), Bun.inspect(Named), Bun.inspect(Shown));
for (let i = 0; i < 40; i++) { class Made { } (Made as any).displayName = "m" + i; (Made as any).displayName += "!"; const fn = function inner() { return i; }; (fn as any).displayName = "f" + i; if (i > 37) console.log((Made as any).displayName, Object.keys(Made), Bun.inspect(Made), (fn as any).displayName, Object.keys(fn), Bun.inspect(fn), fn.name, Made.name); }
