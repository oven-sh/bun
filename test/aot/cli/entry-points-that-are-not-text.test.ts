import { expect } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildLimit = 300_000;

// Neither UTF-8 nor the start of any token, the same in every run.
const bytes = Buffer.from(Array.from({ length: 3000 }, (_, index) => 0x80 | ((index * 37) % 0x80)));

const listsItsFiles = `const files: { name: string; size: number }[] = (Bun as any).embeddedFiles;
console.log(files.map(file => file.name.replace(/-[a-z0-9]+\\./, ".") + " " + file.size).sort().join(", "));
`;

async function outputOf(folder: string, mode: string[], entryPoints: string[]) {
  built(await spawned([bunExe(), "build", "--compile", ...mode, ...entryPoints, "--outfile", "app"], folder, env));
  const run = await spawned([join(folder, isWindows ? "app.exe" : "app")], folder, env);
  return { stdout: run.stdout, exitCode: run.exitCode };
}

describe("a further entry point that is not text", () => {
  test(
    "is embedded as a file when its extension is unknown",
    () =>
      slot(async () => {
        using dir = tempDir("aot-entry-point-unknown-extension", { "app.ts": listsItsFiles });
        const folder = String(dir);
        writeFileSync(join(folder, "table.unknown"), bytes);

        const entryPoints = ["app.ts", "table.unknown"];
        const compiled = await outputOf(folder, ["--aot"], entryPoints);
        expect(compiled).toEqual({ stdout: "table.unknown 3000\n", exitCode: 0 });
        expect(compiled).toEqual(await outputOf(folder, [], entryPoints));
      }),
    buildLimit,
  );

  test.skipIf(isWindows)(
    "is embedded as a file when it is a link to a file without an extension",
    () =>
      slot(async () => {
        using dir = tempDir("aot-entry-point-link", { "app.ts": listsItsFiles });
        const folder = String(dir);
        mkdirSync(join(folder, "store"));
        writeFileSync(join(folder, "store", "blob"), bytes);
        symlinkSync(join("store", "blob"), join(folder, "linked.node"));

        const entryPoints = ["app.ts", "linked.node"];
        const compiled = await outputOf(folder, ["--aot"], entryPoints);
        expect(compiled).toEqual({ stdout: "blob. 3000\n", exitCode: 0 });
        expect(compiled).toEqual(await outputOf(folder, [], entryPoints));
      }),
    buildLimit,
  );
});

describe("text in a file whose name says nothing about it", () => {
  const typed = `const n: number = 41;\nconsole.log("ran", n + 1);\nmodule.exports = { n };\n`;

  test(
    "runs as TypeScript as an entry point, and is carried as a file where the program requires it",
    () =>
      slot(async () => {
        using dir = tempDir("aot-text-unknown-extension", {
          "tool.unknown": typed,
          "app.ts": `const tool = require("./tool.unknown");\nconsole.log("required", tool.n);\n`,
        });
        const folder = String(dir);

        expect(await outputOf(folder, ["--aot"], ["tool.unknown"])).toEqual({ stdout: "ran 42\n", exitCode: 0 });
        // An executable holds the file as it is, with --aot and without, and `require` answers its path. `bun run` reads it as code.
        const carried = { stdout: "required undefined\n", exitCode: 0 };
        expect(await outputOf(folder, [], ["app.ts"])).toEqual(carried);
        expect(await outputOf(folder, ["--aot"], ["app.ts"])).toEqual(carried);
        expect(await spawned([bunExe(), "app.ts"], folder, env)).toMatchObject({
          stdout: "ran 42\nrequired 41\n",
          exitCode: 0,
        });
      }),
    buildLimit,
  );

  test(
    "runs though a comment in it is not UTF-8",
    () =>
      slot(async () => {
        using dir = tempDir("aot-text-latin-1-comment", {});
        const folder = String(dir);
        writeFileSync(join(folder, "tool"), Buffer.from(`// caf\xe9\nconsole.log("ran");\n`, "latin1"));

        expect(await outputOf(folder, ["--aot"], ["tool"])).toEqual({ stdout: "ran\n", exitCode: 0 });
      }),
    buildLimit,
  );
});
