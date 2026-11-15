// The test file imports first.cjs, which requires back.mjs, which imports the test file and second.cjs. second.cjs requires the test file.
// second.cjs lies beside the test file, not below it: the load for that require settles nothing that the load of back.mjs waits for, so neither ends inside it,
// and `bun test` throws "require() async module". Both modules run when second.cjs has returned.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

test("a compiled test run throws where bun test throws", async () => {
  using dir = tempDir("aot-a-file-beside-the-test-file-requires-it", {
    "package.json": `{ "name": "p" }`,
    "ring.test.mjs": `import "./first.cjs";
import { test } from "bun:test";
globalThis.lines.push("the test file runs");
export const answer = 42;
test("the order of bodies", () => { console.log("the order: " + globalThis.lines.join(", ")); });
`,
    "first.cjs": `globalThis.lines = ["first begins"];
globalThis.lines.push("first got " + Object.keys(require("./back.mjs")).join());
globalThis.lines.push("first ends");
`,
    "back.mjs": `import "./ring.test.mjs";
import "./second.cjs";
globalThis.lines.push("back runs");
export const back = 1;
`,
    "second.cjs": `globalThis.lines.push("second begins");
try {
  globalThis.lines.push("second got " + require("./ring.test.mjs").answer);
} catch (error) {
  globalThis.lines.push("second caught " + error.name);
}
globalThis.lines.push("second ends");
`,
  });
  const order =
    "first begins, second begins, second caught TypeError, second ends, the test file runs, back runs, first got back, first ends";
  for (const flags of [[], ["--aot"]]) {
    const { stdout, exitCode } = await run([bunExe(), "test", ...flags, "./ring.test.mjs"], String(dir), bunEnv);
    expect({ flags, lines: stdout.split("\n").filter(line => line.startsWith("the order")), exitCode }).toEqual({
      flags,
      lines: ["the order: " + order],
      exitCode: 0,
    });
  }
});
