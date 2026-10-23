// The whole-program analysis of --aot proves more about a small program than about a large one: nothing else in it widens what is known, and everything the
// program does not reach is left out of the executable. So a case is a harder test alone than beside others. Every line of the files under each-case-alone/
// that starts with `t("` or `await t("` is one case. It is compiled as a program of its own, together with the lines that are not cases, and must behave as
// it does under plain Bun. A run takes one case in ten (`inShare` in run-programs.ts). The cases are dealt out to the files each-case-alone-<part>.test.ts by a hash of their names.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { extname, join } from "path";
import { built, inShare, slot, spawned, told, unsupported, withoutCoreDump } from "./run-programs";

const folder = join(import.meta.dir, "each-case-alone");
const nameOfCase = (line: string) => /^(?:await )?t\("([^"]+)"/.exec(line)?.[1];

export function eachCaseAlone(part: number, parts: number) {
  describe.concurrent("compile/aot/each case alone", () => defineCases(part, parts));
}

function defineCases(part: number, parts: number) {
  if (unsupported) return void test.skip(unsupported, () => {});
  // The cases start `sh`, `echo` and `cat` and open sockets in the file system.
  if (isWindows) return void test.skip("the cases use a POSIX shell", () => {});
  for (const file of readdirSync(folder).sort()) {
    const lines = readFileSync(join(folder, file), "utf8").split("\n");
    const main = "main" + extname(file);
    for (const [at, line] of lines.entries()) {
      const name = nameOfCase(line);
      if (name === undefined || Number(BigInt(Bun.hash(file + ": " + name)) % BigInt(parts)) !== part - 1 || !inShare(file + ": " + name, 10, true)) continue;
      test(
        `${file.slice(0, -extname(file).length)}: ${name}`,
        () =>
          slot(async () => {
            const source = lines.filter((other, index) => index === at || nameOfCase(other) === undefined).join("\n");
            // The two runs get a working directory each: many cases leave files behind.
            using dir = tempDir("aot-each-case-alone", { [main]: source, "plain/empty.txt": "", "compiled/empty.txt": "" });
            const root = String(dir);
            const executable = join(root, "program");
            built(await spawned([bunExe(), "build", "--compile", "--aot", main, "--outfile", executable], root, bunEnv));
            const plain = await spawned([bunExe(), "run", join(root, main)], join(root, "plain"), bunEnv);
            const compiled = await spawned(withoutCoreDump([executable]), join(root, "compiled"), bunEnv);
            expect(compiled.signal).toBeNull();
            expect(told(compiled)).toEqual(told(plain));
          }),
        600_000,
      );
    }
  }
}
