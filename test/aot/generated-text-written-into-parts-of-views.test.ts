// Fixed seeds of fuzz/text-written-into-parts-of-views.ts: text is encoded into views and into parts of views, while the
// buffers behind them are transferred, resized and collected. Every second seed is TypeScript; every third build validates.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/text-written-into-parts-of-views";
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

generated(
  "text goes into a part of a view as it goes into a view that was made",
  Array.from({ length: 90 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    flags: index % 3 === 0 ? ["--aot-validate"] : index % 3 === 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.js",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
