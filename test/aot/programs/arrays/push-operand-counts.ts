// a.push(..) with 1 to 9 operands, one more than is stored inline: int32s, doubles, NaN and mixed values pushed into empty, full, sparse and frozen arrays of every storage. The returned length and the elements.
function pushNumbers1(a: number[], x: number): number { return a.push(x); }
function pushNumbers2(a: number[], x: number): number { return a.push(x, x + 1); }
function pushNumbers3(a: number[], x: number): number { return a.push(x, x + 1, x + 2); }
function pushNumbers7(a: number[], x: number): number { return a.push(x, x + 1, x + 2, x + 3, x + 4, x + 5, x + 6); }
function pushNumbers8(a: number[], x: number): number { return a.push(x, x + 1, x + 2, x + 3, x + 4, x + 5, x + 6, x + 7); }
function pushNumbers9(a: number[], x: number): number { return a.push(x, x + 1, x + 2, x + 3, x + 4, x + 5, x + 6, x + 7, x + 8); }
function pushValues1(a: unknown[], x: unknown): number { return a.push(x); }
function pushValues2(a: unknown[], x: unknown, y: unknown): number { return a.push(x, y); }
function pushValues8(a: unknown[], x: unknown, y: unknown): number { return a.push(x, y, 1, x, 0.5, y, "s", x); }
function pushValues9(a: unknown[], x: unknown, y: unknown): number { return a.push(x, y, 1, x, 0.5, y, "s", x, null); }

function show(v: unknown): string { return v === undefined ? "undefined" : v === null ? "null" : typeof v === "string" ? "'" + v + "'" : typeof v === "object" ? "{}" : Object.is(v, -0) ? "-0" : String(v); }
function list(a: readonly unknown[]): string { let t = a.length + "["; for (let k = 0; k < a.length; k++) t += (k in a ? show(a[k]) : "_") + ","; return t + "]"; }
function attempt(name: string, a: unknown[], push: () => number): void {
  let returned: string;
  try { returned = String(push()); } catch (error) { returned = (error as Error).constructor.name; }
  console.log(name + ": " + returned + " " + list(a));
}

const numberArrays: [string, () => number[]][] = [
  ["empty", () => []],
  ["int32s", () => [1, 2, 3]],
  ["doubles", () => [0.5, 1.5]],
  ["holes", () => [1, , 3] as number[]],
  ["holes among doubles", () => [0.5, , 2.5] as number[]],
  ["with capacity", () => { const a: number[] = []; for (let k = 0; k < 20; k++) a.push(k); a.length = 2; return a; }],
  ["sparse", () => { const a: number[] = []; a[100000] = 1; a.length = 3; return a; }],
  ["frozen", () => { const a = [1, 2]; Object.freeze(a); return a; }],
  ["not extensible", () => { const a = [1, 2]; Object.preventExtensions(a); return a; }],
];
const pushNumbers: [string, (a: number[], x: number) => number][] = [["1", pushNumbers1], ["2", pushNumbers2], ["3", pushNumbers3], ["7", pushNumbers7], ["8", pushNumbers8], ["9", pushNumbers9]];
for (const [kind, make] of numberArrays) {
  for (const [count, push] of pushNumbers) {
    for (const x of [10, 0.25, -0, NaN, 2147483646]) {
      const a = make();
      attempt(kind + ", " + count + " from " + show(x), a, () => push(a, x));
    }
  }
}

const valueArrays: [string, () => unknown[]][] = [
  ["empty", () => []],
  ["int32s", () => [1, 2, 3]],
  ["doubles", () => [0.5, 1.5]],
  ["anything", () => ["a", {}, 3]],
  ["frozen", () => { const a: unknown[] = ["a"]; Object.freeze(a); return a; }],
];
const pushValues: [string, (a: unknown[], x: unknown, y: unknown) => number][] = [["1", pushValues1], ["2", pushValues2], ["8", pushValues8], ["9", pushValues9]];
for (const [kind, make] of valueArrays) {
  for (const [count, push] of pushValues) {
    for (const [x, y] of [[1, 2], [0.5, NaN], ["s", {}], [undefined, null]] as [unknown, unknown][]) {
      const a = make();
      attempt(kind + " of anything, " + count + " from " + show(x) + " and " + show(y), a, () => push(a, x, y));
    }
  }
}

{
  const a: number[] = [];
  let sum = 0;
  for (let k = 0; k < 2000; k++) sum += pushNumbers8(a, k) + pushNumbers9(a, k + 0.5);
  console.log("grown: " + sum + " " + a.length + " " + a[0] + " " + a[8] + " " + a[a.length - 1]);
}
