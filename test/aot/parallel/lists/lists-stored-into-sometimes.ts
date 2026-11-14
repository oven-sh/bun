// Loops over number[] that step elements, store sums, store into a list in some turns alone, and sum in loops inside, handed lists of every kind.
// STATISTIC: ArraysConvertedToDoubleStorage >= 20
function stepsAll(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) c[i]++;
  return s;
}
function stepsDown(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) c[i]--;
  return s;
}
function stepsBefore(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) s += ++c[i];
  return s;
}
function takesOld(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) s = c[i]++ * 2;
  return s;
}
function takesOldText(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < c.length; i++) s = c[i]++;
  return s;
}
function counts(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) c[(a[i] | 0) & 7]++;
  return s;
}
function countsByIndex(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) c[i & 3]++;
  return s;
}
function stores(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]; c[i] = s; }
  return s;
}
function storesBefore(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { c[i] = s; s += a[i]; }
  return s;
}
function storesShifted(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 2; i < a.length; i++) { s += a[i]; c[i - 2] = s; }
  return s;
}
function storesDifference(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { s = a[i] - s; c[i] = s; }
  return s;
}
function storesProduct(a: number[], c: number[]): number {
  let s = 0;
  let p = 1; for (let i = 0; i < a.length; i++) { p = p * a[i]; c[i] = p; } s = p;
  return s;
}
function storesIntoSame(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 1; i < a.length; i++) { s += a[i - 1]; a[i] = s; }
  return s;
}
function storesTextToo(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]; c[i] = s; if (i === n + 2) s += "!" as any; }
  return s;
}
function sums(a: number[], c: number[]): number {
  let s = 0;
  let t = 0.5; for (let i = 0; i < a.length; i++) { s += a[i]; t += s; c[i] = t; } s += t;
  return s;
}
function twice(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { c[i]++; s += c[i]; a[i] = s; }
  return s;
}
function storesSometimes(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > 2) c[i] = a[i];
  return s;
}
function storesSometimesMore(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > 2) c[i] = a[i] * 2; else if (i === n) s += c[i];
  return s;
}
function compacts(a: number[], c: number[]): number {
  let s = 0;
  let k = 0; for (let i = 0; i < a.length; i++) if (a[i] > 2) c[k++] = a[i]; s = k;
  return s;
}
function storesGreatest(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] > s) s = a[i]; c[i] = s; }
  return s;
}
function innerSums(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 1; i < a.length - 1; i++) { let t = 0; for (let d = -1; d <= 1; d++) t += a[i + d]; c[i] = t; }
  return s;
}
function innerSumsOfAll(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < 4; i++) { let t = 0; for (let j = 0; j < a.length; j++) t += a[j]; c[i] = t; s += t; }
  return s;
}
function innerTexts(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 1; i < a.length - 1; i++) { let t = 0; for (let d = -1; d <= 1; d++) { t += a[i + d]; if (d === n - 3) t += "" as any; } c[i] = t; }
  return s;
}
function storesCounts(a: number[], c: number[]): number {
  let s = 0;
  let k = 0; for (let i = 0; i < a.length; i++) { if (a[i] > 2) k++; c[i] = k; } s = k;
  return s;
}
function storesUnderTest(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) if (c && i & 1) c[i] = a[i] * 2;
  return s;
}
function neverStores(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { s += a[i] * 1; if (i > 100) c[i] = s; }
  return s;
}
function calls(a: number[], c: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]; change(c, i); c[i] = s; c[i]++; }
  return s;
}
let seen = 0, changes = 0;
class Own extends Array {}
const n = JSON.parse("3"), log: string[] = [];
function change(list: any, i: any): any {
  changes++;
  if (changes % 11 === 0) list.length = 2;
  if (changes % 7 === 0) list[i] = "t";
}
function show(list: any): string {
  if (list === null || typeof list !== "object") return String(list);
  const all: any[] = [];
  for (let i = 0; i < Math.min(list.length >>> 0, 14); i++) all.push(i in list ? (Object.is(list[i], -0) ? "-0" : typeof list[i] === "object" ? "{}" : typeof list[i] === "bigint" ? list[i] + "n" : typeof list[i] === "string" ? "'" + list[i] : String(list[i])) : "hole");
  return list.length + ":" + all.join();
}
const kinds: Record<string, () => any> = {
  "doubles": () => [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5],
  "ints": () => [1, 2, 3, 4, 5, 6, 7, 8],
  "made doubles": () => Array.from({ length: 8 }, (_, i) => i / 4 + n),
  "made ints": () => Array.from({ length: 8 }, (_, i) => i + n),
  "greatest": () => [2147483647, 2147483646, -2147483648, 4294967295, 9007199254740991, 1, 2, 3],
  "not a number": () => [NaN, -0, Infinity, -Infinity, 0, 1, 2, 3],
  "holes": () => [0.5, , 2.5, , 4.5, 5.5, , 7.5],
  "holes of ints": () => [1, , 3, 4, , 6, 7, 8],
  "room": () => new Array(8),
  "filled": () => new Array(8).fill(0),
  "texts": () => ["1", "2", "x", "", "5", "6", "7", "8"],
  "late text": () => [1, 2, 3, 4, 5, "6", 7, 8],
  "late text of doubles": () => [1.5, 2, 3, 4, 5, "6", 7, 8],
  "bigints": () => [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n],
  "late bigint": () => [1, 2, 3, 4, 5n, 6, 7, 8],
  "objects": () => [1, { valueOf() { seen++; return 2; } }, 3, 4, 5, 6, 7, 8],
  "throws": () => [1, 2, 3, { valueOf() { throw new RangeError("no"); } }, 5, 6, 7, 8],
  "symbols": () => [1, 2, Symbol.iterator, 4, 5, 6, 7, 8],
  "nothing": () => [1, null, undefined, true, false, 6, 7, 8],
  "short": () => [1, 2.5, 3],
  "none": () => [],
  "far": () => (() => { const list = [1.5, 2.5]; list[n + 90] = 3; return list; })(),
  "frozen": () => Object.freeze([1.5, 2, 3, 4, 5, 6, 7, 8]),
  "sealed": () => Object.seal([1.5, 2, 3, 4, 5, 6, 7, 8]),
  "accessor": () => (() => { const list = [1.5, 2, 3, 4, 5, 6, 7, 8]; Object.defineProperty(list, 5, { get() { seen++; return 0.25; }, set(value) { seen += 10; }, configurable: true }); return list; })(),
  "own prototype": () => (() => { const list = [1.5, , 3.5, 4]; Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: 9.5, writable: true }, 6: { get() { seen++; return 7; }, set(value) { seen += 100; } } })); return list; })(),
  "heir": () => Own.from([1.5, 2.5, 3.5, 4.5]),
  "view": () => new Float64Array([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]),
  "bytes": () => new Uint8Array([255, 2, 3, 4, 5, 6, 7, 254]),
  "whole views": () => new Int32Array([2147483647, 2, 3, 4, 5, 6, 7, 8]),
  "bigint view": () => new BigInt64Array([1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n]),
  "text": () => "01234567",
  "like": () => ({ length: 8, 0: 1.5, 1: 2, 3: 4 }),
  "undefined": () => undefined,
  "null": () => null,
  "proxy": () => new Proxy([1.5, 2, 3, 4, 5, 6, 7, 8], { get(target, key, receiver) { seen++; return Reflect.get(target, key, receiver); } }),
};
const functions: Record<string, any> = { stepsAll, stepsDown, stepsBefore, takesOld, takesOldText, counts, countsByIndex, stores, storesBefore, storesShifted, storesDifference, storesProduct, storesIntoSame, storesTextToo, sums, twice, storesSometimes, storesSometimesMore, compacts, storesGreatest, innerSums, innerSumsOfAll, innerTexts, storesCounts, storesUnderTest, neverStores, calls };
let numberOfCase = 0;
for (let times = 0; times < 2; times++) {
  for (const kindOfA of Object.keys(kinds)) {
    for (const kindOfC of Object.keys(kinds).concat("same")) {
      for (const name of Object.keys(functions)) {
        if (numberOfCase++ % 17) continue;
        const a = kinds[kindOfA](), c = kindOfC === "same" ? a : kinds[kindOfC]();
        seen = changes = 0;
        let answer: any;
        try {
          const made = functions[name](a, c);
          answer = typeof made + " " + (Object.is(made, -0) ? "-0" : String(made));
        } catch (error: any) {
          answer = error.name;
        }
        log.push(name + " " + kindOfA + " " + kindOfC + ": " + answer + " " + show(a) + " " + show(c) + " " + seen);
      }
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
