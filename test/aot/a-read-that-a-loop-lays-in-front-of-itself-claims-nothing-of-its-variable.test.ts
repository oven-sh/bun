// A loop that calls one of a few functions out of a variable asks in front of its turns which of them the variable holds. That read is none of the reads of the text: what holds of those, that a store
// stands in front of each, does not hold of it. Where the first store stands in the turn the variable still holds undefined there, so the read takes the word as it lies and claims nothing.
// `--aot-testing=AssumeVariablesInitialized` takes the read to hold what is proven of the variable. Under `--aot-harden=proof-checks` every such claim is asked at run time:
// with both the program stops by name, in front of its first turn. `fuzz/fuzzilli/write-variable-that-a-loop-uses-sweep.ts` writes these programs and their neighbors.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported, withoutCrashReport } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { expectFaultyBuild } from "./harness/fault-injection";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const CHECKED = "--aot-harden=proof-checks";
const WORD = "--aot-testing=AssumeVariablesInitialized";
const peek = `function peek() {
  return held;
}
`;
const said = `console.log("SAID end " + total);
console.log("SAID holds " + typeof held);
`;
const ways = {
  "a do-while whose turn stores twice": `var held;
let total = 0;
let turn = 0;
do {
  held = turn => turn + 10;
  held = turn => turn * 2;
  total = total * 3 + held(turn);
  turn++;
} while (turn < Number("3"));
${said}${peek}`,
  "a for that is left by a break at its end, and a var declared at the end of the file": `let total = 0;
let turn = 0;
for (;;) {
  held = turn => turn + 10;
  total = total * 3 + held(turn);
  turn++;
  if (!(turn < Number("3"))) break;
}
${said}held = turn => turn * 2;
${peek}var held;
`,
};

describe.skipIf(!!unsupported)("the read that a loop lays in front of itself", () => {
  for (const [way, source] of Object.entries(ways)) {
    test(`claims nothing of the variable: ${way}`, () =>
      slot(async () => {
        using dir = tempDir("aot-read-in-front-of-a-loop", { "main.cjs": source });
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
        expect(plain.stdout).toContain("SAID holds function");
        expect(plain.exitCode).toBe(0);
        const counted = await build("right", CHECKED, "--explain=statistics");
        expect(counted.exitCode).toBe(0);
        expect(counted.stderr).toMatch(/^\s*CalleeVariableReadsHoisted\s+[1-9]/m);
        expect(counted.stderr).toMatch(/^\s*RawVariableReadsHoisted\s+[1-9]/m);
        const right = await spawned([executable("right")], folder, env);
        expect({ stdout: right.stdout, exitCode: right.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
        const built = await build("held", CHECKED, WORD);
        const diagnostic =
          "is typed by a proof that leaves out the word that its variable is born with, and nothing vouches for it";
        if (!expectFaultyBuild(built, diagnostic)) return;
        const held = await spawned([executable("held")], folder, { ...env, ...withoutCrashReport });
        expect(held.stderr).toContain("found undefined in a local variable");
        expect(held.stdout).not.toContain("SAID");
        expect(held.exitCode).not.toBe(0);
      }));
  }
});
