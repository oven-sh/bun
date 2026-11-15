// A loop whose accesses go to one of several arrays from before the loop: the guards of the arrays hold behind the join of the choice.
function work(one: number[], other: number[], third: number[], maybe: number[] | undefined, which: boolean, pair: { a: number[]; b: number[] }): any { let s: any = 0; for (let i = 0; i < 12; i++) { const t = (i % 3 === 0 ? one : i % 3 === 1 ? other : third), kept = t[i]!; t[i] = one[(i + 2) % 12]!; one[(i + 2) % 12] = kept; } return s; }
const lists: (() => any)[] = [
  () => Array.from({ length: 12 }, (_, i) => i), () => Array.from({ length: 12 }, (_, i) => i + 0.5), () => JSON.parse("[1,2,3,4,5,6,7,8,9,10,11,12]"), () => [1, , 3, 4, , 6, 7, 8, 9, 10, 11, 12],
  () => [1.5, , 3, 4, , 6, 7.25, 8, 9, 10, 11, 12], () => [1, 2, NaN, -0, 5, 6, 7, 8, 9, 1e300, 11, 12], () => ["a", "b", 3, 4, 5, "f", 7, 8, 9, 10, 11, 12], () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  () => [1, 2, 3], () => [], () => new Array(12), () => Int32Array.from({ length: 12 }, (_, i) => i * 2), () => Float64Array.from({ length: 12 }, (_, i) => i / 4), () => [1, undefined, null, true, 5, 6, 7, 8, 9, 10, 11, 12],
  () => new (class Own extends (Array as any) {} as any)(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), () => ({ length: 12, 0: 1, 1: 2, 2: 3 }), () => undefined,
];
let pokes = 0;
let kept: any = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
function poke(one: any, other: any): void { pokes++; if (pokes % 4 === 1 && Array.isArray(one) && !Object.isFrozen(one)) one.length = 3; if (pokes % 4 === 2 && Array.isArray(other) && !Object.isFrozen(other)) other.push(0.5); if (pokes % 4 === 3 && Array.isArray(one) && !Object.isFrozen(one)) one[7] = "text"; if (pokes % 4 === 0) kept = [0.5, 1.5]; }
function shown(x: any): string { return Array.isArray(x) || ArrayBuffer.isView(x) ? "[" + (x as any).length + ":" + Array.from({ length: Math.min((x as any).length, 13) }, (_, i) => (i in (x as any) ? leaf((x as any)[i]) : "hole")).join(",") + "]" : leaf(x); }
function leaf(x: any): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : typeof x + ":" + String(x); }
const lines: string[] = [];
for (let round = 0; round < 2; round++) for (let a = 0; a < lists.length; a++) for (let b = 0; b < lists.length; b += a % 4 + 1) {
  const one = lists[a]!(), other = a === b ? one : lists[b]!(), third = lists[(a + b) % lists.length]!();
  let answer: string;
  try { answer = shown(work(one, other, third, a & 1 ? one : undefined, b % 3 > 0, { a: one, b: other })); } catch (e: any) { answer = e.constructor.name; }
  lines.push(answer + shown(one) + shown(other) + shown(third));
}
console.log(lines.length, lines.map((l, i) => i % 17 === 3 ? l : "").filter(l => l).join("\n"));
let hash = 0; for (const l of lines) for (let i = 0; i < l.length; i++) hash = (hash * 31 + l.charCodeAt(i)) | 0; console.log(hash);
export {};
