// A string literal type names a text. Where a build-time constant removes every expression that produced the text or compared with it,
// `bun build --compile` leaves the text out of the executable, and `bun build --compile --aot` must leave it out too, although
// the type still lists it. A value that holds the text can still arrive from parsed data, and is handled as the type says.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const sources = {
  "entry.ts": `
import type { Options } from "./types";
type Shape = { kind: "circle"; size: number } | { kind: "kindThatOnlyATypeLists"; size: number; side: number };
function make(limit: number): Options {
  if (process.env.BUILD_KIND === "internal" && limit > 3) return { mode: "modeThatOnlyATypeLists", limit };
  const options: Options = { mode: "plain", limit };
  if (process.env.BUILD_KIND === "internal") require("./internal").mark(options);
  return options;
}
function describe(options: Options): string {
  if (process.env.BUILD_KIND === "internal" && options.mode === "modeThatOnlyATypeLists") return "internal";
  return options.mode + " " + options.limit;
}
class Session {
  state: "idle" | "stateThatOnlyATypeLists" = "idle";
  constructor(public turns: number) {
    if (process.env.BUILD_KIND === "internal") this.state = "stateThatOnlyATypeLists";
  }
}
function area(shape: Shape): string {
  return shape.kind === "circle" ? "circle " + shape.size : shape.kind.length + " " + shape.side;
}
const reversed = (text: string) => text.split("").reverse().join("");
const circle: Shape = { kind: "circle", size: process.argv.length };
console.log(describe(make(process.argv.length)), new Session(2).state, area(circle));
console.log(area(JSON.parse('{"kind":"' + reversed("stsiLepyTAylnOtahTdnik") + '","size":1,"side":2}') as Shape));
const options = make(1);
(options as any).mode = reversed("stsiLepyTAylnOtahTedom");
console.log(describe(options).length);
`,
  "types.ts": `
export type Mode = "plain" | "modeThatOnlyATypeLists" | "modeMadeInAModuleThatIsCut";
export interface Options { mode: Mode; limit: number }
`,
  "internal.ts": `
import type { Options } from "./types";
export function mark(options: Options): void {
  options.mode = "modeMadeInAModuleThatIsCut";
}
`,
};
const hidden = [
  "modeThatOnlyATypeLists",
  "stateThatOnlyATypeLists",
  "kindThatOnlyATypeLists",
  "modeMadeInAModuleThatIsCut",
];

describe.skipIf(!!unsupported)("compile/aot/literal-types-in-executables", () => {
  const folder = String(tempDir("aot-literal-types", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  async function build(name: string, flags: string[]) {
    const executable = join(folder, isWindows ? `${name}.exe` : name);
    built(
      await spawned(
        [
          bunExe(),
          "build",
          "--compile",
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

  test.each([
    ["", []],
    [" built with --minify", ["--minify"]],
  ])(
    "a text that only a type lists is in neither executable%s",
    async (_, flags) => {
      await slot(async () => {
        const plain = await build("plain", flags);
        const compiled = await build("compiled", ["--aot", ...flags]);
        expect(compiled.printed).toBe(plain.printed);
        expect(hidden.filter(plain.holds)).toEqual([]);
        expect(hidden.filter(compiled.holds)).toEqual([]);
      });
    },
    600_000,
  );
});
