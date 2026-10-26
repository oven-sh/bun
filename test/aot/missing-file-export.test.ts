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

// A name that is only a type in the file it comes from is no export when the program runs. Code that reads it stops the build, as
// it stops `bun build`. `export { name }` only hands the name on.
const shape = `export interface Shape {\n  a: number;\n}\nconsole.log("shape");\n`;
test.each([
  ["export default", `export default Shape;\n`],
  [
    "a function that nobody calls",
    `function unused() {\n  // @ts-ignore\n  return Shape;\n}\nconsole.log(typeof unused);\n`,
  ],
  ["export default beside export { }", `export { Shape };\nexport default Shape;\n`],
])(
  "an imported type that %s reads is a build error",
  async (_, reader) => {
    using dir = tempDir("aot-imported-type-is-read", {
      "main.ts": `import { Shape } from "./shape";\n` + reader,
      "shape.ts": shape,
    });
    const outfile = join(String(dir), isWindows ? "program.exe" : "program");
    const { stderr, exitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", outfile],
      String(dir),
    );
    expect(stderr.split(/\r?\n/).filter(line => line.startsWith("error: "))).toEqual([
      expect.stringMatching(/^error: TS100200: No matching export in ".*shape\.ts" for import "Shape"$/),
    ]);
    expect(exitCode).toBe(1);
  },
  120_000,
);

test("an imported type that export { } hands on is no export of the file", async () => {
  using dir = tempDir("aot-imported-type-is-handed-on", {
    "main.ts": `import * as handed from "./hands-on";\nconsole.log(Object.keys(handed));\n`,
    "hands-on.ts": `import { Shape } from "./shape";\nexport { Shape };\nexport const value = 1;\n`,
    "shape.ts": shape,
  });
  const outfile = join(String(dir), isWindows ? "program.exe" : "program");
  const build = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", outfile], String(dir));
  expect(build.stderr.split(/\r?\n/).filter(line => line.startsWith("error: "))).toEqual([]);
  const { stdout, exitCode } = await run([outfile], String(dir));
  expect(stdout).toBe(`shape\n[ "value" ]\n`);
  expect(exitCode).toBe(0);
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
