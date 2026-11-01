// react-dom, scheduler, @testing-library and many more ask whether a test runs them: `var jestIsDefined = typeof jest !== "undefined";`.
// The build took a `jest` that is not called for one that goes somewhere, so the package "mocked a module that it does not spell", and every
// module of that program and of every layer above it counted as one that a mock may replace. What is only tested goes nowhere.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const asks = {
  "typeof and a comparison": `var jestIsDefined = typeof jest !== "undefined";\nexports.inTest = () => jestIsDefined;\n`,
  "the other tests": `exports.inTest = () => [typeof vi === "undefined", typeof jest == "object" && jest !== null, typeof jest !== "undefined" && !jest, typeof jest !== "undefined" && jest ? 1 : 2].join();\nif (typeof jest !== "undefined" && jest) exports.seen = true;\n`,
};
const uses = {
  "handed on": `const { jest } = require("bun:test");\nexports.inTest = () => typeof jest;\nexports.runner = () => jest;\n`,
  "stored": `const { jest } = require("bun:test");\nconst kept = { runner: jest };\nexports.inTest = () => typeof kept.runner;\n`,
  "the left side of ||": `const { jest } = require("bun:test");\nconst runner = jest || null;\nexports.inTest = () => typeof runner;\n`,
};

async function run(text: string, flags: string[], words?: string) {
  using dir = tempDir("aot-asks-for-jest", {
    "package.json": `{ "name": "p" }`,
    "node_modules/asks/package.json": `{ "name": "asks", "main": "index.js" }`,
    "node_modules/asks/index.js": text,
    "src/dep.ts": `export const name = () => "dep";\n`,
    "src/index.ts": `import asks from "asks";\nimport { name } from "./dep";\nexport const run = () => [String(asks.inTest()), name()].join(" | ");\n`,
    "a.test.ts": `import { test } from "bun:test";\nimport { run } from "./src";\ntest("t", () => { console.error("OUT", run()); });\n`,
  });
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: flags.length ? "1" : undefined, BUN_DEBUG_TEST_AOT_WORDS: words };
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  const lines = stderr.split("\n");
  return {
    printed: lines.filter(line => /^(OUT|error|TypeError)/.test(line)),
    namesPackage: lines.some(line => line.includes("a package takes from the test runner")),
    exitCode,
  };
}

const forms: [string[], string?][] = [[["--aot"]], [["--aot"], "TestRunLayers:2"], [["--aot"], "TestRunLayers:3"]];

test.concurrent.each(Object.entries(asks))(
  "only asked: %s",
  async (_, text) => {
    const plain = await run(text, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.printed).toHaveLength(1);
    for (const [flags, words] of forms) {
      expect(await run(text, flags, words)).toEqual({ ...plain, namesPackage: false });
    }
  },
  240_000,
);

test.concurrent.each(Object.entries(uses))(
  "it goes somewhere: %s",
  async (_, text) => {
    const plain = await run(text, []);
    expect(plain.exitCode).toBe(0);
    for (const [flags, words] of forms) {
      expect(await run(text, flags, words)).toEqual({ ...plain, namesPackage: true });
    }
  },
  240_000,
);
