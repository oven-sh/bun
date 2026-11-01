import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A name that is not found from its importer is looked for once more from the root of the executable, which is how an entry point is found
// by its path. The resolver went on from there to the folder on disk that stands for the root: the working directory. So a package below
// the working directory answered for an importer that lies elsewhere, and a file that the "exports" of the importer's own package hide was
// found as a file. It shows where the root lies above the importer (`--root`): below the importer's own folder the executable says "hidden".
test("a name that its importer cannot reach is not found below the working directory", async () => {
  const hides = {
    "package.json": JSON.stringify({ name: "hides", version: "1.0.0", exports: { ".": "./a.js", "./hidden": null } }),
    "a.js": `exports.which = "a";\n`,
    "hidden.js": `exports.which = "hidden";\n`,
  };
  const below = (folder: string, files: Record<string, string>) =>
    Object.fromEntries(Object.entries(files).map(([name, text]) => [`${folder}/${name}`, text]));
  using dir = tempDir("aot-not-below-the-working-directory", {
    "a/b/entry.mjs": `import "./inner.cjs";\n`,
    "a/b/inner.cjs": `
      const { createRequire } = require("node:module");
      function attempt(what, answer) {
        try {
          console.log(what + ":", String(answer()).replaceAll("\\\\", "/").split("node_modules/").pop());
        } catch (error) {
          console.log(what + ":", "throws", error.code);
        }
      }
      attempt("the package", () => require.resolve("hides"));
      attempt("its own require, a hidden file", () => require.resolve("hides/hidden.js"));
      attempt("made from __filename, a hidden file", () => createRequire(__filename).resolve("hides/hidden.js"));
      attempt("made from __dirname, a hidden file", () => createRequire(__dirname + "/").resolve("hides/hidden.js"));
      attempt("made, and loaded", () => createRequire(__filename)("hides/hidden.js").which);
      attempt("made, a package that lies elsewhere", () => createRequire(__filename).resolve("only-elsewhere"));
      attempt("made, a file of it", () => createRequire(__filename).resolve("only-elsewhere/index.js"));
    `,
    ...below("a/b/node_modules/hides", hides),
    // A copy with the same "exports", one without a package.json, and a package that the importer cannot reach.
    ...below("elsewhere/node_modules/hides", hides),
    "bare/node_modules/hides/hidden.js": hides["hidden.js"],
    ...below("elsewhere/node_modules/only-elsewhere", { "index.js": `exports.which = "elsewhere";\n` }),
    ...below("bare/node_modules/only-elsewhere", { "index.js": `exports.which = "bare";\n` }),
    "tsconfig.json": "{}\n",
  });
  const root = String(dir);
  const executable = join(root, "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", `--root=${root}`, "./a/b/entry.mjs", "--outfile", executable],
    root,
    bunEnv,
  );
  expect({
    errors: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({
    errors: [],
    exitCode: 0,
  });
  for (const folder of ["a/b", "a", ".", "elsewhere", "bare"]) {
    const plain = await run([bunExe(), "run", join(root, "a/b/entry.mjs")], join(root, folder), bunEnv);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("made from __filename, a hidden file: throws MODULE_NOT_FOUND");
    const compiled = await run([executable], join(root, folder), bunEnv);
    expect({ folder, stdout: compiled.stdout.split("\n"), exitCode: compiled.exitCode }).toEqual({
      folder,
      stdout: plain.stdout.split("\n"),
      exitCode: 0,
    });
  }
}, 240_000);
