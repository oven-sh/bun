// Generates a synthetic app whose entry reaches N "tool" modules only through
// function-scoped require() calls in a registry, and invokes K of them at
// startup. Each tool is a few KB of code so that bundling/bytecode cost is
// measurable. Usage: bun gen.ts <outdir> <N> <K>
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [outdir, nStr = "400", kStr = "8"] = process.argv.slice(2);
const N = +nStr;
const K = +kStr;
mkdirSync(join(outdir, "tools"), { recursive: true });

function toolSource(i: number): string {
  const fns: string[] = [];
  for (let j = 0; j < 40; j++) {
    fns.push(`
export function op${i}_${j}(input) {
  const parts = String(input).split(",").map((s, idx) => ({ s, idx, w: s.length * ${j + 1} }));
  let acc = ${i * 7 + j};
  for (const p of parts) {
    acc = (acc * 31 + p.w + p.idx) % 1000003;
    if (p.s.startsWith("x")) acc ^= ${j * 13 + 1};
  }
  return { tool: ${i}, op: ${j}, acc, tag: "tool${i}-op${j}-" + acc.toString(36) };
}`);
  }
  return `import { helper } from "../helper.ts";
${fns.join("\n")}
export const Tool${i} = {
  name: "tool${i}",
  run(input) { return helper(op${i}_0(input).tag); },
  ops: [${Array.from({ length: 40 }, (_, j) => `op${i}_${j}`).join(", ")}],
};
`;
}

for (let i = 0; i < N; i++) {
  writeFileSync(join(outdir, "tools", `tool${i}.ts`), toolSource(i));
}

writeFileSync(join(outdir, "helper.ts"), `export function helper(s) { return s.toUpperCase(); }\n`);

const cases = Array.from(
  { length: N },
  (_, i) => `    case "tool${i}": return require("./tools/tool${i}.ts").Tool${i};`,
).join("\n");
writeFileSync(
  join(outdir, "registry.ts"),
  `export function getTool(name) {
  switch (name) {
${cases}
  }
  throw new Error("unknown tool " + name);
}
`,
);

writeFileSync(
  join(outdir, "entry.ts"),
  `import { getTool } from "./registry.ts";
const used = [${Array.from({ length: K }, (_, i) => `"tool${Math.floor((i * N) / K)}"`).join(", ")}];
let out = "";
for (const name of used) out += getTool(name).run("a,b,xc,d") + ";";
if (process.env.BENCH_REPORT) {
  console.log(JSON.stringify({
    ms_since_start: +performance.now().toFixed(1),
    footprint_mb: +((Bun.unsafe.memoryFootprint() ?? -1) / 1048576).toFixed(1),
    out_len: out.length,
  }));
}
`,
);
console.log(`generated ${N} tools, ${K} used, in ${outdir}`);
