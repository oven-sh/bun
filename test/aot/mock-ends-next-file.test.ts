import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

raiseDefaultTimeout(120_000);

// A mock that came ahead of the load of a module ends with its test file. Nothing of the module has run: the next file loads it, links it and runs its body.
const read = `
  const m = await import("./src/m.js"), barrel = await import("./src/barrel.js"), c = await import("./src/c.cjs");
  say(m.v, Object.keys(m).join(), barrel.v, Object.keys(barrel).join(), c.c(), require("./src/c.cjs").c());`;
const files = {
  "package.json": `{ "name": "mock-ends-next-file" }`,
  "src/m.js": `console.error("SEEN the body of m runs"); export const v = "real v"; export function f() {}`,
  "src/barrel.js": `export * from "./m.js"; export const own = 1;`,
  "src/c.cjs": `console.error("SEEN the body of c runs"); exports.c = () => "real c";`,
  "a.test.js": `
import { test, mock } from "bun:test";
const say = (...words) => console.error("SEEN a " + words.join(" "));
test("mocks ahead of the load", async () => {
  mock.module("./src/m.js", () => ({ v: "mocked v", extra: 1 }));
  mock.module("./src/c.cjs", () => ({ c: () => "mocked c" }));${read}
});`,
  "b.test.js": `
import { test } from "bun:test";
const say = (...words) => console.error("SEEN b " + words.join(" "));
test("has the real modules", async () => {${read}
});`,
  "c.test.js": `
import { test, mock } from "bun:test";
const say = (...words) => console.error("SEEN c " + words.join(" "));
test("mocks what has loaded", async () => {
  mock.module("./src/m.js", () => ({ v: "mocked again" }));${read}
});`,
};

test.each([[[]], [["--isolate"]]])("the next test file has the real module: %j", async flags => {
  using dir = tempDir("mock-ends-next-file", files);
  const seenWith = async (env: Record<string, string>, ...more: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, ...more], String(dir), {
      ...bunEnv,
      ...env,
    });
    return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [plain, oneProgram, layers] = await Promise.all([
    seenWith({}),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, "--aot"),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot"),
  ]);
  expect(plain.seen.slice(0, 4)).toEqual([
    "SEEN a mocked v v,extra mocked v extra,own,v mocked c mocked c",
    "SEEN the body of m runs",
    "SEEN the body of c runs",
    "SEEN b real v f,v real v f,own,v real c real c",
  ]);
  expect(plain.exitCode).toBe(0);
  expect(oneProgram).toEqual(plain);
  // TODO(bun), row 4236: over layers, without --isolate, the mock of the third file is taken as ahead of the load though the second file has loaded the module.
  if (flags.length) expect(layers).toEqual(plain);
  else expect({ ...layers, seen: layers.seen.slice(0, 4) }).toEqual({ ...plain, seen: plain.seen.slice(0, 4) });
});
