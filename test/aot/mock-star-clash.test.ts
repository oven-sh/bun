import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// Two `export *` of a barrel bring the same name. Without a mock the name is ambiguous, and the barrel does not have it. What a mock gives makes no name ambiguous:
// the first star that has the name keeps it, as in Vitest. That holds for a mock that comes ahead of the load. mock.module() is not hoisted: laid over a module that
// has run it replaces values, and the name stays ambiguous.
const head = `import { test, vi } from "bun:test";\n`;
const clashFirst = `export * from "./clash.js";\nexport * from "./dep.js";`;
const mockedFirst = `export * from "./dep.js";\nexport * from "./clash.js";`;
const twoOthers = `export * from "./clash.js";\nexport * from "./clash2.js";\nexport * from "./dep.js";`;
const throughRing = `export * from "./clash.js";\nexport * from "./ring.js";`;
const throughNamespace = `export * from "./clash.js";\nexport * from "./namespace.js";`;
const namespaceFirst = `export * from "./namespace.js";\nexport * from "./clash.js";`;
const whole = `import * as barrel from "./barrel.js";
export const seen = () => "x=" + barrel.x + " f=" + barrel.f + " keys=" + Object.keys(barrel).join("+");`;
const kinds = `import * as barrel from "./barrel.js";
export const seen = () => "x=" + typeof barrel.x + " f=" + barrel.f + " keys=" + Object.keys(barrel).join("+");`;
const named = `import { x, f } from "./barrel.js";\nexport const seen = () => "x=" + x + " f=" + f;`;
const says = `import { seen } from "./user.js";\ntest("t", () => console.log("SEEN", seen()));`;
const withX = `vi.mock("./dep.js", () => ({ x: "mock x", f: "mock f" }));\n`;
// The first look at the barrel comes behind the mock.
const laidOver = `import { mock } from "bun:test";
import { seen } from "./user.js";
mock.module("./dep.js", () => ({ x: "mock x", f: "mock f" }));
test("t", async () => {
  console.log("SEEN", seen());
  const barrel = await import("./barrel.js");
  console.log("SEEN", barrel.x, barrel.f);
});`;
const withoutX = `vi.mock("./dep.js", () => ({ f: "mock f" }));\n`;

const projects: Record<string, [string, string, string, string[]]> = {
  "the other star first, and the mock has the name": [
    clashFirst,
    whole,
    withX + says,
    ["SEEN x=clash x f=mock f keys=f+other+x"],
  ],
  "the other star first, and the mock lacks the name": [
    clashFirst,
    whole,
    withoutX + says,
    ["SEEN x=clash x f=mock f keys=f+other+x"],
  ],
  "the mocked star first, and the mock has the name": [
    mockedFirst,
    whole,
    withX + says,
    ["SEEN x=mock x f=mock f keys=f+other+x"],
  ],
  "the mocked star first, and the mock lacks the name": [
    mockedFirst,
    whole,
    withoutX + says,
    ["SEEN x=clash x f=mock f keys=f+other+x"],
  ],
  "both stars are mocked": [
    clashFirst,
    whole,
    withX + `vi.mock("./clash.js", () => ({ x: "mock clash" }));\n` + says,
    ["SEEN x=mock clash f=mock f keys=f+x"],
  ],
  "an import by name": [clashFirst, named, withX + says, ["SEEN x=clash x f=mock f"]],
  "a mock that comes late and ends": [
    clashFirst,
    whole,
    `test("t", async () => {
      vi.doMock("./dep.js", () => ({ x: "mock x", f: "mock f" }));
      const { seen } = await import("./user.js");
      console.log("SEEN", seen());
      vi.doUnmock("./dep.js");
      console.log("SEEN", seen());
    });`,
    ["SEEN x=clash x f=mock f keys=f+other+x", "SEEN x=clash x f=mock f keys=f+other+x"],
  ],
  "two other stars bring the name, and the mock lacks it": [
    twoOthers,
    whole,
    withoutX + says,
    ["SEEN x=undefined f=mock f keys=f+other"],
  ],
  "two other stars bring the name, and the mock has it": [
    twoOthers,
    whole,
    withX + says,
    ["SEEN x=undefined f=mock f keys=f+other"],
  ],
  "a ring of stars with the mock in it": [
    throughRing,
    whole,
    withX + says,
    ["SEEN x=clash x f=mock f keys=f+other+r+x"],
  ],
  "a ring of stars, and no mock": [throughRing, whole, says, ["SEEN x=undefined f=real f keys=f+other+r"]],
  "a mock laid over what has run, the other star first": [
    clashFirst,
    whole,
    laidOver,
    ["SEEN x=undefined f=mock f keys=f+other", "SEEN undefined mock f"],
  ],
  "a mock laid over what has run, its own star first": [
    mockedFirst,
    whole,
    laidOver,
    ["SEEN x=undefined f=mock f keys=f+other", "SEEN undefined mock f"],
  ],
  "the namespace object of the mocked file under the name, the other star first": [
    throughNamespace,
    kinds,
    withX + says,
    ["SEEN x=undefined f=mock f keys=f+other"],
  ],
  "the namespace object of the mocked file under the name, its star first": [
    namespaceFirst,
    kinds,
    withX + says,
    ["SEEN x=undefined f=mock f keys=f+other"],
  ],
  "no mock": [clashFirst, whole, says, ["SEEN x=undefined f=real f keys=f+other"]],
  "no mock, and an import by name": [
    clashFirst,
    named,
    `test("t", async () => { console.log("SEEN", await import("./user.js").then(user => user.seen(), error => error.constructor.name)); });`,
    ["SEEN SyntaxError"],
  ],
};

describe.each(Object.entries(projects))("%s", (_, [barrel, user, text, answer]) => {
  const files = {
    "package.json": `{ "type": "module" }`,
    "clash.js": `export const x = "clash x";\nexport const other = "other";`,
    "clash2.js": `export const x = "clash2 x";`,
    "dep.js": `export const x = "real x";\nexport const f = "real f";`,
    "namespace.js": `export * as x from "./dep.js";\nexport { f } from "./dep.js";`,
    "ring.js": `export * from "./dep.js";\nexport * from "./barrel.js";\nexport const r = "r";`,
    "barrel.js": barrel,
    "user.js": user,
    "a.test.js": head + text,
  };
  test.concurrent.each([
    ["bun test", [], ""],
    ["one program", ["--aot"], "TestRunLayers:0"],
    ["two layers", ["--aot"], "TestRunLayers:2"],
  ])(
    "%s",
    async (_, flags, words) => {
      using directory = tempDir("aot-mock-star-clash", files);
      const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
      const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(directory), env);
      expect((stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN "))).toEqual(answer);
    },
    180_000,
  );
});
