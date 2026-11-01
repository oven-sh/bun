import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { runsWholeGrids } from "./harness/ways";
import { test } from "./supported";

const counted = (who: string) => `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.who = "${who}";\n`;
const commonJS = { "node_modules/outside/index.js": counted("outside") };
const esModule = {
  "node_modules/outside/package.json": `{ "name": "outside", "main": "index.mjs", "type": "module" }`,
  "node_modules/outside/index.mjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexport const who = "outside";\n`,
};
const show = `console.log(typeof byName, byName && byName.who, typeof byPath, byPath && byPath.who, byName === byPath, globalThis.runs);\n`;

const programs: Record<string, Record<string, string>> = {
  "require() of the name, then of the path": {
    ...commonJS,
    "main.cjs": `const byName = require("outside");\nconsole.log(typeof byName, byName && byName.who);\nconst byPath = require("./node_modules/outside/index.js");\n${show}`,
  },
  "require() of the path, then of the name": {
    ...commonJS,
    "main.cjs": `const byPath = require("./node_modules/outside/index.js");\nconst byName = require("outside");\n${show}`,
  },
  "an import of each": {
    ...commonJS,
    "main.mjs": `import byName from "outside";\nimport byPath from "./node_modules/outside/index.js";\n${show}`,
  },
  "import() of the name, then of the path": {
    ...commonJS,
    "main.mjs": `const byName = await import("outside");\nconsole.log(typeof byName, byName.who);\nconst byPath = await import("./node_modules/outside/index.js");\n${show}`,
  },
  "require() of an ES module": {
    ...esModule,
    "main.cjs": `const byName = require("outside");\nconsole.log(typeof byName, byName.who);\nconst byPath = require("./node_modules/outside/index.mjs");\n${show}`,
  },
  "the namespace of an ES module": {
    ...esModule,
    "main.mjs": `import * as byName from "outside";\nimport * as byPath from "./node_modules/outside/index.mjs";\n${show}`,
  },
  "the package requires a file of the program first": {
    "shared.js": counted("shared"),
    "node_modules/outside/index.js": `module.exports = require("../../shared.js");\n`,
    "main.cjs": `const byName = require("outside");\nconsole.log(typeof byName, byName && byName.who);\nconst byPath = require("./shared.js");\n${show}`,
  },
  "the package requires a file of its own first": {
    "node_modules/outside/inner.js": counted("inner"),
    "node_modules/outside/index.js": `module.exports = require("./inner.js");\n`,
    "main.cjs": `const byName = require("outside");\nconsole.log(typeof byName, byName && byName.who);\nconst byPath = require("./node_modules/outside/inner.js");\n${show}`,
  },
};

// --no-builtin-modules: a build that allows code from disk would compile all of them.
const modes: [string, string[], "executable" | "run"][] = [
  ["an executable", [], "executable"],
  ["code from disk is allowed", ["--aot-allow-code-from-disk", "--no-builtin-modules"], "run"],
  ["compiled in place", ["--compile-in-place"], "run"],
];

// On a build that looks for an external name among the compiled files, and that does not count a file found by its name as loaded, fourteen of the twenty-four fail:
// an executable in all but the last two programs, the two other modes where the name comes first and in the last two. One of each road of the loader stands for them in the
// two modes that are dear; where code from disk is allowed a build costs little. Every case runs where AOT_WHOLE_GRIDS=1.
const witnesses: Record<string, string[]> = {
  "an executable": [
    "require() of the name, then of the path",
    "import() of the name, then of the path",
    "the namespace of an ES module",
  ],
  "code from disk is allowed": [
    "require() of the name, then of the path",
    "import() of the name, then of the path",
    "the package requires a file of the program first",
    "the package requires a file of its own first",
  ],
  "compiled in place": ["require() of the name, then of the path", "the package requires a file of the program first"],
};

for (const [mode, flags, reference] of modes) {
  for (const [name, files] of Object.entries(programs)) {
    if (!runsWholeGrids && !witnesses[mode].includes(name)) continue;
    test.concurrent(
      `${mode}: ${name}`,
      async () => {
        using dir = tempDir("external-package-whose-files-are-compiled-too", files);
        const folder = String(dir);
        const main = "main.cjs" in files ? "main.cjs" : "main.mjs";
        const build = async (flags: string[], name: string) => {
          const executable = join(folder, isWindows ? name + ".exe" : name);
          const built = await run(
            [bunExe(), "build", "--compile", ...flags, "--external", "outside", main, "--outfile", executable],
            folder,
          );
          expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
            stderr: "",
            exitCode: 0,
          });
          return [executable];
        };
        const expected = await run(reference === "run" ? [bunExe(), main] : await build([], "bundled"), folder);
        expect(expected.stdout).toContain(reference === "run" ? "true 1\n" : "false 2\n");
        const compiled = await run(await build(["--aot", ...flags], "compiled"), folder);
        expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
          stdout: expected.stdout,
          exitCode: expected.exitCode,
        });
      },
      600_000,
    );
  }
}
