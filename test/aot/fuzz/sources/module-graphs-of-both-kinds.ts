import { program } from "../generators/module-graphs-of-both-kinds";
import { family } from "../family";

//   bun -e 'const p = require("./test/aot/fuzz/generators/module-graphs-of-both-kinds").program(7); console.log(p.notes, p.files, p.text)'    shows the graph of a seed

// The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
const plainEnv = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

// `bun run` is not through with these in forty seconds.
const nothingToCompareWith = new Set<number>([72, 143, 147, 286, 327, 387, 399, 447]);

// Where the lines of the executable are not those of `bun run` today. The programs are built and run all the same.
const departing: Record<string, number[]> = {
  "a CommonJS module that threw is asked for again, and an executable throws the same error": [75, 284, 576],
  // programs/modules/a-commonjs-file-requires-the-entry-point-while-its-graph-is-loaded-and-runs-to-its-end is this graph, with its lines.
  "a CommonJS file requires the entry point, which the loader has fetched and not yet run, and require() returns it": [
    124,
  ],
};
const howItDeparts = new Map(
  Object.entries(departing).flatMap(([how, seeds]) => seeds.map(seed => [seed, how] as const)),
);

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

export default family("module graphs of both kinds", [
  ...Array.from({ length: 600 }, (_, index) => index + 1)
    .filter(seed => !nothingToCompareWith.has(seed))
    .map(seed => ({
      name: `seed ${seed}`,
      linesDepartToday: howItDeparts.get(seed),
      plainEnv,
      make: () => program(seed),
    })),
  ...firstImportIsMadeLong.map(seed => ({
    name: `seed ${seed}, the file that is imported first is long`,
    plainEnv,
    make: () => withALongFirstImport(seed),
  })),
]);
