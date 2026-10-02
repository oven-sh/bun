// Cost of folding calls of constant functions (docs/bundler: "Constant function calls").
//
// Generates a graph of modules of which some call `isDev()` from `env.js` in a
// condition, and bundles it with the fold on and off, in turns.
//
//   bun bench/bundle/constant-calls.mjs [modules=2000] [percent=50] [constant|dynamic] [rounds=15]
//
// constant: `isDev()` reads `process.env.NODE_ENV`, so every call folds.
// dynamic:  `isDev()` reads a global, so no call folds.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [modules = "2000", percent = "50", kind = "constant", rounds = "15"] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), "constant-calls-"));

const functions = i =>
  Array.from(
    { length: 40 },
    (_, j) =>
      `export function f${i}_${j}(a, b) {\n  const x = a * ${j + 1} + b;\n  if (x > ${i}) { return [x, "${i}-${j}", { a, b }]; }\n  return x % 7 === 0 ? null : String(x);\n}\n`,
  ).join("");

writeFileSync(
  join(dir, "env.js"),
  kind === "constant"
    ? `export function isDev() { return process.env.NODE_ENV !== "production"; }\n`
    : `export function isDev() { return globalThis.__DEV__ === true; }\n`,
);
writeFileSync(join(dir, "devtools.js"), `export function install(name) { console.log("devtools", name); }\n`);
mkdirSync(join(dir, "dev"));
for (let d = 0; d < 7; d++) writeFileSync(join(dir, "dev", `only${d}.js`), functions(100000 + d));

let guarded = 0;
let entry = "";
for (let i = 0; i < Number(modules); i++) {
  const guard = Math.floor(((i + 1) * Number(percent)) / 100) > Math.floor((i * Number(percent)) / 100);
  guarded += guard;
  writeFileSync(
    join(dir, `m${i}.js`),
    guard
      ? `import { isDev } from "./env.js";\nimport { install } from "./devtools.js";\n${functions(i)}if (isDev()) { install("m${i}"); require("./dev/only${i % 7}.js"); }\n`
      : functions(i),
  );
  entry += `export { f${i}_0 } from "./m${i}.js";\n`;
}
writeFileSync(join(dir, "entry.js"), entry);

const variants = [
  { name: "fold on", env: {}, cpu: [], rss: [] },
  { name: "fold off", env: { BUN_FEATURE_FLAG_DISABLE_CONST_CALL_FOLDING: "1" }, cpu: [], rss: [] },
];
const cmd = [
  process.execPath,
  "build",
  join(dir, "entry.js"),
  `--outfile=${join(dir, "out.js")}`,
  "--minify-syntax",
  "--define",
  'process.env.NODE_ENV="production"',
];
for (let round = 0; round <= Number(rounds); round++) {
  for (const variant of variants) {
    const proc = Bun.spawn({ cmd, env: { ...process.env, ...variant.env }, stdout: "ignore", stderr: "inherit" });
    if ((await proc.exited) !== 0) throw new Error(`${variant.name}: exit code ${proc.exitCode}`);
    // The first round warms the file cache.
    if (round === 0) continue;
    const usage = proc.resourceUsage();
    variant.cpu.push(Number(usage.cpuTime.total) / 1000);
    variant.rss.push(usage.maxRSS / 1024 / 1024);
  }
}
rmSync(dir, { recursive: true, force: true });

const median = values => values.toSorted((a, b) => a - b)[values.length >> 1];
console.log(`${modules} modules, ${guarded} call isDev() (${kind}), ${rounds} rounds`);
for (const { name, cpu, rss } of variants) {
  console.log(
    `${name.padEnd(8)}  cpu ${median(cpu).toFixed(1)} ms (min ${Math.min(...cpu).toFixed(1)})  peak rss ${median(rss).toFixed(1)} MB`,
  );
}
