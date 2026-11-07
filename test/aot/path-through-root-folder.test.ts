import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const main = `import { createRequire } from "node:module";
import "./lib/b.cjs";
const load = createRequire({ held: import.meta.url }.held);
console.log(load("./a.cjs") === require("./a.cjs"), load("../app/a.cjs").name, load("../app/lib/b.cjs").name);
try {
  load("../other/a.cjs");
} catch (error) {
  console.log("other", error.code);
}
`;

test("a path that goes up out of the root directory and comes back finds the compiled file", async () => {
  using dir = tempDir("aot-through-root-folder", {
    "app/main.mjs": main,
    "app/a.cjs": `exports.name = "a";`,
    "app/lib/b.cjs": `exports.name = "b";`,
    "other/a.cjs": `exports.name = "other";`,
  });
  const directory = join(String(dir), "app");
  const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
  expect(plain.stdout).toBe("true a b\n");
  const outfile = join(directory, process.platform === "win32" ? "out.exe" : "out");
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", outfile],
    directory,
    bunEnv,
  );
  expect(build.exitCode).toBe(0);
  const compiled = await run([outfile], join(String(dir), "other"), bunEnv);
  expect(compiled.stdout).toBe("true a b\nother MODULE_NOT_FOUND\n");
  expect(compiled.exitCode).toBe(0);
  expect(readFileSync(outfile).includes(String(dir))).toBe(false);
}, 60_000);
