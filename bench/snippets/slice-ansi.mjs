// Compares Bun.sliceAnsi against npm slice-ansi and cli-truncate.
// Bun.sliceAnsi replaces both packages with one function:
//   slice-ansi  →  Bun.sliceAnsi(s, start, end)
//   cli-truncate → Bun.sliceAnsi(s, 0, max, ellipsis) / Bun.sliceAnsi(s, -max, undefined, ellipsis)

import npmCliTruncate from "cli-truncate";
import npmSliceAnsi from "slice-ansi";
import { bench, run, summary } from "../runner.mjs";

// Under Node (or any runtime without Bun.sliceAnsi), we only run the npm side
// of each pair — no point benching npm against itself. Under Bun with
// FORCE_NPM=1, we still run both to measure the npm impl cost under JSC.
const hasBunSliceAnsi = typeof Bun !== "undefined" && typeof Bun.sliceAnsi === "function";
const useBun = hasBunSliceAnsi && !process.env.FORCE_NPM;

// `maybeBench` registers the Bun-side bench only when useBun is true, so under
// Node each summary() collapses to a single npm entry with no false "1.0x" noise.
const maybeBench = useBun ? bench : () => {};

if (hasBunSliceAnsi) {
  console.log(`[slice-ansi bench] ${useBun ? "Bun.sliceAnsi vs npm" : "npm-only (FORCE_NPM=1)"}\n`);
} else {
  console.log(`[slice-ansi bench] Bun.sliceAnsi unavailable — running npm-only\n`);
}

// Wrappers so the call site stays monomorphic:
const bunSlice = useBun ? Bun.sliceAnsi : () => {};
const bunTruncEnd = useBun ? (s, n, e) => Bun.sliceAnsi(s, 0, n, e) : () => {};
const bunTruncStart = useBun ? (s, n, e) => Bun.sliceAnsi(s, -n, undefined, e) : () => {};

// ============================================================================
// Fixtures — cover the tiers of Bun.sliceAnsi's dispatch:
//   1. Pure ASCII → SIMD fast path (direct substring)
//   2. ASCII + ANSI → single-pass streaming emit with bulk-ASCII runs
//   3. CJK / emoji → per-char width, inline grapheme tracking
//   4. ZWJ emoji / combining marks → clustering path
// ============================================================================

const red = s => `\x1b[31m${s}\x1b[39m`;
const green = s => `\x1b[32m${s}\x1b[39m`;
const bold = s => `\x1b[1m${s}\x1b[22m`;
const truecolor = (r, g, b, s) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
const link = (url, s) => `\x1b]8;;${url}\x07${s}\x1b]8;;\x07`;

// Tier 1: pure ASCII (SIMD fast path)
const asciiShort = "The quick brown fox jumps over the lazy dog.";
const asciiLong = "The quick brown fox jumps over the lazy dog. ".repeat(100);

// Tier 2: ASCII + ANSI codes (streaming + bulk-ASCII emit)
const ansiShort = `The ${red("quick")} ${green("brown")} fox ${bold("jumps")} over the lazy dog.`;
const ansiMedium =
  `The ${red("quick brown fox")} jumps ${green("over the lazy dog")} and ${bold("runs away")}. `.repeat(10);
const ansiLong = `The ${red("quick brown fox")} jumps ${green("over the lazy dog")} and ${bold("runs away")}. `.repeat(
  100,
);
// Dense ANSI: SGR between every few chars (stresses pending buffer)
const ansiDense = `${red("ab")}${green("cd")}${bold("ef")}${truecolor(255, 128, 64, "gh")}`.repeat(50);

// Tier 3: CJK (width 2, no clustering)
const cjk = "日本語のテキストをスライスするテストです。全角文字は幅2としてカウントされます。".repeat(10);
const cjkAnsi = red("日本語のテキストを") + green("スライスするテスト") + "です。".repeat(10);

// Tier 4: grapheme clustering
const emoji = "Hello 👋 World 🌍! Test 🧪 emoji 😀 slicing 📦!".repeat(10);
// ZWJ family emoji — worst case for clustering (4 codepoints + 3 ZWJ per cluster)
const zwj = "Family: 👨‍👩‍👧‍👦 and 👩‍💻 technologist! ".repeat(20);
// Skin tone modifiers
const skinTone = "Wave 👋🏽 handshake 🤝🏻 thumbs 👍🏿 ok 👌🏼!".repeat(20);
// Combining marks (café → c-a-f-e + ́)
const combining = "cafe\u0301 re\u0301sume\u0301 na\u0131\u0308ve pi\u00f1ata ".repeat(30);

// Hyperlinks (OSC 8)
const hyperlinks = link("https://bun.sh", "Check out Bun, it's fast! ").repeat(20);

// ============================================================================
// Slice benchmarks (vs slice-ansi)
// ============================================================================

// Tier 1: pure ASCII — Bun's SIMD fast path should be near-memcpy.
summary(() => {
  bench("ascii-short [0,20) — npm slice-ansi", () => npmSliceAnsi(asciiShort, 0, 20));
  maybeBench("ascii-short [0,20) — Bun.sliceAnsi ", () => bunSlice(asciiShort, 0, 20));
});

summary(() => {
  bench("ascii-long [0,1000) — npm slice-ansi", () => npmSliceAnsi(asciiLong, 0, 1000));
  maybeBench("ascii-long [0,1000) — Bun.sliceAnsi ", () => bunSlice(asciiLong, 0, 1000));
});

// Zero-copy case: slice covers whole string. Bun returns the input JSString.
summary(() => {
  bench("ascii-long no-op (whole string) — npm slice-ansi", () => npmSliceAnsi(asciiLong, 0));
  maybeBench("ascii-long no-op (whole string) — Bun.sliceAnsi ", () => bunSlice(asciiLong, 0));
});

// Tier 2: ANSI — Bun's bulk-ASCII-run emit vs npm's per-token walk.
summary(() => {
  bench("ansi-short [0,30) — npm slice-ansi", () => npmSliceAnsi(ansiShort, 0, 30));
  maybeBench("ansi-short [0,30) — Bun.sliceAnsi ", () => bunSlice(ansiShort, 0, 30));
});

summary(() => {
  bench("ansi-medium [10,200) — npm slice-ansi", () => npmSliceAnsi(ansiMedium, 10, 200));
  maybeBench("ansi-medium [10,200) — Bun.sliceAnsi ", () => bunSlice(ansiMedium, 10, 200));
});

summary(() => {
  bench("ansi-long [0,2000) — npm slice-ansi", () => npmSliceAnsi(ansiLong, 0, 2000));
  maybeBench("ansi-long [0,2000) — Bun.sliceAnsi ", () => bunSlice(ansiLong, 0, 2000));
});

summary(() => {
  bench("ansi-dense (SGR every 2 chars) — npm slice-ansi", () => npmSliceAnsi(ansiDense, 0, 100));
  maybeBench("ansi-dense (SGR every 2 chars) — Bun.sliceAnsi ", () => bunSlice(ansiDense, 0, 100));
});

// Tier 3: CJK (width 2, no clustering)
summary(() => {
  bench("cjk [0,100) — npm slice-ansi", () => npmSliceAnsi(cjk, 0, 100));
  maybeBench("cjk [0,100) — Bun.sliceAnsi ", () => bunSlice(cjk, 0, 100));
});

summary(() => {
  bench("cjk+ansi [0,100) — npm slice-ansi", () => npmSliceAnsi(cjkAnsi, 0, 100));
  maybeBench("cjk+ansi [0,100) — Bun.sliceAnsi ", () => bunSlice(cjkAnsi, 0, 100));
});

// Tier 4: grapheme clustering
summary(() => {
  bench("emoji [0,100) — npm slice-ansi", () => npmSliceAnsi(emoji, 0, 100));
  maybeBench("emoji [0,100) — Bun.sliceAnsi ", () => bunSlice(emoji, 0, 100));
});

summary(() => {
  bench("zwj-family [0,100) — npm slice-ansi", () => npmSliceAnsi(zwj, 0, 100));
  maybeBench("zwj-family [0,100) — Bun.sliceAnsi ", () => bunSlice(zwj, 0, 100));
});

summary(() => {
  bench("skin-tone [0,100) — npm slice-ansi", () => npmSliceAnsi(skinTone, 0, 100));
  maybeBench("skin-tone [0,100) — Bun.sliceAnsi ", () => bunSlice(skinTone, 0, 100));
});

summary(() => {
  bench("combining-marks [0,100) — npm slice-ansi", () => npmSliceAnsi(combining, 0, 100));
  maybeBench("combining-marks [0,100) — Bun.sliceAnsi ", () => bunSlice(combining, 0, 100));
});

// OSC 8 hyperlinks
summary(() => {
  bench("hyperlinks [0,100) — npm slice-ansi", () => npmSliceAnsi(hyperlinks, 0, 100));
  maybeBench("hyperlinks [0,100) — Bun.sliceAnsi ", () => bunSlice(hyperlinks, 0, 100));
});

// ============================================================================
// Truncate benchmarks (vs cli-truncate)
// ============================================================================

// cli-truncate internally calls slice-ansi, so Bun should win by a similar
// margin. The interesting comparison is the lazy-cutEnd speculative zone vs
// cli-truncate's eager stringWidth pre-pass.

summary(() => {
  bench("truncate-end ascii-short — npm cli-truncate", () => npmCliTruncate(asciiShort, 20));
  maybeBench("truncate-end ascii-short — Bun.sliceAnsi   ", () => bunTruncEnd(asciiShort, 20, "…"));
});

summary(() => {
  bench("truncate-end ansi-long — npm cli-truncate", () => npmCliTruncate(ansiLong, 200));
  maybeBench("truncate-end ansi-long — Bun.sliceAnsi   ", () => bunTruncEnd(ansiLong, 200, "…"));
});

summary(() => {
  bench("truncate-start ansi-long — npm cli-truncate", () => npmCliTruncate(ansiLong, 200, { position: "start" }));
  // Negative index → Bun's 2-pass path (computeTotalWidth pre-pass).
  maybeBench("truncate-start ansi-long — Bun.sliceAnsi   ", () => bunTruncStart(ansiLong, 200, "…"));
});

summary(() => {
  bench("truncate-end emoji — npm cli-truncate", () => npmCliTruncate(emoji, 50));
  maybeBench("truncate-end emoji — Bun.sliceAnsi   ", () => bunTruncEnd(emoji, 50, "…"));
});

// No-cut case: string already fits. cli-truncate calls stringWidth + early returns.
// Bun's lazy cutEnd detection means it walks once but detects no cut at EOF.
summary(() => {
  bench("truncate no-cut (fits) — npm cli-truncate", () => npmCliTruncate(asciiShort, 100));
  maybeBench("truncate no-cut (fits) — Bun.sliceAnsi   ", () => bunTruncEnd(asciiShort, 100, "…"));
});

// ============================================================================
// Real-world: ink-style viewport clipping (hot path for terminal UI rendering)
// ============================================================================

// Simulates ink's output.ts sliceAnsi(line, from, to) call in the render loop.
// Each line is colored and gets clipped to the viewport width.
const logLine = `${bold("[2024-01-15 12:34:56]")} ${red("ERROR")} Connection to ${link("https://api.example.com", "api.example.com")} timed out after 30s (attempt 3/5)`;

summary(() => {
  bench("ink-clip (80-col viewport) — npm slice-ansi", () => npmSliceAnsi(logLine, 0, 80));
  maybeBench("ink-clip (80-col viewport) — Bun.sliceAnsi ", () => bunSlice(logLine, 0, 80));
});

// ============================================================================
// Correctness spot-check (fail fast if results diverge on simple cases)
// ============================================================================

if (useBun) {
  const checks = [
    [asciiShort, 0, 20],
    [ansiShort, 5, 30],
    [cjk, 0, 50],
  ];
  for (const [s, a, b] of checks) {
    // slice-ansi and Bun.sliceAnsi may differ in exact ANSI byte ordering for
    // close codes, but stripped visible content should match.
    const npm = npmSliceAnsi(s, a, b).replace(/\x1b\[[\d;]*m/g, "");
    const bun = bunSlice(s, a, b).replace(/\x1b\[[\d;]*m/g, "");
    if (npm !== bun) {
      throw new Error(
        `Correctness check failed for [${a},${b}): npm=${JSON.stringify(npm)} bun=${JSON.stringify(bun)}`,
      );
    }
  }
}

await run();
