// A test run leaves a file that is written after its build to the loader, and the loader looks from the folder of the file that asks.
// A require that was made for another folder looks from that folder, as it does for a file that the build found: the file of that name
// beside the file that asks is another file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("a file written after a test run was built is found from the folder of the made require", async () => {
  using dir = tempDir("aot-made-require-late-file", {
    "tsconfig.json": `{}`,
    "package.json": `{ "name": "p" }`,
    "by-require.cjs": `exports.load = () => require("node:module").createRequire(__dirname + "/lib/")("./late.cjs");\n`,
    "by-import.mjs": `import { createRequire } from "node:module";\nexport const load = () => createRequire(__dirname + "/lib/")("./late.cjs");\n`,
    "late.cjs": `module.exports = "beside the file that asks";\n`,
    "a.test.js": `import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { load as byRequire } from "./by-require.cjs";
import { load as byImport } from "./by-import.mjs";
mkdirSync(import.meta.dir + "/lib");
writeFileSync(import.meta.dir + "/lib/late.cjs", "module.exports = 'in the folder';");
test("both look in the folder", () => expect([byRequire(), byImport()]).toEqual(["in the folder", "in the folder"]));
`,
  });
  for (const flags of [[], ["--aot"]]) {
    const ran = await run([bunExe(), "test", ...flags, "./a.test.js"], String(dir), bunEnv);
    expect({ flags, stderr: ran.exitCode ? ran.stderr : "", exitCode: ran.exitCode }).toEqual({
      flags,
      stderr: "",
      exitCode: 0,
    });
    rmSync(join(String(dir), "lib"), { recursive: true });
  }
});
