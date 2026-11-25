import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` reads the text for the call on another thread, and ends the run when the tests have ended. It gives three answers: the call settles ahead of the test, behind it,
// or, on a busy machine, not before the run ends, and its line is lost. A compiled run has the text and gives the first of them each time, the one that loses nothing.
test("a call for a CommonJS file that a require() has run", async () => {
  using dir = tempDir("aot-call-for-a-required-file", {
    "package.json": `{ "name": "p" }`,
    "ledger.cjs": `exports.lines = 3;\n`,
    "a.test.cjs": `const ledger = require("./ledger.cjs");
import("./ledger.cjs").then(all => console.log("the call has settled", all.lines, all.default === ledger));
require("bun:test").test("a test that waits for nothing", () => { console.log("the test runs"); });
`,
  });
  for (let times = 0; times < 3; ++times) {
    const { stdout, exitCode } = await run([bunExe(), "test", "--aot", "./a.test.cjs"], String(dir), bunEnv);
    expect({ lines: stdout.split("\n").filter(line => line.startsWith("the ")), exitCode }).toEqual({
      lines: ["the call has settled 3 true", "the test runs"],
      exitCode: 0,
    });
  }
});
