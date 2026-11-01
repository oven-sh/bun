// mock.module() over an ES module that has run replaces what its names stand for. It adds no name: whoever imports one that only the factory gave is refused at the
// link, `SyntaxError: Export named 'own' not found in module ..`. A compiled run loaded the importer, which read undefined. A mock that comes ahead of the load
// stands in place of the module, and there the name is an export.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const said = `const said = async run => {
  try {
    return String(await run());
  } catch (error) {
    return error.name + ": " + String(error.message).replace(/ in module .*/s, "");
  }
};`;
const mocked = `({ own: "mock own", real: "mock real" })`;
const project = (folder: string) => ({
  [`${folder}/dep.mjs`]: `export const real = "real", other = "other";`,
  [`${folder}/star.mjs`]: `export * from "./dep.mjs";`,
  [`${folder}/stars.mjs`]: `export * from "./star.mjs";`,
  [`${folder}/direct.mjs`]: `import { own, real } from "./dep.mjs"; export const seen = () => own + "," + real;`,
  [`${folder}/by-star.mjs`]: `import { own, real } from "./star.mjs"; export const seen = () => own + "," + real;`,
  [`${folder}/by-stars.mjs`]: `import { own, real } from "./stars.mjs"; export const seen = () => own + "," + real;`,
  [`${folder}/has-it.mjs`]: `import { real } from "./dep.mjs"; export const seen = () => real;`,
});
const asks = (folder: string) =>
  ["direct", "by-star", "by-stars", "has-it"]
    .map(
      user => `console.log("OUT ${user}", await said(async () => (await import("./${folder}/${user}.mjs")).seen()));`,
    )
    .join("\n  ");

const files = {
  "package.json": `{ "name": "mock-adds-no-name" }`,
  ...project("over"),
  "a-over.test.mjs": `import { mock, test } from "bun:test";
${said}
test("laid over a module that has run", async () => {
  await import("./over/dep.mjs");
  mock.module("./over/dep.mjs", () => ${mocked});
  ${asks("over")}
  console.log("OUT require()", await said(async () => require("./over/direct.mjs").seen()));
});`,
  ...project("ahead"),
  "b-ahead.test.mjs": `import { mock, test } from "bun:test";
${said}
test("ahead of the load", async () => {
  mock.module("./ahead/dep.mjs", () => ${mocked});
  ${asks("ahead")}
});`,
  ...project("earlier"),
  "c-earlier.test.mjs": `import { test } from "bun:test";
test("an earlier file loads it", async () => {
  await import("./earlier/stars.mjs");
});`,
  "d-later.test.mjs": `import { jest, test } from "bun:test";
${said}
test("a later file mocks it", async () => {
  jest.doMock("./earlier/dep.mjs", () => ${mocked});
  ${asks("earlier")}
});`,
};

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test("the link refuses it, as one program and over layers", async () => {
  using folder = tempDir("aot-mock-adds-no-name", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  const refused = "SyntaxError: Export named 'own' not found";
  expect(plain).toEqual({
    lines: [
      `OUT direct ${refused}`,
      `OUT by-star ${refused}`,
      `OUT by-stars ${refused}`,
      "OUT has-it mock real",
      `OUT require() ${refused}`,
      "OUT direct mock own,mock real",
      "OUT by-star mock own,mock real",
      "OUT by-stars mock own,mock real",
      "OUT has-it mock real",
      `OUT direct ${refused}`,
      `OUT by-star ${refused}`,
      `OUT by-stars ${refused}`,
      "OUT has-it mock real",
    ],
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2")).toEqual(plain);
}, 240_000);
