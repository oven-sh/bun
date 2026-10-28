// Fixed seeds of fuzz/lists-made-of-what-is-walked-and-used-on-a-rare-path.ts: a list made of what a function was handed holds what it
// holds in plain Bun, also where the compiler is allowed little work to find out where the list goes.
import { generate } from "./fuzz/lists-made-of-what-is-walked-and-used-on-a-rare-path";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true },
});
const littleWork = [0, 1, 2, 10].map(work => [`--aot-limit=MaxEscapeAnalysisWork:${work}`, "--aot-verify-each-pass"]);

// Every run takes these, whatever else it takes.
const onceWrong = [10, 32, 34, 38, 100, 108, 112, 148, 160];

generated(
  "a list made of what is walked holds what it holds in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: index % 2 === 1 ? littleWork[(index >> 1) % 4] : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
