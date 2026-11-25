// What a guess costs where it fails: what is guessed, times what comes instead, times the work that a loop does, times where that loop stands.
//
//   bun write-price-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<guess>--given-<what>--<work>--<place>.ts
//   bun write-price-sweep.ts count
//   bun write-price-sweep.ts named <pattern> <folder> [most]
//
// These programs are judged by the clock as well as by their answers. The first thing that each guess is given is what was guessed, so each program has a twin that differs in that alone. A function that read one
// name of one class nine times, and was handed parsed data, ran a loop of whole numbers that never touched the data thirteen times slower than `bun <file>` did; with eight reads, or handed an instance, it did not.
import { mkdirSync, writeFileSync } from "node:fs";

type Guess = { head: string; parameter: string; use: string; given: [name: string, made: string][] };

const ledger =
  "class Ledger { tint: number; twine: number; constructor(n: number) { this.tint = 0; this.twine = n; } tell() { return this.twine + this.tint; } }";
const instead: [name: string, made: string][] = [
  ["its-instance", "new Ledger(3)"],
  ["parsed-data", `JSON.parse('{"twine":3}')`],
  ["parsed-data-of-the-same-names", `JSON.parse('{"tint":0,"twine":3}')`],
  ["its-instance-with-a-name-more", `unseen("o", "o.late = 1; return o")(new Ledger(3))`],
  ["an-heir-nobody-has-seen", `unseen("C", "return new (class extends C {})(3)")(Ledger)`],
];
const guesses: [name: string, guess: Guess][] = [
  [
    "a-class-by-nine-reads-of-a-name",
    { head: ledger, parameter: "bag: any", use: Array(9).fill("bag.twine").join(" + "), given: instead },
  ],
  [
    "a-class-by-its-written-type",
    { head: ledger, parameter: "bag: Ledger", use: "bag.twine + bag.tint", given: instead },
  ],
  [
    "the-receiver-of-a-method",
    { head: ledger, parameter: "bag: any", use: "Ledger.prototype.tell.call(bag)", given: instead.slice(0, 2) },
  ],
  [
    "a-whole-number",
    {
      head: "",
      parameter: "bag: number",
      use: "(bag + 1) * 2",
      given: [
        ["a-whole-number", `Number("3")`],
        ["a-fraction", `Number("3.5")`],
        ["a-number-past-32-bits", `Number("4294967299")`],
        ["not-a-number", `Number("x")`],
      ],
    },
  ],
  [
    "a-list-of-whole-numbers",
    {
      head: "",
      parameter: "bag: number[]",
      use: "bag[0] + bag[1] + bag.length",
      given: [
        ["whole-numbers", `JSON.parse("[1,2,3]")`],
        ["fractions", `JSON.parse("[1.5,2,3]")`],
        ["texts", `JSON.parse('["1",2,3]')`],
        ["a-hole", `unseen("return [1, , 3]")()`],
        ["bytes", `unseen("return new Uint8Array([1, 2, 3])")()`],
      ],
    },
  ],
  [
    "a-record-in-a-field",
    {
      head: `const key: string = JSON.parse('"inner"');
class Box { inner: { rows: number[]; kind: string }; constructor() { this.inner = { rows: [1, 2, 3], kind: "a" }; } }
function boxOf(inner: any) { const box: any = new Box(); if (inner) box[key] = inner; return box; }`,
      parameter: "bag: Box",
      use: "bag.inner.rows[0] + bag.inner.rows[1]",
      given: [
        ["the-record-seen", "boxOf(null)"],
        ["a-record-of-the-same-names", `boxOf({ rows: [1, 2, 3], kind: "b" })`],
        ["a-record-of-other-names", "boxOf({ rows: [1, 2, 3], other: 1 })"],
        ["parsed-data", `boxOf(JSON.parse('{"rows":[1,2,3],"kind":"c"}'))`],
      ],
    },
  ],
  [
    "a-function-handed-in",
    {
      head: "function twice(x: number) { return x * 2; }",
      parameter: "bag: (x: number) => number",
      use: "bag(1) + bag(2)",
      given: [
        ["the-function-seen", "twice"],
        ["a-function-out-of-a-text", `unseen("x", "return x * 2")`],
        ["a-bound-function", `unseen("f", "return f.bind(null)")(twice)`],
      ],
    },
  ],
  [
    "a-text",
    {
      head: "",
      parameter: "bag: string",
      use: "bag.length + bag.length",
      given: [
        ["a-text", `JSON.parse('"abc"')`],
        ["a-text-put-together", `JSON.parse('"ab"') + JSON.parse('"c"')`],
        ["a-list", `JSON.parse("[1,2,3]")`],
      ],
    },
  ],
  [
    "a-map",
    {
      head: "",
      parameter: "bag: Map<string, number>",
      use: `bag.get("a")! + bag.size`,
      given: [
        ["a-map", `new Map([["a", 1]])`],
        ["an-heir-nobody-has-seen", `unseen("return new (class extends Map {})([['a', 1]])")()`],
      ],
    },
  ],
  [
    "a-variable-of-the-module",
    {
      head: "let level = 1;\nfunction setLevel(value: number) { level = value; return 0; }",
      parameter: "bag: number",
      use: "level + bag",
      given: [
        ["left-as-it-was", "0"],
        ["a-fraction-stored-out-of-sight", `unseen("set", "return set(1.5)")(setLevel)`],
        ["a-text-stored-out-of-sight", `unseen("set", "return set('1')")(setLevel)`],
      ],
    },
  ],
];
const cases = guesses.flatMap(([name, guess]) => guess.given.map((_, which) => [name, guess, which] as const));

const works: [name: string, laid: string, turn: string][] = [
  ["whole-numbers-summed", "", "sum = (sum + i) | 0;"],
  ["fractions-summed", "", "sum += i * 0.5;"],
  ["a-list-of-its-own-read", "const own = [1, 2, 3, 4, 5, 6, 7, 8];", "sum = (sum + own[i & 7]) | 0;"],
  ["a-list-of-its-own-stored", "const own = [1, 2, 3, 4, 5, 6, 7, 8];", "own[i & 7] = i; sum = own[3];"],
  [
    "fields-of-its-own-object",
    "const point = new Point(1, 2);",
    "point.x = i & 3; sum = (sum + point.x + point.y) | 0;",
  ],
  ["a-small-function-called", "", "sum = add(sum, i);"],
  ["a-text-of-its-own-read", 'const text = "abcdefgh";', "sum = (sum + text.charCodeAt(i & 7)) | 0;"],
  ["bytes-of-its-own", "const bytes = new Uint8Array(8);", "bytes[i & 7] = i; sum = (sum + bytes[(i + 1) & 7]) | 0;"],
  ["what-was-guessed-itself", "", "sum = (sum + (USE)) | 0;"],
  [
    "eight-of-what-was-guessed-in-a-list",
    "const bags = [bag, bag, bag, bag, bag, bag, bag, bag];",
    "const each = bags[i & 7]; sum = (sum + (EACH)) | 0;",
  ],
];

const places = [
  "in-front-of-the-use",
  "behind-the-use",
  "in-a-function-that-it-calls",
  "in-its-caller-behind-the-call",
  "in-a-later-call-that-is-given-what-was-guessed",
] as const;

const all = cases.length * works.length * places.length;

function write(at: number) {
  const place = places[at % places.length];
  const [work, laid, turn] = works[Math.floor(at / places.length) % works.length];
  const [name, { head, parameter, use, given }, which] = cases[Math.floor(at / places.length / works.length)];
  const loop = `let sum = 0; ${laid} for (let i = 0; i < turns; i++) { ${turn.replace("USE", use).replace("EACH", use.replace(/\bbag\b/g, "each"))} }`;
  const told = 'return sum + " " + seen;';
  const functions = {
    "in-front-of-the-use": `function look(${parameter}, turns: number) { ${loop} const seen = ${use}; ${told} }`,
    "behind-the-use": `function look(${parameter}, turns: number) { const seen = ${use}; ${loop} ${told} }`,
    "in-a-function-that-it-calls": `function toil(${parameter}, turns: number) { ${loop} return sum; }
function look(${parameter}, turns: number) { const seen = ${use}; const sum = toil(bag, turns); ${told} }`,
    "in-its-caller-behind-the-call": `function glance(${parameter}) { return ${use}; }
function look(${parameter}, turns: number) { const seen = glance(bag); ${loop} ${told} }`,
    "in-a-later-call-that-is-given-what-was-guessed": `function look(${parameter}, turns: number) { ${loop} const seen = ${use}; ${told} }`,
  }[place];
  const isLater = place === "in-a-later-call-that-is-given-what-was-guessed";
  return {
    name: `${name}--given-${given[which][0]}--${work}--${place}.ts`,
    text: `const unseen = (...texts: string[]): any => new Function(...texts);
class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function add(a: number, b: number) { return (a + b) | 0; }
${head}
${functions}
const none = Number("0"), many = Number("100000000");
const guessed: any = ${given[0][1]};
console.log(look(guessed, none));
const given: any = ${given[which][1]};
console.log(look(given, ${isLater ? "none" : "many"}));
${isLater ? "console.log(look(guessed, many));\n" : ""}export {};
`,
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, most] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < most; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
