// The build reads code that a test holds in a string, because the test may write it to a file and load that: a spy in it opens exports. It took for code whatever its parser got through,
// and that parser goes on behind a syntax error. So one message for the reader, "Write `using spy = spyOn(...)`", in one file of a suite was a spy with operands that nobody can read:
// every export of every module whose namespace object goes anywhere could be replaced, was read from a variable and called through it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const strings = {
  "a hint with dots for the operands": { text: "using spy = spyOn(...)", isCode: false },
  "a sentence around such a hint": { text: "Write `using spy = spyOn(...)` and the spy is put back.", isCode: false },
  "a call that is cut off": { text: "const spy = spyOn(lib, name", isCode: false },
  "a helper that is told its object and the name": {
    text: `import { spyOn } from "bun:test"; export const spy = (object, name) => spyOn(object, name);`,
    isCode: true,
  },
};

for (const [name, { text, isCode }] of Object.entries(strings))
  test(name, async () => {
    using dir = tempDir("aot-hint-in-a-string", {
      "package.json": `{ "name": "hint-in-a-string", "type": "module" }`,
      "lib.js": `export function total(list) { let sum = 0; for (const item of list) sum += item; return sum; }\n`,
      "a.test.js": `
import { test } from "bun:test";
import * as lib from "./lib.js";
const held = { lib };
const said = ${JSON.stringify(text)};
test("t", () => {
  console.error("SEEN " + JSON.stringify([held.lib.total([1, 2, 3]), said.length]));
});
`,
    });
    const seenWith = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ")),
        holdsCode: lines.some(line =>
          line.includes("holds code in a string that spies under a name that nobody reads"),
        ),
        exitCode,
      };
    };
    expect(await seenWith()).toEqual({ seen: [`SEEN [6,${text.length}]`], holdsCode: false, exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen: [`SEEN [6,${text.length}]`], holdsCode: isCode, exitCode: 0 });
  });
