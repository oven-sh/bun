// Objects whose type depends on a conditional type are read directly and out of arrays, Maps and tuples.
declare const console: { log(...a: unknown[]): void };
function row(name: string, f: () => unknown): void { let got: unknown; try { got = f(); } catch (e) { got = "threw " + (e as Error).name + " " + (e as Error).message; } console.log(name + ": " + got); }
type Pick3<N> = N extends 3 ? { a: string } : { b: number };
interface Vec<N> { data: Pick3<N>; size: N }
const v: Vec<3> = { data: { a: "x" }, size: 3 };
const w: Vec<4> = { data: { b: 7 }, size: 4 };
row("read directly", () => v.data.a + w.data.b);
const many: Vec<3>[] = [v];
row("out of an array", () => many[0].data.a);
row("out of an array by a loop", () => { let s = ""; for (const one of many) s += one.data.a; return s; });
row("out of an array by a method", () => many.map(one => one.data.a).join() + many.at(0)!.data.a + many.find(one => one.size === 3)!.data.a);
const byName = new Map<string, Vec<3>>([["v", v]]);
row("out of a Map", () => byName.get("v")!.data.a);
row("out of a Map by a loop", () => { let s = ""; for (const [, one] of byName) s += one.data.a; return s; });
const pair: [Vec<3>, 3] = [v, 3];
row("out of a tuple", () => pair[0].data.a + pair[1]);
interface Outer<N> { inner: Vec<N> }
const o: Outer<3> = { inner: v };
row("through another generic of the program", () => o.inner.data.a);
const kept = v;
row("kept in another const", () => kept.data.a);
function hand<N>(it: Vec<N>): Vec<N> { return it; }
row("handed through a generic function", () => hand(v).data.a);
