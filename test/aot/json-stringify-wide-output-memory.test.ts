// The compiled JSON.stringify writes a large 16-bit result straight into the string it returns, with no second copy of it.
// Peak RSS over the baseline, in units of the length of the result, measured on Linux x64: 4.9 so, 6.9 with the second copy.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { built } from "./run-programs";
import { test } from "./supported";

const files = {
  "main.ts": `
    declare const process: { argv: string[]; resourceUsage(): { maxRSS: number } };
    declare const console: { log(...values: unknown[]): void };
    const sentence = "the quick brown fox jumps over the lazy dog. ";
    const history: { role: string; content: string }[] = [];
    for (let i = 0; i < 400; i++) history.push({ role: i % 2 ? "assistant" : "user", content: sentence.repeat(1000) });
    history.push({ role: "user", content: "one dash \\u2014 makes the result 16-bit" });
    function send(): number {
      return JSON.stringify({ model: "m", messages: history }).length;
    }
    const length = process.argv[2] === "stringify" ? send() : 0;
    console.log(JSON.stringify({ length, peak: process.resourceUsage().maxRSS * 1024 }));
  `,
};

test.skipIf(isASAN || isDebug)(
  "a large 16-bit result is not copied a second time",
  async () => {
    using dir = tempDir("aot-json-stringify-wide-output-memory", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    built({ stderr: await build.stderr.text(), exitCode: await build.exited });
    const measure = async (mode: string) => {
      const { stdout, stderr, exitCode } = await run([executable, mode], String(dir));
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout) as { length: number; peak: number };
    };
    const baseline = await measure("nothing");
    const wide = await measure("stringify");
    expect(wide.length).toBeGreaterThan(18_000_000);
    expect(wide.peak - baseline.peak).toBeLessThan(5.8 * wide.length);
  },
  240_000,
);
