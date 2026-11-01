// barrel.js says `export { name } from "./lib.cjs"`, and a mock stands in place of lib.cjs. Whoever imports `name` from the barrel gets the mock's, as whoever imports it
// from lib.cjs itself does. A compiled run read `undefined` and said nothing: built as one program, in the test file and behind import(); over layers, in a file between.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-cjs-handed-on", "type": "module" }`,
  "has.cjs": `exports.name = "real";`,
  "whole.cjs": `module.exports = { name: "real" };`,
  "lacks.cjs": `module.exports = {};`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
  "node_modules/pkg/index.js": `exports.name = "real";`,
  "from-has.js": `export { name } from "./has.cjs";`,
  "from-whole.js": `export { name as renamed } from "./whole.cjs";`,
  "from-lacks.js": `export { name } from "./lacks.cjs";`,
  "from-pkg.js": `export { name } from "pkg";`,
  "in-two.js": `import { name } from "./has.cjs"; export { name };`,
  "twice.js": `export { name } from "./from-has.js";`,
  "inside.js": `import { name } from "./has.cjs"; export const read = () => name;`,
  "between.js": `import { name } from "./from-has.js"; export const readBetween = () => name;`,
  "loads.js": `export const load = async () => (await import("./from-has.js")).name;`,
  "star.js": `export * from "./has.cjs";`,
  "handed-on.test.js": `
import { test, vi } from "bun:test";
import { name as bound } from "./from-has.js";
import { renamed } from "./from-whole.js";
import { name as lacking } from "./from-lacks.js";
import { name as ofPackage } from "./from-pkg.js";
import { name as inTwo } from "./in-two.js";
import { name as twice } from "./twice.js";
import * as all from "./from-has.js";
import { read } from "./inside.js";
import { readBetween } from "./between.js";
import { load } from "./loads.js";
import { name as direct } from "./has.cjs";
vi.mock("./has.cjs", () => ({ name: "mock of has" }));
vi.mock("./whole.cjs", () => ({ name: "mock of whole" }));
vi.mock("./lacks.cjs", () => ({ name: "mock of lacks" }));
vi.mock("pkg", () => ({ name: "mock of pkg" }));
test("names", async () => {
  console.log("OUT bound |", [bound, renamed, lacking, ofPackage, inTwo, twice].join(" ; "));
  console.log("OUT namespace |", [all.name, Object.keys(all).join(), "name" in all].join(" ; "));
  const loaded = await import("./from-has.js");
  console.log("OUT import() |", [loaded.name, (await import("./star.js")).name, require("./from-has.js").name].join(" ; "));
  console.log("OUT in another file |", [readBetween(), await load()].join(" ; "));
  console.log("OUT beside it |", [read(), direct].join(" ; "));
});
`,
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

test("comes from the mock, as one program and over layers", async () => {
  using folder = tempDir("aot-mock-cjs-handed-on", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain).toEqual({
    lines: [
      `OUT bound | mock of has ; mock of whole ; mock of lacks ; mock of pkg ; mock of has ; mock of has`,
      `OUT namespace | mock of has ; name ; true`,
      `OUT import() | mock of has ; mock of has ; mock of has`,
      `OUT in another file | mock of has ; mock of has`,
      `OUT beside it | mock of has ; mock of has`,
    ],
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
