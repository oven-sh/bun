// A member that a type declares and no code stores, reads or names takes no room in a typed object, and --minify keeps its name out of an
// executable built with --aot. That also holds where another type lists the name as a string literal, as `keyof` does.
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
  memberThatNothingTouches?: number;
}
interface Change {
  key: keyof Options;
  value: number;
}
function apply(options: Options, change: Change): Options {
  if (change.key === "limit") options.limit = change.value;
  else if (change.key === "depth") options.depth = change.value;
  else (options as any)[change.key as string] = change.value;
  return options;
}
function change(flag: boolean, value: number): Change {
  return { key: flag ? "limit" : "depth", value };
}
const reversed = (text: string) => text.split("").reverse().join("");
console.log(JSON.stringify(apply({ limit: 1, depth: 2 }, change(process.argv.length > 0, 5))));
const fromOutside = JSON.parse('{"key":"' + reversed("sehcuoTgnihtoNtahTrebmem") + '","value":7}') as Change;
const changed = apply({ limit: 1, depth: 2 }, fromOutside);
console.log(Object.keys(changed).map(key => key.length).join(), Object.values(changed).join());
const parsed = JSON.parse('{"limit":3,"' + reversed("sehcuoTgnihtoNtahTrebmem") + '":4,"depth":5}') as Options;
console.log(parsed.limit + parsed.depth, Object.keys(parsed).map(key => key.length).join(), Object.values(parsed).join());
`,
};

describe.skipIf(!!unsupported)("compile/aot/member-names-in-executables", () => {
  const folder = String(tempDir("aot-member-names", sources));
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
      holdsTheName:
        bytes.includes("memberThatNothingTouches", 0, "latin1") ||
        bytes.includes("memberThatNothingTouches", 0, "utf16le"),
    };
  }

  // TODO: the name is in the executable built with --aot.
  test.todo(
    "the name of a member that nothing touches is in neither executable",
    async () => {
      await slot(async () => {
        const plain = await build("plain", []);
        const compiled = await build("compiled", ["--aot"]);
        expect(compiled.printed).toBe(plain.printed);
        expect({ plain: plain.holdsTheName, compiled: compiled.holdsTheName }).toEqual({
          plain: false,
          compiled: false,
        });
      });
    },
    600_000,
  );
});
