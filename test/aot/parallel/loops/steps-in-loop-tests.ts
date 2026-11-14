// Loops whose test steps a counter: ++ and -- in front, &&, ||, comparisons on both sides, continue, break, labels, closures, values that are no numbers, try, generators.
const lists: any[][] = [[], [1], [1, 2, 3, 4, 5, 6, 7], [1.5, 2.5], ["a", "b"], [null, undefined, 3], Array.from({ length: 40 }, (_, k) => k)];
const bytes = Uint8Array.from([9, 8, 7, 6, 5]);
let log = "";
const note = (v: any): any => { log += v + ","; return v; };
function up(a: any[]): string { let i = -1, out = ""; const n = a.length; while (++i < n) out += a[i]; return out + i; }
function upLength(a: any[]): string { let i = -1, out = ""; while (++i < a.length) { if (i === 2) continue; if (i === 5) break; out += a[i]; } return out + i; }
function upTo(a: any[]): string { let i = 0, out = ""; while (++i <= a.length) out += a[i - 1]; return out + i; }
function down(a: any[]): string { let i = a.length, out = ""; while (--i >= 0) out += a[i]; return out + i; }
function downTo(a: any[]): string { let i = a.length, out = ""; while (--i > -1) out += a[i]; return out + i; }
function forUp(a: any[]): string { let out = ""; for (let i = -1; ++i < a.length;) { if (i & 1) continue; out += a[i]; } return out; }
function forBoth(a: any[]): string { let out = ""; for (let i = -1, j = 0; ++i < a.length; j += 2) { if (i === 3) continue; out += a[i] + "." + j; } return out; }
function forDown(a: any[]): string { let out = ""; for (let i = a.length; --i >= 0;) out += a[i]; return out; }
function and(a: any[]): string { let i = -1, out = ""; while (++i < a.length && a[i] !== 4) out += a[i]; return out + i; }
function andSecond(a: any[]): string { let i = -1, j = 9, out = ""; while (--j > 0 && ++i < a.length) out += a[i] + "" + j; return out + i + j; }
function or(a: any[]): string { let i = -1, out = ""; while (++i < a.length || i < 3) { out += a[i]; if (i > 50) break; } return out + i; }
function rightStores(a: any[]): string { let i = -1, out = ""; while (++i < (i > 3 ? (i = 99) : a.length)) { out += i + ";"; if (out.length > 200) break; } return out + i; }
function rightCalls(a: any[]): string { let i = -1; log = ""; while (++i < note(a.length)) note(a[i]); return log + i; }
function captured(a: any[]): string { let i = -1; const fs: (() => number)[] = []; while (++i < a.length) fs.push(() => i); return fs.map(f => f()).join() + i; }
function perIteration(a: any[]): string { const fs: (() => number)[] = []; for (let i = -1; ++i < a.length;) fs.push(() => i); return fs.map(f => f()).join(); }
function changed(a: any[]): string { let i = -1, out = ""; while (++i < a.length) { out += a[i]; if (i === 1) i++; if (i === 6) i = 20; } return out + i; }
function labeled(a: any[]): string { let i = -1, out = ""; outer: while (++i < a.length) { let j = -1; while (++j < a.length) { if (j === 2) continue outer; if (i === 4) break outer; out += i + "" + j + " "; } } return out + i; }
function tried(a: any[]): string { let i = -1, out = ""; while (++i < a.length) { try { if (i % 3 === 1) throw i; if (i % 3 === 2) continue; out += a[i]; } catch (e) { out += "!" + e; } finally { out += "f"; } } return out + i; }
function* yielded(a: any[]): Generator<any> { let i = -1; while (++i < a.length) yield a[i]; return i; }
async function awaited(a: any[]): Promise<string> { let i = -1, out = ""; while (++i < a.length) out += await a[i]; return out + i; }
function numbers(v: any): string { let i = v, out = "", t = 0; try { while (++i < 3 && t++ < 9) out += typeof i + i + ";"; } catch (e) { return out + (e as Error).name; } return out + String(i); }
function module1(): string { let out = ""; top = -1; while (++top < 4) out += top; return out + top; }
let top = 0;
class Cursor { at = -1; constructor(readonly list: any[]) {} all(): string { let out = ""; while (++this.at < this.list.length) out += this.list[this.at]; return out + this.at; } }
function typed(b: Uint8Array): number { let i = b.length, r = 0; while (--i >= 0) r = (r * 3 + b[i]!) | 0; return r * 100 + i; }
function text(s: string): number { let i = -1, r = 0; const n = s.length; while (++i < n) r = (r * 3 + s.charCodeAt(i)) | 0; return r + i; }
function parameter(a: any[], i: number): string { let out = ""; while (++i < a.length) out += a[i]; return out + i; }
function nested(a: any[]): number { let i = -1, r = 0; while (++i < a.length) { let j = a.length; while (--j > i) r += i * j; for (let k = -1; ++k < 3;) r ^= k; } return r; }
function never(): string { let i = 5, out = ""; while (++i < 3) out += i; for (let k = 0; --k >= 0;) out += k; return out + i; }
function ended(a: any[]): number { let i = -1; while (++i < a.length) if (a[i] === 3) return i; return -i; }
function sorted(): string { const a = [5, 2, 9, 1, 7, 3]; let i = 0; while (++i < a.length) { const v = a[i]!; let j = i; while (--j >= 0 && a[j]! > v) a[j + 1] = a[j]!; a[j + 1] = v; } return a.join(); }
for (let turn = 0; turn < 40; turn++) {
  const line = lists.map(a => [up, upLength, upTo, down, downTo, forUp, forBoth, forDown, and, andSecond, or, rightStores, rightCalls, captured, perIteration, changed, labeled, tried, nested, ended].map(f => (f as any)(a)).join("|") + "|" + [...yielded(a)].join() + "|" + new Cursor(a).all() + parameter(a, -1) + parameter(a, 2)).join("\n")
    + [0, -2, "0", "x", null, undefined, true, 1n, 2.5, {}, [], Symbol.iterator, { valueOf: () => 1 }].map(numbers).join() + module1() + typed(bytes) + text("abc déf") + never() + sorted();
  if (turn === 0 || turn === 39) console.log(line);
}
Promise.all(lists.map(awaited)).then(r => console.log(r.join(" ")));
