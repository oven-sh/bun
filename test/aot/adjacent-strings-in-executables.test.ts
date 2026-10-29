// The texts of a program's strings lie in one pool in an executable built with --aot. The end of one text and the start of the next must
// not read as one word to whoever searches the executable: in a bundle a quote, a dot or a comma stands between them.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const sources = {
  "entry.ts": `
function pair(flag: boolean): string[] {
  return flag ? ["firstConstantOfTwo", "secondConstantOfTwo"] : ["x"];
}
function named(o: any): unknown {
  return [o.firstNameOfTwo, o.secondNameOfTwo];
}
console.log(pair(process.argv.length > 0).join(" "), named({}));
`,
};
const spelledByNeighbors = ["firstConstantOfTwosecondConstantOfTwo", "firstNameOfTwosecondNameOfTwo"];

describe.skipIf(!!unsupported)("compile/aot/adjacent-strings-in-executables", () => {
  const folder = String(tempDir("aot-neighboring-texts", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  // TODO: the pool of texts puts nothing between one text and the next.
  test.todo(
    "two texts do not read as one word",
    async () => {
      await slot(async () => {
        const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
        built(
          await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              "--minify",
              "--no-compile-function-source",
              "./entry.ts",
              "--outfile",
              executable,
            ],
            folder,
            bunEnv,
          ),
        );
        const run = await spawned([executable], folder, bunEnv);
        const bytes = readFileSync(executable);
        rmSync(executable);
        expect(run.stdout).toBe("firstConstantOfTwo secondConstantOfTwo [ undefined, undefined ]\n");
        expect(bytes.includes("firstConstantOfTwo", 0, "latin1")).toBe(true);
        expect(spelledByNeighbors.filter(text => bytes.includes(text, 0, "latin1"))).toEqual([]);
      });
    },
    600_000,
  );
});
