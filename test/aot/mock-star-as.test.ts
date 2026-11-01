// A file hands the namespace object of another file on under a name (`export * as all from "./dep.js"`), and a test mocks that other file.
// Whoever imports the name gets an object: its names, a name that only the mock has, `typeof`. Plain `bun test` says what is right.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { describe, test } from "./supported";

raiseDefaultTimeout(120_000);

const factory = `() => ({ flag: "one", added: "added" })`;
const late = `test("t", async () => {
  vi.doMock("./dep.js", ${factory});
  console.log("| " + (await import("./user.js")).report());
});`;
const starAs = `export * as all from "./dep.js";`;

// What report() returns, the test file behind its import of the runner, the file between.
const cases: Record<string, [string, string, string]> = {
  "a name of the file": ["all.flag", late, starAs],
  "a name that only the mock has": ["all.added", late, starAs],
  "the keys": [`Object.keys(all).join("+")`, late, starAs],
  "typeof": ["typeof all", late, starAs],
  "a hoisted mock": [
    "all.flag + all.added",
    `import { report } from "./user.js";
vi.mock("./dep.js", ${factory});
test("t", () => console.log("| " + report()));`,
    starAs,
  ],
  "mock.module": [
    "all.flag + all.added",
    `test("t", async () => {
  mock.module("./dep.js", ${factory});
  console.log("| " + (await import("./user.js")).report());
});`,
    starAs,
  ],
  "before and behind the mock": [
    "all.flag + all.added",
    `import { report } from "./user.js";
test("t", () => {
  console.log("| before " + report());
  mock.module("./dep.js", ${factory});
  console.log("| behind " + report());
});`,
    starAs,
  ],
  "a mock without a factory": [
    "typeof all.f + all.flag + all.added",
    `import { report } from "./user.js";
vi.mock("./dep.js");
test("t", () => console.log("| " + report()));`,
    starAs,
  ],
  "imported and exported": ["all.flag + all.added", late, `import * as all from "./dep.js";\nexport { all };`],
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line.startsWith("| ")), results, exitCode };
}

// Eight failed as one program on the build in front of the cure, none in layers: that way has a guard and no witness.
const witness = "typeof";

describe.each(ways)("%s", (way, env) => {
  const runsIn = (name: string) => waysFor(ways, name === witness).some(([each]) => each === way);
  test.each(Object.keys(cases).filter(runsIn))("%s", async name => {
    const [reported, testFile, between] = cases[name];
    using dir = tempDir("mock-star-as", {
      "package.json": `{ "type": "module" }`,
      "dep.js": `export const flag = "real";\nexport const plain = "real";\nexport function f() {\n  return "real f";\n}`,
      "between.js": between,
      "user.js": `import { all } from "./between.js";\nexport const report = () => ${reported};`,
      "a.test.js": `import { mock, test, vi } from "bun:test";\n${testFile}`,
      "z.test.js": `import { test } from "bun:test";
test("z", async () => console.log("| the next file: " + (await import("./user.js")).report()));`,
    });
    const plain = await runTests(String(dir), {});
    expect(plain.exitCode).toBe(0);
    expect(plain.printed.length).toBeGreaterThan(1);
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });
});
