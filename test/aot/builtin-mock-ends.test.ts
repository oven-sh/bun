// The mock of a built-in module ends with its test file. The code under test, which both test files import, reads the module itself in the next one.
// Over layers that code lies in another program than the module: it went on reading the mock.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

// A small run takes layers by itself with --parallel and more source than fits the memory it is given: every test file imports 300 KB of filler.
const filler = Array.from({ length: 6000 }, (_, i) => `export function filler${i}(x) { return x + ${i}; }\n`).join("");
const importsFiller = `import { filler1 } from "./filler.mjs"; void filler1;\n`;

const reads = (module: string, call: string) => `import it from "${module}";
import * as all from "${module}";
import { ${call.split("(")[0]} } from "${module}";
export const seen = () => [it.${call}, all.${call}, ${call}].join();
`;
const factory = (name: string, says = "mocked") =>
  `() => ({ default: { ${name}: () => "${says}" }, ${name}: () => "${says}" })`;
const says = (file: string) => `test("${file}", () => console.error("OUT ${file} " + seen()));\n`;
const importsReader = `import { seen } from "./src/uses.js";\n`;
const withoutMock = (file: string) => `import { test } from "bun:test";\n${importsReader}${says(file)}`;

const endedByTest = "a test ends the mock itself";

const projects: Record<string, Record<string, string>> = {
  "vi.mock()": {
    "src/uses.js": reads("node:fs", `existsSync("/nowhere")`),
    "a.test.js": `import { test, vi } from "bun:test";\n${importsReader}vi.mock("node:fs", ${factory("existsSync")});\n${says("a")}`,
    "b.test.js": withoutMock("b"),
  },
  "jest.mock(), and the reader leaves the prefix out": {
    "src/uses.js": reads("fs", `existsSync("/nowhere")`),
    "a.test.js": `import { test, jest } from "bun:test";\n${importsReader}jest.mock("node:fs", ${factory("existsSync")});\n${says("a")}`,
    "b.test.js": withoutMock("b"),
  },
  "mock.module() ahead of an import()": {
    "src/uses.js": reads("node:os", "platform()"),
    "a.test.js": `import { test, mock } from "bun:test";\nmock.module("node:os", ${factory("platform")});\nconst { seen } = await import("./src/uses.js");\n${says("a")}`,
    "b.test.js": withoutMock("b"),
  },
  "the next test file has a mock of its own": {
    "src/uses.js": reads("node:fs", `existsSync("/nowhere")`),
    "a.test.js": `import { test, vi } from "bun:test";\n${importsReader}vi.mock("node:fs", ${factory("existsSync")});\n${says("a")}`,
    "b.test.js": `import { test, vi } from "bun:test";\n${importsReader}vi.mock("node:fs", ${factory("existsSync", "second")});\n${says("b")}`,
    "c.test.js": withoutMock("c"),
  },
  // Whoever was linked against the mock goes on reading it until the test file ends.
  [endedByTest]: {
    "src/uses.js": reads("node:fs", `existsSync("/nowhere")`),
    "a.test.js": `import { test, vi } from "bun:test";\n${importsReader}vi.mock("node:fs", ${factory("existsSync")});
test("a", () => { console.error("OUT a " + seen()); vi.doUnmock("node:fs"); console.error("OUT a " + seen()); });\n${says("a2")}`,
    "b.test.js": withoutMock("b"),
  },
};

test.each(Object.keys(projects))(
  "%s",
  async name => {
    const files = Object.entries(projects[name]).map(([path, text]) => [
      path,
      /\.test\./.test(path) ? importsFiller + text : text,
    ]);
    using dir = tempDir("aot-builtin-mock-ends", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "filler.mjs": filler,
      ...Object.fromEntries(files),
    });
    const printed = async (...flags: string[]) => {
      const { stdout, stderr } = await run([bunExe(), "test", "--parallel=1", "--no-isolate", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" }); // prettier-ignore
      return (stdout + "\n" + stderr).split("\n");
    };
    const seen = (lines: string[]) => lines.filter(line => line.startsWith("OUT "));
    const plain = seen(await printed());
    expect(plain[0]).toBe("OUT a mocked,mocked,mocked");
    expect(plain.length).toBe(name === endedByTest ? 4 : files.length - 1);
    expect(plain.at(-1)).not.toMatch(/mocked|second/);
    const layers = await printed("--aot", "--aot-memory-limit", "1MB");
    expectLayers(layers.join("\n"));
    expect(seen(layers)).toEqual(plain);
    expect(seen(await printed("--aot"))).toEqual(plain);
  },
  240_000,
);
