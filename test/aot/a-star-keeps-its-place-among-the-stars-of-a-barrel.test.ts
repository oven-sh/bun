// Under mocks the first star of a barrel that brings a name gives it. Which star is the first is the order of the `export *`
// statements, whatever import of one of their files stands above them.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { spawned } from "./harness/commands";
import { test } from "./supported";

const reader = `import * as all from "./barrel.mjs";
export const late = () => Object.keys(all).filter(name => name !== "default").join() + " size " + all.size + " who " + all.who;
`;
const asks = (mocked: string, factory: string) => `import { test, vi } from "bun:test";
test("under the mock", async () => {
  vi.doMock("./${mocked}", () => (${factory}));
  const under = await import("./reader.mjs");
  console.log("SAID", under.late());
});
`;
const cases: Record<string, Record<string, string>> = {
  "the-mocked-file-is-imported-above": {
    "crate.cjs": `exports.size = 1; exports.depth = 2;`,
    "shelf.mjs": `export const size = 5;`,
    "barrel.mjs": `import { depth } from "./crate.cjs"; export * from "./shelf.mjs"; export * from "./crate.cjs"; export const twice = () => depth * 2;`,
    "asks.test.mjs": asks("crate.cjs", "{ size: 10, depth: 20 }"),
  },
  "the-other-file-is-imported-above": {
    "crate.cjs": `exports.size = 1; exports.depth = 2;`,
    "shelf.mjs": `export const size = 5;`,
    "barrel.mjs": `import "./shelf.mjs"; export * from "./crate.cjs"; export * from "./shelf.mjs";`,
    "asks.test.mjs": asks("crate.cjs", "{ size: 10, depth: 20 }"),
  },
  "the-second-is-imported-above-and-the-first-is-mocked": {
    "first.cjs": `exports.who = "real first"; exports.size = 1;`,
    "second.cjs": `exports.who = "real second"; exports.own = 2;`,
    "barrel.mjs": `import "./second.cjs"; export * from "./first.cjs"; export * from "./second.cjs";`,
    "asks.test.mjs": asks("first.cjs", `{ who: "mock first" }`),
  },
  "the-second-is-imported-above-and-is-mocked": {
    "first.cjs": `exports.who = "real first"; exports.size = 1;`,
    "second.cjs": `exports.who = "real second"; exports.own = 2;`,
    "barrel.mjs": `import "./second.cjs"; export * from "./first.cjs"; export * from "./second.cjs";`,
    "asks.test.mjs": asks("second.cjs", `{ who: "mock second" }`),
  },
};
const env = { ...bunEnv, NO_COLOR: "1" };
const said = (printed: string) => printed.split("\n").filter(line => line.startsWith("SAID"));

for (const [name, files] of Object.entries(cases)) {
  test(
    name,
    async () => {
      using dir = tempDir("aot-stars-in-their-order", {
        "package.json": `{ "name": "stars-in-their-order", "private": true }`,
        "reader.mjs": reader,
        ...files,
      });
      const plain = await spawned([bunExe(), "test"], String(dir), env, 90_000);
      const compiled = await spawned([bunExe(), "test", "--aot"], String(dir), env, 300_000);
      const expected = said(plain.stdout);
      expect(expected.length).toBe(1);
      expect(said(compiled.stdout)).toEqual(expected);
    },
    400_000,
  );
}
