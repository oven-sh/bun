import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// `export { add as cjsAdd } from "cjs-pkg"` in src, and `spyOn(barrel, "cjsAdd")` in a test file. Where the run is built in layers the package lies in a lower image than the
// barrel, and the spy's store goes on there. ES modules see a CommonJS file through what was captured of it when it had run, and the store has to reach that.
// The barrel exports the variable that the name of the package is kept in. The name stands in the namespace object of the package too, which is what \`pkg[key]\`, a spread
// and a descriptor read.
const commonjs = `"use strict";\nexports.add = function add(a, b) { return a + b; };\n`;
const testFile = `import { spyOn, test } from "bun:test";
import * as looked from "looked-at";
import * as other from "not-looked-at";
import * as barrel from "./src/barrel";
import { names } from "looks";
import * as path from "node:path";
// What is read off the namespace object when the code runs.
const off = (pkg: any, name: string, ...given: unknown[]) => [pkg[[name][0]](...given), ({ ...pkg })[name](...given), Object.getOwnPropertyDescriptor(pkg, name)!.value(...given), (Object.entries(pkg).find(entry => entry[0] === name)![1] as any)(...given)];
test("spies", () => {
  {
    const spy = spyOn(barrel, "lookedAdd").mockImplementation(() => 105);
    try { console.log("SAID lookedAdd", JSON.stringify([barrel.lookedAdd(1, 2), looked.add(1, 2), ...off(looked, "add", 1, 2), ...off(barrel, "lookedAdd", 1, 2), spy.mock.calls.length])); } finally { spy.mockRestore(); }
    console.log("SAID behind lookedAdd", JSON.stringify([barrel.lookedAdd(1, 2), looked.add(1, 2), ...off(looked, "add", 1, 2)]));
  }
  {
    const spy = spyOn(barrel, "otherAdd").mockImplementation(() => 105);
    try { console.log("SAID otherAdd", JSON.stringify([barrel.otherAdd(1, 2), other.add(1, 2), ...off(other, "add", 1, 2), ...off(barrel, "otherAdd", 1, 2), spy.mock.calls.length])); } finally { spy.mockRestore(); }
    console.log("SAID behind otherAdd", JSON.stringify([barrel.otherAdd(1, 2), other.add(1, 2), ...off(other, "add", 1, 2)]));
  }
  {
    const spy = spyOn(barrel, "pathJoin").mockImplementation(() => "spied");
    try { console.log("SAID pathJoin", JSON.stringify([barrel.pathJoin("a", "b"), path.join("a", "b"), ...off(path, "join", "a", "b"), spy.mock.calls.length])); } finally { spy.mockRestore(); }
    console.log("SAID behind pathJoin", JSON.stringify([barrel.pathJoin("a", "b"), path.join("a", "b"), ...off(path, "join", "a", "b")]));
  }
  console.log("SAID names", names());
});
`;
const files: Record<string, string> = {
  "tsconfig.json": "{}",
  "node_modules/looked-at/package.json": `{"name":"looked-at","main":"index.js"}`,
  "node_modules/looked-at/index.js": commonjs,
  "node_modules/not-looked-at/package.json": `{"name":"not-looked-at","main":"index.js"}`,
  "node_modules/not-looked-at/index.js": commonjs,
  // An ES module of the same layer hands the namespace object on.
  "node_modules/looks/package.json": `{"name":"looks","type":"module","main":"index.js"}`,
  "node_modules/looks/index.js": `import * as whole from "looked-at";\nexport const names = () => Object.keys(whole).join();\nexport const handedOn = whole;\n`,
  "src/barrel.ts": `export { add as lookedAdd } from "looked-at";\nexport { add as otherAdd } from "not-looked-at";\nexport { join as pathJoin } from "node:path";\n`,
  "a.test.ts": testFile,
  "b.test.ts": testFile,
};

test("it says what plain Bun says, as one program and in two layers", async () => {
  using dir = tempDir("aot-spy-on-barrel-of-commonjs-package", files);
  const directory = String(dir);
  const said = async (flags: string[], words: string) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
    const ran = await run([bunExe(), "test", ...flags, "--isolate", "--parallel=2", "."], directory, env);
    return {
      lines: (ran.stdout + "\n" + ran.stderr)
        .split("\n")
        .filter(line => line.startsWith("SAID"))
        .sort(),
      summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
    };
  };
  const plain = await said([], "");
  expect(plain.summary).toEqual([" 2 pass", " 0 fail"]);
  expect(plain.lines).toContain("SAID lookedAdd [105,105,105,105,105,105,105,105,105,105,10]");
  expect(plain.lines).toContain("SAID otherAdd [105,105,105,105,105,105,105,105,105,105,10]");
  expect(await said(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  expect(await said(["--aot"], "TestRunLayers:2")).toEqual(plain);
});
