// Objects whose type depends on a conditional type over a type argument.
declare const console: { log(...a: unknown[]): void };
type Pick3<N> = N extends 3 ? { a: string } : { b: number };
interface Vec<N> { data: Pick3<N>; size: N }
const v: Vec<3> = { data: { a: "x" }, size: 3 };
const w: Vec<4> = { data: { b: 7 }, size: 4 };
function dataOf<N>(it: Vec<N>): Pick3<N> { return it.data; }
console.log(v.data.a, w.data.b, dataOf(v).a, dataOf(w).b);
interface Taker<N extends number> { take: (n: N) => string; last: N }
const t: Taker<1 | 2> = { take: n => (n === 1 ? "one" : "two"), last: 2 };
console.log(t.take(t.last), t.take(1));
type Names = ["zero", "one", "two"];
interface At<N extends 0 | 1 | 2> { name: Names[N] }
const at: At<1> = { name: "one" };
const all: At<0 | 2>[] = [{ name: "zero" }, { name: "two" }];
console.log(at.name, all.map(one => one.name).join());
class Dim<N extends number> { constructor(readonly n: N) {} same(other: Dim<N>) { return other.n === this.n; } }
const d3 = new Dim<3>(3);
console.log(d3.same(new Dim<3>(3)), d3.n);
