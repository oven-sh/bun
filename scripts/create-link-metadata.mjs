#!/usr/bin/env bun
/**
 * Creates link-metadata.json with link command and build metadata
 *
 * Usage: bun scripts/create-link-metadata.mjs <build-path> <bun-target>
 */

import { $ } from "bun";
import { join } from "path";

const [buildPath, bunTarget] = process.argv.slice(2);

if (!buildPath || !bunTarget) {
  console.error("Usage: bun scripts/create-link-metadata.mjs <build-path> <bun-target>");
  process.exit(1);
}

// Extract link command using ninja
console.log("Extracting link command...");
const linkCommandResult = await $`ninja -C ${buildPath} -t commands ${bunTarget}`.quiet();
const linkCommand = linkCommandResult.stdout.toString().trim();

// Create metadata JSON with link command included
const metadata = {
  webkit_url: process.env.WEBKIT_DOWNLOAD_URL || "",
  webkit_version: process.env.WEBKIT_VERSION || "",
  zig_commit: process.env.ZIG_COMMIT || "",
  target: bunTarget,
  timestamp: new Date().toISOString(),
  link_command: linkCommand,
};

const metadataPath = join(buildPath, "link-metadata.json");
await Bun.write(metadataPath, JSON.stringify(metadata, null, 2));
console.log(`Written to ${metadataPath}`);

console.log("Done");
