// `for (let i = 0; i < n; i++) { sum += i; last = i + 1 < n; }`: the comparison that ends a counted loop is written a second time, in the
// body, behind the loop or in a callback, so a compiler that computes it once has one value with two readers: the loop's branch and
// something else, often in another block. A pass that copies such a loop, unrolls it or runs it in stretches between two polls must not
// take the branch's operand for the comparison itself once the copying has put a variable between them. Each scene draws the form of the
// loop, the counter's start, step and relation, what bounds it, a short body, where the test is read again and how, and runs with bounds
// from none to many thousands of turns.
import type { Random } from "./random";

/** `I` is the counter, `N` the bound, `S` the step with its sign. */
const relations = [
  { up: true, text: "I < N" },
  { up: true, text: "I < N" },
  { up: true, text: "I <= N" },
  { up: true, text: "I !== N" },
  { up: true, text: "N > I" },
  { up: false, text: "I > N" },
  { up: false, text: "I >= N" },
  { up: false, text: "N < I" },
];
const bounds = [
  "n",
  "n",
  "n | 0",
  "list.length",
  "list.length",
  "limit",
  "n >>> 0",
  "Math.min(n, list.length)",
  "holder.n",
];
const bodies = [
  "sum = (sum + I) | 0;",
  "sum = (sum + I) | 0;",
  "sum += list[I & 7];",
  "sum = (sum * 31 + I) | 0;",
  "sum ^= I;",
  "out[I & 7] = I;",
  "text = I & 1023 ? text : text + I;",
  "sum += half(I);",
];
/** `T` is the test as the loop writes it, `U` the test of the turn that follows. */
const readers = [
  // A path that throws is rare: it is no test of the turn, and what it reads lies in another block than the loop's branch.
  'const more = U;\nif (I === bad) throw new RangeError("at " + I + " " + more);',
  'const more = U;\nif (I === bad) throw new RangeError("at " + I + " " + more);',
  'const more = U;\nif (I === bad) throw new RangeError("at " + I + " " + more);',
  'const now = T;\nif (I === bad) throw new RangeError("at " + I + " " + now);',
  "const more = U;\nif (I === bad) fail(I, more);",
  'const more = U;\nsum = (sum + list[I & 7]) | 0;\nif (sum === bad) throw new RangeError("sum " + more);',
  "last = U;",
  "last = U;",
  "last = T;",
  "if (U) sum ^= 1;",
  'if (!U) note("the last turn", I);',
  "sum += Number(U);",
  "sum += U ? 1 : 2;",
  "const more = U;\nif (more) sum = (sum + 3) | 0;\nlast = more;",
  "seen[I & 3] = U;",
  "last = U && T;",
  "last = keep(U);",
  "try {\nlast = U;\n} finally {\nsum ^= 2;\n}",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  const count = random.between(1, 4);
  for (let scene = 0; scene < count; scene++) {
    const relation = random.pick(relations);
    const size = random.pick([1, 1, 1, 2, 3]);
    // `!==` ends only where the counter meets the bound.
    const step = relation.text.includes("!==") ? 1 : size;
    const bound = random.pick(bounds);
    const isBoundRead = random.chance(0.5);
    const named = isBoundRead ? "end" : `(${bound})`;
    const at = (text: string, counter: string) =>
      text.replace(/\bI\b/g, counter).replace(/\bN\b/g, relation.up ? named : "0");
    const next = relation.up ? `i + ${step}` : `i - ${step}`;
    const test = at(relation.text, "i");
    const following = at(relation.text, `(${next})`);
    const fill = (text: string) =>
      text.replace(/\bT\b/g, `(${test})`).replace(/\bU\b/g, `(${following})`).replace(/\bI\b/g, "i");
    const body = [
      ...Array.from({ length: random.between(1, 3) }, () => fill(random.pick(bodies))),
      ...(random.chance(0.85) ? [fill(random.pick(readers))] : []),
    ];
    if (random.chance(0.3)) body.reverse();
    const start = !relation.up
      ? `${named} - 1`
      : relation.text.includes("!==")
        ? "0"
        : random.pick(["0", "0", "1", "first"]);
    const move = relation.up ? (step === 1 ? random.pick(["i++", "++i", "i += 1"]) : `i += ${step}`) : step === 1 ? random.pick(["i--", "i -= 1"]) : `i -= ${step}`; // prettier-ignore
    const loop = random.pick([
      `let i = ${start};\nfor (; ${test}; ${move}) {\n${body.join("\n")}\n}`,
      `let i = ${start};\nfor (; ${test}; ${move}) {\n${body.join("\n")}\n}`,
      `let i = ${start};\nwhile (${test}) {\n${body.join("\n")}\n${move};\n}`,
      `let i = ${start};\nif (${test}) {\ndo {\n${body.join("\n")}\n${move};\n} while (${test});\n}`,
    ]);
    const behind = random.chance(0.6) ? [`note("behind", i, ${test}, ${following});`] : [];
    const byCallback = random.pick([
      [],
      [],
      ['note("reduce", list.reduce((all, each, at) => (all + (at + 1 < list.length ? each : -each)) | 0, 0));'],
      ['note("map", list.map((each, at) => at + 1 < list.length).join());'],
      ['note("some", list.some((each, at) => !(at + 1 < list.length) && each > 0));'],
    ]);
    scenes.push(`function run${scene}(n, list, first, bad) {
let sum = 0;
let last;
let text = "";
const out = [0, 0, 0, 0, 0, 0, 0, 0];
const seen = [];
const holder = { n };
${isBoundRead ? `const end = ${bound};` : ""}
${loop}
${behind.join("\n")}
${byCallback.join("\n")}
return [sum, last, text.length, out.join(), seen.join()].join(" ");
}
for (const n of [0, 1, 2, 7, 8, 70, 1025, ${random.pick([5000, 20000, 70001])}]) {
  for (const bad of [-5, ${random.pick([0, 1, 6, 69, 1024])}]) {
    try {
      note("${scene}", n, bad, run${scene}(n, lists[n & 3], n & 1, bad));
    } catch (error) {
      note("${scene}", n, bad, "throws", error.message);
    }
  }
}`);
  }
  return `const limit = ${random.pick([0, 3, 64, 4097])};
const lists = [[1, 2, 3, 4, 5, 6, 7, 8], [], [9], Array.from({ length: 3000 }, (unused, at) => at & 15)];
function note(...parts) {
  console.log(parts.join(" "));
}
function fail(at, more) {
  throw new RangeError("failed at " + at + " " + more);
}
function half(value) {
  return value >> 1;
}
const keepers = [value => value, value => value];
let kept = 0;
function keep(value) {
  return keepers[kept++ & 1](value);
}
${scenes.join("\n")}
`;
}
