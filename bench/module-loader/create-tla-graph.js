// Generates ES module graphs that stress async-module linking/evaluation and
// star re-exports in the JS engine's module machinery.
//
//   bun create-tla-graph.js
//   CASCADE_COUNT=20000 TLA_COUNT=3000 STAR_COUNT=3000 bun create-tla-graph.js
//
// Generated entrypoints (run with the runtime you want to measure):
//   bun ./tla-cascade-entry.mjs   # long sync-parent chain over one async leaf
//   bun ./tla-chain-entry.mjs     # chain where every module has a top-level await
//   bun ./star-entry.mjs          # chain of `export * from` re-exports
const fs = require("fs");
const path = require("path");

const cascadeChains = parseInt(process.env.CASCADE_CHAINS || "100", 10);
const cascadeDepth = parseInt(process.env.CASCADE_DEPTH || "100", 10);
const tlaCount = parseInt(process.env.TLA_COUNT || "2000", 10);
const starCount = parseInt(process.env.STAR_COUNT || "2000", 10);

const reportMemory = `
async function reportMemory() {
  if (typeof Bun !== "undefined") Bun.gc(true);
  else if (typeof globalThis.gc === "function") globalThis.gc();
  const rss = process.memoryUsage().rss;
  console.log("rss", (rss / 1024 / 1024).toFixed(2), "MB");
  try {
    const { heapStats } = await import("bun:jsc");
    console.log("heapSize", (heapStats().heapSize / 1024 / 1024).toFixed(2), "MB");
  } catch {}
}
`;

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 1. Sync-parent cascade: many synchronous module chains (kept shallow to stay
//    within stack limits) all bottom out at a single module with a top-level
//    await. When that async leaf settles, the engine gathers every synchronous
//    ancestor (chains x depth modules) in one pass.
{
  const dir = resetDir(path.join(__dirname, "output-tla-cascade"));
  const total = cascadeChains * cascadeDepth;
  fs.writeFileSync(
    path.join(dir, "async-leaf.mjs"),
    `await 0;
export const value = 1;
`,
  );
  for (let chain = 0; chain < cascadeChains; chain++) {
    for (let i = 0; i < cascadeDepth; i++) {
      const next = i + 1 < cascadeDepth ? `./chain${chain}-mod${i + 1}.mjs` : "./async-leaf.mjs";
      fs.writeFileSync(
        path.join(dir, `chain${chain}-mod${i}.mjs`),
        `import { value as nextValue } from "${next}";
export const value = nextValue + 1;
`,
      );
    }
  }
  fs.writeFileSync(
    path.join(dir, "root.mjs"),
    Array.from({ length: cascadeChains }, (_, j) => `import { value as v${j} } from "./chain${j}-mod0.mjs";`).join(
      "\n",
    ) + `\nexport const value = ${Array.from({ length: cascadeChains }, (_, j) => `v${j}`).join(" + ")};\n`,
  );
  fs.writeFileSync(
    path.join(__dirname, "tla-cascade-entry.mjs"),
    `console.time("import (${total} sync parents over 1 async leaf)");
const ns = await import("./output-tla-cascade/root.mjs");
console.timeEnd("import (${total} sync parents over 1 async leaf)");
console.log("value:", ns.value);
${reportMemory}
await reportMemory();
`,
  );
}

// 2. Chain where every module has its own top-level await.
{
  const dir = resetDir(path.join(__dirname, "output-tla-chain"));
  for (let i = 0; i < tlaCount; i++) {
    const next = i + 1 < tlaCount ? `import { value as nextValue } from "./mod${i + 1}.mjs";` : `const nextValue = 0;`;
    fs.writeFileSync(
      path.join(dir, `mod${i}.mjs`),
      `${next}
await 0;
export const value = nextValue + 1;
`,
    );
  }
  fs.writeFileSync(
    path.join(__dirname, "tla-chain-entry.mjs"),
    `console.time("import (${tlaCount} modules, all top-level await)");
const ns = await import("./output-tla-chain/mod0.mjs");
console.timeEnd("import (${tlaCount} modules, all top-level await)");
console.log("value:", ns.value);
${reportMemory}
await reportMemory();
`,
  );
}

// 3. Star re-export chain: every module re-exports everything below it.
{
  const dir = resetDir(path.join(__dirname, "output-star"));
  for (let i = 0; i < starCount; i++) {
    const next = i + 1 < starCount ? `export * from "./mod${i + 1}.mjs";` : "";
    fs.writeFileSync(
      path.join(dir, `mod${i}.mjs`),
      `${next}
export const value${i} = ${i};
`,
    );
  }
  fs.writeFileSync(
    path.join(__dirname, "star-entry.mjs"),
    `console.time("import (${starCount} chained star re-exports)");
const ns = await import("./output-star/mod0.mjs");
console.timeEnd("import (${starCount} chained star re-exports)");
console.log("exports:", Object.keys(ns).length);
${reportMemory}
await reportMemory();
`,
  );
}

console.log(`Generated:
  output-tla-cascade/ (${cascadeChains * cascadeDepth} modules) -> bun ./tla-cascade-entry.mjs
  output-tla-chain/   (${tlaCount} modules) -> bun ./tla-chain-entry.mjs
  output-star/        (${starCount} modules) -> bun ./star-entry.mjs
`);
