// Fixed seeds of fuzz/exports-of-commonjs-files-however-they-are-made-taken-and-used.ts: a CommonJS file makes its exports by stores, by a literal,
// by definitions of values and getters or by the helpers that TypeScript and esbuild write; another module takes them as the default, by name, as a
// namespace, under a key, by `import()`, by `require` or through a module that hands them on, and reads, calls, lists and hands them on.
import { generate } from "./fuzz/exports-of-commonjs-files-however-they-are-made-taken-and-used";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [
  1, 21, 24, 40, 60, 69, 80, 85, 87, 125, 147, 151, 152, 154, 157, 168, 191, 192, 195, 208, 209, 210, 217, 227, 228,
  231, 563, 907,
];
const seeds = [...Array.from({ length: 240 }, (_, index) => index + 1), 563, 907];

generated(
  "exports of CommonJS files are the same however they are made, taken and used",
  seeds.map(seed => ({
    name: `seed ${seed}.`,
    // Every run takes the first eight seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: seed <= 8,
    wasOnceWrong: onceWrong.includes(seed),
    isOnlyCompiled: true as const,
    exitsAsPlainBunDoes: true as const,
    flags: onceWrong.includes(seed)
      ? []
      : seed % 4 === 0
        ? ["--aot-heat=everything-is-hot"]
        : seed % 4 === 3
          ? ["--aot-heat=everything-is-cold"]
          : [],
    make: () => generate(new Random(seed)),
  })),
);
