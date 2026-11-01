import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Two stars of a barrel bring one name, so the barrel lacks it. While a mock stands for one of the two modules the other one gives the name.
// The next test file of the realm mocks nothing: the name is ambiguous again.
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "type": "module" }`,
  "node_modules/pkg/index.js": `export const x = "real x"; export const f = "real f";`,
  "src/clash.js": `export const x = "clash x"; export const other = "other";`,
  "src/barrel.js": `export * from "./clash.js";\nexport * from "pkg";`,
  "src/above.js": `export * from "./barrel.js";`,
  "src/user.js": `
    import * as barrel from "./barrel.js";
    import * as above from "./above.js";
    const say = b => "x=" + b.x + " f=" + b.f + " keys=" + Object.keys(b).join("+") + " has=" + ("x" in b);
    export const seen = () => say(barrel) + " | " + say(above);`,
  "a.test.js": `
    import { test, vi } from "bun:test";
    vi.mock("pkg", () => ({ x: "mock x", f: "mock f" }));
    import { seen } from "./src/user.js";
    test("a", () => console.log("| a", seen()));`,
  "z.test.js": `
    import { test } from "bun:test";
    import { seen } from "./src/user.js";
    test("z", () => console.log("| z", seen()));`,
};

const report = async (directory: string, flags: string[], words?: string) => {
  const env = { ...bunEnv, ...(words ? { BUN_DEBUG_TEST_AOT_WORDS: words } : {}) };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags, "."], directory, env);
  return { exitCode, printed: stdout.split("\n").filter(line => line.startsWith("| ")) };
};

test("over layers", async () => {
  using directory = tempDir("barrel-name-after-mock", files);
  const plain = await report(String(directory), []);
  expect(plain.printed[1]).toBe(
    "| z x=undefined f=real f keys=f+other has=false | x=undefined f=real f keys=f+other has=false",
  );
  expect(await report(String(directory), ["--aot"], "TestRunLayers:2")).toEqual(plain);
}, 120_000);

test("a built-in module behind the star", async () => {
  using directory = tempDir("barrel-name-after-mock-built-in", {
    "package.json": files["package.json"],
    "src/clash.js": `export const basename = "clash basename"; export const other = "other";`,
    "src/barrel.js": `export * from "./clash.js";\nexport * from "node:path";`,
    "src/user.js": `
      import * as barrel from "./barrel.js";
      export const seen = () => "basename=" + typeof barrel.basename + " sep=" + barrel.sep + " has=" + ("basename" in barrel);`,
    "a.test.js": `
      import { test, vi } from "bun:test";
      vi.mock("node:path", () => ({ basename: "mock basename", sep: "mock sep" }));
      import { seen } from "./src/user.js";
      test("a", () => console.log("| a", seen()));`,
    "z.test.js": files["z.test.js"],
  });
  const plain = await report(String(directory), []);
  expect(plain.printed).toEqual([
    "| a basename=string sep=mock sep has=true",
    "| z basename=undefined sep=/ has=false",
  ]);
  expect(await report(String(directory), ["--aot"])).toEqual(plain);
  expect(await report(String(directory), ["--aot"], "TestRunLayers:2")).toEqual(plain);
}, 120_000);
