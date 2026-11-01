// vi.doMock("./lib.js", () => ({ has })) before anything has loaded lib.js. As in Vitest, a read of a name that the factory leaves out throws:
// `No "left" export is defined on the mock`. The importer links and runs; the read throws each time, by a name, by the default and off `import * as`.
// A compiled run asks the mock at each of these reads. A member read off the namespace of a CommonJS package went past it and answered undefined.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const user = (lib: string) => `
import whole, { has, left } from "${lib}";
import * as all from "${lib}";
const ask = read => { try { return String(read()); } catch (error) { return "THROWS " + error.constructor.name + " " + String(error.message).split(" on the mock")[0]; } };
export const read = () => [ask(() => has), ask(() => left), ask(() => whole), ask(() => all.left), ask(() => "left" in all), ask(() => Object.keys(all).join())].join(" ; ");
`;

const files = {
  "package.json": `{ "name": "mock-vitest-missing-name", "type": "module" }`,
  "node_modules/pkg-esm/package.json": `{ "name": "pkg-esm", "type": "module", "main": "index.js" }`,
  "node_modules/pkg-esm/index.js": `export const has = "real has"; export const left = "real left"; export default "real default";`,
  "node_modules/pkg-cjs/package.json": `{ "name": "pkg-cjs", "main": "index.js" }`,
  "node_modules/pkg-cjs/index.js": `exports.has = "real has"; exports.left = "real left";`,
  "src/lib.js": `export const has = "real has"; export const left = "real left"; export default "real default";`,
  "src/user-lib.js": user("./lib.js"),
  "src/user-esm.js": user("pkg-esm"),
  "src/user-cjs.js": user("pkg-cjs"),
  "vi.test.js": `
import { test, vi } from "bun:test";
const act = async (label, lay, load) => {
  try {
    await lay();
    console.log("OUT", label, "|", (await load()).read());
  } catch (error) {
    console.log("OUT", label, "| THE LOAD THROWS", error.constructor.name);
  }
};
const factory = () => ({ has: "mock has" });
test("a name that the factory leaves out", async () => {
  await act("a file", () => vi.doMock("./src/lib.js", factory), () => import("./src/user-lib.js"));
  await act("an ES package", () => vi.doMock("pkg-esm", factory), () => import("./src/user-esm.js"));
  await act("a CommonJS package", () => vi.doMock("pkg-cjs", factory), () => import("./src/user-cjs.js"));
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

test("every read is as in plain bun test, as one program and over layers", async () => {
  using folder = tempDir("aot-mock-vitest-missing-name", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  const left = `THROWS Error No "left" export is defined`;
  expect(plain).toEqual({
    lines: ["a file", "an ES package", "a CommonJS package"].map(
      label =>
        `OUT ${label} | mock has ; ${left} ; THROWS Error No "default" export is defined ; ${left} ; false ; has`,
    ),
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:3,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
