// Flags: --aot-validate --aot-disable=InlineCalls
// Math.min and Math.max of integers of 32 bits, at both ends of the range, of two to five operands, beside operands that are wider, fractions, -0 and NaN.
declare const process: { argv: string[] };
const shift: number = process.argv.length > 99 ? 1 : 0;
const out: string[] = [];
function show(name: string, value: number): void {
  out.push(name + " " + (Object.is(value, -0) ? "-0" : String(value)));
}
function smaller(a: number, b: number): number { return Math.min(a | 0, b | 0); }
function larger(a: number, b: number): number { return Math.max(a | 0, b | 0); }
function smallestOfThree(a: number, b: number, c: number): number { return Math.min(a | 0, b | 0, c | 0); }
function largestOfFive(a: number, b: number, c: number, d: number, e: number): number { return Math.max(a | 0, b | 0, c | 0, d | 0, e | 0); }
function clamp(x: number, low: number, high: number): number { return Math.min(Math.max(x | 0, low | 0), high | 0); }
function smallerUnsigned(a: number, b: number): number { return Math.min(a >>> 0, b >>> 0); }
function smallerMixed(a: number, b: number): number { return Math.min(a | 0, b >>> 0); }
function smallerOfLengths(a: string, b: number[]): number { return Math.min(a.length, b.length); }
function largerWithFraction(a: number, b: number): number { return Math.max(a | 0, b); }
function sumOfSmaller(list: Int32Array): number { let sum = 0; for (let i = 1; i < list.length; i++) sum += Math.min(list[i - 1]!, list[i]!); return sum; }

const values = [0, 1, -1, 2147483647, -2147483648, 2147483646, -2147483647, 65536, -65536, 4294967295, 2147483648, -2147483649, 0.5, -0.5, -0, NaN, Infinity, -Infinity];
for (let turn = 0; turn < 3; turn++) {
  for (const a of values) {
    for (const b of values) {
      const x = a + shift, y = b + shift;
      show("smaller", smaller(x, y));
      show("larger", larger(x, y));
      show("unsigned", smallerUnsigned(x, y));
      show("mixed", smallerMixed(x, y));
      show("fraction", largerWithFraction(x, y));
      show("three", smallestOfThree(x, y, turn - 1));
      show("five", largestOfFive(x, y, turn, -turn, y));
      show("clamp", clamp(x, -100, y));
    }
  }
  show("lengths", smallerOfLengths("abc".repeat(turn + 1), [1, 2, 3, 4, 5]));
  show("sum", sumOfSmaller(new Int32Array([2147483647, -2147483648, 5, turn, -7, 2147483647, 2147483646])));
}
console.log(out.length, out.filter((line, index) => index % 7 === 0).join("|"));
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (Math.imul(hash, 31) + line.charCodeAt(i)) | 0;
console.log(hash);
