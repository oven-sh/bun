// Fixed seeds of fuzz/members-of-built-in-objects-handed-around.ts: a built-in object or function that was copied, or handed through a
// Proxy, a reviver, Reflect, a collection or a closure, has the members it has in plain Bun. Every second seed is TypeScript.
import { generate } from "./fuzz/members-of-built-in-objects-handed-around";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: ["bun-types"],
  },
});

// These walk a module of Node.js that has getters among its members, after it came out of a reviver or a Proxy.
const walksAModuleFromAReviver = [104, 143];

// Every run takes these, whatever else it takes.
const onceWrong = [57, 63, 81, 140];

generated(
  "built-in objects keep their members wherever they are handed",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-validate"] : [],
    ...(walksAModuleFromAReviver.includes(index + 1)
      ? { failsToday: "a walk over a module that came out of a reviver" }
      : {}),
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.mjs",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
