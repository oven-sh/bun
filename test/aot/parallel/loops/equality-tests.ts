// Loops that end where a counter equals a bound: k !== n, k != n, n !== k, k, k !== 0, up and down, by one and by more, from starts before, at and behind the bound, bounds that change, fractions, NaN, strings.
const lists: any[][] = [[], [1], [1, 2, 3, 4, 5, 6, 7], [1.5, 2.5, -0], ["a", "b"], [null, undefined, 3], Array.from({ length: 40 }, (_, k) => k), [1, , 3, , 5]];
const bytes = Uint8Array.from({ length: 37 }, (_, k) => k * 7), doubles = Float64Array.from({ length: 21 }, (_, k) => k / 2), ints = Array.from({ length: 33 }, (_, k) => (k * 5) % 17);
function all(a: any[]): string { let out = ""; for (let k = 0, l = a.length; k !== l; k++) out += a[k]; return out; }
function own(a: any[]): string { let out = ""; for (let k = 0; k !== a.length; ++k) out += a[k]; return out; }
function loose(a: any[]): string { let out = "", k = 0; while (a.length != k) { out += a[k]; k++; } return out + k; }
function sum(a: number[], s: number, n: number): number { let r = 0, t = 0; for (let k = s; k !== n; k++) { if (++t > 50) break; r = (r * 3 + (a[k]! | 0)) | 0; } return r; }
function sumBy(a: number[], s: number, n: number): string { let r = 0, t = 0, k = s; for (; k !== n; k += 2) { if (++t > 50) break; r += a[k] ?? 1; } return r + " " + k; }
function down(a: number[], s: number, n: number): string { let r = 0, t = 0, k = s; for (; k !== n; k--) { if (++t > 50) break; r = (r * 3 + (a[k]! | 0)) | 0; } return r + " " + k; }
function truth(a: Uint8Array, s: number): string { let r = 0, t = 0, k = s; for (; k; k--) { if (++t > 50) break; r = (r * 3 + (a[k]! | 0)) | 0; } return r + " " + k; }
function zero(a: Float64Array, s: number): string { let r = 0, t = 0, k = s; while (k !== 0) { k--; if (++t > 50) break; r = r * 0.5 + (a[k] ?? 3); } return r + " " + k; }
function text(s: string, from: number, to: number): string { let r = 0, t = 0, k = from; for (; k !== to; k++) { if (++t > 50) break; r = (r * 3 + (s.charCodeAt(k) | 0)) | 0; } return r + " " + k; }
function store(a: number[], s: number, n: number): string { const b = a.slice(); let t = 0; for (let k = s; k !== n; k++) { if (++t > 50) break; b[k] = k & 7; } return b.join(); }
function changed(a: number[], n: number): string { let r = 0, t = 0, k = 0; for (; k !== n; k++) { r += a[k] ?? 5; if (++t === 9) n -= 4; if (t > 60) break; } return r + " " + k; }
function nested(n: number, m: number): number { let r = 0; for (let i = 0; i !== n; i++) { for (let j = i; j !== m; j++) { if (j > m + 3) break; r = (r + i * j) | 0; } for (let j = i; j; j--) r ^= j; } return r; }
function found(a: number[], v: number): number { for (let k = 0, l = a.length; k !== l; k++) if (a[k] === v) return k; return -1; }
function continued(a: number[]): number { let r = 0; for (let k = 0, l = a.length; k !== l; k++) { if (k % 3 === 1) continue; if (a[k] === 99) break; r += a[k]!; } return r; }
const pairs: [any, any][] = [[0, 0], [0, 1], [0, 7], [0, 8], [0, 9], [0, 33], [3, 3], [5, 2], [40, 3], [-3, 4], [0, 2.5], [0.5, 8.5], [0, NaN], [0, "9"], ["2", 9], [0, undefined], [2147483640, 2147483646], [4294967290, 4294967296], [-0, 4], [9007199254740985, 9007199254740992]];
for (let turn = 0; turn < 40; turn++) {
  const line = lists.map(a => [all, own, loose].map(f => f(a)).join("|")).join("\n")
    + pairs.map(([s, n]) => [sum(ints, s, n), sumBy(ints, s, n), down(ints, n, s), down(ints, s, n), text("abc déf 日本 xyz", s, n), n < 100 && n >= 0 && s >= 0 ? store(ints, s, n) : ""].join(" ")).join("\n")
    + [0, 1, 5, 20, 36, -1, -4, 2.5, NaN, "3", null, undefined, 2 ** 31 + 2].map(s => truth(bytes, s as number) + " " + zero(doubles, s as number)).join("\n")
    + [9, 20, 33, 40].map(n => changed(ints, n)).join() + [nested(0, 4), nested(5, 5), nested(9, 4), found(ints, 3), found(ints, 99), continued(ints)].join(" ");
  if (turn === 0 || turn === 39) console.log(line);
}
