// Microbench for the line scan behind the code frame of a printed error and
// behind `position.lineText` of a CSS error: `strings.indexOfLineRanges` finds
// the byte ranges of a target line and of the lines before it. Compare against
// a baseline build by running:
//
//   BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1 bun run build:release bench/sourcemap/code-frame-scan-bench.ts
//
// The scan starts at the first byte of the text, so each kind of text runs with
// a target line near the first line, far from it, and past the last one.

import { stringsInternals } from "bun:internal-for-testing";

const { indexOfLineRanges } = stringsInternals;

const LINES = 60_000;
const line = "  const value = compute(input, 42);";
const lines = (each: (i: number) => string, lineBreak = "\n", count = LINES) => {
  let text = "";
  for (let i = 0; i < count; i++) text += each(i) + lineBreak;
  return new TextEncoder().encode(text);
};

const texts: [name: string, text: Uint8Array][] = [
  ["lines that end in \\n", lines(() => line)],
  ["lines that end in \\r\\n", lines(() => line, "\r\n")],
  ["lines with tabs", lines(() => "\tconst value =\tcompute(input, 42);")],
  ["lines with non-ASCII characters", lines(() => "// café ☃ " + line)],
  ["lines of 1,000 bytes", lines(() => Buffer.alloc(999, "x").toString(), "\n", LINES / 20)],
  ["a \\r alone every 50 lines", lines(i => (i % 50 === 49 ? "a\rb" : line))],
  ["a line of 1 MB in line 100", lines(i => (i === 99 ? Buffer.alloc(1 << 20, "x").toString() : line))],
];

// Nanoseconds per call. Whole passes of `calls` calls, for at least 100 ms.
function measure(calls: number, fn: () => unknown): string {
  const start = performance.now();
  let elapsed = 0;
  let done = 0;
  do {
    for (let i = 0; i < calls; i++) fn();
    done += calls;
    elapsed = performance.now() - start;
  } while (elapsed < 100);
  return Math.round((elapsed * 1e6) / done).toLocaleString("en-US") + " ns";
}

for (const [name, text] of texts) {
  let lineCount = 0;
  for (const byte of text) if (byte === 0x0a) lineCount++;
  console.log(`${name} (${lineCount.toLocaleString("en-US")} lines, ${(text.length / 1024).toFixed(0)} KB)`);
  for (const count of [6, 1] as const) {
    const targets = [3, 60, 3_000, lineCount >> 1, lineCount - 2, lineCount * 2].filter(
      (target, i, all) => target < lineCount * 2 + 1 && all.indexOf(target) === i,
    );
    for (const target of targets) {
      const calls = target < 100 ? 2_000 : target < 5_000 ? 200 : 10;
      const label = target > lineCount ? "past the last line" : `line ${target.toLocaleString("en-US")}`;
      console.log(
        `  ${count === 6 ? "code frame" : "lineText  "}  ${label.padEnd(18)}  ${measure(calls, () => indexOfLineRanges(text, target, count)).padStart(14)}`,
      );
    }
  }
}
