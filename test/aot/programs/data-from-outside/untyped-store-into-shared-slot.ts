// Two object types declare a field with the same name but different types, and the field is read through their union, so the two fields can share a slot. A value of the other field's type is stored through `any` or through the other object type. A read through the object's own type then throws a TypeError and never reinterprets the value as the declared type. A read through the union or through `any` returns the value.
type A = { v: number };
type B = { v: string };
type C = { w: { n: number } };
type D = { w: number };
function attempt(label: string, f: () => unknown): void { try { console.log(label, String(f())); } catch (e) { console.log(label, (e as Error).name); } }
function makeA(): A { return { v: 1 }; }
function makeB(): B { return { v: "bb" }; }
function makeC(): C { return { w: { n: 1 } }; }
function makeD(): D { return { w: 2 }; }
function readV(u: A | B): number | string { return u.v; }
function typeofW(u: C | D): string { return typeof u.w; }
function addOne(a: A): number { return a.v + 1; }
function lengthOf(b: B): number { return b.v.length; }
function inner(c: C): number { return c.w.n; }
function twice(d: D): number { return d.w * 2; }
function sum(list: A[]): number { let s = 0; for (const a of list) s += a.v; return s; }
function storeV(o: any, value: unknown): void { o.v = value; }
function storeW(o: any, value: unknown): void { o.w = value; }
function storeAsB(b: B, value: string): void { b.v = value; }
attempt("unmodified A:", () => addOne(makeA())); attempt("unmodified B:", () => lengthOf(makeB())); attempt("unmodified C:", () => inner(makeC())); attempt("unmodified D:", () => twice(makeD()));
attempt("the unions:", () => [readV(makeA()), readV(makeB()), typeofW(makeC()), typeofW(makeD())].join());
const a = makeA(), b = makeB(), c = makeC(), d = makeD(), aliased = makeA();
attempt("string in A, through any:", () => { storeV(a, "x"); return (a as any).v; });
attempt("string in A, through the union:", () => readV(a)); attempt("string in A, through A:", () => addOne(a));
attempt("number in B, through the union:", () => { storeV(b, 5); return readV(b); }); attempt("number in B, through B:", () => lengthOf(b));
attempt("stored through B, read through the union:", () => { storeAsB(aliased as unknown as B, "y"); return readV(aliased); }); attempt("stored through B, read through A:", () => addOne(aliased));
attempt("number in C, through the union:", () => { storeW(c, 7); return typeofW(c); }); attempt("number in C, through C:", () => inner(c));
attempt("object in D, through the union:", () => { storeW(d, { n: 1 }); return typeofW(d); }); attempt("object in D, through D:", () => twice(d));
attempt("a number in A again:", () => { storeV(a, 3); return addOne(a); });
attempt("undefined in A:", () => { storeV(a, undefined); return addOne(a); }); attempt("null in A:", () => { storeV(a, null); return addOne(a); });
attempt("another A:", () => addOne(makeA()));
const list: A[] = []; for (let i = 0; i < 1000; i++) list.push({ v: i });
attempt("sum:", () => sum(list));
attempt("sum with a string:", () => { storeV(list[500], "z"); return sum(list); });
export {};
