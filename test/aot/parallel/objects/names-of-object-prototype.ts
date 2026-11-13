// Names that Object.prototype holds, stored into literals, instances and heirs; fields created beside elements: values, order of keys, setters and read-only properties above, frozen receivers.
let digest = 0, cases = 0;
const add = (t: string): void => { cases++; for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
const show = (v: any): string => typeof v === "function" ? "fn" : v === null || typeof v !== "object" ? String(v) : "{" + Reflect.ownKeys(v).map(String) + "}";
const own = (o: any): string => Reflect.ownKeys(o).map(k => String(k) + ":" + show(Object.getOwnPropertyDescriptor(o, k)!.value)).join(",");
const attempt = (f: () => any): string => { try { return show(f()); } catch (e) { return (e as Error).name; } };
class Point { x = 1; y = 2; }
class Named { x = 1; toString(): string { return "named" + this.x; } get valueOf(): any { return () => this.x; } }
class Guarded { x = 1; stored: any[] = []; set hasOwnProperty(v: any) { this.stored.push(v); } get hasOwnProperty(): any { return this.stored.length; } }
class Heir extends Guarded { z = 3; }
class Late { x = 1; constructor(i: number) { if (i % 2) (this as any).toString = (): string => "late" + i; (this as any).kind = i; } }
const frozenBase = Object.freeze({ toString: 1, isPrototypeOf: 2 });
const setterBase = { set toString(v: any) { (this as any).taken = v; }, get valueOf(): any { return 7; } } as any;
const makers: Record<string, (i: number) => any> = {
  empty: () => ({}), literal: i => ({ a: i }), two: i => ({ a: i, b: 2 }), point: () => new Point(), named: () => new Named(), guarded: () => new Guarded(), heir: () => new Heir(), late: i => new Late(i),
  nothing: () => Object.create(null), belowFrozen: () => Object.create(frozenBase), belowSetter: () => Object.create(setterBase), belowLiteral: i => Object.create({ a: i, toString: 5 }), frozen: i => Object.freeze({ a: i }), sealed: i => Object.seal({ a: i, toString: 0 }), closed: i => Object.preventExtensions({ a: i }),
  elements: i => ({ 0: i, 1: 2, length: 2 }), elementsOnly: i => ({ 0: i, 5: 1 }), far: i => ({ 1000000: i }), spread: i => ({ ...{ a: i }, 3: 1 }), doubles: i => ({ 0: i + 0.5, 1: 2.5 }), texts: i => ({ 0: "t" + i, 1: "u" }), filled: i => { const o: any = {}; for (let k = 0; k < i % 5; k++) o[k] = k; return o; },
  pointElements: i => { const p: any = new Point(); p[0] = i; p[1] = 2; return p; }, jquery: i => { const q: any = new Late(i); q[0] = "el"; q.length = 1; q.context = null; return q; }, removed: i => { const o: any = { 0: i, 1: 2 }; delete o[0]; delete o[1]; return o; }, named2: i => { const o: any = { 0: i }; o.zz = 1; delete o.zz; return o; },
};
const ways: Record<string, (o: any, i: number) => any> = {
  toStringValue: (o: any, i: number) => { o.toString = i; return o.toString; },
  toStringFunction: (o: any, i: number) => { o.toString = () => "t" + i; return o + ""; },
  valueOf: (o: any, i: number) => { o.valueOf = () => i; return o * 2; },
  hasOwn: (o: any, i: number) => { o.hasOwnProperty = i; return o.hasOwnProperty; },
  constructorName: (o: any, i: number) => { o.constructor = Point; o.isPrototypeOf = i; return o.constructor === Point; },
  several: (o: any, i: number) => { o.kind = i; o.toString = 1; o.valueOf = 2; o.toLocaleString = 3; o.propertyIsEnumerable = 4; o.last = 5; return o.last; },
  proto: (o: any, i: number) => { o.__proto__ = { via: i }; o.toString = i; return o.via; },
  getters: (o: any, i: number) => { o.__defineGetter__ = i; o.__lookupSetter__ = 2; return o.__defineGetter__; },
  names: (o: any, i: number) => { o.kind = i; o.a = 1; o.b = 2; o.c = 3; o.d = 4; o.length = 9; o.e = 5; return o.e; },
  namesThenElements: (o: any, i: number) => { o.kind = i; o[7] = 1; o.more = 2; o[2] = 3; o.b = 4; return o[7]; },
  byKey: (o: any, i: number) => { for (const k of ["kind", "toString", "c", "valueOf"]) o[k] = i; return o.c; },
  twice: (o: any, i: number) => { o.toString = 1; delete o.toString; o.kind = 2; o.toString = i; return o.toString; },
  assign: (o: any, i: number) => Object.assign(o, { toString: i, kind: 1, hasOwnProperty: 2 }).kind,
  defined: (o: any, i: number) => { Object.defineProperty(o, "toString", { value: i, writable: true, configurable: true, enumerable: true }); o.toString = 3; o.kind = i; return o.toString; },
};
for (let round = 0; round < 8; round++) for (const [w, way] of Object.entries(ways)) {
  let line = w;
  for (const [m, make] of Object.entries(makers)) {
    const o = make(round), got = attempt(() => way(o, round));
    line += " " + m + "=" + got + "{" + attempt(() => own(o)) + "}" + attempt(() => JSON.stringify(o)) + attempt(() => Object.keys(o).length);
    let order = ""; for (const k in o) order += k + ";"; line += order;
  }
  add(line); if (round === 7) console.log(line.length, digest);
}
function hot(n: number): string {
  let r = 0, t = "";
  for (let i = 0; i < n; i++) {
    const e: any = {}; e.toString = i; e.valueOf = 2; e.kind = 3; r += e.toString + e.valueOf + e.kind;
    const p: any = new Point(); p.hasOwnProperty = i; p.constructor = 5; r += p.hasOwnProperty + p.constructor + p.x;
    const g: any = new Guarded(); g.hasOwnProperty = i; r += g.hasOwnProperty + g.stored[0];
    const a: any = { 0: i, 1: 2, length: 2 }; a.kind = i; a.a = 1; a.b = 2; a.c = 3; r += a.kind + a[0] + a.length + a.c;
    const q: any = new Late(i); q[0] = i; q.length = 1; q.context = null; r += q.length + q[0] + q.kind;
    const b: any = Object.create(setterBase); b.toString = i; r += b.taken + b.valueOf;
    if (i % 500 === 0) t += Object.keys(e) + "|" + Object.keys(p) + "|" + Object.keys(a) + "|" + Object.keys(q) + ";";
    r %= 1000003;
  }
  return r + " " + t;
}
console.log(hot(3000));
console.log(cases, digest, {}.toString(), ({} as any).hasOwnProperty("x"), String(new Named()), Object.keys(Object.prototype).length);
