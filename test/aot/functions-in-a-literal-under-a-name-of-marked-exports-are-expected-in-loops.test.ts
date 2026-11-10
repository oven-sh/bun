// Every CommonJS file that TypeScript or Babel writes begins with Object.defineProperty(exports, "__esModule", { value: true }). That descriptor lays a value: it makes no field
// of the exports an accessor, so what Link's held reading saw under `default` is expected in a loop and tested at the run. A getter that a descriptor lays under another written name
// (what TypeScript writes for `export { x } from`) takes only that name out; under a name that nobody knows at the build it takes them all.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { test } from "./supported";

const library = (last: string) => `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function plus(a, b) { return (a + b) | 0; }
function times(a, b) { return Math.imul(a, b); }
const tools = { plus, times };
exports.default = tools;
${last}`;
const entry = (file: string, name = "default") => `"use strict";
const lib_1 = require("./${file}.cjs");
const text = new Function(JSON.parse('"return 1"'));
function turns(n) { let s = 0; for (let i = 0; i < n; i++) s = lib_1.${name}.times(s, 3) + lib_1.${name}.plus(i, s) | 0; return s; }
console.log(turns(40), text());
`;
const files = {
  "marked.cjs": library(""),
  "with-getter.cjs": library(
    `Object.defineProperty(exports, "other", { enumerable: true, get: function () { return tools; } });\n`,
  ),
  "with-getter-under-a-name-from-outside.cjs": library(
    `Object.defineProperty(exports, JSON.parse('"other"'), { enumerable: true, get: function () { return tools; } });\n`,
  ),
  "main-marked.cjs": entry("marked"),
  "main-with-getter.cjs": entry("with-getter"),
  "main-through-the-getter.cjs": entry("with-getter", "other"),
  "main-with-getter-under-a-name-from-outside.cjs": entry("with-getter-under-a-name-from-outside"),
};

async function countGenericReads(cwd: string, name: string) {
  const [executable, wire] = [join(cwd, `${name}.exe`), join(cwd, `${name}.wire`)];
  const build = [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    `--aot-out=${wire}`,
    `main-${name}.cjs`,
    "--outfile",
    executable,
  ];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  expect((await run([executable], cwd, bunEnv)).stdout.trim()).toBe("477218575 1");
  const printed = (await runTestaot("print", wire)).lines;
  const turns = printed.map(line => /^function (f\d+) name="turns"/.exec(line)).find(found => found)![1];
  const walked = (await runTestaot("walk", wire, `${turns}:Body`)).lines;
  return walked.filter(line => / = PropGet .* key="(?:times|plus)"/.test(line)).length;
}

test.skipIf(!!without("testaot"))(
  "functions in a literal under a name of marked exports are expected in loops",
  async () => {
    using dir = tempDir("aot-marked-exports", files);
    const cwd = String(dir);
    expect(await countGenericReads(cwd, "marked")).toBe(0);
    expect(await countGenericReads(cwd, "with-getter")).toBe(0);
    expect(await countGenericReads(cwd, "through-the-getter")).toBeGreaterThan(0);
    expect(await countGenericReads(cwd, "with-getter-under-a-name-from-outside")).toBeGreaterThan(0);
  },
  600_000,
);
