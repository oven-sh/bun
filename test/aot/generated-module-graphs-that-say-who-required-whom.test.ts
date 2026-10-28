// The graphs of generated/module-graphs-of-both-kinds.ts, where each CommonJS file also says which id it has, who its parent is and who its children are.
//
//   bun -e 'const g = require("./test/aot/generated/module-graphs-of-both-kinds"); const p = g.sayingWhoRequiredWhom(g.program(7)); console.log(p.notes, p.files, p.text)'    shows the graph of a seed
import { hasRequirerOfItsOwn, program, sayingWhoRequiredWhom } from "./generated/module-graphs-of-both-kinds";
import { generated } from "./generated/run-generated";

// `bun run` is not through with these in forty seconds.
const nothingToCompareWith = new Set<number>([72, 143, 147, 286, 327, 387, 399]);

// A `require` that the loader of the run time answers; a file that `import()` is called for; an ES module that is required twice.
const onceWrong = new Set<number>([
  1, 4, 5, 8, 12, 13, 18, 20, 21, 29, 32, 35, 36, 40, 47, 54, 55, 57, 61, 68, 76, 78, 79, 80, 82, 83, 84, 86, 89, 93,
  96, 99, 106, 107, 119, 120, 122, 123, 124, 129, 131, 140, 141, 144, 148, 154, 156, 158, 161, 163, 165, 172, 173, 176,
  184, 188, 191, 194, 196, 198, 202, 221, 222, 233, 234, 235, 241, 244, 247, 250, 251, 253, 261, 264, 269, 270, 272,
  275, 281, 288, 289, 293, 296, 301, 303, 308, 310, 315, 318, 323, 324, 330, 333, 335, 336, 341, 343, 345, 355, 360,
  366, 369, 374, 376, 378, 382, 383, 388,
]);

generated(
  "module graphs that say who required whom",
  Array.from({ length: 400 }, (_, index) => index + 1)
    // The parent that such a function leaves in a file lasts until the next collection under `bun run`, and docs/compiler/compatibility.mdx says whose child the file is.
    .filter(seed => !nothingToCompareWith.has(seed) && !hasRequirerOfItsOwn(program(seed)))
    .map(seed => ({
      name: `seed ${seed}`,
      isAlwaysRun: seed <= 48,
      // A third of them in every run, the others with the rest.
      wasOnceWrong: onceWrong.has(seed) && seed % 3 === 0,
      isOnlyCompiled: true as const,
      exitsAsPlainBunDoes: true as const,
      // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
      plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
      make: () => sayingWhoRequiredWhom(program(seed)),
    })),
);
