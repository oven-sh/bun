// A list of programs from ../generators/mixed-module-graphs.ts, which describes them.
import { program } from "../generators/mixed-module-graphs";
import { family } from "../family";

//   bun -e 'const p = require("./test/aot/fuzz/generators/mixed-module-graphs").program(7); console.log(p.notes, p.files, p.text)'    prints the graph of a seed

// Plain Bun transpiles on one thread here, so files are read in request order. An executable reads no files.
const plainEnv = { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

// `bun run` does not finish these in forty seconds.
const nothingToCompareWith = new Set<number>([72, 143, 147, 286, 327, 387, 399, 447]);

// Seeds whose output differs from `bun run` today.
const departing: Record<string, number[]> = {
  "a CommonJS module that threw is required again, and an executable throws the same error": [75, 284],
  "a CommonJS file requires the entry point, which is fetched but not yet evaluated, and require() returns it": [124],
};
const howItDeparts = new Map(
  Object.entries(departing).flatMap(([how, seeds]) => seeds.map(seed => [seed, how] as const)),
);

// An ES module imports two CommonJS files, and the first one is made very long.
const firstImportIsMadeLong = [11, 92, 155, 323, 544];
function withALongFirstImport(seed: number) {
  const graph = program(seed);
  const first = Object.keys(graph.files).find(name => name.startsWith("m1."))!;
  return {
    ...graph,
    files: { ...graph.files, [first]: `${graph.files[first]}/*\n${"nothing is said here\n".repeat(1_000_000)}*/\n` },
  };
}

export default family("mixed module graphs", [
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
