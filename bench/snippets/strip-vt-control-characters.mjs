import { stripVTControlCharacters } from "node:util";
import { bench, run } from "../runner.mjs";

const formatter = new Intl.NumberFormat();
const format = n => {
  return formatter.format(n);
};

const inputs = [
  ["hello world", "no-ansi"],
  ["\x1b[31mred\x1b[39m", "ansi"],
  ["\x1b[31mred\x1b[0m plain text", "ansi + text"],
  ["\x1b]8;;https://example.com/\x07link\x1b]8;;\x07", "osc hyperlink"],
  ["a".repeat(1024), "no-ansi"],
  ["a".repeat(1024 * 16), "long-no-ansi"],
  ["\x1b[31mred\x1b[39m".repeat(1024 * 16), "long-ansi"],
  ["☃ hello world", "utf16 no-ansi"],
  ["☃ \x1b[31mred\x1b[39m", "utf16 ansi"],
  ["☃".repeat(1024 * 16), "utf16 long-no-ansi"],
  ["☃\x1b[31mred\x1b[39m".repeat(1024 * 16), "utf16 long-ansi"],
];

const maxInputLength = Math.max(...inputs.map(([input]) => input.length));

for (const [input, textLabel] of inputs) {
  const name = `${format(input.length).padStart(format(maxInputLength).length, " ")} chars ${textLabel}`;

  bench(name, () => {
    stripVTControlCharacters(input);
  });
}

await run();
