// A loop steps a value of unknown type by whole numbers and computes with it. It starts at fractions, integers of any size, -0, NaN, strings, bigints and objects.
const parsed: any[] = JSON.parse('[0, -0, 0.5, -1.25, 1e300, 5e-324, 2147483646, 2147483647, -2147483648, 4294967295, 9007199254740991, 9007199254740993, 1.7976931348623157e308, "2", "x", "", null, true, false, [], [3], {}]');
const starts: any[] = [...parsed, NaN, Infinity, -Infinity, undefined, 7n, { valueOf: () => 0.75 }, { toString: () => "t" }, new Date(0), Symbol.iterator];

function up(x: any, n: number): any { for (let i = 0; i < n; i++) x = x + 1; return x; }
function upByTwo(x: any, n: number): any { for (let i = 0; i < n; i++) x += 2; return x; }
function increment(x: any, n: number): any { for (let i = 0; i < n; i++) x++; return x; }
function decrement(x: any, n: number): any { for (let i = 0; i < n; i++) --x; return x; }
function down(x: any, n: number): any { for (let i = 0; i < n; i++) x = x - 3; return x; }
function nested(x: any, n: number): any { for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) x = x + 1; return x; }
function onOneArm(x: any, n: number): any { for (let i = 0; i < n; i++) if (i & 1) x++; return x; }
function multiplied(x: any, n: number): any { let sum = 0; for (let i = 0; i < n; i++) { sum += x * 2; x++; } return [x, sum]; }
function divided(x: any, n: number): any { let sum = 0; for (let i = 0; i < n; i++) { sum += 1 / x; x--; } return [x, sum]; }
function added(x: any, n: number): any { let sum = 0; for (let i = 0; i < n; i++) { const next = x + i; if (typeof next === "number") sum += next; x++; } return [x, sum]; }
function negated(x: any, n: number): any { let last: any = 0; for (let i = 0; i < n; i++) { last = -x; x++; } return [x, Object.is(last, -0), last]; }
function text(x: any, n: number): any { let out = ""; for (let i = 0; i < n; i++) { out += `${x},`; x++; } return out; }
function compared(x: any, n: number): any { let k = 0; for (let i = 0; i < n; i++) { if (x === 2) k++; x++; } return [x, k]; }
function key(x: any, n: number): any { const list = [10, 20, 30]; let sum = 0; for (let i = 0; i < n; i++) { sum += list[x] ?? 1; x++; } return [x, sum]; }
function remainder(x: any, n: number): any { let sum = 0; for (let i = 0; i < n; i++) { sum += x % 3; x++; } return [x, sum]; }
function chosen(x: any, n: number): any { let k = 0; for (let i = 0; i < n; i++) { switch (x) { case 1: k += 1; break; case 2: k += 10; break; default: k += 100; } x++; } return [x, k]; }
function leaves(x: any, n: number): any { try { for (let i = 0; i < n; i++) { if (i === 5) throw x; x = x + 1; } } catch (e) { return ["thrown", e]; } return x; }
function kept(x: any, n: number): any { const made: any[] = []; for (let i = 0; i < n; i++) { made.push(x); x = x + 1; } return made; }

const show = (value: any): string => typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : Object.is(value, -0) ? "-0" : Array.isArray(value) ? "[" + value.map(show).join(" ") + "]" : typeof value === "string" ? JSON.stringify(value.slice(0, 40)) : String(value).slice(0, 40);
for (const run of [up, upByTwo, increment, decrement, down, nested, onOneArm, multiplied, divided, added, negated, text, compared, key, remainder, chosen, leaves, kept]) {
  const line: string[] = [];
  for (const start of starts) {
    for (const n of [0, 1, 9]) {
      try { line.push(show(run(start, n))); } catch (e) { line.push((e as Error).name); }
    }
  }
  console.log(run.name, line.join(" "));
}
