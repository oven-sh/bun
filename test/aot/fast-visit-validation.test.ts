import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runProcess } from "./harness/run";
import { withoutCoreDump, withoutCrashReport } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

// In an executable built with --aot-validate the collector visits a cell twice: as its marking loop does, without the method table,
// and through the method table. It crashes with VisitedCellsDiffer when the first visit missed a reference of the second. A suite in
// which that never happens shows nothing unless the comparison can fail, so an option of the engine drops the last reference of
// each fast visit.
const program = `class Leaf {
  id: number;
  constructor(id: number) {
    this.id = id;
  }
}
class Pair {
  first: Leaf;
  second: Leaf;
  constructor(id: number) {
    this.first = new Leaf(id);
    this.second = new Leaf(id + 1);
  }
}
const pairs: Pair[] = [];
for (let i = 0; i < 1000; i++) pairs.push(new Pair(i));
Bun.gc(true);
let sum = 0;
for (const pair of pairs) sum += pair.first.id + pair.second.id;
console.log("sum", sum);
`;

// Only the collector's own visitor compares, and only while the program is stopped: with these two every marked cell is compared.
const everyCellIsCompared = { BUN_JSC_numberOfGCMarkers: "1", BUN_JSC_useConcurrentGC: "0" };

describe("validation of the collector's fast visits", () => {
  const dir = tempDir("fast-visit-validation", { "main.ts": program });
  const executable = join(String(dir), "program");

  beforeAll(async () => {
    const built = await runProcess(
      [bunExe(), "build", "--compile", "--aot", "--aot-validate", "main.ts", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
  });

  afterAll(() => dir[Symbol.dispose]());

  test("the two visits agree", async () => {
    const { stdout, stderr, exitCode } = await runProcess([executable], String(dir), {
      ...bunEnv,
      ...everyCellIsCompared,
    });
    expect(stderr).not.toContain("AOT validation: ");
    expect({ stdout, exitCode }).toEqual({ stdout: "sum 1000000\n", exitCode: 0 });
  });

  test("a fast visit that misses a reference crashes", async () => {
    const env = {
      ...bunEnv,
      ...everyCellIsCompared,
      ...withoutCrashReport,
      BUN_JSC_dropLastFastVisitReferenceForTesting: "1",
    };
    const { stdout, stderr, exitCode } = await runProcess(withoutCoreDump([executable]), String(dir), env);
    expect(stderr).toContain("GC: named by the method table and without a mark: ");
    expect(stderr).toContain("GC: a second visit by the method table names the same references");
    expect(stderr).toContain("AOT validation: VisitedCellsDiffer ");
    expect(stdout).not.toContain("sum");
    expect(exitCode).not.toBe(0);
  });
});
