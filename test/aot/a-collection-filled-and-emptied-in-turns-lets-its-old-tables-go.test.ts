import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Eight entries at a time live in each collection while many go through it. An iterator that was made at the start still names the table of that time.
const files = {
  "main.mjs": `
    import { heapStats } from "bun:jsc";
    function cellsInUse() {
      Bun.gc(true);
      return heapStats().objectCount;
    }
    const live = new Map();
    const members = new Set();
    const recent = new Map();
    function churn(from, to) {
      for (let i = from; i < to; i++) {
        live.set(i, i);
        live.delete(i - 8);
        members.add(i);
        members.delete(i - 8);
        recent.set(i, i);
        if (recent.size > 8) recent.delete(recent.keys().next().value);
      }
    }
    churn(0, 100);
    const madeEarly = [live.keys(), members.values(), recent.entries()];
    madeEarly[2].next();
    const before = cellsInUse();
    churn(100, 300000);
    const after = cellsInUse();
    console.log(after - before, madeEarly.map(iterator => String(iterator.next().value)).join(" "));
  `,
};

test("a table that was replaced keeps the table of today and none between the two", async () => {
  using dir = tempDir("aot-old-tables-are-let-go", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  const ran = await run([executable], String(dir));
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const [cellsMore, ...next] = ran.stdout.trim().split(" ");
  expect(next).toEqual(["299992", "299992", "299992,299992"]);
  expect(Number(cellsMore)).toBeLessThan(1000);
}, 240_000);
