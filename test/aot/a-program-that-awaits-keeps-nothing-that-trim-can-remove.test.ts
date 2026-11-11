// Promises, ticks, timers and warnings are in nearly every program. What stands behind them in Bun's library, the queue of ticks and
// the printer of warnings, uses nothing that --trim can remove: no file system, no paths, no Buffer.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const seesEveryAPI = "aot: trim: the compiler can see every API this program uses";
const reports = new Map<string, Promise<string>>();

function reportOn(text: string): Promise<string> {
  let report = reports.get(text);
  if (!report) {
    report = (async () => {
      using dir = tempDir("aot-awaits", { "main.mjs": text + "\n" });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.mjs"],
        cwd: String(dir),
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "ignore",
        stderr: "pipe",
      });
      const [said] = await Promise.all([proc.stderr.text(), proc.exited]);
      return said;
    })();
    reports.set(text, report);
  }
  return report;
}

// Promise.all and its kin can be removed by themselves, and the program that calls one keeps that one.
const keptIn = (report: string) =>
  report.split("\n").filter(line => / kept .+: used \(/.test(line) && !/ kept Promise\.\w+: /.test(line));

test.concurrent.each([
  `await 1;`,
  `console.log(typeof Promise, typeof EventTarget, typeof ReadableStream);`,
  `(async () => 1)().then(console.log);`,
  `new Promise(resolve => resolve(1)).finally(() => console.log("done"));`,
  `Promise.reject(new Error("nobody hears it"));`,
  `console.log(await Promise.all([1, Promise.resolve(2)]));`,
  `for await (const value of (async function* () { yield 1; })()) console.log(value);`,
  `process.nextTick(console.log, 1);`,
  `queueMicrotask(() => console.log(1));`,
  `setTimeout(() => console.log(1), 1);`,
])(
  "%s",
  async text => {
    const report = await reportOn(text);
    expect(report).toContain(seesEveryAPI);
    expect(keptIn(report)).toEqual([]);
  },
  600_000,
);

// Goals that are not met yet, each with what its program keeps today. A mark does not see a number grow worse: what does hold of the
// program today has a case of its own, which also holds it to today's number. Once a goal is met its case fails: move the program into
// the list above.
const asLoadingEvents = 'the same as `import "node:events";` alone';
for (const [text, kept, likeWhat] of [
  [
    `setTimeout(console.log, 1, 1);`,
    121,
    "the same as a delay of 1.5; none where a function of the program is the callback",
  ],
  [`process.emitWarning("a warning");`, 41, asLoadingEvents],
  [`process.emitWarning(new Error("a warning"));`, 41, asLoadingEvents],
  [`process.emitWarning("a warning", "Mine", "CODE");`, 41, asLoadingEvents],
] as const) {
  test.concurrent(
    `${text} every API that it uses is seen, and it keeps no more than ${kept} features`,
    async () => {
      const report = await reportOn(text);
      expect(report).toContain(seesEveryAPI);
      expect(keptIn(report).length).toBeLessThanOrEqual(kept);
    },
    600_000,
  );
  test.concurrent.failing(
    `${text} keeps ${kept} features, the goal is 0: ${likeWhat}`,
    async () => {
      expect(keptIn(await reportOn(text))).toEqual([]);
    },
    600_000,
  );
}
