// An ES module is loaded, a test mocks it, and require() asks for it for the first time while the mock stands. When the mock has ended, at the end of the
// test file, by mock.restore() or by vi.doUnmock(), require() answers the module again, as import() does. A compiled run kept the factory's object as
// the answer of require() for good: in every later test file and in the program's own CommonJS files.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

const head = `import { mock, test, vi } from "bun:test";
const log = (...all) => console.log("OUT " + all.join(" "));
`;
const lib = `console.log("OUT lib runs");
export let v = "real v";
export const kept = "kept";
`;
const laterFile = `${head}
test("z", async () => {
  const required = import.meta.require("./lib.mjs");
  log("z require", required.v, required.kept, Object.keys(required).join());
  log("z import", (await import("./lib.mjs")).v, (await import("./lib.mjs")) === required);
});
`;
const mocks = (rest: string) => `${head}
import * as ns from "./lib.mjs";
test("a", () => {
  mock.module("./lib.mjs", () => ({ v: "mock v" }));
  log("a", ns.v, import.meta.require("./lib.mjs").v);${rest}
});
`;

const projects = {
  "the test file ends": { "a.test.mjs": mocks(""), "z.test.mjs": laterFile },
  "mock.restore()": {
    "a.test.mjs": mocks(`
  mock.restore();
  log("a restored", ns.v, import.meta.require("./lib.mjs").v);`),
    "z.test.mjs": laterFile,
  },
  "a CommonJS file of the program requires it later": {
    "a.test.mjs": mocks(""),
    "user.cjs": `exports.read = () => require("./lib.mjs").v;`,
    "z.test.mjs": `${head}
import user from "./user.cjs";
test("z", () => log("z user", user.read()));
`,
  },
  "vi.doUnmock()": {
    "a.test.mjs": `${head}
import * as ns from "./lib.mjs";
test("a", () => {
  vi.doMock("./lib.mjs", () => ({ v: "mock v" }));
  log("a", import.meta.require("./lib.mjs").v);
  vi.doUnmock("./lib.mjs");
  log("a unmocked", import.meta.require("./lib.mjs").v);
});
`,
    "z.test.mjs": laterFile,
  },
};

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.concurrent.each(Object.keys(projects) as (keyof typeof projects)[])(
  "%s",
  async name => {
    using folder = tempDir("aot-mock-ends-for-require", {
      "package.json": `{ "name": "mock-ends-for-require" }`,
      "lib.mjs": lib,
      ...projects[name],
    });
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.filter(line => line.startsWith("OUT z")).join()).not.toContain("mock v");
    expect(plain.lines.join()).toContain("mock v");
    // Over layers it was vi.doUnmock() that left the factory's object behind.
    for (const words of waysFor(["TestRunLayers:0", "TestRunLayers:2"], name === "vi.doUnmock()"))
      expect(await run(dir, ["--aot"], words)).toEqual(plain);
  },
  240_000,
);
