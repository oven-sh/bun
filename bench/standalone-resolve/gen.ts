// Generates a --splitting app whose chunks share many static import edges:
// NL lazy modules (each reached by import() from the entry) statically import
// overlapping subsets of NS shared modules. Every shared module has a unique
// importer set, so each becomes its own chunk.
//
//   bun bench/standalone-resolve/gen.ts [out=app] [NS=1000] [NL=200] [avgImporters=47]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? join(import.meta.dir, "app");
const NS = Number(process.argv[3] ?? 1000);
const NL = Number(process.argv[4] ?? 200);
const AVG = Number(process.argv[5] ?? 47);

let seed = 0x9e3779b9;
const rand = () => {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const importers: number[][] = Array.from({ length: NL }, () => []);
let edges = 0;
for (let j = 0; j < NS; j++) {
  const seen = new Set<number>();
  const n = Math.min(NL, Math.max(1, Math.round(AVG * (0.5 + rand()))));
  while (seen.size < n) seen.add(Math.floor(rand() * NL));
  for (const i of seen) importers[i].push(j);
  edges += seen.size;
  writeFileSync(
    join(out, `shared-${j}.js`),
    `export function s${j}(x) { return (x * ${j + 1}) | 0; }\nexport const c${j} = ${j};\n`,
  );
}
for (let i = 0; i < NL; i++) {
  const deps = importers[i];
  let src = deps.map(j => `import { s${j} } from "./shared-${j}.js";`).join("\n");
  src += `\nexport default function lazy${i}(x) { let r = x;\n`;
  for (const j of deps) src += `  r = s${j}(r);\n`;
  src += `  return r; }\n`;
  writeFileSync(join(out, `lazy-${i}.js`), src);
}
let entry = `const t0 = performance.now();\nlet acc = 1;\nconst lazy = [\n`;
for (let i = 0; i < NL; i++) entry += `  () => import("./lazy-${i}.js"),\n`;
entry += `];\nfor (const load of lazy) { const m = await load(); acc = m.default(acc); }\n`;
entry += `console.log(JSON.stringify({ acc, importMs: +(performance.now() - t0).toFixed(2), footprint: Bun.unsafe.memoryFootprint?.() }));\n`;
writeFileSync(join(out, "entry.js"), entry);
console.log(`wrote ${out}: ${NS} shared, ${NL} lazy, ${edges} static import edges`);
