// A mock's factory may give a name that the real module lacks. A module that hands that name on, by `export { name } from` or by an import and an export, gets it
// from the mock, as an importer of the mocked module itself does. The build of a compiled run stopped: "internal compiler error (ReadAndVerify): InvalidModule".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { afterAll } from "./harness/default-timeout";
import { beforeAll, test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-name-exported-again", "type": "module" }`,
  "empty.js": ``,
  "braces.js": `export {};`,
  "other.js": `export const other = 1;`,
  "from-empty.js": `export { name } from "./empty.js";`,
  "from-braces.js": `export { name as renamed } from "./braces.js";`,
  "from-other.js": `import { name } from "./other.js"; export { name };`,
  "twice.js": `export { name } from "./from-empty.js";`,
  "late.js": `export const other = 1;`,
  "from-late.js": `export { name } from "./late.js";`,
  "gone.js": `export const other = 1;`,
  "from-gone.js": `export { name } from "./gone.js";`,
  "again.test.js": `
import { test, vi } from "bun:test";
import { name as bound } from "./from-empty.js";
import * as all from "./from-other.js";
vi.mock("./empty.js", () => ({ name: "mock of empty" }));
vi.mock("./braces.js", () => ({ name: "mock of braces" }));
vi.mock("./other.js", () => ({ name: "mock of other", other: 2 }));
test("names", async () => {
  console.log("OUT", [bound, all.name, Object.keys(all).join(), (await import("./from-braces.js")).renamed, (await import("./twice.js")).name, require("./from-empty.js").name].join(" ; "));
});
const load = path => import(path).then(() => "loaded", error => error.constructor.name + ": " + error.message);
test("while no mock stands the name is missing", async () => {
  console.log("OUT before the mock |", await load("./from-late.js"));
  vi.doMock("./late.js", () => ({ name: "mock of late" }));
  vi.doMock("./gone.js", () => ({ name: "mock of gone" }));
  vi.doUnmock("./gone.js");
  console.log("OUT behind the mock |", await load("./from-gone.js"));
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

let dir: ReturnType<typeof tempDir> | undefined;
let plain: Awaited<ReturnType<typeof run>>;
beforeAll(async () => {
  dir = tempDir("aot-mock-name-exported-again", files);
  plain = await run(String(dir), []);
});
afterAll(() => dir?.[Symbol.dispose]());

test("come from the mock under plain Bun", () => {
  expect(plain).toEqual({
    lines: [
      `OUT mock of empty ; mock of other ; name ; mock of braces ; mock of empty ; mock of empty`,
      `OUT before the mock | SyntaxError: export 'name' not found in './late.js'`,
      `OUT behind the mock | SyntaxError: export 'name' not found in './gone.js'`,
    ],
    exitCode: 0,
  });
});

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("come from the mock, %s", async (_, words) => {
  expect(await run(String(dir), ["--aot"], words)).toEqual(plain);
});
