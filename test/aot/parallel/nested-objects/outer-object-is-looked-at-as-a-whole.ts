// The outer object is looked at as a whole: by JSON, its keys, a spread, for-in, a computed key, freeze, a descriptor, structuredClone, delete and console.log.
interface Inner { d: number; e: number }
interface A { b: number; c: Inner }
function makeA(i: number): A { return { b: i, c: { d: i, e: i + 1 } }; }
const a = makeA(1); a.c.d += 1;
console.log(JSON.stringify(a));
interface B { b: number; c: Inner }
function makeB(i: number): B { return { b: i, c: { d: i, e: i + 1 } }; }
const b = makeB(2); b.c.d += 1;
console.log(Object.keys(b).join(), "c" in b, Object.prototype.hasOwnProperty.call(b, "c"));
interface C { b: number; c: Inner }
function makeC(i: number): C { return { b: i, c: { d: i, e: i + 1 } }; }
const c = makeC(3); c.c.d += 1;
const copy = { ...c }; copy.c.e = 77;
console.log(c.c.e, copy.c === c.c);
interface D { b: number; c: Inner }
function makeD(i: number): D { return { b: i, c: { d: i, e: i + 1 } }; }
const d = makeD(4); d.c.d += 1;
let names = ""; for (const k in d) names += k; console.log(names);
interface E { b: number; c: Inner }
function makeE(i: number): E { return { b: i, c: { d: i, e: i + 1 } }; }
const e = makeE(5); e.c.d += 1;
const key: string = ["b", "c"][e.b - 4];
console.log(JSON.stringify((e as any)[key]));
interface F { b: number; c: Inner }
function makeF(i: number): F { return { b: i, c: { d: i, e: i + 1 } }; }
const f = Object.freeze(makeF(6)); f.c.d += 1;
console.log(f.c.d, Object.isFrozen(f), Object.isFrozen(f.c));
interface G { b: number; c: Inner }
function makeG(i: number): G { return { b: i, c: { d: i, e: i + 1 } }; }
const g = makeG(7); g.c.d += 1;
console.log(Object.getOwnPropertyDescriptor(g, "c")!.writable, Object.entries(g).length, structuredClone(g).c.d);
interface H { b: number; c: Inner }
function makeH(i: number): H { return { b: i, c: { d: i, e: i + 1 } }; }
const h = makeH(8); h.c.d += 1;
delete (h as any).c;
console.log(h.c === undefined);
console.log(makeA(9));
