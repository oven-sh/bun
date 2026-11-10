// A package that --external leaves outside an executable is looked for when the program runs, from the folder of the file that asks. A require
// that was made for another folder looks from that folder. A package of the same name lies beside the files that ask: it is the wrong one.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

test("a package left outside an executable is found from the folder that the require was made for", async () => {
  using dir = tempDir("aot-outside-package-of-made-require", {
    "package.json": `{ "name": "outside" }`,
    "asks-by-require.cjs": `exports.found = require("node:module").createRequire(__dirname + "/plugins/")("@zzq/kit");\n`,
    "asks-by-import.mjs": `import { createRequire } from "node:module";\nexport const found = createRequire(__dirname + "/plugins/")("@zzq/kit");\n`,
    "main.mjs": `import { found as byRequire } from "./asks-by-require.cjs";\nimport { found as byImport } from "./asks-by-import.mjs";\nconsole.log(byRequire);\nconsole.log(byImport);\n`,
    "node_modules/@zzq/kit/package.json": `{ "name": "@zzq/kit", "main": "index.cjs" }`,
    "node_modules/@zzq/kit/index.cjs": `module.exports = "the kit beside the files that ask";\n`,
    "plugins/node_modules/@zzq/kit/package.json": `{ "name": "@zzq/kit", "main": "index.cjs" }`,
    "plugins/node_modules/@zzq/kit/index.cjs": `module.exports = "the kit under plugins";\n`,
  });
  const cwd = String(dir);
  const plain = { stdout: "the kit under plugins\nthe kit under plugins\n", stderr: "", exitCode: 0 };
  expect(await run([bunExe(), "main.mjs"], cwd)).toEqual(plain);
  const command = [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "--external",
    "@zzq/kit",
    "main.mjs",
    "--outfile",
    "out/program",
  ];
  expect((await run(command, cwd)).exitCode).toBe(0);
  expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual(plain);
});
