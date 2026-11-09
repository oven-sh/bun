import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `build.module("virtual:given", ..)` in a preload, and test files that mock the name. The table of the plugins kept a mock in the place of the function that the plugin
// gave, so the name went with the mock: behind `vi.doUnmock`, and in the next test file, whoever imported it was told that nobody has it.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
  "setup.js": `import { plugin } from "bun";
plugin({ name: "given", setup(build) { build.module("virtual:given", () => ({ exports: { from: "the plugin" }, loader: "object" })); } });
`,
  "src/user.js": `import { from } from "virtual:given";\nexport const seen = () => from;\n`,
  "a.test.js": `import { test, vi } from "bun:test";
const seen = async () => [(await import("./src/user.js")).seen(), (await import("virtual:given")).from, require("virtual:given").from].join(" ");
test("a mock that a test takes away", async () => {
  vi.doMock("virtual:given", () => ({ from: "the mock" }));
  console.log("SEEN under the mock:", await seen());
  vi.doUnmock("virtual:given");
  console.log("SEEN behind the mock:", await seen());
});
`,
  "b.test.js": `import { test, vi } from "bun:test";
import { seen } from "./src/user.js";
vi.mock("virtual:given", () => ({ from: "the mock" }));
test("a mock that the end of the file takes away", () => {
  console.log("SEEN under a hoisted mock:", seen());
});
`,
  "c.test.js": `import { test } from "bun:test";
import { seen } from "./src/user.js";
test("the next file", () => {
  console.log("SEEN in the next file:", seen());
});
`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  return {
    seen: stdout.split("\n").filter(line => line.startsWith("SEEN")),
    results: [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`),
    exitCode,
  };
}

test("the name is the plugin's again, compiled and not", async () => {
  using dir = tempDir("aot-mock-of-given-module", files);
  const plain = await runTests(String(dir));
  expect(plain).toEqual({
    seen: [
      "SEEN under the mock: the mock the mock the mock",
      "SEEN behind the mock: the plugin the plugin the plugin",
      "SEEN under a hoisted mock: the mock",
      "SEEN in the next file: the plugin",
    ],
    results: [
      "pass a mock that a test takes away",
      "pass a mock that the end of the file takes away",
      "pass the next file",
    ],
    exitCode: 0,
  });
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}, 300_000);
