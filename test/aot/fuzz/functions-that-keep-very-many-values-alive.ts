// One function keeps very many values alive at once, more than there are registers by far, so each gets a place in the frame that must stay its
// own for as long as it lives: through a loop, into a catch block, over calls that collect. A program draws what the values are and how their lives
// lie to one another, and prints a sum that every value goes into.
import type { Random } from "./random";

const kinds = {
  "integers": (i: number) => `f(${i})`,
  "doubles": (i: number) => `d(${i})`,
  "objects": (i: number) => `o(${i})`,
  "texts": (i: number) => `t(${i})`,
  "mixed": (i: number) => [`f(${i})`, `d(${i})`, `o(${i})`, `t(${i})`, `b(${i})`][i % 5],
};
type Make = (i: number) => string;

const head = `function f(i) { let x = i | 0; for (let k = 0; k < (i & 3); k++) x = (x * 31 + k) | 0; return x; }
function d(i) { return f(i) * 0.5 + 0.25; }
function o(i) { return { v: f(i) }; }
function t(i) { return "n" + f(i); }
function b(i) { return (i & 1) === 0; }
let churned = 0;
function churn() { let kept = []; for (let i = 0; i < 50; i++) kept = [kept.length, { i }]; churned += kept.length; }
function mix(s, v) { const n = typeof v === "number" ? v : typeof v === "string" ? v.length + v.charCodeAt(v.length - 1) : typeof v === "boolean" ? (v ? 3 : 5) : v.v; return (s * 33 + Math.floor(n * 4)) % 1000000007; }`;

const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);
const define = (make: Make, from: number, to: number, prefix = "v") =>
  range(from, to)
    .map(i => `const ${prefix}${i} = ${make(i)};\n`)
    .join("");
const useUp = (from: number, to: number, prefix = "v") =>
  range(from, to)
    .map(i => `s = mix(s, ${prefix}${i});\n`)
    .join("");
const useDown = (from: number, to: number, prefix = "v") =>
  range(from, to)
    .reverse()
    .map(i => `s = mix(s, ${prefix}${i});\n`)
    .join("");

const shapes = {
  "used-in-reverse": (make: Make, n: number) => define(make, 0, n) + "churn();\n" + useDown(0, n),
  "used-in-order": (make: Make, n: number) => define(make, 0, n) + "churn();\n" + useUp(0, n),
  "used-in-a-loop": (make: Make, n: number) =>
    define(make, 0, n) + "for (let round = 0; round < 3; round++) {\n" + useUp(0, n) + "churn();\n}\n",
  "used-in-a-loop-beside-short-lived-ones": (make: Make, n: number) =>
    define(make, 0, n) +
    "for (let round = 0; round < 3; round++) {\n" +
    range(0, n)
      .map(
        i =>
          `s = mix(s, v${i});` + (i % 8 === 0 ? ` { const w${i} = ${make(i + 7)}; churn(); s = mix(s, w${i}); }` : ""),
      )
      .join("\n") +
    "\n}\n",
  "used-in-a-catch": (make: Make, n: number) =>
    define(make, 0, n) +
    "try {\n" +
    define(make, 0, n >> 5, "w") +
    'if (rare) throw new Error("rare");\n' +
    useUp(0, n >> 5, "w") +
    "} catch (e) {\n" +
    useDown(0, n) +
    "}\n" +
    useUp(0, Math.min(n, 50)),
  "in-two-arms": (make: Make, n: number) =>
    "if (rare) {\n" +
    define(make, 0, n) +
    useDown(0, n) +
    "} else {\n" +
    define(make, 0, n, "w") +
    useUp(0, n, "w") +
    "}\n",
  "in-two-blocks-one-behind-the-other": (make: Make, n: number) =>
    "{\n" +
    define(make, 0, n) +
    useDown(0, n) +
    "}\n{\n" +
    define(make, 3, n + 3, "w") +
    useDown(3, n + 3, "w") +
    "}\n",
  "long-lived-around-short-lived": (make: Make, n: number) =>
    define(make, 0, n >> 1) +
    range(0, n)
      .map(i => `{ const w${i} = ${make(i)}, x${i} = ${make(i + 1)}; s = mix(mix(s, x${i}), w${i}); }`)
      .join("\n") +
    "\n" +
    define(make, n >> 1, n) +
    useDown(0, n),
};

export const namesOfShapes = Object.keys(shapes) as (keyof typeof shapes)[];
export const namesOfKinds = Object.keys(kinds) as (keyof typeof kinds)[];

export const write = (shape: keyof typeof shapes, kind: keyof typeof kinds, count: number) => `${head}
function big(rare) {
let s = 1;
${shapes[shape](kinds[kind], count)}return s;
}
console.log(big(false), big(true), churned);
`;

export const generate = (random: Random) =>
  write(random.pick(namesOfShapes), random.pick(namesOfKinds), random.pick([40, 300, 1200, 5000]));
