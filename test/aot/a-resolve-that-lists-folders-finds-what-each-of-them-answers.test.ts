// `require.resolve("pkg", { paths: [second, __dirname] })` looks from each listed folder in its turn. The build used to resolve the name from the file's own folder alone and brought that
// file, so in the executable nothing lay below `second`, the search went on to the next folder, and one package answered for another. Where the name is a constant and every listed folder can
// be read and is there, the build brings what each of them answers.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const head = `const { join } = require("node:path");\nconst second = join(__dirname, "second");\nconst say = find => {\n  try {\n    return find();\n  } catch (error) {\n    return error.code;\n  }\n};\n`;
const found = (name: string, paths: string) =>
  `console.log("SAID", say(() => require.resolve("${name}", { paths: [${paths}] }).replace(__dirname, "")));\n`;
const pkg = (folder: string, manifest: object, files: Record<string, string>) => ({
  [`${folder}node_modules/pkg/package.json`]: JSON.stringify({ name: "pkg", ...manifest }),
  ...Object.fromEntries(Object.entries(files).map(([name, text]) => [`${folder}node_modules/pkg/${name}`, text])),
});
const both = (manifest: object, file: string) => ({
  ...pkg("", manifest, { [file]: `exports.name = "first";\n` }),
  ...pkg("second/", manifest, { [file]: `exports.name = "second";\n` }),
});

const cases: Record<string, { files: Record<string, string>; said: string }> = {
  "the first listed folder has a package of that name, and so has the file's own": {
    files: { ...both({}, "index.js"), "main.cjs": head + found("pkg", "second, __dirname") },
    said: "SAID /second/node_modules/pkg/index.js\n",
  },
  "the file's own folder is listed first": {
    files: { ...both({}, "index.js"), "main.cjs": head + found("pkg", "__dirname, second") },
    said: "SAID /node_modules/pkg/index.js\n",
  },
  "a main that is no index, and what is found is required": {
    files: {
      ...both({ main: "lib/entry.js" }, "lib/entry.js"),
      "main.cjs":
        head +
        found("pkg", "second, __dirname") +
        `console.log("SAID", say(() => require(require.resolve("pkg", { paths: [second, __dirname] })).name));\n`,
    },
    said: "SAID /second/node_modules/pkg/lib/entry.js\nSAID second\n",
  },
  "a map of exports": {
    files: {
      ...both({ exports: { "./part": "./lib/part.js" } }, "lib/part.js"),
      "main.cjs": head + found("pkg/part", "second, __dirname"),
    },
    said: "SAID /second/node_modules/pkg/lib/part.js\n",
  },
  "only a later folder has it": {
    files: {
      ...pkg("second/", {}, { "index.js": `exports.name = "second";\n` }),
      "third/note.txt": "note\n",
      "main.cjs": head + found("pkg", `join(__dirname, "third"), second`),
    },
    said: "SAID /second/node_modules/pkg/index.js\n",
  },
};

for (const [name, { files, said }] of Object.entries(cases)) {
  test(name, async () => {
    using dir = tempDir("a-resolve-that-lists-folders", { "package.json": `{ "name": "cell" }\n`, ...files });
    const cwd = String(dir);
    expect(await run([bunExe(), "main.cjs"], cwd)).toEqual({ stdout: said, stderr: "", exitCode: 0 });
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "out/program"], cwd);
    expect(built.exitCode).toBe(0);
    for (const file of ["main.cjs", "node_modules", "second", "third"])
      rmSync(join(cwd, file), { recursive: true, force: true });
    expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual({
      stdout: said,
      stderr: "",
      exitCode: 0,
    });
  });
}

// From a folder that holds no such package, while a folder above it does, `bun <file>` answers by walking upward. The search in the executable doesn't, from a folder of which it holds no file. So
// the build leaves such a call as it was, and it fails aloud. Once it answers as `bun <file>`, put the case into the list above.
test("a listed folder without it, below one that has it, is not answered yet", async () => {
  using dir = tempDir("a-resolve-that-lists-folders", {
    "package.json": `{ "name": "cell" }\n`,
    ...both({}, "index.js"),
    "third/note.txt": "note\n",
    "main.cjs": `const { join } = require("node:path");\nconsole.log("SAID", require.resolve("pkg", { paths: [join(__dirname, "third"), join(__dirname, "second")] }).replace(__dirname, ""));\n`,
  });
  const cwd = String(dir);
  expect(await run([bunExe(), "main.cjs"], cwd)).toEqual({
    stdout: "SAID /node_modules/pkg/index.js\n",
    stderr: "",
    exitCode: 0,
  });
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "out/program"], cwd);
  expect(built.exitCode).toBe(0);
  for (const file of ["main.cjs", "node_modules", "second", "third"])
    rmSync(join(cwd, file), { recursive: true, force: true });
  const ran = await run([join(cwd, "out", "program")], join(cwd, "out"));
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "", exitCode: 1 });
  expect(ran.stderr).toContain("Cannot find package 'pkg'");
});
