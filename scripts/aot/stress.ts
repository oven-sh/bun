#!/usr/bin/env bun
// Runs WebKit's JSTests/stress through `bun build --compile --compile-aot`, and compares each test with itself in the same
// build without ahead-of-time compilation (BUN_AOT=0).
//
//   bun scripts/aot/stress.ts --bun <bun> --tests <WebKit>/JSTests/stress --out <directory>
//       [--runtime <bun-slim>] [--jobs 6] [--batch 50] [--limit <n>] [--only <regex of file names>]
//
// Tests are built in batches, one executable for each batch and configuration. A batch that cannot be built is halved
// until the test that is at fault is alone. A test counts only if it passes in the reference.
//
// Writes <out>/results.tsv: test, verdict, detail. A run that is interrupted goes on from there. Verdicts:
//   excluded, unbuildable-reference   not a test of ahead-of-time compilation
//   same-*                            the same exit code and output
//   BUILD-CRASH-*                     the compiler crashed
//   DIFFERS-*                         and then one of:
//     CRASH                           alone in its bundle, it ends with a signal that a program gets for a fault
//     only-in-a-batch                 the same once the test is alone in its bundle, in the reference too. What a test
//                                     sees of its bundle depends on the other tests in it: the bundler renames what
//                                     collides, and an error that is printed has line numbers. The reference of a batch
//                                     may have been built from more tests, or from fewer
//     REAL                            a bug
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    bun: { type: "string" },
    tests: { type: "string" },
    out: { type: "string" },
    runtime: { type: "string" },
    jobs: { type: "string", default: "6" },
    batch: { type: "string", default: "50" },
    limit: { type: "string", default: "0" },
    only: { type: "string", default: "" },
  },
});
if (!args.bun || !args.tests || !args.out) {
  console.error("usage: bun scripts/aot/stress.ts --bun <bun> --tests <WebKit>/JSTests/stress --out <directory>");
  process.exit(1);
}
const bun = resolve(args.bun);
const tests = resolve(args.tests);
const out = resolve(args.out);
const results = join(out, "results.tsv");
mkdirSync(out, { recursive: true });

// What only the jsc shell can run.
const needsShell = new RegExp(
  // prettier-ignore
  [
    /\$vm\b/, /\bload\(/, /createGlobalObject/, /runString/, /\bagent\./, /transferArrayBuffer/, /OSRExit\(/,
    /checkModuleSyntax/, /checkScriptSyntax/, /readFile/, /numberOfDFGCompiles/, /\bdescribe\(/, /describeArray/,
    /^\s*import\s/, /^\s*export\s/, /\/\/@ skip\b/, /asyncTestStart/, /\$262/, /reoptimizationRetryCount/,
    /hasOwnLengthProperty/, /createProxy\(/, /createRuntimeArray/, /createBuiltin/, /makeMasquerader/,
    /getHiddenValue/, /setHiddenValue/, /functionOverrides/, /callerSourceOrigin/, /dumpTypesForAllVariables/,
    /findTypeForExpression/, /returnTypeFor/, /hasBasicBlockExecuted/, /basicBlockExecutionCount/,
    /enableExceptionFuzz/, /startSamplingProfiler/, /samplingProfilerStackTraces/, /generateHeapSnapshot/,
    /setGlobalConstRedeclarationShouldNotThrow/, /isPureNaN/, /isInt32\(/, /isRope\(/, /effectful42/, /createCustom/,
    /createDOMJIT/, /createImpureGetter/, /setImpureGetterDelegate/, /flashHeapAccess/, /releaseWeakRefs/,
    /shadowChickenFunctionsOnStack/, /setShadowChicken/, /platformSupportsSamplingProfiler/, /resetJITSizeStatistics/,
    /memoryUsage\(/, /totalCompileTime/, /version\(\)/, /quit\(/, /abort\(/, /\brun\(/, /readline\(/, /setTimeZone/,
    /waitForReport/, /dollarVM/, /Loader\b/, /haveABadTime/,
  ].map(pattern => pattern.source).join("|"),
  "m",
);

type Kind = "reference" | "aot" | "validated";
const kinds: Record<Kind, { build: Record<string, string>; run: Record<string, string> }> = {
  "reference": {
    build: { BUN_AOT: "0" },
    run: { BUN_JSC_useImmutableIntrinsics: "1", BUN_JSC_hideTextOfFunctionsForTesting: "1" },
  },
  "aot": { build: {}, run: {} },
  "validated": { build: { BUN_AOT_OPTIONS: "validateAOTInferredTypes=1" }, run: {} },
};

const environment = { ...process.env, BUN_ENABLE_CRASH_REPORTING: "0", NO_COLOR: "1" } as Record<string, string>;

type Outcome = { code: number; stdout: string; stderr: string };
// Nothing runs without a memory cap: a compiler bug can allocate until the machine swaps.
function run(command: string[], env: Record<string, string>, seconds: number): Promise<Outcome> {
  return new Promise(done => {
    // `env` is for the command alone: the Bun that runs capped.ts may not know a BUN_JSC_ option, and would not start.
    const assignments = Object.entries(env).map(([name, value]) => `${name}=${value}`);
    const child = spawn(
      process.execPath,
      [join(import.meta.dir, "capped.ts"), "6", String(seconds), "/usr/bin/env", ...assignments, ...command],
      { env: environment, stdio: ["ignore", "pipe", "pipe"] },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    // One test prints a string of 2 GB. What is past the limit is dropped, and the run counts as failed.
    let room = 16 * 2 ** 20;
    const keepIn = (chunks: Buffer[]) => (chunk: Buffer) => void ((room -= chunk.length) >= 0 && chunks.push(chunk));
    child.stdout.on("data", keepIn(stdout));
    child.stderr.on("data", keepIn(stderr));
    child.on("close", code =>
      done({
        code: room < 0 ? -2 : (code ?? -1),
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr)
          .toString()
          .replace(/\n?\[capped\] peak .*\n$/, ""),
      }),
    );
  });
}

const verdicts = new Map<string, string>();
function record(test: string, verdict: string, detail = "") {
  verdicts.set(test, verdict);
  appendFileSync(results, `${test}\t${verdict}\t${detail.replace(/\t/g, " ").replace(/\n/g, " | ").slice(0, 1500)}\n`);
}

async function build(batch: string[], kind: Kind, directory: string) {
  mkdirSync(directory, { recursive: true });
  const main = join(directory, "main.js");
  writeFileSync(
    main,
    `import ${JSON.stringify(join(import.meta.dir, "stress-prelude.js"))};\nswitch (process.argv[2]) {\n` +
      batch
        .map(test => `case ${JSON.stringify(test)}: require(${JSON.stringify(join(tests, test))}); break;\n`)
        .join("") +
      `default: throw new Error("no such test");\n}\n`,
  );
  const executable = join(directory, "executable");
  rmSync(executable, { force: true });
  const built = await run(
    [
      bun,
      "build",
      "--compile",
      "--compile-aot",
      "--format=esm",
      ...(args.runtime ? [`--compile-executable-path=${resolve(args.runtime)}`] : []),
      main,
      "--outfile",
      executable,
    ],
    kinds[kind].build,
    900,
  );
  if (built.code !== 0 || !existsSync(executable)) return { why: built };
  if (kind === "reference") {
    // One test with an early error that the bundler lets through keeps the whole bundle from loading.
    const loaded = await run([executable, "--none--"], kinds[kind].run, 60);
    if (!loaded.stderr.includes("no such test")) return { why: { ...loaded, code: 1 } };
  }
  return { executable };
}

async function buildable(
  batch: string[],
  kind: Kind,
  directory: string,
): Promise<{ executable: string; batch: string[] }[]> {
  if (!batch.length) return [];
  const { executable, why } = await build(batch, kind, directory);
  if (executable) return [{ executable, batch }];
  if (batch.length === 1) {
    const text = why!.stdout + why!.stderr;
    const crashed = kind !== "reference" && (why!.code !== 1 || /ASSERT|panic|signal/i.test(text));
    record(batch[0], `${crashed ? "BUILD-CRASH" : "unbuildable"}-${kind}`, `exit=${why!.code} ${text.slice(-700)}`);
    return [];
  }
  const half = batch.length >> 1;
  return [
    ...(await buildable(batch.slice(0, half), kind, join(directory, "a"))),
    ...(await buildable(batch.slice(half), kind, join(directory, "b"))),
  ];
}

async function runBatch(number: number, batch: string[]) {
  const directory = join(out, `batch-${number}`);
  const { bavail, bsize } = statfsSync(out);
  if (bavail * bsize < 10 * 2 ** 30) throw new Error("less than 10 GB free: stopping");
  try {
    const reference = new Map<string, Outcome>();
    for (const { executable, batch: built } of await buildable(batch, "reference", join(directory, "reference"))) {
      for (const test of built) {
        const outcome = await run([executable, test], kinds.reference.run, 60);
        if (outcome.code === 0) reference.set(test, outcome);
        else record(test, "excluded", `exit=${outcome.code} ${outcome.stderr.slice(-160)}`);
      }
      rmSync(executable);
    }
    const differing = new Set<string>();
    for (const kind of ["aot", "validated"] as const) {
      for (const { executable, batch: built } of await buildable([...reference.keys()], kind, join(directory, kind))) {
        for (const test of built) {
          const outcome = await run([executable, test], kinds[kind].run, 120);
          const sameOutput = outcome.stdout === reference.get(test)!.stdout;
          if (outcome.code === 0 && sameOutput) record(test, `same-${kind}`);
          else {
            differing.add(test);
            record(
              test,
              `DIFFERS-${kind}`,
              `exit=${outcome.code} stdout ${sameOutput ? "same" : "differs"} | ${outcome.stderr.slice(-900)}`,
            );
          }
        }
        rmSync(executable);
      }
    }
    // From here on each test is alone in its bundle, in the reference too.
    for (const test of [...differing].sort()) {
      const alone = async (kind: Kind) => {
        const [built] = await buildable([test], kind, join(directory, `${kind}-alone`));
        if (!built) return undefined;
        const outcome = await run([built.executable, test], kinds[kind].run, 120);
        rmSync(built.executable);
        return outcome;
      };
      const expected = await alone("reference");
      const isSame = (outcome?: Outcome) =>
        !!outcome && !!expected && outcome.code === 0 && outcome.stdout === expected.stdout;
      const compiled = await alone("aot");
      if (isSame(compiled)) {
        record(test, "only-in-a-batch");
        continue;
      }
      // SIGILL, SIGTRAP, SIGABRT, SIGBUS, SIGSEGV. (137 is the memory cap or the time limit.)
      if (compiled && [132, 133, 134, 138, 139].includes(compiled.code)) {
        record(test, "CRASH", `exit=${compiled.code} | ${compiled.stderr.slice(-600)}`);
        continue;
      }
      record(test, "REAL", `exit=${compiled?.code} | ${compiled?.stderr.slice(-600)}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const stale of readdirSync(out)) {
  if (/^batch-\d+$/.test(stale)) rmSync(join(out, stale), { recursive: true, force: true });
}

const seen = new Map<string, string[]>();
if (existsSync(results)) {
  for (const line of readFileSync(results, "utf8").split("\n")) {
    const [test, verdict] = line.split("\t");
    if (verdict) seen.set(test, [...(seen.get(test) ?? []), verdict]);
  }
}
const isDone = (verdicts: string[]) =>
  verdicts.some(verdict => verdict === "excluded" || verdict === "unbuildable-reference") ||
  (verdicts.some(verdict => verdict.endsWith("-aot")) && verdicts.some(verdict => verdict.endsWith("-validated")));

const only = args.only ? new RegExp(args.only) : undefined;
let skipped = 0;
let todo = readdirSync(tests)
  .filter(name => name.endsWith(".js") && (!only || only.test(name)) && !isDone(seen.get(name) ?? []))
  .sort()
  .filter(name => !needsShell.test(readFileSync(join(tests, name), "utf8")) || (skipped++, false));
if (+args.limit) todo = todo.slice(0, +args.limit);
console.log(`${todo.length} tests to run, ${skipped} need the jsc shell and are skipped`);

const batches: string[][] = [];
for (let at = 0; at < todo.length; at += +args.batch) batches.push(todo.slice(at, at + +args.batch));
let next = 0;
let finished = 0;
await Promise.all(
  Array.from({ length: +args.jobs }, async () => {
    while (next < batches.length) {
      const number = next++;
      await runBatch(number, batches[number]);
      if (++finished % 5 === 0) console.log(`${finished} of ${batches.length} batches`);
    }
  }),
);

const counts: Record<string, number> = {};
for (const verdict of verdicts.values()) counts[verdict] = (counts[verdict] ?? 0) + 1;
console.log(counts);
for (const [test, verdict] of verdicts) {
  if (verdict === "REAL" || verdict === "CRASH" || verdict.startsWith("BUILD-CRASH"))
    console.log(`${verdict}\t${test}`);
}
process.exitCode = Object.keys(counts).some(
  verdict => verdict === "REAL" || verdict === "CRASH" || verdict.startsWith("BUILD-CRASH"),
)
  ? 1
  : 0;
