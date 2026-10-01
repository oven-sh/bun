// Per input of measure/deco-bench.inputs.json: accepted or not, and a hash of the output, for the binary that runs this.
//   <bun> deco-results.mjs <inputs.json> <out.json>
import { readFileSync, writeFileSync } from "node:fs";
const sources = JSON.parse(readFileSync(process.argv[2], "utf8"));
const transpiler = new Bun.Transpiler({
  loader: "ts",
  define: { "process.env.NODE_ENV": '"development"' },
  tsconfig: { compilerOptions: { experimentalDecorators: true, emitDecoratorMetadata: true } },
});
const out = sources.map(src => {
  try {
    return Bun.hash(transpiler.transformSync(src)).toString(36);
  } catch {
    return null;
  }
});
writeFileSync(process.argv[3], JSON.stringify(out));
console.log(`sources ${sources.length} accepted ${out.filter(x => x !== null).length}`);
