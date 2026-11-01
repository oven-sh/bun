// A mock of a built-in module that comes ahead of the load ends with its test file. A file of the project that was linked under the mock stays linked in a compiled run:
// in the next test file its default, namespace and named imports are the module's own again, and the namespace object lists the module's names.
// node:util, node:module and node:process hand out their names when somebody first asks: those read as undefined, and every namespace object kept the two names of the mock.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const names = {
  util: "format",
  module: "createRequire",
  process: "cwd",
  os: "hostname",
  fs: "readFileSync",
  "util/types": "isDate",
};

const filesFor = (module: string, name: string) => ({
  "package.json": `{ "name": "mock-builtin-next-file", "type": "module" }`,
  "src/uses.js": `import it from "node:${module}";
import * as all from "node:${module}";
import { ${name} } from "node:${module}";
export const seen = () => [typeof it.${name}, typeof all.${name}, typeof ${name}, Object.keys(all).length, Object.keys(all).includes("default")].join(" ");`,
  "a.test.js": `import { test, mock } from "bun:test";
mock.module("node:${module}", () => ({ default: { ${name}: "mocked" }, ${name}: "mocked" }));
const { seen } = await import("./src/uses.js");
test("a", () => console.log("OUT a", seen()));`,
  "b.test.js": `import { test } from "bun:test";
import { seen } from "./src/uses.js";
test("b", () => console.log("OUT b", seen()));`,
});

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, , exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.concurrent.each(Object.entries(names))(
  "node:%s",
  async (module, name) => {
    using folder = tempDir("aot-mock-builtin-next-file", filesFor(module, name));
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines[0]).toBe("OUT a string string string 2 true");
    expect(plain.lines[1]).toStartWith("OUT b function function function ");
    expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  },
  240_000,
);
