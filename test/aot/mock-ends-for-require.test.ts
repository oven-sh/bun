// An ES module is loaded, a test mocks it, and require() asks for it for the first time while the mock stands. When the mock has ended, at the end of the
// test file, by mock.restore() or by vi.doUnmock(), require() answers the module again, as import() does. A compiled run kept the factory's object as
// the answer of require() for good: in every later test file and in the program's own CommonJS files.
// The entry of require.cache that is made meanwhile ends with the mock too, and a mock that a hook lays again takes nothing for the module's own answer.
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
const headOfHooks = `import { beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
import "./lib.mjs";
const log = (...all) => console.log("OUT " + all.join(" "));
`;
const asksCacheUnderMock = (name: string, call: string) => `${headOfHooks}
const fake = { v: "mock v of ${name}" };
beforeAll(() => void ${call}("./lib.mjs", () => fake));
test("${name}", () => {
  const required = import.meta.require("./lib.mjs");
  const entry = require.cache[require.resolve("./lib.mjs")];
  log("${name}", required === fake, entry.exports === fake, entry.exports.v);
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
  "each test file asks require.cache under a mock of its own": {
    "a.test.mjs": asksCacheUnderMock("a", "jest.mock"),
    "b.test.mjs": asksCacheUnderMock("b", "mock.module"),
    "c.test.mjs": asksCacheUnderMock("c", "jest.doMock"),
    "d.test.mjs": asksCacheUnderMock("d", "vi.mock"),
    "z.test.mjs": `${head}
test("z", () => {
  const entry = require.cache[require.resolve("./lib.mjs")];
  const required = import.meta.require("./lib.mjs");
  log("z cache", entry.exports.v, required.v, entry.exports === required);
});
`,
  },
  "a hook lays the mock again behind a require()": {
    "a.test.mjs": `${headOfHooks}
let laid = 0;
beforeEach(() => {
  const v = "mock v " + ++laid;
  mock.module("./lib.mjs", () => ({ v }));
});
test("a1", () => log("a1", import.meta.require("./lib.mjs").v));
test("a2", () => log("a2", import.meta.require("./lib.mjs").v));
`,
    "user.cjs": `const lib = require("./lib.mjs");
exports.read = () => lib.v;`,
    "z.test.mjs": `${head}
import user from "./user.cjs";
test("z", () => {
  const required = import.meta.require("./lib.mjs");
  log("z require", required.v, required.kept, Object.keys(required).join());
  log("z user", user.read());
});
`,
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
    for (const words of waysFor(["TestRunLayers:0"], name === "vi.doUnmock()"))
      expect(await run(dir, ["--aot"], words)).toEqual(plain);
  },
  240_000,
);
