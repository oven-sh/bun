import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const project = {
  "package.json": `{ "name": "made-up-required", "private": true }\n`,
  "one.js": `export const one = 1;\n`,
  "two.js": `export const two = 2;\n`,
  "a_test.js": `import { test } from "vitest";
import { one } from "./one.js";
import { two } from "./two.js";
export const sum = one + two;
test("first", () => {
  console.log("SAID first", sum);
});
`,
  "b_test.js": `import { test } from "bun:test";
const { sum } = require("./a_test.js");
test("second", () => {
  console.log("SAID second", sum);
});
`,
};

async function outcomeOf(...flags: string[]) {
  using dir = tempDir("aot-a-vitest-test-file-is-required", project);
  const { stdout, stderr } = await run(
    [bunExe(), "test", ...flags, "--isolate", "./a_test.js", "./b_test.js"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  return {
    said: stdout.split("\n").filter(line => line.startsWith("SAID")),
    refusals: stderr.split("\n").filter(line => line.includes("require() async module")).length,
  };
}

const plain = { said: ["SAID first 3", "SAID first 3", "SAID second 3"], refusals: 0 };

test("bun test --isolate loads the test file a second time, as an import, and require() answers", async () => {
  expect(await outcomeOf()).toEqual(plain);
});

test("the compiled run says why it fails", async () => {
  expect(await outcomeOf("--aot")).toEqual({ said: ["SAID first 3"], refusals: 1 });
});

test.failing(
  "it prints what bun test prints: an error today: the image holds the test file as an entry point alone, whose imports are awaited, and require() refuses a module that waits",
  async () => {
    expect(await outcomeOf("--aot")).toEqual(plain);
  },
);
