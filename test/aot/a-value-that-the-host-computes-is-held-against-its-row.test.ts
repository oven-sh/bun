// A value that the host computes at the first read (process.pid, Bun.version, process.env) gets its type from an entry in the table of built-ins.
// Compiled code reads the value from a cell that the runtime fills once. When the runtime fills the cell, it checks the value against the type in the record,
// and the record claims no more than that check tests.
// Fault injection, --aot-testing=AssumeNullishHostResults: the table entry declares undefined | null. Without the check, `v == null` was already true at compile time:
// the program printed true,number,false instead of false,number,true and did not crash. Other programs died on an illegal instruction without a message.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported, withoutCrashReport } from "./harness/commands";
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
      expect((await build("lied", "--aot-testing=AssumeNullishHostResults")).exitCode).toBe(0);
      const lied = await spawned([executable("lied")], folder, { ...env, ...withoutCrashReport });
      expect(lied.stdout).toBe("");
      expect(lied.stderr).toContain("expected undefined | null, found int32 in the result of process.pid");
    }));
});
