// For everyday-programs-*.test.ts. A few hundred of the programs of everyday-program-cases.ts, each in a folder of its own. Each is built alone, into an executable of its own. The first question is whether the
// build ends with an executable, the second whether that prints what `bun <file>` prints. `fuzz/fuzzilli/write-everyday-program-sweep.ts` writes out all of them.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "../supported";
import { everydayProgram, everydayProgramCount } from "./everyday-program-cases";
import { run } from "./run";

// One program by name, and every 10007th behind the first: the count of all of them has no factor in common with that, so each kind of loop, list and body comes round.
const places = [8, ...Array.from({ length: 239 }, (_, step) => (1 + step * 10007) % everydayProgramCount)];

// The build of these does not end with an executable. A case here fails once it does: then its line goes.
const stillStops = new Set<string>([]);

export function everydayProgramsIn(part: number, parts: number) {
  for (let at = part - 1; at < places.length; at += parts) {
    const { name, text } = everydayProgram(places[at]);
    test(name, async () => {
      using dir = tempDir("aot-everyday-program", { [name]: text });
      const folder = String(dir);
      const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
      const [plain, build] = await Promise.all([
        run([bunExe(), "./" + name], folder, bunEnv),
        run([bunExe(), "build", "--compile", "--aot", "./" + name, "--outfile", executable], folder, bunEnv),
      ]);
      // A program that said nothing would say the same as any other that said nothing.
      expect({ said: plain.stdout.startsWith("SAID "), exitCode: plain.exitCode }).toEqual({ said: true, exitCode: 0 });
      if (stillStops.has(name)) {
        expect(build.exitCode).not.toBe(0);
        return;
      }
      expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const compiled = await run([executable], folder, bunEnv);
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    });
  }
}
