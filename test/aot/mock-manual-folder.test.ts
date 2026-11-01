// `vi.mock("./src/lib")` and `jest.mock("./src/lib")` without a factory, where src/__mocks__/lib.ts exists: the test runner loads that file in the module's
// place. For a package it is the file of that name in the folder `__mocks__` where the run was started. No import names the file, so
// as one program a compiled run refused it ("it wasn't compiled with the program") and the importer read names that nothing had filled.
// The file is a source of the project: it is compiled with the program, which the log of the modules that the loader asks for shows.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-manual-folder", "type": "module" }`,
  "src/lib.ts": `console.log("OUT real lib runs");
export const who = "real lib";
export function twice(n: number) { return n * 2; }`,
  "src/helper.ts": `export const factor = 20;`,
  "src/__mocks__/lib.ts": `import { factor } from "../helper";
console.log("OUT manual lib runs");
export const who = "manual lib";
export function twice(n: number) { return n * factor; }`,
  "src/user.ts": `import { twice, who } from "./lib";
export const seen = () => who + " " + twice(2);`,
  "src/partly.js": `export const kept = "kept";
export const replaced = "real";`,
  "src/__mocks__/partly.js": `import { jest } from "bun:test";
const real = jest.requireActual("../partly.js");
export const kept = real.kept;
export const replaced = "manual";`,
  "src/user-of-partly.js": `import { kept, replaced } from "./partly.js";
export const seen = () => kept + " " + replaced;`,
  "src/old.cjs": `exports.who = "real old";`,
  "src/__mocks__/old.cjs": `exports.who = "manual old";`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }`,
  "node_modules/pkg/index.js": `export const who = "real pkg";`,
  "__mocks__/pkg.js": `console.log("OUT manual pkg runs");
export const who = "manual pkg";`,
  "src/user-of-pkg.js": `import { who } from "pkg";
export const seen = () => who;`,
  "__mocks__/os.js": `console.log("OUT manual os runs");
exports.hostname = () => "manual host";`,
  "src/user-of-os.ts": `import { hostname } from "node:os";
export const seen = () => hostname();`,

  "vi-file.test.ts": `import { test, vi } from "bun:test";
import { seen } from "./src/user";
vi.mock("./src/lib");
test("vi.mock of a file", () => console.log("OUT", seen()));`,
  "jest-file.test.ts": `import { jest, test } from "bun:test";
import { seen } from "./src/user";
jest.mock("./src/lib.ts");
test("jest.mock of a file", () => console.log("OUT", seen()));`,
  "partly.test.js": `import { jest, test } from "bun:test";
import { seen } from "./src/user-of-partly.js";
jest.mock("./src/partly.js");
test("the file in the folder requires the original", () => console.log("OUT", seen()));`,
  "package.test.js": `import { test, vi } from "bun:test";
import { seen } from "./src/user-of-pkg.js";
vi.mock("pkg");
test("vi.mock of a package", () => console.log("OUT", seen()));`,
  "commonjs.test.js": `import { jest, test } from "bun:test";
jest.mock("./src/old.cjs");
test("a CommonJS file in the folder: require() answers its module.exports", async () => {
  const imported = await import("./src/old.cjs");
  const required = import.meta.require("./src/old.cjs");
  console.log("OUT", required.who, Object.keys(required).join(), imported.who, Object.keys(imported).sort().join());
});`,
  "node-required.test.js": `import { jest, test } from "bun:test";
jest.mock("os");
test("jest.mock of a module of Node, required", () => console.log("OUT", require("os").hostname()));`,
  "node-imported.test.ts": `import { test, vi } from "bun:test";
import { seen } from "./src/user-of-os";
vi.mock("node:os");
test("vi.mock of a module of Node, imported in another file", () => console.log("OUT", seen()));`,
  "factory.test.ts": `import { test, vi } from "bun:test";
import { seen } from "./src/user";
vi.mock("./src/lib", () => ({ who: "factory", twice: (n: number) => n }));
test("a factory goes before the folder", () => console.log("OUT", seen()));`,
};

async function run(dir: string, file: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "./" + file],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_AOT_VERBOSE: flags.length ? "1" : undefined },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const asked = stderr.split("\n").filter(line => line.startsWith("[aot] module: ") && line.includes("__mocks__"));
  return { seen: { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode }, asked };
}

const pins = {
  "vi-file.test.ts": ["OUT manual lib runs", "OUT manual lib 40"],
  "jest-file.test.ts": ["OUT manual lib runs", "OUT manual lib 40"],
  "partly.test.js": ["OUT kept manual"],
  "package.test.js": ["OUT manual pkg runs", "OUT manual pkg"],
  "commonjs.test.js": ["OUT manual old who manual old default,who"],
  "node-required.test.js": ["OUT manual os runs", "OUT manual host"],
  "node-imported.test.ts": ["OUT manual os runs", "OUT manual host"],
  "factory.test.ts": ["OUT factory 2"],
};

test.concurrent.each(Object.keys(pins) as (keyof typeof pins)[])(
  "%s",
  async file => {
    using folder = tempDir("aot-mock-manual-folder", files);
    const dir = String(folder);
    const plain = await run(dir, file, []);
    expect(plain.seen).toEqual({ lines: pins[file], exitCode: 0 });
    const oneProgram = await run(dir, file, ["--aot"], "TestRunLayers:0");
    expect(oneProgram.seen).toEqual(plain.seen);
    expect(oneProgram.asked.length).toBe(file === "factory.test.ts" ? 0 : 1);
    // These four were right as one program and wrong over layers.
    const isAboutLayers = ["commonjs.test.js", "jest-file.test.ts", "partly.test.js", "vi-file.test.ts"].includes(file);
    if (!runsWholeGrids && !isAboutLayers) return;
    // Over layers the module lies in a program below the test file's.
    const layers = await run(dir, file, ["--aot"], "TestRunLayers:2");
    expect(layers.seen).toEqual(plain.seen);
    expect(layers.asked.length).toBe(oneProgram.asked.length);
  },
  240_000,
);
