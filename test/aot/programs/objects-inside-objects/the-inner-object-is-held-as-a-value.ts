// Each of these holds the inner object as a value somewhere: in an array, in a parameter, in a local name across a store to the field, in a closure's result.
interface Inner { d: number; e: number }
interface A { b: number; c: Inner }
function makeA(i: number): A { return { b: i, c: { d: i, e: i + 1 } }; }
const a1 = makeA(1), a2 = makeA(2);
const kept: Inner[] = [a1.c];
kept[0].d = 10;
console.log(a1.c.d, a1.c === kept[0], a1.c === a2.c, a1.c === a1.c);
interface B { b: number; c: Inner }
function makeB(i: number): B { return { b: i, c: { d: i, e: i + 1 } }; }
function takes(inner: Inner): number { inner.e += 5; return inner.d + inner.e; }
const b1 = makeB(3);
console.log(takes(b1.c), b1.c.e);
interface C { b: number; c: Inner }
function makeC(i: number): C { return { b: i, c: { d: i, e: i + 1 } }; }
const c1 = makeC(4);
const old = c1.c; c1.c = { d: 40, e: 41 }; old.d = 99;
console.log(c1.c.d, old.d);
interface D { b: number; c: Inner }
function makeD(i: number): D { return { b: i, c: { d: i, e: i + 1 } }; }
const d1 = makeD(5);
const read = () => d1.c;
read().d = 50;
console.log(d1.c.d, typeof d1.c, d1.c ? "truthy" : "falsy", d1.c == null);
