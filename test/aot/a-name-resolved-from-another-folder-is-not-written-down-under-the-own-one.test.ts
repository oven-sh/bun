import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const packages = {
  "a/node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }\n`,
  "a/node_modules/dep/index.js": `module.exports = "a";\n`,
  "b/node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }\n`,
  "b/node_modules/dep/index.js": `module.exports = "b";\n`,
  "b/load.mjs": `import { createRequire } from "node:module";
export const load = createRequire(import.meta.url);
`,
};
const own = `const seen = createRequire(import.meta.url)("dep");
let mine;
mine = createRequire(import.meta.url);
`;

for (const [form, main] of Object.entries({
  "made for another path": `import { createRequire } from "node:module";
const load = createRequire(import.meta.dirname + "/../b/x.js");
${own}console.log(seen, load.resolve("dep") === mine.resolve("dep"));
`,
  "exported by another file": `import { createRequire } from "node:module";
import { load } from "../b/load.mjs";
${own}console.log(seen, load.resolve("dep") === mine.resolve("dep"));
`,
})) {
  test(`a require ${form}`, async () => {
    using dir = tempDir("a-name-resolved-from-another-folder", { ...packages, "a/main.mjs": main });
    using elsewhere = tempDir("a-name-resolved-from-another-folder-runs", {});
    const program = join(String(elsewhere), "program");
    const built = await run([bunExe(), "build", "--compile", "--aot", "a/main.mjs", "--outfile", program], String(dir));
    expect(built.exitCode).toBe(0);
    const { stdout, exitCode } = await run([program], String(elsewhere));
    expect({ stdout, exitCode }).toEqual({ stdout: "a false\n", exitCode: 0 });
  });
}
