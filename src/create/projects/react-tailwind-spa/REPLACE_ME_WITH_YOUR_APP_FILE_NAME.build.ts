#!/usr/bin/env bun
/**
 * Build script for bundling the application for production.
 *
 * Usage:
 *   bun run build.ts [outdir]
 *
 * Arguments:
 *   outdir  Optional output directory (default: "dist")
 *
 * Example:
 *   bun run build.ts              # Builds to ./dist
 *   bun run build.ts build/       # Builds to ./build
 */

import { build } from "bun";
import plugin from "bun-plugin-tailwind";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import path from "path";

const outdir = path.join(import.meta.dir, process.argv.length > 2 ? process.argv[2] : "dist");

if (existsSync(outdir)) {
  console.log(`🗑️  Removing existing dist directory "${outdir}"`);
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
const duration = (end - start).toFixed(2);
console.log(`✨ Successfully bundled ${result.outputs.length} files in ${duration}ms`);
console.log(`📦 Output directory: ${outdir}`);

const number = new Intl.NumberFormat({
  style: "decimal",
  maximumFractionDigits: 2,
  unit: "B",
});

console.log("\n📄 Generated files:");
console.table(
  result.outputs.map(o => ({
    "File": path.relative(process.cwd(), o.name),
    "Size": number.format(o.size / 1024) + " KB",
  })),
  ["File", "Size"],
);
