// Steps of generators that do something and hand out a number: what is handed out, times what is done around it, times how the generator is written, times who takes the steps, times what is done with the number, times where the generator lives, times what is sent in, times the function around.
//
//   bun write-yielded-number-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<yielded>--<deed>--<shape>--<taker>--<used>--<home>--<sent>--<function>.mjs, .cjs or .ts
//   bun write-yielded-number-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `i` counts, `n` is given.
const yielded: [name: string, text: string][] = [
  ["counter", "i"],
  ["half", "i / 2"],
  ["not-a-number", "i === 1 ? NaN : i"],
  ["always-not-a-number", "n * NaN"],
  ["minus-zero", "i === 1 ? -0 : 0"],
  ["endless", "i / 0"],
  ["quotient", "n / i"],
  ["remainder", "i % n"],
  ["root", "Math.sqrt(i - 1)"],
  ["parsed", "parseFloat(['1', 'x', '2.5'][i])"],
  ["of-list", "numbers[i]"],
  ["past-end", "numbers[i + 8]"],
  ["large", "i * 1e10"],
  ["edge", "2147483647 + i"],
  ["of-field", "box.v"],
  ["text-or-number", "i & 1 ? 't' : i"],
  ["nothing", "undefined"],
  ["product", "n * i * 0.1"],
  ["logarithm", "Math.log(i)"],
  ["object", "{ v: i }"],
  ["own", "v"],
  ["own-product", "v * i"],
  ["own-difference", "v - v"],
  ["own-quotient", "(v - i) / (i - v)"],
];
// Y stands for the yield.
const deeds: [name: string, text: string][] = [
  ["counted-before", "seen++;\nY"],
  ["counted-after", "Y\nseen++;"],
  ["both", "seen++;\nY\nseen += 10;"],
  ["pushed", "pushed.push(i);\nY"],
  ["stored", "box.v += 1;\nY"],
  ["called", "note(i);\nY"],
  ["in-list", "numbers[i & 3] = i + 0.5;\nY"],
  ["tested", "if (i !== 2) {\n  seen++;\n  Y\n}"],
  ["caught", "try {\n  seen++;\n  Y\n} finally {\n  seen += 100;\n}"],
  ["added", "total += i;\nY\ntotal *= 2;"],
  ["kept", "const before = seen++;\nY\npushed.push(before);"],
  ["nothing", "Y"],
  ["own-divided", "v = v / i;\nY"],
  ["own-stepped-behind", "Y\nv += 0.5;"],
  ["own-doubled", "v *= 2;\nseen++;\nY"],
  ["own-subtracted", "Y\nv -= i;"],
];
// STEP is a step.
const shapes: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < 4; i++) {\n  STEP\n}"],
  ["while", "let i = 0;\nwhile (i < 4) {\n  STEP\n  i++;\n}"],
  ["endless", "for (let i = 0; ; i++) {\n  STEP\n}"],
  ["of-list", "for (const i of [0, 1, 2]) {\n  STEP\n}"],
  ["once", "const i = 1;\n{\n  STEP\n}"],
  ["two", "let i = 0;\n{\n  STEP\n}\ni = 1;\n{\n  STEP\n}"],
  ["nested", "for (let k = 0; k < 2; k++) {\n  for (let i = 0; i < 2; i++) {\n    STEP\n  }\n}"],
  ["delegated", "yield* (function* () {\n  for (let i = 0; i < 3; i++) {\n    STEP\n  }\n})();"],
  ["returns", "for (let i = 0; i < 4; i++) {\n  if (i === 3) return VALUE;\n  STEP\n}"],
];
// `g` makes the generator; USE is done with `x`.
const takers: [name: string, text: string][] = [
  ["of", "let turns = 0;\nfor (const x of g(n)) {\n  USE\n  if (++turns > 4) break;\n}"],
  [
    "by-hand",
    "const it = g(n);\nfor (let turns = 0; turns < 4; turns++) {\n  const { value: x, done } = it.next(SENT);\n  USE\n  out.push(done);\n}",
  ],
  ["destructured", "const [x, second] = g(n);\nUSE\nout.push(show(second));"],
  ["first", "const x = g(n).next().value;\nUSE"],
  [
    "in-turn",
    "const a = g(n);\nconst b = g(n + 1);\nfor (let turns = 0; turns < 3; turns++) {\n  a.next(SENT);\n  const x = b.next(SENT).value;\n  USE\n}",
  ],
  [
    "helper",
    "const step = it => it.next(SENT).value;\nconst it = g(n);\nfor (let turns = 0; turns < 3; turns++) {\n  const x = step(it);\n  USE\n}",
  ],
  [
    "handed-on",
    "const pass = function* () {\n  let turns = 0;\n  for (const y of g(n)) {\n    yield y;\n    if (++turns > 3) return;\n  }\n};\nfor (const x of pass()) {\n  USE\n}",
  ],
  [
    "kept",
    "const it = (holders[0] ??= g(n));\nfor (let turns = 0; turns < 2; turns++) {\n  const x = it.next(SENT).value;\n  USE\n}",
  ],
  ["leaves", "for (const x of g(n)) {\n  USE\n  break;\n}"],
  [
    "throws-in",
    "const it = g(n);\nit.next();\ntry {\n  it.throw(new RangeError('t'));\n} catch (error) {\n  out.push(error.name);\n}\nconst x = it.next().value;\nUSE",
  ],
  [
    "unknown",
    "take(g(n), x => {\n  USE\n});\ntake([1, 2], x => (sum += x));\ntake(new Set([0.5]), x => (sum += x));\ntake('ab', x => out.push(x));",
  ],
  [
    "unknown-and-left",
    "const some = it => {\n  let turns = 0;\n  for (const x of it) {\n    USE\n    if (++turns === 2) return;\n  }\n};\nsome(g(n));\nsome([3, 4, 5]);\nconst left = g(n);\nsome(left);\nout.push(show(left.next().value));",
  ],
  [
    "unknown-in-turn",
    "const all = [() => g(n), () => [1, 2], () => new Map([[1, 2]]).keys(), () => g(NaN)];\nfor (let k = 0; k < 8; k++) {\n  let turns = 0;\n  for (const x of all[k & 3]()) {\n    USE\n    if (++turns > 4) break;\n  }\n}",
  ],
  [
    "unknown-by-hand",
    "const hand = it => {\n  for (let r = it.next(), turns = 0; !r.done && turns < 6; r = it.next(), turns++) {\n    const x = r.value;\n    USE\n  }\n  return it.return?.(7)?.value;\n};\nout.push(show(hand(g(n))), show(hand([1, 2].values())), show(hand(g(NaN))));",
  ],
  ["ended", "const it = g(n);\nit.next();\nconst x = it.return(5).value;\nUSE\nout.push(it.next().done);"],
];
const used: [name: string, text: string][] = [
  ["shown", "out.push(show(x));"],
  ["summed", "sum += x;"],
  ["truncated", "sum += x | 0;"],
  ["compared", "if (x > 0) sum++;\nelse sum += 100;"],
  ["stored", "floats[0] = x;\nout.push(show(floats[0]));"],
  ["equal", "out.push(x === x, Object.is(x, -0));"],
  ["listed", "taken.push(x);"],
  ["field", "box.last = x;\nout.push(show(box.last));"],
  ["text", "out.push(`${show(x)}`);"],
];
// GENERATOR is its parameters and body; it becomes `g`.
const homes: [name: string, text: string][] = [
  ["function", "function* g(n)GENERATOR"],
  ["method", "class Steps {\n  *go(n)GENERATOR\n}\nconst steps = new Steps();\nconst g = n => steps.go(n);"],
  ["expression", "const g = function* (n)GENERATOR;"],
  [
    "iterable",
    "class Steps {\n  constructor(n) {\n    this.n = n;\n  }\n  *[Symbol.iterator]() {\n    const n = this.n;\n    yield* inner(n);\n  }\n}\nfunction* inner(n)GENERATOR\nconst g = n => new Steps(n)[Symbol.iterator]();",
  ],
];
const sent: [name: string, text: string][] = [["nothing", ""], ["number", "7"], ["not-a-number", "NaN"]]; // prettier-ignore
const functions: [name: string, text: string][] = [["function", "function run(n) {\n  BODY\n}"], ["arrow", "const run = n => {\n  BODY\n};"], ["twice", "function run(n) {\n  for (let round = 0; round < 2; round++) {\n    BODY\n  }\n}"]]; // prettier-ignore
const total = yielded.length * deeds.length * shapes.length * takers.length * used.length * homes.length * sent.length * functions.length; // prettier-ignore

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const value = pick(yielded);
  const taker = pick(takers);
  const shape = pick(shapes);
  const deed = pick(deeds);
  const use = pick(used);
  const home = pick(homes);
  const send = pick(sent);
  const form = pick(functions);
  const isTyped = cell % 4 === 1;
  const isCommon = !isTyped && cell % 3 === 0;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const within = (text: string, hole: string, part: string) =>
    text.replaceAll(new RegExp(`^( *)${hole}$`, "gm"), (_, by) => indent(part, by));
  const yields = send[1] ? `last = yield ${value[1]};` : `yield ${value[1]};`;
  const isOfOwn = value[0].startsWith("own") || deed[0].startsWith("own");
  const body =
    (isOfOwn ? "let v = n;\n" : "") +
    within(
      shape[1].replace("VALUE", () => value[1]),
      "STEP",
      within(deed[1], "Y", yields),
    );
  const generator = home[1].replace("GENERATOR", () => ` {\n${indent(body, "  ")}\n}`);
  const take = within(taker[1], "USE", use[1]).replaceAll("SENT", send[1]);
  const lines = [
    ...(isTyped ? ["// @ts-nocheck"] : []),
    'const show = value => (Object.is(value, -0) ? "-0" : value && typeof value === "object" ? "{" + Object.entries(value).join() + "}" : String(value).slice(0, 20));',
    "const out = [];",
    "let seen = 0;",
    "let total = 1;",
    "let sum = 0;",
    "let last;",
    "const pushed = [];",
    "const taken = [];",
    "const holders = [];",
    "const box = { v: 0.5, last: 0 };",
    "const numbers = [0.5, 1.5, NaN, 4];",
    "const floats = new Float64Array(1);",
    ...(/note\(/.test(body) ? ["const note = i => pushed.push(i);"] : []),
    ...(/take\(/.test(take)
      ? [
          "function take(it, call) {\n  let turns = 0;\n  for (const x of it) {\n    call(x);\n    if (++turns === 6) break;\n  }\n}",
        ]
      : []),
    generator,
    within(form[1], "BODY", take),
    "for (const n of [2, NaN, 0.5]) {",
    "  try {",
    "    run(n);",
    "  } catch (error) {",
    "    out.push(error.name);",
    "  }",
    "}",
    'console.log(out.join(" ").slice(0, 900), seen, show(total), show(sum), show(last), pushed.join(), taken.map(show).join(), numbers.map(show).join(), show(box));',
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${value[0]}--${deed[0]}--${shape[0]}--${taker[0]}--${use[0]}--${home[0]}--${send[0]}--${form[0]}.${isTyped ? "ts" : isCommon ? "cjs" : "mjs"}`,
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
