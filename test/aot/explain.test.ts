// `bun compile --explain`, `bun check --aot --explain` and `aotExplain` give one report. Its text, its JSON and its closing
// lines say the same, an entry stands at the line that uses an untyped value and names a cause only where the compiled code
// shows one, and asking for it changes nothing of what is built. The wording of single entries is tested beside the code
// that writes it: src/aot/report.
import { expect } from "bun:test";
import { mkdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { slot, spawned, withoutDebugInformation } from "./harness/commands";
import { describe, test } from "./supported";

type Files = Record<string, string>;

interface AccessCounts {
  byName: number;
  tested: number;
  free: number;
  testedSlotOnly: number;
  provenWithoutAnyTest: number;
}

interface Numbers {
  accesses: AccessCounts;
  dependencyAccesses: AccessCounts;
  calls: { unknown: number; guarded: number; proven: number };
  causes: number;
}

interface Place {
  file: string;
  line: number;
  column: number;
}

interface Wording {
  reason: string;
  message: string;
  fix: string;
  url: string;
}

interface Cause extends Place, Wording {
  rank: number;
  inDependency: boolean;
  source: string;
  accesses: number;
  dependencyAccesses: number;
  calls: number;
  operators: number;
  inLoops: number;
  function: string;
  types: string[];
  family: "unproven-type" | "unknown-code";
  why: Wording | null;
}

interface Report {
  stdout: string;
  /** What stderr holds, but for empty lines and the line that ends `bun check`. */
  lines: string[];
  numbers: Numbers;
  causes: Cause[];
}

const env = { ...bunEnv, NO_COLOR: "1" };
const buildTimeout = 300_000;
const maxShownCauses = 20;
const textAndJSON = ["--explain", "--explain=json"];
const membersOfCause =
  "rank reason file line column inDependency source message fix url accesses dependencyAccesses calls operators " +
  "inLoops function types family why";

const pagePath = join(import.meta.dir, "..", "..", "docs", "compiler", "explain.mdx");
const page = readFileSync(pagePath, "utf8").replaceAll("\r\n", "\n");
/** The text of the page's first code block in `language`. */
const firstBlock = (language: string) => page.match(new RegExp("^```" + language + "\\b.*\\n([^]*?)^```$", "m"))![1]!;
const example: Files = { "main.ts": firstBlock("ts") };

const parts = [0, 1, 2];
const parsingLine = `export const settings = JSON.parse('{ "panel": { "size": 3, "title": "a" } }');`;
const readers: Files = {
  "settings.ts": parsingLine + "\n",
  "main.ts":
    `import { settings } from "./settings";\n` +
    parts.map(part => `import { size as size${part}, title as title${part} } from "./part${part}";\n`).join("") +
    parts.map(part => `console.log(size${part}(), title${part}(settings));\n`).join(""),
  ...Object.fromEntries(
    parts.map(part => [
      `part${part}.ts`,
      `import { settings } from "./settings";
export function size() {
  return settings.panel.size;
}
export function title(from: any) {
  return from.panel.title;
}
`,
    ]),
  ),
};

const readsOutsideLoops = 12;
const fewReadsInLoop: Files = {
  "main.ts": `const cold = JSON.parse('{ "field0": 1 }');
const hot = JSON.parse('{ "x": 1, "y": 2 }');
${Array.from({ length: readsOutsideLoops }, (_, index) => `console.log(cold.field${index});\n`).join("")}
let total = 0;
for (let i = 0; i < 1000; i++) total += hot.x + hot.y;
console.log(total);
`,
};

// An object that never leaves its function is not allocated, so the objects are kept in an array.
const typed: Files = {
  "main.ts": `class Account {
  constructor(
    public id: number,
    public balance: number,
  ) {}
}

function total(accounts: Account[]): number {
  let sum = 0;
  for (const account of accounts) sum += account.balance;
  return sum;
}

const accounts: Account[] = [];
for (let id = 0; id < 10; id++) accounts.push(new Account(id, id % 3));
console.log(total(accounts));
`,
};

const withDependency: Files = {
  "main.ts": `import { portOf } from "reads-config";\nconsole.log(portOf('{"port":3000}'));\n`,
  "node_modules/reads-config/package.json": JSON.stringify({
    name: "reads-config",
    version: "1.0.0",
    type: "module",
    main: "index.js",
    types: "index.d.ts",
  }),
  "node_modules/reads-config/index.js": `export function portOf(text) {\n  return JSON.parse(text).port;\n}\n`,
  "node_modules/reads-config/index.d.ts": `export declare function portOf(text: string): number;\n`,
};

// One program for each cause that the compiled code can show, with every entry of its report: the line, the cause and
// the `why` where there is one. An entry is one place that uses a value, so a value that is read in three places has
// three. A value that is read out of another value has the cause of that value.
const programsWithCauses: Record<string, { source: string; entries: string[] }> = {
  "an element read at an index that nothing proves": {
    source: `console.log(process.argv[2]);\n`,
    entries: ["1 element-access element-may-be-missing"],
  },
  // The read of `code` and the sum that takes it both hang on the caught value.
  "a caught value": {
    source: `let total = 0;
try {
  JSON.parse(process.argv[2]!);
} catch (error) {
  total += (error as { code: number }).code;
}
console.log(total);
`,
    entries: ["3 element-access element-may-be-missing", "5 caught-value", "5 caught-value"],
  },
  "the result of JSON.parse, read three times": {
    source: `const parsed: any = JSON.parse(process.argv[2]!);
let sum = 0;
sum += parsed.a;
sum += parsed.b;
sum += parsed.c;
console.log(sum);
`,
    entries: ["1 element-access element-may-be-missing", "3 builtin-result", "4 builtin-result", "5 builtin-result"],
  },
  // A function that calls itself is never inlined, so its parameter is what its own entry brings.
  "a parameter of unknown type": {
    source: `function depth(node: any): number {
  return node.next ? 1 + depth(node.next) : 0;
}
console.log(depth(JSON.parse(process.argv[2]!)));
`,
    entries: ["2 incoming-value", "2 incoming-value", "4 element-access element-may-be-missing"],
  },
  // And so is what it returns: the read of `name` hangs on the result of a call of a function that the compiler knows.
  "the result of a function that calls itself": {
    source: `function pick(list: any[], i: number): any {
  return i > 0 ? pick(list, i - 1) : list[0];
}
console.log(pick(JSON.parse(process.argv[2]!), 2).name);
`,
    entries: ["2 incoming-value", "4 call-result", "4 element-access element-may-be-missing"],
  },
  "the result of a call by value": {
    source: `function run(handler: any): number {
  return handler().count;
}
console.log(run(eval(process.argv[2]!)));
`,
    entries: [
      "2 unknown-callee",
      "2 unknown-callee-result",
      "4 element-access element-may-be-missing",
      "4 unknown-callee",
    ],
  },
  "the result of a direct eval": {
    source: `const made = eval(process.argv[2]!);
console.log(made.size);
`,
    entries: ["1 element-access element-may-be-missing", "2 runtime-code"],
  },
  "a variable that holds a value of unknown type": {
    source: `const saved: any = (globalThis as any).saved;
function next(): number {
  return saved + 1;
}
console.log(next());
`,
    entries: ["3 stored-value"],
  },
  // The constructor of `Base` also runs for `Sub`, so the object that it fills has no one layout.
  "a constructor of a class that another class extends": {
    source: `class Base {
  x: number;
  constructor() {
    this.x = 1;
  }
}
class Sub extends Base {
  y = 2;
}
console.log(new Base().x + new Sub().y);
`,
    entries: ["2 no-fixed-layout", "4 no-fixed-layout", "7 unknown-callee"],
  },
  // The types are proven. The read of `ids` gives `undefined` where the list has a hole, and with that as its index
  // the access of `counts` is a lookup by name. The read, the store and the `++` are one entry.
  "an index that is read from an array": {
    source: `function count(n: number, ids: number[]): number {
  const counts = new Uint32Array(n);
  for (let i = 0; i < ids.length; i++) counts[ids[i]]++;
  return counts[0];
}
console.log(count(4, [0, 1, 1, 3]));
`,
    entries: ["3 index-may-be-undefined"],
  },
  // The read of `price` hangs on the element, which may be missing. No entry says that the array holds other types.
  "an object that is read out of an element": {
    source: `type Item = { price: number };
function total(items: Item[], order: number[]): number {
  let sum = 0;
  for (let i = 0; i < order.length; i++) sum += items[order[i]].price;
  return sum;
}
console.log(total([{ price: 1 }, { price: 2 }], [0, 1, 1]));
`,
    entries: ["4 element-access element-may-be-missing", "4 element-access element-may-be-missing"],
  },
  // Every value is a typed array or a number. What is tested where the loops run is that the arrays are as they were
  // built. The entries without a cause are sums of what the slow paths of those tests give.
  "typed arrays whose state is tested": {
    source: `function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}
console.log(concat([new Uint8Array(2), new Uint8Array(3)]).length);
`,
    entries: [
      "12 not-a-plain-object",
      "3 object-state",
      "4 unknown",
      "7 object-state",
      "7 unknown",
      "7 unknown-callee",
      "8 object-state",
    ],
  },
  // The loop reads what a join of two kinds of values brings, so the compiled code shows no cause for it. No entry
  // names a loose type: the program has none.
  "a loop behind a direct eval": {
    source: `interface Item { sku: string; price: number }
const n = Number(process.argv[2]);
let total = 0;
const items: Item[] = [{ sku: "a", price: n }];
eval(process.argv[3]);
for (const item of items) total += item.price;
console.log(total);
`,
    entries: [
      "2 element-access element-may-be-missing",
      "5 element-access element-may-be-missing",
      "6 call-result",
      "6 stored-value",
      "6 unknown",
    ],
  },
};

// A program that has an entry, the cause of the entry, and the same program with the fix that the entry suggests. The
// fix removes every entry of that cause.
const fixes: Record<string, { cause: string; before: string; after: string }> = {
  "a check of the index against undefined": {
    cause: "index-may-be-undefined",
    before: programsWithCauses["an index that is read from an array"].source,
    after: `function count(n: number, ids: number[]): number {
  const counts = new Uint32Array(n);
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (id !== undefined) counts[id]++;
  }
  return counts[0];
}
console.log(count(4, [0, 1, 1, 3]));
`,
  },
  "indexes in a typed array": {
    cause: "index-may-be-undefined",
    before: programsWithCauses["an index that is read from an array"].source,
    after: `function count(n: number, ids: Int32Array): number {
  const counts = new Uint32Array(n);
  for (let i = 0; i < ids.length; i++) counts[ids[i]]++;
  return counts[0];
}
console.log(count(4, new Int32Array([0, 1, 1, 3])));
`,
  },
  "a local variable that is narrowed": {
    cause: "stored-value",
    before: programsWithCauses["a variable that holds a value of unknown type"].source,
    after: `const saved: any = (globalThis as any).saved;
function next(): number {
  const value = saved;
  return typeof value === "number" ? value + 1 : 0;
}
console.log(next());
`,
  },
};

// A declared type is what the compiler expects of a parameter, not what it has proven. The entries of `depth` go when
// its caller passes an object that typed code builds.
const declaredParameter = `interface Link { next: Link | null }
function depth(node: Link): number {
  return node.next ? 1 + depth(node.next) : 0;
}
console.log(depth(JSON.parse(process.argv[2]!)));
`;
const builtArgument = `interface Link { next: Link | null }
function readLink(value: unknown): Link {
  if (typeof value !== "object" || value === null) throw new Error("not an object");
  const { next } = value as Record<string, unknown>;
  return { next: next == null ? null : readLink(next) };
}
function depth(node: Link): number {
  return node.next ? 1 + depth(node.next) : 0;
}
console.log(depth(readLink(JSON.parse(process.argv[2]!))));
`;

const buildScript = `const result = await Bun.build({
  entrypoints: ["./main.ts"],
  compile: { aot: true, outfile: "./from-build", aotExplain: ["text", "json"] },
});
const logs = result.logs.map(log => ({ level: log.level, texts: [log.message, ...log.notes.map(note => note.message)] }));
console.log(JSON.stringify(logs));
`;

// Classes that escape to a callee that the compiler does not know, and a proxy of an instance that arrives at their reads
// beside whatever such a callee hands in.
const escaping = `
const hand = typeof handedIn === "function" ? handedIn : (...all) => console.log(typeof all[0] === "string" ? all[1]() : all.length);
class State { constructor() { this.length = 0; this.buffer = []; } }
class Stream {
  constructor() { this._state = new State(); }
  get size() { return this._state.length; }
  push(chunk) { const state = this._state; state.buffer.push(chunk); state.length += chunk.length; return state.length < 16; }
}
hand(Stream, State);
const made = () => new Stream();
hand("a proxy of a stream", () => { const proxy = new Proxy(made(), {}); return proxy.size + " " + proxy.push("a") + " " + proxy.size; });
`;

// One entry for each set of reports that the engine can be asked for.
const reportFlags: Record<string, string[]> = {
  nothing: [],
  causes: textAndJSON,
  guards: ["--explain=guards"],
  allocations: ["--explain=allocations"],
};

const linesOf = (text: string) =>
  text
    .split("\n")
    .map(line => line.trimEnd())
    .filter(line => line !== "");

async function run(files: Files, ...operands: string[]): Promise<Report> {
  using dir = tempDirWithBunTypes("aot-explain", files);
  const { stdout, stderr, exitCode, signal } = await spawned([bunExe(), ...operands], String(dir), env);
  const output = exitCode === 0 ? "" : stdout + stderr;
  expect({ exitCode, signal, output }).toEqual({ exitCode: 0, signal: null, output: "" });
  const [numbers, ...causes] = linesOf(stdout)
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line));
  const lines = linesOf(stderr)
    .filter(line => !line.includes("No type errors"))
    .map(line => (/^ +at /.test(line) ? line.replaceAll("\\", "/") : line));
  return { stdout, lines, numbers, causes };
}

const check = (files: Files, ...flags: string[]) => run(files, "check", "--aot", "--no-pretty", ...flags, "main.ts");
const compile = (files: Files, ...flags: string[]) => run(files, "compile", "./main.ts", ...flags);

const count = (number: number) => number.toLocaleString("en-US");
const counted = (number: number, one: string, many: string) => `${count(number)} ${number === 1 ? one : many}`;
const sum = (causes: Cause[], of: (cause: Cause) => number) => causes.reduce((total, cause) => total + of(cause), 0);
const all = ({ byName, tested, free }: AccessCounts) => byName + tested + free;
const untyped = ({ byName, tested }: AccessCounts) => byName + tested;
const lineOf = ({ file, line }: Place) => `${file}:${line}`;
const at = ({ file, line, column }: Place) => `   at ${file}:${line}:${column}`;

function closingLine(label: string, accesses: AccessCounts) {
  const tenths = Math.max(Math.floor((accesses.free * 1000) / all(accesses)), accesses.free > 0 ? 1 : 0);
  const columns = `${count(accesses.free)} free, ${count(accesses.tested)} tested, ${count(accesses.byName)} by name`;
  return `${label}${tenths / 10}% of property accesses are one load: ${columns} (${count(all(accesses))})`;
}

const closingLines = ({ accesses, dependencyAccesses }: Numbers) => [
  ...(all(dependencyAccesses) > 0 ? [closingLine("Dependencies: ", dependencyAccesses)] : []),
  ...(all(accesses) > 0 ? [closingLine("", accesses)] : []),
];

/** The lines of the text report that the JSON decides, in the order in which they are printed. */
function linesDecidedBy(causes: Cause[]) {
  if (causes.length === 0) return ["note: Every property access is typed. Nothing to fix."];
  return [
    `note: Untyped code works, but runs slower. ${counted(causes.length, "cause", "causes")}:`,
    ...causes
      .slice(0, maxShownCauses)
      .flatMap(cause => [
        `note: ${cause.rank}. ${cause.reason}: ${cause.message}`,
        ...(cause.line > 0 ? [at(cause)] : []),
        ...(cause.inLoops > 0
          ? [`note: ${counted(cause.inLoops, "of these runs in a loop", "of these run in a loop")}`]
          : []),
        ...(cause.why ? [`note: why (${cause.why.reason}): ${cause.why.message}`] : []),
        `note: fix: ${cause.fix}`,
        `note: ${cause.url}`,
      ]),
  ];
}

/** An access has one cause, so together the entries count what is missing from 100%. */
function expectCountsToAgree({ lines, numbers, causes }: Report) {
  expect(numbers.causes).toBe(causes.length);
  expect(causes.map(cause => cause.rank)).toEqual(causes.map((_, index) => index + 1));
  expect(sum(causes, cause => cause.accesses)).toBe(untyped(numbers.accesses));
  expect(sum(causes, cause => cause.dependencyAccesses)).toBe(untyped(numbers.dependencyAccesses));
  for (const cause of causes) {
    const operations = cause.accesses + cause.dependencyAccesses + cause.calls + cause.operators;
    expect(operations).toBeGreaterThan(0);
    expect(cause.inLoops).toBeLessThanOrEqual(operations);
    if (cause.accesses > 0) expect(cause.inDependency).toBe(false);
    for (const { reason, url } of cause.why ? [cause, cause.why] : [cause]) {
      expect(url).toBe(`https://bun.com/docs/compiler/explain#${reason}`);
      expect(page).toContain(`\n### ${reason}\n`);
    }
  }
  const decided = linesDecidedBy(causes);
  expect(lines.filter(line => decided.includes(line))).toEqual(decided);
  const closing = closingLines(numbers);
  expect(lines.slice(lines.length - closing.length)).toEqual(closing);
}

async function explain(files: Files) {
  const report = await check(files, ...textAndJSON);
  expectCountsToAgree(report);
  return report;
}

describe.concurrent("--explain", () => {
  test(
    "the example in the docs prints what the docs show",
    () =>
      slot(async () => {
        const [command, ...operands] = firstBlock("bash").trim().split(" ");
        expect(command).toBe("bun");
        const { lines } = await run(example, ...operands);
        expect(lines.join("\n")).toContain(linesOf(firstBlock("txt")).join("\n"));
      }),
    buildTimeout,
  );

  // Both commands run the same build, and `bun check --aot` writes no executable. Their stdout differs: `bun compile`
  // says there what it wrote.
  test(
    "bun check --aot --explain prints what bun compile --explain prints",
    () =>
      slot(async () => {
        const comparedParts = ({ lines, numbers, causes }: Report) => ({ lines, numbers, causes });
        const checked = await check(readers, ...textAndJSON);
        expect(checked.causes).not.toBeEmpty();
        expect(comparedParts(checked)).toEqual(comparedParts(await compile(readers, ...textAndJSON)));
      }),
    buildTimeout,
  );

  test(
    "=json prints the numbers, then an object per cause, and no text",
    () =>
      slot(async () => {
        const { lines, numbers, causes } = await check(example, "--explain=json");
        expect(lines).toEqual([]);
        expect(Object.keys(numbers)).toEqual(["accesses", "dependencyAccesses", "calls", "causes"]);
        for (const accesses of [numbers.accesses, numbers.dependencyAccesses])
          expect(Object.keys(accesses)).toEqual(["byName", "tested", "free", "testedSlotOnly", "provenWithoutAnyTest"]);
        expect(Object.keys(numbers.calls)).toEqual(["unknown", "guarded", "proven"]);
        expect(causes).not.toBeEmpty();
        for (const cause of causes) expect(Object.keys(cause).join(" ")).toBe(membersOfCause);
      }),
    buildTimeout,
  );

  for (const [name, { source, entries }] of Object.entries(programsWithCauses)) {
    test(
      `an entry names the cause that the compiled code shows: ${name}`,
      () =>
        slot(async () => {
          const { causes } = await explain({ "main.ts": source });
          const shown = causes.map(({ line, reason, why }) => [line, reason, ...(why ? [why.reason] : [])].join(" "));
          expect(shown.sort()).toEqual(entries);
        }),
      buildTimeout,
    );
  }

  for (const [name, { cause, before, after }] of Object.entries(fixes)) {
    test(
      `the fix that an entry suggests removes the entry: ${name}`,
      () =>
        slot(async () => {
          const reasons = async (source: string) => (await explain({ "main.ts": source })).causes.map(c => c.reason);
          expect(await reasons(before)).toContain(cause);
          expect(await reasons(after)).toEqual([]);
        }),
      buildTimeout,
    );
  }

  test(
    "a value that is used in one place is one entry, and one that is read in three places is three",
    () =>
      slot(async () => {
        const ofCause = async (name: string, reason: string) =>
          (await explain({ "main.ts": programsWithCauses[name].source })).causes
            .filter(cause => cause.reason === reason)
            .map(({ accesses, operators }) => ({ accesses, operators }));
        // The read of `counts`, the store into it and the `++` stand at one place.
        expect(await ofCause("an index that is read from an array", "index-may-be-undefined")).toEqual([
          { accesses: 2, operators: 1 },
        ]);
        // Each line reads a property and adds it.
        expect(await ofCause("the result of JSON.parse, read three times", "builtin-result")).toEqual([
          { accesses: 1, operators: 1 },
          { accesses: 1, operators: 1 },
          { accesses: 1, operators: 1 },
        ]);
      }),
    buildTimeout,
  );

  test(
    "a declared type of a parameter leaves its entries, and an argument that typed code builds removes them",
    () =>
      slot(async () => {
        const entriesOf = async (source: string) =>
          (await explain({ "main.ts": source })).causes.map(({ reason, function: name, family }) => ({
            reason,
            function: name,
            family,
          }));
        const inDepth = { reason: "incoming-value", function: "depth", family: "unproven-type" };
        expect((await entriesOf(declaredParameter)).filter(entry => entry.function === "depth")).toEqual([
          inDepth,
          inDepth,
        ]);
        expect((await entriesOf(builtArgument)).filter(entry => entry.function === "depth")).toEqual([]);
      }),
    buildTimeout,
  );

  test(
    "a cause in a loop comes first",
    () =>
      slot(async () => {
        const { causes } = await explain(fewReadsInLoop);
        const ofAccesses = causes.filter(cause => cause.accesses > 0);
        expect(
          ofAccesses.map(cause => ({ line: lineOf(cause), accesses: cause.accesses, isInLoop: cause.inLoops > 0 })),
        ).toEqual([
          { line: "main.ts:17", accesses: 1, isInLoop: true },
          { line: "main.ts:17", accesses: 1, isInLoop: true },
          ...Array.from({ length: readsOutsideLoops }, (_, index) => ({
            line: `main.ts:${index + 3}`,
            accesses: 1,
            isInLoop: false,
          })),
        ]);
      }),
    buildTimeout,
  );

  test(
    "a typed program has no cause and is 100% typed",
    () =>
      slot(async () => {
        const { lines, numbers, causes } = await explain(typed);
        expect(causes).toEqual([]);
        expect(numbers.accesses.free).toBeGreaterThan(0);
        expect(lines.at(-1)).toStartWith("100% of property accesses are one load: ");
      }),
    buildTimeout,
  );

  test(
    "an access in a dependency counts for the dependencies",
    () =>
      slot(async () => {
        const { numbers, causes } = await explain(withDependency);
        expect({
          inProgram: untyped(numbers.accesses),
          inDependencies: untyped(numbers.dependencyAccesses),
          ofAccesses: causes.filter(cause => cause.dependencyAccesses > 0).map(lineOf),
        }).toEqual({
          inProgram: 0,
          inDependencies: 1,
          ofAccesses: ["node_modules/reads-config/index.js:2"],
        });
      }),
    buildTimeout,
  );

  test(
    "aotExplain adds what the command prints to the logs of Bun.build",
    () =>
      slot(async () => {
        const { stdout } = await run({ ...example, "build.ts": buildScript }, "build.ts");
        const printed = await compile(example, ...textAndJSON);
        const logs: { level: string; texts: string[] }[] = JSON.parse(stdout);
        const isJSON = ({ texts }: { texts: string[] }) => texts[0]!.startsWith("{");
        expect([...new Set(logs.map(log => log.level))]).toEqual(["verbose"]);
        expect(logs.filter(isJSON).map(log => JSON.parse(log.texts[0]!))).toEqual([printed.numbers, ...printed.causes]);
        const notes = logs.filter(log => !isJSON(log)).flatMap(log => log.texts);
        const text = notes.flatMap(note => linesOf(`note: ${note}`));
        expect(text).not.toBeEmpty();
        expect(printed.lines.filter(line => text.includes(line))).toEqual(text);
      }),
    buildTimeout,
  );

  // To say where a value came from, the analysis keeps more than a build needs, and the compiler takes notes as it goes.
  // Neither may decide what is built.
  test(
    "asking for a report changes no byte of the executable",
    async () => {
      using dir = tempDir("aot-explain-bytes", { "program.js": escaping });
      const root = String(dir);
      const templateFlags = withoutDebugInformation();
      const names = Object.keys(reportFlags);
      const hashes = await Promise.all(
        names.map(name =>
          slot(async () => {
            // An executable holds its own name, so all have one name, each in a folder of its own.
            const executable = join(root, name, isWindows ? "program.exe" : "program");
            mkdirSync(join(root, name));
            const flags = [...templateFlags, ...reportFlags[name]!, "--outfile", executable];
            const built = await spawned([bunExe(), "compile", "./program.js", ...flags], root, env);
            return built.exitCode === 0 && !built.signal
              ? new Bun.CryptoHasher("sha256").update(await Bun.file(executable).bytes()).digest("hex")
              : `exit code ${built.exitCode} ${built.signal ?? ""} ${built.stderr.slice(0, 600)}`;
          }),
        ),
      );
      expect(hashes[0]).toMatch(/^[0-9a-f]{64}$/);
      expect(
        Object.fromEntries(
          names.map((name, index) => [name, hashes[index] === hashes[0] ? "the same" : hashes[index]]),
        ),
      ).toEqual(Object.fromEntries(names.map(name => [name, "the same"])));
    },
    buildTimeout,
  );
});
