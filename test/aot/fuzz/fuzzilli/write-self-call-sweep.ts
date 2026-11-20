// Functions that call themselves: how each of three arguments is written (changed parameters, side effects, swaps, calls, closures over a parameter), times where the call stands, times what ends it, times the kind of the function, times what the parameters hold.
//
//   bun write-self-call-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<first>--<second>--<call>--<end>--<kind>--<values>.mjs or .ts
//   bun write-self-call-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The parameters are `n`, `acc` and `x`; `n` counts towards 9.
const firsts: [name: string, text: string][] = [
  ["itself", "n"],
  ["next", "n + 1"],
  ["stepped", "++n"],
  ["stepped-behind", "n++ + 1"],
  ["assigned", "(n = n + 1)"],
  ["by-acc", "n + 1 + 0 * acc"],
  ["fraction", "n + 0.5"],
  ["called", "next(n)"],
  ["noted", '(notes.push("a"), n + 1)'],
  ["min", "Math.min(n + 1, 9)"],
  ["by-two", "(n += 2)"],
];
const seconds: [name: string, text: string][] = [
  ["sum", "acc + n"],
  ["itself", "acc"],
  ["stepped", "acc + n++"],
  ["stepped-and-read", "acc + n++ + n"],
  ["element-stepped", "acc + (list[n++] ?? 2)"],
  ["changed", "(acc += n)"],
  ["product", "(acc * 31 + n) | 0"],
  ["pushed", "(list.push(n), acc + list.length)"],
  ["noted", '(notes.push("b" + n), acc + 1)'],
  ["text", 'acc + "," + n'],
  ["of-x", "x"],
  ["element", "acc + (list[n] ?? 1)"],
  ["closure", "keep(() => n + acc)"],
  ["choice", "n & 1 ? acc + n : acc - 1"],
  ["inner-call", "acc + small(n)"],
  ["nothing", "n > 4 ? undefined : acc"],
];
const thirds: [name: string, text: string][] = [
  ["itself", "x"],
  ["swap", "acc"],
  ["first", "n"],
  ["object", "{ n, acc }"],
  ["list", "[n, x]"],
  ["stepped", "n--"],
  ["left-out", ""],
  ["spread", "...[n, acc]"],
];
// `SELF` is the call with its arguments, `END` what ends it, `DONE` the answer.
const calls: [name: string, body: string][] = [
  ["return", "if (END) return DONE;\nreturn SELF;"],
  ["choice", "return END ? DONE : SELF;"],
  ["or", "return (END && DONE) || SELF;"],
  ["else", "if (!(END)) {\n  return SELF;\n}\nreturn DONE;"],
  ["two", "if (END) return DONE;\nif (n & 1) return SELF;\nreturn SELF;"],
  ["switch", "switch (true) {\n  case END:\n    return DONE;\n  default:\n    return SELF;\n}"],
  ["not-last", "if (END) return DONE;\nconst answer = SELF;\nreturn answer;"],
  ["added", "if (END) return DONE;\nreturn 1 + SELF;"],
  ["tried", "try {\n  if (END) return DONE;\n  return SELF;\n} finally {\n  ends++;\n}"],
  ["caught", "if (END) return DONE;\ntry {\n  if (n === 4) throw n;\n} catch {\n  return SELF;\n}\nreturn SELF;"],
  ["in-a-loop", "for (let i = 0; i < 2; i++) {\n  if (END) return DONE;\n  if (i === 1) return SELF;\n  acc = acc;\n}"],
  ["comma", "if (END) return DONE;\nreturn ends++, SELF;"],
  ["nullish", "if (END) return DONE;\nreturn missing ?? SELF;"],
  ["local", "const before = n;\nif (END) return DONE;\nlet copy = acc;\ncopy = before;\nreturn SELF;"],
  ["arguments", "ends += arguments.length;\nif (END) return DONE;\nreturn SELF;"],
];
const finishes: [name: string, end: string, done: string][] = [
  ["count", "n >= 9", "show([n, acc, x])"],
  ["fuel", "--fuel < 0", "show([n, acc, x])"],
  ["acc", "n > 8 || acc > 60", "show([acc, n])"],
  ["x", "n >= 9", "show(x)"],
  ["count-of-arguments", "n > 7", "show([n, acc, x, ends])"],
];
// `BODY` is the body; `f` is called.
const kinds: [name: string, text: string, self: string][] = [
  ["function", "function f(n, acc, x) {\nBODY\n}", "f"],
  ["expression", "const f = function self(n, acc, x) {\nBODY\n};", "self"],
  ["default", "function f(n, acc = 1, x = n) {\nBODY\n}", "f"],
  ["rest", "function f(n, acc, ...rest) {\n  const x = rest[0];\nBODY\n}", "f"],
  ["pattern", "function f(n, acc, x) {\n  [n, acc] = [n, acc];\nBODY\n}", "f"],
  [
    "method",
    "const holder = {\n  f(n, acc, x) {\nBODY\n  },\n};\nconst f = (n, acc, x) => holder.f(n, acc, x);",
    "this.f",
  ],
  [
    "static",
    "class Holder {\n  static f(n, acc, x) {\nBODY\n  }\n}\nconst f = (n, acc, x) => Holder.f(n, acc, x);",
    "Holder.f",
  ],
  [
    "captured",
    "const make = by => {\n  const self = function (n, acc, x) {\nBODY\n  };\n  return self;\n};\nconst f = make(1);",
    "self",
  ],
];
const values = [
  ["numbers", "0, 0, 1"],
  ["halves", "0.5, 1.5, 2"],
  ["parsed", 'JSON.parse("1"), JSON.parse("2"), JSON.parse("[3]")'],
  ["text", '0, "t", "u"'],
  ["few", "3"],
  ["wide", "2, 2 ** 31, -0"],
  ["list", "1, 0, [5, 6]"],
] as const;
const total =
  firsts.length * seconds.length * thirds.length * calls.length * finishes.length * kinds.length * values.length;

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const call = pick(calls);
  const first = pick(firsts);
  const second = pick(seconds);
  const kind = pick(kinds);
  const third = pick(thirds);
  const finish = pick(finishes);
  const value = pick(values);
  const self = `${kind[2]}(${[first[1], second[1], third[1]].filter(text => text).join(", ")})`;
  const body = call[1].replaceAll("SELF", () => self).replaceAll("END", () => finish[1]).replaceAll("DONE", () => finish[2]); // prettier-ignore
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const lines = [
    "const notes = [];",
    "const list = [4, 5, 6];",
    "const kept = [];",
    "const missing = JSON.parse(\"null\");",
    "let ends = 0;",
    "let fuel = 0;",
    'const show = value => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : typeof value === "string" ? value.slice(0, 40) : String(value));',
    "const next = n => n + 1;",
    "const small = n => (n > 2 ? 1 : small(n + 1) + 1);",
    "const keep = ask => {\n  kept.push(ask);\n  return kept.length;\n};",
    ...kind[1].replace("BODY", () => indent("  if (--fuel < -30) return \"fuel\";\n" + indent(body, "  "), kind[0] === "function" ? "" : "  ")).split("\n"),
    "for (let round = 0; round < 3; round++) {",
    "  fuel = 12;",
    "  try {",
    `    console.log(show(f(${value[1]})), ends);`,
    `    console.log(show(f(round, round + 0.5, round)), list.length);`,
    "  } catch (error) {",
    '    console.log("!" + error.name);',
    "  }",
    "}",
    "console.log(notes.slice(0, 60).join(), kept.map(ask => show(ask())).slice(0, 30).join());",
  ]; // prettier-ignore
  return { name: `${first[0]}--${second[0]}--${call[0]}--${finish[0]}--${kind[0]}--${value[0]}.mjs`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(7, "0");
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
