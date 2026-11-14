// The least programs that ask a value: where the value is, times the two values that get there, times the question, times the loop, with nothing beside.
//
//   bun write-bare-condition-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<place>--<value>--<value>--<question>--<loop>.mjs, .cjs or .ts
//   bun write-bare-condition-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// A and B are the values; X is the place, and `i` says which of the two it is.
const places: [name: string, declared: string, set: string, place: string][] = [
  ["field", "const o = { x: A };", "o.x = i & 1 ? A : B;", "o.x"],
  ["class-field", "class C {\n  x = A;\n}\nconst o = new C();", "o.x = i & 1 ? A : B;", "o.x"],
  [
    "constructor-field",
    "class C {\n  constructor(x) {\n    this.x = x;\n  }\n}",
    "const o = new C(i & 1 ? A : B);",
    "o.x",
  ],
  ["element", "const l = [A, B];", ";", "l[i & 1]"],
  ["stored-element", "const l = [A];", "l[0] = i & 1 ? A : B;", "l[0]"],
  ["variable", "let x = A;", "x = i & 1 ? A : B;", "x"],
  ["constant", "", "const x = i & 1 ? A : B;", "x"],
  ["argument", "const ask = x => Q;", ";", "ask(i & 1 ? A : B)"],
  ["returned", "const give = i => (i & 1 ? A : B);", ";", "give(i)"],
  ["map", "const m = new Map([[0, A], [1, B]]);", ";", "m.get(i & 1)"],
  ["object-of-keys", "const o = { k0: A, k1: B };", ";", "o['k' + (i & 1)]"],
  ["two-objects", "const all = [{ x: A }, { x: B }];", ";", "all[i & 1].x"],
  ["captured", "let x = A;\nconst get = () => x;", "x = i & 1 ? A : B;", "get()"],
  ["static", "class C {\n  static x = A;\n}", "C.x = i & 1 ? A : B;", "C.x"],
  ["destructured", "const all = [{ x: A }, { x: B }];", "const { x } = all[i & 1];", "x"],
  ["chain", "const all = [{ o: { x: A } }, { o: { x: B } }, {}];", ";", "all[i % 3]?.o?.x"],
  [
    "many-fields",
    "class C {\n  constructor(x) {\n    this.p = 1;\n    this.x = x;\n    this.q = 2;\n    this.r = 3;\n  }\n}\nconst all = [new C(A), new C(B)];",
    ";",
    "all[i & 1].x",
  ],
];
const values: [name: string, text: string][] = [["one", "1"], ["zero", "0"], ["two-and-a-half", "2.5"], ["minus-zero", "-0"], ["not-a-number", "NaN"], ["null", "null"], ["undefined", "undefined"], ["empty-text", "''"], ["text", "'a'"], ["true", "true"], ["false", "false"], ["object", "held"], ["list", "[1]"], ["big-zero", "0n"], ["edge", "2147483648"], ["lowest", "-2147483648"], ["large", "1e300"]]; // prettier-ignore
// X is the value.
const questions: [name: string, text: string][] = [
  ["choice", "X ? 1 : 2"],
  ["not", "!X"],
  ["not-not", "!!X"],
  ["and", "X && 'and'"],
  ["or", "X || 'or'"],
  ["nullish", "X ?? 'nullish'"],
  ["is-null", "X === null"],
  ["is-undefined", "X === undefined"],
  ["is-nothing", "X == null"],
  ["is-something", "X != null"],
  ["is-zero", "X === 0"],
  ["is-loosely-zero", "X == 0"],
  ["is-one", "X === 1"],
  ["is-not-one", "X !== 1"],
  ["less", "X < 1"],
  ["more", "X >= 0"],
  ["type", "typeof X"],
  ["is-number", "typeof X === 'number'"],
  ["is-object", "typeof X === 'object'"],
  ["is-object-and", "typeof X === 'object' && X ? 'o' : 'n'"],
  ["same", "Object.is(X, 0)"],
  ["is-integer", "Number.isInteger(X)"],
  ["is-itself", "X === X"],
  ["asked-field", "X?.x"],
  ["asked-length", "X?.length"],
  ["text-of", "`${String(X)}`"],
  ["truncated", "typeof X === 'symbol' || typeof X === 'bigint' ? 's' : X | 0"],
  ["added", "typeof X === 'symbol' || typeof X === 'bigint' ? 's' : X + 1"],
  ["boolean", "Boolean(X)"],
  [
    "switch",
    "(x => {\n  switch (x) {\n    case 0:\n      return 'zero';\n    case null:\n      return 'null';\n    case 1:\n      return 'one';\n  }\n  return 'other';\n})(X)",
  ],
  ["instance", "X instanceof Object"],
  ["is-list", "Array.isArray(X)"],
];
const loops: [name: string, text: string][] = [["four", "for (let i = 0; i < 4; i++) {\n  IN\n}"], ["once", "for (let i = n; i <= n; i++) {\n  IN\n}"], ["many", "for (let i = 0; i < 40; i++) {\n  IN\n}"], ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 3; i++) {\n    IN\n  }\n}"], ["if", "for (let i = 0; i < 5; i++) {\n  if (i !== 2) {\n    IN\n  }\n}"]]; // prettier-ignore
const uses: [name: string, text: string][] = [["pushed", "out.push(ASK);"], ["branch", "if (ASK) out.push('yes');\nelse out.push('no');"], ["kept", "const kept = ASK;\nout.push(kept);"], ["counted", "if (ASK) count++;"], ["loop", "while (ASK) {\n  out.push('w');\n  break;\n}"]]; // prettier-ignore
const total = places.length * values.length ** 2 * questions.length * loops.length * uses.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const question = pick(questions);
  const first = pick(values);
  const place = pick(places);
  const second = pick(values);
  const use = pick(uses);
  const loop = pick(loops);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const fill = (text: string) => text.replaceAll(/\b[AB]\b/g, letter => (letter === "A" ? first[1] : second[1]));
  const isArgument = place[0] === "argument";
  const ask = isArgument ? place[3] : question[1].replaceAll(/\bX\b/g, () => place[3]);
  const declared = fill(place[1].replace(/\bQ\b/, () => `(${question[1].replaceAll(/\bX\b/g, "x")})`));
  const step = `${place[2] === ";" ? "" : fill(place[2]) + "\n"}${use[1].replace("ASK", () => fill(ask))}`;
  const body = within(loop[1], "IN", step);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    ...(/\bheld\b/.test(declared + body) ? ["const held = { x: 3 };"] : []),
    "const out = [];",
    "let count = 0;",
    ...(declared ? [declared] : []),
    `function run(n) {\n${indent(body, "  ")}\n}`,
    "for (const n of [0, 1]) run(n);",
    "console.log(out.map(value => (Object.is(value, -0) ? '-0' : typeof value === 'object' && value ? 'o' : String(value))).join(), count);",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${place[0]}--${first[0]}--${second[0]}--${question[0]}--${use[0]}--${loop[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
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
