import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// node:util defers `format` and `inspect` behind getters. The link of the file that imports them reads them.
const testFile = `
import { test } from "bun:test";
import path, { join } from "node:path";
import util, { format, inspect } from "node:util";
const replace = (object, name) => { object[name] = () => "replaced"; };
replace(path, "join");
replace(util, "format");
replace(util, "inspect");
test("names hold what they held at the link", () => {
  console.error("SEEN " + JSON.stringify([join("a", "b"), format("%s", 1), inspect(2), path.join("a", "b"), util.format("%s", 1), util.inspect(2)]));
});
`;

test("a store to the object of a module of Bun's does not reach a name that a test file imported", async () => {
  using dir = tempDir("aot-names-of-modules-of-bun-over-layers", {
    "package.json": `{ "name": "names-of-modules-of-bun-over-layers", "type": "module" }`,
    "a.test.js": testFile,
  });
  const seenWith = async (env: Record<string, string>, ...flags: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
    return { seen: (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN ")), exitCode };
  };
  const [plain, oneProgram, layers] = await Promise.all([
    seenWith({}),
    seenWith({}, "--aot"),
    seenWith({ BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }, "--aot", "--parallel=2"),
  ]);
  expect(plain).toEqual({ seen: [`SEEN ["a/b","1","2","replaced","replaced","replaced"]`], exitCode: 0 });
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
});
