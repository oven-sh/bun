// reduceRight, findLast and findLastIndex with written callbacks in loops, over lists that the loop knows and that change their kind, their holes or their length.
const told = (v: unknown): string => (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? (Array.isArray(v) ? "[" + v.map(told).join() + "]" : "{}") : typeof v + " " + String(v));
const out: string[] = [];
const ints: number[] = [], doubles: number[] = [], words: string[] = [], mixed: unknown[] = [];
for (let i = 0; i < 9; i++) { ints.push(i * 3 - 4); doubles.push(i * 0.5 - 1); words.push("w" + i); mixed.push([i, "m" + i, null, undefined, i * 0.25, { i }, true, 10n, [i]][i]); }
const holes: (number | undefined)[] = [1, , 3, , 5], big: number[] = [2 ** 31, -(2 ** 31), 2 ** 53, -0, NaN, Infinity, 1];
const same = (f: (x: unknown, y: unknown) => unknown, x: unknown) => f(x, x);

function sums(n: number) { let s = 0; for (let i = 0; i < n; i++) s += ints.reduceRight((a, v) => a + v, 0) + ints.reduceRight((a, v, k) => a * 3 + v * k, i); return s; }
function sumsWithoutStart(n: number) { let s = 0; for (let i = 0; i < n; i++) s += ints.reduceRight((a, v) => a - v) + doubles.reduceRight((a, v) => a - v); return s; }
function sumsOfDoubles(n: number) { let s = 0; for (let i = 0; i < n; i++) { doubles[i % 9] = i % 4 === 3 ? i : i + 0.5; s += doubles.reduceRight((a, v) => a + v, 0); } return s; }
function joined(n: number) { let s = ""; for (let i = 0; i < n; i++) s = words.reduceRight((a, v) => a + v[1], s.length > 20 ? "" : s); return s; }
function ofHoles(n: number) { let s = 0, c = 0; for (let i = 0; i < n; i++) { s += holes.reduceRight((a: number, v) => { c++; return a + (v ?? 100); }, 0); const l = holes.findLast(v => v === undefined), k = holes.findLastIndex(v => v === undefined); s += l === undefined ? k : 1000; } return s + " " + c; }
function found(n: number) { let s = ""; for (let i = 0; i < n; i++) { s = told(ints.findLast(v => v < i % 7)) + ints.findLastIndex(v => v < i % 7) + told(doubles.findLast(v => v > 1e9)) + doubles.findLastIndex(v => v === -0.5) + told(words.findLast((v, k) => k === i % 11)) + words.findLastIndex(v => v === "w0") + told(mixed.findLast(v => typeof v === "bigint")) + mixed.findLastIndex(v => v === undefined) + told(big.findLast(v => v !== v)) + big.findLastIndex(v => v === 0) + told(big.findLast(v => Object.is(v, -0))); if (i % 5 === 0) out.push(s); } return s; }
function changing(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const l: unknown[] = i % 3 ? [1, 2, 3, 4, 5] : [0.5, 1.5, 2.5];
    const r = l.reduceRight((a: string, v, k) => { if (k === 2) { if (i % 5 === 0) l.length = 1; else if (i % 5 === 1) l[1] = "s"; else if (i % 5 === 2) l.push(9); else if (i % 5 === 3) delete l[1]; else l[0] = 0.25; } return a + told(v) + k; }, "");
    const f = l.findLast((v, k) => { if (k === 1 && i % 2) l[0] = i; return v === i; }), g = l.findLastIndex((v, k) => { if (k === 1) l.pop(); return v === 0.5; });
    if (i % 4 === 0) s += r + told(f) + g + ";";
  }
  return s;
}
function thrown(n: number) { let s = 0; for (let i = 0; i < n; i++) { try { ints.reduceRight((a, v, k) => { if (k === i % 12) throw k; return a + v; }, 0); s += 100; } catch (e) { s += e as number; } try { s += words.findLastIndex((v, k) => { if (k === i % 13) throw k; return false; }); } catch (e) { s += (e as number) * 7; } } return s; }
function frozen(n: number) { const l = Object.freeze([1, 2, 3]) as readonly number[], written = [4, 5, 6]; let s = 0; for (let i = 0; i < n; i++) s += l.reduceRight((a, v) => a * 2 + v, 0) + (l.findLast(v => v < 3) ?? 0) + written.findLastIndex(v => v === 4 + (i % 4)); return s; }
function nested(n: number) { const rows = [[1, 2], [0.5, 3], [4]]; let s = 0; for (let i = 0; i < n; i++) s += rows.reduceRight((a, row) => a + row.reduceRight((b, v) => b * 2 + v, i & 3), 0) + (rows.findLast(row => row.findLastIndex(v => v === 3) === 1)?.length ?? 100); return s; }
function ofUnknown(n: number) { const lists: any[] = [ints, doubles, words, mixed, holes, big, "text", new Int8Array([3, -1, 2]), { length: 2, 0: "a", 1: "b" }]; let s = ""; for (let i = 0; i < n; i++) { const l = lists[i % 9], f = Array.prototype; s = told(f.reduceRight.call(l, (a: any, v: any, k: number) => (typeof v === "number" ? a + v * k : a + 1), 0)) + told(f.findLast.call(l, (v: any) => typeof v === "number" || typeof v === "string")) + f.findLastIndex.call(l, (v: any) => v === undefined || v === -1 || v === "a"); if (i < 18) out.push(s); } return s; }
for (const f of [sums, sumsWithoutStart, sumsOfDoubles, joined, ofHoles, found, changing, thrown, frozen, nested, ofUnknown]) out.push(f.name + " " + f(60));
ints.push(0.5); doubles[2] = 7; words.length = 4; (holes as unknown[])[1] = "s"; (ints as unknown[]).push("t");
for (const f of [sums, sumsWithoutStart, sumsOfDoubles, joined, ofHoles, found, changing, frozen, nested, ofUnknown]) { let r: unknown; try { r = f(40); } catch (e) { r = (e as Error).constructor.name; } out.push(f.name + " again " + r); }
out.push(told(same((x, y) => [(x as number[]).reduceRight((a, v) => a + (y as number[]).findLastIndex(w => w === v), 0)], [3, 1, 3, 2])));
for (const line of out) console.log(line);
export {};
