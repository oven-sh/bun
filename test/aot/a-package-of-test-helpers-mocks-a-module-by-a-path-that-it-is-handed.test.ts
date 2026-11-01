// An installed package of test helpers wraps the test runner: `exports.mockModule = (path, factory) => mock.module(path, factory)`.
// The look through the test files follows the files and workspace packages that they name and reads no installed package, so no build knew that a mock may reach any
// module: "TypeError: mock(module, fn) cannot replace .. because the build didn't see a test mock it", as one program and over layers.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const packages = {
  "a CommonJS package": [
    `index.js`,
    `const { mock } = require("bun:test");\nexports.mockModule = (path, factory) => mock.module(path, factory);\n`,
  ],
  "an ES module package": [
    `index.mjs`,
    `import { mock } from "bun:test";\nexport const mockModule = (path, factory) => mock.module(path, factory);\n`,
  ],
  "under the name that jest has for it": [
    `index.mjs`,
    `import { jest } from "bun:test";\nexport const mockModule = (path, factory) => jest.mock(path, factory);\n`,
  ],
};

async function linesOf([main, text]: string[], flags: string[], words?: string) {
  using dir = tempDir("aot-package-mocks-a-module", {
    "package.json": `{ "name": "p" }`,
    "node_modules/helpers/package.json": `{ "name": "helpers", "main": "${main}" }`,
    [`node_modules/helpers/${main}`]: text,
    "src/dep.mjs": `export const name = () => "real";\nexport default { kind: "real" };\n`,
    "src/late.mjs": `export const late = () => "late real";\n`,
    "src/service.mjs": `
      import dep, { name } from "./dep.mjs";
      import * as all from "./dep.mjs";
      export const run = () => [name(), all.name(), dep.kind].join();
      export const late = async () => (await import("./late.mjs")).late();`,
    "a.test.mjs": `
      import { test } from "bun:test";
      import { mockModule } from "helpers";
      import * as service from "./src/service.mjs";
      test("t", async () => {
        console.error("OUT", service.run());
        mockModule(import.meta.dir + "/src/dep.mjs", () => ({ name: () => "MOCKED", default: { kind: "MOCKED" } }));
        mockModule(import.meta.dir + "/src/late.mjs", () => ({ late: () => "LATE MOCKED" }));
        console.error("OUT", service.run(), await service.late());
      });`,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error|TypeError)/.test(line)), exitCode };
}

test.concurrent.each(Object.entries(packages))(
  "%s",
  async (_, written) => {
    const plain = await linesOf(written, []);
    expect(plain).toEqual({ lines: ["OUT real,real,real", "OUT MOCKED,MOCKED,MOCKED LATE MOCKED"], exitCode: 0 });
    expect(await linesOf(written, ["--aot"])).toEqual(plain);
    expect(await linesOf(written, ["--aot"], "TestRunLayers:2")).toEqual(plain);
    expect(await linesOf(written, ["--aot"], "TestRunLayers:3")).toEqual(plain);
  },
  240_000,
);
