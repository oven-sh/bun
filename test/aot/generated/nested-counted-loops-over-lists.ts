// Counted loops inside counted loops, each up to the length of a list. Each case is one function of the file, called from the file's own code with a few lists, and prints what plain Bun prints.
// The table: how deep the loops are x where the second and third list come from x where a store to a list stands x the test round an inner loop x what the innermost loop reads.
// Which list bounds which loop, where an inner counter starts, what is stored and where to, whether a length is also read in front of the loop that it bounds, and what the function is called with rotate.
//
//   bun nested-counted-loops-over-lists.ts <folder> [--typed] [--sample=<how many>] [--only=<regex over names>]
//
// writes <folder>/<depth>-loops-<lists>.mjs, with --typed .ts.
import { writeCaseFiles, type CaseFile } from "./case-files";

type Named = { name: string };

const depths = [
  { name: "two", loops: 2 },
  { name: "three", loops: 3 },
];

/** What `l1` and `l2` are. `l0` and `given` are parameters. */
const lists = [
  { name: "one-list", l1: "l0", l2: "l0" },
  { name: "a-slice", l1: "l0.slice()", l2: "l0" },
  { name: "a-copy", l1: "[...l0]", l2: "l1" },
  { name: "another-parameter", l1: "given", l2: "l0" },
  { name: "a-slice-and-a-copy", l1: "l0.slice()", l2: "[...l0]" },
  { name: "a-copy-and-another-parameter", l1: "[...l0]", l2: "given" },
  { name: "a-slice-of-a-slice", l1: "l0.slice()", l2: "l1.slice(1)" },
];

const stores = [
  { name: "no-store" },
  { name: "store-in-front" },
  { name: "store-between" },
  { name: "store-inside" },
  { name: "store-behind-the-inner-loop" },
];

/** `C` stands for the counter of the loop around. */
const tests = [
  { name: "no-test", open: "", close: "" },
  { name: "seldom", open: "if (n1 === 0) {", close: "}" },
  { name: "often", open: "if (n1 !== 0) {", close: "}" },
  { name: "every-other-turn", open: "if ((C & 1) === 0) {", close: "}" },
  { name: "by-an-element", open: "if (l0[C] === 1) {", close: "}" },
  { name: "seldom-or-else", open: "if (n1 === 0) {", close: "} else { n0 = (n0 + l1.length) | 0; }" },
];

/** `I` stands for the outermost counter, `J` for the innermost. */
const reads = [
  { name: "a-fixed-element-of-the-first", read: "l0[2]" },
  { name: "a-fixed-element-of-the-second", read: "l1[2]" },
  { name: "the-first-by-the-inner-counter", read: "l0[J]" },
  { name: "the-second-by-the-inner-counter", read: "l1[J]" },
  { name: "the-third-by-the-inner-counter", read: "l2[J]" },
  { name: "the-second-by-the-outer-counter", read: "l1[I]" },
  { name: "the-neighbor", read: "l1[J + 1]" },
  { name: "by-both-counters", read: "l0[I * 2 + J]" },
  { name: "a-length", read: "l2.length" },
  { name: "no-list", read: "(J & 3)" },
];

/** Which list bounds the first, second and third loop. */
const bounds = [
  { name: "bounds-0-1-2", of: ["l0", "l1", "l2"] },
  { name: "bounds-0-0-0", of: ["l0", "l0", "l0"] },
  { name: "bounds-1-0-1", of: ["l1", "l0", "l1"] },
  { name: "bounds-0-1-1", of: ["l0", "l1", "l1"] },
  { name: "bounds-2-1-0", of: ["l2", "l1", "l0"] },
];

/** `C` stands for the counter of the loop around, `L` for the list that bounds the loop, `J` for its counter. */
const starts = [
  { name: "from-zero", head: "let J = 0; J < L.length; J++" },
  { name: "from-the-counter-around", head: "let J = C; J < L.length; J++" },
  { name: "from-behind-the-counter-around", head: "let J = C + 1; J < L.length; J++" },
  { name: "downward", head: "let J = L.length - 1; J >= 0; J--" },
  { name: "up-to-a-length-read-once", head: "let J = 0, end = L.length; J < end; J++" },
];

/** `C` stands for a counter that is in scope where the store stands, or for 1. */
const stored = [
  { name: "a-fixed-element-of-the-first", store: "l0[2] = 5;" },
  { name: "a-fixed-element-of-the-second", store: "l1[2] = 1;" },
  { name: "an-element-by-a-counter", store: "l1[C] = n1 & 1;" },
  { name: "one-more-element", store: "if (l1.length < 7) l1.push(1);" },
  { name: "a-shorter-length", store: "if (l0.length > 3) l0.length = 3;" },
  { name: "a-length-with-nothing-behind-it", store: "if (l1.length === 3) l1.length = 6;" },
];

const lengthsInFront = [
  { name: "length-read-once", read: "" },
  { name: "length-read-in-front-too", read: "n0 = (n0 + (L.length & 1)) | 0;" },
];

/** Each call: x, y, l0, given. With 2 and -1 the sum that `seldom` tests is zero on the first turn. */
const calls = [
  { name: "one-call", of: ["1, 2, [1, 2, 3], [4, 1]"], isTypedToo: true },
  { name: "one-call-that-takes-the-seldom-way", of: ["2, -1, [1, 1, 1, 1], [1, 1]"], isTypedToo: true },
  {
    name: "the-lists-are-looked-at-afterwards",
    of: ["2, -1, [1, 1, 1, 1], [1, 0, 1]"],
    isTypedToo: true,
    looksAtLists: true,
  },
  {
    name: "whole-numbers",
    of: [
      "1, 2, [1, 2, 3], [4, 1]",
      "2, -1, [1, 1, 1, 1], [1]",
      "0, 0, [], []",
      "4, -2, [3, 1, 1, 0, 1, 7], [1, 1, 1]",
      "0, 0, [1, 0, 1], [1, 1, 1, 1, 1]",
    ],
    isTypedToo: true,
  },
  {
    name: "fractions-too",
    of: ["2, -1, [1, 1, 1, 1], [1]", "2, -1, [1.5, 1, 1], [1, 0.5]", "0, 0, [1, 1], [1, 1, 1]"],
    isTypedToo: true,
  },
  {
    name: "holes-too",
    of: [
      "2, -1, [1, 1, 1, 1], [1]",
      "2, -1, [1, , 1, 1], [, 1]",
      "0, 0, Array(4), [1, 1, 1]",
      "0, 0, [1, 1, 1], Array(2)",
    ],
    isTypedToo: false,
  },
];

const counters = ["i", "j", "k"];

/** One of the values, another for each axis and turn, the same in every run. */
function drawn<T>(values: T[], axis: number, turn: number): T {
  let bits = Math.imul(turn * 8 + axis + 1, 0x9e3779b1);
  bits = Math.imul(bits ^ (bits >>> 15), 0x85ebca6b);
  return values[((bits ^ (bits >>> 13)) >>> 0) % values.length];
}

function bodyOf(
  depth: (typeof depths)[0],
  list: (typeof lists)[0],
  store: Named,
  test: (typeof tests)[0],
  read: (typeof reads)[0],
  turn: number,
  isTyped: boolean,
) {
  const bound = drawn(bounds, 0, turn);
  const start = drawn(starts, 1, turn);
  const what = drawn(stored, 2, turn);
  const inFront = drawn(lengthsInFront, 3, turn);
  const storeAt = (place: string, counter: string) =>
    store.name === place ? what.store.replaceAll("C", counter) + " " : "";
  const innermost = counters[depth.loops - 1];
  let text = `${storeAt("store-inside", innermost)}if (${read.read.replaceAll("I", "i").replaceAll("J", innermost)} === 1) { n0 += 1; }`;
  for (let level = depth.loops - 1; level > 0; level--) {
    const around = counters[level - 1];
    const head = start.head
      .replaceAll("J", counters[level])
      .replaceAll("C", around)
      .replaceAll("L", bound.of[level])
      .replaceAll("end", `end${level}`);
    text =
      (level === 1 ? `n1 = (n1 + (n0 >> 1)) | 0; ${storeAt("store-between", around)}` : "") +
      inFront.read.replaceAll("L", bound.of[level]) +
      ` ${test.open.replaceAll("C", around)} for (${head}) { ${text} } ${test.close} ` +
      (level === 1 ? storeAt("store-behind-the-inner-loop", around) : "");
  }
  const types = isTyped ? ["x: number, y: number, l0: number[], given: number[]", ": number"] : ["x, y, l0, given", ""];
  const names = [bound.name, start.name, store.name === "no-store" ? "nothing" : what.name, inFront.name];
  return {
    names,
    text: `function f${turn}(${types[0]})${types[1]} { let n0 = x, n1 = y, l1 = ${list.l1}, l2 = ${list.l2}; ${storeAt("store-in-front", "1")}for (let i = 0; i < ${bound.of[0]}.length; i++) { ${text} } return n0 + n1; }`,
  };
}

const head = (isTyped: boolean) =>
  `// Counted loops inside counted loops, each up to the length of a list.
function t(name${isTyped ? ": string" : ""}, answers${isTyped ? ": unknown[]" : ""}) {
  console.log(name + ": " + JSON.stringify(answers));
}
`;

/** How many cases stand for each cell of the table, each with other values of what rotates. */
const turnsOfEachCell = 1;

export function caseFiles(isTyped: boolean): CaseFile[] {
  const callsTaken = calls.filter(call => !isTyped || call.isTypedToo);
  let turn = 0;
  return depths.flatMap(depth =>
    lists.map(list => ({
      name: `${depth.name}-loops-${list.name}.${isTyped ? "ts" : "mjs"}`,
      head: head(isTyped),
      cases: stores.flatMap(store =>
        tests.flatMap(test =>
          reads.flatMap(read =>
            Array.from({ length: turnsOfEachCell }, () => {
              const call = drawn(callsTaken, 4, turn);
              const f = `f${turn}`;
              const { names, text } = bodyOf(depth, list, store, test, read, turn++, isTyped);
              const name = [depth.name, list.name, store.name, test.name, read.name, ...names, call.name].join(" ");
              const parameters = isTyped ? "x: number, y: number, a: number[], b: number[]" : "x, y, a, b";
              const runs = call.of.map(operands =>
                call.looksAtLists ? `((${parameters}) => [${f}(x, y, a, b), a, b])(${operands})` : `${f}(${operands})`,
              );
              return { name, line: `t(${JSON.stringify(name)}, [${runs.join(", ")}]); ${text}` };
            }),
          ),
        ),
      ),
    })),
  );
}

if (import.meta.main) writeCaseFiles(caseFiles(process.argv.includes("--typed")));
