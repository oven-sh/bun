// The compiled JSON.stringify writes into a buffer that the program keeps between calls. A large buffer is released at the end of
// every call, whichever way the call ends: an 8-bit result, a 16-bit result, or a fallback to the generic writer.
import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.ts": `
    declare const process: { argv: string[]; memoryUsage(): { rss: number } };
    declare const Bun: { gc(force: boolean): void; sleep(milliseconds: number): Promise<void> };
    declare const console: { log(...values: unknown[]): void };
    const sentence = "the quick brown fox jumps over the lazy dog. ";
    const history: { role: string; content: string }[] = [];
    for (let i = 0; i < 400; i++) history.push({ role: i % 2 ? "assistant" : "user", content: sentence.repeat(1000) });
    if (process.argv[2] === "16-bit") history.push({ role: "user", content: "one dash \\u2014 makes the result 16-bit" });
    if (process.argv[2] === "fallback") {
      const last = { role: "user", content: "short" };
      Object.defineProperty(last, "toJSON", { value: () => "replaced" });
      history.push(last);
    }
    function send(): number {
      return JSON.stringify({ model: "m", messages: history }).length;
    }
    const length = send();
    Bun.gc(true);
    await Bun.sleep(100);
    Bun.gc(true);
    console.log(JSON.stringify({ length, rss: process.memoryUsage().rss }));
  `,
};

test.skipIf(isASAN || isDebug)(
  "a large output buffer is released however the call ends",
  async () => {
    using dir = tempDir("aot-json-stringify-buffer-release", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const { stderr: buildStderr, exitCode: buildExitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
      String(dir),
    );
    expect({ stderr: buildExitCode ? buildStderr : "", exitCode: buildExitCode }).toEqual({ stderr: "", exitCode: 0 });
    const measure = async (mode: string) => {
      const { stdout, stderr, exitCode } = await run([executable, mode], String(dir));
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout) as { length: number; rss: number };
    };
    const latin1 = await measure("8-bit");
    const wide = await measure("16-bit");
    const fallback = await measure("fallback");
    expect(latin1.length).toBeGreaterThan(18_000_000);
    const half = latin1.length / 2;
    expect(wide.rss - latin1.rss).toBeLessThan(half);
    expect(fallback.rss - latin1.rss).toBeLessThan(half);
  },
  240_000,
);
