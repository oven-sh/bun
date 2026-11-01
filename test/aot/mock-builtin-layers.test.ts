// A mock of a built-in module that needs the module's original: `vi.mock("node:fs")` without a factory, `{ spy: true }`, a factory that spreads
// jest.requireActual("node:os"), a file in `__mocks__` that calls jest.createMockFromModule("fs"). The test runner asks its registry for the original while the mock
// runs. Where a run is compiled as several programs, the program that holds the library still had the mock down as waiting and ran it for that request:
// "Circular import: "node:fs" is imported by a module that its own mock factory loads while it runs", and the file ran no test.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const rows = Array.from({ length: 3200 }, (_, i) => `  { id: ${i}, name: "row ${i}", text: "${"x".repeat(60)}" },`);
const head = `import { pick } from "./src/filler.js";\n`;

const files = {
  "package.json": `{ "name": "mock-builtin-layers", "type": "module" }`,
  "src/filler.js": `export const table = [\n${rows.join("\n")}\n];\nexport function pick(n) { return table[n % table.length].name; }\n`,
  "src/reads.js": `import os from "node:os";\nimport { basename } from "node:path";\nexport const read = () => [typeof os.platform(), basename("/a/b")].join();\n`,
  "__mocks__/zlib.cjs": `const zlib = jest.createMockFromModule("zlib");\nzlib.marker = "from the folder";\nmodule.exports = zlib;\n`,
  "other.test.js": `import { test } from "bun:test";\n${head}test("other", () => console.log("OUT other", pick(4)));`,

  "required.test.js": `import { test, vi } from "bun:test";\n${head}vi.mock("node:fs");
const fs = require("node:fs");
test("t", () => console.log("OUT", pick(3), typeof fs.readFileSync, vi.isMockFunction(fs.readFileSync), fs.readFileSync("/nowhere")));`,
  "imported.test.js": `import { test, vi } from "bun:test";\n${head}import fs, { existsSync } from "node:fs";
vi.mock("node:fs");
test("t", () => console.log("OUT", pick(3), vi.isMockFunction(fs.readFileSync), vi.isMockFunction(existsSync), existsSync("/")));`,
  "spy.test.js": `import { test, vi } from "bun:test";\n${head}import path from "node:path";
import { read } from "./src/reads.js";
vi.mock("node:path", { spy: true });
test("t", () => console.log("OUT", pick(3), path.basename("/a/b"), vi.isMockFunction(path.basename), read()));`,
  "partial.test.js": `import { jest, test } from "bun:test";\n${head}import { read } from "./src/reads.js";
jest.mock("node:os", () => ({ ...jest.requireActual("node:os"), platform: () => 7 }));
test("t", () => console.log("OUT", pick(3), require("node:os").platform(), typeof require("node:os").cpus, read()));`,
  "folder.test.cjs": `jest.mock("zlib");
test("t", () => { const zlib = require("zlib"); console.log("OUT", zlib.marker, jest.isMockFunction(zlib.gzipSync)); });`,
};

async function run(dir: string, file: string, flags: string[], words?: string) {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "./" + file, "./other.test.js"],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  // With --parallel what the test files print comes by the other stream.
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("OUT"));
  return { lines: lines.sort(), exitCode };
}

const names = ["required.test.js", "imported.test.js", "spy.test.js", "partial.test.js", "folder.test.cjs"];

test.concurrent.each(names)(
  "%s",
  async file => {
    using folder = tempDir("aot-mock-builtin-layers", files);
    const dir = String(folder);
    const plain = await run(dir, file, ["--parallel=2"]);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.length).toBe(2);
    expect(await run(dir, file, ["--aot"])).toEqual(plain);
    expect(await run(dir, file, ["--aot", "--parallel=2", "--aot-memory-limit=1MB"])).toEqual(plain);
    expect(await run(dir, file, ["--aot"], "TestRunLayers:2")).toEqual(plain);
    expect(await run(dir, file, ["--aot"], "TestRunLayers:3")).toEqual(plain);
  },
  240_000,
);
