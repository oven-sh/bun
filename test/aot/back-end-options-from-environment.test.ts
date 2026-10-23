// The environment does not change the code a release build of Bun compiles: with BUN_JSC_* options of B3, Air and the macro assembler set, the
// executable is the same, byte for byte.
import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { spawned, unsupported } from "./run-programs";

const program = join(import.meta.dir, "programs/classes-and-closures/structural-subtypes.ts");

// Each has a value that is not its default.
const backEndOptions = {
  BUN_JSC_defaultB3OptLevel: "1",
  BUN_JSC_wasmOMGOptimizationLevel: "1",
  BUN_JSC_useB3TailDup: "0",
  BUN_JSC_maxB3TailDupBlockSize: "1",
  BUN_JSC_maxB3TailDupBlockSuccessors: "1",
  BUN_JSC_useB3HoistLoopInvariantValues: "0",
  BUN_JSC_useB3CanonicalizePrePostIncrements: "1",
  BUN_JSC_useB3EliminateWasmGCAllocations: "0",
  BUN_JSC_maxB3WasmGCEpochSnapshotEntries: "1",
  BUN_JSC_useB3SpecializeSelect: "0",
  BUN_JSC_rareBlockPenalty: "1",
  BUN_JSC_airGreedyRegAllocSplitMultiplier: "4",
  BUN_JSC_airGreedyRegAllocSplitAroundLoops: "1",
  BUN_JSC_airGreedyRegAllocLoopSplitMaxLoopFraction: "0.25",
  BUN_JSC_airGreedyRegAllocSpillsEverything: "1",
  BUN_JSC_airRandomizeRegs: "1",
  BUN_JSC_airRandomizeRegsSeed: "7",
  BUN_JSC_coalesceSpillSlots: "0",
  BUN_JSC_useAirOptimizePairedLoadStore: "0",
  BUN_JSC_useArchitectureSpecificOptimizations: "0",
  BUN_JSC_useJITDebugAssertions: "1",
};

async function hashOfBuild(folder: string, name: string, env: Record<string, string>) {
  const executable = join(folder, name, isWindows ? "program.exe" : "program");
  mkdirSync(dirname(executable), { recursive: true });
  const build = await spawned(
    [bunExe(), "build", "--compile", "--aot", program, "--outfile", executable],
    dirname(program),
    { ...bunEnv, ...env },
  );
  expect({ stderr: build.stderr, exitCode: build.exitCode, signal: build.signal }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
    signal: null,
  });
  return new Bun.CryptoHasher("sha256").update(await Bun.file(executable).bytes()).digest("hex");
}

describe("compile/aot/back-end options from the environment", () => {
  if (unsupported) return void test.skip(unsupported, () => {});

  test.skipIf(isDebug)(
    "a release build of Bun ignores them",
    async () => {
      using folder = tempDir("aot-back-end-options", {});
      const [reference, changed] = await Promise.all([
        hashOfBuild(String(folder), "reference", {}),
        hashOfBuild(String(folder), "changed", backEndOptions),
      ]);
      expect(changed).toBe(reference);
    },
    180_000,
  );
});
