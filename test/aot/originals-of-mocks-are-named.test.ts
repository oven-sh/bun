import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const head = `import { jest, test, vi } from "bun:test";\n`;

const unlike: Record<string, { told: string; files: Record<string, string> }> = {
  "exports that lead back to it": {
    told: "shapes.mjs: it has an `export *` of a file that imports a mocked file",
    files: {
      "shapes.mjs": `export * from "./outer.mjs";\nexport const square = 3;`,
      "outer.mjs": `export { round } from "./far.mjs";`,
      "far.mjs": `import "./shapes.mjs";\nexport const round = 1;`,
      "a.test.mjs": `${head}vi.mock("./shapes.mjs", async original => ({ ...(await original()), square: 4 }));
test("a", async () => console.log("SAID", (await import("./shapes.mjs")).square));`,
    },
  },
  "a factory that awaits the load of an importer": {
    told: "part.mjs: another import, mock or factory was under way when its top-level code ran",
    files: {
      "part.mjs": `export const part = "real";`,
      "user.mjs": `import { part } from "./part.mjs";\nexport const read = () => part;`,
      "other.mjs": `export const other = "real";`,
      "a.test.mjs": `${head}vi.mock("./part.mjs", async original => ({ part: "mock " + (await original()).part }));
vi.mock("./other.mjs", async () => ({ other: (await import("./user.mjs")).read() }));
test("a", async () => console.log("SAID", (await import("./other.mjs")).other));`,
    },
  },
  "a require() of an importer": {
    told: "part.mjs: another import, mock or factory was under way when its top-level code ran",
    files: {
      "part.mjs": `export const part = "real";`,
      "user.mjs": `import { part } from "./part.mjs";\nexport const read = () => part;`,
      "a.test.mjs": `${head}test("a", () => {
  vi.doMock("./part.mjs", async original => ({ part: "mock " + (await original()).part }));
  console.log("SAID", require("./user.mjs").read());
});`,
    },
  },
  "a body that awaits, mocked again": {
    told: "part.mjs: its top-level code awaits, and it was mocked again",
    files: {
      "part.mjs": `await 0;\nexport const part = "real";`,
      "a.test.mjs": `${head}test("a", async () => {
  vi.doMock("./part.mjs", () => ({ part: "first" }));
  await import("./part.mjs");
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mark: 1 }));
  console.log("SAID", (await import("./part.mjs")).part);
});`,
    },
  },
  "a built-in module whose mock is replaced": {
    told: "part.mjs: a mock of a built-in module that it imports was replaced or has ended",
    files: {
      "part.mjs": `import { randomInt } from "node:crypto";\nexport { hash } from "./other.mjs";\nexport const part = () => randomInt();`,
      "other.mjs": `import { randomInt } from "node:crypto";\nexport const hash = () => randomInt();`,
      "a.test.mjs": `${head}vi.mock("node:crypto", () => ({ randomInt: () => 1 }));
vi.mock("./part.mjs", async original => ({ ...(await original()), mark: 1 }));
test("a", async () => {
  const { part, hash } = await import("./part.mjs");
  console.log("SAID", part(), hash());
  vi.doMock("node:crypto", () => ({ randomInt: () => 2 }));
  console.log("SAID", part(), hash());
});`,
    },
  },
  "a body that awaits while the modules are reset": {
    told: "part.mjs: the modules were reset while its top-level code awaited",
    files: {
      "part.mjs": `globalThis.begun();\nawait globalThis.gate;\nexport const part = "real";`,
      "a.test.mjs": `${head}test("a", async () => {
  let open;
  globalThis.gate = new Promise(resolve => { open = resolve; });
  const begun = new Promise(resolve => { globalThis.begun = resolve; });
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mark: 1 }));
  const load = import("./part.mjs");
  await begun;
  vi.resetModules();
  open();
  console.log("SAID", (await load).part);
});`,
    },
  },
  "an import() in flight when it is mocked again": {
    told: "part.mjs: it was mocked while an import() of it was in flight",
    files: {
      "part.mjs": `export const part = "real";`,
      "a.test.mjs": `${head}test("a", async () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), mark: 1 }));
  await import("./part.mjs");
  const early = import("./part.mjs");
  vi.doMock("./part.mjs", () => ({ part: "mock" }));
  console.log("SAID", (await early).part);
});`,
    },
  },
  "a mock that adds a name of another export *": {
    told: "part.mjs: its mock adds names, and a file has another `export *` beside the one of it",
    files: {
      "part.mjs": `export const part = "real";`,
      "plain.mjs": `export const added = "plain";`,
      "wide.mjs": `export * from "./part.mjs";\nexport * from "./plain.mjs";`,
      "a.test.mjs": `${head}import * as wide from "./wide.mjs";
vi.mock("./part.mjs", async original => ({ ...(await original()), added: "mock" }));
test("a", () => console.log("SAID", wide.part));`,
    },
  },
  "code of its package that was written during the run": {
    told: "box.mjs: importers that bypass its mock share no instance with the mock's factory",
    files: {
      "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module" }`,
      "node_modules/pkg/box.mjs": `export const name = "real";`,
      "a.test.mjs": `${head}import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { name } from "pkg/box.mjs";
vi.mock("pkg/box.mjs", async original => ({ ...(await original()), name: "mock" }));
test("a", async () => {
  const reader = join(import.meta.dir, "node_modules", "pkg", "reader.mjs");
  writeFileSync(reader, 'import { name } from "./box.mjs"; export const read = name;');
  console.log("SAID", name, (await import(reader)).read);
});`,
    },
  },
  "top-level code that imports an importer": {
    told: "part.mjs: its top-level code loads a file that loads it",
    files: {
      "part.mjs": `export const part = "real";\nexport const later = import("./user.mjs");`,
      "user.mjs": `import { part } from "./part.mjs";\nexport const read = () => part;`,
      "a.test.mjs": `${head}vi.mock("./part.mjs", async original => ({ ...(await original()), part: "mock" }));
test("a", async () => console.log("SAID", (await import("./part.mjs")).part));`,
    },
  },
  ...Object.fromEntries(
    Object.entries({
      "import()": `async () => ({ ...(await import("./part.mjs")), read: () => "mock" })`,
      "importActual()": `async () => ({ ...(await vi.importActual("./part.mjs")), read: () => "mock" })`,
      "the original that it is given": `async original => ({ ...(await original()), read: () => "mock" })`,
      "requireActual()": `() => ({ ...jest.requireActual("./part.mjs"), read: () => "mock" })`,
    }).map(([how, factory]) => [
      `an import cycle, loaded by ${how}`,
      {
        told: "part.mjs: its top-level code loads a file that loads it",
        files: {
          "part.mjs": `import { name } from "./user.mjs";\nexport function read() { return "real"; }\nexport const shown = () => name;`,
          "user.mjs": `import { read } from "./part.mjs";\nexport const name = "user";\nexport const atLoad = (() => { try { return read(); } catch (error) { return error.name; } })();`,
          "a.test.mjs": `${head}vi.mock("./part.mjs", ${factory});
test("a", async () => {
  await import("./part.mjs");
  console.log("SAID", (await import("./user.mjs")).atLoad);
});`,
        },
      },
    ]),
  ),
};

test.each(Object.entries(unlike))("the run names the original of a mock with %s", async (_, { told, files: own }) => {
  using directory = tempDir("originals-run-compiled", { "package.json": `{ "name": "p", "type": "module" }`, ...own });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
  expect(stdout + "\n" + stderr).toContain(told);
  expect(stdout + "\n" + stderr).not.toContain("ran from source");
});
