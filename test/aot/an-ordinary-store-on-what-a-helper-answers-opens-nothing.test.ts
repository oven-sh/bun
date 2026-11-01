import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2"],
])("%s", async (_, words) => {
  using dir = tempDir("aot-an-ordinary-store", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "src/tools.js": `
export const build = from => ({ from });
export const named = name => ({ name });`,
    "a.test.js": `
import { test } from "bun:test";
import { build, named } from "./src/tools.js";
test("stores", () => {
  const made = build({ a: 1 });
  made.keys = ["a"];
  made.values = Object.values(made.from);
  made.ownName = 1;
  const list = build([1, 2]);
  list.length = 0;
  list.at = 5;
  build("text").raw = "text";
  const key = ["ab", "s"].join("");
  const held = Math[key];
  held.ownName = 2;
  named(new Map()).size = 3;
  console.log("SEEN", Object.keys(made).join(), list.length, list.at);
});`,
    "b.test.js": `
import { test } from "bun:test";
test("another", () => {});`,
  });
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot", "--timeout=60000"], String(dir), {
    ...bunEnv,
    BUN_DEBUG_TEST_AOT_WORDS: words,
    BUN_JSC_logAOTPhaseTimes: "1",
  });
  const output = stdout + stderr;
  expect({
    seen: output.split("\n").filter(line => line.startsWith("SEEN")),
    scans: [...new Set(output.match(/sites: built-ins \d+ \| names added \d+/g))],
    findsMoreLate: output.includes("replaced built-ins added"),
    exitCode,
  }).toEqual({
    seen: ["SEEN from,keys,values,ownName 0 5"],
    scans: ["sites: built-ins 0 | names added 0"],
    findsMoreLate: false,
    exitCode: 0,
  });
});
