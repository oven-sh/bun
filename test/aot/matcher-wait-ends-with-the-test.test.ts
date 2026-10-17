// `expect(promise).rejects` and `.resolves` run the event loop until the promise settles. Under --aot a promise that never settles does
// not hold the run for ever: the wait ends when the test's own timeout has passed, the test fails, and the tests behind it run.
// Without the flag the matcher waits for the promise and prints what released Bun prints.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { unsupported } from "./run-programs";

const files = {
  "never.test.ts": `
    import { expect, test } from "bun:test";
    test("a promise that never settles", async () => {
      await expect(new Promise(() => {})).rejects.toThrow("late");
    }, 300);
    test("resolves too", async () => {
      await expect(new Promise(() => {})).resolves.toBe(1);
    }, 300);
    test("an async function given to toThrow", () => {
      expect(() => new Promise(() => {})).toThrow("late");
    }, 300);
    test("an async custom matcher", () => {
      expect.extend({ toSettle: () => new Promise(() => {}) });
      (expect(1) as any).toSettle();
    }, 300);
    test("the next test", () => {
      expect(1).toBe(1);
    });
  `,
  "fake-timers.test.ts": `
    import { afterEach, beforeEach, expect, test, vi } from "bun:test";
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    test("a promise that only a fake timer would settle", async () => {
      const waits = new Promise((resolve, reject) => setTimeout(() => reject(new Error("late")), 1000));
      const outcome = expect(waits).rejects.toThrow("late");
      vi.advanceTimersByTime(5000);
      await outcome;
    }, 300);
    test("the next test", () => {
      expect(1).toBe(1);
    });
  `,
  "late.test.ts": `
    import { expect, test } from "bun:test";
    test("a promise that settles after the deadline", () => {
      expect(async () => {
        await Bun.sleep(400);
        throw new Error("late");
      }).toThrow("late");
    }, 100);
    test("the next test", () => {
      expect(1).toBe(1);
    });
  `,
};

async function run(cwd: string, args: string[]) {
  await using ran = Bun.spawn({ cmd: [bunExe(), "test", ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  const verdicts = (stdout + stderr).split("\n").filter(line => /^\((pass|fail)\)/.test(line)).map(line => line.replace(/ \[.*$/, ""));
  return { verdicts, exitCode, saysNotSettled: stderr.includes("The promise had not settled when the test timed out") };
}

test.concurrent.each(unsupported ? [[]] : [[], ["--aot"], ["--debug-aot"]])("bun test %s: only under --aot does a matcher say that its promise had not settled", async (...mode) => {
  using dir = tempDir("matcher-wait-late", files);
  expect(await run(String(dir), [...mode, "./late.test.ts"])).toEqual({
    verdicts: ["(fail) a promise that settles after the deadline", "(pass) the next test"],
    exitCode: 1,
    saysNotSettled: mode.length > 0,
  });
});

test.concurrent.each(unsupported ? [] : [["--aot"], ["--debug-aot"]])("bun test %s: a matcher that waits for a promise ends with the test's timeout", async (...mode) => {
  using dir = tempDir("matcher-wait", files);
  expect(await run(String(dir), [...mode, "./never.test.ts"])).toEqual({
    verdicts: [
      "(fail) a promise that never settles",
      "(fail) resolves too",
      "(fail) an async function given to toThrow",
      "(fail) an async custom matcher",
      "(pass) the next test",
    ],
    exitCode: 1,
    saysNotSettled: true,
  });
  expect(await run(String(dir), [...mode, "./fake-timers.test.ts"])).toEqual({
    verdicts: ["(fail) a promise that only a fake timer would settle", "(pass) the next test"],
    exitCode: 1,
    saysNotSettled: true,
  });
});
