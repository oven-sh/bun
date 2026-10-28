// JSON.stringify remembers how long its last long text was and asks for as much memory at once for the next one.
// Where that much is no longer to be had, a far shorter text is still written by the engine's fast path, in what it needs.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported";

const rounds = 20;

// The values come from JSON.parse: nothing is known of their shapes, so the program calls the engine's JSON.stringify.
const program = `function textOfRows(count: number): string {
  const rows: string[] = [];
  for (let i = 0; i < count; i++) rows.push('{"id":' + i + ',"name":"row number ' + i + '","tags":["a' + i + '","b' + i + '"]}');
  return "[" + rows.join() + "]";
}
const short: unknown = JSON.parse(textOfRows(3_600));
const shortText = JSON.stringify(short);
let long: unknown = JSON.parse(textOfRows(900_000));
const longText = JSON.stringify(long);
long = null;
Bun.gc(true);
// Takes the memory that is left, down to pieces of 16 MB: far less than the long text took, far more than the short one takes.
let taken: string[] = [];
for (let size = 64 << 20; size >= 16 << 20; size >>= 1) {
  for (;;) {
    try {
      taken.push("x".repeat(size));
    } catch {
      break;
    }
  }
}
let same = 0;
for (let i = 0; i < ${rounds}; i++) same += Number(JSON.stringify(short) === shortText);
const pieces = taken.length;
taken = [];
Bun.gc(true);
console.log(longText.length > 50_000_000, shortText.length > 200_000, pieces > 0, same);
`;

describe("compile/aot/json-text-behind-a-very-long-one", () => {
  // A limit on address space is how the test makes memory scarce. AddressSanitizer reserves more than any such limit allows.
  test.skipIf(!isLinux || isASAN)(
    "short texts stay off the slow path when the memory that the long one took is not to be had again",
    async () => {
      using dir = tempDir("aot-json-text-behind-a-very-long-one", { "main.ts": program });
      const cwd = String(dir);
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", join(cwd, "main")],
          cwd,
          bunEnv,
        ),
      );
      const counts = join(cwd, "counts");
      const ran = await spawned(["sh", "-c", "ulimit -v 2097152 && exec ./main"], cwd, {
        ...bunEnv,
        BUN_JSC_aotCountsPath: counts,
      });
      expect(ran).toEqual({ stdout: `true true true ${rounds}\n`, stderr: "", exitCode: 0, signal: null });
      const slowPaths = readFileSync(counts, "utf8")
        .split("\n")
        .map(line => line.split("\t"))
        .filter(([, name]) => name === "counter:JSONStringifySlowPaths")
        .map(([count]) => Number(count));
      expect(slowPaths).toEqual([0]);
    },
    240_000,
  );
});
