#!/usr/bin/env bun
/**
 * Generate Zig semantic convention constants from @opentelemetry/semantic-conventions
 *
 * This script imports the official OpenTelemetry semantic conventions npm package
 * and generates a Zig file with the same constant names and values, ensuring
 * consistency between TypeScript and Zig code.
 *
 * Usage: bun run packages/bun-otel/scripts/generate_semconv.ts
 *
 * Output: src/telemetry/semconv.zig
 *
 * Example usage in Zig code:
 * ```zig
 * const semconv = @import("../telemetry/semconv.zig");
 * map.set(semconv.ATTR_HTTP_REQUEST_METHOD, method_value);
 * map.set(semconv.ATTR_URL_SCHEME, "https");
 * ```
 */

import * as semconv from "@opentelemetry/semantic-conventions";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT_PATH = join(import.meta.dir, "..", "..", "..", "src", "telemetry", "semconv.zig");

/**
 * Zig reserved keywords that need an underscore suffix
 */
const ZIG_RESERVED_KEYWORDS = new Set([
  "error",
  "test",
  "struct",
  "enum",
  "union",
  "fn",
  "const",
  "var",
  "if",
  "else",
  "switch",
  "while",
  "for",
  "break",
  "continue",
  "return",
  "try",
  "catch",
  "defer",
  "errdefer",
  "async",
  "await",
  "suspend",
  "resume",
  "unreachable",
  "comptime",
  "inline",
  "noreturn",
  "type",
  "anytype",
]);

/**
 * Escape Zig string if needed
 */
function escapeZigString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Convert constant name to Zig-safe identifier
 */
function toZigName(name: string): string {
  // Check if it's a reserved keyword and needs underscore suffix
  const lowerName = name.toLowerCase();
  if (ZIG_RESERVED_KEYWORDS.has(lowerName)) {
    return name + "_";
  }
  return name;
}

/**
 * Generate Zig file content from semconv constants
 */
function generateZigFile(): string {
  const lines: string[] = [];

  // Header
  lines.push("//! OpenTelemetry Semantic Conventions");
  lines.push("//!");
  lines.push("//! This file is auto-generated from @opentelemetry/semantic-conventions npm package.");
  lines.push("//! DO NOT EDIT - run `bun run generate:semconv` to regenerate.");
  lines.push("//!");
  lines.push("//! These constants match the official OpenTelemetry semantic conventions.");
  lines.push("");

  // Get all exported constants from semconv
  const constants: Array<{ name: string; value: string }> = [];

  for (const [key, value] of Object.entries(semconv)) {
    // Only include string constants (attribute names and values)
    if (typeof value === "string") {
      constants.push({ name: key, value });
    }
  }

  // Sort by name for consistent output
  constants.sort((a, b) => a.name.localeCompare(b.name));

  // Generate constants
  for (const { name, value } of constants) {
    const zigName = toZigName(name);
    lines.push(`pub const ${zigName} = "${escapeZigString(value)}";`);
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log("Generating OpenTelemetry semantic convention constants for Zig...");
  console.log("Source: @opentelemetry/semantic-conventions npm package");
  console.log("");

  // Generate Zig file
  const zigContent = generateZigFile();

  // Count constants
  const constantCount = (zigContent.match(/^pub const /gm) || []).length;

  // Check if file exists and compare content
  let shouldWrite = true;
  try {
    const existingContent = await readFile(OUTPUT_PATH, "utf-8");
    if (existingContent === zigContent) {
      shouldWrite = false;
      console.log(`✓ ${OUTPUT_PATH} is up to date (no changes)`);
    }
  } catch {
    // File doesn't exist, we'll write it
  }

  // Write output only if content changed
  if (shouldWrite) {
    await writeFile(OUTPUT_PATH, zigContent, "utf-8");
    console.log(`✓ Generated ${OUTPUT_PATH}`);

    // Format the generated Zig file
    try {
      const proc = Bun.spawn(["vendor/zig/zig.exe", "fmt", OUTPUT_PATH], {
        cwd: join(import.meta.dir, "..", "..", ".."),
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
      console.log(`  Formatted with zig fmt`);
    } catch (err) {
      console.warn(`  ⚠ Could not format with zig fmt:`, err);
    }
  }

  console.log(`  Total constants: ${constantCount}`);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
