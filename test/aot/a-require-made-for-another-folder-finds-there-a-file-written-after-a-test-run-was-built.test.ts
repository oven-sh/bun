// A test run leaves a file that is written after its build to the loader, which looks from the folder of the file that asks. A require that
// was made for another folder looks from that folder. A file of the same name lies beside the files that ask: it is the wrong one.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("a file written after a test run was built is found in the folder that the require was made for", async () => {
  using dir = tempDir("aot-late-file-of-made-require", {
    "tsconfig.json": `{}`,
    "package.json": `{ "name": "late" }`,
    "asks-by-require.cjs": `exports.fetch = () => require("node:module").createRequire(__dirname + "/shelf/")("./book.cjs");\n`,
    "asks-by-import.mjs": `import { createRequire } from "node:module";\nexport const fetch = () => createRequire(__dirname + "/shelf/")("./book.cjs");\n`,
    "book.cjs": `module.exports = "beside the file that asks";\n`,
    "late.test.js": `import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { fetch as byRequire } from "./asks-by-require.cjs";
import { fetch as byImport } from "./asks-by-import.mjs";
mkdirSync(import.meta.dir + "/shelf");
writeFileSync(import.meta.dir + "/shelf/book.cjs", "module.exports = 'on the shelf';");
test("both look on the shelf", () => expect({ byRequire: byRequire(), byImport: byImport() }).toEqual({ byRequire: "on the shelf", byImport: "on the shelf" }));
`,
  });
  for (const flags of [[], ["--aot"]]) {
    const ran = await run([bunExe(), "test", ...flags, "./late.test.js"], String(dir), bunEnv);
    expect({ flags, stderr: ran.exitCode ? ran.stderr : "", exitCode: ran.exitCode }).toEqual({
      flags,
      stderr: "",
      exitCode: 0,
    });
    rmSync(join(String(dir), "shelf"), { recursive: true });
  }
});
