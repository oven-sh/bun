// A loop that only pops stands inside the loop that pushes, or behind it: the list is read under its own length, under a constant, by the loop around.
const show = (x: unknown): string => (Object.is(x, -0) ? "-0" : Array.isArray(x) ? "[" + Array.from(x, show).join() + "]" : String(x));
function monotonic(L: number[]): unknown { const q: number[] = []; let s = 0; for (let i = 0; i < L.length; i++) { while (q.length > 0 && L[q[q.length - 1]!]! < L[i]!) q.pop(); s += q.length > 0 ? q[q.length - 1]! : 0; q.push(i); } return [s, q]; }
function values(L: number[]): unknown { const q: number[] = []; let s = 0; for (let i = 0; i < L.length; i++) { while (q.length > 0 && q[q.length - 1]! < L[i]!) s += q.pop()!; q.push(L[i]!); s -= q[0]!; } return [s, q]; }
function drained(L: number[]): unknown { const q: number[] = []; for (let i = 0; i < L.length; i++) q.push(L[i]!); let s = 0; while (q.length > 1) s += q.pop()! - q[0]!; return [s, q]; }
function halved(L: number[]): unknown { const q: number[] = [0.5]; let s = 0; for (let i = 0; i < L.length; i++) { q.push(L[i]!); q.push(i); let g = q.length >> 1; while (q.length > g && q.length > 1) { s += q[0]!; q.pop(); } } return [s, q]; }
function bars(L: number[]): unknown { const q: number[] = []; let best = 0; for (let i = 0; i <= L.length; i++) { const h = i === L.length ? -1 : L[i]!; while (q.length > 0 && L[q[q.length - 1]!]! >= h) { const t = L[q.pop()!]!; const w = q.length > 0 ? i - q[q.length - 1]! - 1 : i; if (t * w > best) best = t * w; } q.push(i); } return [best, q]; }
function left(L: number[]): unknown { const q: number[] = [7]; let s = 0; for (let i = 0; i < L.length; i++) { while (true) { const x = q.pop(); if (x === undefined) { s += 1000; break; } s += x; if (x < L[i]!) break; } q.push(L[i]!); } return [s, q]; }
const inputs: (() => number[])[] = [() => [5, 3, 8, 1, 9, 2, 7, 7], () => [1.5, 0.5, 2.5, 2, 0.25, 9], () => JSON.parse("[4,3,2,1,6,5]"), () => JSON.parse("[4.5,3,2.25,1]"), () => [2147483647, 2147483648, -1, 4], () => [], () => [NaN, 1, -0, 0], () => Array.from({ length: 40 }, (_, i) => (i * 7919) % 41), () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]];
for (let turn = 0; turn < 3; turn++)
  for (const run of [monotonic, values, drained, halved, bars, left])
    for (const input of inputs) console.log(run.name, show(run(input())).slice(0, 120));
export {};
