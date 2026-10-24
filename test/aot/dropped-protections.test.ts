// Tests the tests of what keeps an object alive that compiled code holds by a 32-bit reference alone.
//
// A typed object keeps most references in 32 bits. The collector's scan of the stack knows 64-bit pointers, so wherever compiled code holds such a reference over a place where the collector can run,
// the compiler puts the pointer beside it. Here each of those pointers is left out, one at a time, and something must notice:
//
//    at the build    --aot-check=validate-reference-guards rejects the program with NarrowReferenceWithoutPointer
//    at run time     the program dies or prints something else, with a collection at every allocation, every freed cell overwritten, and the second line of defense switched off by
//                    BUN_JSC_useNarrowReferenceScan=0: the scan in which the collector also takes each 32-bit half of a word on the stack for a reference. With that scan on it must run as before
//
// --aot-drop-guard=<Opcode>:<n> leaves out, in every function, the n-th pointer beside a reference that an operation of that opcode defines. Which there are is asked of the check itself:
// with all of them left out (--aot-testing=DropReferenceGuards) it names every reference that lacks one.
// A check that has gone blind shows here as "compiled". The run is no proof either way: a stale copy of the pointer may lie about. So only their number is stated.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned, withoutCoreDump, withoutCrashReport } from "./run-programs";
import { test } from "./supported";

// Between them they held about thirty such references when this was written, out of six operations: Compress, GetEnvironmentField, GetModuleVariable, GetSlot, GetSlotOrUndefined, Parameter.
// Three to nine of them went wrong at run time. Any change to the compiler may decode a reference earlier, and then it needs no pointer: so only the sums are stated, with much room.
const programs = [
  "collector/narrow-reference-held-across-integer-operations",
  "objects-inside-objects/inner-objects-meet-in-one-name",
  "typed-objects/compound-assignments",
  "typed-objects/constructor-first-stores-at-creation",
  "typed-objects/copied-record-is-not-cast-again",
  "typed-objects/function-read-before-arguments-any-receiver",
  "typed-objects/key-order-late-fields",
  "typed-objects/local-object-alive-until-reference-compare",
  "typed-objects/members-behind-a-view-are-filled-at-birth",
  "typed-objects/optional-reference-read-as-value",
  "typed-objects/tests-of-optional-fields-that-may-be-absent",
];
const leastNumberOfPointers = 12;
const leastNumberOfOperations = 3;
const leastNumberThatGoesWrong = 1;

const check = "--aot-check=validate-reference-guards";
const stress = {
  BUN_JSC_slowPathAllocsBetweenGCs: "1",
  BUN_JSC_useZombieMode: "1",
  BUN_JSC_scribbleFreeCells: "1",
  BUN_JSC_numberOfGCMarkers: "1",
  BUN_JSC_useConcurrentGC: "0",
};
const withoutScan = { BUN_JSC_useNarrowReferenceScan: "0" };

type Guard = { function: string; value: string; operation: string };

function guardsNamedBy(buildOutput: string): Guard[] {
  const named = new Map<string, Guard>();
  for (const [, fn, value, operation] of buildOutput.matchAll(
    /NarrowReferenceWithoutPointer: (?:'[^']*' \()?(f\d+)\)?: only the 32-bit reference (v\d+) \((\w+)\)/g,
  ))
    named.set(fn + value, { function: fn, value, operation });
  return [...named.values()];
}

const skipReason =
  isLinux && process.arch === "x64" && !isASAN && !isDebug
    ? undefined
    : "it is run on release builds for Linux x64, which show the most: with fewer registers, fewer stale copies of a pointer lie about";
const seen: { operation: string; goesWrong: boolean }[] = [];

test.skipIf(!!skipReason).concurrent.each(programs)(
  "every pointer left out beside a 32-bit reference is noticed: %s",
  async name => {
    const source = join(import.meta.dir, "programs", name + ".ts");
    using folder = tempDir("aot-dropped-protections", {});
    let builds = 0;
    const build = async (...flags: string[]) => {
      const executable = join(String(folder), "program-" + builds++);
      const result = await slot(() =>
        spawned(
          [bunExe(), "build", "--compile", "--aot", ...flags, source, "--outfile", executable],
          join(source, ".."),
          bunEnv,
        ),
      );
      return { ...result, executable };
    };
    const run = async (executable: string, env: Record<string, string>) => {
      const { stdout, exitCode, signal } = await slot(() =>
        spawned(withoutCoreDump([executable]), String(folder), { ...bunEnv, ...withoutCrashReport, ...stress, ...env }),
      );
      return { stdout, exitCode, signal };
    };
    // An executable is as large as Bun.
    const remove = (executable: string) => rmSync(executable, { force: true });

    const withoutAny = await build(check, "--aot-testing=DropReferenceGuards");
    remove(withoutAny.executable);
    const guards = guardsNamedBy(withoutAny.stderr);
    expect({ exitCode: withoutAny.exitCode, hasGuards: guards.length > 0 }).toBeOneOf([
      { exitCode: 1, hasGuards: true },
      { exitCode: 0, hasGuards: false },
    ]);

    // With ForceGCSlowPaths every allocation asks the collector.
    const baseline = await build(check, "--aot-testing=ForceGCSlowPaths");
    expect({ stderr: baseline.stderr, exitCode: baseline.exitCode }).toEqual({
      stderr: expect.not.stringContaining("NarrowReferenceWithoutPointer"),
      exitCode: 0,
    });
    const expected = await run(baseline.executable, withoutScan);
    expect({ exitCode: expected.exitCode, signal: expected.signal }).toEqual({ exitCode: 0, signal: null });
    expect(await run(baseline.executable, {})).toEqual(expected);
    remove(baseline.executable);

    const drops: string[] = [];
    for (const operation of new Set(guards.map(guard => guard.operation))) {
      const inFunction = Map.groupBy(
        guards.filter(guard => guard.operation === operation),
        guard => guard.function,
      );
      const most = Math.max(...[...inFunction.values()].map(list => list.length));
      for (let ordinal = 0; ordinal < most; ordinal++) drops.push(`${operation}:${ordinal}`);
    }
    const verdicts = await Promise.all(
      drops.map(async drop => {
        const checked = await build(check, "--aot-drop-guard=" + drop);
        remove(checked.executable);
        const unchecked = await build("--aot-testing=ForceGCSlowPaths", "--aot-drop-guard=" + drop);
        expect({ drop, exitCode: unchecked.exitCode }).toEqual({ drop, exitCode: 0 });
        const [alone, scanned] = await Promise.all([
          run(unchecked.executable, withoutScan),
          run(unchecked.executable, {}),
        ]);
        remove(unchecked.executable);
        const goesWrong = !Bun.deepEquals(alone, expected);
        seen.push({ operation: drop.split(":")[0], goesWrong });
        return {
          drop,
          atTheBuild: checked.exitCode !== 0 && guardsNamedBy(checked.stderr).length > 0 ? "rejected" : "compiled",
          withTheScan: Bun.deepEquals(scanned, expected) ? "runs as before" : "goes wrong",
        };
      }),
    );
    expect(verdicts).toEqual(drops.map(drop => ({ drop, atTheBuild: "rejected", withTheScan: "runs as before" })));
  },
  280_000,
);

test.skipIf(!!skipReason)(
  "the programs hold many 32-bit references out of several operations, and some of them go wrong without a pointer",
  () => {
    expect(seen.length).toBeGreaterThanOrEqual(leastNumberOfPointers);
    expect(new Set(seen.map(drop => drop.operation)).size).toBeGreaterThanOrEqual(leastNumberOfOperations);
    expect(seen.filter(drop => drop.goesWrong).length).toBeGreaterThanOrEqual(leastNumberThatGoesWrong);
  },
);
