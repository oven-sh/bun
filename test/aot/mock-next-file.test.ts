// What the NEXT test file sees of a file that says `export *`, when the mock of what it stars has ended with the test file before.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const next = `import { test } from "bun:test";
import { seen } from "./user.js";
test("b", async () => console.log("OUT b", await seen()));`;
const first = (mock: string) => `import { mock, test, vi } from "bun:test";
${mock}
import { seen } from "./user.js";
test("a", async () => console.log("OUT a", await seen()));`;
const late = (mock: string) => `import { mock, test, vi } from "bun:test";
import { seen } from "./user.js";
test("a", async () => {
  console.log("OUT a", await seen());
  ${mock}
  console.log("OUT a mocked", await seen());
});`;

const ofPackage = `import * as all from "./barrel.js";
import { x } from "./barrel.js";
export const seen = async () => {
  const required = require("./barrel.js");
  return [all.x, x, (await import("./barrel.js")).x, required.x, required === all, Object.keys(required).join("+")].join();
};`;
const ofBuiltin = `import * as star from "./star.js";
const show = all => [all.x("/a/real"), typeof all.y, "side" in all, Object.keys(all).length > 5 ? "many" : Object.keys(all).join("+")].join();
export const seen = async () => [show(star), show(await import("./star.js")), show(require("./star.js"))].join(" | ");`;
const packageMock = `("pkg", () => ({ x: "mock x", y: "mock y" }));`;
const builtinMock = `("node:path", () => ({ basename: () => "mock", join: () => "mock", side: "mock side", default: {} }));`;

const commonjs = {
  "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
  "node_modules/pkg/index.js": `exports.x = "real x"; exports.y = "real y";`,
};
const module = {
  "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js", "type": "module" }`,
  "node_modules/pkg/index.js": `export const x = "real x"; export const y = "real y";`,
};
const barrel = { "barrel.js": `export * from "pkg";`, "user.js": ofPackage };
const star = {
  "star.js": `export * from "node:path";
export { basename as x, join as y } from "node:path";`,
  "user.js": ofBuiltin,
};

const projects = {
  "a CommonJS package mocked before the load": { ...commonjs, ...barrel, "a.test.js": first("vi.mock" + packageMock) },
  "an ES package mocked before the load": { ...module, ...barrel, "a.test.js": first("vi.mock" + packageMock) },
  "a CommonJS package mocked when it has run": {
    ...commonjs,
    ...barrel,
    "a.test.js": late("mock.module" + packageMock),
  },
  "a built-in module mocked before the load": { ...star, "a.test.js": first("vi.mock" + builtinMock) },
  "a built-in module mocked when it has run": { ...star, "a.test.js": late("mock.module" + builtinMock) },
};
const ways = { "as one program": "TestRunLayers:0", "over two layers": "TestRunLayers:2" };

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

const cases = Object.keys(projects).flatMap(name => Object.keys(ways).map(way => [name, way] as const));

test.concurrent.each(cases)(
  "%s, %s",
  async (name, way) => {
    using folder = tempDir("aot-mock-next-file", {
      "package.json": `{ "name": "mock-next-file", "type": "module" }`,
      "b.test.js": next,
      ...projects[name as keyof typeof projects],
    });
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.join()).toContain("mock");
    expect(plain.lines.at(-1)).not.toContain("mock");
    expect(await run(dir, ["--aot"], ways[way as keyof typeof ways])).toEqual(plain);
  },
  240_000,
);
