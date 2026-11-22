// Counters that a loop lowers, as keys of lists and views: starts inside, at and above the length, the list shortened, grown and exchanged on the way, holes, accessors.
let digest = 0;
const add = (v: unknown) => { const t = typeof v === "symbol" ? "symbol" : String(v) + (Object.is(v, -0) ? "!" : ""); for (let i = 0; i < t.length; i++) digest = (Math.imul(digest, 31) + t.charCodeAt(i)) | 0; };
type Numbers = number[] | Uint8Array | Int32Array | Float64Array;

function sum(a: number[]): number { let r = 0; for (let k = a.length - 1; k >= 0; k--) r = (r * 3 + a[k]!) & 0xfffff; return r; }
function sumOfBytes(a: Uint8Array): number { let r = 0; for (let k = a.length - 1; k >= 0; k--) r = (r * 3 + a[k]!) & 0xfffff; return r; }
function sumOfDoubles(a: Float64Array): number { let r = 0; for (let k = a.length - 1; k >= 0; --k) r += a[k]!; return r; }
function from(a: number[], n: number): number { let r = 0; for (let k = n; k >= 0; k--) r = (r * 3 + (a[k] ?? 7)) | 0; return r; }
function bytesFrom(a: Uint8Array, n: number): number { let r = 0; for (let k = n; k >= 0; k--) r = (r * 3 + a[k]!) | 0; return r; }
function bytesFromAsWritten(a: Uint8Array, n: number): string { let out = ""; for (let k = n; k >= 0; k--) out += a[k] + ","; return out; }
function atLength(a: number[]): number { let r = 0; for (let k = a.length; k >= 0; k--) { const v = a[k]; r = v === undefined ? r + 100 : (r * 3 + v) | 0; } return r; }
function pairs(a: number[]): number { let r = 0; for (let k = a.length - 1; k > 0; k -= 2) r = (r * 5 + a[k]! * 2 + a[k - 1]!) | 0; return r; }
function above(a: number[]): number { let r = 0; for (let k = a.length - 1; k >= 0; k--) { const v = a[k + 1]; r = v === undefined ? r + 9 : (r + v) | 0; } return r; }
function shifted(a: number[]): string { const b = a.slice(); for (let k = b.length - 1; k > 0; k--) b[k] = b[k - 1]!; return b.join(); }
function shiftedBytes(a: Uint8Array): string { const b = a.slice(); for (let k = b.length - 1; k > 0; k--) b[k] = b[k - 1]!; return b.join(); }
function sorted(a: number[]): string { const b = a.slice(); for (let i = 1; i < b.length; i++) { const v = b[i]!; let j = i - 1; while (j >= 0 && b[j]! > v) { b[j + 1] = b[j]!; j--; } b[j + 1] = v; } return b.join(); }
function sortedInts(a: Int32Array): string { const b = a.slice(); for (let i = 1; i < b.length; i++) { const v = b[i]!; let j = i - 1; while (j >= 0 && b[j]! > v) { b[j + 1] = b[j]!; j--; } b[j + 1] = v; } return b.join(); }
function shrinks(a: number[]): string { const b = a.slice(); let out = ""; for (let k = b.length - 1; k >= 0; k--) { out += b[k] + ","; if (k === 3) b.length = 2; if (k === 2) b.pop(); } return out; }
function grows(a: number[]): number { const b = a.slice(); let r = 0; for (let k = b.length - 1; k >= 0; k--) { r = (r * 3 + b[k]!) | 0; if (k & 1) b.push(k); } return r + b.length; }
function exchanged(a: number[], c: number[]): string { let out = "", b = a; for (let k = b.length - 1; k >= 0; k--) { out += b[k] + ","; if (k === 4) b = c; } return out; }
function raised(a: number[]): number { let r = 0, n = 0; for (let k = a.length - 1; k >= 0; k--) { const v = a[k]; r = v === undefined ? r + 50 : (r * 3 + v) | 0; if (n++ < 3 && k === 1) k += 3; } return r; }
function raisedAbove(a: Uint8Array): number { let r = 0, n = 0; for (let k = a.length - 1; k >= 0; k--) { r = (r * 3 + a[k]!) | 0; if (n++ === 2) k = a.length + 1; } return r; }
function down(a: number[]): number { let k = a.length, r = 0; while (k--) r = (r * 3 + a[k]!) | 0; return r; }
function downBytes(a: Uint8Array): number { let k = a.length, r = 0; while (k > 0) r = (r * 3 + a[--k]!) | 0; return r; }
function ends(a: number[]): number { let i = 0, j = a.length - 1, r = 0; while (i < j) { r = (r * 3 + a[i]! * a[j]!) | 0; if (r & 1) i++; else j--; } return r; }
function reversed(a: number[]): string { const b = a.slice(); for (let i = 0, j = b.length - 1; i < j; i++, j--) { const t = b[i]!; b[i] = b[j]!; b[j] = t; } return b.join(); }
function reversedBytes(a: Uint8Array): string { const b = a.slice(); for (let i = 0, j = b.length - 1; i < j; i++, j--) { const t = b[i]!; b[i] = b[j]!; b[j] = t; } return b.join(); }
function joined(a: number[]): number { let r = 0; for (let k = a.length - 1; k >= 0; k--) { if (a[k]! & 1) continue; if (a[k]! > 100) { k -= 1; continue; } r = (r * 3 + a[k]!) | 0; } return r; }
function twoEnds(a: number[], n: number): number { let r = 0, i = a.length; while (i-- > 0 && r < n) r += a[i]!; return r * 100 + i; }
function nested(rows: number[][]): number { let r = 0; for (let i = rows.length - 1; i >= 0; i--) { const row = rows[i]!; for (let j = row.length - 1; j >= 0; j--) r = (r * 3 + row[j]!) | 0; } return r; }
function halves(a: number[], by: number): number { let r = 0; for (let k = a.length - 1; k >= 0; k -= by) { const v = a[k]; r = v === undefined ? r + 11 : (r * 3 + v) | 0; } return r; }
function called(a: number[], f: (k: number) => void): string { let out = ""; for (let k = a.length - 1; k >= 0; k--) { out += a[k] + ";"; f(k); } return out; }
function tried(a: number[]): number { let r = 0, k = a.length - 1; while (k >= 0) { try { if (k === 2) throw k; r = (r * 3 + a[k]!) | 0; k--; } catch { k -= 2; r++; } } return r; }
function* steps(a: number[]): Generator<number> { for (let k = a.length - 1; k >= 0; k--) yield a[k]!; }
function any(a: Numbers): number { let r = 0; for (let k = a.length - 1; k >= 0; k--) r = (r * 3 + a[k]!) & 0xfffff; return r; }
function below(a: Int32Array, n: number): number { let r = 0; for (let k = n - 1; k >= 0; k--) { r = (r * 3 + a[k]!) | 0; a[k] = r; } return r; }
function fill(a: number[], n: number): string { for (let k = n; k >= 0; k--) a[k] = k * 2; return a.length + ":" + a.join(); }
function detached(a: Uint8Array): string { let out = ""; for (let k = a.length - 1; k >= 0; k--) { out += a[k] + ","; if (k === 2) structuredClone(a.buffer, { transfer: [a.buffer] }); } return out; }
class Stack { items: number[] = []; total = 0; walk(): void { for (let k = this.items.length - 1; k >= 0; k--) this.total = (this.total * 3 + this.items[k]!) % 1000003; } }

const lists: number[][] = [[], [5], [3, 1, 2], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0], [1.5, -0, NaN, 2], Array.from({ length: 40 }, (_, k) => (k * 37) % 101), [2 ** 31, -1, 2 ** 40, 7]];
const holes: any[] = [[1, , 3, , 5], Object.assign([1, 2, 3], { length: 6 }), new Array(5), Object.defineProperty([1, 2, 3, 4], 2, { get() { return 77; } }), ["a", "b", "c", "d", "e", "f"], [1, "x", null, undefined, {}]];
const stack = new Stack();
for (let turn = 0; turn < 50; turn++) {
  for (const a of lists) {
    const bytes = Uint8Array.from(a), ints = Int32Array.from(a), doubles = Float64Array.from(a);
    add(sum(a)); add(sumOfBytes(bytes)); add(sumOfDoubles(doubles)); add(atLength(a)); add(pairs(a)); add(above(a)); add(shifted(a)); add(shiftedBytes(bytes)); add(sorted(a)); add(sortedInts(ints));
    for (const n of [-1, 0, a.length - 2, a.length - 1, a.length, a.length + 3]) { add(from(a, n)); add(bytesFrom(bytes, n)); add(bytesFromAsWritten(bytes, n)); add(below(ints.slice(), n)); add(fill(a.slice(), n)); }
    add(shrinks(a)); add(grows(a)); add(exchanged(a, lists[turn % lists.length]!)); add(raised(a)); add(raisedAbove(bytes)); add(down(a)); add(downBytes(bytes)); add(ends(a)); add(reversed(a)); add(reversedBytes(bytes));
    add(joined(a)); add(twoEnds(a, 20)); add(halves(a, 1 + (turn % 3))); add(halves(a, 0.5)); add(tried(a)); add([...steps(a)].join()); add(any(a)); add(any(bytes)); add(any(doubles));
    const copy = a.slice(); add(called(copy, k => { if (k === 2) copy.length = 1; if (k === 1) copy.push(4); })); add(called(a, () => {}));
    stack.items = a; stack.walk(); add(detached(bytes.slice()));
  }
  add(nested(lists));
  for (const h of holes) { add(sum(h)); add(from(h, h.length)); add(atLength(h)); add(pairs(h)); add(exchanged(h, [1, 2])); add(called(h, () => {})); add(reversed(h)); add(down(h)); }
}
add(stack.total);
console.log(digest, stack.total, sum([1, 2, 3]), raised([1, 2, 3, 4]), shrinks([1, 2, 3, 4, 5]), twoEnds([1, 2, 3], 4), detached(new Uint8Array([1, 2, 3, 4, 5])));
