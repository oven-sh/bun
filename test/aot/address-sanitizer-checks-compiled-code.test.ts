import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Every other cell of a block is never allocated and stays poisoned. --aot-testing=ProveEverything takes the declared type for
// proven, so `held.c` of a Short is read behind the end of its cell.
const shorterObject = `class Long { a = 1.5; b = 2.5; c = 3.5; d = 4.5; e = 5.5; f = 6.5; g = 7.5; h = 8.5; }
class Short { a = 1.5; }
function read(held: Long): number { return held.c; }
const values: unknown[] = [];
for (let i = 0; i < 64; i++) values.push(i & 1 ? new Short() : new Long());
let sum = 0;
for (let i = 0; i < values.length; i++) sum += read(values[i] as Long) > 0 ? 1 : 0;
console.log(sum);
`;

(isASAN && isLinux && process.arch === "x64" ? test : test.skip).each([
  ["code that B3 generates", ["--aot-heat=everything-is-hot"]],
])(
  "AddressSanitizer reports a read behind the end of an object by %s",
  async (_, flags) => {
    using dir = tempDir("asan-red-zone-cells", { "entry.ts": shorterObject });
    for (const falseProof of [[], ["--aot-testing=ProveEverything"]]) {
      const executable = join(String(dir), falseProof.length ? "planted" : "sound");
      const build = await run(
        [bunExe(), "build", "--compile", "--aot", ...falseProof, ...flags, "entry.ts", "--outfile", executable],
        String(dir),
      );
      expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });

      const { stdout, stderr, exitCode } = await run([executable], String(dir), {
        ...bunEnv,
        ASAN_OPTIONS: bunEnv.ASAN_OPTIONS + ":symbolize=0",
      });
      if (!falseProof.length) {
        expect({ stdout, exitCode }).toEqual({ stdout: "32\n", exitCode: 0 });
        continue;
      }
      expect(stderr).toMatch(/poisoned memory: function \d+/);
      expect(stderr).toContain("AddressSanitizer: use-after-poison");
      expect(exitCode).not.toBe(0);
    }
  },
  240_000,
);
