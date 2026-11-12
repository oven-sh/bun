// A loop steps a value of unknown type, compares it with a number and adds it to a number. It starts at fractions, integers of any size, -0, NaN, strings, bigints and objects.
const parsed: any[] = JSON.parse('[0, -0, 0.5, -1.25, 1e300, 5e-324, 2147483640, 2147483647, -2147483648, 4294967295, 9007199254740984, 1.7976931348623157e308, "2", "x", "", null, true, false, [], [3], {}]');
const starts: any[] = [...parsed, NaN, Infinity, -Infinity, undefined, 7n, { valueOf: () => 0.75 }, { toString: () => "t" }, new Date(0), Symbol.iterator];
const limit = 12;

function below(x: any, n: number): any { let k = 0, turns = 0; while (x < n) { x++; k += x; if (++turns === limit) break; } return [x, k, turns]; }
function belowOrAt(x: any, n: number): any { let k = 0.5, turns = 0; for (; x <= n; x++) { k += x * 0.5; if (++turns === limit) break; } return [x, k, turns]; }
function above(x: any, n: number): any { let k = 0, turns = 0; while (x > n) { x--; k -= x; if (++turns === limit) break; } return [x, k, turns]; }
function mirrored(x: any, n: number): any { let k = 0, turns = 0; while (n > x) { k += x; x += 2; if (++turns === limit) break; } return [x, k, turns]; }
function twoBounds(x: any, n: number): any { let k = 0, turns = 0; while (x < n && x >= -n) { k += x / 3; x++; if (++turns === limit) break; } return [x, k, turns]; }
function inArm(x: any, n: number): any { let k = 0; for (let i = 0; i < limit; i++) { if (x > n) k += x; x++; } return [x, k]; }
function nested(x: any, n: number): any { let k = 0, turns = 0; for (let i = 0; i < 3; i++) { while (x < n + i) { k += x; x++; if (++turns === limit) return [x, k, turns]; } } return [x, k, turns]; }
function product(x: any, n: number): any { let k = 1, turns = 0; while (x < n) { k *= x; x++; if (++turns === limit) break; } return [x, k, turns]; }
function wholeNumbers(x: any, n: number): any { let k = 0, turns = 0; while (x < n) { k = (k + x) | 0; x++; if (++turns === limit) break; } return [x, k, turns]; }
function equal(x: any, n: number): any { let k = 0, turns = 0; while (x !== n) { k += x; x++; if (++turns === limit) break; } return [x, k, turns]; }
function index(x: any, n: number): any { const list = [1.5, 2.5, 3.5, 4.5]; let k = 0, turns = 0; while (x < n) { k += list[x] ?? 0.25; x++; if (++turns === limit) break; } return [x, k, turns]; }
function text(x: any, n: number): any { let out = "", k = 0, turns = 0; while (x < n) { out += x + ";"; k += x; x++; if (++turns === limit) break; } return [out, k, turns]; }
function kept(x: any, n: number): any { const made: any[] = []; let k = 0.5, turns = 0; while (x < n) { made.push(x); k += x; x++; if (++turns === limit) break; } return [made, k, turns]; }
function closed(x: any, n: number): any { const made: (() => any)[] = []; let k = 0.5; for (let i = x, turns = 0; i < n && turns < limit; i++, turns++) { made.push(() => i); k += i; } return [made.map(f => f()), k]; }
function leaves(x: any, n: number): any { let k = 0.5, turns = 0; try { while (x < n) { if (++turns === 4) throw x; k += x; x++; } } catch (e) { return ["thrown", e, k]; } return [x, k, turns]; }
function unknownBound(x: any, n: any): any { let k = 0, turns = 0; while (x < n) { x++; k += x; if (++turns === limit) break; } return [x, k, turns]; }
function addsItself(x: any, n: number): any { let k = 0, turns = 0; while (x < n) { k += x + x; x++; if (++turns === limit) break; } return [x, k, turns]; }
function negated(x: any, n: number): any { let k = 0, turns = 0; while (-x > -n) { k += -x; x++; if (++turns === limit) break; } return [x, Object.is(k, -0), k, turns]; }
function remainder(x: any, n: number): any { let k = 0, turns = 0; while (x < n) { k += x % 3; x++; if (++turns === limit) break; } return [x, k, turns]; }

const show = (value: any): string => typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + value.map(show).join(" ") + "]" : typeof value === "string" ? JSON.stringify(value.slice(0, 40)) : String(value).slice(0, 40);
for (const run of [below, belowOrAt, above, mirrored, twoBounds, inArm, nested, product, wholeNumbers, equal, index, text, kept, closed, leaves, unknownBound, addsItself, negated, remainder]) {
  const line: string[] = [];
  for (const start of starts) {
    for (const n of [-3, 0, 4, 2147483647, 9007199254740992]) {
      try { line.push(show(run(start, n))); } catch (e) { line.push((e as Error).name); }
    }
  }
  console.log(run.name, line.join(" "));
}
for (const n of ["9", "b", 9n, null, undefined, NaN, { valueOf: () => 6 }, [5]]) {
  const line: string[] = [];
  for (const start of starts) {
    try { line.push(show(unknownBound(start, n))); } catch (e) { line.push((e as Error).name); }
  }
  console.log("unknownBound", show(n), line.join(" "));
}
