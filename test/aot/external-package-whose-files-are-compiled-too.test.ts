import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
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
  "import() of the name, then of the path": {
    ...commonJS,
    "main.mjs": `const byName = await import("outside");\nconsole.log(typeof byName, byName.who);\nconst byPath = await import("./node_modules/outside/index.js");\n${show}`,
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
};

// --no-builtin-modules: a build that allows code from disk would compile all of them.
const modes: [string, string[], "executable" | "run"][] = [
  ["an executable", [], "executable"],
  ["code from disk is allowed", ["--aot-allow-code-from-disk", "--no-builtin-modules"], "run"],
  ["compiled in place", ["--compile-in-place"], "run"],
];

// On a build that looks for an external name among the compiled files, and that does not count a file found by its name as loaded, every one of these fails. One of each
// road of the loader stands in the two modes that are dear; where code from disk is allowed a build costs little. require() of the name and then of the path in an
// executable is the stored program parallel/modules/external-package-whose-file-is-required-by-path.
const witnesses: Record<string, string[]> = {
  "an executable": ["import() of the name, then of the path", "the namespace of an ES module"],
  "code from disk is allowed": ["require() of the name, then of the path", "import() of the name, then of the path"],
  "compiled in place": ["require() of the name, then of the path", "the package requires a file of the program first"],
};

for (const [mode, flags, reference] of modes) {
  for (const name of witnesses[mode]) {
    const files = programs[name];
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
