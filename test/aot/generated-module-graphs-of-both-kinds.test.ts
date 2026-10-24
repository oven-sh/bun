import { program } from "./generated/module-graphs-of-both-kinds";
import { generated } from "./generated/run-generated";

//   bun -e 'const p = require("./test/aot/generated/module-graphs-of-both-kinds").program(7); console.log(p.notes, p.files, p.text)'    shows the graph of a seed

// The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
const plainEnv = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

// `bun run` is not through with these in forty seconds.
const nothingToCompareWith = new Set<number>([72, 143, 147, 286, 327, 387, 399, 447]);

// Where the lines of the executable are not those of `bun run` today. The programs are built and run all the same.
const departing: Record<string, number[]> = {
  "require() of an ES module that awaits throws at once, and `bun run` waits for the module": [
    5, 45, 46, 49, 57, 71, 75, 113, 120, 121, 133, 160, 185, 195, 240, 258, 274, 282, 284, 306, 319, 367, 380, 412, 481,
    509, 512, 524, 537, 573, 576, 592,
  ],
  "the importers above an ES module that an imported CommonJS file requires run behind that file, and under `bun run` inside the require":
    [16, 166, 234, 263, 264, 310, 423, 478],
  "an `import()` that nobody awaits runs its target in another turn": [
    88, 152, 196, 242, 256, 377, 378, 416, 420, 431, 483, 501,
  ],
  "a CommonJS file that an imported ES module imports runs ahead of the one that is imported behind that module, and under `bun run` behind it":
    [141],
  "an ES module imports a name that a CommonJS entry point has not stored yet, and the executable throws a SyntaxError":
    [55, 112, 148, 212, 384, 489, 582],
  "not looked at yet": [
    35, 61, 77, 89, 91, 124, 131, 208, 213, 246, 260, 269, 276, 289, 364, 368, 376, 382, 391, 410, 499, 507, 522, 564,
    584,
  ],
};
const howItDeparts = new Map(
  Object.entries(departing).flatMap(([how, seeds]) => seeds.map(seed => [seed, how] as const)),
);

// An imported CommonJS file requires an ES module that takes the file's default as a whole or hands on all its names.
const onceWrong = new Set<number>([
  11, 23, 54, 57, 83, 89, 90, 92, 151, 155, 158, 189, 195, 197, 233, 234, 260, 323, 355, 386, 428, 478, 482, 497, 544,
  560, 567, 576, 580,
]);

// An ES module imports two CommonJS files, and the text of the first is made long.
const firstImportIsMadeLong = [11, 92, 155, 323, 544];
function withALongFirstImport(seed: number) {
  const graph = program(seed);
  const first = Object.keys(graph.files).find(name => name.startsWith("m1."))!;
  return {
    ...graph,
    files: { ...graph.files, [first]: `${graph.files[first]}/*\n${"nothing is said here\n".repeat(1_000_000)}*/\n` },
  };
}

generated("module graphs of both kinds", [
  ...Array.from({ length: 600 }, (_, index) => index + 1)
    .filter(seed => !nothingToCompareWith.has(seed))
    .map(seed => ({
      name: `seed ${seed}`,
      isAlwaysRun: seed <= 48,
      wasOnceWrong: onceWrong.has(seed),
      isOnlyCompiled: true as const,
      exitsAsPlainBunDoes: true as const,
      linesDepartToday: howItDeparts.get(seed),
      plainEnv,
      make: () => program(seed),
    })),
  ...firstImportIsMadeLong.map(seed => ({
    name: `seed ${seed}, the file that is imported first is long`,
    isAlwaysRun: false,
    wasOnceWrong: true,
    isOnlyCompiled: true as const,
    exitsAsPlainBunDoes: true as const,
    plainEnv,
    make: () => withALongFirstImport(seed),
  })),
]);
