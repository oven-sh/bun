// A value that the host computes at the first read (process.pid, Bun.version, process.env) is typed by a row of the table of built-ins. Compiled code reads it out of a
// cell that the run time fills once. Where the cell is filled the value is held against what the record says, and the record says no more than that door asks.
// THE LIE: --aot-testing=NativeCodeAnswersNullish: the row writes undefined | null. Without the door `v == null` was true while the program was compiled:
// true,number,false for false,number,true, no stop; other programs died by an illegal instruction, without a sentence.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };
const program = `function ask() { const v = process.pid; return [v == null, typeof v, v > 0].join(); }\nconsole.log(ask(), ask());\n`;

describe.skipIf(!!unsupported)("a value that the host computes", () => {
  test("is held against its row where its cell is filled", () =>
    slot(async () => {
      using dir = tempDir("aot-value-of-the-host", { "pid.js": program });
      const folder = String(dir);
      const executable = (name: string) => join(folder, isWindows ? name + ".exe" : name);
      const build = (name: string, ...flags: string[]) =>
        spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...withoutDebugInformation,
            ...flags,
            "./pid.js",
            "--outfile",
            name,
          ],
          folder,
          env,
        );
      expect((await build("right")).exitCode).toBe(0);
      const right = await spawned([executable("right")], folder, env);
      expect({ stdout: right.stdout, exitCode: right.exitCode }).toEqual({
        stdout: "false,number,true false,number,true\n",
        exitCode: 0,
      });
      expect((await build("lied", "--aot-testing=NativeCodeAnswersNullish")).exitCode).toBe(0);
      const lied = await spawned([executable("lied")], folder, env);
      expect(lied.stdout).toBe("");
      expect(lied.stderr).toContain(
        "AOT: process.pid (call) is declared as undefined | null, and native code answered with something else: number.",
      );
    }));
});
