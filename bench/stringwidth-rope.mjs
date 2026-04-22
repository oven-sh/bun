// Microbenchmark for PR #29543: Bun.stringWidth rope fast path.
// Each iteration builds a FRESH rope so the baseline (which flattens via
// JSString::value()) pays the resolve cost every time. Rope construction is
// identical across baseline and PR; the delta is resolve-vs-iterate.
import { bench, group, run } from "./runner.mjs";

const sw = Bun.stringWidth;
let sink = 0;

// makeRope(chunk, n): n leaf fibers of `chunk` joined by `+`.
function makeRope(chunk, n) {
  let s = "";
  for (let i = 0; i < n; i++) s += chunk;
  return s;
}

// Vary fiber SIZE × COUNT so total length is held ~constant per group.
// Small fibers stress per-fiber callback overhead; large fibers amortize it.
for (const [fiberLen, fibers] of [
  [8, 1024], // 8 KB total, 1024 tiny fibers — should BAIL (avg 8 < 48)
  [32, 256], // 8 KB total, 256 fibers — should BAIL (avg 32 < 48)
  [64, 128], // 8 KB total, 128 fibers — fast path (avg 64 >= 48)
  [512, 16], // 8 KB total, 16 fibers — fast path
  [4096, 2], // 8 KB total, 2 fibers — fast path
]) {
  const chunk = "a".repeat(fiberLen);
  // Force `chunk` to be flat (repeat returns a rope in JSC) so each rope leaf
  // is a single contiguous fiber, not a nested rope. Any toString-ish path
  // that resolves works; charCodeAt forces it.
  chunk.charCodeAt(chunk.length - 1);
  group(`8KB rope: ${fibers} fibers × ${fiberLen}B`, () => {
    bench("countAnsi=true", () => {
      sink += sw(makeRope(chunk, fibers), { countAnsiEscapeCodes: true });
    });
    bench("countAnsi=false (default, no ESC)", () => {
      sink += sw(makeRope(chunk, fibers));
    });
  });
}

group("short rope (< minLengthForRopeWalk=296) — should resolve", () => {
  const chunk = "abcdefghij";
  bench("20 fibers × 10B = 200 chars", () => {
    sink += sw(makeRope(chunk, 20), { countAnsiEscapeCodes: true });
  });
});

group("control: truly flat 8-bit string (pre-resolved)", () => {
  const flat = "a".repeat(8192);
  flat.charCodeAt(0); // resolve
  bench("countAnsi=true", () => {
    sink += sw(flat, { countAnsiEscapeCodes: true });
  });
});

group("fallback paths (should be ~unchanged)", () => {
  const escChunk = "abc\x1b[31mde";
  bench("8-bit rope w/ ESC, countAnsi=false → resolve", () => {
    sink += sw(makeRope(escChunk, 128));
  });
  const u16Chunk = "abcde😀";
  bench("16-bit rope (emoji) → resolve", () => {
    sink += sw(makeRope(u16Chunk, 128));
  });
});

await run();
if (sink === 0.5) console.log(sink);
