// mock.module("node:os", () => made) before a file of the program has imported node:os. In `bun test` the mock stands in place of the module: a getter
// of the factory's object is read at each use, a store on the object is seen, the keys are the object's in its order, and under vi.doMock a name that
// the factory leaves out throws at the read. Compiled as one program, the importer's names were variables that the loader filled once at the link.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const user = (module: string) => `
import whole, { platform, sep, hostname } from "${module}";
import * as all from "${module}";
const ask = read => { try { return String(read()); } catch (error) { return "THROWS " + error.constructor.name + " " + String(error.message).split(" on the mock")[0]; } };
export const read = () => [ask(() => platform), ask(() => typeof hostname), ask(() => sep), ask(() => typeof whole), ask(() => whole === all.default), ask(() => all.platform), ask(() => Object.keys(all).join())].join(" ; ");
`;

const files = {
  "package.json": `{ "name": "mock-builtin-live", "type": "module" }`,
  "src/user-os.js": user("node:os"),
  "src/user-path.js": user("node:path"),
  "src/loaded-first.js": `import { format } from "node:util"; export const read = () => format("%s", "real");`,
  "live.test.js": `
import { mock, test, vi } from "bun:test";
const act = async (label, lay, load) => {
  let reads = 0;
  const made = { get platform() { return "mock " + ++reads; }, extra: 1 };
  try {
    await lay(made);
    const user = await load();
    console.log("OUT", label, "behind the mock |", user.read());
    made.sep = "stored";
    console.log("OUT", label, "behind a store |", user.read());
  } catch (error) {
    console.log("OUT", label, "| THE LOAD THROWS", error.constructor.name, String(error.message).slice(0, 80));
  }
};
test("mock.module", () => act("mock.module", made => mock.module("node:os", () => made), () => import("./src/user-os.js")));
test("vi.doMock", () => act("vi.doMock", made => vi.doMock("node:path", () => made), () => import("./src/user-path.js")));
test("a module that the program had loaded", async () => {
  const user = await import("./src/loaded-first.js");
  console.log("OUT loaded first |", user.read());
  mock.module("node:util", () => ({ format: () => "mocked" }));
  console.log("OUT loaded first, behind the mock |", user.read());
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

test("every line is as in plain bun test, as one program and over layers", async () => {
  using folder = tempDir("aot-mock-builtin-live", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  expect(plain.exitCode).toBe(0);
  expect(plain.lines).toContain(
    "OUT mock.module behind the mock | mock 1 ; undefined ; undefined ; undefined ; true ; mock 2 ; platform,extra",
  );
  expect(plain.lines).toContain(
    "OUT mock.module behind a store | mock 3 ; undefined ; stored ; undefined ; true ; mock 4 ; platform,extra,sep",
  );
  expect(plain.lines.length).toBe(6);
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
