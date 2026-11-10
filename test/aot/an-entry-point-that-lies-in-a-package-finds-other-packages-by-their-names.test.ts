// The entry point of the build lies in a package: `bun build --compile --aot node_modules/kit/dist/main.mjs`. The build took the folder of the entry point for the root of the
// executable. A folder above the root has no name in the executable, so `node_modules` itself had none, and a bare name, which is looked for below folders of that name, was found
// nowhere: `createRequire(import.meta.url).resolve("gauge/package.json")` threw "Cannot find module" at the run, and the build had said nothing.
// The root that the build derives from its entry points no longer lies inside a `node_modules` folder.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const packages = {
  "node_modules/kit/package.json": `{ "name": "kit", "version": "0.0.1", "type": "module" }\n`,
  "node_modules/gauge/package.json": `{ "name": "gauge", "version": "1.2.3", "main": "index.js" }\n`,
  "node_modules/gauge/index.js": `module.exports = "index";\n`,
  "node_modules/gauge/part.js": `module.exports = "part";\n`,
};

const main = `import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("gauge/package.json"));
console.log("SAID", path.basename(require.resolve("gauge")), require(path.join(root, "part.js")), require("gauge/package.json").version);
`;

for (const entry of ["node_modules/kit/dist/main.mjs", "node_modules/kit/main.mjs", "apps/one/src/main.mjs"]) {
  test(`the entry point ${entry}`, async () => {
    using dir = tempDir("an-entry-point-that-lies-in-a-package", { ...packages, [entry]: main });
    using elsewhere = tempDir("an-entry-point-that-lies-in-a-package-runs", {});
    const [cwd, program] = [String(dir), join(String(elsewhere), "program")];
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", program], cwd);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    rmSync(join(cwd, "node_modules"), { recursive: true });
    expect(await run([program], String(elsewhere))).toEqual({
      stdout: "SAID index.js part 1.2.3\n",
      stderr: "",
      exitCode: 0,
    });
  });
}
