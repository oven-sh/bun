// A program can put the source of a regular expression together while it runs, so that no file of the build spells it. The compiler
// foresees such expressions and compiles them ahead of time, and must not spell their sources in the executable either.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const sources = {
  "entry.ts": `
let source = "";
for (const piece of ["pattern", "Built", "In", "A", "Loop"]) source += piece;
const first = new RegExp(source + "[0-9]+");
function edit(regex: RegExp) {
  let text = regex.source;
  const editor = {
    replace(name: string, value: string) {
      text = text.replace(name, value);
      return editor;
    },
    get: () => new RegExp(text, "i"),
  };
  return editor;
}
const second = edit(/^headAndtail$/).replace("head", "patternBuilt").replace("tail", "ByReplacing").get();
console.log(first.test(source + "12"), first.test(source), first.source.length, second.test("PATTERNBUILTANDBYREPLACING"), second.test("x"), second.source.length, second.flags);
`,
};
const hidden = ["patternBuiltInALoop", "patternBuiltAndByReplacing"];

describe.skipIf(!!unsupported)("compile/aot/assembled-patterns-in-executables", () => {
  const folder = String(tempDir("aot-assembled-patterns", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  async function build(name: string, flags: string[]) {
    const executable = join(folder, isWindows ? `${name}.exe` : name);
    built(
      await spawned(
        [
          bunExe(),
          "build",
          "--compile",
          "--minify",
          "--no-compile-function-source",
          ...flags,
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
    expect(run.exitCode).toBe(0);
    return {
      printed: run.stdout,
      holds: (text: string) => bytes.includes(text, 0, "latin1") || bytes.includes(text, 0, "utf16le"),
    };
  }

  test("a source that only the running program spells is in neither executable", async () => {
    await slot(async () => {
      const plain = await build("plain", []);
      const compiled = await build("compiled", ["--aot"]);
      expect(compiled.printed).toBe(plain.printed);
      expect(hidden.filter(plain.holds)).toEqual([]);
      expect(hidden.filter(compiled.holds)).toEqual([]);
    });
  }, 600_000);
});
