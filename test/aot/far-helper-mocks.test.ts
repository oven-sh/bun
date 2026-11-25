// A helper three imports away from the test file lays the mock by the global `vi`. The build sees the call where it is spelled, however far away that is.
// The project stands alone: in the company of many test files the fault did not show.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const project = {
  "src/dep.ts": `export const name = "real";`,
  "src/user.ts": `export const use = () => require("./dep").name;`,
  "test/a.test.ts": `import { act } from "./tools/h1";
import { use } from "../src/user";
const said = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
test("t", () => console.log("|", use(), said(act), use()));`,
  "test/tools/h1.ts": `export { act } from "./h2";`,
  "test/tools/h2.ts": `export { act } from "./h3";`,
  "test/tools/h3.ts": `export function act() { vi.doMock("../../src/dep", () => ({ name: "mocked" })); }`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line.startsWith("| ")), results, exitCode };
}

test("the global vi, TypeScript", async () => {
  using dir = tempDir("far-helper-mocks", project);
  const plain = await runTests(String(dir));
  expect(plain).toEqual({ printed: ["| real undefined mocked"], results: ["pass t"], exitCode: 0 });
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 120_000);
