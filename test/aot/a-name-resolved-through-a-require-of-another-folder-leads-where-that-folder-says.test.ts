// Two folders hold a package of one name, and its files are spelled otherwise than their names ("main": "lib/main.js", "./part": "./lib/part.js"). A file of the first folder resolves
// the names through its own require and through a require of the second folder: one that it made for a path there, or one that a file there exports. The build knows each answer and
// from where it is looked for. It wrote the answers of the own require down for the run and left the others out, so they threw MODULE_NOT_FOUND and the build had said nothing.
// Each answer now stands under the folder that it is looked for from: neither folder answers for the other.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const packageIn = (folder: string) => ({
  [`${folder}/node_modules/gauge/package.json`]: `{ "name": "gauge", "exports": { ".": "./lib/main.js", "./part": "./lib/part.js" } }\n`,
  [`${folder}/node_modules/gauge/lib/main.js`]: `module.exports = "main of ${folder}";\n`,
  [`${folder}/node_modules/gauge/lib/part.js`]: `module.exports = "part of ${folder}";\n`,
});

const asks = `const own = createRequire(import.meta.url);
const ask = find => {
  try {
    return find().split("/").slice(-5).join("/");
  } catch (error) {
    return error.code;
  }
};
console.log("SAID", ask(() => other.resolve("gauge")), ask(() => other.resolve("gauge/part")));
console.log("SAID", ask(() => own.resolve("gauge")), ask(() => own.resolve("gauge/part")));
`;

for (const [form, head] of Object.entries({
  "made for a path in the other folder": `import { createRequire } from "node:module";
const other = createRequire(import.meta.dirname + "/../second/x.js");
`,
  "exported by a file of the other folder": `import { createRequire } from "node:module";
import { load as other } from "../second/load.mjs";
`,
})) {
  test(`a require ${form}`, async () => {
    using dir = tempDir("a-name-resolved-through-a-require-of-another-folder", {
      ...packageIn("first"),
      ...packageIn("second"),
      "second/load.mjs": `import { createRequire } from "node:module";\nexport const load = createRequire(import.meta.url);\n`,
      "first/main.mjs": head + asks,
    });
    using elsewhere = tempDir("a-name-resolved-through-a-require-of-another-folder-runs", {});
    const [cwd, program] = [String(dir), join(String(elsewhere), "program")];
    const built = await run([bunExe(), "build", "--compile", "--aot", "first/main.mjs", "--outfile", program], cwd);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    for (const folder of ["first", "second"]) rmSync(join(cwd, folder), { recursive: true });
    expect(await run([program], String(elsewhere))).toEqual({
      stdout:
        "SAID second/node_modules/gauge/lib/main.js second/node_modules/gauge/lib/part.js\n" +
        "SAID first/node_modules/gauge/lib/main.js first/node_modules/gauge/lib/part.js\n",
      stderr: "",
      exitCode: 0,
    });
  });
}
