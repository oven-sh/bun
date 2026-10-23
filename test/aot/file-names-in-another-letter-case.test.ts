// On a file system that tells the letter cases apart plain Bun still finds `import "./Foo.ts"` of foo.ts: the file name as written, with its extension, is looked for without regard to case, both
// spellings are one module, and require.resolve answers the name that the folder lists. A name without its extension and a folder in another case are not found. An executable does the same.
import { afterAll, expect } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { compileCommand } from "./harness/flags";
import { spawned, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

const folder = String(tempDir("aot-file-names-in-another-letter-case", {}));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
mkdirSync(join(folder, "Lib"));
writeFileSync(join(folder, "foo.ts"), `console.log("foo");\n`);
writeFileSync(join(folder, "common.cjs"), `exports.x = "common";\n`);
writeFileSync(join(folder, "Lib", "inner.mjs"), `export const y = "in a folder";\n`);
const tellsCasesApart = !existsSync(join(folder, "FOO.ts"));

const rows: [string, string, string][] = [
  ["an import of the file name in another case", "a.js", `import "./Foo.ts";`],
  ["an import in another case without the extension", "b.js", `import "./FOO";`],
  ["a require of the file name in another case", "c.cjs", `console.log(require("./Common.cjs").x);`],
  ["a folder in another case", "d.mjs", `import { y } from "./lib/inner.mjs"; console.log(y);`],
  [
    "a folder and a file in another case, loaded at run time",
    "e.mjs",
    `console.log((await import("./lib/Inner.mjs")).y);`,
  ],
  ["an import in another case without the extension, from TypeScript", "f.ts", `import "./Foo";`],
  ["both spellings are one module", "g.mjs", `import "./foo.ts"; import "./Foo.ts"; console.log("once or twice");`],
  [
    "three spellings loaded at run time are one module",
    "h.mjs",
    `console.log((await import("./Lib/INNER.mjs")).y, (await import("./Lib/inner.mjs")) === (await import("./Lib/Inner.mjs")));`,
  ],
  [
    "two spellings required are one module, and what require.resolve answers",
    "i.cjs",
    `console.log(require("./Common.cjs") === require("./common.cjs"), require.resolve("./COMMON.cjs").split("/").pop());`,
  ],
];

describe.skipIf(!tellsCasesApart)("compile/aot/file names in another letter case", () => {
  test.each(rows)("%s", async (_, file, text) => {
    writeFileSync(join(folder, file), text + "\n");
    const plain = await spawned([bunExe(), "run", file], folder, bunEnv);
    const executable = join(folder, "out-" + file.replace(/\..*/, ""));
    const build = await spawned(
      [bunExe(), ...compileCommand, ...withoutDebugInformation(), `./${file}`, "--outfile", executable],
      folder,
      bunEnv,
    );
    // What a static import does not find stops the build. What only a load at run time does not find fails there, as in plain Bun.
    if (plain.exitCode !== 0 && build.exitCode !== 0)
      return void expect({ build: build.exitCode }).toEqual({ build: 1 });
    expect({ stderr: build.stderr, build: build.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      build: 0,
    });
    const run = await spawned([executable], folder, bunEnv);
    expect({ stdout: run.stdout, exitCode: run.exitCode, signal: run.signal }).toEqual({
      stdout: plain.stdout,
      exitCode: plain.exitCode,
      signal: null,
    });
  });
});
