// The least programs that capture a variable behind a test of it: where the variable comes from, times the numbers, times the test, times what it is tested against, times what captures it, times where, times how often the function is called.
//
//   bun write-narrowed-capture-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<from>--<numbers>--<test>--<against>--<captured>--<where>--<calls>.mjs, .cjs or .ts
//   bun write-narrowed-capture-sweep.ts count
//
// What a test says of a variable is true behind the test. What holds the variable for a closure may be filled in front of it.
import { mkdirSync, writeFileSync } from "node:fs";

// G is what is handed over, made of the number Y; X is the variable's value.
const froms: [name: string, given: string, value: string][] = [
  ["int8", "new Int8Array([7, Y])", "given[1]"],
  ["uint8", "new Uint8Array([7, Y])", "given[1]"],
  ["int16", "new Int16Array([7, Y])", "given[1]"],
  ["int32", "new Int32Array([7, Y])", "given[1]"],
  ["uint32", "new Uint32Array([7, Y])", "given[1]"],
  ["doubles", "new Float64Array([7, Y])", "given[1]"],
  ["floats", "new Float32Array([7, Y])", "given[1]"],
  ["list", "[7, Y]", "given[1]"],
  ["parsed", "JSON.parse(JSON.stringify([7, Y]))", "given[1]"],
  ["field", "{ v: Y }", "given.v"],
  ["itself", "Y", "given"],
  ["truncated", "Y", "given | 0"],
  ["unsigned", "Y", "given >>> 0"],
  ["number-of-text", "String(Y)", "Number(given)"],
  ["cut", "Y", "Math.trunc(given)"],
  ["sum", "Y", "given + 1"],
  ["product", "Y", "given * 2"],
  ["masked", "Y", "given & 255"],
  ["length", "[1, 2, 3]", "given.length"],
  ["character", "'abc'", "given.charCodeAt(1)"],
  ["choice", "Y", "given > 3 ? given : -given"],
  ["instance", "new Holder(Y)", "given.v"],
];
const numbers: [name: string, text: string][] = [
  ["wrapped-byte", "200"],
  ["minus-one", "-1"],
  ["negative", "-56"],
  ["zero", "0"],
  ["negative-zero", "-0"],
  ["five", "5"],
  ["past-byte", "300"],
  ["least-word", "-2147483648"],
  ["greatest-word", "2147483647"],
  ["past-word", "2147483648"],
  ["past-unsigned", "4294967295"],
  ["two-words", "4294967296"],
  ["fraction", "0.5"],
  ["negative-fraction", "-1.5"],
  ["not-a-number", "NaN"],
  ["infinite", "-Infinity"],
  ["text", "'7'"],
  ["null", "null"],
  ["undefined", "undefined"],
  ["truth", "true"],
];
// K and L are what is tested against.
const tests: [name: string, text: string][] = [
  ["at-least", "x >= K"],
  ["above", "x > K"],
  ["below", "x < K"],
  ["at-most", "x <= K"],
  ["same", "x === K"],
  ["not-same", "x !== K"],
  ["equal", "x == K"],
  ["not-equal", "x != K"],
  ["between", "x >= K && x <= K"],
  ["range", "x >= 0 && x < K"],
  ["outside", "x < 0 || x > K"],
  ["not-below", "!(x < K)"],
  ["turned", "K <= x"],
  ["kind", "typeof x === 'number'"],
  ["truth", "x"],
  ["not", "!x"],
  ["integer", "Number.isInteger(x)"],
  ["word", "(x | 0) === x"],
  ["unsigned", "x >>> 0 === x"],
  ["something", "x != null"],
  ["nothing", "x == null"],
  ["not-a-number", "x !== x"],
  ["kind-and-above", "typeof x === 'number' && x > K"],
];
const againsts: string[] = ["0", "1", "5", "-1", "200", "256", "2147483647", "2147483648", "4294967295", "0.5", "-2147483648", "n"]; // prettier-ignore
// C makes what reads `x`; R reads it.
const captured: [name: string, text: string][] = [
  ["arrow-in-map", "[1, 2].map(() => x).join()"],
  ["arrow-called", "(() => x)()"],
  ["arrow-kept", "keep(() => x)"],
  ["function", "[1].map(function () {\n  return x;\n}).join()"],
  ["method", "new (class {\n  m() {\n    return x;\n  }\n})().m()"],
  ["object-method", "({\n  m() {\n    return x;\n  },\n}).m()"],
  ["getter", "({\n  get v() {\n    return x;\n  },\n}).v"],
  ["static-field", "class {\n  static v = x;\n}.v"],
  ["generator", "[...(function* () {\n  yield x;\n})()].join()"],
  ["async-arrow", "later(async () => x)"],
  ["nested", "(() => () => x)()()"],
  ["filter", "[1, 2, 3].filter(k => k > x).length"],
  ["sum", "[1, 2].reduce((s, k) => s + x * k, 0)"],
  ["compared", "[1, 2].some(k => x === k)"],
  ["index", "[0].map(k => [9, 8, 7][x]).join()"],
  ["text", "[1].map(() => `${x}`).join()"],
  ["default", "((y = x) => y)()"],
];
const wheres: [name: string, text: string][] = [
  ["then", "if (TEST) return say(READ);\nreturn 'not taken';"],
  ["else", "if (TEST) return 'taken';\nreturn say(READ);"],
  ["both", "if (TEST) return say(READ);\nreturn [1].map(() => x).join() + '!';"],
  [
    "loop-within",
    "let answer = '';\nif (TEST) {\n  for (let k = 0; k < n; k++) answer += say(READ);\n}\nreturn answer;",
  ],
  [
    "loop-around",
    "let answer = '';\nfor (let k = 0; k < n; k++) {\n  if (TEST) answer += say(READ);\n}\nreturn answer;",
  ],
  ["loop-until", "let answer = '';\nwhile (TEST) {\n  answer += say(READ);\n  break;\n}\nreturn answer;"],
  ["choice", "return TEST ? say(READ) : 'not taken';"],
  ["and", "return String((TEST) && READ);"],
  ["try", "try {\n  if (TEST) return say(READ);\n} finally {\n  turns++;\n}\nreturn 'not taken';"],
  ["thrown", "if (!(TEST)) throw new RangeError('not taken');\nreturn say(READ);"],
];
// How the variable is declared: S is what stands behind it.
const declared: [name: string, text: string][] = [
  ["const", "const x = X;"],
  ["let", "let x = X;"],
  ["var", "var x = X;"],
  ["assigned", "let x = 0;\nx = X;"],
  ["assigned-behind", "let x = X;\nif (n > 9) x = 'late';"],
];
const calls: [name: string, text: string][] = [
  ["once", "said.push(go(G, 3));"],
  ["twice", "said.push(go(G, 3));\nsaid.push(go(H, 3));"],
  ["loop", "for (let k = 0; k < 4; k++) said.push(go(G, 3));"],
];
const total =
  froms.length *
  numbers.length *
  tests.length *
  againsts.length *
  captured.length *
  wheres.length *
  declared.length *
  calls.length;
// Neighbors differ in everything, so that any part of the numbers has all of it.
const leap = 20_000_003;

function write(cell: number): { name: string; text: string } {
  let rest = (cell * leap) % total;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const from = pick(froms);
  const test = pick(tests);
  const number = pick(numbers);
  const capture = pick(captured);
  const where = pick(wheres);
  const against = pick(againsts);
  const call = pick(calls);
  const declare = pick(declared);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const tested = test[1].replaceAll(/\bK\b/g, against);
  const fill = (text: string) =>
    text
      .split("\n")
      .map(line => {
        const by = line.match(/^ */)?.[0] ?? "";
        return line.replaceAll("TEST", () => tested).replaceAll("READ", () => capture[1].split("\n").join("\n" + by));
      })
      .join("\n");
  const body = [declare[1].replaceAll(/\bX\b/g, from[2]), fill(where[1])].join("\n");
  const given = (y: string) => from[1].replaceAll(/\bY\b/g, y);
  const run = call[1].replaceAll(/\bG\b/g, () => given(number[1])).replaceAll(/\bH\b/g, () => given("5"));
  const has = (word: RegExp) => word.test(body + run);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    "const said = [];",
    "const say = v => String(v) + ';';",
    ...(has(/\bkeep\(/) ? ["let kept;", "const keep = f => {\n  kept = f;\n  return f();\n};"] : []),
    ...(has(/\blater\(/) ? ["const later = f => {\n  f().then(v => console.log('later', v));\n  return 'l';\n};"] : []),
    ...(has(/\bturns\b/) ? ["let turns = 0;"] : []),
    ...(has(/\bHolder\b/) ? ["class Holder {\n  constructor(v) {\n    this.v = v;\n  }\n}"] : []),
    `function go(given, n) {\n${indent(body, "  ")}\n}`,
    "try {",
    indent(run, "  "),
    "} catch (error) {",
    "  said.push(error.name);",
    "}",
    ...(has(/\bkept\b|keep\(/) ? ["said.push(String(kept?.()));"] : []),
    'console.log(said.join(" ").slice(0, 900));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${from[0]}--${number[0]}--${test[0]}--${against}--${capture[0]}--${where[0]}--${declare[0]}--${call[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(8, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
