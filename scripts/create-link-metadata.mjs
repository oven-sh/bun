#!/usr/bin/env bun
/**
 * Creates link-metadata.json with link command and build metadata
 *
 * Usage: bun scripts/create-link-metadata.mjs <build-path> <bun-target>
 */

import { $ } from "bun";
import { dirname, join } from "path";

const [buildPath, bunTarget] = process.argv.slice(2);

if (!buildPath || !bunTarget) {
  console.error("Usage: bun scripts/create-link-metadata.mjs <build-path> <bun-target>");
  process.exit(1);
}

// Get the repo root (parent of scripts directory)
const repoRoot = dirname(import.meta.dir);

// Extract link command using ninja
console.log("Extracting link command...");
const linkCommandResult = await $`ninja -C ${buildPath} -t commands ${bunTarget}`.quiet();
const linkCommand = linkCommandResult.stdout.toString().trim();

// Read linker-related files from src/
console.log("Reading linker files...");
const linkerLds = await Bun.file(join(repoRoot, "src", "linker.lds")).text();
const symbolsDyn = await Bun.file(join(repoRoot, "src", "symbols.dyn")).text();
const symbolsTxt = await Bun.file(join(repoRoot, "src", "symbols.txt")).text();
const symbolsDef = await Bun.file(join(repoRoot, "src", "symbols.def")).text();

// Create metadata JSON with link command included
const metadata = {
  bun_version: process.env.BUN_VERSION || "",
  webkit_url: process.env.WEBKIT_DOWNLOAD_URL || "",
  webkit_version: process.env.WEBKIT_VERSION || "",
  zig_commit: process.env.ZIG_COMMIT || "",
  target: bunTarget,
  timestamp: new Date().toISOString(),
  link_command: linkCommand,
  linker_lds: linkerLds,
  symbols_dyn: symbolsDyn,
  symbols_txt: symbolsTxt,
  symbols_def: symbolsDef,
};

const metadataPath = join(buildPath, "link-metadata.json");
await Bun.write(metadataPath, JSON.stringify(metadata, null, 2));
console.log(`Written to ${metadataPath}`);

console.log("Done");
