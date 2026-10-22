// Constants that go through casts are still folded at build time: a cast tests its value and never converts it.
declare const console: any;
function any(x: unknown): any { return x }
enum Kind { A = 1, B = 2, C = 5 }
interface Node { kind: Kind; pos: number }
interface NodeA extends Node { kind: Kind.A; a: number }
interface NodeC extends Node { kind: Kind.C; x: number; y: number; text: string }
function NodeConstructor(this: Node, kind: Kind, pos: number) { this.kind = kind; this.pos = pos }
const constructorOfNodes = NodeConstructor as any as new (kind: Kind, pos: number) => Node;
function makeC(kind: Kind): NodeC { const n = new constructorOfNodes(kind, 7) as NodeC; n.x = 1; n.y = 2; n.text = "text"; return n }
function makeA(kind: Kind): NodeA { const n = new constructorOfNodes(kind, 7) as NodeA; n.a = 1; return n }
function element(x: number): unknown { return [10, 20, 30, 40, 50, 60][x] }
function rest(x: number, ...more: number[]): unknown { return more[x] }
function power(b: number, x: number): number { return b ** x }
function mathPow(b: number, x: number): number { return Math.pow(b, x) }
class Base { m(): string { return "Base.m" } static s(): string { return "Base.s" } }
class Derived extends Base { m(): string { return "Derived.m" } viaText(): string { return super["m" as string as "m"]() } viaAny(): string { return super[any("m") as "m"]() } static s(): string { return super["s" as "s"]() } }
interface Foo { a: number; b: number }
function half(l: number[]): number { return Math.floor((l.length / 2) as number) }
function halfThroughAny(l: number[]): number { return Math.floor(any(l.length / 2) as number) }
function halfUp(l: number[], m: number[]): number { return Math.ceil(any(l.length / m.length) as number) }
function sumByText(o: any): number { let s = 0; for (const k in o) s += o[k as string]; return s }
function sumByKeyOf(o: Foo): number { let s = 0; for (const k in o) s += o[k as keyof Foo]; return s }
function sumOfWritten(o: any): number { let s = 0; for (const k in o) s += (o as Foo)[k as keyof Foo]; return s }
function sumThroughAny(o: Foo): number { let s = 0; for (const k in o) s += (o as any)[k]; return s }
function countOwn(o: any): number { let s = 0; for (const k in o) if (Object.hasOwn(o, k as string)) s++; return s }
function countHasOwn(o: any): number { let s = 0; for (const k in o) if (o.hasOwnProperty(k as string)) s++; return s }
function countIn(o: any): number { let s = 0; for (const k in o) if ((k as string) in o) s++; return s }
function second(x: unknown): string { return (x as string).charAt(1) }
function floorOfAny(x: number): number { return (Math as any).floor(x) }
function tail(s: unknown): string { return (s as any as string).slice(1) }
function pushed(l: unknown, x: number): number { return (l as number[]).push(x) }
function joined(l: unknown): string { return (l as any as string[]).join("-") }
function maxOf(l: number[]): number { return (Math.max as (...n: number[]) => number).apply(null, l) }
function sliced(this: unknown, ...a: number[]): number { return (Array.prototype.slice as any).call(arguments, 1).length }
function counted(n: number): number[] { const out: number[] = []; for (let i = 0 as number; i < n; i++) out.push(i); return out }
const derived = new Derived, list = [1, 2, 3, 4, 5, 6, 7], two = [1, 2];
let total = 0, text = "";
for (let turn = 0; turn < 300; turn++) {
  total += (element(any(5) as number) as number) + (element(5 as any as number) as number) + (element(2 as number) as number) + (rest(any(2) as number, 10, 20, 30) as number) + (rest(1 as any as number, 10, 20, 30) as number);
  total += power(3 + turn, any(2) as number) + power(9 + turn, 0.5 as any as number) + mathPow(2 + turn, any(3) as number) + power(2 + turn, 3 as number);
  text = derived.viaText() + derived.viaAny() + Derived.s();
  total += makeC(Kind.C).x + makeC(any(5) as Kind).y + makeC(5 as any as Kind).pos + makeA(Kind.A as Kind).a + makeA(any(1) as Kind).kind;
  total += half(list) + halfThroughAny(list) + halfUp(list, two);
  total += sumByText({ a: 1, b: 2 }) + sumByKeyOf({ a: 1, b: 2 }) + sumOfWritten({ a: 1, b: 2 }) + sumThroughAny({ a: 1, b: 2 }) + countOwn({ a: 1, b: 2 }) + countHasOwn({ a: 1, b: 2 }) + countIn({ a: 1, b: 2 });
  text += second("abc") + tail("abc") + joined(["a", "b"]);
  total += floorOfAny(turn / 2) + pushed([1], 2) + maxOf(list) + sliced(1, 2, 3) + counted(5).length;
}
console.log(total, text);
