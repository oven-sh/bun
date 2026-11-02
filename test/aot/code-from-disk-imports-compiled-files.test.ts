import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// The root directory of the build is src, one folder below the working directory. shared lies beside it.
const files = {
  "src/main.ts": `import path from "node:path";
import * as counter from "./counter.ts";
import { twice } from "./pairs.ts";
import { label } from "../shared/label.ts";
import installed from "some-package";
twice();
(globalThis as any).bumpOfProgram = counter.bump;
(globalThis as any).packageOfProgram = installed;
for (const file of process.argv.slice(2)) await import(path.resolve(file));
console.log(label, "sees", counter.count, (await import(path.resolve("src/counter.ts"))) === counter);
`,
  "src/counter.ts": `export let count = 0;
export function bump(): number {
  return ++count;
}
`,
  "src/pairs.ts": `import { bump } from "./counter.ts";
export function twice(): number {
  bump();
  return bump();
}
`,
  "shared/label.ts": `export const label = "the program";\n`,
  "scripts/one.ts": `import { bump, count } from "../src/counter.ts";
console.log("one sees", count, bump === (globalThis as any).bumpOfProgram);
bump();
`,
  "scripts/three.mjs": `import installed, { name } from "some-package";
import * as label from "../shared/label.ts";
console.log("three sees", installed === globalThis.packageOfProgram, name, Object.keys(label).join());
`,
  "scripts/two.cjs": `const counter = require("../src/counter");
const { twice } = require("../src/pairs.ts");
console.log("two sees", counter.count, twice(), require("../shared/label.ts").label, require("some-package") === globalThis.packageOfProgram);
`,
  "node_modules/some-package/package.json": `{ "name": "some-package", "version": "1.0.0", "main": "./index.js" }\n`,
  "node_modules/some-package/index.js": `module.exports = { name: "some-package" };\n`,
};

test("a file on disk gets the compiled module for a source file of the executable", async () => {
  using dir = tempDir("aot-code-from-disk", files);
  const cwd = String(dir);
  const scripts = ["scripts/one.ts", "scripts/two.cjs", "scripts/three.mjs"];
  const plain = await run([bunExe(), "src/main.ts", ...scripts], cwd, bunEnv);
  expect(plain.stdout).toBe(
    "one sees 2 true\ntwo sees 3 5 the program true\nthree sees true some-package label\nthe program sees 5 true\n",
  );
  const flags = ["--compile", "--aot", "--aot-allow-code-from-disk"];
  const built = await run([bunExe(), "build", ...flags, "./src/main.ts", "--outfile", "./app.exe"], cwd, bunEnv);
  expect(built.exitCode).toBe(0);
  expect(await run([join(cwd, "app.exe"), ...scripts], cwd, bunEnv)).toEqual(plain);
  // Nothing is read from the sources.
  rmSync(join(cwd, "src"), { recursive: true });
  rmSync(join(cwd, "shared"), { recursive: true });
  expect(await run([join(cwd, "app.exe"), ...scripts], cwd, bunEnv)).toEqual(plain);
});
