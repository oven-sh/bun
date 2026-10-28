// Fixed seeds of fuzz/very-many-values-alive-across-very-many-blocks.ts: one function holds thousands of values at once, each read in a block
// of its own and used far from where it was made. The build ends and the executable prints the sums that plain Bun prints. Every second
// seed is TypeScript.
import { isASAN, isDebug } from "harness";
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/very-many-values-alive-across-very-many-blocks";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true },
});

// Every run takes these, whatever else it takes.
const onceWrong = [6, 14];

generated(
  "very many values stay alive across very many blocks",
  // A sanitizer or debug build compiles such a function many times slower.
  Array.from({ length: isASAN || isDebug ? 0 : 32 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: false,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    make: () =>
      (index + 1) % 2 === 1
        ? { file: "main.ts", text: generate(new Random(index + 1), true), files: { "tsconfig.json": tsconfig } }
        : { file: "main.js", text: generate(new Random(index + 1), false) },
  })),
);
