// `vi.doMock(k, async () => ({ x: (await vi.importActual("./other.mjs")).sees() }))`: once the mocked file has run, the file that the runner is asked for runs as a copy, from its text. What it
// imports from compiled files is looked up by name in their tables, and the build keeps only the exports that something refers to. It used to count the mocked files themselves as such copies, but
// not the files that the runner is asked for: `Export named 'through' not found in module 'mid.mjs'`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const mocked = `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexport const x = "real";\n`;
const asksInFactory = `import { test, vi } from "bun:test";
test("t", async () => {
  await import("./k.mjs");
  vi.doMock("./k.mjs", async () => ({ x: "mocked over " + (await vi.importActual("./other.mjs")).sees() }));
  console.log("SAID", (await import("./k.mjs")).x, globalThis.runs);
});
`;

const cases: Record<string, { files: Record<string, string>; said: string[] }> = {
  "a name of a file between, which imports the mocked file": {
    files: {
      "mid.mjs": `import { x } from "./k.mjs";\nexport const through = () => "through " + x;\n`,
      "other.mjs": `import { through } from "./mid.mjs";\nexport const sees = () => through();\n`,
    },
    said: ["SAID mocked over through real 1"],
  },
  "a name that the file between hands on from the mocked file": {
    files: {
      "mid.mjs": `export { x } from "./k.mjs";\n`,
      "other.mjs": `import { x } from "./mid.mjs";\nexport const sees = () => x;\n`,
    },
    said: ["SAID mocked over real 1"],
  },
  "a name handed on by two stars": {
    files: {
      "far.mjs": `export const deep = () => "deep";\n`,
      "between.mjs": `export * from "./far.mjs";\n`,
      "mid.mjs": `import "./k.mjs";\nexport * from "./between.mjs";\n`,
      "other.mjs": `import { deep } from "./mid.mjs";\nexport const sees = () => deep();\n`,
    },
    said: ["SAID mocked over deep 1"],
  },
  "a name that nothing compiled refers to": {
    files: {
      "far.mjs": `export const unused = () => "unused";\nexport const used = () => "used";\n`,
      "mid.mjs": `import "./k.mjs";\nimport { used } from "./far.mjs";\nexport const through = () => used();\n`,
      "other.mjs": `import { through } from "./mid.mjs";\nimport { unused } from "./far.mjs";\nexport const sees = () => through() + " " + unused();\n`,
    },
    said: ["SAID mocked over used unused 1"],
  },
};

for (const [name, { files, said }] of Object.entries(cases)) {
  test(name, async () => {
    using dir = tempDir("aot-a-file-that-the-test-runner-is-asked-for", {
      "package.json": `{ "name": "made-up", "type": "module" }\n`,
      "k.mjs": mocked,
      "a_test.mjs": asksInFactory,
      ...files,
    });
    for (const flags of [[], ["--aot"]]) {
      const { stdout } = await run([bunExe(), "test", ...flags, "./a_test.mjs"], String(dir), {
        ...bunEnv,
        NO_COLOR: "1",
      });
      expect(stdout.split("\n").filter(line => line.startsWith("SAID"))).toEqual(said);
    }
  });
}
