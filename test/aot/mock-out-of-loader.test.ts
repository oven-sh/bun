// `bun test` takes whoever imports a module out of its loader when a mock of the module ends, and when a mock is laid over what an earlier test file loaded.
// A mock of such an importer comes ahead of its load and stands for the whole module. A load that has come by in between brings the importer back: the mock is laid over it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

const graph = {
  "package.json": `{ "name": "p" }`,
  "leaf.mjs": `export const leaf = "real leaf";\n`,
  "dep.mjs": `export * from "./leaf.mjs";\nexport const real = "real";\n`,
  // Nothing of it runs.
  "barrel.mjs": `export * from "./dep.mjs";\n`,
  "outer.mjs": `export * from "./barrel.mjs";\n`,
  "body.mjs": `export * from "./dep.mjs";\nexport const ofBody = "of body";\n`,
  "above.mjs": `export * from "./body.mjs";\n`,
  "side.mjs": `export { leaf } from "./leaf.mjs";\n`,
  "first.mjs": `import { real, leaf } from "./outer.mjs";
import { ofBody } from "./above.mjs";
console.log("SEEN first", real, leaf, ofBody);
`,
  "whole.mjs": `import * as space from "./outer.mjs";
import { own, real } from "./outer.mjs";
import { own as ownOfBarrel, real as realOfBarrel } from "./barrel.mjs";
import * as spaceAbove from "./above.mjs";
import { own as ownAbove, ofBody } from "./above.mjs";
import { own as ownOfBody, real as realOfBody } from "./body.mjs";
console.log("SEEN whole", own, real, ownOfBarrel, realOfBarrel, Object.keys(space).join(), space.leaf);
console.log("SEEN whole", ownAbove, ofBody, ownOfBody, realOfBody, Object.keys(spaceAbove).join(), spaceAbove.leaf);
`,
  "over.mjs": `import * as space from "./outer.mjs";
import { real } from "./outer.mjs";
import { real as realOfBarrel } from "./barrel.mjs";
import * as spaceAbove from "./above.mjs";
import { ofBody } from "./above.mjs";
import { real as realOfBody } from "./body.mjs";
console.log("SEEN over", real, realOfBarrel, Object.keys(space).join(), space.own);
console.log("SEEN over", ofBody, realOfBody, Object.keys(spaceAbove).join(), spaceAbove.own);
`,
  "after.mjs": `import * as space from "./outer.mjs";
import { real, leaf } from "./outer.mjs";
import * as spaceAbove from "./above.mjs";
console.log("SEEN after", real, leaf, Object.keys(space).join(), Object.keys(spaceAbove).join(), spaceAbove.ofBody);
`,
};

const testFile = (body: string, statement = "") => `import { mock, test } from "bun:test";
${statement}test("t", async () => {
  ${body}
});
`;
const mockOfLeaf = `mock.module("./leaf.mjs", () => ({ leaf: "mock leaf" }));`;
const mocksOfImporters = `mock.module("./barrel.mjs", () => ({ own: "mock own" })); mock.module("./body.mjs", () => ({ own: "own of body" }));`;
const mocksLeaf = testFile(`${mockOfLeaf} await import("./first.mjs");`);
const loads = testFile(`await import("./first.mjs");`);

const whole = [
  "SEEN whole mock own undefined mock own undefined own undefined",
  "SEEN whole own of body undefined own of body undefined own undefined",
];
const over = ["SEEN over real real leaf,real undefined", "SEEN over of body real leaf,ofBody,real undefined"];

const projects: Record<string, { files: Record<string, string>; expected: string[]; asOneProgramAlone?: boolean }> = {
  "the mock of a leaf has ended, and so does the mock of its importer": {
    files: {
      "a.test.mjs": mocksLeaf,
      "b.test.mjs": testFile(`${mocksOfImporters} await import("./whole.mjs");`),
      "c.test.mjs": testFile(`await import("./after.mjs");`),
    },
    expected: [
      "SEEN first real mock leaf of body",
      ...whole,
      "SEEN after real real leaf leaf,real leaf,ofBody,real of body",
    ],
  },
  "a test file lies between": {
    files: {
      "a.test.mjs": mocksLeaf,
      "b.test.mjs": testFile(""),
      "c.test.mjs": testFile(`${mocksOfImporters} await import("./whole.mjs");`),
    },
    expected: ["SEEN first real mock leaf of body", ...whole],
  },
  "the mock that has ended was laid over the leaf": {
    files: {
      "a.test.mjs": testFile(`await import("./first.mjs"); ${mockOfLeaf}`),
      "b.test.mjs": testFile(`${mocksOfImporters} await import("./whole.mjs");`),
    },
    expected: ["SEEN first real real leaf of body", ...whole],
  },
  "a mock is laid over a module below that an earlier test file loaded": {
    files: {
      "a.test.mjs": loads,
      "b.test.mjs": testFile(
        `mock.module("./dep.mjs", () => ({ real: "mock real" })); ${mocksOfImporters} await import("./whole.mjs");`,
      ),
    },
    expected: ["SEEN first real real leaf of body", ...whole],
  },
  "a load has come by a module below alone": {
    files: {
      "a.test.mjs": mocksLeaf,
      "b.test.mjs": testFile(`await import("./dep.mjs"); ${mocksOfImporters} await import("./whole.mjs");`),
    },
    expected: ["SEEN first real mock leaf of body", ...whole],
  },
  "another importer has loaded the leaf again": {
    files: {
      "a.test.mjs": mocksLeaf,
      "b.test.mjs": testFile(`await import("./side.mjs"); ${mocksOfImporters} await import("./whole.mjs");`),
    },
    expected: ["SEEN first real mock leaf of body", ...whole],
  },
  "the mock that has ended was one of a built-in module": {
    files: {
      "leaf.mjs": `import { EOL } from "node:os";\nexport const leaf = "leaf " + EOL;\n`,
      "a.test.mjs": testFile(`mock.module("node:os", () => ({ EOL: "mock EOL" })); await import("./first.mjs");`),
      "b.test.mjs": testFile(`${mocksOfImporters} await import("./whole.mjs");`),
    },
    expected: ["SEEN first real leaf mock EOL of body", ...whole],
    // TODO: the importers lie in another image than the built-in module, and stay loaded there.
    asOneProgramAlone: true,
  },
  "a module of an earlier test file is imported again behind the mock of what it imports": {
    files: {
      "reader.mjs": `import { ofBody, real } from "./above.mjs";\nexport const read = () => ofBody + " " + real;\n`,
      "a.test.mjs": testFile(`${mockOfLeaf} console.log("SEEN a", (await import("./reader.mjs")).read());`),
      "b.test.mjs": testFile(
        `mock.module("./body.mjs", () => ({ ofBody: "mock of body" })); console.log("SEEN b", (await import("./reader.mjs")).read());`,
      ),
      "c.test.mjs": testFile(`console.log("SEEN c", (await import("./reader.mjs")).read());`),
    },
    expected: ["SEEN a of body real", "SEEN b mock of body undefined", "SEEN c of body real"],
  },
  "the factory asks for the original, whose imports the mock that has ended kept from running": {
    files: {
      "a.test.mjs": mocksLeaf,
      "b.test.mjs": `import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./body.mjs", async importOriginal => ({ ...(await importOriginal()), ofBody: "mock of body" }));
  const space = await import("./above.mjs");
  console.log("SEEN original", space.ofBody, space.real, space.leaf, Object.keys(space).join());
});
`,
    },
    expected: ["SEEN first real mock leaf of body", "SEEN original mock of body real real leaf leaf,ofBody,real"],
  },
  "a mock without a factory is made of the original, whose imports the mock that has ended kept from running": {
    files: {
      "a.test.mjs": mocksLeaf,
      "b.test.mjs": `import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./body.mjs");
  const space = await import("./body.mjs");
  console.log("SEEN made", space.ofBody, space.real, space.leaf, Object.keys(space).join());
});
`,
    },
    expected: ["SEEN first real mock leaf of body", "SEEN made of body real real leaf leaf,ofBody,real"],
  },
  "two mocks ahead of the load": {
    files: {
      "a.test.mjs": mocksLeaf,
      "b.test.mjs": testFile(
        `mock.module("./barrel.mjs", () => ({ own: "the first mock" })); mock.module("./body.mjs", () => ({ own: "the first mock" })); ${mocksOfImporters} await import("./whole.mjs");`,
      ),
    },
    expected: ["SEEN first real mock leaf of body", ...whole],
  },
  "a statement has loaded the importer again": {
    files: {
      "a.test.mjs": mocksLeaf,
      "b.test.mjs": testFile(
        `${mocksOfImporters} await import("./over.mjs");`,
        `import "./outer.mjs";\nimport "./above.mjs";\n`,
      ),
    },
    expected: ["SEEN first real mock leaf of body", ...over],
  },
  "an import() has loaded the importer again": {
    files: {
      "a.test.mjs": mocksLeaf,
      "b.test.mjs": testFile(
        `await import("./outer.mjs"); await import("./above.mjs"); ${mocksOfImporters} await import("./over.mjs");`,
      ),
    },
    expected: ["SEEN first real mock leaf of body", ...over],
  },
  "no mock has ended": {
    files: { "a.test.mjs": loads, "b.test.mjs": testFile(`${mocksOfImporters} await import("./over.mjs");`) },
    expected: ["SEEN first real real leaf of body", ...over],
  },
};

const witnessOverLayers = "a mock is laid over a module below that an earlier test file loaded";

for (const [name, { files, expected, asOneProgramAlone }] of Object.entries(projects)) {
  test.concurrent(
    name,
    async () => {
      using dir = tempDir("aot-mock-out-of-loader", { ...graph, ...files });
      for (const [words, flags] of [
        [undefined, []],
        ["TestRunLayers:0", ["--aot"]],
        ["TestRunLayers:2", ["--aot"]],
      ] as const) {
        if (asOneProgramAlone && words === "TestRunLayers:2") continue;
        if (words === "TestRunLayers:2" && !runsWholeGrids && name !== witnessOverLayers) continue;
        const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
        const { stdout, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
        expect({ words, stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode }).toEqual({
          words,
          stdout: expected,
          exitCode: 0,
        });
      }
    },
    120_000,
  );
}
