// Parameters of recursive functions index elements. Some calls bring numbers that are no int32s, or no numbers.
function down(a: number[], i: number, n: number): void { const l = 2 * i + 1, r = l + 1; let m = i; if (l < n && a[l] > a[m]) m = l; if (r < n && a[r] > a[m]) m = r; if (m !== i) { const x = a[i]; a[i] = a[m]; a[m] = x; down(a, m, n); } }
function sort(a: number[]): string { for (let i = a.length >> 1; i >= 0; i--) down(a, i, a.length); for (let n = a.length - 1; n > 0; n--) { const x = a[0]; a[0] = a[n]; a[n] = x; down(a, 0, n); } return a.join(); }
console.log(sort([5, 3, 9, 1, 7, 2, 8]), sort([0.5, -1, 2 ** 31, 2 ** 53, -0, 3]), sort([]));
const heap = [4, 9, 1];
down(heap, -1, 3); console.log(heap.join()); down(heap, 0.5, 3); console.log(heap.join()); down(heap, 2 ** 31, 2 ** 33); down(heap, 0, Infinity); console.log(heap.join());

const parent = Array.from({ length: 8 }, (_, i) => (i * 3) % 8);
let steps = 0;
function find(x: number): number { if (++steps > 30) return -1; return parent[x] === x ? x : (parent[x] = find(parent[x])); }
console.log([0, 1, 2, 7, 9, -1, 0.5].map(x => { steps = 0; return find(x); }).join(), parent.length, Object.keys(parent).join());

function fib(n: number, memo: any[]): number { if (n < 2) return n; if (memo[n] !== undefined) return memo[n]; memo[n] = fib(n - 1, memo) + fib(n - 2, memo); return memo[n]; }
for (const n of [10, 30, 7.5, 2.25, -3, -0]) { const memo: any[] = []; console.log(n, fib(n, memo), Object.keys(memo).length, memo.length); }
function total(a: any, i: number): any { return i === a.length || i > 40 ? 0 : a[i] + total(a, i + 1); }
console.log(total([1, 2, 3], 0), total([1.5, 2.5], 0), total("abc", 0), total([1, , 3], 0), total(new Float32Array([0.5, 4]), 0), total([1, 2, 3], -2), total([1, 2, 3], 0.5), total({ 0: 5, 1: 6, length: 2 }, 0));
const lengths: { [n: number]: number } = { 1: 1 };
let depth = 0;
function collatz(n: number): number { if (++depth > 300) return 0; const known = lengths[n]; if (known !== undefined) return known; const next = n & 1 ? n * 3 + 1 : n >> 1; return next < 4000 ? (lengths[n] = collatz(next) + 1) : collatz(next) + 1; }
for (const n of [27, 97, 837799, 2 ** 31, 2 ** 31 - 1, 2 ** 32 + 1, 0.5, -7]) { depth = 0; console.log(n, collatz(n)); }
const visit: any = function (this: any, i: any, seen: any[]): any { if (seen.length > 6) return seen.join(); seen.push(i); return visit(seen[i] === undefined ? i + 1 : seen[i] | 0, seen); };
console.log(visit(0, []), visit("1", []), visit(undefined, []), visit(null, []), visit(-0, []), visit(1.5, []), visit(2 ** 31 - 1, []), visit({ valueOf() { return 1; } }, []).length > 0);
class Grid { cells = [[1, 0, 1], [1, 1, 0], [0, 1, 1]]; left = 40; fill(y: number, x: number): number { if (--this.left < 0 || y < 0 || x < 0 || y > 2 || x > 2 || this.cells[y][x] !== 1) return 0; this.cells[y][x] = 2; return 1 + this.fill(y + 1, x) + this.fill(y - 1, x) + this.fill(y, x + 1) + this.fill(y, x - 1); } }
console.log(new Grid().fill(0, 0), new Grid().fill(2, 2), new Grid().fill(0, -1), new Grid().fill(-0, 0));
try { console.log(new Grid().fill(1.5, 0)); } catch (error) { console.log((error as Error).constructor.name); }
const bits = (n: number, at: number): number => at > 8 ? 0 : (n >> at & 1) + bits(n, at + 1);
console.log(bits(255, 0), bits(2 ** 32 + 5, 0), bits(-1, 0), bits(0.9, 0), bits(NaN, 0), bits(5, 0.5), bits(5, -1));
const grow = (i: number, list: number[]): number => i > 3e9 || list.length > 40 ? list.length : (list.push(list[i % 3] ?? 0), grow(i * 2 + 1, list));
console.log(grow(0, [1, 2, 3]), grow(2 ** 30, [1, 2, 3]), grow(-1, [1, 2, 3]));
