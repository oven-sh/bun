// Loops that push the elements of a list, or numbers made of them, onto arrays made here: the list holds int32s, doubles, boxed numbers, holes or what is no number, changes while it is walked, or is the array that is filled.
function shown(x: unknown): string { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : typeof x + ":" + String(x); }
function show(list: unknown[]): string { const parts: string[] = []; for (let i = 0; i < list.length; i++) parts.push(i in list ? shown(list[i]) : "hole"); return parts.join(","); }
function veil<T>(x: T): T { return JSON.parse("[1]")[0] === 1 ? x : x; }

function same(list: number[]): string { const more: number[] = []; for (const n of list) more.push(n); return show(more); }
function plus(list: number[]): string { const more: number[] = []; for (const n of list) more.push(n + 1); return show(more); }
function half(list: number[]): string { const more: number[] = []; for (const n of list) more.push(n * 0.5); return show(more); }
function above(list: number[]): string { const more: number[] = []; for (const n of list) if (n > 4) more.push(n); return show(more); }
function aboveByIndex(list: number[]): string { const more: number[] = []; for (let i = 0; i < list.length; i++) { const n = list[i]!; if (n > 4) more.push(n); } return show(more); }
function parted(list: number[]): string { const a: number[] = [], b: number[] = []; for (const n of list) { if (n > 4) a.push(n); else b.push(n); } return show(a) + "|" + show(b); }
function sums(list: number[]): string { const more: number[] = []; let s = 0; for (const n of list) { s += n; more.push(s); } return show(more); }
function stacked(list: number[]): string { const stack: number[] = []; let t = 0; for (const n of list) { if (n & 1 && stack.length > 0) t += stack.pop()! & 255; else stack.push(n); } return show(stack) + "|" + t; }
function objects(list: number[]): string { const more: { n: number }[] = []; for (const n of list) more.push({ n }); return show(more.map(m => m.n)); }
function texts(list: number[]): string { const more: string[] = []; for (const n of list) more.push(n > 4 ? "above" : "below"); return show(more); }
function own(list: number[]): string { const more: number[] = [1, 2]; let left = 9; for (const n of more) if (left-- > 0) more.push(n + 1); for (const n of list) more.push(n); return show(more); }
function aliased(list: number[]): string { const more: number[] = [7]; const from = veil(more); let left = 9; for (const n of from) { if (left-- <= 0) break; more.push(n + 1); } return show(more) + show(list); }
function grows(list: number[]): string { const more: number[] = []; let seen = 0; for (const n of list) { more.push(n + 1); if (++seen === 3) list.push(1.25); if (seen > 30) break; } return show(more); }
function shrinks(list: number[]): string { const more: number[] = []; let seen = 0; for (const n of list) { more.push(n + 1); if (++seen === 3) list.length = 4; } return show(more); }
function caught(list: number[]): string { const more: number[] = []; try { for (const n of list) more.push(n + 1); } finally { more.push(-1); } return show(more); }

const lists: [string, () => number[]][] = [
  ["ints", () => [3, 8, 1, 9, 5, 4, 7, 2, 6]],
  ["doubles", () => [0.5, 8.25, 1.5, 9.75, 5.5, 4.5, 7.5]],
  ["one fraction", () => [3, 8, 1, 9.5, 5, 4]],
  ["one NaN", () => [3, 8, 1, 9, 5, NaN]],
  ["NaN first", () => [NaN, 8, 1, 9, 5]],
  ["undefined", () => [3, 8, undefined as unknown as number, 9, 5]],
  ["a hole", () => { const list = [3, 8, 1, 9, 5, 4]; delete list[2]; return list; }],
  ["a text", () => [3, 8, "12" as unknown as number, 9, 5]],
  ["an object", () => [3, 8, { valueOf() { return 12; } } as unknown as number, 9]],
  ["a BigInt", () => [3, 8, 7n as unknown as number, 9]],
  ["edges", () => [2147483647, -2147483648, 2147483646, 1073741824, -1]],
  ["big", () => [3, 2 ** 40, -(2 ** 53), 8]],
  ["-0", () => [3, -0, 0, 8]],
  ["infinite", () => [3, Infinity, -Infinity, 8]],
  ["parsed", () => JSON.parse('[1,2.5,null,3,-0,1e400,"4",[5],true]') as number[]],
  ["its own iterator", () => { const list = [3, 8, 1]; (list as unknown as Record<symbol, unknown>)[Symbol.iterator] = function* () { yield 1; yield 2.5; }; return list; }],
  ["empty", () => []],
];
for (const [name, make] of lists) for (const run of [same, plus, half, above, aboveByIndex, parted, sums, stacked, objects, texts, own, aliased, grows, shrinks, caught]) for (let turn = 0; turn < 3; turn++) {
  let said: string;
  try { said = run(make()); } catch (error) { said = (error as Error).name; }
  if (turn !== 1) console.log(name, run.name, said);
}
