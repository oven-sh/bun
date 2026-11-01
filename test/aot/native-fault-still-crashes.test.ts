import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

if (isASAN)
  console.error(
    "SKIPPED: native-fault-still-crashes.test.ts: in a Bun built with AddressSanitizer its handler answers, not Bun's",
  );

// Compiled code turns a fault at one of its own null checks into a TypeError. A fault at an equally low address in native code is
// not a null check: the process has to crash, as it does without --aot.
const main = `import { read } from "bun:ffi";
class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}
function readX(point: Point | null): number {
  return point!.x;
}
for (const point of [new Point(1), null]) {
  try {
    console.log(readX(point));
  } catch (error) {
    console.log(error instanceof TypeError);
  }
}
console.log(read.u8(8));
console.log("never printed");
`;

test.skipIf(isASAN)(
  "a read of a low address in native code crashes the executable",
  async () => {
    using dir = tempDir("native-fault-still-crashes", { "main.ts": main });
    const run = async (cmd: string[]) => {
      const { stdout, stderr, exitCode } = await runCommand(cmd, String(dir), {
        ...bunEnv,
        BUN_CRASH_REPORT_URL: "",
        BUN_ENABLE_CRASH_REPORTING: "0",
      });
      return { stdout, stderr, exitCode };
    };

    const build = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "compiled"]);
    expect(build.stderr).not.toContain("error");
    expect(build.exitCode).toBe(0);

    const withoutCoreDump = isWindows ? [] : ["sh", "-c", 'ulimit -c 0; exec "$0" "$@"'];
    const crashed = await run([...withoutCoreDump, join(String(dir), "compiled")]);
    expect(crashed.stdout).toBe("1\ntrue\n");
    expect(crashed.stderr).toContain("Bun has crashed");
    expect(crashed.exitCode).not.toBe(0);
  },
  120_000,
);
