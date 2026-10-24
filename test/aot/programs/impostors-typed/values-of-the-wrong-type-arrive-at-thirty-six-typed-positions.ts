// A program behaves the same whether its types are right, wrong or absent: a value of another type arrives at thirty-six typed positions, three rounds each,
// and the values, their types and the classes of the errors are those of plain Bun. The wording of the messages is left out.
declare const console: { log(...a: unknown[]): void };
const lie = <T,>(v: unknown): T => v as T;
const show = (label: string, f: () => unknown) => { try { const r = f(); console.log(label, typeof r, JSON.stringify(r) ?? String(r)); } catch (e: any) { console.log(label, "THREW", e?.constructor?.name); } };
function add(a: number, b: number): number { return a + b; }
function len(s: string): number { return s.length; }
function first(xs: number[]): number { return xs[0] * 2; }
class Vec { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } norm(): number { return Math.sqrt(this.x * this.x + this.y * this.y); } }
function normOf(v: Vec): number { return v.norm(); }
function xOf(v: Vec): number { return v.x + 1; }
interface Named { name: string; age: number }
function greet(p: Named): string { return p.name + ":" + (p.age + 1); }
enum Color { Red, Green, Blue }
function paint(c: Color): string { return c === Color.Red ? "red" : c === Color.Green ? "green" : "other:" + c; }
function apply(f: (n: number) => number, n: number): number { return f(n) + 1; }
function opt(a?: number): number { return (a ?? 5) + 1; }
function ret(): number { return lie<number>("not a number"); }
function union(v: string | number): string { return typeof v === "string" ? "s" + v : "n" + (v + 1); }
function tuple(t: [number, string]): string { return t[1] + t[0]; }
function big(n: bigint): bigint { return n + 1n; }
function mapGet(m: Map<string, number>, k: string): number { return (m.get(k) ?? 0) + 1; }
async function later(n: number): Promise<number> { return n + 1; }
function* gen(n: number): Generator<number> { yield n + 1; }
for (let round = 0; round < 3; round++) {
  show("add ok", () => add(1, 2));
  show("add str", () => add(lie<number>("1"), 2));
  show("add obj", () => add(lie<number>({ valueOf() { return 40; } }), 2));
  show("add undef", () => add(lie<number>(undefined), 2));
  show("add missing", () => (add as any)(1));
  show("len num", () => len(lie<string>(42)));
  show("len arr", () => len(lie<string>([1, 2, 3])));
  show("len null", () => len(lie<string>(null)));
  show("first strs", () => first(lie<number[]>(["7", "8"])));
  show("first arraylike", () => first(lie<number[]>({ 0: 21, length: 1 })));
  show("first typed", () => first(lie<number[]>(new Uint8Array([9]))));
  show("norm plain", () => normOf(lie<Vec>({ x: 3, y: 4, norm() { return -1; } })));
  show("norm none", () => normOf(lie<Vec>({ x: 3, y: 4 })));
  show("xOf plain", () => xOf(lie<Vec>({ x: "3" })));
  show("xOf proxy", () => xOf(lie<Vec>(new Proxy({}, { get: () => 10 }))));
  show("xOf sub", () => xOf(Object.create(new Vec(5, 6))));
  show("greet wrong", () => greet(lie<Named>({ name: 7, age: "8" })));
  show("greet getter", () => greet(lie<Named>({ get name() { return "g"; }, get age() { return 1; } })));
  show("paint 99", () => paint(lie<Color>(99)));
  show("paint 1.5", () => paint(lie<Color>(1.5)));
  show("paint str", () => paint(lie<Color>("Red")));
  show("apply str fn", () => apply(lie<(n: number) => number>((n: any) => n + "!"), 1));
  show("apply non fn", () => apply(lie<(n: number) => number>(3), 1));
  show("opt null", () => opt(lie<number>(null)));
  show("opt str", () => opt(lie<number>("x")));
  show("ret", () => ret());
  show("union bool", () => union(lie<string>(true)));
  show("union obj", () => union(lie<number>({})));
  show("tuple swapped", () => tuple(lie<[number, string]>(["a", 1])));
  show("big num", () => big(lie<bigint>(1)));
  show("map obj", () => mapGet(lie<Map<string, number>>({ get: () => 9 }), "k"));
  show("map plain", () => mapGet(lie<Map<string, number>>({}), "k"));
  show("field store", () => { const v = new Vec(1, 2); v.x = lie<number>("s"); (v as any).z = 1; delete (v as any).y; return [v.x, v.y, v.norm()]; });
  show("ctor wrong", () => { const v = new Vec(lie<number>("a"), lie<number>(null)); return [v.x, v.y, v.norm()]; });
  show("this wrong", () => Vec.prototype.norm.call(lie<Vec>({ x: 6, y: 8 })));
  show("gen", () => [...gen(lie<number>("g"))]);
}
console.log(await later(lie<number>("p")), await later(lie<number>({})).then(String));
export {};
