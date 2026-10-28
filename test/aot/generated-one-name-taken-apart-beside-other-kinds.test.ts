// Fixed seeds of fuzz/one-name-taken-apart-beside-other-kinds.ts: what a pattern, a spread or a loop takes out of a thing is what plain Bun
// takes out of it, whatever else the program stores under the same name.
import { generate } from "./fuzz/one-name-taken-apart-beside-other-kinds";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true },
});

// Every run takes these, whatever else it takes.
const onceWrong = [166];

generated(
  "a thing is taken apart as in plain Bun whatever else its name holds",
  Array.from({ length: 480 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags:
      index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
