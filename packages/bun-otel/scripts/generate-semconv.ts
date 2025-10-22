#!/usr/bin/env bun
/**
 * Generate optimized semantic convention lookups for telemetry
 *
 * Scans src/telemetry/*.zig for AttributeKey.* usage and generates:
 * - Enum definition with only used attributes
 * - Optimized fromString() with prefix grouping
 * - toString() with compile-time string literals
 */

import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";

interface AttributeDef {
  enumName: string;
  semconvName: string;
  enumValue: number;
}

interface PrefixGroup {
  prefix: string;
  attributes: AttributeDef[];
}

async function findAttributeUsages(sourceDir: string): Promise<Set<string>> {
  const usages = new Set<string>();
  const files = await readdir(sourceDir);

  for (const file of files) {
    if (!file.endsWith(".zig")) continue;

    const content = await readFile(join(sourceDir, file), "utf-8");

    // Match: AttributeKey.some_attribute or .some_attribute in enum context
    const regex = /\.([a-z_]+)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const attrName = match[1];
      // Filter out common Zig patterns that aren't attributes
      if (!["init", "deinit", "bool", "int32", "int64", "double", "string"].includes(attrName)) {
        usages.add(attrName);
      }
    }
  }

  return usages;
}

function enumNameToSemconv(enumName: string): string {
  // Convert: http_request_method -> http.request.method
  return enumName.replace(/_/g, ".");
}

function groupByPrefix(attributes: AttributeDef[]): PrefixGroup[] {
  const groups = new Map<string, AttributeDef[]>();

  for (const attr of attributes) {
    // Extract prefix up to first dot
    const firstDot = attr.semconvName.indexOf(".");
    const prefix = firstDot > 0 ? attr.semconvName.substring(0, firstDot + 1) : "";

    if (!groups.has(prefix)) {
      groups.set(prefix, []);
    }
    groups.get(prefix)!.push(attr);
  }

  // Sort groups by number of attributes (largest first for better branching)
  return Array.from(groups.entries())
    .map(([prefix, attrs]) => ({ prefix, attributes: attrs }))
    .sort((a, b) => b.attributes.length - a.attributes.length);
}

function generateZigEnum(attributes: AttributeDef[]): string {
  const lines = [
    "//! Auto-generated semantic conventions",
    "//! DO NOT EDIT - run `bun run packages/bun-otel/scripts/generate-semconv.ts`",
    "",
    "pub const AttributeKey = enum(u8) {",
  ];

  for (const attr of attributes) {
    lines.push(`    ${attr.enumName} = ${attr.enumValue},`);
  }

  lines.push("");
  lines.push('    pub const COUNT = @typeInfo(AttributeKey).@"enum".fields.len;');
  lines.push("};");

  return lines.join("\n");
}

function generateToString(attributes: AttributeDef[]): string {
  const lines = [
    "",
    "/// Convert attribute key to OpenTelemetry semantic convention string",
    "pub fn toString(self: AttributeKey) []const u8 {",
    "    return switch (self) {",
  ];

  for (const attr of attributes) {
    lines.push(`        .${attr.enumName} => "${attr.semconvName}",`);
  }

  lines.push("    };");
  lines.push("}");

  return lines.join("\n");
}

function generateFromString(groups: PrefixGroup[]): string {
  const lines = [
    "",
    "/// Optimized string->enum lookup with prefix grouping",
    "/// Zero allocations - operates on raw bytes",
    "pub fn fromString(name: []const u8) ?AttributeKey {",
    "    // Quick length check",
  ];

  // Calculate min/max lengths
  const allAttrs = groups.flatMap(g => g.attributes);
  const lengths = allAttrs.map(a => a.semconvName.length);
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);

  lines.push(`    if (name.len < ${minLen} or name.len > ${maxLen}) return null;`);
  lines.push("");

  // Generate prefix-based branching
  for (const group of groups) {
    if (group.prefix) {
      lines.push(`    if (std.mem.startsWith(u8, name, "${group.prefix}")) {`);

      for (const attr of group.attributes) {
        lines.push(`        if (std.mem.eql(u8, name, "${attr.semconvName}")) return .${attr.enumName};`);
      }

      lines.push("        return null;");
      lines.push("    }");
      lines.push("");
    } else {
      // No prefix - direct comparison
      for (const attr of group.attributes) {
        lines.push(`    if (std.mem.eql(u8, name, "${attr.semconvName}")) return .${attr.enumName};`);
      }
    }
  }

  lines.push("    return null;");
  lines.push("}");

  return lines.join("\n");
}

async function main() {
  const repoRoot = join(import.meta.dir, "../../..");
  const sourceDir = join(repoRoot, "src/telemetry");
  const outputFile = join(sourceDir, "fast_semconv.zig");

  console.log("🔍 Scanning for AttributeKey usage...");
  const usages = await findAttributeUsages(sourceDir);

  console.log(`📊 Found ${usages.size} attribute usages`);

  // Create attribute definitions
  const attributes: AttributeDef[] = Array.from(usages)
    .sort()
    .map((enumName, index) => ({
      enumName,
      semconvName: enumNameToSemconv(enumName),
      enumValue: index,
    }));

  console.log("🔧 Grouping by prefix...");
  const groups = groupByPrefix(attributes);

  for (const group of groups) {
    console.log(`  ${group.prefix || "(no prefix)"}: ${group.attributes.length} attributes`);
  }

  console.log("📝 Generating code...");

  const code = [generateZigEnum(attributes), generateToString(attributes), generateFromString(groups)].join("\n\n");

  const fullCode = [
    "//! Auto-generated semantic conventions for OpenTelemetry",
    "//! DO NOT EDIT - run `bun run packages/bun-otel/scripts/generate-semconv.ts`",
    "//!",
    `//! Generated from src/telemetry/*.zig usage scan`,
    `//! Total attributes: ${attributes.length}`,
    "",
    'const std = @import("std");',
    "",
    code,
  ].join("\n");

  await writeFile(outputFile, fullCode);

  console.log(`✅ Generated ${outputFile}`);
  console.log(`   ${attributes.length} semantic conventions`);
  console.log(`   ${groups.length} prefix groups`);
}

main().catch(console.error);
