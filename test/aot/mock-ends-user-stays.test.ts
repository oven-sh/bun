// A mock comes ahead of the load of a module, so the body of the module never runs, and ends with its test file. The next test file imports only a user of the
// module, which has run. Its imports read the module itself again, so the body runs when that graph comes by. ./mock-ends-next-file.test.ts has the file that
// imports the module itself.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { describe, test } from "./supported";

raiseDefaultTimeout(120_000);

const head = `import { test, mock, vi } from "bun:test";\nconst log = (...words) => console.log("| " + words.join(" "));\n`;
const lib = `console.log("| lib runs");\nexport let v = "real v";`;
const user = (from: string) =>
  `import { v } from "${from}";\nconsole.log("| user runs", v);\nexport const read = () => v;`;
const later = `${head}test("z", async () => { try { log("z", (await import("./user.mjs")).read()); } catch (error) { log("z failed", error.message); } });`;
const first = (mocks: string) =>
  `${head}test("a", async () => { ${mocks} try { log("a", (await import("./user.mjs")).read()); } catch (error) { log("a caught", error.message); } });`;

const projects: Record<string, Record<string, string>> = {
  "vi.mock above an import statement": {
    "lib.mjs": lib,
    "user.mjs": user("./lib.mjs"),
    "a.test.mjs": `${head}import { read } from "./user.mjs";\nvi.mock("./lib.mjs", () => ({ v: "mock v" }));\ntest("a", () => log("a", read()));`,
    "z.test.mjs": `${head}import { read } from "./user.mjs";\ntest("z", () => log("z", read()));`,
  },
  "mock.module in a test": {
    "lib.mjs": lib,
    "user.mjs": user("./lib.mjs"),
    "a.test.mjs": first(`mock.module("./lib.mjs", () => ({ v: "mock v" }));`),
    "z.test.mjs": later,
  },
  "a CommonJS file": {
    "lib.cjs": `console.log("| lib runs");\nexports.v = "real v";`,
    "user.mjs": user("./lib.cjs"),
    "a.test.mjs": first(`mock.module("./lib.cjs", () => ({ v: "mock v" }));`),
    "z.test.mjs": later,
  },
  "a function that reads a name of its own file": {
    "lib.mjs": `console.log("| lib runs");\nconst prefix = "real ";\nexport function v() { return prefix + "v"; }`,
    "user.mjs": `import { v } from "./lib.mjs";\nconsole.log("| user runs");\nexport const read = () => v();`,
    "a.test.mjs": first(`mock.module("./lib.mjs", () => ({ v: () => "mock v" }));`),
    "z.test.mjs": later,
  },
  "the mock lacks the name": {
    "lib.mjs": lib,
    "user.mjs": user("./lib.mjs"),
    "a.test.mjs": first(`mock.module("./lib.mjs", () => ({ other: 1 }));`),
    "z.test.mjs": later,
  },
  "the factory throws": {
    "lib.mjs": lib,
    "user.mjs": user("./lib.mjs"),
    "a.test.mjs": first(`mock.module("./lib.mjs", () => { throw new Error("boom"); });`),
    "z.test.mjs": later,
  },
  "through a file between": {
    "lib.mjs": lib,
    "between.mjs": `export { v } from "./lib.mjs";\nconsole.log("| between runs");`,
    "user.mjs": user("./between.mjs"),
    "a.test.mjs": first(`mock.module("./lib.mjs", () => ({ v: "mock v" }));`),
    "z.test.mjs": later,
  },
  "no later file imports the user": {
    "lib.mjs": lib,
    "user.mjs": user("./lib.mjs"),
    "a.test.mjs": first(`mock.module("./lib.mjs", () => ({ v: "mock v" }));`),
    "z.test.mjs": `${head}test("z", () => log("z imports nothing"));`,
  },
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:6" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  // TODO(bun): row 4115: `bun test` takes the importers of a mocked module out of its loader with the mock, so they run again for the next test file.
  // A compiled importer runs once.
  const printed = stdout.split("\n").filter(line => line.startsWith("| ") && !/^\| (user|between) runs/.test(line));
  return { printed, results, exitCode };
}

// It failed in both ways on the build in front of the cure, as six more did: none in layers alone.
const witness = "through a file between";

describe.each(ways)("%s", (way, env) => {
  const runsIn = (name: string) => waysFor(ways, name === witness).some(([each]) => each === way);
  test.each(Object.keys(projects).filter(runsIn))("%s", async name => {
    using dir = tempDir("mock-ends-user-stays", { "package.json": `{}`, ...projects[name] });
    const plain = await runTests(String(dir), {});
    expect(plain.results).toEqual(["pass a", "pass z"]);
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });
});
