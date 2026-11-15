import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const programThatFaults = `import { read } from "bun:ffi";
console.log(read.u8(8 as never));
`;

// Stands first on PATH in place of the program that sends a report, and sends nothing.
const programThatNotesItsCalls = `#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
`;

describe.skipIf(!isHardened)("an executable of a Bun built with --hardened=on", () => {
  test("says where it crashed, and reports that to nobody unless BUN_ENABLE_CRASH_REPORTING=1 asks for it", async () => {
    using dir = tempDir("aot-hardened-crash-report", {
      "program.ts": programThatFaults,
      "bin/curl": programThatNotesItsCalls,
    });
    chmodSync(join(String(dir), "bin", "curl"), 0o755);
    const executable = join(String(dir), "program");
    const built = await run([
      bunExe(),
      "build",
      "--compile",
      "--aot",
      join(String(dir), "program.ts"),
      "--outfile",
      executable,
    ]);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });

    const crash = async (name: string, setting: Record<string, string>) => {
      const calls = join(String(dir), name);
      const { stderr } = await run([executable], undefined, {
        ...bunEnv,
        BUN_ENABLE_CRASH_REPORTING: undefined,
        DO_NOT_TRACK: undefined,
        PATH: join(String(dir), "bin") + ":" + process.env.PATH,
        CALLS: calls,
        ...setting,
      });
      expect(stderr).toContain("Segmentation fault");
      expect(stderr).toContain("bun.report");
      return calls;
    };
    const notAsked = await crash("not-asked", {});
    const refused = await crash("refused", { BUN_ENABLE_CRASH_REPORTING: "0" });
    const asked = await crash("asked", { BUN_ENABLE_CRASH_REPORTING: "1" });
    for (let tries = 0; tries < 200 && !existsSync(asked); tries++) await Bun.sleep(25);
    expect(readFileSync(asked, "utf8")).toContain("bun.report");
    expect({ notAsked: existsSync(notAsked), refused: existsSync(refused) }).toEqual({
      notAsked: false,
      refused: false,
    });
  }, 120_000);
});
