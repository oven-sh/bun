// Loops that end where a counter is no longer true: while (k--), for (; k--;), while (k) k--, steps of two, counters that are changed, negative and fractional starts, stores, views, strings, nested loops.
const lists: any[][] = [[], [1], [1, 2, 3, 4, 5, 6, 7], [1.5, 2.5, -0], ["a", "b"], [null, undefined, 3], Array.from({ length: 40 }, (_, k) => k), [1, , 3, , 5]];
const bytes = Uint8Array.from({ length: 37 }, (_, k) => k * 7), doubles = Float64Array.from({ length: 21 }, (_, k) => k / 2), ints = Array.from({ length: 33 }, (_, k) => (k * 5) % 17);
function down(a: any[]): string { let k = a.length, out = ""; while (k--) out += a[k]; return out + k; }
function forDown(a: any[]): string { let out = ""; for (let k = a.length; k--;) out += a[k]; return out; }
function truth(a: any[]): string { let k = a.length, out = ""; while (k) { out += a[k - 1]; k--; } return out + k; }
function truthFor(a: any[]): string { let out = ""; for (let k = a.length; k; --k) out += a[a.length - k]; return out; }
function twos(a: any[]): string { let k = a.length & ~1, out = ""; while (k) { out += a[k - 1]; k -= 2; } return out + k; }
function changed(a: any[]): string { let k = a.length, out = ""; while (k--) { out += a[k]; if (k === 5) k = 3; if (k === 20) k -= 4; if (out.length > 300) break; } return out + k; }
function continued(a: any[]): string { let k = a.length, out = ""; while (k--) { if (k % 3 === 1) continue; if (k === 2 && a.length > 10) break; out += a[k]; } return out + k; }
function bounded(start: any): string { let k = start, out = "", t = 0; try { while (k--) { out += k + ";"; if (++t > 12) break; } } catch (e) { out += (e as Error).name; } return out + String(k) + typeof k; }
function boundedTruth(start: number): string { let k = start, out = "", t = 0; while (k) { out += k + ";"; if (++t > 12) break; k--; } return out + k; }
function sum(a: number[]): number { let k = a.length, r = 0; while (k--) r = (r * 3 + a[k]!) | 0; return r; }
function sumFraction(a: number[]): number { let k = a.length, r = 0; while (k--) r += a[k]! * 0.5; return r; }
function view(a: Uint8Array): number { let k = a.length, r = 0; while (k--) r = (r * 3 + a[k]!) | 0; return r; }
function viewDoubles(a: Float64Array): number { let k = a.length, r = 0; for (; k--;) r += a[k]!; return r; }
function storeView(a: Uint8Array): string { const b = a.slice(); let k = b.length; while (k--) b[k] = b[k]! + k; return b.join(); }
function store(a: number[]): string { const b = a.slice(); let k = b.length; while (k--) b[k] = b[k]! * 2 + (k & 1); return b.join(); }
function fill(n: number): string { const b: number[] = new Array(n); let k = n; while (k--) b[k] = k * k; return b.join(); }
function reverse(a: any[]): string { const out = []; let k = a.length; while (k--) out.push(a[k]); return out.join(); }
function text(s: string): number { let k = s.length, r = 0; while (k--) r = (r * 3 + s.charCodeAt(k)) | 0; return r; }
function nested(n: number): number { let i = n, r = 0; while (i--) { let j = i; while (j--) r += i * j; for (let k = 3; k--;) r ^= k; } return r; }
function last(a: number[], v: number): number { let k = a.length; while (k--) if (a[k] === v) return k; return -1; }
function pushes(a: number[]): string { const b = a.slice(); let k = b.length, t = 0; while (k--) if (k % 5 === 0 && t++ < 6) b.push(k); return b.join(); }
function shrinks(a: number[]): string { const b = a.slice(); let k = b.length, out = ""; while (k--) { out += b[k] + ","; if (k === 9) b.length = 4; } return out; }
function calls(n: number, f: (k: number) => void): number { let k = n; while (k--) f(k); return k; }
function power(b: number, n: number): number { let r = 1; while (n--) r = (r * b) % 1000003; return r; }
let counted = 0;
for (let turn = 0; turn < 40; turn++) {
  const line = lists.map(a => [down, forDown, truth, truthFor, twos, changed, continued, reverse].map(f => f(a)).join("|")).join("\n")
    + [0, 1, 5, -1, -3, 2.5, NaN, "3", "x", null, undefined, true, 4n, 2 ** 31, 2 ** 53].map(bounded).join() + [0, 1, 6, -2, 1.5, NaN, 2 ** 31 + 2].map(boundedTruth).join()
    + [sum(ints), sumFraction(ints), view(bytes), viewDoubles(doubles), storeView(bytes), store(ints), fill(0), fill(1), fill(23), text("abc déf 日本"), nested(9), last(ints, 3), last(ints, 99), pushes(ints), shrinks(ints), calls(11, k => { counted += k; }), power(7, 25), power(7, 0)].join(" ") + counted;
  if (turn === 0 || turn === 39) console.log(line);
}
