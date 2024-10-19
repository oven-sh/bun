import npmStringWidth from "string-width";
import { bench, run } from "./runner.mjs";

const bunStringWidth = globalThis?.Bun?.stringWidth;

const stringWidth = bunStringWidth || npmStringWidth;
const formatter = new Intl.NumberFormat();
const format = n => {
  return formatter.format(n);
};

const inputs = [
  ["hello", "ascii"],
  ["[31mhello", "ascii+ansi"],
  ["hello😀", "ascii+emoji"],
  ["[31m😀😀", "ansi+emoji"],
  ["😀hello😀[31m😀😀😀", "ansi+emoji+ascii"],
];

const repeatCounts = [1, 10, 100, 1000, 5000];

const maxInputLength = Math.max(...inputs.map(([input]) => input.repeat(Math.max(...repeatCounts)).length));

for (const [input, textLabel] of inputs) {
  for (let repeatCount of repeatCounts) {
    const label = bunStringWidth ? "Bun.stringWidth" : "npm/string-width";

    const str = input.repeat(repeatCount);
    const name = `${label} ${format(str.length).padStart(format(maxInputLength).length, " ")} chars ${textLabel}`;

    bench(name, () => {
      stringWidth(str);
    });

    if (bunStringWidth && bunStringWidth(str) !== npmStringWidth(str)) {
      throw new Error("string-width mismatch");
    }
  }
}

await run();
