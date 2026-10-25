// ./compare-builds.ts compares two builds of Bun by instruction counts. Here it compares the Bun under test with itself: nothing may move by over 2%.
// That is also the proof that its numbers repeat on a machine as busy as a shard of CI.
import { afterAll, expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunExe, isASAN, isDebug, isLinux, isMusl, tempDir } from "harness";
import { join } from "path";
import { openInstructionCounter } from "../analysis-scaling/measure-check";
import type { Route } from "../servers/answers";
import { describe, test } from "../supported";
import {
  compare,
  measureBenchmarks,
  measureServer,
  readReadings,
  writeReadings,
  type Readings,
} from "./compare-builds";

function canCountInstructions() {
  const closeCounter = openInstructionCounter(process.pid);
  closeCounter?.();
  return closeCounter !== undefined;
}

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : !isLinux || isMusl || process.arch !== "x64"
      ? "it counts with perf_event_open of glibc, on x64"
      : !canCountInstructions()
        ? "this machine does not allow perf_event_open"
        : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/compare-builds.test.ts: ${skipped}`);

describe("compare()", () => {
  const readings = (rows: Record<string, [number, number?]>): Readings =>
    new Map(Object.entries(rows).map(([name, [instructions, yardstick]]) => [name, { instructions, yardstick }]));

  test("reports rows that moved by more than the threshold, the largest rise first", () => {
    const before = readings({ a: [100], b: [100], c: [100], d: [100], onlyBefore: [1] });
    const after = readings({ a: [101], b: [103], c: [150], d: [90], onlyAfter: [1] });
    expect(compare(before, after, 2).map(change => [change.name, Math.round(change.percent)])).toEqual([
      ["c", 50],
      ["b", 3],
      ["d", -10],
    ]);
  });

  test("ignores a move of two instructions or fewer", () => {
    expect(compare(readings({ a: [10] }), readings({ a: [12] }), 2)).toEqual([]);
  });

  test("marks a row whose JIT column moved the same way", () => {
    const [change] = compare(readings({ a: [100, 200] }), readings({ a: [110, 221] }), 2);
    expect(change.runtimeMovedToo).toBe(true);
    const [other] = compare(readings({ a: [100, 200] }), readings({ a: [110, 200] }), 2);
    expect(other.runtimeMovedToo).toBe(false);
  });
});

describe.skipIf(!!skipped)("compare-builds", () => {
  if (skipped) return;
  const folder = String(tempDir("aot-compare-builds", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test("a Bun does not differ from itself on small benchmarks", async () => {
    const only = /^(array\/reduce-in-function|text\/char-code-at-loop-in-function)$/;
    const before = await measureBenchmarks(bunExe(), join(folder, "before"), "small", { only, jobs: 2 });
    const after = await measureBenchmarks(bunExe(), join(folder, "after"), "called", { only, jobs: 2 });
    expect(before.size).toBeGreaterThanOrEqual(4);
    const again = await measureBenchmarks(bunExe(), join(folder, "again"), "small", { only, jobs: 2 });
    expect(compare(before, again, 2)).toEqual([]);
    expect([...after.keys()].every(name => name.startsWith("called "))).toBe(true);

    writeReadings(join(folder, "rows.tsv"), before);
    expect([...readReadings(join(folder, "rows.tsv")).keys()].sort()).toEqual([...before.keys()].sort());
  }, 240_000);

  test("a Bun does not differ from itself on a request to a server", async () => {
    const app = join(folder, "app");
    await Bun.write(
      join(app, "small.ts"),
      `const server = Bun.serve({
  port: Number(process.env.PORT),
  async fetch(request) {
    if (request.method === "POST") {
      const order = (await request.json()) as { items: number[] };
      return Response.json({ sum: order.items.reduce((sum, item) => sum + item, 0) });
    }
    return new Response("Hello, World!");
  },
});
console.log("listening " + server.port);
`,
    );
    writeFileSync(join(app, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: [] } }));
    const routes: Route[] = [
      { name: "text", method: "GET", path: "/text", type: "text/plain", expectedBody: "Hello, World!" },
      { name: "post", method: "POST", path: "/order", type: "application/json", request: '{"items":[1,2,3]}', expectedBody: '{"sum":6}' }, // prettier-ignore
    ];
    const before = await measureServer(bunExe(), app, "small", { routes, requests: 3000 });
    const after = await measureServer(bunExe(), app, "small", { routes, requests: 3000 });
    expect([...before.keys()]).toEqual(["server small text", "server small post"]);
    expect(compare(before, after, 2)).toEqual([]);
  }, 240_000);
});
