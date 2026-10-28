// Each program reads every member of `process`, takes one more step, and prints the keys in order.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./run-programs";

const steps = {
  "after reading every member": "",
  "after a spread": "({ ...process });",
  "after Object.assign": "Object.assign({}, process);",
  "after Object.entries": "Object.entries(process);",
  "after deleting a missing member": "delete process.noSuchMember;",
  "after adding a member": "process.newMember = 1;",
  "after Object.freeze": "Object.freeze(process);",
};

const programFor = (step: string) => `const read = key => {
  try {
    return typeof process[key];
  } catch {
    return "throws";
  }
};
console.log(Object.keys(process).map(key => key + ":" + read(key)).join(" "));
${step}
const inLoop = [];
for (const key in process) inLoop.push(key);
console.log(inLoop.join(" "));
console.log(Object.keys(process).join(" "));
console.log(Reflect.ownKeys(process).map(String).join(" "));
`;

if (!canTrim)
  console.error("SKIPPED: keys-of-process-in-a-trimmed-executable.test.ts: this build of Bun doesn't support --trim");

(canTrim && !unsupported ? describe.concurrent : describe.skip)(
  "a trimmed executable lists the keys of process in the same order as one that is not trimmed",
  () => {
    test.each(Object.entries(steps))(
      "%s",
      (_, step) =>
        slot(async () => {
          using dir = tempDir("keys-of-process", { "program.js": programFor(step) });
          const folder = String(dir);
          const build = [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile"];
          built(await spawned([...build, "whole"], folder, bunEnv));
          built(await spawned([...build, "trimmed", "--trim"], folder, bunEnv));
          const whole = await spawned([join(folder, "whole")], folder, bunEnv);
          const trimmed = await spawned([join(folder, "trimmed")], folder, bunEnv);
          expect(whole.stdout).not.toBe("");
          expect({ stdout: trimmed.stdout, exitCode: trimmed.exitCode }).toEqual({ stdout: whole.stdout, exitCode: 0 });
        }),
      600_000,
    );
  },
);
