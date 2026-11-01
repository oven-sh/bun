import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A mock kept the body of a package from running, and ends with its test file. The next test file shares what the first one loaded, so nothing imports the package
// anew: the run time runs it when a graph comes by that holds an importer of it that has run. A file that only hands names on has nothing to run.
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "main": "index.js" }`,
  "node_modules/pkg/index.js": `export const x = "real x"; export const y = "real y";`,
  "src/inner-names.js": `export { x } from "pkg";`,
  "src/names.js": `export { x } from "./inner-names.js";`,
  "src/innermost-star.js": `export * from "pkg";`,
  "src/inner-star.js": `export * from "./innermost-star.js";`,
  "src/star.js": `export * from "./inner-star.js";`,
  "src/uses.js": `import * as names from "./names.js";
import * as star from "./star.js";
import { x } from "./names.js";
import { y } from "./star.js";
export const seen = () => [names.x, star.x, star.y, x, y, Object.keys(star).join("+")].join();`,
  "b.test.js": `import { test } from "bun:test";
import { seen } from "./src/uses.js";
test("b", () => console.log("SEEN b " + seen()));`,
};
const factory = `() => ({ x: "mock x", y: "mock y" })`;
const mocks = {
  "a hoisted vi.mock()": `import { test, vi } from "bun:test";
import { seen } from "./src/uses.js";
vi.mock("pkg", ${factory});
test("a", () => console.log("SEEN a " + seen()));`,
  "mock.module() before the load": `import { test, mock } from "bun:test";
mock.module("pkg", ${factory});
const { seen } = await import("./src/uses.js");
test("a", () => console.log("SEEN a " + seen()));`,
};

async function seen(dir: string, ...flags: string[]) {
  const { stdout, stderr } = await run([bunExe(), "test", ...flags], dir, bunEnv);
  return (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN") || /^\w*Error:/.test(line));
}

test.each(Object.keys(mocks))(
  "the next test file reads a package through files that only hand its names on, behind %s",
  async mock => {
    using dir = tempDir("aot-mock-two-barrels", { ...files, "a.test.js": mocks[mock as keyof typeof mocks] });
    const plain = await seen(String(dir));
    expect(plain).toEqual([
      "SEEN a mock x,mock x,mock y,mock x,mock y,x+y",
      "SEEN b real x,real x,real y,real x,real y,x+y",
    ]);
    expect(await seen(String(dir), "--aot")).toEqual(plain);
  },
  240_000,
);
