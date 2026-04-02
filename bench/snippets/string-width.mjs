import npmStringWidth from "string-width";
import { bench, run } from "../runner.mjs";

const bunStringWidth = globalThis?.Bun?.stringWidth;
const formatter = new Intl.NumberFormat();
const format = n => {
  return formatter.format(n);
};

const ESC = "\x1b";
const URL = "https://github.com/oven-sh/bun/blob/main/src/bun.js/bindings/ANSIHelpers.h";

const inputs = [
  // ── Latin-1 (8-bit) path: visibleLatin1Width / visibleLatin1WidthExcludeANSIColors ──

  // No escapes — visibleLatin1Width SIMD width count.
  ["hello", "ascii"],

  // Short SGR — exercises the ESC scan + per-byte CSI parse for a 5-byte body.
  [`${ESC}[31mhello${ESC}[0m`, "short-sgr"],

  // Truecolor SGR — long CSI body (`38;2;255;128;64m`, ~17 bytes) → SIMD CSI scan win.
  [`${ESC}[38;2;255;128;64mhello${ESC}[39m`, "truecolor"],

  // Hyperlink (OSC 8) — long opaque OSC payload → SIMD multi-target scan win.
  [`${ESC}]8;;${URL}\x07Bun${ESC}]8;;\x07`, "hyperlink"],

  // Bash-style dense SGR — many short escapes per word, exercises per-escape dispatch.
  [`${ESC}[31mword${ESC}[0m ${ESC}[32mword${ESC}[0m ${ESC}[33mword${ESC}[0m`, "dense-sgr"],

  // ── UTF-16 (16-bit) path: visibleUTF16WidthFn ──

  // ASCII + emoji (no escapes) — countPrintableAscii16 fast path + per-codepoint emoji.
  ["hello😀world", "emoji"],

  // ASCII + escapes + emoji — exercises the UTF-16 escape state machine.
  [`${ESC}[31mhello${ESC}[0m😀${ESC}[32mworld${ESC}[0m`, "ansi+emoji"],

  // Hyperlink + emoji — long OSC payload in a UTF-16 string.
  [`${ESC}]8;;${URL}\x07😀${ESC}]8;;\x07`, "hyperlink+emoji"],

  // Pure CJK — full-width chars, EAW lookup per codepoint.
  ["こんにちは世界", "cjk"],
];

const repeatCounts = [1, 10, 100, 1000, 5000];

const maxInputLength = Math.max(...inputs.map(([input]) => input.repeat(Math.max(...repeatCounts)).length));

for (const [input, textLabel] of inputs) {
  for (let repeatCount of repeatCounts) {
    const str = input.repeat(repeatCount);
    const sizeLabel = format(str.length).padStart(format(maxInputLength).length, " ");
    const suffix = `${textLabel} ${sizeLabel}`;

    if (bunStringWidth) {
      bench(`bun ${suffix}`, () => {
        bunStringWidth(str);
      });

      if (bunStringWidth(str) !== npmStringWidth(str)) {
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
