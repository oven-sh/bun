// `function rest(list) { const it = list.values(); it.next(); return it; }`: a helper that steps an iterator and hands it back. A
// compiler that splits the allocation of a result off its worker has to hand on where the iterator stands, not only what it walks.
// Each scene varies what that rests on: what is walked (lists, sets, maps, strings, views, generators, iterator helpers), who makes
// the iterator, how often and on which turns the helper steps it, how it comes back (bare, in a record, in a list, through a second
// helper), whether the collection changes in between, and how the caller goes on.
import type { Random } from "./random";

/** What is walked, and the calls that make an iterator of `held`. */
const walked: [string, string[]][] = [
  ["[10, 20, 30, 40, 50]", ["held.values()", "held[Symbol.iterator]()", "held.keys()", "held.entries()"]],
  ["[10, 20, 30, 40, 50]", ["held.values()", "held[Symbol.iterator]()"]],
  ["[1.5, , 3.5, 4.5]", ["held.values()", "held.entries()"]],
  ["new Set([1, 2, 3, 4, 5])", ["held.values()", "held[Symbol.iterator]()", "held.keys()", "held.entries()"]],
  ['new Set(["a", "b", "c", "d"])', ["held.values()", "held.entries()"]],
  [
    'new Map([[1, "a"], [2, "b"], [3, "c"], [4, "d"]])',
    ["held.keys()", "held.values()", "held.entries()", "held[Symbol.iterator]()"],
  ],
  ['new Map([["k", 1], ["l", 2], ["m", 3]])', ["held.keys()", "held.values()", "held.entries()"]],
  ["new Set(Array.from({ length: 12 }, (_, at) => at))", ["held.values()"]],
  ['"abcdef"', ["held[Symbol.iterator]()"]],
  ['"a😀b中c"', ["held[Symbol.iterator]()"]],
  ["new Uint8Array([1, 2, 3, 4, 5])", ["held.values()", "held.keys()", "held.entries()"]],
  [
    "[1, 2, 3, 4, 5]",
    ["held.values().map((each$A) => each * 2)", "held.values().drop(1)", "held.values().filter((each$A) => each % 2)"],
  ],
  ["[1, 2, 3, 4, 5]", ["counts(held.length)"]],
  ['"a1a2a3a4"', ["held.matchAll(/a\\d/g)"]],
];

/** Bodies of a helper. MAKE makes the iterator, or names the parameter `given`. */
const helpers = [
  "const it = MAKE;\n  it.next();\n  return it;",
  "const it = MAKE;\n  it.next();\n  return it;",
  "const it = MAKE;\n  it.next();\n  it.next();\n  return it;",
  "const it = MAKE;\n  for (let step = 0; step < STEPS; step++) it.next();\n  return it;",
  "const it = MAKE;\n  if (turn % 3) it.next();\n  return it;",
  "const it = MAKE;\n  if (turn % 7 === 6) return it;\n  it.next();\n  return it;",
  "const it = MAKE;\n  return it;",
  "const it = MAKE;\n  while (!it.next().done);\n  return it;",
  "const it = MAKE;\n  const first = it.next();\n  said.push(shown(first));\n  return it;",
  'const it = MAKE;\n  try {\n    it.next();\n  } finally {\n    said.push("stepped");\n  }\n  return it;',
  "const it = MAKE;\n  const other = MAKE;\n  it.next();\n  other.next();\n  other.next();\n  return turn % 2 ? it : other;",
  "const it = MAKE;\n  stepOnce(it);\n  return it;",
  "return stepped(MAKE);",
  "return stepped(stepped(MAKE));",
  "const it = MAKE;\n  for (const each of it) {\n    said.push(shown(each));\n    break;\n  }\n  return it;",
  "const it = MAKE;\n  const [first] = it;\n  said.push(shown(first));\n  return it;",
];

/** How the helper's answer is wrapped, and how the caller takes it out again. */
const wraps: [string, string][] = [
  ["IT", "ANSWER"],
  ["IT", "ANSWER"],
  ["IT", "ANSWER"],
  ["{ it: IT, turn }", "ANSWER.it"],
  ["[IT, turn]", "ANSWER[0]"],
  ["() => IT", "ANSWER()"],
];

const changes = [
  "held.push?.(60);",
  "held.pop?.();",
  "held.add?.(99);",
  "held.delete?.(3);",
  "held.delete?.(1);",
  "held.clear?.();",
  'held.set?.(9, "z");',
  "if (Array.isArray(held)) held.length = 2;",
  "if (Array.isArray(held)) held[2] = 300;",
];

const goesOn = [
  "said.push(shown(it.next()));",
  "said.push(shown(it.next()));",
  "said.push(shown(it.next()), shown(it.next()));",
  "said.push(shown([...it]));",
  "said.push(shown([...it]));",
  "said.push(shown(Array.from(it)));",
  "for (const each of it) said.push(shown(each));",
  "for (const each of it) {\n    said.push(shown(each));\n    break;\n  }\n  said.push(shown(it.next()));",
  "const [first, second] = it;\n  said.push(shown(first), shown(second));",
  "said.push(shown(it.take(2).toArray()));",
  "said.push(shown(it.toArray()));",
  "said.push(String(it[Symbol.iterator]() === it), shown(it.next()));",
  "said.push(shown(stepped(it).next()));",
  "said.push(Object.prototype.toString.call(it), shown(it.next()));",
  "let count = 0;\n  while (!it.next().done) count++;\n  said.push(String(count));",
  "said.push(shown(new Set(it).size));",
  'said.push(shown(Math.max(0, ...[...it].map(each => (typeof each === "number" ? each : 1)))));',
];

export function generate(random: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isPlain = random.chance(0.4);
    const [made, calls] = isPlain ? random.pick(walked.slice(0, 7)) : random.pick(walked);
    const call = random.pick(calls).replaceAll("$A", any);
    const isGiven = !isPlain && random.chance(0.3);
    const [wrap, unwrap] = isPlain ? wraps[0]! : random.pick(wraps);
    const body = (isPlain ? random.pick(helpers.slice(0, 4)) : random.pick(helpers))
      .replaceAll("MAKE", isGiven ? "given" : call)
      .replaceAll("STEPS", String(random.between(0, 4)))
      .replace(/return ([^;\n]+);/g, (_, answer: string) => `return ${wrap.replace("IT", answer)};`);
    // Two iterators out of one parameter are the same iterator: that helper makes its own.
    const usesGiven = isGiven && !body.includes("const other");
    const text = usesGiven ? body : body.replaceAll("given", call);
    // Plain Bun folds the length of a constant string also where it is stored to, so nothing is written about a string.
    const change = isPlain || made.startsWith('"') || random.chance(0.55) ? "" : random.pick(changes);
    const uses = random.sample(goesOn, isPlain ? 1 : random.between(1, 2)).join("\n  ");
    const isKept = random.chance(0.3);
    const turns = random.pick([4, 30, 300, 2500]);
    scenes.push(`${isKept ? `const kept${scene}${any} = ${made};\n` : ""}function helper${scene}(held${any}, turn${typed ? ": number" : ""}, said${typed ? ": string[]" : ""}, given${typed ? "?: any" : ""})${any} {
  ${text}
}
function run${scene}(turn${typed ? ": number" : ""}) {
  const said${typed ? ": string[]" : ""} = [];
  const held${any} = ${isKept && !change ? `kept${scene}` : made};
  const it${any} = ${unwrap.replace("ANSWER", `helper${scene}(held, turn, said${usesGiven ? `, ${call}` : ""})`)};
  ${change}
  ${uses}
  return said.join(" ");
}
{
  let hash = 0;
  let last = "";
  for (let turn = 0; turn < ${turns}; turn++) {
    try {
      last = run${scene}(turn);
    } catch (error) {
      last = "threw " + ${typed ? "(error as Error).name" : "error.name"};
    }
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last);
}`);
  }
  return `function shown(value${any})${typed ? ": string" : ""} {
  return JSON.stringify(value) ?? "undefined";
}
function stepOnce(given${any}) {
  given.next();
}
function stepped(given${any})${any} {
  given.next();
  return given;
}
function* counts(limit${typed ? ": number" : ""}) {
  for (let at = 0; at < limit; at++) yield at * 3;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
