// Elements read in front of one that was found: lists of doubles, int32s and any value, with holes, that grow, shrink, share storage and change on the way.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + " "; log += "\n"; }
function both(list: number[], from: number, to: number): number { let t = 0; for (let i = from; i < to; i++) t += list[i] * 3 + list[i - 1]; return t; }
function three(list: number[], to: number): number { let t = 0; for (let i = 2; i <= to; i++) t = t / 2 + list[i] + list[i - 1] * 5 + list[i - 2] * 7; return t; }
function apart(list: number[], other: number[], to: number): number { let t = 0; for (let i = 1; i < to; i++) t += list[i] + other[i - 1]; return t; }
function rows(previous: number[], n: number): number[] { const current = [0]; for (let j = 1; j < n; j++) current.push(Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1])); return current; }
function shrinks(list: number[], to: number): string { let t = ""; for (let i = 1; i < to; i++) { t += list[i]; if (i === 3) list.length = 2; t += "," + list[i - 1] + " "; } return t; }
function pops(list: number[], to: number): string { let t = ""; for (let i = 1; i < to; i++) { t += list[i] + (list.pop() ?? -9); t += "," + list[i - 1] + " "; } return t; }
function stores(list: any[], to: number): string { let t = ""; for (let i = 1; i < to; i++) { const a = list[i]; list[i - 1] = i === 2 ? "x" : a; t += a + "," + list[i - 1] + " "; } return t; }
function same(list: number[], to: number): number { let t = 0; for (let i = 1; i < to; i++) { t += list[i]; list.push(t % 7); t += list[i - 1]; if (list.length > 60) break; } return t; }
function negative(list: number[], to: number): string { let t = ""; for (let i = 0; i < to; i++) t += list[i] + "," + list[i - 1] + " "; return t; }
function keyed(list: any, i: any): string { return list[i] + "," + list[i - 1]; }
function grid(lists: number[][], to: number): number { let t = 0; for (let y = 1; y < lists.length; y++) for (let x = 1; x < to; x++) t += lists[y][x] * 2 + lists[y][x - 1] + lists[y - 1][x - 1]; return t; }
const makes: (() => any[])[] = [() => [], () => [1], () => [1, 2, 3, 4, 5, 6, 7], () => [0.5, 1.5, 2.5, 3.5, 4.5], () => [1, , 3, , 5, 6], () => [0.5, , 2.5, NaN, 4.5], () => ["a", 1, null, undefined, 2.5], () => Array.from({ length: 24 }, (_, i) => i * i), () => Object.assign([1, 2, 3], { "-1": 9 }), () => [NaN, -0, Infinity, 2147483648, -1]];
for (let round = 0; round < 4; round++) {
  for (const make of makes) for (const n of [0, 1, 2, 5, 8, 24, 30]) {
    show(both(make(), 1, n), both(make(), 0, n), both(make(), 3, n), three(make(), n), apart(make(), make(), n), apart(make(), [1, 2], n), same(make(), n)); show(rows(make(), n)); show(rows(rows(make(), n), n));
    show(shrinks(make(), n), pops(make(), n), stores(make(), n), negative(make(), n)); show(grid([make(), make(), make()], n));
  }
  for (const i of [0, 1, 2, -1, 0.5, "1", "2", NaN, null, undefined, 4294967295, 4294967296, 1n === 1n ? 3 : 0]) show(keyed([1, 2, 3], i), keyed([0.5, 1.5], i), keyed("text", i), keyed(new Float64Array([1, 2, 3]), i), keyed({ 0: "o", 1: "p" }, i));
}
console.log(log.length, log);
