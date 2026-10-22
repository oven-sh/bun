// Counts what the tests that the compiler put into a program do at run time, by source position.
//
// A program is built with --aot-count-branches, --aot-count-arrivals and an image map. Each side of each two-way branch then has a counter of its own, and
// the map says for each branch where it stands in the sources, what it tests, and which side the compiler laid out as the likely one.
// The program does a fixed amount of work twice, a little and a lot, and writes its counters when it exits. The difference between
// the two runs, divided by the units of work that lie between them, is what one unit costs, without the start of the program.
//
// The counts are exact. They depend on no clock, no machine and no load: two runs that differ are a bug to report.
//
//   executed   how often the branch ran
//   failed     how often it took the side that the compiler laid out as the less likely one; 0 where both sides are alike
//
// One place in the sources may stand in the image several times, inlined or in versions of a function. A row adds its copies up.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { BuildReport } from "./build-report";
import { buildEnvironment, compileCommand, runtimeEnvironment, withReport } from "./flags";

const likelihoods = ["Normal", "Unlikely", "Rare"] as const;
type Likelihood = (typeof likelihoods)[number];

export type Owner = "bun" | "packages" | "program";

interface Branch {
  whenTrue: number;
  whenFalse: number;
  path: string;
  position: number;
  kind: string;
  function: string;
  unlikelySide: "true" | "false" | undefined;
}

/** How often the compiler expects a compiled function to run. */
export const heats = { h: "hot", w: "warm", c: "cold", o: "once", u: "behindFailedTest" } as const;
export type Heat = (typeof heats)[keyof typeof heats];

interface Entry {
  counter: number;
  heat: Heat;
}

export interface CountedBuild {
  executable: string;
  branches: Branch[];
  entries: Entry[];
}

interface Counts {
  byCounter: Map<number, number>;
  accessesByName: number;
  runtimeOperations: Map<string, number>;
  cells: number;
  bytes: number;
  closures: number;
}

export interface CountedTest {
  owner: Owner;
  path: string;
  position: number;
  kind: string;
  /** The compiled functions that hold a copy of the test. */
  functions: string[];
  executed: number;
  failed: number;
  /** The part of `failed` that comes from copies of the test that never once passed. */
  failedEveryTime: number;
}

export interface CountedWork {
  tests: CountedTest[];
  /** Tests whose counts are no whole multiple of the units of work: something other than the work decides them. */
  uneven: CountedTest[];
  /** Calls of compiled functions, by how often the compiler expected the function to run. */
  calls: Record<Heat, number>;
  /** Accesses that looked a property up by its name or by a key, in a stub or in the run time, instead of loading a slot. */
  accessesByName: number;
  /**
   * Calls out of compiled code and its stubs into functions of the run time, by function, to the nearest whole number. A free list
   * that is used up, and a cache whose places follow from addresses, send a call there once in some units of work.
   */
  runtimeOperations: Record<string, number>;
  /** What compiled code and its stubs allocate: every cell is counted before the free list is looked at. What the run time allocates in C++ is not in it. */
  allocated: { cells: number; bytes: number };
  /** The function objects made: in a unit of work, and in the rest of a run, which is the start and what only the first units do. */
  closures: { each: number; once: number };
}

export interface Exchange {
  method: string;
  path: string;
  body?: string;
  expected: { status: number; type: string; body: string };
}

const buildTimeout = 600_000;

// A collection drops what the run time has learned about some places, and their tests fail and their accesses go the long way until
// it has learned it again. When a collection comes depends on the clock: Bun collects once a second while the heap grows, and
// JavaScriptCore after a time that follows from what was allocated. So the counted runs have none: no timer, and a heap that may
// grow to two gigabytes before the first one. What is counted is the steady state between two collections.
export const withoutCollections = {
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_smallHeapSize: "2000000000",
  BUN_JSC_largeHeapSize: "2000000000",
};

// For a run whose instructions are counted. Collections come when so much has been allocated and at no other time, and the thread of the program does all
// their work while the program stands still. Otherwise what the collector's threads get done beside the program differs by some percent from run to run.
export const withSteadyCollections = {
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_numberOfGCMarkers: "1",
};

/** Like `spawned` of ../run-programs, for what takes minutes on a busy machine: the build of a server, or of its pages. */
export async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: buildTimeout, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}

function expectBuilt(build: { stderr: string; exitCode: number }) {
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
}

const executableName = (name: string) => name + (isWindows ? ".exe" : "");

/** A path as it stands in the map, without what differs from one checkout or installation to the next. */
export function portablePath(path: string) {
  const inPackages = path.lastIndexOf("node_modules/");
  return inPackages < 0 ? path : path.slice(inPackages);
}

export function ownerOf(path: string): Owner {
  if (path.includes("node_modules/")) return "packages";
  return /\.[cm]?[jt]sx?$/.test(path) ? "program" : "bun";
}

function unlikelySideOf(whenTrue: Likelihood, whenFalse: Likelihood) {
  const difference = likelihoods.indexOf(whenTrue) - likelihoods.indexOf(whenFalse);
  return difference === 0 ? undefined : difference > 0 ? "true" : "false";
}

// An entrance hands every call on to the body behind it, and an outlined body is a piece of whoever calls it: neither is a call.
const isCalledByTheProgram = (role: string) => role !== "outlined" && !role.includes("wrapper") && !role.startsWith("generic-");

export function parseMap(map: string) {
  const branches: Branch[] = [];
  const entries: Entry[] = [];
  let currentFunction = "-";
  let currentRole = "";
  let currentHeat: Heat | undefined;
  let pending: string[] | undefined;
  for (const line of map.split("\n")) {
    if (line.startsWith("F\t")) {
      const fields = line.split("\t");
      currentFunction = fields[7] || "-";
      currentRole = fields[8];
      currentHeat = heats[fields[12] as keyof typeof heats];
    } else if (line.startsWith("QE\t")) {
      if (currentHeat && isCalledByTheProgram(currentRole)) entries.push({ counter: Number(line.split("\t")[1]), heat: currentHeat });
    } else if (line.startsWith("Q\t")) pending = line.split("\t");
    else if (line.startsWith("q\t") && pending) {
      const test = line.split("\t");
      if (test[1] === pending[1]) {
        branches.push({
          whenTrue: Number(pending[1]),
          whenFalse: Number(pending[2]),
          path: portablePath(pending[5]),
          position: Number(pending[4]),
          kind: test[2],
          function: currentFunction,
          unlikelySide: unlikelySideOf(test[3] as Likelihood, test[4] as Likelihood),
        });
      }
      pending = undefined;
    }
  }
  return { branches, entries };
}

// How --aot-count-arrivals counts: no call that the program would make without it.
const arrivalCounter = "operation:operationAOTRecordArrival";

// Every way in which a function object comes to be: compiled code that allocates one itself, the stubs that allocate one, those that
// copy one out of a frame for a callee that keeps it, and the functions of the run time that make one a call.
const closureAllocations = new Set(["closure", "stub:NewSlimClosure", "stub:NewClosure", "stub:CallValueLending", "stub:TakeOverClosure"]);
const closureOperations = new Set(["operationAOTMaterializeDeferredClosure", "operationAOTSingletonClosure", "operationAOTMoveClosureToHeap"]);

export function parseCounts(text: string): Counts {
  const counts: Counts = { byCounter: new Map(), accessesByName: 0, runtimeOperations: new Map(), cells: 0, bytes: 0, closures: 0 };
  for (const line of text.split("\n")) {
    if (line.startsWith("allocation ")) {
      const words = line.split(" ");
      counts.cells += Number(words.at(-2));
      counts.bytes += Number(words.at(-1));
      if (closureAllocations.has(words.at(-3)!)) counts.closures += Number(words.at(-2));
      continue;
    }
    const [count, what] = line.split("\t");
    if (what?.startsWith("branch:")) counts.byCounter.set(Number(what.slice("branch:".length)), Number(count));
    else if (what?.startsWith("arrival:")) counts.accessesByName += Number(count);
    else if (what?.startsWith("operation:") && what !== arrivalCounter) {
      const operation = what.slice("operation:".length);
      counts.runtimeOperations.set(operation, Number(count));
      if (closureOperations.has(operation)) counts.closures += Number(count);
    }
  }
  return counts;
}

/** Builds `entry` with a counter on each side of each branch. */
export async function buildCounted(folder: string, entry: string, flags: string[] = []): Promise<CountedBuild> {
  const name = basename(entry).replace(/\.[^.]+$/, "");
  const executable = join(folder, executableName(`${name}-counted`));
  const map = join(folder, `${name}-counted.map`);
  const command = [bunExe(), ...compileCommand, "--aot-count-branches", "--aot-count-arrivals", ...flags, entry, "--outfile", executable];
  expectBuilt(await run(command, folder, { ...bunEnv, NO_COLOR: "1", [buildEnvironment.mapFilePath]: map }));
  const { branches, entries } = parseMap(readFileSync(map, "utf8"));
  rmSync(map);
  expect(Math.min(branches.length, entries.length)).toBeGreaterThan(0);
  return { executable, branches, entries };
}

/**
 * The machine code in the image of `entry` built the way a user builds it: its bytes, and the bytes that one value of the program
 * costs. A value is an operation of a source function as the compiler first reads it; its bytes are those of every compiled function
 * made from that source function, versions, entrances and copies alike. Only source functions of 10 to 300 values count: smaller
 * ones are mostly entrance and exit, and a few huge ones would decide the number.
 */
export async function codeOf(folder: string, entry: string, flags: string[] = []) {
  const name = basename(entry).replace(/\.[^.]+$/, "");
  const executable = join(folder, executableName(`${name}-plain`));
  const path = join(folder, `${name}-plain.json`);
  expectBuilt(await run([bunExe(), ...compileCommand, ...withReport(path, "functions"), ...flags, entry, "--outfile", executable], folder, { ...bunEnv, NO_COLOR: "1" }));
  const report: BuildReport = JSON.parse(readFileSync(path, "utf8"));
  rmSync(executable);
  rmSync(path);
  expect(report.summary.codeBytes).toBeGreaterThan(0);

  const bySource = new Map<string, { values: number; bytes: number }>();
  for (const compiled of report.functions ?? []) {
    if (compiled.valuesAsRead == null) continue;
    const key = `${compiled.file}:${compiled.line}:${compiled.column}`;
    const source = bySource.get(key) ?? { values: compiled.valuesAsRead, bytes: 0 };
    source.bytes += compiled.codeBytes;
    bySource.set(key, source);
  }
  let values = 0;
  let bytes = 0;
  for (const source of bySource.values()) {
    if (source.values < 10 || source.values > 300) continue;
    values += source.values;
    bytes += source.bytes;
  }
  return { codeBytes: report.summary.codeBytes, bytesAValue: values ? Math.round((100 * bytes) / values) / 100 : undefined };
}

/** What one unit of work costs: the run with more work less the run with less, which did `unitsOfLess`, divided by the `units` between them. */
export function tabulate({ branches, entries }: CountedBuild, less: Counts, more: Counts, units: number, unitsOfLess = 0): CountedWork {
  const between = (counter: number) => (more.byCounter.get(counter) ?? 0) - (less.byCounter.get(counter) ?? 0);
  const byPlace = new Map<string, CountedTest & { names: Set<string> }>();
  for (const branch of branches) {
    const taken = between(branch.whenTrue);
    const notTaken = between(branch.whenFalse);
    if (taken === 0 && notTaken === 0) continue;
    const key = `${branch.path}\t${branch.position}\t${branch.kind}`;
    let test = byPlace.get(key);
    if (!test) {
      test = { owner: ownerOf(branch.path), path: branch.path, position: branch.position, kind: branch.kind, functions: [], names: new Set(), executed: 0, failed: 0, failedEveryTime: 0 };
      byPlace.set(key, test);
    }
    test.names.add(branch.function);
    test.executed += taken + notTaken;
    const failed = branch.unlikelySide === "true" ? taken : branch.unlikelySide === "false" ? notTaken : 0;
    test.failed += failed;
    if (failed === taken + notTaken) test.failedEveryTime += failed;
  }
  const closures = (more.closures - less.closures) / units;
  const work: CountedWork = {
    tests: [],
    uneven: [],
    calls: { hot: 0, warm: 0, cold: 0, once: 0, behindFailedTest: 0 },
    accessesByName: (more.accessesByName - less.accessesByName) / units,
    runtimeOperations: {},
    allocated: { cells: (more.cells - less.cells) / units, bytes: (more.bytes - less.bytes) / units },
    closures: { each: closures, once: Math.round(100 * (less.closures - unitsOfLess * closures)) / 100 },
  };
  for (const entry of entries) work.calls[entry.heat] += between(entry.counter) / units;
  for (const [operation, count] of [...more.runtimeOperations].sort()) {
    const each = Math.round((count - (less.runtimeOperations.get(operation) ?? 0)) / units);
    if (each) work.runtimeOperations[operation] = each;
  }
  for (const { names, ...test } of byPlace.values()) {
    const isWhole = test.executed % units === 0 && test.failed % units === 0;
    (isWhole ? work.tests : work.uneven).push({ ...test, functions: [...names].sort(), executed: test.executed / units, failed: test.failed / units, failedEveryTime: test.failedEveryTime / units });
  }
  const order = (a: CountedTest, b: CountedTest) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.position - b.position || (a.kind < b.kind ? -1 : 1));
  work.tests.sort(order);
  work.uneven.sort(order);
  return work;
}

async function serveRounds(executable: string, cwd: string, exchanges: Exchange[], rounds: number, counts: string) {
  const env = { ...bunEnv, ...withoutCollections, PORT: "0", NODE_ENV: "production", [runtimeEnvironment.forbidsInterpreter]: "1", [runtimeEnvironment.countsPath]: counts };
  await using proc = Bun.spawn({ cmd: [executable], cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: buildTimeout, killSignal: "SIGKILL" });
  const errors = proc.stderr.text();
  let output = "";
  let origin: string | undefined;
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    output += chunk;
    const port = /^listening (\d+)$/m.exec(output)?.[1];
    if (port) {
      origin = `http://127.0.0.1:${port}`;
      break;
    }
  }
  if (!origin) throw new Error(`${executable} exited with code ${await proc.exited} before listening:\n${await errors}`);
  for (let round = 0; round < rounds; round++) {
    for (const { method, path, body, expected } of exchanges) {
      const response = await fetch(origin + path, { redirect: "manual", method, body, headers: body === undefined ? {} : { "Content-Type": "application/json" } });
      const answer = { status: response.status, type: response.headers.get("Content-Type")?.split(";")[0]!.trim().toLowerCase(), body: await response.text() };
      if (!Bun.deepEquals(answer, expected)) expect({ round, method, path, ...answer }).toEqual({ round, method, path, ...expected });
    }
  }
  proc.kill("SIGTERM");
  expect({ exitCode: await proc.exited, signal: proc.signalCode }).toEqual({ exitCode: 0, signal: null });
  return parseCounts(readFileSync(counts, "utf8"));
}

/** Writes beside `entry` a copy of it that exits in the ordinary way, so that the counters are written, when it is told to end. */
export function entryThatExitsWhenTold(folder: string, entry: string) {
  const name = `told-to-end-${basename(entry)}`;
  writeFileSync(join(folder, name), `${readFileSync(join(folder, entry), "utf8")}\nprocess.on("SIGTERM", () => process.exit(0));\n`);
  return "./" + name;
}

/**
 * What one round of `exchanges` costs a server that prints `listening <port>`. Requests go one after the other over one connection,
 * and every answer is compared.
 */
export async function countServer(build: CountedBuild, cwd: string, exchanges: Exchange[], { warmUp = 40, rounds = 100, attempts = 5 } = {}) {
  // Some guards of node:http's and node:events' classes fail in the first requests of a start until they are set, and how often is
  // drawn at the start: 14 times in three starts of four, once or twice in the others. Two starts that drew alike cancel it, so every
  // start with less work is held against every start with more until two fit.
  const less: Counts[] = [];
  const more: Counts[] = [];
  for (let attempt = 1; ; attempt++) {
    less.push(await serveRounds(build.executable, cwd, exchanges, warmUp, build.executable + ".less.counts"));
    more.push(await serveRounds(build.executable, cwd, exchanges, warmUp + rounds, build.executable + ".more.counts"));
    const pairs = [...more.map(other => [less.at(-1)!, other] as const), ...less.slice(0, -1).map(other => [other, more.at(-1)!] as const)];
    const works = pairs.map(([a, b]) => tabulate(build, a, b, rounds, warmUp));
    const even = works.find(work => !work.uneven.length && Number.isInteger(work.accessesByName));
    if (even || attempt === attempts) return even ?? works[0];
    console.error(`${build.executable}: measured again: ${works[0].uneven.map(test => `${test.path}:${test.position} ${test.kind} ${test.executed}`).join(", ")}`);
  }
}

/** What one unit of work costs a program that takes the number of units as its argument, runs to its end and prints `expected`. */
export async function countScript(build: CountedBuild, cwd: string, expected: string, { warmUp = 40, units = 100 } = {}) {
  const counted = async (amount: number) => {
    const counts = `${build.executable}.${amount}.counts`;
    const ran = await run([build.executable, String(amount)], cwd, { ...bunEnv, ...withoutCollections, [runtimeEnvironment.forbidsInterpreter]: "1", [runtimeEnvironment.countsPath]: counts });
    expect(ran).toEqual({ stdout: expected, stderr: "", exitCode: 0, signal: null });
    return parseCounts(readFileSync(counts, "utf8"));
  };
  return tabulate(build, await counted(warmUp), await counted(warmUp + units), units, warmUp);
}

// What a program asks itself (`if (a < b)`) is its own business. These are the questions that the compiler added.
export const testsAddedByTheCompiler = new Set([
  "TypeTest",
  "ShapeTest",
  "IsSlotFilled",
  "AreMembersUnchanged",
  "HasLayoutPrototype",
  "HasNoExtraProperties",
  "HasNoFieldOutsideSlot",
  "HasBirthFieldsFilled",
  "HasKeyOrder",
  "HasArrayStorage",
  "HasJSType",
  "IsNotFrozen",
  "IsPristine",
  "IsClosureOf",
  "IsElementPresent",
  "IsInBounds",
]);

/** The tests of which some copy ran at least once a unit of work and took the unlikely side every time. */
export const alwaysFailing = (tests: CountedTest[]) => tests.filter(test => test.failedEveryTime >= 1);
