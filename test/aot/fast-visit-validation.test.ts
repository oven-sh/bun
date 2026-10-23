import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runProcess } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
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
const withoutCrashReport = { BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" };

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

// An object that lies in the cell of another keeps that cell. Whoever is the first to mark the inner one marks the outer one next, so where another thread was the first the
// comparison of one visit cannot ask for the second mark: that thread may stand between the two. It is asked for at the end of marking, of every inner object that has a mark.
// A build whose marker leaves the second mark out shows that the question can fail. What a weak map holds is marked for the map's live keys, outside of any visit of a cell, so no comparison of two visits sees it.
const innerObjectsHeldByWeakMap = `type Inner = { count: number; label: string };
type Outer = { inner: Inner; tag: number };
type Key = { id: number };
function fill(into: Outer[], rows: number, columns: number): void {
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const i = row * columns + column;
      into.push({ inner: { count: i, label: "label" + (i % 7) }, tag: i });
    }
  }
}
const keys: Key[] = [];
const held = new WeakMap<Key, Inner>();
function hold(outers: Outer[]): void {
  for (const outer of outers) {
    const key = { id: outer.tag };
    keys.push(key);
    held.set(key, outer.inner);
  }
}
function prepare(): void {
  const outers: Outer[] = [];
  fill(outers, 10, 100);
  hold(outers);
}
// It writes over what the calls above left on the stack.
function churn(depth: number): number {
  const some: Outer[] = [];
  fill(some, 2, 2);
  return depth ? churn(depth - 1) + some[depth % 4].inner.count : 0;
}
prepare();
const churned = churn(20);
Bun.gc(true);
let sum = 0;
for (const key of keys) sum += held.get(key)!.count;
console.log("sum", sum, churned);
`;

describe("the marks of inner objects at the end of marking", () => {
  const dir = tempDir("marks-of-inner-objects", { "main.ts": innerObjectsHeldByWeakMap });
  const whole = join(String(dir), "whole");
  const sabotaged = join(String(dir), "sabotaged");

  beforeAll(async () => {
    for (const [executable, flags] of [
      [whole, []],
      [sabotaged, ["--aot-sabotage=InnerCellIsMarkedWithoutItsOuterCell"]],
    ] as const) {
      const built = await runProcess(
        [bunExe(), "build", "--compile", "--aot", "--aot-validate", ...flags, "main.ts", "--outfile", executable],
        String(dir),
        bunEnv,
      );
      expect(built.stderr).not.toContain("error:");
      expect(built.exitCode).toBe(0);
    }
  });

  afterAll(() => dir[Symbol.dispose]());

  test("every inner object with a mark lies in a cell with a mark", async () => {
    const { stdout, stderr, exitCode } = await runProcess([whole], String(dir), bunEnv);
    expect(stderr).not.toContain("AOT validation: ");
    expect({ stdout, exitCode }).toEqual({ stdout: "sum 499500 30\n", exitCode: 0 });
  });

  test("a marker that leaves out the mark of the outer cell crashes", async () => {
    const env = { ...bunEnv, ...withoutCrashReport };
    const { stdout, stderr, exitCode } = await runProcess(withoutCoreDump([sabotaged]), String(dir), env);
    expect(stderr).toContain(" has a mark and the cell that it lies in has none: ");
    expect(stderr).toContain("AOT validation: VisitedCellsDiffer ");
    expect(stdout).not.toContain("sum");
    expect(exitCode).not.toBe(0);
  });
});
