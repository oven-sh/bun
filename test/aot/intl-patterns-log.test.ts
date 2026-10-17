// A formatter with a constant locale and constant options that gets no format pattern is formatted by ICU as before, and nothing in
// the program shows it. With BUN_JSC_logAOTFormatPatterns=1 the build says which formatters those are, and why.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

test("the build says why a constant formatter has no format pattern", async () => {
  using dir = tempDir("aot-format-pattern-log", {
    "main.ts": `
console.log(new Intl.DateTimeFormat("zh-TW", { timeStyle: "short", timeZone: "UTC" }).format(0));
console.log(new Intl.DateTimeFormat("th", { dateStyle: "medium", timeZone: "UTC" }).format(0));
console.log(new Intl.NumberFormat("en-US", { notation: "compact" }).format(1234));
console.log(new Intl.NumberFormat("en-US").format(1234));
`,
  });
  await using build = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "main.ts",
      "--outfile",
      join(String(dir), "main" + (isWindows ? ".exe" : "")),
    ],
    cwd: String(dir),
    env: { ...bunEnv, BUN_JSC_logAOTFormatPatterns: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  const lines = stderr.split("\n").filter(line => line.startsWith("AOT: "));
  expect(lines).toEqual([
    expect.stringMatching(
      /^AOT: no format pattern for Intl\.DateTimeFormat\("zh-TW", timeStyle: short, timeZone: UTC\): ICU's pattern, .*, has 1 of the letter B$/,
    ),
    expect.stringMatching(
      /^AOT: no format pattern for Intl\.DateTimeFormat\("th", dateStyle: medium, timeZone: UTC\): the calendar is buddhist and the numbering system latn$/,
    ),
    expect.stringMatching(
      /^AOT: no format pattern for Intl\.NumberFormat\("en-US", notation: compact\): notation is compact$/,
    ),
    expect.stringMatching(
      /^AOT: 4 Intl formatters have a constant locale and constant options; 1 have a pattern in the image; 0 patterns differed from ICU on a sample$/,
    ),
  ]);
  expect(exitCode).toBe(0);
});
