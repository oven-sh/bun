import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `import * as pkg from "a-commonjs-package"; pkg.member` where the package lies in another image than the reader: a shared layer holds node_modules, another one src, and each test file is a piece.
// The names of such a namespace object are those the file had exported when it had run, and their values lie in a table of the object. Every read went through the object's own lookup.
const files: Record<string, string> = {
  "tsconfig.json": "{}",
  "node_modules/cjs-pkg/package.json": `{"name":"cjs-pkg","main":"index.js"}`,
  "node_modules/cjs-pkg/index.js": `"use strict";
exports.one = 1;
exports.add = function add(a, b) { return a + b; };
exports.table = { x: 3 };
for (const name of ["p", "q", "r"]) exports[name + "Made"] = name;
Object.defineProperty(exports, "got", { enumerable: true, get() { return exports.one + 41; } });
`,
  "src/helper.ts": `import * as pkg from "cjs-pkg";
export function sumThroughHelper(n: number) { let s = 0; for (let i = 0; i < n; i++) s += pkg.one; return s; }
export function namesSeenByHelper() { return Object.keys(pkg).join(); }
`,
  "a.test.ts": `import { test, expect, spyOn } from "bun:test";
import * as pkg from "cjs-pkg";
import * as os from "node:os";
import * as path from "node:path";
import * as util from "node:util";
import { sumThroughHelper, namesSeenByHelper } from "./src/helper";
const read = () => { let s = 0; for (let i = 0; i < 100; i++) s += pkg.add(i, pkg.one); return s; };
test("answers", () => {
  console.log("SAID answers", JSON.stringify([pkg.one, pkg.add(2, 3), pkg.table.x, pkg.pMade, pkg.qMade, pkg.rMade, pkg.got, (pkg as any).absent, "one" in pkg, "absent" in pkg, Object.keys(pkg).join(), namesSeenByHelper(), read()]));
});
test("an export is an own property, also once its reads are cached", () => {
  const key = (k: string) => [k][0];
  let sum = 0, own = 0, within = 0, absent = 0;
  for (let i = 0; i < 100; i++) {
    sum += pkg.one + (pkg as any)[key("one")];
    if (Object.hasOwn(pkg, key("one"))) own++;
    if (key("one") in pkg) within++;
    if (Object.hasOwn(pkg, key("absent")) || key("absent") in pkg) absent++;
  }
  console.log("SAID own", JSON.stringify([sum, own, within, absent, Object.hasOwn(pkg, "add"), Object.prototype.hasOwnProperty.call(pkg, "one"), JSON.stringify(Object.getOwnPropertyDescriptor(pkg, "one")), Object.prototype.propertyIsEnumerable.call(pkg, "one")]));
});
test("what the file exports later", () => {
  const said: unknown[] = [read()];
  const real = require("cjs-pkg");
  real.one = 5; real.later = 9;
  said.push(pkg.one, (pkg as any).later, sumThroughHelper(3), real.one, pkg.got, read());
  real.one = 1;
  const loose: any = pkg;
  try { loose.one = 2; said.push("stored"); } catch (error) { said.push((error as Error).constructor.name); }
  try { delete loose.one; said.push("deleted"); } catch (error) { said.push((error as Error).constructor.name); }
  said.push(pkg.one, read());
  console.log("SAID later", JSON.stringify(said));
});
test("modules of the library, some of whose exports the host makes when they are first asked for", () => {
  const ask = () => { let s = ""; for (let i = 0; i < 50; i++) s = util.inspect({ a: i }) + os.EOL.length + path.join("a", "b") + path.sep; return s; };
  const said: unknown[] = [ask(), typeof util.inspect, Object.hasOwn(util, "inspect"), "EOL" in os, Object.hasOwn(os, "EOL"), typeof (util as any).absent];
  const spy = spyOn(util, "inspect").mockImplementation(() => "spied");
  said.push(ask(), spy.mock.calls.length);
  spy.mockRestore();
  said.push(ask());
  console.log("SAID library", JSON.stringify(said));
});
test("a spy", () => {
  const said: unknown[] = [read()];
  const spy = spyOn(pkg, "add").mockImplementation((a: number, b: number) => a * b);
  said.push(read(), pkg.add(6, 7), spy.mock.calls.length);
  spy.mockRestore();
  said.push(read(), pkg.add(6, 7));
  // A replacement while the object carries a property that a native function defined, which is deleted afterwards.
  const loose: any = pkg;
  Error.captureStackTrace(loose);
  said.push(read());
  const again = spyOn(pkg, "add").mockImplementation((a: number, b: number) => a - b);
  said.push(read());
  try { said.push(delete loose.stack); } catch (error) { said.push((error as Error).constructor.name); }
  said.push(read(), Object.hasOwn(pkg, "add"));
  again.mockRestore();
  said.push(read(), Reflect.ownKeys(pkg).map(String).join());
  console.log("SAID spy", JSON.stringify(said));
});
`,
  // The last file of the run: the counts that the run leaves are its own.
  "z.test.ts": `import { test, expect } from "bun:test";
import * as pkg from "cjs-pkg";
import { sumThroughHelper } from "./src/helper";
test("many reads", () => {
  let sum = sumThroughHelper(1000);
  for (let i = 0; i < 1000; i++) sum += pkg.one + (typeof pkg.add === "function" ? 1 : 0);
  expect(sum).toBe(3000);
});
`,
  "y.test.ts": `import { test, expect } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as util from "node:util";
test("many reads of the library", () => {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += os.EOL.length + path.sep.length + (typeof util.inspect === "function" ? 1 : 0) + (typeof path.join === "function" ? 1 : 0);
  expect(sum).toBe(4000);
});
`,
};
// The layers are used from seventeen test files on.
for (let i = 0; i < 16; i++)
  files[`m${i}.test.ts`] = `import { test, expect } from "bun:test";
import * as pkg from "cjs-pkg";
test("m${i}", () => { expect(pkg.one + ${i}).toBe(${i + 1}); });
`;

test("it says what plain Bun says as one image and in layers, and the reads across a border are cached", async () => {
  using dir = tempDir("aot-commonjs-namespace-in-layers", files);
  const directory = String(dir);
  const counts = join(directory, "counts.txt");
  const said = async (flags: string[], words: string, files = ["."], counted = false) => {
    const env = {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
      BUN_TMPDIR: directory,
      BUN_JSC_aotCountsPath: counted ? counts : undefined,
    };
    const ran = await run([bunExe(), "test", ...flags, "--isolate", "--parallel=1", ...files], directory, env);
    return {
      lines: ran.stdout.split("\n").filter(line => line.startsWith("SAID")),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const plain = await said([], "");
  expect(plain.summary).toEqual([" 23 pass", " 0 fail"]);
  expect(plain.lines.length).toBe(5);
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:1,TestRunPartFiles:1")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);

  // The counts that a run leaves are those of its last file.
  const readsWithoutCaches = (names: RegExp) =>
    readFileSync(counts, "utf8")
      .split("\n")
      .filter(line => line.includes("miss by site:read without caches:") && names.test(line))
      .reduce((sum, line) => sum + parseInt(line), 0);
  // TODO: with the counts on, a worker of a layered run that loads node:util aborts. So the library is counted as one program, where `util.inspect` went uncached as well.
  const withoutLibrary = Object.keys(files)
    .filter(file => /^(m\d+|z)\.test\.ts$/.test(file))
    .map(file => "./" + file);
  expect((await said(["--aot"], "TestRunLayers:2,TestRunPartFiles:1", withoutLibrary, true)).summary).toEqual([
    " 17 pass",
    " 0 fail",
  ]);
  expect(readsWithoutCaches(/:(one|add):Module$/)).toBeLessThan(20);
  expect((await said(["--aot"], "TestRunLayers:0", ["./y.test.ts"], true)).summary).toEqual([" 1 pass", " 0 fail"]);
  expect(readsWithoutCaches(/:inspect:Module$/)).toBeLessThan(20);
}, 240_000);
