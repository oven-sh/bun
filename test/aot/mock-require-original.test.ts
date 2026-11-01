import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A require() cannot wait for a factory that answers a promise. Under `bun test` it answers the original until the factory has settled: the file runs once, what an
// early require() got is the original that the factory is handed, and imports get the mock. An ES module is imported, and the import waits for the mock.
const body = `globalThis.loads = (globalThis.loads ?? 0) + 1;`;
const commonJS = `${body} exports.hello = function hello() { return "real"; }; exports.Klass = class Klass {};\n`;
const esModule = `${body} export function hello() { return "real"; } export class Klass {}\n`;
const testFile = (early: string, mocked: string) => `
import { test, vi } from "bun:test";
import early from "${early}";
import * as it from "${mocked}";
const seen = vi.hoisted(() => ({}));
vi.mock("${mocked}", async importOriginal => ({ ...(seen.original = await importOriginal()), hello: () => "mocked" }));
test("t", () => {
  console.log("SEEN loads", globalThis.loads, "| early", early.hello(), "| it", it.hello(), "| same function", early.hello === seen.original.hello);
  console.log("SEEN same class", early.Klass === seen.original.Klass, it.Klass === seen.original.Klass);
});
`;

const projects: Record<string, Record<string, string>> = {
  "a CommonJS package": {
    "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
    "node_modules/pkg/index.js": commonJS,
    "early.cjs": `module.exports = require("pkg");\n`,
    "a.test.js": testFile("./early.cjs", "pkg"),
  },
  "a CommonJS file of the project": {
    "own.cjs": commonJS,
    "early.cjs": `module.exports = require("./own.cjs");\n`,
    "a.test.js": testFile("./early.cjs", "./own.cjs"),
  },
  "an ES package": {
    "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }`,
    "node_modules/pkg/index.js": esModule,
    "early.mjs": `import * as pkg from "pkg";\nexport default pkg;\n`,
    "a.test.js": testFile("./early.mjs", "pkg"),
  },
  "an ES module of the project": {
    "own.mjs": esModule,
    "early.mjs": `import * as own from "./own.mjs";\nexport default own;\n`,
    "a.test.js": testFile("./early.mjs", "./own.mjs"),
  },
};

const seen = async (dir: string, words?: string) => {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", ...(words ? ["--aot"] : [])], dir, env);
  return { exitCode, lines: stdout.split("\n").filter(line => line.startsWith("SEEN ")) };
};

for (const [name, files] of Object.entries(projects)) {
  test(name, async () => {
    using dir = tempDir("mock-require-original", { "package.json": `{ "name": "p", "type": "module" }`, ...files });
    const plain = await seen(String(dir));
    expect(plain.exitCode).toBe(0);
    expect(plain.lines[0]).toStartWith("SEEN loads 1 ");
    expect(await seen(String(dir), "TestRunLayers:0")).toEqual(plain);
    expect(await seen(String(dir), "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  });
}
