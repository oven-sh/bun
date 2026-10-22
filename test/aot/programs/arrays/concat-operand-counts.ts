// a.concat(..) with 1 to 5 operands, arrays and primitives, against the same list built element by element: int32s, doubles, strings and mixed values, holes, operands whose storage differs, results around the length that is copied inline. What is returned is a copy.
class Rec { constructor(public id: number) {} }

function concatNumbers1(a: number[], b: number[]): number[] { return a.concat(b); }
function concatNumbers2(a: number[], b: number[], c: number[]): number[] { return a.concat(b, c); }
function concatNumbers3(a: number[], b: number[], c: number[], d: number[]): number[] { return a.concat(b, c, d); }
function concatNumbers4(a: number[], b: number[], c: number[], d: number[], e: number[]): number[] { return a.concat(b, c, d, e); }
function concatNumbers5(a: number[], b: number[], c: number[], d: number[], e: number[], f: number[]): number[] { return a.concat(b, c, d, e, f); }
function concatValues1(a: unknown[], b: unknown[]): unknown[] { return a.concat(b); }
function concatValues2(a: unknown[], b: unknown[], c: unknown[]): unknown[] { return a.concat(b, c); }
function concatValues3(a: unknown[], b: unknown[], c: unknown[], d: unknown[]): unknown[] { return a.concat(b, c, d); }
function concatValues4(a: unknown[], b: unknown[], c: unknown[], d: unknown[], e: unknown[]): unknown[] { return a.concat(b, c, d, e); }
function appendNumber1(a: number[], x: number): number[] { return a.concat(x); }
function appendNumber2(a: number[], x: number, y: number): number[] { return a.concat(x, y); }
function appendNumber3(a: number[], x: number, y: number, z: number): number[] { return a.concat(x, y, z); }
function appendNumber4(a: number[], x: number, y: number, z: number, w: number): number[] { return a.concat(x, y, z, w); }
function appendAround(a: number[], x: number, b: number[], y: number): number[] { return a.concat(x, b, y); }
function appendString(a: string[], x: string, b: string[]): string[] { return a.concat(x, b); }
function appendNullish(a: (Rec | null | undefined)[], b: (Rec | null | undefined)[]): (Rec | null | undefined)[] { return a.concat(null, b, undefined); }

function show(v: unknown): string { return v instanceof Rec ? "#" + v.id : v === undefined ? "undefined" : v === null ? "null" : typeof v === "string" ? "'" + v + "'" : Object.is(v, -0) ? "-0" : String(v); }
function list(a: readonly unknown[]): string { let t = a.length + "["; for (let k = 0; k < a.length; k++) t += (k in a ? show(a[k]) : "_") + ","; return t + "]"; }
function expected(operands: readonly unknown[]): string {
  let length = 0, t = "";
  for (const operand of operands) {
    if (!Array.isArray(operand)) { length++; t += show(operand) + ","; continue; }
    length += operand.length;
    for (let k = 0; k < operand.length; k++) t += (k in operand ? show(operand[k]) : "_") + ",";
  }
  return length + "[" + t + "]";
}
let checks = 0, bad = 0;
function check(name: string, got: readonly unknown[], operands: readonly unknown[]): void {
  const text = list(got), want = expected(operands);
  checks++;
  if (text !== want && bad++ < 12) console.log("DIFFERS: " + name + "\n  got  " + text + "\n  want " + want);
}
function build<T>(n: number, element: (k: number) => T, holes: number): T[] {
  const a: T[] = [];
  for (let k = 0; k < n; k++) a.push(element(k));
  if (holes) for (let k = 1; k < n; k += holes) delete a[k];
  return a;
}
const int32At = (k: number) => k * 3, doubleAt = (k: number) => k + 0.5, stringAt = (k: number) => "t" + k;
const mixedAt = (k: number): unknown => (k % 4 === 0 ? undefined : k % 4 === 1 ? null : k % 4 === 2 ? -0 : new Rec(k));

const lengths = [0, 1, 2, 3, 15, 16, 17, 21, 22, 31, 32, 33, 63, 64, 65];
for (const n of lengths) {
  for (const m of lengths) {
    const at = " " + n + " and " + m;
    for (const [kind, first, second] of [
      ["int32s", build(n, int32At, 0), build(m, int32At, 0)],
      ["doubles", build(n, doubleAt, 0), build(m, doubleAt, 0)],
      ["int32s and doubles", build(n, int32At, 0), build(m, doubleAt, 0)],
      ["doubles and int32s", build(n, doubleAt, 0), build(m, int32At, 0)],
      ["doubles with holes", build(n, doubleAt, 3), build(m, doubleAt, 2)],
      ["int32s with holes", build(n, int32At, 2), build(m, int32At, 3)],
    ] as [string, number[], number[]][]) {
      check(kind + at, concatNumbers1(first, second), [first, second]);
      check(kind + " twice" + at, concatNumbers2(first, second, first), [first, second, first]);
      check(kind + " three times" + at, concatNumbers3(first, second, second, first), [first, second, second, first]);
      check(kind + " four times" + at, concatNumbers4(first, second, first, second, first), [first, second, first, second, first]);
      check(kind + " five times" + at, concatNumbers5(first, second, first, second, first, second), [first, second, first, second, first, second]);
      check(kind + " to itself" + at, concatNumbers2(first, first, first), [first, first, first]);
      check(kind + " around" + at, appendAround(first, 7, second, 8), [first, 7, second, 8]);
      check(kind + " around fractions" + at, appendAround(first, 7.5, second, -0), [first, 7.5, second, -0]);
      check(kind + " around NaN" + at, appendAround(first, NaN, second, 8), [first, NaN, second, 8]);
    }
    for (const [kind, first, second] of [
      ["strings", build(n, stringAt, 0), build(m, stringAt, 0)],
      ["mixed values", build(n, mixedAt, 0), build(m, mixedAt, 0)],
      ["strings and int32s", build(n, stringAt, 0), build(m, int32At, 0)],
      ["doubles and mixed values", build(n, doubleAt, 0), build(m, mixedAt, 0)],
      ["strings with holes", build(n, stringAt, 2), build(m, stringAt, 3)],
    ] as [string, unknown[], unknown[]][]) {
      check(kind + at, concatValues1(first, second), [first, second]);
      check(kind + " twice" + at, concatValues2(first, second, first), [first, second, first]);
      check(kind + " three times" + at, concatValues3(first, second, second, first), [first, second, second, first]);
      check(kind + " four times" + at, concatValues4(first, second, first, second, first), [first, second, first, second, first]);
    }
    const strings = build(n, stringAt, 0), moreStrings = build(m, stringAt, 0);
    check("a string between" + at, appendString(strings, "x", moreStrings), [strings, "x", moreStrings]);
    const records = build<Rec | null | undefined>(n, k => new Rec(k), 0), moreRecords = build<Rec | null | undefined>(m, k => (k & 1 ? null : new Rec(k)), 0);
    check("null and undefined" + at, appendNullish(records, moreRecords), [records, null, moreRecords, undefined]);
  }
  for (const [kind, numbers] of [["int32s", build(n, int32At, 0)], ["doubles", build(n, doubleAt, 0)]] as [string, number[]][]) {
    check("one int32 after " + n + " " + kind, appendNumber1(numbers, 7), [numbers, 7]);
    check("two numbers after " + n + " " + kind, appendNumber2(numbers, 7, 8.5), [numbers, 7, 8.5]);
    check("three numbers after " + n + " " + kind, appendNumber3(numbers, -0, 8, NaN), [numbers, -0, 8, NaN]);
    check("four numbers after " + n + " " + kind, appendNumber4(numbers, 6, 7, 8, 9), [numbers, 6, 7, 8, 9]);
    const before = list(numbers), copy = concatNumbers1(numbers, numbers);
    copy.push(1.5); copy[0] = -1;
    check("the receiver after a store to the copy of " + n + " " + kind, numbers, [numbers]);
    if (list(numbers) !== before) { bad++; console.log("DIFFERS: a store to the copy reached the receiver: " + n + " " + kind); }
  }
}
console.log(checks + " checks, " + bad + " bad");

function report(name: string, run: () => string): void { let text: string; try { text = run(); } catch (error) { text = error instanceof TypeError ? "TypeError" : "threw " + String(error); } console.log(name + ": " + text); }
class Numbers extends Array<number> {}
report("constants", () => list(concatNumbers2([1, 2], [3, 4], [5])) + " " + list(concatNumbers1([1.5], [2.5, 3.5])));
report("frozen", () => list(concatNumbers2(Object.freeze([1, 2]) as number[], Object.freeze([3]) as number[], [4])));
report("sparse", () => { const a = [1, 2]; a[100000] = 3; const all = concatNumbers2([0], a, [4]); return all.length + " " + list(all.slice(0, 4)) + " " + list(all.slice(-3)); });
report("subclass receiver", () => { const a = new Numbers(); a.push(1, 2); const all = concatNumbers1(a, [3]); return (all instanceof Numbers) + " " + list(all); });
report("subclass operand", () => { const a = new Numbers(); a.push(1, 2); const all = concatNumbers2([0], a, [3]); return (all instanceof Numbers) + " " + list(all); });
report("inherited in a hole", () => { const a = [1, , 3] as number[]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: 77 }); return list(concatNumbers1([0], a)) + " " + list(concatNumbers1(a, [4])); });
report("not spreadable", () => { const a = [1, 2]; (a as any)[Symbol.isConcatSpreadable] = false; const all = concatValues2([0], a, [3]); return all.length + " " + Array.isArray(all[1]); });
console.log(bad ? "concat with every number of operands: FAILED" : "concat with every number of operands: PASS");
