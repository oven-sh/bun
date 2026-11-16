// at() in loops over lists of objects, numbers, texts and rows, at their ends, past them, and while they grow and shrink.
class P { x: number; y: number; constructor(x: number) { this.x = x; this.y = x + 1; } }
function lastOf(a: P[]): number { let n = 0; for (let i = 0; i < 5; i++) { const p = a.at(-1)!; n = (n + p.x + p.y) | 0; } return n; }
function each(a: P[]): number { let n = 0; for (let i = 0; i < a.length; i++) { const p = a.at(i)!; n += p.x * p.y; } return n; }
function pushed(a: P[], q: P): number { let n = 0; for (let i = 0; i < 4; i++) { a.push(q); n += a.at(-1)!.x; a.pop(); n += a.at(-1)?.x ?? -1; } return n; }
function numbers(a: number[]): number { let n = 0; for (let i = 0; i < 5; i++) n += a.at(-1)! + a.at(i)!; return n; }
function doubles(a: number[]): number { let n = 0; for (let i = 0; i < a.length; i++) n += a.at(i)! * a.at(-2)!; return n; }
function texts(a: string[]): string { let s = ""; for (let i = 0; i < 4; i++) s += a.at(-1) + (a.at(i) ?? "none"); return s; }
function rows(a: number[][]): number { let n = 0; for (let i = 0; i < a.length; i++) for (let k = 0; k < 3; k++) n += a.at(i)!.at(-1)! + (a.at(-1)?.at(k) ?? 0.5); return n; }
function maybe(a: (P | undefined)[]): number { let n = 0; for (let i = -3; i < 5; i++) { const p = a.at(i); n += p ? p.x : -1; } return n; }
function store(a: number[]): number[] { for (let i = 0; i < a.length; i++) a[i] = a.at(-1)! + a.at(-i - 1)!; return a; }
const out: string[] = [];
function tell(name: string, f: () => unknown): void { let r: string; try { const v = f(); r = Array.isArray(v) ? v.join() : String(v); } catch (e: any) { r = e.constructor.name; } out.push(name + " " + r); }
const ps = [new P(1), new P(2), new P(3)];
tell("last", () => lastOf(ps)); tell("last none", () => lastOf([])); tell("each", () => each(ps)); tell("pushed", () => pushed(ps, new P(9))); tell("pushed none", () => pushed([], new P(9)));
tell("numbers", () => numbers([1, 2, 3])); tell("numbers long", () => numbers([1, 2, 3, 4, 5.5])); tell("numbers none", () => numbers([])); tell("doubles", () => doubles([1.5, 2.5, 3.5])); tell("doubles one", () => doubles([1.5])); tell("texts", () => texts(["a", "bc"])); tell("texts none", () => texts([]));
tell("rows", () => rows([[1, 2, 3], [4, 5.5]])); tell("rows none", () => rows([[], [1]])); tell("maybe", () => maybe([new P(1), undefined, new P(4)])); tell("store", () => store([1, 2, 3, 4])); tell("store doubles", () => store([1.5, 2]));
const odd: any[] = [JSON.parse("[1,2,\"x\"]"), [1, , 3], new Array(3), [undefined, null], Object.freeze([1, 2])];
for (const o of odd) { tell("odd numbers", () => numbers(o)); tell("odd doubles", () => doubles(o)); tell("odd store", () => store(o)); tell("odd last", () => lastOf(o)); tell("odd texts", () => texts(o)); }
console.log(out.join("\n"));
export {};
