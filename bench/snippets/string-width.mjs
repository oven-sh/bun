import npmStringWidth from "string-width";
import { bench, run } from "../runner.mjs";

const bunStringWidth = globalThis?.Bun?.stringWidth;
const formatter = new Intl.NumberFormat();
const format = n => {
  return formatter.format(n);
};

const ESC = "\x1b";
const ST = "\x1b\\"; // 7-bit String Terminator (ESC + backslash)
const C1_ST = "\x9c"; // 8-bit C1 String Terminator
const URL = "https://github.com/oven-sh/bun/blob/main/src/jsc/bindings/ANSIHelpers.h";

// Each input: [content, label, opts?]. opts.skipMismatchCheck=true skips ONLY
// the cross-impl correctness check (still benchmarks both bun and npm) — for
// OSC variants where npm string-width's ansi-regex only recognizes BEL
// terminators (not ESC \\ ST or C1 0x9C), so npm gives wrong widths and the
// check would throw. The npm bench numbers are still useful for perf comparison
// even when its output is wrong.
const inputs = [
  // ── Latin-1 (8-bit) path: visibleLatin1Width / visibleLatin1WidthExcludeANSIColors ──

  // No escapes — visibleLatin1Width SIMD width count.
  ["hello", "ascii"],

  // Short SGR — exercises the ESC scan + per-byte CSI parse for a 5-byte body.
  [`${ESC}[31mhello${ESC}[0m`, "short-sgr"],

  // Truecolor SGR — long CSI body (`38;2;255;128;64m`, ~17 bytes) → SIMD CSI scan win.
  [`${ESC}[38;2;255;128;64mhello${ESC}[39m`, "truecolor"],

  // Hyperlink (OSC 8) — long opaque OSC payload → SIMD multi-target scan win.
  // Three terminator variants exercise each branch in the OSC scan path:
  //   BEL (0x07): single-byte fast path, both bun and npm handle it.
  //   ESC \\ (7-bit ST): SIMD finds ESC, then peeks next byte. npm doesn't recognize it.
  //   C1 ST (0x9C): single-byte path. npm doesn't recognize it.
  [`${ESC}]8;;${URL}\x07Bun${ESC}]8;;\x07`, "hyperlink-bel"],
  [`${ESC}]8;;${URL}${ST}Bun${ESC}]8;;${ST}`, "hyperlink-st", { skipMismatchCheck: true }],
  [`${ESC}]8;;${URL}${C1_ST}Bun${ESC}]8;;${C1_ST}`, "hyperlink-c1st", { skipMismatchCheck: true }],

  // Bash-style dense SGR — many short escapes per word, exercises per-escape dispatch.
  [`${ESC}[31mword${ESC}[0m ${ESC}[32mword${ESC}[0m ${ESC}[33mword${ESC}[0m`, "dense-sgr"],

  // ── UTF-16 (16-bit) path: visibleUTF16WidthFn ──

  // ASCII + emoji (no escapes) — countPrintableAscii16 fast path + per-codepoint emoji.
  ["hello😀world", "emoji"],

  // ASCII + escapes + emoji — exercises the UTF-16 escape state machine.
  [`${ESC}[31mhello${ESC}[0m😀${ESC}[32mworld${ESC}[0m`, "ansi+emoji"],

  // Hyperlink + emoji — long OSC payload in a UTF-16 string. Same three
  // terminator variants as the Latin-1 hyperlink to exercise the UTF-16
  // scanLaneAnyOf<u16> path. The C1 ST variant tests that 0x9C is correctly
  // recognized as a single-byte OSC terminator in UTF-16 strings — see the
  // non-ASCII codepoint OSC handler in visibleUTF16WidthFn (0x9C > 127, so it
  // appears in the non-ASCII codepoint path, not the per-codepoint ASCII loop).
  [`${ESC}]8;;${URL}\x07😀${ESC}]8;;\x07`, "hyperlnk+emoji-bel"],
  [`${ESC}]8;;${URL}${ST}😀${ESC}]8;;${ST}`, "hyperlnk+emoji-st", { skipMismatchCheck: true }],
  [`${ESC}]8;;${URL}${C1_ST}😀${ESC}]8;;${C1_ST}`, "hyperlnk+emoji-c1st", { skipMismatchCheck: true }],

  // Pure CJK — full-width chars, EAW lookup per codepoint.
  ["こんにちは世界", "cjk"],
];

const repeatCounts = [1, 10, 100, 1000, 5000];

const maxInputLength = Math.max(...inputs.map(([input]) => input.repeat(Math.max(...repeatCounts)).length));

for (const [input, textLabel, opts = {}] of inputs) {
  for (let repeatCount of repeatCounts) {
    const str = input.repeat(repeatCount);
    const sizeLabel = format(str.length).padStart(format(maxInputLength).length, " ");
    const suffix = `${textLabel} ${sizeLabel}`;

    if (bunStringWidth) {
      bench(`bun ${suffix}`, () => {
        bunStringWidth(str);
      });

      // Skip the cross-impl correctness check for OSC variants where npm
      // string-width is known to give wrong widths (non-BEL terminators).
      if (!opts.skipMismatchCheck && bunStringWidth(str) !== npmStringWidth(str)) {
        throw new Error(
          `string-width mismatch (${textLabel}, repeat=${repeatCount}): bun=${bunStringWidth(str)} npm=${npmStringWidth(str)}`,
        );
      }
    }

    bench(`npm ${suffix}`, () => {
      npmStringWidth(str);
    });
  }
}

await run();
