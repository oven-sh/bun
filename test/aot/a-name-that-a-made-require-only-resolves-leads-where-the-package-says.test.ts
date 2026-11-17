// `createRequire(import.meta.url).resolve("meter/part")`, where the package's "exports" send "./part" to "./lib/part.js". A resolve off a require that the program made is a plain
// call, answered at the run. The executable finds a file by the path that it has there and reads no package.json: it looked for meter/part, meter/part.js, .. and threw "Cannot find
// module", and the build had said nothing. So with a "main" that is not index.js, a folder with a package.json of its own, a name of "imports", and the project's own name.
// The build, which had followed each of these names to its file, now writes them down for the run as it does for the names of a computed load.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "own-project", "imports": { "#inner": "./parts/inner.js" }, "exports": { "./part": "./parts/part.js" } }\n`,
  "parts/inner.js": `module.exports = "inner";\n`,
  "parts/part.js": `module.exports = "part";\n`,
  "node_modules/kit/package.json": `{ "name": "kit", "version": "0.0.1", "type": "module" }\n`,
  "node_modules/meter/package.json": `{ "name": "meter", "exports": { ".": "./index.js", "./part": "./lib/part.js" } }\n`,
  "node_modules/meter/index.js": `module.exports = "index";\n`,
  "node_modules/meter/lib/part.js": `module.exports = "part";\n`,
  "node_modules/mainful/package.json": `{ "name": "mainful", "main": "lib/main.js" }\n`,
  "node_modules/mainful/lib/main.js": `module.exports = "main";\n`,
  "node_modules/nested/package.json": `{ "name": "nested" }\n`,
  "node_modules/nested/dir/package.json": `{ "main": "start.js" }\n`,
  "node_modules/nested/dir/start.js": `module.exports = "start";\n`,
};

const write = (names: string[]) => `import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
const said = [];
for (const ask of [${names.map(name => `() => made.resolve(${JSON.stringify(name)})`).join(", ")}]) {
  try {
    said.push(ask().split("/").slice(-2).join("/"));
  } catch (error) {
    said.push(error.code);
  }
}
console.log("SAID", said.join(" "));
`;

const ofPackages = ["meter", "meter/part", "mainful", "nested/dir"];
const found = "meter/index.js lib/part.js lib/main.js dir/start.js";

for (const [entry, names, expected] of [
  ["src/main.mjs", [...ofPackages, "#inner", "own-project/part"], `${found} parts/inner.js parts/part.js`],
  ["node_modules/kit/dist/main.mjs", ofPackages, found],
] as const) {
  test(`the entry point ${entry}`, async () => {
    using dir = tempDir("a-name-that-a-made-require-only-resolves", { ...files, [entry]: write([...names]) });
    using elsewhere = tempDir("a-name-that-a-made-require-only-resolves-runs", {});
    const [cwd, program] = [String(dir), join(String(elsewhere), "program")];
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", program], cwd);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    for (const folder of ["node_modules", "parts"]) rmSync(join(cwd, folder), { recursive: true });
    expect(await run([program], String(elsewhere))).toEqual({ stdout: `SAID ${expected}\n`, stderr: "", exitCode: 0 });
  });
}
