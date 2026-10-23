// `object[key]`, where the type of the key is a union of a few names, is compiled as a test for each name and an access by that name. A name
// that only the type mentions gets no such test: no code of the program writes it, so a build without --aot does not contain it.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const sources = {
  "entry.ts": `
interface Options {
  limit: number;
  depth: number;
  memberOnlyTheKeyTypeLists?: number;
  memberOnlyCutCodeTouches?: number;
}
function read(options: Options, key: keyof Options): number | undefined {
  return options[key];
}
function write(options: Options, key: keyof Options, value: number): void {
  options[key] = value;
}
const reversed = (text: string) => text.split("").reverse().join("");
const options: Options = { limit: 1, depth: 2 };
if (process.env.BUILD_KIND === "internal") options.memberOnlyCutCodeTouches = 3;
write(options, process.argv.length > 0 ? "limit" : "depth", 5);
console.log(read(options, "limit"), read(options, "depth"));
const fromOutside = reversed("stsiLepyTyeKehTylnOrebmem") as keyof Options;
console.log(read(options, fromOutside));
write(options, fromOutside, 7);
console.log(read(options, fromOutside), Object.keys(options).map(key => key.length).join(), JSON.stringify(options).length);
`,
};
const hidden = ["memberOnlyTheKeyTypeLists", "memberOnlyCutCodeTouches"];

describe.skipIf(!!unsupported)("compile/aot/key-names-in-executables", () => {
  const folder = String(tempDir("aot-names-of-keys", sources));
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
          "--define",
          'process.env.BUILD_KIND="external"',
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

  // TODO: both names are in the executable built with --aot.
  test.todo(
    "a name that only the type of a key mentions is in neither executable",
    async () => {
      await slot(async () => {
        const plain = await build("plain", []);
        const compiled = await build("compiled", ["--aot"]);
        expect(compiled.printed).toBe(plain.printed);
        expect(hidden.filter(plain.holds)).toEqual([]);
        expect(hidden.filter(compiled.holds)).toEqual([]);
      });
    },
    600_000,
  );
});
