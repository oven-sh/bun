#!/usr/bin/env bun
/**
 * Generate OpenTelemetry semantic convention constants for Zig
 *
 * Output: src/telemetry/semconv.zig
 */

import * as semconv from "@opentelemetry/semantic-conventions";
import { spawnSync } from "child_process";
import { writeFile } from "fs/promises";
import { join } from "path";

function escapeString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

// Collect all ATTR_* and SEMATTRS_* constants
const constants: Array<{ name: string; value: string }> = [];

for (const [key, value] of Object.entries(semconv)) {
  if ((key.startsWith("ATTR_") || key.startsWith("SEMATTRS_")) && typeof value === "string") {
    constants.push({ name: key, value });
  }
}

// Sort by name for stable output
constants.sort((a, b) => a.name.localeCompare(b.name));

// Generate Zig file
const lines: string[] = [];

lines.push("//! OpenTelemetry Semantic Conventions");
lines.push("//!");
lines.push("//! Auto-generated from @opentelemetry/semantic-conventions");
lines.push("//! DO NOT EDIT - run `bun run packages/bun-otel/scripts/generate-semconv.ts`");
lines.push("");

// Export all constants
for (const { name, value } of constants) {
  lines.push(`pub const ${name} = "${escapeString(value)}";`);
}

// Write output
const outputPath = join(import.meta.dir, "../../../src/telemetry/semconv.zig");
await writeFile(outputPath, lines.join("\n") + "\n");

// Format with zig fmt
const zigPath = join(import.meta.dir, "../../../vendor/zig/zig");
const result = spawnSync(zigPath, ["fmt", outputPath], { stdio: "inherit" });

console.log(`✅ Generated ${outputPath}`);
console.log(`   ${constants.length} constants from @opentelemetry/semantic-conventions`);

if (result.status !== 0) {
  console.error("⚠️  zig fmt failed");
  process.exit(1);
}
