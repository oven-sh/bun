// Fixed seeds of fuzz/modules-required-while-imports-load-them.ts: several `import()` calls, started in different jobs, load graphs of ES modules that share files, and `require()` asks for one of
// those files meanwhile. Each seed comes with and without a shared module that awaits.
import { generate } from "./fuzz/modules-required-while-imports-load-them";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "modules required while imports load them",
  Array.from({ length: 600 }, (_, index) =>
    [false, true].map(awaits => {
      const make = () => generate(new Random(index + 1), { awaits });
      return {
        name: `seed ${index + 1}${awaits ? ", a module awaits" : ""}.`,
        // Every run takes a quarter of these; AOT_GENERATED=all takes all.
        isAlwaysRun: awaits ? index < 120 : index < 480,
        isOnlyCompiled: true as const,
        // Nothing is put into the text: one more job would change which step of a load a call meets.
        keepsItsText: true as const,
        // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
        plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
        // Where nothing awaits, require() returns the module in every turn (docs/compiler/compatibility.mdx).
        written: awaits ? undefined : make().answers,
        make,
      };
    }),
  ).flat(),
);
