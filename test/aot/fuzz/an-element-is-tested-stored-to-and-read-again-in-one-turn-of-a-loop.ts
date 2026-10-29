// In one turn of a loop that walks a list, an element is tested, an element is stored to and an element is read, most often the same one: `if (a[i] === 100) a[i] = 3; s += a[i];`.
// The body is small, the test asks for the element's own value, and every function sees lists that were made in one way alone, of four lengths.
// `generate()` draws everything. `programOf()` walks every way to make a list x every turn x every loop, untyped and typed: once with the plainest test, stored value and read, and twice with these drawn.
import { Random } from "./random";

const isMarked = (index: number) => index % 3 === 1 || index % 7 === 4;
const ints = (n: number) => Array.from({ length: n }, (_, index) => (isMarked(index) ? "100" : String(index + 1)));
const fractions = (n: number) => Array.from({ length: n }, (_, index) => (isMarked(index) ? "100" : index + 1 + ".5"));
const mixed = (n: number) => Array.from({ length: n }, (_, index) => (isMarked(index) ? "100" : `"t${index}"`));
const holes = (n: number) =>
  Array.from({ length: n }, (_, index) =>
    index % 5 === 2 && index + 1 < n ? "" : isMarked(index) ? "100" : String(index + 1),
  );
const literal = (parts: string[]) => `[${parts.join(", ")}]`;

const makers: Record<string, (n: number) => string> = {
  literal: n => literal(ints(n)),
  pushed: n => `(() => { const l = []; for (const e of ${literal(ints(n))}) l.push(e); return l; })()`,
  pushedOneByOne: n =>
    `(() => { const l = []; ${ints(n)
      .map(e => `l.push(${e});`)
      .join(" ")} return l; })()`,
  from: n => `Array.from(${literal(ints(n))})`,
  fromLength: n => `Array.from({ length: ${n} }, (_, k) => (k % 3 === 1 || k % 7 === 4 ? 100 : k + 1))`,
  of: n => `Array.of(${ints(n).join(", ")})`,
  filled: n => `new Array(${n}).fill(100)`,
  filledThenStored: n =>
    `(() => { const l = new Array(${n}).fill(0); for (let k = 0; k < ${n}; k++) l[k] = k % 3 === 1 || k % 7 === 4 ? 100 : k + 1; return l; })()`,
  sizedThenStored: n =>
    `(() => { const l = new Array(${n}); for (let k = 0; k < ${n}; k++) l[k] = k % 3 === 1 || k % 7 === 4 ? 100 : k + 1; return l; })()`,
  mapped: n => `${literal(ints(n))}.map(e => e)`,
  spread: n => `[...${literal(ints(n))}]`,
  sliced: n => `${literal(["0", ...ints(n)])}.slice(1)`,
  joined: n => `[].concat(${literal(ints(n))})`,
  parsed: n => `JSON.parse(${JSON.stringify(literal(ints(n)))})`,
  fractions: n => literal(fractions(n)),
  fractionsPushed: n => `(() => { const l = []; for (const e of ${literal(fractions(n))}) l.push(e); return l; })()`,
  mixed: n => literal(mixed(n)),
  holes: n => literal(holes(n)),
  int8: n => `new Int8Array(${literal(ints(n))})`,
  uint8: n => `new Uint8Array(${literal(ints(n))})`,
  clamped: n => `new Uint8ClampedArray(${literal(ints(n))})`,
  int16: n => `new Int16Array(${literal(ints(n))})`,
  uint16: n => `new Uint16Array(${literal(ints(n))})`,
  int32: n => `new Int32Array(${literal(ints(n))})`,
  uint32: n => `new Uint32Array(${literal(ints(n))})`,
  float32: n => `new Float32Array(${literal(fractions(n))})`,
  float64: n => `new Float64Array(${literal(fractions(n))})`,
};

const tests = [
  "a[i] === 100",
  "a[i] == 100",
  "!(a[i] !== 100)",
  "a[i] > 99",
  "a[i] >= 100",
  "a[i] < 3",
  'typeof a[i] === "number"',
  "i in a",
  "(a[i] & 1) === 0",
  "!a[i]",
  "a[i] === undefined",
  "a[i] === 100 || a[i] === 5",
  "a[i] === 100 && i > 2",
  "100 === a[i]",
  "a[i] !== 100",
  "Number.isInteger(a[i])",
];

const stored = ["3", "a[i] - 97", "0.5", '"x"', "-0", "undefined", "i", "a[i] * 2", "s"];
const others = ["7", "a[i] + 1", "1.25", "i + 1"];

// T is the test, V and W are what is stored, R is what reads.
type Reads = (element: string) => string;
const turns: Record<string, (T: string, V: string, W: string, R: Reads) => string> = {
  behindTest: (T, V, W, R) => `if (${T}) a[i] = ${V}; ${R("a[i]")}`,
  behindTestInBraces: (T, V, W, R) => `if (${T}) { a[i] = ${V}; } ${R("a[i]")}`,
  inOtherArm: (T, V, W, R) => `if (${T}) s += 1000; else a[i] = ${V}; ${R("a[i]")}`,
  inBothArms: (T, V, W, R) => `if (${T}) a[i] = ${V}; else a[i] = ${W}; ${R("a[i]")}`,
  keptBefore: (T, V, W, R) => `const before = a[i]; if (${T}) a[i] = ${V}; ${R("a[i]")} ${R("before")}`,
  storedInFront: (T, V, W, R) => `a[i] = ${W}; if (${T}) s += 1000; ${R("a[i]")}`,
  storedBehind: (T, V, W, R) => `if (${T}) s += 1000; ${R("a[i]")} a[i] = ${V}; ${R("a[i]")}`,
  atAnotherIndex: (T, V, W, R) => `if (${T}) a[j] = ${V}; ${R("a[i]")}`,
  readAtAnotherIndex: (T, V, W, R) => `if (${T}) a[i] = ${V}; ${R("a[j]")}`,
  oneAhead: (T, V, W, R) => `if (i + 1 < a.length) { if (${T}) a[i + 1] = ${V}; ${R("a[i + 1]")} }`,
  oneBack: (T, V, W, R) => `if (i > 0) { if (${T}) a[i - 1] = ${V}; ${R("a[i - 1]")} }`,
  twice: (T, V, W, R) => `if (${T}) { a[i] = ${V}; if (a[i] === 3) a[i] = ${W}; } ${R("a[i]")}`,
  conditional: (T, V, W, R) => `${R(`(${T} ? (a[i] = ${V}) : a[i])`)} ${R("a[i]")}`,
  byCases: (T, V, W, R) => `switch (a[i]) { case 100: a[i] = ${V}; break; case 5: a[i] = ${W}; } ${R("a[i]")}`,
  swapped: (T, V, W, R) =>
    `if (${T}) { const k = a.length - 1 - i; const t = a[i]; a[i] = a[k]; a[k] = t; } ${R("a[i]")}`,
  increased: (T, V, W, R) => `if (${T}) a[i]++; ${R("a[i]")}`,
  addedTo: (T, V, W, R) => `if (${T}) a[i] += 2; ${R("a[i]")}`,
  underAnotherName: (T, V, W, R) => `if (${T}) b[i] = ${V}; ${R("a[i]")}`,
  byAFunction: (T, V, W, R) => `if (${T}) put(a, i, ${V}); ${R("a[i]")}`,
  and: (T, V, W, R) => `${T} && (a[i] = ${V}); ${R("a[i]")}`,
  goesOn: (T, V, W, R) => `if (!(${T})) { ${R("a[i]")} continue; } a[i] = ${V}; ${R("a[i]")}`,
  twoTests: (T, V, W, R) => `if (${T}) a[i] = ${V}; if (a[i] === 3) a[i] = ${W}; ${R("a[i]")}`,
  shrinks: (T, V, W, R) => `if (${T} && Array.isArray(a) && a.length > i + 2) a.length = a.length - 1; ${R("a[i]")}`,
  popped: (T, V, W, R) => `if (${T} && Array.isArray(a) && a.length > i + 2) a.pop(); ${R("a[i]")}`,
  shifted: (T, V, W, R) => `if (${T} && Array.isArray(a) && a.length > i + 2) a.shift(); ${R("a[i]")}`,
  copied: (T, V, W, R) => `if (${T}) { a = a.slice(0); a[i] = ${V}; } ${R("a[i]")}`,
  filledThere: (T, V, W, R) => `if (${T}) a.fill(${V}, i, i + 1); ${R("a[i]")}`,
  removed: (T, V, W, R) => `if (${T} && Array.isArray(a)) delete a[i]; ${R("a[i]")}`,
  storedTwice: (T, V, W, R) => `if (${T}) { a[i] = ${W}; a[i] = ${V}; } ${R("a[i]")} ${R("a[i]")}`,
  threeReads: (T, V, W, R) =>
    `${R("a[i]")} if (${T}) a[i] = ${V}; ${R("a[i]")} if (a[i] === 3) a[i] = ${W}; ${R("a[i]")}`,
  inATry: (T, V, W, R) => `try { if (${T}) a[i] = ${V}; } finally { ${R("a[i]")} }`,
  twoLists: (T, V, W, R) => `if (${T}) c[i] = ${V}; ${R("a[i]")} ${R("c[i]")}`,
  lengthGrows: (T, V, W, R) => `if (${T} && a.length < 40 && Array.isArray(a)) a[a.length] = ${V}; ${R("a[i]")}`,
};

const reads: Reads[] = [
  e => `s += ${e};`,
  e => `out.push(${e});`,
  e => `s = (s * 31 + ${e}) | 0;`,
  e => `s = s + ${e} * 2;`,
  e => `if (${e} === 3) s += 10; else s += 1;`,
];

const loops: Record<string, (body: string) => string> = {
  up: body => `for (let i = 0; i < a.length; i++) { ${body} }`,
  upToKeptLength: body => `for (let i = 0, n = a.length; i < n; i++) { ${body} }`,
  whileLoop: body => `let i = -1; while (++i < a.length) { ${body} }`,
  doLoop: body => `let i = -1; do { i++; ${body} } while (i + 1 < a.length);`,
  down: body => `for (let i = a.length - 1; i >= 0; i--) { ${body} }`,
  besideForOf: body => `let i = -1; for (const element of a) { i++; ${body} }`,
  byTwo: body => `for (let i = 0; i < a.length; i += 2) { ${body} }`,
  twoRounds: body => `for (let round = 0; round < 2; round++) for (let i = 0; i < a.length; i++) { ${body} }`,
  fromOne: body => `for (let i = 1; i < a.length; i++) { ${body} }`,
};

const typeOf = (name: string) =>
  (
    ({
      int8: "Int8Array",
      uint8: "Uint8Array",
      clamped: "Uint8ClampedArray",
      int16: "Int16Array",
      uint16: "Uint16Array",
      int32: "Int32Array",
      uint32: "Uint32Array",
      float32: "Float32Array",
      float64: "Float64Array",
    }) as Record<string, string>
  )[name] ?? "number[]";

/** What a typed program leaves out: lists that hold more than numbers, the list joined to an empty literal (which TypeScript takes for a list of nothing), turns that a typed array has no method for, and values that are no numbers. */
const isTakenBy = (isTyped: boolean) => ({
  makers: Object.keys(makers).filter(name => !isTyped || !["holes", "mixed", "joined"].includes(name)),
  turns: Object.keys(turns).filter(name => !isTyped || !["lengthGrows", "shrinks", "popped", "shifted", "removed", "copied"].includes(name)), // prettier-ignore
  stored: stored.filter(value => !isTyped || !['"x"', "undefined"].includes(value)),
  tests: tests.filter(test => !isTyped || test !== "a[i] === undefined"),
});

const headOf = (
  typed: boolean,
) => `function put(list${typed ? ": any" : ""}, index${typed ? ": number" : ""}, value${typed ? ": any" : ""}) { list[index] = value; }
function word(value${typed ? ": unknown" : ""})${typed ? ": string" : ""} { return Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : Array.isArray(value) ? "[" + value.map(word).join(",") + "]" : String(value); }
function say(label${typed ? ": string" : ""}, answer${typed ? ": unknown" : ""}, list${typed ? ": ArrayLike<unknown>" : ""}) { const all${typed ? ": unknown[]" : ""} = []; for (let k = 0; k < list.length; k++) all.push(k in list ? list[k] : "hole"); console.log(label, word(answer), word(all)); }
`;

type Choice = { maker: string; turn: string; loop: string; test: string; value: string; other: string; read: Reads };

function functionOf(name: string, typed: boolean, { maker, turn, loop, test, value, other, read }: Choice) {
  const label = `${name} ${maker} ${turn} ${loop}`;
  const T = typeOf(maker);
  let text = `function ${name}(${typed ? `a: ${T}, b: ${T}, j: number` : "a, b, j"})${typed ? ": [number, number[]]" : ""} { let s = 0; const out${typed ? ": number[]" : ""} = []; const c = a.slice(0); ${loops[loop](turns[turn](test, value, other, read))} return [s, out]; }\n`;
  for (const n of [1, 3, 8, 21])
    text += `try { const list${typed ? `: ${T}` : ""} = ${makers[maker](n)}; say(${JSON.stringify(`${label} ${n}`)}, ${name}(list, list, ${n >> 1}), list); } catch (error) { say(${JSON.stringify(`${label} ${n}`)}, String(error).split(":")[0], []); }\n`;
  return text;
}

const drawn = (random: Random, isTyped: boolean) => ({
  test: random.pick(isTakenBy(isTyped).tests),
  value: random.pick(isTakenBy(isTyped).stored),
  other: random.pick(others),
  read: random.pick(reads),
});

export function generate(random: Random, isTyped: boolean): string {
  const taken = isTakenBy(isTyped);
  return (
    headOf(isTyped) +
    Array.from({ length: random.between(6, 24) }, (_, at) =>
      functionOf(`f${at}`, isTyped, {
        maker: random.pick(taken.makers),
        turn: random.pick(taken.turns),
        loop: random.pick(Object.keys(loops)),
        ...drawn(random, isTyped),
      }),
    ).join("") +
    (isTyped ? "export {};\n" : "")
  );
}

export const inOne = 24;
const rounds = 3;
const laidOut = [false, true].map(isTyped => {
  const taken = isTakenBy(isTyped);
  return {
    isTyped,
    crossed: Object.keys(loops).flatMap(loop => taken.makers.flatMap(maker => taken.turns.map(turn => ({ maker, turn, loop })))), // prettier-ignore
  };
});
export const programs = laidOut.reduce((sum, { crossed }) => sum + Math.ceil(crossed.length / inOne) * rounds, 0);

export function programOf(index: number): { file: string; text: string } {
  let at = index;
  const { isTyped, crossed } = laidOut.find(({ crossed }) => at < Math.ceil(crossed.length / inOne) * rounds || ((at -= Math.ceil(crossed.length / inOne) * rounds), false))!; // prettier-ignore
  const inOneRound = Math.ceil(crossed.length / inOne);
  const random = new Random(index + 1);
  const first = (at % inOneRound) * inOne;
  const plainest = { test: tests[0], value: stored[0], other: others[0], read: reads[0] };
  return {
    file: isTyped ? "main.ts" : "main.mjs",
    text:
      headOf(isTyped) +
      crossed
        .slice(first, first + inOne)
        .map((cross, n) =>
          functionOf(`f${n}`, isTyped, { ...cross, ...(at < inOneRound ? plainest : drawn(random, isTyped)) }),
        )
        .join("") +
      (isTyped ? "export {};\n" : ""),
  };
}
