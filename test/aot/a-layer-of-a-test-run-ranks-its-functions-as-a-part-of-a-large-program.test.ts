import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

// A run that is too large for one program is cut into layers, and each layer is built by itself. Who calls its functions, and how often, is in the programs above it, so how they
// rank among themselves says nothing: ranked that way, a million operations of every layer counted as warm, which an executable of the whole run compiles as cold code.
// A layer ranks them as a very large program does, and as the programs of the test files do: what has many callers is hot, the rest is cold.
// The layers are built as `bun test --aot` builds them, one after the other, and the compiler's map says how hot it takes each function to be.
const files = {
  "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
  "node_modules/pkg/index.js": `
    exports.ofPackage = function ofPackage(list) { let sum = 0; for (const item of list) sum += item.size; return sum; };`,
  "work.ts": `
    import { ofPackage } from "pkg";
    export function ofProject(words: string[]) { return ofPackage(words.map(word => ({ size: word.length }))); }`,
  "a.test.ts": `
    import { expect, test } from "bun:test";
    import { ofProject } from "./work.ts";
    test("a", () => { expect(ofProject(["a", "bc"])).toBe(3); });`,
};
const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" };

test("no function of a layer is warm for its rank among the functions of the layer", async () => {
  using dir = tempDir("aot-a-layer-ranks-its-functions-as-a-part", files);
  const at = (name: string) => join(String(dir), name);
  const build = async (graph: string, part: string, below: number[]) => {
    writeFileSync(at(graph), at("a.test.ts") + "\0");
    const descriptor = openSync(at(graph), "r+");
    try {
      await using builder = Bun.spawn({
        cmd: [bunExe(), "test", "--aot", "--isolate", `--aot-build-test-part=${part}`],
        cwd: String(dir),
        env: { ...env, BUN_JSC_aotMapFilePath: at(graph + ".map") },
        stdio: ["ignore", "pipe", "pipe", descriptor, ...below],
      });
      const [stderr, exitCode] = await Promise.all([builder.stderr.text(), builder.exited]);
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    } finally {
      closeSync(descriptor);
    }
  };
  await build("packages", "3,shared,packages", []);
  // As the run hands it over: the build above lays the headers of its texts into the lowest program.
  const packages = openSync(at("packages"), "r+");
  try {
    await build("shared", "3,shared,below:4", [packages]);
  } finally {
    closeSync(packages);
  }
  const heatOf = (map: string, name: string) =>
    readFileSync(at(map), "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(row => row[0] === "F" && row[7] === name)
      .map(row => row[12]);
  const found = { ofPackage: heatOf("packages.map", "ofPackage"), ofProject: heatOf("shared.map", "ofProject") };
  expect(found.ofPackage.length).toBeGreaterThan(0);
  expect(found.ofProject.length).toBeGreaterThan(0);
  expect([...new Set([...found.ofPackage, ...found.ofProject])]).toEqual(["c"]);
}, 120_000);

// A whole run over layers, which has never been the witness of a fault: the benches run it.
if (runsWholeGrids)
  test("the run passes", async () => {
    using dir = tempDir("aot-a-layer-ranks-its-functions-as-a-part-run", files);
    await using run = Bun.spawn({
      cmd: [bunExe(), "test", "--aot", "--isolate"],
      cwd: String(dir),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  }, 120_000);
