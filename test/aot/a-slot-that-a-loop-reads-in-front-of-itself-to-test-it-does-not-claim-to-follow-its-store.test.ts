// A loop in a closure that reads and stores a number in a variable of the scope around asks in front of its turns whether the slot holds a number. That read is none of the reads of the text: the closure
// may be called above the `let`, and then the slot is still empty. So the read does not say that it follows its store: the empty slot stays in its type, the test fails, and the turn throws as the text says.
// `--aot-testing=AssumeSlotsInitialized` leaves that word on the read. Under the run-time words of `--aot-harden=proof-checks` every such claim is asked at run time: with both the program stops by
// name. Under `--aot-check=Validate` and under the name the build itself is refused: no operation on the slot stands in front of the read.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported, withoutCrashReport } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { expectFaultyBuild } from "./harness/fault-injection";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const CHECKED = "--aot-harden=proof-checks";
// What the name lays into the program. The name also runs the compiler's verifier, which refuses the build with the fault.
const RUN_TIME_CHECKS =
  "--aot-testing=CheckProofsAtRunTime,DisableFrameCells,CheckHoistedCallsAtRunTime,CheckResultFreshnessAtRunTime";
const VERIFIED = "--aot-check=Validate";
const WORD = "--aot-testing=AssumeSlotsInitialized";
const around = (add: string) => `const n = value => Number(process.argv[8] ?? value);
function outer(early) {
  ${add}
  let result = "";
  try {
    result += add(early);
  } catch (error) {
    result += error.constructor.name;
  }
  let total = 1;
  return result + ":" + add(n(5)) + ":" + total;
}
console.log("SAID " + outer(n(0)) + " " + outer(n(2)));
`;
const ways = {
  "the loop stands in the closure": around(`const add = turns => {
    for (let i = 0; i < turns; i++) total += i * 0.5;
    return turns;
  };`),
  "the loop stands in a closure one scope further in": around(`const add = turns => {
    const run = () => {
      for (let i = 0; i < turns; i++) total += i * 0.5;
    };
    run();
    return turns;
  };`),
};

describe.skipIf(!!unsupported)("the read of a slot that a loop lays in front of itself to test it", () => {
  for (const [way, source] of Object.entries(ways)) {
    test(`does not claim to follow its store: ${way}`, () =>
      slot(async () => {
        using dir = tempDir("aot-slot-read-in-front-of-a-loop", { "main.cjs": source });
        const folder = String(dir);
        const executable = (name: string) => join(folder, isWindows ? name + ".exe" : name);
        const build = (name: string, ...flags: string[]) =>
          spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...withoutDebugInformation,
              ...flags,
              "./main.cjs",
              "--outfile",
              name,
            ],
            folder,
            env,
          );
        const plain = await spawned([bunExe(), "./main.cjs"], folder, env);
        expect(plain.stdout).toBe("SAID 0:5:6 ReferenceError:5:6\n");
        expect(plain.exitCode).toBe(0);
        expect((await build("right", CHECKED)).exitCode).toBe(0);
        const right = await spawned([executable("right")], folder, env);
        expect({ stdout: right.stdout, exitCode: right.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
        expect((await build("verified", VERIFIED)).exitCode).toBe(0);
        for (const check of [VERIFIED, CHECKED]) {
          const refused = await build("refused", check, WORD);
          expect(refused.stderr).toContain("says that it follows its store, and nothing vouches for it");
          expect(refused.exitCode).not.toBe(0);
        }
        const built = await build("held", RUN_TIME_CHECKS, WORD);
        if (!expectFaultyBuild(built, "says that it follows its store, and nothing vouches for it")) return;
        const held = await spawned([executable("held")], folder, { ...env, ...withoutCrashReport });
        expect(held.stderr).toContain("found an unexpected value in a closure variable");
        expect(held.stdout).not.toContain("SAID");
        expect(held.exitCode).not.toBe(0);
      }));
  }
});
