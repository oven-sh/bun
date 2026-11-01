// A mock's factory throws. Nothing stands in place of the module, so each import() and each require() of the module asks the factory again. An importer that
// a statement ties to the module keeps the error that its own load ended with, until the mock ends: the next test file loads both.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { describe, test } from "./supported";

raiseDefaultTimeout(120_000);

const project = (lib: string, text: string) => ({
  "package.json": `{}`,
  [lib]: text,
  "user.mjs": `import { v } from "./${lib}";\nconsole.log("| user runs", v);\nexport const read = () => v;`,
  "a.test.mjs": `import { test, mock } from "bun:test";
const log = (...words) => console.log("| " + words.join(" "));
const caught = async (how, load) => { try { await load(); log(how, "no error"); } catch (error) { log(how, "caught", error.message); } };
test("a", async () => {
  let calls = 0;
  mock.module("./${lib}", () => { log("factory runs", ++calls); throw new Error("boom " + calls); });
  for (let turn = 0; turn < 2; turn++) {
    await caught("import()", () => import("./${lib}"));
    await caught("require()", () => import.meta.require("./${lib}"));
  }
  await caught("import() of a user", () => import("./user.mjs"));
  await caught("the user again", () => import("./user.mjs"));
  await caught("import() behind that", () => import("./${lib}"));
});`,
  "b.test.mjs": `import { test } from "bun:test";
import { v } from "./${lib}";
test("b", async () => {
  console.log("| the next file", v, import.meta.require("./${lib}").v, (await import("./user.mjs")).read());
});`,
});

const projects = {
  "a CommonJS file": project("lib.cjs", `console.log("| lib runs");\nexports.v = "real v";`),
  "an ES module": project("lib.mjs", `console.log("| lib runs");\nexport const v = "real v";`),
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:6" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  return { printed: stdout.split("\n").filter(line => line.startsWith("| ")), exitCode };
}

// It failed in both ways on the build in front of the cure.
const witness = "an ES module";

describe.each(ways)("%s", (way, env) => {
  const runsIn = (name: string) => waysFor(ways, name === witness).some(([each]) => each === way);
  test.each((Object.keys(projects) as (keyof typeof projects)[]).filter(runsIn))("%s", async name => {
    using dir = tempDir("mock-factory-throws", projects[name]);
    const plain = await runTests(String(dir), {});
    expect(plain.printed.filter(line => line.startsWith("| factory runs")).length).toBeGreaterThan(4);
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });
});
