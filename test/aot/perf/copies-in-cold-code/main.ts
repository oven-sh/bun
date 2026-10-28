// Copies of records by a spread, in a program that is built with all its code cold: each copy is one call of the run time.
interface Point { a: number; b: number; c: number; d: number; e: number; f: number }
const first: Point = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 };
const second: Point = { a: 7, b: 8, c: 9, d: 10, e: 11, f: 12 };
let kept: Point = first;
function copyTyped(point: Point): Point { return { ...point }; }
function copyUntyped(point: any): any { return { ...point }; }
function copyNothing(point: Point): Point { return point; }

// Records with optional members, copied into records of another type. Which members a record has, and in which order it got them, is its kind.
interface Options { m00?: number; m01?: string; m02?: number; m03?: string; m04?: number; m05?: string; m06?: number; m07?: string; m08?: number; m09?: string; m10?: number; m11?: string; m12?: number; m13?: string; m14?: number; m15?: string; m16?: number; m17?: string; m18?: number; m19?: string; m20?: number; m21?: string; m22?: number; m23?: string; }
interface Labeled extends Options { label: number }
function makeOptions(bits: number): Options {
  const made: Options = {};
  if (bits & 1) made.m00 = bits;
  if (bits & 2) made.m01 = "text";
  if (bits & 4) made.m02 = bits;
  if (bits & 8) made.m03 = "text";
  if (bits & 16) made.m04 = bits;
  if (bits & 32) made.m05 = "text";
  if (bits & 64) made.m06 = bits;
  if (bits & 128) made.m07 = "text";
  if (bits & 256) made.m08 = bits;
  if (bits & 512) made.m09 = "text";
  if (bits & 1024) made.m10 = bits;
  if (bits & 2048) made.m11 = "text";
  if (bits & 4096) made.m12 = bits;
  if (bits & 8192) made.m13 = "text";
  if (bits & 16384) made.m14 = bits;
  if (bits & 32768) made.m15 = "text";
  if (bits & 65536) made.m16 = bits;
  if (bits & 131072) made.m17 = "text";
  if (bits & 262144) made.m18 = bits;
  if (bits & 524288) made.m19 = "text";
  if (bits & 1048576) made.m20 = bits;
  if (bits & 2097152) made.m21 = "text";
  if (bits & 4194304) made.m22 = bits;
  if (bits & 8388608) made.m23 = "text";
  return made;
}
function copyIntoAnotherType(options: Options, label: number): Labeled { return { label, ...options }; }
function labelOnly(options: Options, label: number): Labeled { return { label }; }
const eightKinds: Options[] = [0x000111, 0x00f000, 0x123456, 0x800001, 0x0f0f00, 0x00003f, 0x555000, 0xa0a0a0].map(makeOptions);
let labeled: Labeled = { label: 0 };
// Each number has eight of its 24 bits set at the most, and no two numbers are the same.
function kindNumber(i: number): number { return ((i & 0xf) << 1) | ((i & 0xf0) << 5) | ((i & 0xff00) << 8); }

const loops: Record<string, (n: number) => number> = {
  "no copy into another type": n => { let sum = 0; for (let i = 0; i < n; i++) { labeled = labelOnly(eightKinds[i & 7], i); sum += labeled.label & 1; } return sum; },
  "a copy into another type": n => { let sum = 0; for (let i = 0; i < n; i++) { labeled = copyIntoAnotherType(eightKinds[i & 7], i); sum += labeled.label & 1; } return sum; },
  "no copy of a kind never met": n => { let sum = 0; for (let i = 0; i < n; i++) { labeled = labelOnly(makeOptions(kindNumber(i)), i); sum += labeled.label & 1; } return sum; },
  "a copy of a kind never met": n => { let sum = 0; for (let i = 0; i < n; i++) { labeled = copyIntoAnotherType(makeOptions(kindNumber(i)), i); sum += labeled.label & 1; } return sum; },
  "no copy": n => { let sum = 0; for (let i = 0; i < n; i++) { kept = copyNothing(i & 1 ? first : second); sum += kept.a; } return sum; },
  "a copy where the type is written": n => { let sum = 0; for (let i = 0; i < n; i++) { kept = copyTyped(i & 1 ? first : second); sum += kept.a; } return sum; },
  "a copy of anything": n => { let sum = 0; for (let i = 0; i < n; i++) { kept = copyUntyped(i & 1 ? first : second); sum += kept.a; } return sum; },
};
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");
if (which) console.log(which, loops[which](rounds), JSON.stringify(kept), kept === first || kept === second, JSON.stringify(labeled));
else for (const name in loops) console.log(name, loops[name](rounds), JSON.stringify(kept), kept === first || kept === second, JSON.stringify(labeled));
