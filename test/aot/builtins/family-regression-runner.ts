// Runs the programs of family-regressions.test.ts and table-regressions.test.ts: once under plain Bun, then compiled in
// each build mode.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  expectCompiledOutput,
  hasTypes,
  slot,
  spawned,
  told,
  withoutDebugInformation,
  type RunResult,
} from "../run-programs";
import { describe, test, unsupported } from "../supported";

export type Regression = {
  name: string; // the entry point's file name
  covers: string; // the bug it reproduces, or the engine file it tests
  source: string; // the typed or untyped prelude is prepended
  files?: Record<string, string>; // additional entry points, used as is (a Worker's file)
  stressesCollector?: true; // also runs under GC stress and with verifyGC
  evaluatesText?: true; // evaluates text at run time, which the interpreter runs
  neverCalls?: string[]; // operations whose call count must stay 0
};
type BuildMode = [name: string, flags: string[]];

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    typeRoots: [join(import.meta.dir, "../../../packages")],
    types: ["bun-types"],
    noEmit: true,
  },
});
const buildModes: BuildMode[] = [
  ["compiled", []],
  ["types-erased", ["--aot-erase-types"]],
  ["validated", ["--aot-validate"]],
];
const stress = {
  BUN_JSC_slowPathAllocsBetweenGCs: "3",
  BUN_JSC_useEdenCollectionsAtSlowPathAllocs: "1",
  BUN_JSC_useZombieMode: "1",
  BUN_JSC_scribbleFreeCells: "1",
};
const untypedPrelude = `const show = value => (Object.is(value, -0) ? "-0" : typeof value === "string" || (typeof value === "object" && value !== null) ? JSON.stringify(value) : String(value));
const report = (label, probe) => { let text; try { text = show(probe()); } catch (error) { text = "threw " + error.constructor.name; } console.log(label + ": " + text); };
`;
const typedPrelude = `const show = (value: unknown): string => (Object.is(value, -0) ? "-0" : typeof value === "string" || (typeof value === "object" && value !== null) ? JSON.stringify(value) : String(value));
const report = (label: string, probe: () => unknown): void => { let text: string; try { text = show(probe()); } catch (error) { text = "threw " + (error as Error).constructor.name; } console.log(label + ": " + text); };
`;

const carrier = unsupported ? [] : withoutDebugInformation();

const fileNamesOf = (regression: Regression) => [regression.name, ...Object.keys(regression.files ?? {})];

function buildModesOf(regression: Regression) {
  const isTyped = fileNamesOf(regression).some(file => hasTypes(file));
  const modes = isASAN || isDebug ? buildModes.slice(0, 1) : buildModes;
  return modes.filter(([, flags]) => isTyped || !flags.includes("--aot-erase-types"));
}

function readCountedOperations(path: string) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map(line => line.split("\toperation:"))
    .filter(([count, operation]) => operation && count !== "0")
    .map(([, operation]) => operation);
}

async function checkCompiled(regression: Regression, cwd: string, [mode, flags]: BuildMode, expected: RunResult) {
  const counts = join(cwd, "counts-" + mode);
  // ../supported-with-counted-calls.ts says why nothing is counted on Windows.
  const neverCalls = isWindows ? undefined : regression.neverCalls;
  const tripwire = regression.evaluatesText ? {} : { BUN_JSC_crashIfInterpreterIsUsed: "1" };
  const environments: Record<string, string>[] = [{}];
  if (regression.stressesCollector) environments.push(stress, { BUN_JSC_verifyGC: "1" });
  if (neverCalls) environments.push({ BUN_JSC_aotCountsPath: counts });
  const program = {
    cwd,
    entryPoints: fileNamesOf(regression).map(file => "./" + file),
    carrier,
    buildFlags: flags,
    runEnvironments: environments.map(environment => ({ ...tripwire, ...environment })),
  };
  await expectCompiledOutput(mode, program, expected);
  if (!neverCalls) return;
  const counted = readCountedOperations(counts);
  expect(counted).not.toEqual([]);
  expect(counted.filter(operation => neverCalls.includes(operation))).toEqual([]);
}

async function check(regression: Regression) {
  using dir = tempDir("aot-family-regression", {
    "tsconfig.json": tsconfig,
    [regression.name]: (regression.name.endsWith(".ts") ? typedPrelude : untypedPrelude) + regression.source,
    ...regression.files,
  });
  const cwd = String(dir);
  const reference = await spawned([bunExe(), "run", regression.name], cwd, bunEnv);
  // A reference run that fails or prints nothing proves nothing.
  expect({
    signal: reference.signal,
    exitCode: reference.exitCode,
    stderr: reference.stderr,
    isSilent: reference.stdout === "",
  }).toEqual({ signal: null, exitCode: 0, stderr: "", isSilent: false });
  for (const buildMode of buildModesOf(regression)) await checkCompiled(regression, cwd, buildMode, told(reference));
}

export function runRegressions(title: string, regressions: Regression[]) {
  describe.concurrent(title, () => {
    for (const regression of regressions) {
      // The time limit also covers the wait for a free slot.
      test(`${regression.name} (${regression.covers})`, () => slot(() => check(regression)), 600_000);
    }
  });
}
