// Reads, stores and `in` at positions that are numbers by their type and no indexes by their value: fractions, negative numbers, -0, NaN, the infinities, numbers from 2 ** 31 on, whole numbers that a division has made.
// Each function has run often with small indexes first, so that its code expects those.
const parsed: any = JSON.parse('{"list":[0,1,2,3,4,5,6,7]}');
const half: number = parsed.list[1] / 2;
const odd: number[] = [1.5, -1, -0, NaN, Infinity, -Infinity, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296, 9007199254740991, half * 6, half + half, 7 - half * 14, 1e-7];

function read(a: string[], i: number): string | undefined { return a[i]; }
function readLoose(a: string[], i: any): string | undefined { return a[i]; }
function within(a: string[], i: number): string | undefined { return i < a.length ? a[i] : "outside"; }
function store(a: unknown[], i: number, v: unknown): void { a[i] = v; }
function has(a: string[], i: number): boolean { return i in a; }
function readView(a: Float64Array, i: number): number | undefined { return a[i]; }
function storeView(a: Int16Array, i: number, v: number): void { a[i] = v; }
function walk(a: number[], from: number, to: number): number { let s = 0; for (let i = from; i < to; i++) { const v = a[i]; s += v === undefined ? 1000 : v; } return s; }

const texts: string[] = ["a", "b", "c", "d", "e", "f", "g", "h"];
const numbers: number[] = [1, 2, 3, 4, 5, 6, 7, 8];
const floats = new Float64Array([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]);
const shorts = new Int16Array(8);
const bag: unknown[] = [0, 1, 2, 3, 4, 5, 6, 7];

let seen = 0;
for (let turn = 0; turn < 20000; ++turn) {
  const i: number = parsed.list[turn & 7];
  seen += read(texts, i)!.length + readLoose(texts, i)!.length + within(texts, i)!.length + (has(texts, i) ? 1 : 0) + readView(floats, i)!;
  store(bag, i, turn);
  storeView(shorts, i, turn);
  seen += walk(numbers, i, 8);
}
console.log(seen, bag.join(), shorts.join());

(texts as any)["1.5"] = "at 1.5";
(texts as any)["-1"] = "at -1";
(texts as any)["4294967295"] = "at 4294967295";
for (const i of odd) {
  console.log(Object.is(i, -0) ? "-0" : String(i), read(texts, i), readLoose(texts, i), within(texts, i), has(texts, i), readView(floats, i), Math.abs(i) < 1e10 ? walk(numbers, i, i + 3) : "not walked");
  if (!(i >= 100)) store(bag, i, "stored at " + i);
  storeView(shorts, i, 7);
}
console.log(bag.length, Object.keys(bag).join(), shorts.join());
console.log(readLoose(texts, "2"), readLoose(texts, "1.5"), readLoose(texts, null), readLoose(texts, { toString() { return "3"; } }), readLoose(texts, 2n), readLoose(texts, true));
