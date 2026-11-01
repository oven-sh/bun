// mock.module("./a.js", () => ns), where ns is the namespace object of ./a.js, which is mocked already. `bun test` takes what ns reads from now, the object of the
// earlier factory, so ns does not read from itself. Of an object that inherits from ns nothing can be taken: every question goes round, and ends in a RangeError.
// In a compiled run the namespace object asked the mock, the mock asked the namespace object, and the run ended by SIGSEGV.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "mock-own-namespace", "type": "module" }`,
  "a.js": `export const a = "real-a";`,
  "b.js": `export const b = "real-b";`,
  "c.js": `export const c = "real-c";`,
  "d.js": `export const d = "real-d";`,
  "own.test.js": `
import { mock, test } from "bun:test";
const ask = read => { try { return JSON.stringify(read()); } catch (error) { return "THROWS " + error.constructor.name; } };
test("the namespace object of the module itself", async () => {
  mock.module("./a.js", () => ({ a: "first" }));
  const ns = await import("./a.js");
  mock.module("./a.js", () => ns);
  console.log("OUT itself |", [ask(() => ns.a), ask(() => "a" in ns), ask(() => Object.keys(ns)), ask(() => delete ns.missing), ask(() => require("./a.js") === ns)].join(" ; "));
  await mock.module("./a.js", async () => ns);
  console.log("OUT itself, from an async factory |", ask(() => ({ ...ns })));
});
test("two modules, each the other's", async () => {
  mock.module("./b.js", () => ({ b: "first-b" }));
  mock.module("./c.js", () => ({ c: "first-c" }));
  const [b, c] = [await import("./b.js"), await import("./c.js")];
  mock.module("./b.js", () => c);
  mock.module("./c.js", () => b);
  console.log("OUT each other's |", ask(() => [{ ...b }, { ...c }]));
});
test("an object that inherits from it", async () => {
  mock.module("./d.js", () => ({ d: "first" }));
  const ns = await import("./d.js");
  mock.module("./d.js", () => Object.create(ns));
  console.log("OUT an heir |", [
    ask(() => ns.d), ask(() => "d" in ns), ask(() => { ns.d = 1; }), ask(() => Reflect.set(ns, "d", 1)), ask(() => Object.assign(ns, { d: 1 })),
    ask(() => delete ns.d), ask(() => Object.keys(ns)),
  ].join(" ; "));
  Object.defineProperty(ns, "d", { value: 2, writable: true, enumerable: true, configurable: true });
  console.log("OUT an heir, with a property of its own |", ask(() => ns.d));
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

test("is what plain bun test makes of it, as one program and over layers", async () => {
  using folder = tempDir("aot-mock-own-namespace", files);
  const dir = String(folder);
  const plain = await run(dir, []);
  const round = "THROWS RangeError";
  expect(plain).toEqual({
    lines: [
      `OUT itself | "first" ; true ; ["a"] ; true ; true`,
      `OUT itself, from an async factory | {"a":"first"}`,
      `OUT each other's | [{"c":"first-c"},{"c":"first-c"}]`,
      `OUT an heir | ${round} ; ${round} ; ${round} ; ${round} ; ${round} ; true ; []`,
      `OUT an heir, with a property of its own | 2`,
    ],
    exitCode: 0,
  });
  expect(await run(dir, ["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await run(dir, ["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 240_000);
