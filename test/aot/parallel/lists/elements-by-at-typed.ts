// at() of typed lists, in loops and outside them, while the lists change.
import vm from "node:vm";
let cases = 0, digest = 0;
const add = (t: string): void => { cases++; for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
interface Point { x: number; y?: string }
class Stack<T> {
  items: T[] = [];
  top(): T | undefined { return this.items.at(-1); }
  bottom(): T | undefined { return this.items.at(0); }
  under(k: number): T | undefined { return this.items.at(-1 - k); }
  push(v: T): this { this.items.push(v); return this; }
  pop(): T | undefined { return this.items.pop(); }
}
function lastNumber(a: number[]): number { return a.at(-1) ?? NaN; }
function lastText(a: readonly string[]): string { return a.at(-1) ?? "none"; }
function lastPoint(a: Point[]): Point | undefined { return a.at(-1); }
function pick<T>(a: T[], k: number): T | undefined { return a.at(k); }
function tail(a: number[], k: number): number | undefined { if (k > 5) return tail(a, k - 1); return a.at(k); }
function* each(a: number[]): Generator<number | undefined> { for (let i = -3; i < 3; i++) yield a.at(i); }
async function later(a: number[]): Promise<number | undefined> { const v = a.at(-1); await null; return (a.at(0) ?? 0) + (v ?? 0); }
function caught(a: number[] | null, k: number): string { try { return String(a!.at(k)); } catch (e) { return (e as Error).constructor.name; } }
const show = (v: unknown): string => typeof v + String(v) + (v === 0 ? 1 / v : "");
const numbers: number[][] = [[1, 2, 3], [0.5, -0, NaN], [], [1, , 3] as number[], [4294967295, -2147483648], [1e300, 7], new Array(4), Object.freeze([5, 6]) as number[], [1, 2, 3, 4].slice(1), Array.from({ length: 40 }, (_, i) => i)];
const texts: string[][] = [["a"], ["b", "c"], [], "x,y".split(",")];
const points: Point[][] = [[{ x: 1 }, { x: 2, y: "p" }], [], [{ x: 3 }]];
for (let round = 0; round < 4; round++) {
  for (const a of numbers) {
    let line = show(lastNumber(a)) + caught(a, 1) + caught(null, 1);
    for (let k = -5; k < 5; k++) line += show(a.at(k)) + show(pick(a, k)) + show(tail(a, k + 5)) + show(pick(a, k + 0.5)) + show(a.at(k * 1e10));
    for (const v of each(a)) line += show(v);
    add(line); if (round === 3) console.log(line.length, digest);
  }
  for (const a of texts) { let line = lastText(a); for (let k = -3; k < 3; k++) line += show(a.at(k)) + show(pick(a, k)); add(line); }
  for (const a of points) { let line = ""; for (let k = -3; k < 3; k++) { const p = a.at(k); line += p ? p.x + (p.y ?? "-") : "none"; } const l = lastPoint(a); line += l === undefined ? "u" : l.x; add(line); }
}
const s = new Stack<number>(), t = new Stack<string>(), p = new Stack<Point>();
let walk = "";
for (let i = 0; i < 200; i++) {
  s.push(i).push(i + 0.5); t.push("t" + i); p.push({ x: i });
  walk += (s.top() ?? -1) + "," + (s.under(1) ?? -1) + "," + (s.under(9999) ?? -1) + t.top() + t.bottom() + p.top()!.x;
  if (i % 3 === 0) { s.pop(); t.pop(); p.pop(); }
  if (i === 150) { s.items.length = 2; t.items.length = 0; }
  if (i === 160) { (s.items as any)[5000] = 5; (s.items as any).named = "n"; }
  if (i === 170) s.items = [];
}
add(walk); console.log(walk.length, digest);
const growing: number[] = [];
let sum = 0;
for (let i = 0; i < 3000; i++) { growing.push(i % 7 === 0 ? i + 0.25 : i); sum += growing.at(-1)! + (growing.at(i >> 1) ?? 0) - (growing.at(-i) ?? 0); if (i % 500 === 499) growing.splice(10); }
console.log(sum, growing.length);
const own: any = [1, 2, 3]; own.at = (k: number): string => "own" + k;
console.log(pick(own, -1), lastNumber(own as number[]), caught(own, 2));
class List extends Array<number> { override at(k: number): number | undefined { return 1000 + k; } }
console.log(pick(new List(1, 2, 3), -1), lastNumber(List.from([1, 2]) as number[]));
class Plain extends Array<number> { }
console.log(pick(Plain.of(1, 2, 3) as Plain, -1), lastNumber(Plain.of(4, 5) as Plain));
const foreign: any = vm.runInNewContext("[10, 20, 30]");
console.log(pick(foreign, -1), lastNumber(foreign), foreign.at(1), caught(foreign, 0));
const method = Array.prototype.at;
console.log(method.call([1, 2, 3], -2), method.call("abc" as any, 1), [[1, 2], [3]].map(a => method.call(a, -1)).join(), method.length, method.name, method === [].at, pick.length);
console.log(cases, digest);
later([1, 2, 3]).then(v => console.log("later", v));
