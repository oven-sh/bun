// What a program pays that never asks for the compiler. Most of Bun's users run `bun file.ts`, and the code they run is shared with
// --aot: JavaScriptCore's run time, collector, B3 and Air, Yarr, the allocator, the transpiler, the modules in src/js. Each row here
// is a small program of fixed work, run by this Bun without --aot, and what it costs is compared with ./plain-bun-costs.linux-x64.json.
//
//   start         hello, a TypeScript file, the node: modules most programs load, a server's first answer
//   interpreter   ./plain-bun-costs/*.js with BUN_JSC_useJIT=0: the interpreter, the run time and the collector
//   jit           the same programs with every JIT tier compiling on the program's own thread, so that compile time counts too
//   tools         `bun test` over ten files of 300 tests, and a program of 300 TypeScript modules, in both of those ways
//
// Counted: the instructions of the program's first thread in user mode, the least of three runs, and the page faults of the whole process.
// Collections come by bytes allocated and run on that thread. The same binary repeats a row within 0.3%. A row that is over is measured again, four times at most.
// Of a program that runs to its end, the peak resident memory too, in a run of its own. It is started by a small Bun, whose own peak
// of about 17 MB is the least that can be read.
// Bun reads the listing of every folder above the file that it runs, about a thousand instructions an entry, so the programs are written below
// the temporary folder that has the fewest entries above it, and the file says how many those were.
//
// A row fails when it costs over 3% more instructions, 30% more page faults, or 15% more memory at its peak, than the file has for it.
// A start row may cost 6% more instructions, because the loader and libc are part of it. A change that is meant to cost that much says
// so by changing the file:
//
//   PLAIN_BUN_COSTS=accept bun test test/aot/perf/plain-bun-costs.test.ts    writes what this Bun costs
//   PLAIN_BUN_COSTS=lower  bun test test/aot/perf/plain-bun-costs.test.ts    keeps the lower of the two for every row
//   PLAIN_BUN_COSTS=add    bun test test/aot/perf/plain-bun-costs.test.ts    writes only the rows and numbers that the file does not have
//
// The numbers are those of the release build with LTO for Linux x64, which is what CI builds and ships. Other builds print the table
// and are not judged: PLAIN_BUN_COSTS=hold judges them anyway.
//
// What the top tier compiles a second time, it compiled for nothing the first time. That needs no counter, so it is judged wherever the programs run.
import { expect, test } from "bun:test";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { bunExe, isASAN, isCI, isDebug, isGlibc, makeTreeSync, runCommandMaxRSS } from "harness";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { measureUntilWithinBounds } from "../harness/measure-again";
import { withoutInstallingPackages } from "../harness/without-installing-packages";
import { measureStart, startEnvironment, steppedStart, type Until } from "./start/measure-start";

type Cost = { thousandInstructions: number; pageFaults: number; peakKilobytes?: number };
const mostInstructions = (name: string) => (name.startsWith("start ") ? 1.06 : 1.03);
const mostPageFaults = 1.3;
const mostPeakMemory = 1.15;

const mode = process.env.PLAIN_BUN_COSTS;
const budgetsPath = join(import.meta.dir, "plain-bun-costs.linux-x64.json");
const {
  entriesAboveThePrograms: entriesAboveWhenWritten = Infinity,
  ...budgets
}: Record<string, Cost> & {
  entriesAboveThePrograms?: number;
} = existsSync(budgetsPath) ? JSON.parse(readFileSync(budgetsPath, "utf8")) : {};
const programs = join(import.meta.dir, "plain-bun-costs");
const measurable = isGlibc && process.arch === "x64" && !isDebug && !isASAN;
const judged = isCI || mode === "hold";

const thirtyModules = ["fs", "path", "http", "https", "stream", "events", "util", "crypto", "zlib", "child_process", "url", "os", "net", "tls", "buffer", "assert", "readline", "worker_threads", "dns", "querystring", "string_decoder", "timers", "tty", "vm", "perf_hooks", "async_hooks", "http2", "dgram", "module", "v8"]; // prettier-ignore
const startFiles = {
  "hello.js": `console.log("hello");`,
  "hello.ts": `interface Greeting { to: string; times: number }\nfunction greet(g: Greeting): string { return ("hello " + g.to + " ").repeat(g.times).trim(); }\nconsole.log(greet({ to: "world", times: 2 }));`,
  "fs.js": `require("node:fs"); console.log("hello");`,
  "stream.js": `require("node:stream"); console.log("hello");`,
  "http.js": `require("node:http"); console.log("hello");`,
  "thirty-modules.js": `for (const name of ${JSON.stringify(thirtyModules)}) require("node:" + name); console.log("hello");`,
  "node-http-server.js": `require("node:http").createServer((request, response) => response.end("hello")).listen(0, "127.0.0.1", function () { console.log("listening " + this.address().port); });`,
  "bun-serve.js": `console.log("listening " + Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("hello") }).port);`,
};
const startRows: [string, Until][] = [
  ["hello.js", { prints: "hello\n" }],
  ["hello.ts", { prints: "hello world hello world\n" }],
  ["fs.js", { prints: "hello\n" }],
  ["stream.js", { prints: "hello\n" }],
  ["http.js", { prints: "hello\n" }],
  ["thirty-modules.js", { prints: "hello\n" }],
  ["node-http-server.js", { route: "/", answers: "hello" }],
  ["bun-serve.js", { route: "/", answers: "hello" }],
];
const testFile = (file: number) => `import { describe, expect, test } from "bun:test";
describe("file ${file}", () => {
  for (let k = 0; k < 300; k++)
    test("case " + k, () => {
      const made = { a: k, b: [k, k + 1], c: { d: "x" + k } };
      expect(made).toEqual({ a: k, b: [k, k + 1], c: { d: "x" + k } });
      expect(made.b).toContain(k);
      expect(JSON.stringify(made)).toMatch(/x\\d+/);
      expect(() => {
        if (k >= 0) throw new Error("e" + k);
      }).toThrow("e" + k);
    });
  test("async", async () => expect(await Promise.resolve(${file})).toBe(${file}));
});
`;
const moduleCount = 300;
const moduleFile = (index: number) => {
  const imported = [...new Set([index >> 1, Math.floor(index / 3), index - 1])].filter(
    other => other >= 0 && other !== index,
  );
  return `${imported.map(other => `import { v${other} } from "./m${other}";\nimport type { C${other} } from "./m${other}";`).join("\n")}
interface Shape { id: number; name?: string; tags: readonly string[] }
enum Kind { A = 1, B, C }
function work(x: number): number { let total: number = 0; for (let k = 0; k < 3; k++) total += x + k; const shape: Shape = { id: total, tags: [] }; return (shape as Partial<Shape>).id! + Kind.A - 1; }
${Array.from({ length: 12 }, (_, k) => `export function unused${k}<T extends number>(a: T, b: T): number { if (a > b) return a - b; const list: number[] = [a, b, ${k}]; return list.map((v: number): number => v * 2).filter(Boolean).length; }`).join("\n")}
export class C${index} { constructor(private readonly a: number, public b = ${index}) {} get sum(): number { return this.a + this.b; } }
export const v${index}: number = work(${index})${imported.map(other => ` + (v${other} % 7)`).join("")};
`;
};
const toolFiles = {
  ...Object.fromEntries(Array.from({ length: 10 }, (_, file) => [`tests/file-${file}.test.ts`, testFile(file)])),
  ...Object.fromEntries(Array.from({ length: moduleCount }, (_, index) => [`modules/m${index}.ts`, moduleFile(index)])),
  "modules/main.ts": `import { v${moduleCount - 1} } from "./m${moduleCount - 1}";\nconsole.log("modules", v${moduleCount - 1});`,
};
const tiers = { interpreter: "BUN_JSC_useJIT", jit: "BUN_JSC_useConcurrentJIT" };
const environment: Record<string, string | undefined> = startEnvironment;

if (!measurable)
  console.error("SKIPPED: test/aot/perf/plain-bun-costs.test.ts: its numbers are of a release build for Linux x64");

function entriesAbove(folder: string) {
  let entries = 0;
  for (let above = folder; ; above = dirname(above)) {
    try {
      entries += readdirSync(above).length;
    } catch {}
    if (above === dirname(above)) return entries;
  }
}

function isWritable(folder: string) {
  try {
    accessSync(folder, constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function folderWithTheFewestEntriesAbove() {
  const [quietest] = [tmpdir(), "/var/tmp", "/dev/shm"]
    .filter(isWritable)
    .map(folder => realpathSync(folder))
    .map(folder => ({ folder, entries: entriesAbove(folder) }))
    .sort((a, b) => a.entries - b.entries);
  return quietest;
}

const failures: string[] = [];
const table: string[] = [];
let countersWork = true;

async function row(name: string, command: string[], until: Until) {
  if (!countersWork) return;
  const budget = budgets[name];
  const { thousandInstructions, pageFaults } = await measureUntilWithinBounds(
    name,
    () => measureStart(command, until, 3),
    ({ thousandInstructions = 0, pageFaults = 0 }) =>
      !budget ||
      (thousandInstructions <= budget.thousandInstructions * mostInstructions(name) &&
        pageFaults <= budget.pageFaults * mostPageFaults),
  );
  if (thousandInstructions === undefined || pageFaults === undefined) {
    countersWork = false;
    return;
  }
  const peakKilobytes =
    "prints" in until
      ? await measureUntilWithinBounds(
          name,
          async () => Math.round((await runCommandMaxRSS({ cmd: command, cwd: "/", env: environment })).maxRSS / 1024),
          peak => peak <= (budget?.peakKilobytes ?? Infinity) * mostPeakMemory,
        )
      : undefined;
  const now: Cost = { thousandInstructions, pageFaults, peakKilobytes };
  const percent = (a: number, b: number | undefined) =>
    (b === undefined ? "new" : `${a >= b ? "+" : ""}${((a / b - 1) * 100).toFixed(1)}%`).padStart(7);
  table.push(
    `${name.padEnd(44)} ${String(thousandInstructions).padStart(10)} K ${percent(thousandInstructions, budget?.thousandInstructions)} ${String(pageFaults).padStart(7)} faults ${percent(pageFaults, budget?.pageFaults)}` +
      (peakKilobytes === undefined
        ? ""
        : ` ${String(peakKilobytes).padStart(8)} KB ${percent(peakKilobytes, budget?.peakKilobytes)}`),
  );
  if (mode === "accept" || !budget) budgets[name] = now;
  else if (mode === "add") budgets[name] = { ...now, ...budget };
  else if (mode === "lower")
    budgets[name] = {
      thousandInstructions: Math.min(budget.thousandInstructions, thousandInstructions),
      pageFaults: Math.min(budget.pageFaults, pageFaults),
      peakKilobytes:
        peakKilobytes === undefined ? undefined : Math.min(budget.peakKilobytes ?? Infinity, peakKilobytes),
    };
  if (!budget || mode === "accept" || mode === "lower") return;
  if (thousandInstructions > budget.thousandInstructions * mostInstructions(name))
    failures.push(`${name}: ${thousandInstructions} K instructions; the file has ${budget.thousandInstructions} K`);
  if (pageFaults > budget.pageFaults * mostPageFaults)
    failures.push(`${name}: ${pageFaults} page faults; the file has ${budget.pageFaults}`);
  if (
    peakKilobytes !== undefined &&
    budget.peakKilobytes !== undefined &&
    peakKilobytes > budget.peakKilobytes * mostPeakMemory
  )
    failures.push(`${name}: ${peakKilobytes} KB at its peak; the file has ${budget.peakKilobytes} KB`);
}

test.skipIf(!measurable)(
  "a program that never asks for the compiler costs what it did",
  async () => {
    const { folder, entries: entriesAboveThePrograms } = folderWithTheFewestEntriesAbove();
    const dir = withoutInstallingPackages(mkdtempSync(join(folder, "plain-bun-costs_")));
    using removed = { [Symbol.dispose]: () => rmSync(dir, { recursive: true, force: true }) };
    makeTreeSync(dir, { ...startFiles, ...toolFiles });
    const bun = join(String(dir), "bun");
    symlinkSync(bunExe(), bun);
    for (const [file, until] of startRows) await row(`start ${file}`, [bun, join(String(dir), file)], until);
    for (const file of readdirSync(programs).sort()) {
      if (!file.endsWith(".js")) continue;
      const expected = readFileSync(join(programs, file.replace(/\.js$/, ".expected.txt")), "utf8");
      for (const [tier, option] of Object.entries(tiers)) {
        environment[option] = "0";
        try {
          await row(`${tier} ${file}`, [bun, join(programs, file)], { prints: expected });
        } finally {
          delete environment[option];
        }
      }
    }
    const tools: [string, string[]][] = [
      ["bun test", [bun, "test", join(String(dir), "tests")]],
      [`${moduleCount} modules`, [bun, join(String(dir), "modules", "main.ts")]],
    ];
    for (const [name, command] of tools) {
      const prints = Bun.spawnSync({
        cmd: command,
        cwd: "/",
        env: environment,
        stdout: "pipe",
        stderr: "ignore",
      }).stdout.toString();
      for (const [tier, option] of Object.entries(tiers)) {
        environment[option] = "0";
        try {
          await row(`${tier} ${name}`, command, { prints });
        } finally {
          delete environment[option];
        }
      }
    }
    console.error(table.join("\n"));
    console.error(
      `${entriesAboveThePrograms} entries in the folders above ${dir}; the file was written below ${entriesAboveWhenWritten}`,
    );
    if (!countersWork) {
      console.error("SKIPPED: test/aot/perf/plain-bun-costs.test.ts: perf_event_open may not be used here");
      const deadline = performance.now() + 120_000;
      for (const [file, until] of startRows.slice(0, 2)) {
        if (!("prints" in until)) continue;
        const stepped = await steppedStart([bun, join(dir, file)], until.prints, 2, deadline);
        if ("notCounted" in stepped)
          return console.error(`SKIPPED: test/aot/perf/plain-bun-costs.test.ts: ${stepped.notCounted}`);
        const written = budgets[`start ${file}`]?.thousandInstructions;
        console.error(
          `start ${file}: ${stepped.thousandSteps} K single steps; the file has ${written} K instructions. Not judged.`,
        );
      }
      return;
    }
    if (mode === "accept" || mode === "lower" || mode === "add")
      writeFileSync(
        budgetsPath,
        JSON.stringify(
          {
            entriesAboveThePrograms:
              mode === "accept" ? entriesAboveThePrograms : Math.min(entriesAboveThePrograms, entriesAboveWhenWritten),
            ...budgets,
          },
          null,
          2,
        ) + "\n",
      );
    if (failures.some(failure => failure.startsWith("start ")) && entriesAboveThePrograms > entriesAboveWhenWritten)
      failures.push(
        `${entriesAboveThePrograms} entries in the folders above ${folder}; the file was written below ${entriesAboveWhenWritten}`,
      );
    if (judged) expect(failures).toEqual([]);
  },
  600_000,
);

const compiledTwiceByTheTopTier: Record<string, string[]> = {
  "arrays.js": ["", "flatIntoArray"],
  "classes-and-closures.js": ["next", "performProxyObjectGet"],
  "collector.js": ["", "count", "tree"],
  "crypto.js": ["digest", "update"],
  "emit-to-one-listener.js": ["", "emit"],
  "emit-to-two-listeners.js": ["", "emit"],
  "language.js": ["language.js"],
  "streams-made.js": ["Duplex", "Readable", "_addListener", "get", "getHighWaterMark"],
  "waiting-ticks.js": ["read"],
};

test.skipIf(!measurable)(
  "the top tier compiles no function twice that it compiled once",
  () => {
    const more: Record<string, string[]> = {};
    for (const file of readdirSync(programs).sort()) {
      if (!file.endsWith(".js")) continue;
      const { stderr, exitCode } = Bun.spawnSync({
        cmd: [bunExe(), join(programs, file)],
        cwd: "/",
        env: { ...startEnvironment, BUN_JSC_useConcurrentJIT: "0", BUN_JSC_reportCompileTimes: "1" },
        stdout: "ignore",
        stderr: "pipe",
      });
      expect({ file, exitCode }).toEqual({ file, exitCode: 0 });
      const times = new Map<string, number>();
      for (const [, which] of stderr.toString().matchAll(/^Optimized (.*#\w+):\[.*\] using FTL with FTL /gm))
        times.set(which, (times.get(which) ?? 0) + 1);
      const twice = [...times].filter(([, count]) => count > 1).map(([which]) => basename(which).replace(/#\w+$/, ""));
      const unexpected = twice.filter(name => !compiledTwiceByTheTopTier[file]?.includes(name));
      if (unexpected.length) more[file] = unexpected;
    }
    expect(more).toEqual({});
  },
  300_000,
);
