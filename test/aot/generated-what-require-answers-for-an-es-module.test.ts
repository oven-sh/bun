// Fixed seeds of fuzz/what-require-answers-for-an-es-module.ts: a CommonJS file requires an ES module that exports names, a default, an export named `__esModule` or "module.exports", a star over another file,
// or nothing, straight or through the helpers that TypeScript, Babel and esbuild put around `require`, and prints what it got: its kind, its keys, its members, what a store, a new member and a removal do to it, and what it shows behind
// a change in the module. The executable prints what plain Bun prints and ends as it ends.
import { Random } from "./fuzz/random";
import { corners, generate } from "./fuzz/what-require-answers-for-an-es-module";
import { generated } from "./generated/run-generated";

generated(
  "what require answers for an ES module",
  Array.from({ length: corners.length * 20 }, (_, index) => {
    const corner = corners[index % corners.length];
    return {
      name: `seed ${index + 1}, ${corner}.`,
      // Every run takes one seed of each corner; AOT_GENERATED=all takes all.
      isAlwaysRun: index < corners.length,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: one more importer of the module would be one more road to it.
      keepsItsText: true as const,
      exitsAsPlainBunDoes: true as const,
      make: () => generate(new Random(index + 1), corner),
    };
  }),
);
