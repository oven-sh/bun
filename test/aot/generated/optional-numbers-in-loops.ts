// Programs in which a variable holds a number or `undefined`, `null` or NaN and is carried around a loop, the way programs write it: the
// greatest so far, the place of the least, a sum that begins at nothing, the element before, a bound that may be missing.
//
// A program is one way for the variable to begin, with the array either written in each function, so that the compiler knows its
// elements, or handed in, so that one function serves every array. Each combination is a function of its own.
export const beginnings = ["let x;", "let x = undefined;", "let x = null;", "let x = NaN;", "let x = unknown(undefined);"];

const arrays: [string, string][] = [
  ["ints", "[3, 1, 4, 1, 5, 9, 2, 6]"],
  ["negative ints", "[-3, -1, -4, -1, -5]"],
  ["doubles", "[1.5, 0.25, 9.75, -2.5]"],
  ["mixed", "[1, 2.5, 3, -0.5]"],
  ["a NaN inside", "[1, NaN, 3]"],
  ["a NaN first", "[NaN, 1, 2]"],
  ["only NaN", "[NaN, NaN]"],
  ["zeros of both signs", "[-0, 0, -0]"],
  ["a negative zero", "[-0]"],
  ["empty", "[]"],
  ["beyond int32", "[2147483647, 2147483648, -2147483649]"],
  ["beyond 2 ** 53", "[9007199254740991, 9007199254740992, 1e300, -1e300]"],
  ["zeros", "[0, 0]"],
  ["one", "[7]"],
  ["infinities", "[Infinity, -Infinity, 0]"],
  ["an undefined inside", "[1, undefined, 3]"],
  ["a null inside", "[1, null, 3]"],
  ["a hole inside", "[1, , 3]"],
  ["a null first", "[null, -1, 1]"],
  ["an undefined first", "[undefined, -1, 1]"],
];
const tests = [
  "x === undefined",
  "x == null",
  "x === null",
  "!x",
  "typeof x === \"undefined\"",
  "x !== x",
  "Number.isNaN(x)",
  "x === void 0",
  "x == undefined",
  "typeof x !== \"number\"",
  "!(x >= 0 || x < 0)",
  "x === undefined || x === null",
  "isNaN(x)",
  "false",
];
const comparisons = [
  "v > x",
  "v < x",
  "v >= x",
  "v <= x",
  "x < v",
  "x > v",
  "!(v <= x)",
  "v - x > 0",
  "v > x + 0",
  "Math.max(v, x) === v",
];
const updates = [
  "x = (x ?? 0) + v",
  "x ??= v",
  "x ||= v",
  "x &&= v",
  "x = x + v",
  "x += v",
  "x -= v",
  "x *= v",
  "x = Math.max(x ?? -Infinity, v)",
  "x = Math.min(x ?? Infinity, v)",
  "x = Math.max(x, v)",
  "x = Math.min(x, v)",
  "x = Math.max(v, x)",
  "x = (x || 0) + v",
  "x = (x | 0) + v",
  "x = +x + v",
  "x = -x + v",
  "x = v - x",
  "x = x ** 1 + v",
  "x = v ** (x ?? 1)",
  "x = 2 ** x + v",
  "x = 10 ** x",
  "x = x === undefined ? v : Math.max(x, v)",
  "x = x == null ? v : x < v ? x : v",
  "x = x !== x ? v : x + v",
  "x = v === undefined ? x : v",
  "x = v ?? x",
  "x = x ?? v",
  "x = v || x",
  "x = v && x",
  "x = typeof x === \"number\" ? x + v : v",
  "x = [x, v][1]",
  "x = [v, x][1]",
  "x = { x, v }.x",
  "x = ((p, q) => p ?? q)(x, v)",
  "x = ((p = v) => p)(x)",
  "x = Number(x) + v",
  "x = Math.abs(x) + v",
  "x = Math.floor(x / 2) + v",
  "x = Math.round(x) + v",
  "x = Math.trunc(x) + v",
  "x = Math.sign(x) + v",
  "x = (x >>> 0) + v",
  "x = ~x + v",
  "x = x % 3 + v",
  "x = v % x",
  "x = x / v",
  "x = v / x",
  "x++",
  "x--",
  "++x",
  "x = x++ + v",
  "x = -(-x)",
  "x = +x",
  "x = x * 1",
  "x = x - 0",
];
const bounds = [
  "i < x",
  "i <= x",
  "x > i",
  "x >= i",
  "!(i >= x)",
  "i < (x ?? 2)",
  "i < x + 1",
  "i !== x && i < 5",
  "i != x && i < 5",
  "i < Math.min(x, 3)",
  "i < Math.max(x, 2)",
  "i < (x || 3)",
  "i * 2 < x",
  "i - x < 0",
];

const bodies: string[] = [];
for (const test of tests) {
  for (const comparison of comparisons) bodies.push(`INIT for (const v of a) if (${test} || ${comparison}) x = v; return x;`);
  bodies.push(
    `INIT for (let i = 0; i < a.length; i++) { const v = a[i]; if (${test} || v > x) x = v; } return x;`,
    `INIT for (let i = 0; i < a.length; i++) if (${test} || a[i] > a[x]) x = i; return x;`,
    `INIT for (let i = a.length - 1; i >= 0; i--) if (${test} || a[i] < a[x]) x = i; return [x, a[x]];`,
    `INIT let n = 0; for (const v of a) { if (${test}) n++; x = v; } return [n, x];`,
    `INIT let n = 0; for (const v of a) { if (!(${test}) && v < x) n++; x = v; } return [n, x];`,
    `INIT for (const v of a) x = ${test} ? v : x + v; return x;`,
    `INIT for (const v of a) { if (${test}) { x = v; continue; } x = x * 2 + v; } return x;`,
    `INIT for (const v of a) { x = v > 2 ? undefined : v; if (${test}) break; } return x;`,
    `INIT for (const v of a) { x = v > 2 ? null : v; if (${test}) break; } return x;`,
    `INIT let i = 0; while (i < a.length && (${test} || x < 4)) x = a[i++]; return [x, i];`,
    `INIT const seen = []; for (const v of a) { seen.push(${test}); x = v; } return seen;`,
  );
}
for (const update of updates) {
  bodies.push(
    `INIT for (const v of a) { ${update}; } return x;`,
    `INIT for (let i = 0; i < a.length; i++) { const v = a[i]; ${update}; } return [x, typeof x];`,
    `INIT const all = []; for (const v of a) { ${update}; all.push(x); } return all;`,
    `INIT const o = { x }; for (const v of a) { let x = o.x; ${update}; o.x = x; } return o;`,
  );
}
for (const bound of bounds) {
  bodies.push(`INIT let n = 0; for (let i = 0; ${bound}; i++) { n++; if (n > 9) break; } for (const v of a) { x = v; let m = 0; for (let i = 0; ${bound}; i++) { m++; if (m > 9) break; } n = n * 11 + m; } return n;`);
}

const helpers = `
const unknown = x => x;
const one = x => x === undefined ? "<undefined>" : x === null ? "<null>" : typeof x === "number" ? (x !== x ? "<NaN>" : Object.is(x, -0) ? "<-0>" : String(x)) : typeof x === "string" ? JSON.stringify(x) : typeof x === "boolean" ? String(x) : Array.isArray(x) ? "[" + Array.from(x, one).join(", ") + "]" : "{" + Object.keys(x).map(k => k + ": " + one(x[k])).join(", ") + "}";
const say = (label, f) => { let r; try { r = one(f()); } catch (e) { r = "throws " + e.constructor.name; } console.log(label + " ==> " + r); };
`;

export function program(beginning: string, isArrayWritten: boolean, isTypeScript: boolean): { file: string; text: string } {
  const lines = isTypeScript ? ["// @ts-nocheck", helpers] : [helpers];
  let n = 0;
  for (const body of bodies) {
    const text = body.replace("INIT", beginning);
    const label = body.replace("INIT ", "");
    if (isArrayWritten) {
      for (const [name, array] of arrays) {
        n++;
        lines.push(`function f${n}() { const a = ${array}; ${text} } say(${JSON.stringify(name + " | " + label)}, f${n});`);
      }
    } else {
      n++;
      lines.push(`function f${n}(a) { ${text} }`);
      for (const [name, array] of arrays) lines.push(`say(${JSON.stringify(name + " | " + label)}, () => f${n}(${array}));`);
    }
  }
  return { file: isTypeScript ? "main.ts" : "main.mjs", text: lines.join("\n") + "\n" };
}
