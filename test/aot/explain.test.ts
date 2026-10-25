// `--explain` and the percentage in the last line of a build are one account:
//   100% means that the report has no entry, and less than 100% that it has one;
//   an access has one cause, so together the entries count what is missing from 100%;
//   the fix that an entry suggests removes the entry, and the percentage reaches 100%. Parsed data is the exception: the
//   function that checks it still reads an unknown object, so its entry stays (`notYet` says so);
//   the text, the JSON and the last line of the build say the same;
//   an entry that says why its guard is there gives a reason that the compiler recorded.
// `cases` has a program per cause (before) and the same program fixed as the entry says (after).
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { basename, join } from "path";
import {
  parseExplainLines,
  type ExplainCause,
  type ExplainNumbers,
  type ExplainReport,
} from "./explain/explain-report";
import {
  accessColumns,
  accessCountKeys,
  countAccesses,
  levels,
  type AccessColumn,
  type AccessCounts,
} from "./harness/build-report";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

type Files = Record<string, string>;

interface Case {
  reason: string;
  family: ExplainCause["family"];
  types: string[];
  /** The line of `before` that the entry names. */
  at: string;
  before: string;
  after: string;
  /** What the report says of `before` today, where that is not yet what the page says. */
  notYet?: string;
}

const counterProgram = (field: string, setup: string, operation: string, read: string) => `class Counter {
  ${field}
}

${setup}const first = new Counter();
const counters = [first];
for (let i = 0; i < 2; i++) counters.push(new Counter());
${operation}

let sum = 0;
for (const counter of counters) sum += ${read};
console.log(sum);
`;

const boxProgram = (declaration: string, call: string) => `interface Box {
  width: number;
  height: number;
}

${declaration}

const boxes: Box[] = [];
for (let side = 1; side <= 3; side++) boxes.push({ width: side, height: side + 1 });
${call}

let area = 0;
for (const box of boxes) area += box.width * box.height;
console.log(area);
`;

const itemProgram = (loop: string) => `interface Item {
  sku: string;
  price: number;
}

const items: Item[] = [{ sku: "A-1", price: 2.5 }];
${loop}

let sum = 0;
for (const item of items) sum += item.price;
console.log(sum);
`;

const runtimeKey = "const key = String(Date.now());\n";
const extras = runtimeKey + "const extras = new Map<string, number>();\n";

const cases: Record<string, Case> = {
  "parsed data is read": {
    reason: "unknown-object",
    family: "unknown-code",
    types: [],
    at: `const config = JSON.parse('{"host":"localhost","port":3000}');`,
    before: `const config = JSON.parse('{"host":"localhost","port":3000}');
const address = config.host + ":" + config.port;
console.log(address);
`,
    after: `interface Config {
  host: string;
  port: number;
}

function readConfig(value: unknown): Config {
  if (typeof value !== "object" || value === null) throw new Error("config: not an object");
  const { host, port } = value as Record<string, unknown>;
  if (typeof host !== "string") throw new Error("config: host must be a string");
  if (typeof port !== "number") throw new Error("config: port must be a number");
  return { host, port };
}

const config = readConfig(JSON.parse('{"host":"localhost","port":3000}'));
const address = config.host + ":" + config.port;
console.log(address);
`,
    notYet: "the reads of config are free, and readConfig's own read of the parsed object keeps the entry",
  },
  "parsed data reaches a type": {
    reason: "unknown-object",
    family: "unknown-code",
    types: ["Item"],
    at: `for (const item of JSON.parse('[{"sku":"B-2","price":10}]')) items.push(item);`,
    before: itemProgram(`for (const item of JSON.parse('[{"sku":"B-2","price":10}]')) items.push(item);`),
    after: itemProgram(`function readItem(value: unknown): Item {
  if (typeof value !== "object" || value === null) throw new Error("item: not an object");
  const { sku, price } = value as Record<string, unknown>;
  if (typeof sku !== "string") throw new Error("item: sku must be a string");
  if (typeof price !== "number") throw new Error("item: price must be a number");
  return { sku, price };
}
for (const item of JSON.parse('[{"sku":"B-2","price":10}]')) items.push(readItem(item));`),
    notYet: "the read of item.price is free, and readItem's own read of the parsed object keeps the entry",
  },
  "an object is passed to code from new Function()": {
    reason: "passed-to-untyped-code",
    family: "unknown-code",
    types: ["Box"],
    at: "for (const box of boxes) publish(box);",
    before: boxProgram(
      `const publish = new Function("box", process.argv[2] ?? "");`,
      "for (const box of boxes) publish(box);",
    ),
    after: boxProgram(
      `const publish = new Function("width", "height", process.argv[2] ?? "");`,
      "for (const box of boxes) publish(box.width, box.height);",
    ),
    notYet: "an entry for each read, at the line of the read and not at the line that passes the object",
  },
  "a field is deleted": {
    reason: "field-deleted",
    family: "mutation",
    types: ["Counter"],
    at: "delete (first as any).count;",
    before: counterProgram("count: number | undefined = 0;", "", "delete (first as any).count;", "counter.count ?? 0"),
    after: counterProgram("count: number | undefined = 0;", "", "first.count = undefined;", "counter.count ?? 0"),
  },
  "a computed key is deleted": {
    reason: "computed-key-delete",
    family: "mutation",
    types: ["Counter"],
    at: "delete (first as any)[key];",
    before: counterProgram("count = 0;", runtimeKey, "delete (first as any)[key];", "counter.count"),
    after: counterProgram("count = 0;", extras, "extras.delete(key);", "counter.count"),
    notYet: "the entry says field-deleted",
  },
  "a computed key is stored": {
    reason: "computed-key-store",
    family: "mutation",
    types: ["Counter"],
    at: "(first as any)[key] = 1;",
    before: counterProgram("count = 0;", runtimeKey, "(first as any)[key] = 1;", "counter.count"),
    after: counterProgram("count = 0;", extras, "extras.set(key, 1);", "counter.count"),
    notYet: "the entry says property-added",
  },
  "a prototype is changed": {
    reason: "prototype-changed",
    family: "mutation",
    types: ["Counter"],
    at: "Object.setPrototypeOf(first, null);",
    before: counterProgram("count = 0;", "", "Object.setPrototypeOf(first, null);", "counter.count"),
    after: counterProgram("count = 0;", "", "", "counter.count"),
    notYet: "no entry: a field of the object itself stays one load under another prototype",
  },
};

const page = join(import.meta.dir, "../../docs/bundler/aot-explain.mdx");
const wordingSource = join(import.meta.dir, "../../src/aot/report/wording.rs");
const hint = "Untyped code works, but runs slower. Run with --explain to see what to fix.";
const columnLabels: Record<AccessColumn, string> = { free: "free", tested: "tested", byName: "by name" };
const columnDescriptions: Record<AccessColumn, string> = {
  free: "free: one load or store at a fixed offset",
  tested: "tested: a test of its own, then a load or store at a fixed offset",
  byName: "by name: looked up by name",
};
const printedColumns = accessColumns.toReversed();
const maxShownCauses = 20;
const buildTimeout = 300_000;

async function check(files: Files, flag: string) {
  using dir = tempDirWithBunTypes("aot-explain", files);
  const command = [bunExe(), "check", "--aot", "--no-pretty", flag, "main.ts"];
  const { stdout, stderr, exitCode, signal } = await spawned(command, String(dir), { ...bunEnv, NO_COLOR: "1" });
  const said = exitCode === 0 ? "" : stdout + stderr;
  expect({ exitCode, signal, said }).toEqual({ exitCode: 0, signal: null, said: "" });
  expect(stderr).toEndWith("\n");
  const lines = stderr.split("\n").slice(0, -1);
  return { stdout, lines: lines.filter(line => !line.includes("No type errors")) };
}

async function explain(files: Files): Promise<ExplainReport> {
  const { stdout, lines } = await check(files, "--explain=json");
  return { ...parseExplainLines(stdout), summary: lines };
}

const sum = (numbers: number[]) => numbers.reduce((total, number) => total + number, 0);
const count = (number: number) => number.toLocaleString("en-US");
const counted = (number: number, one: string, many: string) => `${count(number)} ${number === 1 ? one : many}`;
const countAll = countAccesses;
const typed = (accesses: AccessCounts) => accesses.free;
const untyped = (accesses: AccessCounts) => countAll(accesses) - typed(accesses);
const urlOf = (code: string) => `https://bun.com/docs/bundler/aot-explain#${code}`;

function percentOf(accesses: AccessCounts) {
  return Math.max(Math.floor((typed(accesses) * 1000) / countAll(accesses)), typed(accesses) > 0 ? 1 : 0) / 10;
}

function columnsLine(label: string, accesses: AccessCounts) {
  const counts = printedColumns.map(column => `${count(accesses[column])} ${columnLabels[column]}`).join(", ");
  return `${label}${percentOf(accesses)}% of property accesses are one load: ${counts} (${count(countAll(accesses))})`;
}

function summaryOf({ accesses, dependencyAccesses }: ExplainNumbers, hasTextReport: boolean) {
  const hasAccesses = countAll(accesses) > 0;
  return [
    ...(hasAccesses && percentOf(accesses) < 95 && !hasTextReport ? [hint] : []),
    ...(countAll(dependencyAccesses) > 0 ? [columnsLine("Dependencies: ", dependencyAccesses)] : []),
    ...(hasAccesses ? [columnsLine("", accesses)] : []),
  ];
}

function shareOf(cause: ExplainCause, numbers: ExplainNumbers) {
  const inDependencies = untyped(numbers.dependencyAccesses);
  if (cause.inDependency) {
    const total = counted(inDependencies, "untyped access", "untyped accesses");
    return `${count(cause.dependencyAccesses)} of ${total} in dependencies`;
  }
  const inProgram = `${count(cause.accesses)} of ${counted(untyped(numbers.accesses), "untyped access", "untyped accesses")}`;
  if (cause.dependencyAccesses === 0) return inProgram;
  return `${inProgram}, and ${count(cause.dependencyAccesses)} of ${count(inDependencies)} in dependencies`;
}

function entryOf(cause: ExplainCause, numbers: ExplainNumbers) {
  return [
    `note: ${cause.rank}. ${cause.reason}: ${cause.message}`,
    ...(cause.line ? [`   at ${basename(cause.file)}:${cause.line}:${cause.column}`] : []),
    `note: ${shareOf(cause, numbers)}`,
    ...(cause.function ? [`note: in function '${cause.function}'`] : []),
    ...(cause.types.length ? [`note: types: '${cause.types.join("', '")}'`] : []),
    ...(cause.why ? [`note: why (${cause.why.reason}): ${cause.why.message}`] : []),
    `note: fix: ${cause.fix}`,
    `note: ${cause.url}`,
  ];
}

/** Of a program that is one file, main.ts. */
function detailsOf({ accesses }: ExplainNumbers) {
  if (countAll(accesses) === 0) return [];
  const counts = printedColumns.map(column => count(accesses[column]));
  const width = Math.max(...counts.map(text => text.length));
  const ratio = `${percentOf(accesses)}% typed (${count(typed(accesses))} of ${count(countAll(accesses))})`;
  return [
    "note: All property accesses, including dependencies:",
    ...printedColumns.map((column, index) => `  ${counts[index]!.padStart(width)}  ${columnDescriptions[column]}`),
    ...(untyped(accesses) > 0 ? ["Files with the most untyped accesses:", `  main.ts  ${ratio}`] : []),
  ];
}

function textOf({ numbers, causes }: ExplainReport) {
  const heading = `note: Untyped code works, but runs slower. ${counted(causes.length, "cause", "causes")}:`;
  const nothing = "note: Every property access is typed. Nothing to fix.";
  return [
    ...(causes.length
      ? [heading, ...causes.slice(0, maxShownCauses).flatMap(cause => entryOf(cause, numbers))]
      : [nothing]),
    ...detailsOf(numbers),
    ...summaryOf(numbers, true),
  ];
}

/** The lines of the text report, but for the source lines it shows, the count of calls and the limits that the build hit. */
function expectText(lines: string[], report: ExplainReport) {
  const expected = textOf(report);
  const withoutFolders = lines.map(line => line.replace(/^( +at ).*[\\/]/, "$1"));
  expect(withoutFolders.filter(line => expected.includes(line))).toEqual(expected);
  expect(lines.at(-1)).toBe(expected.at(-1));
}

function expectOneAccount({ numbers, causes, summary }: ExplainReport) {
  expect(summary).toEqual(summaryOf(numbers, false));
  expect(numbers.causes).toBe(causes.length);
  expect(causes.map(cause => cause.rank)).toEqual(causes.map((_, index) => index + 1));
  expect(sum(causes.map(cause => cause.accesses))).toBe(untyped(numbers.accesses));
  expect(sum(causes.map(cause => cause.dependencyAccesses))).toBe(untyped(numbers.dependencyAccesses));
  for (const cause of causes) {
    expect(cause.accesses + cause.dependencyAccesses + cause.calls + cause.operators).toBeGreaterThan(0);
    if (cause.accesses > 0) expect(cause.inDependency).toBe(false);
    expect(cause.fixedByThisAlone).toBeLessThanOrEqual(
      cause.accesses + cause.dependencyAccesses + cause.calls + cause.operators,
    );
    expect(cause.message).not.toBeEmpty();
    expect(cause.fix).not.toBeEmpty();
    expect(cause.url).toBe(urlOf(cause.reason));
    if (!cause.why) continue;
    expect(cause.why.reason).not.toBe("unclassified");
    expect(cause.why.message).not.toBeEmpty();
    expect(cause.why.fix).not.toBeEmpty();
    expect(cause.why.url).toBe(urlOf(cause.why.reason));
  }
}

describe.concurrent("--explain", () => {
  for (const [name, { notYet }] of Object.entries(cases)) if (notYet) test.todo(`${name} (${notYet})`);

  test.each(Object.keys(cases).filter(name => !cases[name]!.notYet))(
    "%s",
    name =>
      slot(async () => {
        const { reason, family, types, at, before, after } = cases[name]!;
        const broken = await explain({ "main.ts": before });
        expectOneAccount(broken);
        expect(untyped(broken.numbers.accesses)).toBeGreaterThan(0);
        expect(broken.causes.filter(cause => cause.reason === reason)).toEqual([
          expect.objectContaining({
            file: "main.ts",
            line: before.split("\n").indexOf(at) + 1,
            source: at,
            inDependency: false,
            types,
            family,
          }),
        ]);

        expectText((await check({ "main.ts": before }, "--explain")).lines, broken);

        const fixed = await explain({ "main.ts": after });
        expectOneAccount(fixed);
        expect(fixed.causes.map(cause => cause.reason)).toEqual([]);
      }),
    buildTimeout,
  );

  test(
    "a program without a cause",
    () =>
      slot(async () => {
        const files = { "main.ts": cases["a field is deleted"]!.after };
        const report = await explain(files);
        expect(typed(report.numbers.accesses)).toBeGreaterThan(0);
        expectText((await check(files, "--explain")).lines, report);
      }),
    buildTimeout,
  );

  test(
    "=json prints the numbers, then an object per cause",
    () =>
      slot(async () => {
        const { stdout } = await check({ "main.ts": cases["parsed data reaches a type"]!.before }, "--explain=json");
        const [numbers, ...causes] = stdout.split("\n").filter(line => line.startsWith("{"));
        expect(Object.keys(JSON.parse(numbers!))).toEqual(["accesses", "dependencyAccesses", "calls", "causes"]);
        for (const key of ["accesses", "dependencyAccesses"])
          expect(Object.keys(JSON.parse(numbers!)[key])).toEqual([...accessCountKeys]);
        expect(Object.keys(JSON.parse(numbers!).calls)).toEqual([...levels]);
        expect(causes).not.toBeEmpty();
        for (const cause of causes) {
          expect(Object.keys(JSON.parse(cause))).toEqual([
            "rank",
            "reason",
            "limit",
            "file",
            "line",
            "column",
            "inDependency",
            "source",
            "message",
            "fix",
            "url",
            "accesses",
            "dependencyAccesses",
            "calls",
            "operators",
            "fixedByThisAlone",
            "estimatedPercent",
            "function",
            "types",
            "family",
            "why",
          ]);
        }
      }),
    buildTimeout,
  );

  test(
    "an access in a dependency counts for the dependencies",
    () =>
      slot(async () => {
        const report = await explain({
          "main.ts": `import { portOf } from "reads-config";\nconst port = portOf('{"port":3000}');\nconsole.log(port);\n`,
          "node_modules/reads-config/package.json": JSON.stringify({
            name: "reads-config",
            version: "1.0.0",
            type: "module",
            main: "index.js",
            types: "index.d.ts",
          }),
          "node_modules/reads-config/index.js": `export function portOf(text) {\n  return JSON.parse(text).port;\n}\n`,
          "node_modules/reads-config/index.d.ts": `export declare function portOf(text: string): number;\n`,
        });
        expectOneAccount(report);
        expect(untyped(report.numbers.accesses)).toBe(0);
        expect(report.causes).toEqual([
          expect.objectContaining({
            file: "node_modules/reads-config/index.js",
            line: 2,
            inDependency: true,
            accesses: 0,
            dependencyAccesses: 1,
          }),
        ]);
      }),
    buildTimeout,
  );

  test(
    "what is left out is counted, with the flag that prints it",
    () =>
      slot(async () => {
        const parts = Array.from({ length: 25 }, (_, index) => index);
        const files: Files = {
          "main.ts":
            parts.map(part => `import { read${part} } from "./part${part}";\n`).join("") +
            `const sum = ${parts.map(part => `read${part}('{"n":1}')`).join(" + ")};\nconsole.log(sum);\n`,
        };
        for (const part of parts) {
          const head = `export function read${part}(text: string): number {`;
          files[`part${part}.ts`] = `${head}\n  return JSON.parse(text).n;\n}\n`;
        }
        const { lines } = await check(files, "--explain");
        const report = await explain(files);
        expectOneAccount(report);
        expect(lines).toContain(`note: Untyped code works, but runs slower. ${report.causes.length} causes:`);
        expect(lines.filter(line => /^note: \d+\. [a-z-]+: /.test(line))).toHaveLength(maxShownCauses);
        expect(lines).toContain(
          `note: ${report.causes.length - maxShownCauses} more causes not shown. Use --explain=json to print all of them, one JSON object per line.`,
        );
        const ofAccesses = report.causes.filter(cause => cause.accesses > 0);
        expect(ofAccesses.map(cause => cause.file).sort()).toEqual(parts.map(part => `part${part}.ts`).sort());
      }),
    buildTimeout,
  );

  test("every code has a section on the page that the entries link to", async () => {
    const headings = [...(await Bun.file(page).text()).matchAll(/^### ([a-z-]+)$/gm)].map(match => match[1]!);
    const wording = await Bun.file(wordingSource).text();
    const codes = [...wording.matchAll(/^ +UnprovenCause::\w+ => "([a-z-]+)",$/gm)].map(match => match[1]!);
    const guardCodes = [...wording.matchAll(/^ +IllTypedCause::\w+ => \(\n +"([a-z-]+)",$/gm)].map(match => match[1]!);
    expect(codes.length).toBeGreaterThan(10);
    expect(guardCodes.length).toBeGreaterThan(10);
    expect(headings.toSorted()).toEqual([...new Set([...codes, ...guardCodes])].toSorted());
    for (const { reason } of Object.values(cases)) expect(codes).toContain(reason);
  });
});
