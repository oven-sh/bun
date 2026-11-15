// `const step = walk.next(answer); if (step.done) return step.value; ..`: compiled code steps the generator where the call stands and makes no result object.
// A test run has what no executable has: a spy on the `next` of one generator, and a mock that puts a plain iterator in the place of a generator function.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash or a build that stops prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

const walks = `
      export type Walk = Generator<number, string, number | undefined>;
      export function* walkOf(limit: number): Walk { let sum = 0; for (let i = 0; i < limit; i++) sum += (yield i) ?? 0; return "sum " + sum; }
      export function drive(walk: Walk): string { let answer: number | undefined; let out = ""; for (;;) { const step = walk.next(answer); if (step.done) return out + "|" + step.value; out += step.value + ","; answer = (step.value as number) * 2; } }
      export function takeApart(walk: Walk): string { let out = ""; for (;;) { const { value, done } = walk.next(2); if (done) return out + "|" + value; out += value + ","; } }
      export function count(walk: Walk): number { let n = 0; while (!walk.next(1).done) n++; return n; }
      export function* relay(walk: Walk): Walk { let answer: number | undefined; for (;;) { const step = walk.next(answer); if (step.done) return step.value; answer = yield step.value; } }
    `;

test("a test run steps generators by hand as plain does", async () => {
  using dir = tempDir("a-generator-driven-by-hand", {
    "walks.ts": walks,
    "walks-for-the-mock.ts": walks,
    "steps.test.ts": `
      import { expect, spyOn, test } from "bun:test";
      import { count, drive, relay, takeApart, walkOf } from "./walks";
      test("as made", () => { for (let i = 0; i < 300; i++) expect(drive(walkOf(4))).toBe("0,1,2,3,|sum 12"); expect(takeApart(walkOf(3))).toBe("0,1,2,|sum 6"); expect(count(walkOf(7))).toBe(7); expect(drive(relay(walkOf(3)))).toBe("0,1,2,|sum 6"); });
      test("a spy on next that calls through", () => { const walk = walkOf(3); const spy = spyOn(walk, "next"); expect(drive(walk)).toBe("0,1,2,|sum 6"); expect(spy).toHaveBeenCalledTimes(4); expect(spy.mock.calls.map(call => call[0])).toEqual([undefined, 0, 2, 4]); });
      test("a spy on next that answers for itself", () => { const walk = walkOf(3); let k = 0; const spy = spyOn(walk, "next").mockImplementation(() => ({ value: "spied " + k, done: k++ > 1 }) as any); expect(drive(walk)).toBe("spied 0,spied 1,|spied 2"); expect(spy).toHaveBeenCalledTimes(3); spy.mockRestore(); expect(drive(walk)).toBe("0,1,2,|sum 6"); });
      test("a spy with getters", () => { const walk = walkOf(3); const seen: string[] = []; let k = 0; spyOn(walk, "next").mockImplementation(() => { const at = k++; return { get done() { seen.push("done " + at); return at > 0; }, get value() { seen.push("value " + at); return at; } } as any; }); expect(takeApart(walk)).toBe("0,|1"); expect(seen).toEqual(["value 0", "done 0", "value 1", "done 1"]); });
      test("in an async test", async () => { const walk = walkOf(4); expect(walk.next().value).toBe(0); await null; expect(drive(walk)).toBe("1,2,3,|sum 12"); });
    `,
    "mocks.test.ts": `
      import { expect, mock, test } from "bun:test";
      test("a plain iterator in the place of the generator function", async () => { const actual = await import("./walks-for-the-mock"); const drive = actual.drive; mock.module("./walks-for-the-mock", () => ({ ...actual, walkOf: (limit: number) => { let k = 0; return { next() { const at = k++; return { value: "mocked " + at, done: at >= limit }; } }; } })); const mocked: any = await import("./walks-for-the-mock"); expect(drive(mocked.walkOf(2))).toBe("mocked 0,mocked 1,|mocked 2"); expect(mocked.count(mocked.walkOf(5))).toBe(5); });
    `,
  });
  const plain = await runTests(String(dir));
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results.length).toBe(6);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
});
