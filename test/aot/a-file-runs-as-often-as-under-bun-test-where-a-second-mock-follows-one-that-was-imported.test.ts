import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const project = {
  "package.json": `{ "name": "p" }\n`,
  "bunfig.toml": `[test]\npreload = ["./preload.mjs"]\n`,
  "preload.mjs": `import { vi } from "bun:test";\nvi.mock("./lib.cjs", async original => ({ ...(await original()), a: "mocked" }));\n`,
  "lib.cjs": `globalThis.runsOfLib = (globalThis.runsOfLib ?? 0) + 1;\nexports.a = 1;\n`,
  "a_test.cjs": `const { test, vi } = require("bun:test");
test("the first mock is imported, ends, and a second stands", async () => {
  require("./lib.cjs");
  const first = await vi.importActual("./lib.cjs");
  await import("./lib.cjs");
  vi.doUnmock("./lib.cjs");
  require("./lib.cjs");
  vi.doMock("./lib.cjs", () => ({ a: "second" }));
  require("./lib.cjs");
  const second = await vi.importActual("./lib.cjs");
  console.log("SAID", first.a, second.a, globalThis.runsOfLib);
});
`,
};

async function linesOf(...flags: string[]) {
  using dir = tempDir("aot-a-second-mock-follows-one-that-was-imported", project);
  const { stdout } = await run([bunExe(), "test", "--isolate", ...flags, "./a_test.cjs"], String(dir), {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
}

test.failing(
  "it prints what bun test prints: a wrong answer today: under `bun test --aot` the file has run 2 times, where `bun test` has run it 3 times",
  async () => {
    const plain = await linesOf();
    expect(plain).toEqual(["SAID 1 1 3"]);
    expect(await linesOf("--aot")).toEqual(plain);
  },
);
