// `vi.mock("pkg")` and `jest.mock("os")` without a factory, where a file of that name lies in the folder `__mocks__` where the run was started: the test runner
// loads that file in the module's place. No import names the file, so as one program a compiled run refused it ("it wasn't compiled with the program") and the
// importer read names that nothing had filled. The file is a source of the project: it is compiled with the program, which the log of the modules that the loader
// asks for shows. The folder beside a file of the project: fixed-runs/closed/mocks-folder-beside-the-file.txt.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-manual-folder", "type": "module" }`,
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

  "package.test.js": `import { test, vi } from "bun:test";
import { seen } from "./src/user-of-pkg.js";
vi.mock("pkg");
test("vi.mock of a package", () => console.log("OUT", seen()));`,
  "node-required.test.js": `import { jest, test } from "bun:test";
jest.mock("os");
test("jest.mock of a module of Node, required", () => console.log("OUT", require("os").hostname()));`,
  "node-imported.test.ts": `import { test, vi } from "bun:test";
import { seen } from "./src/user-of-os";
vi.mock("node:os");
test("vi.mock of a module of Node, imported in another file", () => console.log("OUT", seen()));`,
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
  "package.test.js": ["OUT manual pkg runs", "OUT manual pkg"],
  "node-required.test.js": ["OUT manual os runs", "OUT manual host"],
  "node-imported.test.ts": ["OUT manual os runs", "OUT manual host"],
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
    expect(oneProgram.asked.length).toBe(1);
  },
  240_000,
);
