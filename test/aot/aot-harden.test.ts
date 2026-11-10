// `bun build --compile --aot` takes --aot-harden=<names>, and Bun.build takes the same names as compile.aotHarden. None is on unless it is requested.
// proof-checks: what the compiler has proven about a value is tested where the value arrives, and no cell lives in a frame or is given back for reuse.
// How an element is reached is such a proof too: each access reads where the storage is, how long it is and what its indexing type is, and crashes if the compiler expected otherwise.
// ignore-told-ranges: the compiler tells no access that its index is in bounds. Each access tests its index in place, against the length that it reads there.
// Each name is tested against a fault that an --aot-testing switch injects into the compiler. With the name, the process crashes at the fault and says so.
// Without the name nothing crashes, except at what every build checks: no build trusts unchecked what comes out of code that the compiler does not see.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withoutCoreDump, withoutCrashReport } from "./harness/commands";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

// The compiler assumes that code that it does not see always returns undefined.
const falseProof = "--aot-testing=AssumeUnknownCallsReturnUndefined";
const program = `const unseen = new Function("return 7") as () => number;
function kindOf(value: unknown): string {
  return typeof value;
}
function total(): number {
  let sum = 0;
  function add(value: number) {
    sum += value;
  }
  add(1);
  add(2);
  return sum;
}
let sum = 0;
for (let turn = 0; turn < 6; turn++) sum += total();
console.log(kindOf(unseen()), sum);
`;
const printed = "number 18\n";
const stopAtProof =
  /^bun: internal AOT error: type check failed at \S+:\d+:\d+.*\n  (expected .+, )?found (int32|double) in /m;

// The compiler assumes that every index is in bounds of its array. The store lands past the last element, within the array's capacity, and the length does not change.
const falseBound = "--aot-testing=AssumeIndexesInBounds";
const storeBehindTheEnd = `const list: number[] = [];
for (let i = 0; i < 3; i++) list.push(i + 0.5);
function put(at: number, value: number) {
  if (at >= 0 && at < 5) list[at | 0] = value;
}
put(Number(process.argv.length > 99 ? 0 : 4), 9.5);
console.log(list.length);
`;
const stopAtBound = /^bun: internal AOT error: .+ check failed at \S+:\d+:\d+/m;
// The compiler moves every index that the library vouches for one position further, where the array's capacity reaches that far. The array has a capacity of eight and a length of five,
// so what the in-place sort of numbers reads and stores past the array's end is within that capacity.
const oneFurther = "--aot-testing=MisplaceUncheckedAccesses";
const sortedInPlace = `const list: number[] = [];
for (let i = 0; i < 8; i++) list.push(((i * 7) % 5) + 1);
list.length = 5;
list.sort((a, b) => a - b);
console.log(list.join(), list.length);
`;
// The same for reads alone. With the first switch, a read finds what a store has put one position further, so it never reaches a slot that nothing was stored into.
const readsFurther = "--aot-testing=MisplaceUncheckedReads";
const linesOfSort = readFileSync(
  join(import.meta.dir, "..", "..", "src", "aot", "prelude", "array-sort.ts"),
  "utf8",
).split("\n");
const stopAtWhatIsVouchedFor = (place: string) =>
  new RegExp(`^bun: internal AOT error: redundancy elimination check failed at \\S+:${place}:\\d+`, "m");
// A helper of the compiler has no file, so the report names the helper alone.
const stopInSpreadHelper = /^bun: internal AOT error: redundancy elimination check failed in (max|min)OfList$/m;
const stopInSortAt = (words: string) =>
  stopAtWhatIsVouchedFor(String(linesOfSort.findIndex(line => line.includes(words)) + 1));
const underAComparator = (list: string) => `let calls = 0;
const list: (number | undefined)[] = ${list};
list.sort((a, b) => (calls++, (a as number) - (b as number)));
console.log(list.join(), list.length, calls > 0);
`;
const vouchedFalsely: [string, string, string, string, RegExp][] = [
  [
    "a store of the program's own",
    oneFurther,
    `const list: number[] = [];
for (let i = 0; i < 8; i++) list.push(i + 0.25);
list.length = 5;
for (let i = 0; i < list.length; i++) list[i] = i + 0.5;
console.log(list.join(), list.length);
`,
    "0.5,1.5,2.5,3.5,4.5 5\n",
    stopAtWhatIsVouchedFor("4"),
  ],
  [
    "a run of elements copied out of the list",
    oneFurther,
    underAComparator("[3, undefined, 1, , 2, 5, undefined, 4]"),
    "1,2,3,4,5,,, 8 true\n",
    stopInSortAt("$tryCopyFilledElements(from, array, length)"),
  ],
  [
    "a run of elements copied back into the list",
    oneFurther,
    underAComparator("[3, , 1, 2, 9];\nlist[200000] = 0;\nlist.length = 7"),
    "1,2,3,9,,, 7 true\n",
    stopInSortAt("$tryPutElements(array, from, count)"),
  ],
  [
    "a read of a place that nothing was stored into",
    readsFurther,
    underAComparator("[3, , 1, 2, 9];\nlist[200000] = 0;\nlist.length = 7"),
    "1,2,3,9,,, 7 true\n",
    stopInSortAt("const inserted: T = $getOwnContiguousIndex<T>(from, i);"),
  ],
  // In a default build with the fault injected, the first of these two silently gives 5.
  [
    "the most of a list of whole numbers that is spread",
    oneFurther,
    `const list: number[] = [];
list.push(7, 3, 5, 1, 9, 9, 9, 9);
list.length = 4;
console.log(Math.max(...list), list.join(), list.length);
`,
    "7 7,3,5,1 4\n",
    stopInSpreadHelper,
  ],
  [
    "the least of a list of fractions that is spread",
    oneFurther,
    `const list: number[] = [];
list.push(7.5, 3.5, 5.5, 1.5, 0.5, 0.5, 0.5, 0.5);
list.length = 4;
console.log(Math.min(...list), list.join(), list.length);
`,
    "1.5 7.5,3.5,5.5,1.5 4\n",
    stopInSpreadHelper,
  ],
];
// The compiler assumes that the iterations of a loop leave the storage of arrays and of typed arrays, and so their lengths, as they were before the loop.
// What an iteration reads of them is hoisted: it is read once, in the preheader.
// Each program stays within memory that is still there: it reads no element, or it reads one at its old location, and it stores nothing.
const asInFront = "--aot-testing=AssumeInvariantArrayStorage";
const movedInTurns = [
  [
    "the length of a list that the turns shorten",
    `function walk(list: number[]): number {
  let turns = 0;
  for (let i = 0; i < list.length; i++) {
    list.pop();
    turns++;
  }
  return turns;
}
const list: number[] = [];
for (let i = 0; i < 8; i++) list.push(i + 0.5);
console.log(walk(list), list.length);
`,
    "4 4\n",
    "8 0\n",
  ],
  // The pushes are written out one by one: with the fault injected, a loop that is bounded by the length would never end.
  [
    "the storage of a list that a turn's pushes move",
    `const turns: number = JSON.parse("4");
function sum(list: number[], turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 2) {
      list.push(9.5); list.push(9.5); list.push(9.5); list.push(9.5); list.push(9.5); list.push(9.5);
      list.push(9.5); list.push(9.5); list.push(9.5); list.push(9.5); list.push(9.5); list.push(9.5);
      list.fill(9.5);
    }
    total += list[i]!;
  }
  return total;
}
const list = [1.5, 2.5, 3.5, 4.5];
console.log(sum(list, turns), list.length);
`,
    "23 16\n",
    "12 16\n",
  ],
  [
    "the length of a view whose buffer a turn makes smaller",
    `const turns: number = JSON.parse("16");
const buffer = new ArrayBuffer(8 * 16, { maxByteLength: 8 * 64 });
const view = new Float64Array(buffer);
function shrink(turn: number) {
  let work = 0;
  for (let k = 0; k < 2; k++) work = (work + k) | 0;
  if (turn === 3 + work) buffer.resize(8 * 6);
}
function sum(view: Float64Array, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    shrink(i);
    const element = view[i];
    total += element === undefined ? 100 : element;
  }
  return total;
}
for (let i = 0; i < 16; i++) view[i] = i + 1;
console.log(sum(view, turns), view.length);
`,
    "1021 6\n",
    "136 6\n",
  ],
  // The program keeps the buffer that received the bytes.
  [
    "the vector of a view whose buffer a turn hands away",
    `const turns: number = JSON.parse("16");
const buffer = new ArrayBuffer(8 * 16);
const view = new Float64Array(buffer);
const kept: ArrayBuffer[] = [];
function handAway(turn: number) {
  let work = 0;
  for (let k = 0; k < 2; k++) work = (work + k) | 0;
  if (turn === 3 + work) kept.push(buffer.transfer());
}
function sum(view: Float64Array, turns: number): number {
  let total = 0;
  for (let i = 0; i < turns; i++) {
    handAway(i);
    const element = view[i];
    total += element === undefined ? 100 : element;
  }
  return total;
}
for (let i = 0; i < 16; i++) view[i] = i + 1;
console.log(sum(view, turns), view.length, kept.length);
`,
    "1210 0 1\n",
    "136 0 1\n",
  ],
] as const;
const stopAtWhatWasReadInFront = /^bun: internal AOT error: redundancy elimination check failed at \S+:\d+:\d+/m;

const countedLoops = `function sum(values: Float64Array): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}
function sumOfList(values: number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i++) total += values[i];
  return total;
}
function spacesIn(text: string): number {
  let spaces = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 32) spaces++;
  return spaces;
}
const values = new Float64Array(1000).fill(1.5);
const list: number[] = [];
for (let i = 0; i < 1000; i++) list.push(i + 0.5);
let total = 0;
for (let turn = 0; turn < 100; turn++) total += sum(values) + sumOfList(list) + spacesIn("a b c " + turn);
console.log(total);
`;

// Short and long arrays of each indexing type. They are sorted by insertion in place, and by runs in an array of the library's own.
const sorts = `const integers: number[] = [];
const fractions: number[] = [];
const words: string[] = [];
for (let i = 0; i < 300; i++) {
  integers.push((i * 7919) % 311);
  fractions.push(((i * 7919) % 311) + 0.5);
  words.push("w" + ((i * 7919) % 311));
}
const few = [5, 3, 9, 1];
const fewFractions = [5.5, 3.5, 9.5, 1.5];
const withGaps = [3, , 1, undefined, 2];
few.sort((a, b) => a - b);
fewFractions.sort((a, b) => b - a);
integers.sort((a, b) => a - b);
fractions.sort((a, b) => b - a);
words.sort();
withGaps.sort();
console.log(few.join(), fewFractions.join(), integers[0], integers[299], fractions[0], fractions[299], words[0], words[299]);
console.log(withGaps.length, 4 in withGaps, withGaps.join(), integers.toSorted((a, b) => b - a)[0], [].sort().length, [1].sort()[0]);
`;

// Accesses wider than a byte, and the three positions of a copy, at offsets that the compiler knows are not negative.
const offsetsIntoViews = `function sumOf(view: DataView): number {
  let total = 0;
  for (let i = 0; i < 15; i++) total += view.getInt32(i * 4, true);
  return total;
}
function fill(view: DataView): void {
  for (let i = 0; i < 15; i++) view.setInt32(i * 4, i * 3, true);
}
function sumOfBytes(bytes: Buffer): number {
  let total = 0;
  for (let i = 0; i < 15; i++) total += bytes.readUInt16LE(i * 2) + bytes.writeInt32BE(i, i * 4);
  return total;
}
function copied(from: Buffer, to: Buffer): number {
  let total = 0;
  for (let i = 0; i < 8; i++) total += from.copy(to, i * 2, i, i + 4);
  return total;
}
const view = new DataView(new ArrayBuffer(64));
const bytes = Buffer.alloc(64, 3);
const other = Buffer.alloc(32);
let total = 0;
for (let turn = 0; turn < 50; turn++) {
  fill(view);
  total += sumOf(view) + sumOfBytes(bytes) + copied(bytes, other);
}
console.log(total, other.toString("hex"));
`;

// Substrings that are never allocated: the code units are parsed, converted, compared or appended straight out of the string itself.
const piecesOfTexts = `function parsed(text: string): number {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += parseInt(text.slice(i, i + 2), 10) + Number(text.substring(i + 1, i));
  return sum;
}
function found(text: string): number {
  let count = 0;
  for (let i = -3; i < 12; i++) if (text.slice(i, i + 2) === "34" || text.substr(i, 3) === "890") count++;
  return count;
}
function joined(text: string, pieces: number): string {
  let out = "";
  for (let i = 0; i < pieces; i++) {
    out += text.substring(i, i + 3);
    out += text.slice(-i - 2, -i);
    out += ",";
  }
  return out;
}
const text = "1234567890".repeat(process.argv.length > 99 ? 2 : 1);
let sum = 0;
for (let turn = 0; turn < 30; turn++) sum += parsed(text) + found(text) + joined(text, 12).length;
console.log(sum, joined(text, 12), joined("", 2), found("34"), parsed("7"));
`;

// The code generator evaluates `<` of two integers as `<=`. So -1 passes `-1 < at`, after which the compiler knows that `at` is not negative.
const falseRange = "--aot-testing=TreatEqualIntegersAsLess";
const readsAtFalseRanges = {
  "a DataView": `function word(view: DataView, from: number): number {
  let sum = 0;
  for (let i = 0; i < 2; i++) {
    const at = (from | 0) + i;
    if (-1 < at) sum += view.getInt32(at, true);
  }
  return sum;
}
console.log(word(new DataView(new ArrayBuffer(16)), process.argv.length > 99 ? 0 : -1));
`,
  "a Buffer": `function word(bytes: Buffer, from: number): number {
  let sum = 0;
  for (let i = 0; i < 2; i++) {
    const at = (from | 0) + i;
    if (-1 < at) sum += bytes.readInt32LE(at);
  }
  return sum;
}
console.log(word(Buffer.alloc(16), process.argv.length > 99 ? 0 : -1));
`,
  "a piece of a text": `function parsed(text: string, from: number): number {
  let sum = 0;
  for (let i = 0; i < 2; i++) {
    const at = (from | 0) + i;
    if (-1 < at) sum += parseInt(text.slice(at, at + 2), 10);
  }
  return sum;
}
console.log(parsed("1234567890".repeat(process.argv.length > 99 ? 2 : 1), process.argv.length > 99 ? 0 : -1));
`,
  "a text that is searched": `function found(text: string, from: number): number {
  let sum = 0;
  for (let i = 0; i < 2; i++) {
    const at = (from | 0) + i;
    if (-1 < at) sum += text.indexOf("3", at);
  }
  return sum;
}
console.log(found("1234567890".repeat(process.argv.length > 99 ? 2 : 1), process.argv.length > 99 ? 0 : -1));
`,
};

// A shape check that rejects marked objects accepts them instead. A field that was deleted out of the compiler's sight is then read as if its slot were filled.
const passesOverMarks = "--aot-testing=IgnoreMarksInShapeChecks";
const readsFieldTakenAway = `class Badge { text: string; constructor(text: string) { this.text = text; } }
class Member {
  rank: number; active: boolean; name: string; badge: Badge; friend: Member | undefined; score: number; done: boolean;
  constructor(i: number) { this.rank = i & 7; this.active = (i & 1) === 1; this.name = "m" + i; this.badge = new Badge("b" + i); this.friend = undefined; this.score = i & 3; this.done = false; }
}
function ranks(list: Member[]): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i].rank; return sum; }
const strip: (o: object, k: string) => boolean = (Reflect as any)[JSON.parse('"deleteProperty"')];
const shelf: any[] = [ranks, (i: number) => new Member(i)];
const at: number[] = JSON.parse("[0, 1]");
const all = [0, 1, 2, 3, 4, 5, 6, 7].map(i => shelf[at[1]](i));
console.log(shelf[at[0]](all));
strip(all[5], "rank");
console.log(shelf[at[0]](all));
`;

// The same for a slot that holds a 32-bit reference. `goesWrong`: without the hardening, the injected fault shows in what the program prints or in how it exits.
const takesAway = `const strip: (o: object, k: string) => boolean = (Reflect as any)[JSON.parse('"deleteProperty"')];
const at: number[] = JSON.parse("[0, 1]");
class Badge { text: string; constructor(text: string) { this.text = text; } }
`;
const readsReferenceTakenAway = {
  "which some members of a union have": {
    goesWrong: true,
    printsFirst: "64\n",
    source: `${takesAway}interface Core { mark: number }
interface Bare { kind: number; size: number }
interface Full { kind: number; size: number; core: Core }
function fill(count: number): (Bare | Full)[] { const rows: (Bare | Full)[] = []; for (let i = 0; i < count; i++) rows.push(i & 1 ? { kind: 1, size: i, core: { mark: i } } : { kind: 0, size: i }); return rows; }
function tally(rows: (Bare | Full)[]): number { let sum = 0; for (let i = 0; i < rows.length; i++) { const core = (rows[i] as Full).core; if (core !== undefined) sum += core.mark; } return sum; }
const shelf: any[] = [tally, fill];
const rows = shelf[at[1]](16);
console.log(shelf[at[0]](rows));
strip(rows[5], "core");
console.log(shelf[at[0]](rows));
`,
  },
  "which may be null": {
    goesWrong: true,
    printsFirst: "true false true\n",
    source: `${takesAway}class Member {
  rank: number; active: boolean; name: string; badge: Badge; before: Member | null; score: number; done: boolean;
  constructor(i: number) { this.rank = i & 7; this.active = (i & 1) === 1; this.name = "m" + i; this.badge = new Badge("b" + i); this.before = null; this.score = i & 3; this.done = false; }
}
function ends(member: Member): string { return (member.before === null) + " " + (member.before === undefined) + " " + (member.before == null); }
const shelf: any[] = [ends, (i: number) => new Member(i)];
const sound = shelf[at[1]](2), hurt = shelf[at[1]](4);
strip(hurt, "before");
console.log(shelf[at[0]](sound));
console.log(shelf[at[0]](hurt));
`,
  },
  "which is asked for its truth": {
    goesWrong: false,
    printsFirst: "friend badge\n",
    source: `${takesAway}class Member {
  rank: number; active: boolean; name: string; badge: Badge; friend: Member | undefined; score: number; done: boolean;
  constructor(i: number) { this.rank = i & 7; this.active = (i & 1) === 1; this.name = "m" + i; this.badge = new Badge("b" + i); this.friend = undefined; this.score = i & 3; this.done = false; }
}
function truths(member: Member): string { return (member.friend ? "friend" : "alone") + " " + (member.badge ? "badge" : "bare"); }
const shelf: any[] = [truths, (i: number) => new Member(i)];
const hurt = shelf[at[1]](4);
hurt.friend = shelf[at[1]](7);
console.log(shelf[at[0]](hurt));
strip(hurt, "friend");
strip(hurt, "badge");
console.log(shelf[at[0]](hurt));
`,
  },
};

// The name of the executable that `--outfile built` writes.
const built = isWindows ? "built.exe" : "built";

const commandLine = (flags: string[]) => [
  bunExe(),
  "build",
  "--compile",
  "--aot",
  ...flags,
  "program.ts",
  "--outfile",
  "built",
];

async function build(cwd: string, flags: string[]) {
  const { stdout, stderr, exitCode } = await spawned(commandLine(flags), cwd);
  expect(stderr).not.toContain("error:");
  expect(exitCode).toBe(0);
  return stdout + stderr;
}

const runBuilt = (cwd: string) =>
  spawned(withoutCoreDump([join(cwd, built)]), cwd, { ...bunEnv, ...withoutCrashReport });

const runPlain = (cwd: string) => spawned([bunExe(), "program.ts"], cwd, bunEnv);

// Each name appears exactly once in what --explain=statistics prints, whatever its count is.
async function countsOf(source: string, flags: string[]) {
  using folder = tempDir("aot-harden", { "program.ts": source });
  const said = await build(String(folder), ["--explain=statistics", ...flags]);
  const names = ["AllocateInFramesChanges", "ClosuresInFrames", "RangeChecksRemoved", "KnownInductionsUsed"] as const;
  return Object.fromEntries(
    names.map(name => {
      const lines = Array.from(said.matchAll(new RegExp(`^${name} (\\d+)$`, "gm")), ([, count]) => Number(count));
      expect({ name, lines: lines.length }).toEqual({ name, lines: 1 });
      return [name, lines[0]];
    }),
  ) as Record<(typeof names)[number], number>;
}

describe.concurrent("--aot-harden=proof-checks", () => {
  test("stops the program at a proof that is false", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    await build(String(folder), ["--aot-harden=proof-checks", falseProof]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopAtProof);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("leaves alone a program whose proofs hold", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    await build(String(folder), ["--aot-harden=proof-checks"]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  }, 120_000);

  test("what unseen code answers is asked in every build, so that lie is met without it too", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    await build(String(folder), [falseProof]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopAtProof);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("leaves every cell to the collector", async () => {
    // The scope of total() is given back when total() ends, and the next call reuses it.
    expect((await countsOf(program, [])).AllocateInFramesChanges).toBeGreaterThan(0);
    expect(await countsOf(program, ["--aot-harden=proof-checks"])).toMatchObject({
      AllocateInFramesChanges: 0,
      ClosuresInFrames: 0,
    });
  }, 120_000);

  test("stops the program at a bound that is false", async () => {
    using folder = tempDir("aot-harden", { "program.ts": storeBehindTheEnd });
    await build(String(folder), ["--aot-harden=proof-checks", falseBound]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopAtBound);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test.each(movedInTurns)(
    "stops the program at %s, taken to be as in front of the loop",
    async (_, source) => {
      using folder = tempDir("aot-harden", { "program.ts": source });
      await build(String(folder), ["--aot-harden=proof-checks", asInFront]);
      const { stdout, stderr, exitCode } = await runBuilt(String(folder));
      expect(stderr).toMatch(stopAtWhatWasReadInFront);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    },
    120_000,
  );

  test("stops the program at a position that the library vouches for and that is false", async () => {
    using folder = tempDir("aot-harden", { "program.ts": sortedInPlace });
    await build(String(folder), ["--aot-harden=proof-checks", oneFurther]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopInSortAt("const value: number = $getOwnInt32Index(array, index);"));
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test.each(vouchedFalsely)(
    "stops the program at %s that is vouched for falsely, and leaves the honest program alone",
    async (_, lie, source, honest, stop) => {
      using folder = tempDir("aot-harden", { "program.ts": source });
      await build(String(folder), ["--aot-harden=proof-checks"]);
      expect(await runBuilt(String(folder))).toEqual({ stdout: honest, stderr: "", exitCode: 0 });
      await build(String(folder), ["--aot-harden=proof-checks", lie]);
      const { stdout, stderr, exitCode } = await runBuilt(String(folder));
      expect(stderr).toMatch(stop);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    },
    120_000,
  );

  test("leaves no access without its test", async () => {
    expect((await countsOf(countedLoops, [])).RangeChecksRemoved).toBeGreaterThan(0);
    expect((await countsOf(countedLoops, ["--aot-harden=proof-checks"])).RangeChecksRemoved).toBe(0);
  }, 120_000);

  test("gives the same answers in loops over lists, views and texts", async () => {
    using hardened = tempDir("aot-harden", { "program.ts": countedLoops });
    await build(String(hardened), ["--aot-harden=proof-checks"]);
    const expected = await runPlain(String(hardened));
    expect(expected.exitCode).toBe(0);
    expect(await runBuilt(String(hardened))).toEqual(expected);
  }, 120_000);

  test("stops at no position that the library's sort hands over", async () => {
    using hardened = tempDir("aot-harden", { "program.ts": sorts });
    await build(String(hardened), ["--aot-harden=proof-checks"]);
    expect(await runBuilt(String(hardened))).toEqual({
      stdout: "1,3,5,9 9.5,5.5,3.5,1.5 0 310 310.5 0.5 w0 w99\n5 false 1,2,3,, 310 0 1\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test("the build names it as the flag does, and not as a developer option", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    const said = await build(String(folder), ["--aot-harden=proof-checks,ignore-told-ranges"]);
    expect(said).toMatch(/^ +harden  proof-checks, ignore-told-ranges$/m);
    expect(said).not.toContain("developer options");
    expect(said).not.toContain("--aot-testing");
  }, 120_000);

  test("a developer option beside it is still listed", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    const flags = ["--aot-harden=proof-checks", "--aot-testing=CheckProofsAtRunTime", "--aot-check=Validate"];
    expect((await build(String(folder), flags)).split("\n")).toContain(
      "Built with developer options: --aot-check=Validate --aot-testing=CheckProofsAtRunTime",
    );
  }, 120_000);
});

// An index can be in bounds on the grounds that it is below a sum that has tested below a length. The compiler passes those grounds on without running their prover,
// so the store that is bounded by another array's length lands past the end of its own array.
// The injected fault is never run on its own: it writes to memory that is no part of the array.
const unprovenGround = "--aot-testing=SkipBoundsProof";
const storedBelowSums = join(import.meta.dir, "parallel", "a-position-below-a-sum-that-has-passed-below-the-length");
const storesByAnotherListsLength = [
  "a-store-by-another-lists-length-into-fractions.cjs",
  "a-store-by-another-lists-length-into-whole-numbers.cjs",
].flatMap(name =>
  ["--aot-harden=proof-checks", "--aot-harden=ignore-told-ranges", "--aot-testing=CheckBoundsInEmittersOnly"].map(
    word => [name, word] as const,
  ),
);

describe.concurrent("a ground that is handed over unproven", () => {
  test.each(storesByAnotherListsLength)(
    "%s stops by name under %s",
    async (name, word) => {
      using folder = tempDir("aot-harden", { "program.cjs": readFileSync(join(storedBelowSums, name), "utf8") });
      const built = await spawned(
        [bunExe(), "build", "--compile", "--aot", word, unprovenGround, "program.cjs", "--outfile", "built"],
        String(folder),
      );
      expect(built.stderr).not.toContain("error:");
      expect(built.exitCode).toBe(0);
      const { stderr, exitCode } = await runBuilt(String(folder));
      expect(stderr).toMatch(/^bun: internal AOT error: .+ check failed at \S+:\d+:\d+/m);
      expect(exitCode).not.toBe(0);
    },
    120_000,
  );
});

describe.concurrent("--aot-harden=ignore-told-ranges", () => {
  test("stops the program at a bound that is false", async () => {
    using folder = tempDir("aot-harden", { "program.ts": storeBehindTheEnd });
    await build(String(folder), ["--aot-harden=ignore-told-ranges", falseBound]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopAtBound);
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test("stops the program at a position that the library vouches for and that is false", async () => {
    using folder = tempDir("aot-harden", { "program.ts": sortedInPlace });
    await build(String(folder), ["--aot-harden=ignore-told-ranges", oneFurther]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect(stderr).toMatch(stopInSortAt("const value: number = $getOwnInt32Index(array, index);"));
    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test.each(vouchedFalsely)(
    "stops the program at %s that is vouched for falsely, and leaves the honest program alone",
    async (_, lie, source, honest, stop) => {
      using folder = tempDir("aot-harden", { "program.ts": source });
      await build(String(folder), ["--aot-harden=ignore-told-ranges"]);
      expect(await runBuilt(String(folder))).toEqual({ stdout: honest, stderr: "", exitCode: 0 });
      await build(String(folder), ["--aot-harden=ignore-told-ranges", lie]);
      const { stdout, stderr, exitCode } = await runBuilt(String(folder));
      expect(stderr).toMatch(stop);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    },
    120_000,
  );

  test("leaves alone a program whose vouched positions hold", async () => {
    using folder = tempDir("aot-harden", { "program.ts": sortedInPlace });
    await build(String(folder), ["--aot-harden=ignore-told-ranges"]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "1,2,3,4,5 5\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test("does not hold a vouched position without being asked for", async () => {
    using folder = tempDir("aot-harden", { "program.ts": sortedInPlace });
    await build(String(folder), [oneFurther]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(stdout).toEndWith(" 5\n");
    expect(stdout).not.toBe("1,2,3,4,5 5\n");
  }, 120_000);

  test("leaves alone a program whose bounds hold", async () => {
    using folder = tempDir("aot-harden", { "program.ts": storeBehindTheEnd });
    await build(String(folder), ["--aot-harden=ignore-told-ranges"]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "5\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test("is not on without being asked for", async () => {
    using folder = tempDir("aot-harden", { "program.ts": storeBehindTheEnd });
    await build(String(folder), [falseBound]);
    const { stdout, stderr, exitCode } = await runBuilt(String(folder));
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "3\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test.each(movedInTurns)(
    "stops the program at %s, taken to be as in front of the loop",
    async (_, source) => {
      using folder = tempDir("aot-harden", { "program.ts": source });
      await build(String(folder), ["--aot-harden=ignore-told-ranges", asInFront]);
      const { stdout, stderr, exitCode } = await runBuilt(String(folder));
      expect(stderr).toMatch(stopAtWhatWasReadInFront);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    },
    120_000,
  );

  test.each(movedInTurns)(
    "is not on without being asked for: %s, taken to be as in front of the loop",
    async (_, source, printed, printedUnderTheLie) => {
      using folder = tempDir("aot-harden", { "program.ts": source });
      expect(await runPlain(String(folder))).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
      await build(String(folder), [asInFront]);
      expect(await runBuilt(String(folder))).toEqual({ stdout: printedUnderTheLie, stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test("leaves no access without its test, in the loops that a plain build has", async () => {
    const { KnownInductionsUsed } = await countsOf(countedLoops, []);
    expect(KnownInductionsUsed).toBeGreaterThan(0);
    const hardened = { AllocateInFramesChanges: 0, ClosuresInFrames: 0, RangeChecksRemoved: 0, KnownInductionsUsed };
    expect(await countsOf(countedLoops, ["--aot-harden=proof-checks,ignore-told-ranges"])).toEqual(hardened);
    expect(await countsOf(countedLoops, ["--aot-harden=ignore-told-ranges", "--aot-harden=proof-checks"])).toEqual(
      hardened,
    );
  }, 120_000);

  test("gives the same answers", async () => {
    using hardened = tempDir("aot-harden", { "program.ts": countedLoops });
    await build(String(hardened), ["--aot-harden=proof-checks,ignore-told-ranges"]);
    const expected = await runPlain(String(hardened));
    expect(expected.exitCode).toBe(0);
    expect(await runBuilt(String(hardened))).toEqual(expected);
  }, 120_000);

  test.each([["ignore-told-ranges"], ["proof-checks"], ["proof-checks,ignore-told-ranges"]])(
    "tests an offset into a DataView or a Buffer from below too: %s",
    async names => {
      expect((await countsOf(offsetsIntoViews, [])).RangeChecksRemoved).toBeGreaterThan(0);
      expect((await countsOf(offsetsIntoViews, [`--aot-harden=${names}`])).RangeChecksRemoved).toBe(0);
      using hardened = tempDir("aot-harden", { "program.ts": offsetsIntoViews });
      await build(String(hardened), [`--aot-harden=${names}`]);
      const expected = await runPlain(String(hardened));
      expect(expected.exitCode).toBe(0);
      expect(await runBuilt(String(hardened))).toEqual(expected);
    },
    120_000,
  );

  test.each(Object.entries(readsAtFalseRanges))(
    "stops the program where %s is read at a position whose range is false",
    async (_, source) => {
      using folder = tempDir("aot-harden", { "program.ts": source });
      await build(String(folder), ["--aot-harden=ignore-told-ranges", falseRange]);
      const { stdout, stderr, exitCode } = await runBuilt(String(folder));
      expect(stderr).toMatch(stopAtBound);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    },
    120_000,
  );

  test.each([[[]], [["--aot-harden=proof-checks"]]])(
    "reads a field that was taken away out of sight as plain Bun does: %j",
    async flags => {
      using folder = tempDir("aot-harden", { "program.ts": readsFieldTakenAway });
      await build(String(folder), flags);
      expect(await runBuilt(String(folder))).toEqual({ stdout: "28\nNaN\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test("proof-checks stops the program by name where a slot that is told filled is empty", async () => {
    using unhardened = tempDir("aot-harden", { "program.ts": readsFieldTakenAway });
    await build(String(unhardened), [passesOverMarks]);
    expect((await runBuilt(String(unhardened))).stdout).not.toBe("28\nNaN\n");

    using hardened = tempDir("aot-harden", { "program.ts": readsFieldTakenAway });
    await build(String(hardened), ["--aot-harden=proof-checks", passesOverMarks]);
    const { stdout, stderr, exitCode } = await runBuilt(String(hardened));
    expect(stderr).toContain(" in a property");
    expect(stdout).toBe("28\n");
    expect(exitCode).not.toBe(0);
  }, 120_000);

  test.each(Object.entries(readsReferenceTakenAway))(
    "proof-checks stops the program by name where a slot that is told filled has lost a reference %s",
    async (_, { goesWrong, printsFirst, source }) => {
      using sound = tempDir("aot-harden", { "program.ts": source });
      await build(String(sound), ["--aot-harden=proof-checks"]);
      const expected = await runPlain(String(sound));
      expect(expected.exitCode).toBe(0);
      expect(await runBuilt(String(sound))).toEqual(expected);

      using unhardened = tempDir("aot-harden", { "program.ts": source });
      await build(String(unhardened), [passesOverMarks]);
      expect((await runBuilt(String(unhardened))).stdout !== expected.stdout).toBe(goesWrong);

      using hardened = tempDir("aot-harden", { "program.ts": source });
      await build(String(hardened), ["--aot-harden=proof-checks", passesOverMarks]);
      const { stdout, stderr, exitCode } = await runBuilt(String(hardened));
      expect(stderr).toContain(" in a property");
      expect(stdout).toBe(printsFirst);
      expect(exitCode).not.toBe(0);
    },
    120_000,
  );

  test.each([["ignore-told-ranges"], ["proof-checks"], ["proof-checks,ignore-told-ranges"]])(
    "stops at no piece of a text that is read in place: %s",
    async names => {
      using hardened = tempDir("aot-harden", { "program.ts": piecesOfTexts });
      await build(String(hardened), [`--aot-harden=${names}`]);
      const expected = await runPlain(String(hardened));
      expect(expected.exitCode).toBe(0);
      expect(await runBuilt(String(hardened))).toEqual(expected);
    },
    120_000,
  );

  test("stops at no position that the library's sort hands over", async () => {
    using hardened = tempDir("aot-harden", { "program.ts": sorts });
    await build(String(hardened), ["--aot-harden=proof-checks,ignore-told-ranges"]);
    expect(await runBuilt(String(hardened))).toEqual({
      stdout: "1,3,5,9 9.5,5.5,3.5,1.5 0 310 310.5 0.5 w0 w99\n5 false 1,2,3,, 310 0 1\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);
});

describe.concurrent("compile.aotHarden", () => {
  async function buildByCall(folder: string, members: string) {
    writeFileSync(
      join(folder, "build.ts"),
      `try {
  await Bun.build({ entrypoints: ["./program.ts"], compile: { outfile: "./built", aot: true, ${members} } as any });
} catch (error) {
  console.log((error as Error).message);
}
`,
    );
    return spawned([bunExe(), "build.ts"], folder);
  }

  const hashOf = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

  test.each([
    ["a name in a list", `aotHarden: ["proof-checks"]`],
    ["a name as a string", `aotHarden: "proof-checks"`],
  ])(
    "builds what the command line builds from %s",
    async (_, members) => {
      using byCommand = tempDir("aot-harden", { "program.ts": program });
      using byCall = tempDir("aot-harden", { "program.ts": program });
      using byDefault = tempDir("aot-harden", { "program.ts": program });
      await build(String(byCommand), ["--aot-harden=proof-checks"]);
      await build(String(byDefault), []);
      const { stdout, exitCode } = await buildByCall(String(byCall), members);
      expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });
      const hashByCall = hashOf(join(String(byCall), built));
      expect(hashByCall).toBe(hashOf(join(String(byCommand), built)));
      expect(hashByCall).not.toBe(hashOf(join(String(byDefault), built)));
    },
    120_000,
  );

  test("takes the two names as the command line does", async () => {
    using byCommand = tempDir("aot-harden", { "program.ts": program });
    using byCall = tempDir("aot-harden", { "program.ts": program });
    await build(String(byCommand), ["--aot-harden=proof-checks,ignore-told-ranges"]);
    const { stdout, exitCode } = await buildByCall(String(byCall), `aotHarden: ["proof-checks", "ignore-told-ranges"]`);
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });
    expect(hashOf(join(String(byCall), built))).toBe(hashOf(join(String(byCommand), built)));
  }, 120_000);

  test.each([
    [`["nonsense"]`, "nonsense"],
    [`"proof-checks,nonsense"`, "nonsense"],
    [`"proof-checks,"`, ""],
  ])(
    "throws on a name that it doesn't know: %s",
    async (value, name) => {
      using folder = tempDir("aot-harden", { "program.ts": program });
      const { stdout } = await buildByCall(String(folder), `aotHarden: ${value}`);
      expect(stdout).toContain(
        `Invalid value for compile.aotHarden: "${name}". Must be a list of these names: proof-checks, ignore-told-ranges`,
      );
    },
    120_000,
  );

  test.each([["[7]"], ["7"]])(
    "throws on what isn't a name: %s",
    async value => {
      using folder = tempDir("aot-harden", { "program.ts": program });
      const { stdout } = await buildByCall(String(folder), `aotHarden: ${value}`);
      expect(stdout).toStartWith(`The "compile.aotHarden" property must be of type string or array of strings`);
    },
    120_000,
  );

  test.each([
    [
      "aotHarden",
      `aotHarden: ["proof-checks"]`,
      "Hardened with proof-checks",
      ["--aot-testing=CheckProofsAtRunTime", "--aot-testing=DisableFrameCells"],
    ],
    [
      "aotTesting",
      `aotTesting: ["AssumeUnknownCallsReturnUndefined"]`,
      "Built with developer options: --aot-testing=AssumeUnknownCallsReturnUndefined",
      ["--aot-testing=AssumeUnknownCallsReturnUndefined"],
    ],
  ])(
    "names in its logs and in the statistics what it built with: %s",
    async (_, members, note, words) => {
      using folder = tempDir("aot-harden", { "program.ts": program });
      writeFileSync(
        join(String(folder), "build.ts"),
        `const result = await Bun.build({ entrypoints: ["./program.ts"], compile: { outfile: "./built", aot: true, aotExplain: "statistics", ${members} } as any });
for (const log of result.logs) if (/developer option|^Hardened/.test(log.message)) console.log(log.level + ": " + log.message);
`,
      );
      const { stdout, exitCode } = await spawned([bunExe(), "build.ts"], String(folder));
      expect({ lines: stdout.trimEnd().split("\n").sort(), exitCode }).toEqual({
        lines: [`note: ${note}`, ...words.map(word => `verbose: developer option ${word}`)].sort(),
        exitCode: 0,
      });
    },
    120_000,
  );

  test("names nothing where it was asked for nothing", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    writeFileSync(
      join(String(folder), "build.ts"),
      `const result = await Bun.build({ entrypoints: ["./program.ts"], compile: { outfile: "./built", aot: true, aotExplain: "statistics" } as any });
console.log(result.logs.filter(log => /developer option/.test(log.message)).length);
`,
    );
    const { stdout, exitCode } = await spawned([bunExe(), "build.ts"], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "0\n", exitCode: 0 });
  }, 120_000);

  test("requires compile.aot", async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    writeFileSync(
      join(String(folder), "build.ts"),
      `try {
  await Bun.build({ entrypoints: ["./program.ts"], compile: { outfile: "./built", aotHarden: "proof-checks" } as any });
} catch (error) {
  console.log((error as Error).message);
}
`,
    );
    const { stdout } = await spawned([bunExe(), "build.ts"], String(folder));
    expect(stdout).toContain("compile.aotHarden requires compile.aot: true");
  }, 120_000);
});

test.concurrent(
  "--aot-harden refuses a name that it doesn't know",
  async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    const { stderr, exitCode } = await spawned(commandLine(["--aot-harden=nonsense"]), String(folder));
    expect(stderr).toContain(
      `Invalid value for --aot-harden: "nonsense". Must be a list of these names: proof-checks, ignore-told-ranges`,
    );
    expect(exitCode).not.toBe(0);
  },
  120_000,
);

test.concurrent(
  "--aot-harden requires --aot",
  async () => {
    using folder = tempDir("aot-harden", { "program.ts": program });
    const { stderr, exitCode } = await spawned(
      [bunExe(), "build", "--compile", "--aot-harden=proof-checks", "program.ts", "--outfile", "built"],
      String(folder),
    );
    expect(stderr).toContain("--aot-harden requires --aot");
    expect(exitCode).not.toBe(0);
  },
  120_000,
);
