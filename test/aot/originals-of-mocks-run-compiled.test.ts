import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tax.ts": `import { tick } from "./clock";
console.log("SAID tax runs");
let asked = 0;
export let last = 0;
export const rate = "real rate";
export function fee() { last = tick(); return "fee " + ++asked; }
export class Form { count = 0; add() { return ++this.count; } }`,
  "clock.ts": `let ticks = 0;\nexport const tick = () => ++ticks;`,
  "reader.ts": `import { rate, fee } from "./tax";\nexport const read = () => rate + ", " + fee();`,
};
const head = `import { jest, mock, test, vi } from "bun:test";\n`;
const ways = {
  "the parameter of the factory": `vi.mock("./tax", async original => ({ ...(await original()), rate: "mock rate" }));`,
  "vi.importActual() in the factory": `jest.mock("./tax", async () => ({ ...(await vi.importActual("./tax")), rate: "mock rate" }));`,
  "jest.requireActual() in the factory": `vi.mock("./tax", () => ({ ...jest.requireActual("./tax"), rate: "mock rate" }));`,
};

test.each(Object.entries(ways))("the original of a mock runs compiled, by %s", async (_, lay) => {
  using directory = tempDir("originals-run-compiled", {
    ...files,
    "a.test.ts": `${head}import { read } from "./reader";
${lay}
test("a", async () => {
  const actual = await vi.importActual("./tax");
  console.log("SAID", read(), actual.rate, actual.fee(), actual.last, new actual.Form().add());
  vi.doUnmock("./tax");
  console.log("SAID", (await import("./tax")).fee());
});`,
  });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
  const all = stdout + "\n" + stderr;
  expect(all.split("\n").filter(line => line.startsWith("SAID "))).toEqual([
    "SAID tax runs",
    "SAID mock rate, fee 1 real rate fee 2 2 1",
    "SAID tax runs",
    "SAID fee 1",
  ]);
  expect(all).toContain(" 1 pass");
  expect(all).not.toContain("ran from source");
  expect(all).not.toContain("more often");
});

test("a body that awaits stores its exports in its own instance", async () => {
  using directory = tempDir("originals-run-compiled", {
    "package.json": files["package.json"],
    "wick.mjs": `await 0;\nexport const width = "real";`,
    "lamp.mjs": `import { width } from "./wick.mjs";\nexport const seen = width;`,
    "a.test.mjs": `${head}test("a", async () => {
  const begun = [];
  vi.doMock("./wick.mjs", original => {
    begun.push(original().then(own => console.log("SAID original", own.width)));
    return { width: "mock" };
  });
  console.log("SAID", require("./lamp.mjs").seen);
  await Promise.all(begun);
});`,
  });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
  const all = stdout + "\n" + stderr;
  expect(all.split("\n").filter(line => line.startsWith("SAID "))).toEqual(["SAID mock", "SAID original real"]);
  expect(all).toContain(" 1 pass");
  expect(all).not.toContain("ran from source");
});

test("an original that uses import.meta runs compiled", async () => {
  using directory = tempDir("originals-run-compiled", {
    "package.json": files["package.json"],
    "place.mjs": `export const first = import.meta.url;
export const later = () => import.meta.url;
export const rate = 1;`,
    "a.test.mjs": `${head}vi.mock("./place.mjs", async original => ({ ...(await original()), rate: 9 }));
test("a", async () => {
  const shown = it => [it.rate, it.first, it.later()].join(" ").replaceAll(import.meta.dir, "HERE");
  console.log("SAID", shown(await import("./place.mjs")));
  vi.doUnmock("./place.mjs");
  console.log("SAID", shown(await import("./place.mjs")));
});`,
  });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
  const all = stdout + "\n" + stderr;
  expect(all.split("\n").filter(line => line.startsWith("SAID "))).toEqual([
    "SAID 9 file://HERE/place.mjs?actual file://HERE/place.mjs?actual",
    "SAID 1 file://HERE/place.mjs file://HERE/place.mjs",
  ]);
  expect(all).toContain(" 1 pass");
  expect(all).not.toContain("ran from source");
});

const waysOfCommonJS = {
  "the parameter of the factory": `vi.mock("./tax.cjs", async original => ({ ...(await original()), rate: "mock rate" }));`,
  "vi.importActual() in the factory": `vi.mock("./tax.cjs", async () => ({ ...(await vi.importActual("./tax.cjs")), rate: "mock rate" }));`,
  "jest.requireActual() in the factory": `jest.mock("./tax.cjs", () => ({ ...jest.requireActual("./tax.cjs"), rate: "mock rate" }));`,
  "an import of the file itself in the factory": `mock.module("./tax.cjs", async () => ({ ...(await import("./tax.cjs")), rate: "mock rate" }));`,
};

test.each(Object.entries(waysOfCommonJS))("the original of a CommonJS file runs compiled, by %s", async (_, lay) => {
  using directory = tempDir("originals-run-compiled", {
    "package.json": files["package.json"],
    "tax.cjs": `const { basename } = require("node:path");
console.log("SAID tax runs", basename(__filename), arguments.length, this === exports, module.exports === exports);
let asked = 0;
exports.rate = "real rate";
exports.fee = () => exports.rate + " " + ++asked;`,
    "reader.mjs": `import { rate, fee } from "./tax.cjs";
export const read = () => rate + ", " + fee();`,
    "a.test.mjs": `${head}${lay}
test("a", async () => {
  const { read } = await import("./reader.mjs");
  const actual = await vi.importActual("./tax.cjs");
  console.log("SAID", read(), actual.rate, actual.fee());
  vi.doUnmock("./tax.cjs");
  console.log("SAID", (await import("./tax.cjs")).fee());
});`,
  });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
  const all = stdout + "\n" + stderr;
  expect(all.split("\n").filter(line => line.startsWith("SAID "))).toEqual([
    "SAID tax runs tax.cjs?actual 5 true true",
    "SAID mock rate, real rate 1 real rate real rate 2",
    "SAID tax runs tax.cjs 5 true true",
    "SAID real rate 1",
  ]);
  expect(all).toContain(" 1 pass");
  expect(all).not.toContain("ran from source");
  expect(all).not.toContain("more often");
});

test("a file whose mock only names importOriginal is noted", async () => {
  using directory = tempDir("originals-run-compiled", {
    ...files,
    "a.test.ts": `${head}import { rate } from "./tax";
vi.mock("./tax", () => {
  const importOriginal = { rate: "mock rate" };
  return { rate: importOriginal.rate };
});
test("a", () => console.log("SAID", rate));`,
  });
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "" }); // prettier-ignore
  expect(stdout + "\n" + stderr).toContain(
    "1 mocked file may have run more often, or shown other values, during this run than under `bun test`:\n  tax.ts: ",
  );
});
