import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const orders = {
  "that came after the file had run": `vi.doMock("./lib.cjs", () => ({ read: () => "mock" }));
  vi.resetModules();
  console.log("SAID", require("./lib.cjs").read());
  add();
  vi.doMock("./lib.cjs", () => ({ read: () => "mock" }));`,
  "that came after the file had run, behind a reset": `console.log("SAID", (await import("./lib.cjs")).read());
  add();
  vi.resetModules();
  vi.doMock("./lib.cjs", () => ({ read: () => "mock" }));`,
  "that came before the file had run": `console.log("SAID file");
  add();
  vi.doMock("./lib.cjs", () => ({ read: () => "mock" }));`,
};

test.each(Object.entries(orders))("the original of a mocked file goes through a load plugin %s", async (_, steps) => {
  using directory = tempDir("originals-ask-load-plugins", {
    "package.json": `{ "name": "p" }`,
    "dep.cjs": `exports.value = "dep";`,
    "lib.cjs": `require("./dep.cjs");\nexports.read = () => "file";`,
    "a.test.mjs": `import { test, vi } from "bun:test";
import { plugin } from "bun";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const add = () => plugin({ name: "p", setup: build => void build.onLoad({ filter: /lib\\.cjs/ }, () => ({ loader: "js", contents: 'exports.read = () => "by the plugin";' })) });
test("a", async () => {
  ${steps}
  const actual = await vi.importActual("./lib.cjs");
  console.log("SAID", (actual.default ?? actual).read());
});`,
  });
  const plain = await run([bunExe(), "test"], String(directory), bunEnv);
  const { stdout, stderr } = await run([bunExe(), "test", "--aot"], String(directory), bunEnv);
  const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID "));
  expect(said(stdout)).toEqual(said(plain.stdout));
  expect(said(stdout).at(-1)).toBe("SAID by the plugin");
  expect(stdout + stderr).toContain(" 1 pass");
});
