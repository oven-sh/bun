// Parameters that calls step by one and sums of 32-bit integers, across two to the 31, two to the 32 and minus two to the 31, and up to two to the 53.
const text = "abcdefgh", list: number[] = [3, 1, 4, 1, 5, 9, 2, 6], bytes = new Uint8Array([1, 250, 3]), words = new Uint32Array([4294967295, 2147483648, 0]);
const said: unknown[] = [], map = new Map<number, number>(), sparse: Record<number, number> = {}, box: { held: number } = { held: 0 };
const show = (v: unknown): string => Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v);
function look(n: number): void {
  box.held = n; sparse[n] = 1; map.set(n, map.size); words[2] = n; bytes[2] = n; list[n & 7] = n;
  said.push(n, -n, n | 0, n >>> 0, n % 7, n / 2, n * 3, n === 2147483648, n < 4294967296, list[n], text[n], text.charCodeAt(n), `${n}`, n + "t", 1 / n, box.held, sparse[n], map.get(n), words[2], bytes[2], list[n & 7], Math.imul(n, 3), Math.max(n, 5), n << 1, n >> 1, n ** 2, typeof n, Number.isInteger(n), n.toString(16), [n, n + 1].join("-"), JSON.stringify([n]), n ? 1 : 0, n + 0.5);
}
function up(n: number, d: number): number { look(n); return d > 0 ? up(n + 1, d - 1) + 1 : n; }
function down(n: number, d: number): number { look(n); if (d === 0) return n; const r = down(n - 1, d - 1); return r - n; }
function both(n: number, d: number): string { if (d <= 0) return `${n}`; return both(n + 1, d - 2) + "," + both(n - 1, d - 2) + "," + both(1 + n, d - 3); }
function late(n: number, d = 3): number { look(n); return d > 0 ? late(n - -1, d - 1) : n; }
function odd(n: number, d: number): unknown { look(n); return d === 0 ? -n : even(n + 1, d - 1); }
function even(n: number, d: number): unknown { return d === 0 ? n : odd(n + 1, d - 1); }
function sums(a: number, b: number): number { const s = a + b, t = a - b; look(s); look(t); return s; }
function passes(n: number, d: number): number { return d > 0 ? passes(d & 1 ? n : n + 1, d - 1) : sums(n, d); }
class Tree { constructor(private depth: number, public left: Tree | null, public right: Tree | null) {} walk(depth: number, seen: number[]): number[] { seen.push(depth, this.depth); this.left?.walk(depth + 1, seen); this.right?.walk(depth - 1, seen); return seen; } }
function grow(n: number, depth: number): Tree | null { return n <= 0 ? null : new Tree(depth, grow(n - 1, depth + 1), grow(n - 2, depth + 1)); }
const far = list.length + 2147483636, near = words[0]! - 2;
for (const n of [0, -2, 5]) { console.log(show(up(n, 3)), show(down(n, 4)), show(late(n)), show(odd(n, 4)), both(n, 4)); console.log(said.splice(0).map(show).join(" ")); }
console.log(show(up(2147483646, 3)), show(down(-2147483647, 3)), show(late(2147483645)), both(2147483647, 3)); console.log(said.splice(0).map(show).join(" "));
console.log(show(up(far, 8)), show(down(-far, 8)), show(up(near, 4)), show(passes(far, 9))); console.log(said.splice(0).map(show).join(" "));
console.log(show(sums(2147483647, 2147483647)), show(sums(-2147483648, 2147483647)), show(sums(far, far)), show(sums(near, far))); console.log(said.splice(0).map(show).join(" "));
console.log(grow(4, -1)!.walk(2147483646, []).join(" "));
function steps(n: number, d: number): string { return d === 0 ? `${n}` : `${n} ` + steps(n + 1, d - 1); }
for (const n of [9007199254740988, 9007199254740991, 9007199254740992, -9007199254740992, 0.5, -0, NaN, Infinity]) console.log(steps(n, 6), show(-steps.length));
function less(n: number, d: number): string { return d === 0 ? show(n) : `${show(n)} ` + less(n - 1, d - 1); }
for (const n of [-9007199254740988, -9007199254740991, 9007199254740994, 1, 1.5, 2 ** 60]) console.log(less(n, 6));
function search(a: number[], x: number, lo: number, hi: number): number { if (lo > hi) return -lo - 1; const m = (lo + hi) >> 1; if (a[m] === x) return m; return a[m]! < x ? search(a, x, m + 1, hi) : search(a, x, lo, m - 1); }
console.log([1, 4, 9, 10, 40].map(x => search([1, 3, 4, 9, 12, 40], x, 0, 5)).join(" "));
function grid(y: number, x: number): number { if (y < 0 || x < 0 || y > 3 || x > 3) return 0; const k = y * 4 + x; if (list[k & 7] === 77) return 0; const held = list[k & 7]!; list[k & 7] = 77; const n = 1 + grid(y + 1, x) + grid(y - 1, x) + grid(y, x + 1) + grid(y, x - 1); list[k & 7] = held; return n; }
console.log(grid(0, 0), grid(3, 1), list.join(" "));
