// The program reads every member of `process`, takes one more step, and prints the keys in order.
import { describe, expect, test } from "bun:test";
import { bunExe } from "harness";
import { canTrim } from "../bundler/compile-trim-features";
import { unsupported } from "./harness/compiler";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";

const steps = {
  "after reading every member": "",
  "after a spread": "({ ...process });",
  "after Object.assign": "Object.assign({}, process);",
  "after Object.entries": "Object.entries(process);",
  "after deleting a missing member": "delete process.noSuchMember;",
  "after adding a member": "process.newMember = 1;",
  "after Object.freeze": "Object.freeze(process);",
};

// Its first argument says which step it takes.
const program = `const read = key => {
  try {
    return typeof process[key];
  } catch {
    return "throws";
  }
};
console.log(Object.keys(process).map(key => key + ":" + read(key)).join(" "));
switch (process.argv[2]) {
${Object.entries(steps)
  .map(([name, step]) => `  case ${JSON.stringify(name)}:\n    ${step}\n    break;\n`)
  .join("")}}
const inLoop = [];
for (const key in process) inLoop.push(key);
console.log(inLoop.join(" "));
console.log(Object.keys(process).join(" "));
console.log(Reflect.ownKeys(process).map(String).join(" "));
`;

if (!canTrim)
  console.error("SKIPPED: keys-of-process-in-a-trimmed-executable.test.ts: this build of Bun doesn't support --trim");

(canTrim && !unsupported ? describe.concurrent : describe.skip)(
  "a trimmed executable lists the keys of process in the same order as bun",
  () => {
    const { folder, build } = sharedBuilds("keys-of-process", { "program.js": program });

    test.each(Object.keys(steps))("%s", async step => {
      const trimmed = await build("program.js", "--aot", "--trim");
      const plain = await run([bunExe(), "program.js", step], folder);
      expect(plain.stdout).not.toBe("");
      expect(await run([trimmed.executable, step], folder)).toEqual({ ...plain, exitCode: 0 });
    });
  },
);
