import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `import { name } from "./a.js"` where the file has no such export stops the build, as it stops `bun build`. Nothing else in the
// program has the name, so the failed import is all that holds it. The message names the file by its full path, so this is not
// a program with a .build-errors.txt.
test("a missing export of a file is a build error", async () => {
  using dir = tempDir("aot-missing-file-export", {
    "main.js": `import { heldOnlyByFailedImport } from "./a.js";\nconsole.log(typeof heldOnlyByFailedImport);\n`,
    "a.js": `export const present = 1;\n`,
  });
  const outfile = join(String(dir), isWindows ? "program.exe" : "program");
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", outfile],
    String(dir),
  );
  expect(stderr.split(/\r?\n/).filter(line => line.startsWith("error: "))).toEqual([
    expect.stringMatching(/^error: TS100200: No matching export in ".*a\.js" for import "heldOnlyByFailedImport"$/),
  ]);
  expect(exitCode).toBe(1);
}, 120_000);

// A file that does not parse may export little. The build says what is wrong with the file, and nothing else.
const places = [
  ["a file of the program", "./broken.ts", "broken.ts"],
  ["a package", "plain", "node_modules/plain/index.ts"],
  ["the file under a package's aot condition", "typed", "node_modules/typed/index.aot.ts"],
];
const brokenTexts = [
  [
    "that still exports the name",
    `export function total(a: number) { return a +; }\n`,
    "TS1109: Expression expected.",
    "1:46",
  ],
  ["that no longer exports the name", `export const = ;\n`, "TS1134: Variable declaration expected.", "1:14"],
];
test.each(
  places.flatMap(([where, ...place]) => brokenTexts.map(([which, ...text]) => [where, which, ...place, ...text])),
)(
  "a syntax error in %s %s is printed",
  async (_, __, specifier, path, broken, message, position) => {
    using dir = tempDir("aot-syntax-error-in-imported-file", {
      "package.json": JSON.stringify({ name: "app" }),
      "main.ts": `import { total } from ${JSON.stringify(specifier)};\nconsole.log(total(1));\n`,
      "broken.ts": broken,
      "node_modules/plain/package.json": JSON.stringify({ name: "plain", version: "1.0.0", exports: "./index.ts" }),
      "node_modules/plain/index.ts": broken,
      "node_modules/typed/package.json": JSON.stringify({
        name: "typed",
        version: "1.0.0",
        exports: { ".": { aot: "./index.aot.ts", default: "./index.js" } },
      }),
      "node_modules/typed/index.js": `export function total(a) { return a; }\n`,
      "node_modules/typed/index.aot.ts": broken,
    });
    const outfile = join(String(dir), isWindows ? "program.exe" : "program");
    const { stderr, exitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", outfile],
      String(dir),
    );
    const lines = stderr.split(/\r?\n/);
    expect(lines.filter(line => line.startsWith("error: "))).toEqual(["error: " + message]);
    expect(lines.filter(line => line.trimStart().startsWith("at ")).map(line => line.replaceAll("\\", "/"))).toEqual([
      expect.stringContaining(path + ":" + position),
    ]);
    expect(exitCode).toBe(1);
  },
  120_000,
);
