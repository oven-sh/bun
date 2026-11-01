// A question by a path costs no search through the modules of the program.
//
// The image holds a table of its modules by the hash of their paths. A path that no module has ends at an empty slot, and a
// path that a module has is compared with that module alone. Before, the modules were searched in the order of their paths, at
// about 320 instructions for each module that the search compared, and the list in front of the search kept 32 paths that
// were not found: a program that asks about more of them searched at every question.
//
// So an executable asks every kind of question about eight kinds of key and about 300 paths that no module has, a hundred times
// over. The run counts the modules that were compared with a path and had another.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const modules = 200;
const numbers = Array.from({ length: modules }, (_, index) => index);

const keys = [
  { key: `require.resolve("./m7.cjs")`, isThere: false },
  { key: `__filename`, isThere: false },
  { key: `"/nowhere/at/all.cjs"`, isThere: false },
  { key: `"/virtual/written.cjs"`, isThere: true },
  { key: `"bun:jsc"`, isThere: true },
  { key: `"bun:sqlite"`, isThere: false },
  { key: `"node:fs"`, isThere: false },
  { key: `"ws"`, isThere: false },
];

const turns = 100;
const main = `let sum = 0;
${numbers.map(index => `sum += require("./m${index}.cjs");\n`).join("")}require("bun:jsc");
require.cache["/virtual/written.cjs"] = { exports: 1 };
const keys = [${keys.map(({ key }) => key).join(", ")}];
for (let index = 0; index < 300; index++) keys.push("/nowhere/at/all/" + index + ".cjs");
let found = 0;
for (let turn = 0; turn < ${turns}; turn++) {
  for (const key of keys) {
    if (require.cache[key]) found++;
    if (key in require.cache) found++;
    if (Object.getOwnPropertyDescriptor(require.cache, key)) found++;
  }
}
console.log("answers", sum, found);
`;

test("no question to require.cache compares its key with a module that has another path", async () => {
  using dir = tempDir("aot-require-cache-searches", {
    "main.cjs": main,
    ...Object.fromEntries(numbers.map(index => [`m${index}.cjs`, `module.exports = ${index};\n`])),
  });
  const cwd = String(dir);
  const path = join(cwd, isWindows ? "main.exe" : "main");
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", path], cwd, bunEnv);
  expect(built.exitCode).toBe(0);
  const { stdout, exitCode } = await run([path], cwd, {
    ...bunEnv,
    [runtimeEnvironment.countsPath]: join(cwd, "counts-%p"),
  });
  expect({ stdout, exitCode }).toEqual({
    stdout: `answers ${(modules * (modules - 1)) / 2} ${keys.filter(({ isThere }) => isThere).length * 3 * turns}\n`,
    exitCode: 0,
  });
  const compared = readdirSync(cwd)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
    .filter(line => line.endsWith("\tsought:ModulesByPath"))
    .map(line => Number(line.split("\t")[0]));
  expect(compared).toEqual([0]);
});
