import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Three test files in one realm. The first mocks a module, the second mocks it again and asks for the original, the third mocks nothing. All three read the module
// through one file that the first has loaded.
const filler = Array.from({ length: 6000 }, (_, i) => `export function filler${i}(x) { return x + ${i}; }\n`).join("");
const head = `import { filler1 } from "./filler.mjs"; void filler1;\nimport { test, vi } from "bun:test";\n`;
const body = `export const a = "real a";\nexport const f = () => "real f";`;

const projects = {
  "a file": ["./src/given.js", "./given.js", { "src/given.js": body }],
  "a package": [
    "pkg",
    "pkg",
    {
      "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "type": "module" }`,
      "node_modules/pkg/index.js": body,
    },
  ],
} as const;

describe.each(Object.entries(projects))("%s", (_, [fromTest, fromUser, module]) => {
  const files = {
    ...module,
    "package.json": `{ "name": "project", "type": "module" }`,
    "filler.mjs": filler,
    "src/user.js": `import * as given from "${fromUser}";\nimport { a } from "${fromUser}";\nexport const seen = () => [given.a, given.f(), a].join();`,
    "a.test.js": `${head}vi.mock("${fromTest}", importOriginal => ({ a: "mock a", f: () => "mock f" }));
      import { seen } from "./src/user.js";
      test("a", () => console.log("OUT a", seen()));`,
    "b.test.js": `${head}test("b", async () => {
        vi.doMock("${fromTest}", async importOriginal => ({ ...(await importOriginal()), a: "mock b" }));
        console.log("OUT b", (await import("./src/user.js")).seen());
      });`,
    "z.test.js": `${head}import { seen } from "./src/user.js";\ntest("z", () => console.log("OUT z", seen()));`,
  };
  const oneRealm = ["--parallel=1", "--no-isolate"];

  test.concurrent.each([
    ["bun test", [], "", /^/],
    ["bun test, one worker", oneRealm, "", /^/],
    ["one program", ["--aot"], "TestRunLayers:0,TestRunSaysItsForm", /^AOT test run \| one program/m],
    ["two layers", ["--aot"], "TestRunLayers:2,TestRunSaysItsForm", /^AOT test run \| layers 2/m],
    [
      "the layers that a run takes by itself",
      ["--aot", ...oneRealm, "--aot-memory-limit", "1MB"],
      "TestRunSaysItsForm",
      /^AOT test run \| layers [2-9]/m,
    ],
  ])(
    "%s",
    async (_, flags, words, form) => {
      using directory = tempDir("aot-mock-again-next-file", files);
      const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
      const { stdout, stderr } = await run([bunExe(), "test", ...flags, "."], String(directory), env);
      expect(stdout + "\n" + stderr).toMatch(form);
      expect((stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("OUT "))).toEqual([
        "OUT a mock a,mock f,mock a",
        "OUT b mock b,real f,mock b",
        "OUT z real a,real f,real a",
      ]);
    },
    180_000,
  );
});
