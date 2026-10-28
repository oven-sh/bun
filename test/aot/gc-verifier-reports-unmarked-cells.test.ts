// BUN_JSC_verifyGC=1 marks the heap again after every collection and reports a cell that is reachable but was not marked.
// ./parts.mts runs programs under it (variant-verified-collections). This test shows that it follows the fields of compiled objects:
// a build without write barriers leaves cells unmarked that only an old compiled object refers to.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { withoutCoreDump, withoutCrashReport } from "./run-programs";
import { test } from "./supported";

const program = `import { edenGC, fullGC } from "bun:jsc";
interface Leaf { v: number }
interface Holder { leaf: Leaf }
const holders: Holder[] = [];
for (let i = 0; i < 1000; i++) holders.push({ leaf: { v: 0 } });
fullGC();
for (let i = 0; i < holders.length; i++) holders[i].leaf = { v: i };
edenGC();
let sum = 0;
for (let i = 0; i < holders.length; i++) sum += holders[i].leaf.v;
console.log(sum);
`;

test("the GC verifier reports a cell that a missing write barrier left unmarked", async () => {
  using dir = tempDir("aot-gc-verifier", { "entry.ts": program });
  for (const flags of [[], ["--aot-sabotage=StoresNeedNoBarrier"]]) {
    const executable = join(String(dir), (flags.length ? "sabotaged" : "sound") + (isWindows ? ".exe" : ""));
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, "entry.ts", "--outfile", executable],
      String(dir),
    );
    expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const { stdout, stderr, exitCode } = await run(withoutCoreDump([executable]), String(dir), {
      ...bunEnv,
      ...withoutCrashReport,
      BUN_JSC_verifyGC: "1",
    });
    if (!flags.length) {
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "499500\n", stderr: "", exitCode: 0 });
      continue;
    }
    expect(stderr).toContain("GC Verifier: ERROR cell");
    expect(exitCode).not.toBe(0);
  }
}, 240_000);
