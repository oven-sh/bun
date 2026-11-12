// `bun compile --explain`, `bun check --aot --explain` and `aotExplain` give one report. Its text, its JSON and its closing
// lines say the same, an entry stands at the line that an untyped value comes from, and asking for it changes nothing of
// what is built. The wording of single entries is tested beside the code that writes it: src/aot/report.
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
  why: string;
  /** Where the operations are, if the entry is at another place. */
  uses: string[];
  accesses: number;
  dependencyAccesses: number;
  calls: number;
  operators: number;
  inLoops: number;
  withOtherCauses: number;
  function: string;
  types: string[];
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
  "rank reason file line column inDependency source message fix url why uses accesses dependencyAccesses calls " +
  "operators inLoops withOtherCauses function types";

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
const hot = JSON.parse('[{ "x": 1, "y": 2 }]');
${Array.from({ length: readsOutsideLoops }, (_, index) => `console.log(cold.field${index});\n`).join("")}
let total = 0;
for (const point of hot) total += point.x + point.y;
console.log(total);
`,
};

const lookedUpBehindChecks: Files = {
  "main.ts": `class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
class Config {
  static limit: number = 3;
}
function viaIndex(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i]!.x;
  return sum;
}
function viaFind(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += points.find(point => point.x === i)!.y;
  return sum;
}
function viaStaticField() {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Config.limit;
  return sum;
}
function viaPop(points: Point[]) {
  let sum = 0;
  while (points.length > 0) sum += points.pop()!.x;
  return sum;
}
const points: Point[] = [];
for (let i = 0; i < 4; i++) points.push(new Point(i, i + 1));
console.log(viaIndex(points), viaFind(points), viaStaticField(), viaPop(points));
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

// Each program has one thing that costs something: why, and the line to change. The accesses are at the lines of `uses`.
interface Origin {
  source: string;
  why: string;
  line: number;
  /** A use that the compiler learns to make free may go. */
  uses: number[];
}
const origins: Record<string, Origin> = {
  "the argument of new Array() may not be a number": {
    source: `class Block {
  constructor(public link: Block | null, public size: number) {}
}
class Store {
  blocks: Block[] = new Array(capacity);
  last: Block | null = null;
  add(index: number) {
    this.last = new Block(this.last, index);
    this.blocks[index] = this.last;
  }
  sum() {
    let total = 0;
    for (let i = 0; i < count; i++) {
      const block = this.blocks[i];
      if (block == null) continue;
      total += block.size;
    }
    return total;
  }
}
const count = process.argv.length + 4;
const capacity: any = count > 99 ? "none" : 6;
const store = new Store();
for (let i = 0; i < count; i++) store.add(i);
console.log(store.sum());
`,
    why: "array-argument",
    line: 22,
    uses: [16],
  },
  "a parsed object gets into a list of objects of a known shape": {
    source: `interface Item {
  price: number;
}
const items: Item[] = [{ price: 1 }];
items.push(JSON.parse('{ "price": 2 }'));
let total = 0;
for (const item of items) total += item.price;
console.log(total);
`,
    why: "builtin-result",
    line: 5,
    uses: [7],
  },
  "an object is given to a function that isn't known": {
    source: `class Account {
  balance = 1;
}
function total(accounts: Account[]) {
  let sum = 0;
  for (const account of accounts) sum += account.balance;
  return sum;
}
const accounts = [new Account(), new Account()];
const handler = (globalThis as any).onAccount;
if (handler) handler(accounts[0]);
console.log(total(accounts));
`,
    why: "exposed-object",
    line: 11,
    uses: [2, 6],
  },
  "a property is redefined": {
    source: `class Box {
  value: number = 1;
  other: number = 2;
}
function sum(boxes: Box[]) {
  let total = 0;
  for (const box of boxes) total += box.value + box.other;
  return total;
}
const boxes = [new Box(), new Box()];
Object.defineProperty(boxes[0], "value", {
  get() {
    return 3;
  },
});
console.log(sum(boxes));
`,
    why: "changed-shape",
    line: 11,
    uses: [7],
  },
  "a field holds a number at first": {
    source: `class Item {
  next: Item | number = 0;
  weight = 1;
}
function sum(items: Item[]) {
  let total = 0;
  for (const item of items) total += (item.next as Item).weight;
  return total;
}
const items: Item[] = [];
for (let i = 0; i < 10; i++) {
  const item = new Item();
  item.next = new Item();
  items.push(item);
}
console.log(sum(items));
`,
    why: "other-value",
    line: 2,
    uses: [7],
  },
  "a caught exception is read": {
    source: `function failures() {
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    try {
      if (i) throw { code: i };
    } catch (error: any) {
      sum += error.code;
    }
  }
  return sum;
}
console.log(failures());
`,
    why: "caught-exception",
    line: 6,
    uses: [7],
  },
  "what pop() returns is checked": {
    source: `class Point {
  constructor(public x: number) {}
}
function sum(points: Point[]) {
  let total = 0;
  while (points.length > 0) total += points.pop()!.x;
  return total;
}
const points: Point[] = [];
for (let i = 0; i < 100; i++) points.push(new Point(i));
console.log(sum(points));
`,
    why: "checked-result",
    line: 6,
    uses: [6],
  },
  "a static field is defined": {
    source: `class Config {
  static limit: number = 3;
}
function sum() {
  let total = 0;
  for (let i = 0; i < 9; i++) total += Config.limit;
  return total;
}
console.log(sum());
`,
    why: "static-field",
    line: 2,
    uses: [],
  },
};

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
    expect(cause.url).toBe(`https://bun.com/docs/compiler/explain#${cause.reason}`);
    expect(page).toContain(`\n### ${cause.reason}\n`);
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

  test(
    "a cause in a loop comes first",
    () =>
      slot(async () => {
        const { causes } = await explain(fewReadsInLoop);
        const ofAccesses = causes.filter(cause => cause.accesses > 0);
        expect(
          ofAccesses.map(({ line, accesses, inLoops, why }) => ({ line, accesses, isInLoop: inLoops > 0, why })),
        ).toEqual([
          { line: 2, accesses: ofAccesses[0]!.accesses, isInLoop: true, why: "builtin-result" },
          { line: 1, accesses: readsOutsideLoops, isInLoop: false, why: "builtin-result" },
        ]);
        expect(ofAccesses[0]!.accesses).toBeLessThan(readsOutsideLoops);
      }),
    buildTimeout,
  );

  // pop() and find() can return undefined, and a class object can change. Only the failing side of a check looks a name up.
  test(
    "a lookup that usually doesn't run is not counted",
    () =>
      slot(async () => {
        const { numbers, causes } = await explain(lookedUpBehindChecks);
        const reasonsAt = (line: number) => causes.filter(cause => cause.line === line).map(cause => cause.reason);
        expect({
          // The definition of the static field.
          lookups: numbers.accesses.byName,
          readOfStaticField: reasonsAt(22),
          operatorOnPop: reasonsAt(27).includes("lost-track"),
        }).toEqual({ lookups: 1, readOfStaticField: [], operatorOnPop: false });
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

  test.each(Object.entries(origins))(
    "why, and where to change it: %s",
    (_, { source, why, line, uses }) =>
      slot(async () => {
        const { causes } = await explain({ "main.ts": source });
        const cause = causes.find(cause => cause.accesses > 0);
        expect({ why: cause?.why, line: cause?.line }).toEqual({ why, line });
        for (const use of cause!.uses) expect(uses).toContain(Number(use.split(":")[1]));
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
