// A formatter with a constant locale and constant options that gets no format pattern is formatted by ICU as before, and nothing in
// the program shows it. The build counts the formatters it planned and the patterns it created, and --explain=statistics prints both.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// TODO: the build prints none of the three counts.
test.todo(
  "the build counts constant formatters and their format patterns",
  async () => {
    using dir = tempDir("aot-format-pattern-statistics", {
      "main.ts": `
console.log(new Intl.DateTimeFormat("zh-TW", { timeStyle: "short", timeZone: "UTC" }).format(0));
console.log(new Intl.DateTimeFormat("th", { dateStyle: "medium", timeZone: "UTC" }).format(0));
console.log(new Intl.NumberFormat("en-US", { notation: "compact" }).format(1234));
console.log(new Intl.NumberFormat("en-US").format(1234));
`,
    });
    const { stderr, exitCode } = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--explain=statistics",
        "main.ts",
        "--outfile",
        join(String(dir), "main" + (isWindows ? ".exe" : "")),
      ],
      String(dir),
    );
    const lines = stderr.split("\n").filter(line => /^(ConstantFormatterRequests|FormatPatterns\w+) /.test(line));
    expect(lines).toEqual([
      "ConstantFormatterRequests 4",
      "FormatPatternsCreated 1",
      "FormatPatternsRejectedByCheck 0",
    ]);
    expect(exitCode).toBe(0);
  },
  60_000,
);
