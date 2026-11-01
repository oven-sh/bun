// mock.module("./lib.js", async () => made) before anything has loaded lib.js. The factory's promise settles behind the call, and the importer's load
// waits for it. In `bun test` the mock then stands in place of the module as with a factory that answers at once: a getter of the factory's object is
// read at each use, a store on the object is seen, the keys are the object's in its order, a name that it leaves out is undefined.
// A compiled run took the values once, when the promise settled: the getter was read once, the store was lost, the keys were sorted.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const user = (lib: string) => `
import whole, { v, f, missing } from "${lib}";
import * as all from "${lib}";
export const read = () => [v, f(), String(missing), typeof whole, Object.keys(all).join()].join(" ");
`;

const files = {
  "package.json": `{ "name": "mock-async-factory", "type": "module" }`,
  "lib-a.js": `export let v = "real"; export const f = () => "real f"; export default "real default";`,
  "lib-b.js": `export let v = "real"; export const f = () => "real f"; export default "real default";`,
  "lib-c.cjs": `exports.v = "real"; exports.f = () => "real f";`,
  "user-a.js": user("./lib-a.js"),
  "user-b.js": user("./lib-b.js"),
  "user-c.js": user("./lib-c.cjs"),
  "later.test.js": `
import { mock, test } from "bun:test";
const act = async (kind, lay, load) => {
  let reads = 0;
  const made = { get v() { return "mock " + ++reads; }, f: () => "mock f", extra: 1 };
  try {
    await lay(made);
    const user = await load();
    console.log("OUT", kind, "behind the mock |", user.read());
    made.f = () => "stored f";
    made.later = 2;
    console.log("OUT", kind, "behind a store |", user.read());
  } catch (error) {
    console.log("OUT", kind, "THROWS |", error.constructor.name, error.message.replace(/'\\/[^']*\\//g, "'"));
  }
};
const later = made => async () => { await 1; return made; };
test("awaited", () => act("awaited", made => mock.module("./lib-a.js", later(made)), () => import("./user-a.js")));
test("not awaited", () => act("not awaited", made => { mock.module("./lib-b.js", later(made)); }, () => import("./user-b.js")));
test("a CommonJS file", () => act("a CommonJS file", made => mock.module("./lib-c.cjs", later(made)), () => import("./user-c.js")));
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

test("every line is as in plain bun test, as one program and over layers", async () => {
  using folder = tempDir("aot-mock-async-factory", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain).toEqual({
    lines: ["awaited", "not awaited", "a CommonJS file"].flatMap(kind => [
      `OUT ${kind} behind the mock | mock 1 mock f undefined undefined v,f,extra`,
      `OUT ${kind} behind a store | mock 2 stored f undefined undefined v,f,extra,later`,
    ]),
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
