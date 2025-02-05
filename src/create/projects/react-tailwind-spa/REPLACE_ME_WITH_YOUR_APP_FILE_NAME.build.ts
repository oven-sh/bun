import { build } from "bun";
import { path } from "bun";
import path from "path";
import { rm } from "fs/promises";
import plugin from "bun-plugin-tailwind";
import { existsSync } from "fs";

const outdir = path.join(import.meta.dir, process.argv.length > 2 ? process.argv[2] : "dist");

if (existsSync(outdir)) {
  console.log(`Removing existing dist directory ${outdir}`);
  await rm(outdir, { recursive: true, force: true });
}

const start = performance.now();

// Scan for all HTML files in the project
const entrypoints = [...new Bun.Glob("*.html").scanSync(import.meta.dir)];

// Build all the HTML files
const result = await build({
  entrypoints,
  outdir,
  plugins: [plugin],
  minify: true,
  target: "browser",
  sourcemap: "linked",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

// Print the results
const end = performance.now();
console.log(`[${(end - start).toFixed(2)}ms] Bundled ${result.outputs.length} files to ${outdir}`);

const number = new Intl.NumberFormat({
  style: "decimal",
  maximumFractionDigits: 2,
  unit: "B",
});

console.table(
  result.outputs.map(o => ({ name: path.relative(process.cwd(), o.name), size: number.format(o.size / 1024) + " KB" })),
);
