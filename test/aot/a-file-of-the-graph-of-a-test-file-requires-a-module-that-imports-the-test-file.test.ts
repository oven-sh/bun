// The test file imports tools.cjs and pages.mjs, pages.mjs imports the test file, and tools.cjs requires pages.mjs. The test file has asked for pages.mjs already and its text is on its way
// when tools.cjs runs: the load for the require ends ahead of the load of the test file, so their cycle is entered at pages.mjs and the test file runs first, inside the require.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

test("a compiled test run enters the cycle where bun test enters it", async () => {
  using dir = tempDir("aot-a-file-requires-a-module-that-imports-the-test-file", {
    "package.json": `{ "name": "p" }`,
    "ring.test.mjs": `import "./tools.cjs";
import "./pages.mjs";
import { test } from "bun:test";
globalThis.lines.push("the test file runs");
test("the order of bodies", () => { console.log("the order: " + globalThis.lines.join(", ")); });
`,
    "pages.mjs": `import "./ring.test.mjs";
globalThis.lines.push("pages runs");
`,
    "tools.cjs": `globalThis.lines = ["tools begins"];
require("./pages.mjs");
globalThis.lines.push("tools ends");
`,
  });
  for (const flags of [[], ["--aot"]]) {
    const { stdout, exitCode } = await run([bunExe(), "test", ...flags, "./ring.test.mjs"], String(dir), bunEnv);
    expect({ flags, lines: stdout.split("\n").filter(line => line.startsWith("the order")), exitCode }).toEqual({
      flags,
      lines: ["the order: tools begins, the test file runs, pages runs, tools ends"],
      exitCode: 0,
    });
  }
});
