// Promises, ticks, timers and warnings are in nearly every program. What stands behind them in Bun's library, the queue of ticks and
// the printer of warnings, uses nothing that --trim can remove: no file system, no paths, no Buffer.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

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
  `setTimeout(console.log, 1, 1);`,
  `process.emitWarning("a warning");`,
  `process.emitWarning(new Error("a warning"));`,
  `process.emitWarning("a warning", "Mine", "CODE");`,
])(
  "%s",
  async text => {
    using dir = tempDir("aot-awaits", { "main.mjs": text + "\n" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.mjs"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [report] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(report).toContain("aot: trim: the compiler can see every API this program uses");
    // Promise.all and its kin can be removed by themselves, and the program that calls one keeps that one.
    const kept = report
      .split("\n")
      .filter(line => / kept .+: used \(/.test(line) && !/ kept Promise\.\w+: /.test(line));
    expect(kept).toEqual([]);
  },
  600_000,
);
