// Transpiler benchmark on type-heavy TypeScript.
//
//   bun transpiler-typescript.mjs
//       mitata run, one benchmark per input group.
//   bun transpiler-typescript.mjs --iterations=20 [--group=<name>]
//       a plain loop that does a fixed amount of work and prints one line per
//       group. Use this form to count instructions, one group per process:
//       BUN_JSC_useJIT=0 valgrind --tool=cachegrind --cache-sim=no --branch-sim=yes \
//         bun-profile transpiler-typescript.mjs --iterations=20 --group=typescript-lib
//
// The groups differ in how much of the input is type syntax that the parser
// drops. Declaration files are almost only that. `js-control` has none: a
// change to the TypeScript paths of the parser must leave its counts alone.
//
// Every input is a file in this repository or in its devDependencies
// (`typescript`, installed by `bun install` in the repository root).
import { Glob } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");

const groups = [
  {
    name: "bun-types",
    loader: "ts",
    dir: "packages/bun-types",
    pattern: "**/*.d.ts",
    // `declare module "*" with { type: "text" }` is TypeScript 7.1 syntax that the parser rejects.
    skip: ["ts7.1/import-attributes.d.ts"],
  },
  { name: "typescript-lib", loader: "ts", dir: "node_modules/typescript/lib", pattern: "lib*.d.ts" },
  { name: "src-js", loader: "ts", dir: "src/js", pattern: "**/*.ts" },
  // One small file. `repeat` brings its share of a run near the other groups.
  { name: "tsx", loader: "tsx", dir: "bench/snippets", pattern: "transpiler-typescript-fixture.tsx", repeat: 100 },
  { name: "js-control", loader: "js", dir: "bench/react-hello-world", pattern: "react-hello-world.node.js" },
];

function load(group) {
  const dir = join(root, group.dir);
  if (!existsSync(dir)) {
    throw new Error(`${group.name}: ${group.dir} does not exist. Run \`bun install\` in the repository root.`);
  }
  const skip = new Set(group.skip ?? []);
  const paths = [...new Glob(group.pattern).scanSync({ cwd: dir })]
    .map(path => path.replaceAll("\\", "/"))
    .filter(path => !path.includes("node_modules/") && !skip.has(path))
    .sort();
  if (paths.length === 0) throw new Error(`${group.name}: no file matches ${group.dir}/${group.pattern}`);
  const sources = paths.map(path => readFileSync(join(dir, path), "utf8"));
  return {
    ...group,
    paths,
    sources,
    bytes: sources.reduce((sum, source) => sum + Buffer.byteLength(source), 0),
    transpiler: new Bun.Transpiler({ loader: group.loader }),
  };
}

// Returns the output size of one pass over the group.
function transformAll(input) {
  let bytes = 0;
  for (let pass = input.repeat ?? 1; pass > 0; pass--) {
    bytes = 0;
    for (let i = 0; i < input.sources.length; i++) {
      try {
        bytes += input.transpiler.transformSync(input.sources[i]).length;
      } catch (error) {
        throw new Error(`${input.name}: ${input.dir}/${input.paths[i]} does not parse`, { cause: error });
      }
    }
  }
  return bytes;
}

let iterations = 0;
let only;
for (const arg of process.argv.slice(2)) {
  const [flag, value] = arg.split("=");
  if (flag === "--iterations" && Number.isSafeInteger(Number(value)) && Number(value) > 0) {
    iterations = Number(value);
  } else if (flag === "--group" && groups.some(group => group.name === value)) {
    only = value;
  } else {
    console.error(`usage: bun transpiler-typescript.mjs [--iterations=<n>] [--group=<name>]`);
    console.error(`groups: ${groups.map(group => group.name).join(", ")}`);
    process.exit(1);
  }
}

const inputs = groups.filter(group => only === undefined || group.name === only).map(load);

if (iterations > 0) {
  const row = (...cells) =>
    console.log(cells.map((cell, i) => (i === 0 ? cell.padEnd(16) : String(cell).padStart(14))).join(""));
  row("group", "files", "input bytes", "passes", "output bytes", "ms");
  for (const input of inputs) {
    const start = performance.now();
    let output = 0;
    for (let i = 0; i < iterations; i++) output = transformAll(input);
    const elapsed = performance.now() - start;
    row(input.name, input.paths.length, input.bytes, iterations * (input.repeat ?? 1), output, elapsed.toFixed(1));
  }
} else {
  const { bench, group, run } = await import("../runner.mjs");
  group("transformSync", () => {
    for (const input of inputs) {
      const size = ((input.bytes * (input.repeat ?? 1)) / 1024) | 0;
      bench(`${input.name}, ${size} KB`, () => transformAll(input));
    }
  });
  await run();
}
