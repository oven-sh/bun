// A mock that stood in place of a module while its importers ran leaves the module owed to them: its body runs when a load next comes by.
// The walk that pays passes over a mocked module, and it noted all the same that nothing was owed below its root.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

// A small run takes layers by itself with more source than fits the memory it is given: each test file imports 300 KB of filler.
const filler = Array.from({ length: 6000 }, (_, i) => `export function filler${i}(x) { return x + ${i}; }\n`).join("");

// The three test files are alike, and a counter picks the step: the order in which the runner takes them does not matter.
const testFile = (endOfX: string, endOfM2: string) => `import { filler1 } from "../src/filler.mjs"; void filler1;
import { test, vi } from "bun:test";
const say = (at, r) => {
  let read;
  try { read = r.read() + ""; } catch (error) { read = "threw " + error.name; }
  console.log("SEEN " + at + " | " + read + " | " + r.tagOf() + " | x ran " + (globalThis.ranX ?? 0));
};
test("t", async () => {
  const step = (globalThis.step = (globalThis.step ?? 0) + 1);
  if (step === 1) {
    vi.doMock("../src/x.js", () => ({ value: "mock x" }));
    say(1, await import("../src/r.js"));
    ${endOfX}
  } else if (step === 2) {
    vi.doMock("../src/m2.js", () => ({ viaM2: () => "mock m2", tag: "mock m2" }));
    say(2, import.meta.require("../src/r.js"));
    ${endOfM2}
  } else say(3, import.meta.require("../src/r.js"));
});
`;

test.each([
  ["the mocks end with their test files", "", ""],
  ["vi.doUnmock() ends the mocks", `vi.doUnmock("../src/x.js");`, `vi.doUnmock("../src/m2.js");`],
])(
  "%s",
  async (_, endOfX, endOfM2) => {
    const text = testFile(endOfX, endOfM2);
    using dir = tempDir("aot-owed-behind-mock", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "src/filler.mjs": filler,
      "src/x.js": `globalThis.ranX = (globalThis.ranX ?? 0) + 1;\nexport const value = "real x";\n`,
      "src/m2.js": `import { value } from "./x.js";\nexport const viaM2 = () => value;\nexport const tag = "real m2";\n`,
      "src/r.js": `import { viaM2, tag } from "./m2.js";\nexport const read = () => viaM2();\nexport const tagOf = () => tag;\n`,
      "test/a.test.js": text,
      "test/b.test.js": text,
      "test/c.test.js": text,
    });
    const printed = async (...flags: string[]) => {
      const { stdout, stderr } = await run([bunExe(), "test", "--parallel=1", "--no-isolate", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" }); // prettier-ignore
      return (stdout + "\n" + stderr).split("\n");
    };
    const seen = (lines: string[]) => lines.filter(line => line.startsWith("SEEN "));
    const plain = seen(await printed());
    expect(plain).toEqual([
      "SEEN 1 | mock x | real m2 | x ran 0",
      "SEEN 2 | mock m2 | mock m2 | x ran 0",
      "SEEN 3 | real x | real m2 | x ran 1",
    ]);
    expect(seen(await printed("--aot"))).toEqual(plain);
    const layers = await printed("--aot", "--aot-memory-limit", "1MB");
    expectLayers(layers.join("\n"));
    expect(seen(layers)).toEqual(plain);
  },
  240_000,
);
