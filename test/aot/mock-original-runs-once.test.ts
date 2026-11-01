import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A factory that takes the original of a package which the test file imports: the body of the package runs once, ahead of the test file's.
const says = (file: string) => `console.log("RUNS ${file}");`;
const takesOriginal = (name: string) =>
  `vi.mock("${name}", async importOriginal => ({ ...(await importOriginal()), hello: () => "mocked hello" }));`;

test("a package's body runs once beside a mock that takes the original: as plain Bun, as one program and in two layers", async () => {
  using dir = tempDir("aot-mock-original-runs-once", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "node_modules/cjs-pkg/package.json": `{ "name": "cjs-pkg", "main": "./index.js" }`,
    "node_modules/cjs-pkg/index.js": `${says("cjs-pkg")}
exports.name = "cjs-pkg";
exports.hello = function hello() { return "real hello"; };`,
    "node_modules/esm-pkg/package.json": `{ "name": "esm-pkg", "type": "module", "main": "./index.js" }`,
    "node_modules/esm-pkg/index.js": `${says("esm-pkg")}
export const name = "esm-pkg";
export function hello() { return "real hello"; }`,
    "original.test.ts": `${says("the test file")}
import { test, vi } from "bun:test";
import * as cjs from "cjs-pkg";
import * as esm from "esm-pkg";
${takesOriginal("esm-pkg")}
${takesOriginal("cjs-pkg")}
test("t", async () => {
  console.log("SAID", esm.name, esm.hello(), cjs.name, cjs.hello());
  console.log("SAID", (await vi.importActual("esm-pkg")).hello(), (await vi.importActual("cjs-pkg")).hello());
});`,
  });
  const seen = async (flags: string[], words: string) => {
    const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
    return (stdout + "\n" + stderr).split("\n").filter(line => /^(RUNS|SAID)|rror:/.test(line));
  };
  const plain = await seen([], "");
  expect(plain).toEqual([
    "RUNS cjs-pkg",
    "RUNS esm-pkg",
    "RUNS the test file",
    "SAID esm-pkg mocked hello cjs-pkg mocked hello",
    "SAID real hello real hello",
  ]);
  expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await seen(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 600000);
