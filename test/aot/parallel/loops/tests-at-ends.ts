// do .. while by a counter: relations, equality and truth of the next counter or of this one, up and down, by one and by more, from starts that the test would refuse, with exits in the middle, over arrays, views, strings and objects.
const bytes = Uint8Array.from({ length: 37 }, (_, k) => k * 7), doubles = Float64Array.from({ length: 21 }, (_, k) => k / 2), ints = Array.from({ length: 33 }, (_, k) => (k * 5) % 17), holes: number[] = [1, , 3, 4.5, , 6, 7, 8, 9, 10, 11, , 13] as number[];
function up(a: number[], s: number, n: number): string { let r = 0, k = s; do { r = (r * 3 + (a[k]! | 0)) | 0; } while (++k < n); return r + " " + k; }
function upTo(a: number[], s: number, n: number): string { let r = 0, k = s; do { r += a[k] ?? 1; } while (++k <= n); return r + " " + k; }
function upBehind(a: number[], s: number, n: number): string { let r = 0, k = s; do { r += a[k] ?? 1; } while (k++ < n); return r + " " + k; }
function upBy(a: number[], s: number, n: number): string { let r = 0, k = s; do { r += a[k] ?? 1; k += 3; } while (k < n); return r + " " + k; }
function upFrom(a: number[], s: number, n: number): string { let r = 0, k = s; do { r += a[k] ?? 1; } while (n > ++k); return r + " " + k; }
function upUnequal(a: number[], s: number, n: number): string { let r = 0, t = 0, k = s; do { if (++t > 50) break; r += a[k] ?? 1; } while (++k !== n); return r + " " + k; }
function down(a: Uint8Array, s: number): string { let r = 0, t = 0, k = s; do { if (++t > 50) break; r = (r * 3 + (a[k]! | 0)) | 0; } while (--k >= 0); return r + " " + k; }
function downTo(a: Float64Array, s: number, n: number): string { let r = 0, t = 0, k = s; do { if (++t > 50) break; r = r * 0.5 + (a[k] ?? 3); } while (--k > n); return r + " " + k; }
function downTruth(a: Uint8Array, s: number): string { let r = 0, t = 0, k = s; do { if (++t > 50) break; r = (r * 3 + (a[k]! | 0)) | 0; } while (--k); return r + " " + k; }
function downUnequal(a: Uint8Array, s: number): string { let r = 0, t = 0, k = s; do { if (++t > 50) break; r = (r * 3 + (a[k]! | 0)) | 0; } while (--k !== 0); return r + " " + k; }
function downBehind(a: Uint8Array, s: number): string { let r = 0, t = 0, k = s; do { if (++t > 50) break; r = (r * 3 + (a[k]! | 0)) | 0; } while (k-- > 0); return r + " " + k; }
function text(s: string, from: number, to: number): string { let r = 0, k = from; do { r = (r * 3 + (s.charCodeAt(k) | 0)) | 0; } while (++k < to); return r + " " + k; }
function store(a: number[], s: number, n: number): string { const b = a.slice(); let k = s; do { b[k] = k & 7; } while (++k < n); return b.join() + b.length; }
function storeView(a: Uint8Array, s: number, n: number): string { const b = a.slice(); let k = s; do { b[k] = b[k]! + k; } while (++k < n); return b.join(); }
function fields(a: { v: number }[], n: number): string { let r = 0, k = 0; do { r += a[k]?.v ?? 2; a[k % a.length]!.v = r & 15; } while (++k < n); return r + " " + a.map(x => x.v).join(); }
function left(a: number[], v: number): string { let r = 0, k = 0; do { if (a[k] === v) { r += 1000; break; } if (k % 3 === 1) continue; r += a[k]!; } while (++k < a.length); return r + " " + k; }
function last(a: number[]): string { let k = 0, seen = -1; do { seen = a[k]! + k; } while (++k < a.length); return seen + " " + k; }
function nested(n: number, m: number): number { let r = 0, i = 0; do { let j = i; do { r = (r + i * j) | 0; } while (++j < m); let l = i; do { r ^= l; } while (--l > 0); } while (++i < n); return r; }
function changed(a: number[], n: number): string { let r = 0, k = 0, t = 0; do { r += a[k] ?? 5; if (++t === 9) n -= 4; } while (++k < n); return r + " " + k; }
const pairs: [any, any][] = [[0, 0], [0, 1], [0, 2], [0, 7], [0, 8], [0, 9], [0, 10], [0, 17], [0, 33], [0, 60], [3, 3], [5, 2], [40, 3], [-3, 4], [0, 2.5], [0.5, 8.5], [0, NaN], [0, "9"], ["2", 9], [0, undefined], [2147483640, 2147483646], [4294967290, 4294967296], [-0, 4]];
for (let turn = 0; turn < 40; turn++) {
  const objects = Array.from({ length: 11 }, (_, v) => ({ v }));
  const line = pairs.map(([s, n]) => [up, upTo, upBehind, upBy, upFrom, upUnequal].map(f => f(ints, s, n) + " " + f(holes, s, n)).join(" ") + downTo(doubles, n, s) + text("abc déf 日本 xyz", s, n) + (n >= 0 && n < 100 && s >= 0 ? store(ints, s, n) + storeView(bytes, s, n) : "")).join("\n")
    + [0, 1, 5, 8, 9, 20, 36, 60, -1, -4, 2.5, NaN, "3", null, undefined, 2 ** 31 + 2].map(s => [down, downTruth, downUnequal, downBehind].map(f => f(bytes, s as number)).join(" ")).join("\n")
    + [0, 1, 9, 11, 20].map(n => fields(objects, n)).join(" ") + [left(ints, 3), left(ints, 99), left([], 1), last(ints), last([]), nested(1, 1), nested(6, 4), nested(9, 12), changed(ints, 20), changed(ints, 33)].join(" ");
  if (turn === 0 || turn === 39) console.log(line);
}
