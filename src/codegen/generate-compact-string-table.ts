#!/usr/bin/env bun

/**
 * Compact String Table Generator
 *
 * Generates a Zig enum that stores multiple strings in a contiguous buffer with
 * reduced per-string overhead compared to individual string slices.
 *
 * Instead of storing each string as a separate slice (16 bytes each), this packs
 * the string metadata into enum values using bit fields. The actual string data
 * is stored in a single static array.
 *
 * ## How it works:
 *
 * 1. Groups strings by length for uniform spacing within each group
 * 2. Stores position and length group in bit-packed enum values
 * 3. Uses non-power-of-2 integers (u9, u12, etc.) to minimize enum size
 *
 * ## Usage:
 *
 * ```bash
 * # Input: newline-delimited strings
 * echo -e "application/json\\ntext/html\\ntext/plain" > strings.txt
 *
 * # Generate Zig code
 * bun src/codegen/generate-compact-string-table.ts strings.txt output.zig MyStrings
 * ```
 *
 * ## Trade-offs:
 *
 * - Reduces memory overhead from 16 bytes to 1-2 bytes per string
 * - O(1) string access through length-based grouping
 * - Uniform spacing within groups may include some padding
 * - Requires build-time code generation
 *
 */

import { writeFileSync } from "fs";

const args = process.argv.slice(2);

if (args.length < 3) {
  console.error("Usage: generate-compact-string-table.ts <input.txt> <output.zig> <enum-name> [namespace]");
  console.error("Provide strings via stdin, one per line");
  process.exit(1);
}

const [inputPath, outputPath, enumName, namespace] = args;

interface StringEntry {
  name: string;
  value: string;
  offset: number;
  length: number;
}

interface PackedString {
  value: string;
  offset: number;
  entries: StringEntry[];
}

function escapeZigIdentifier(name: string): string {
  // Always use @"..." syntax for consistency
  return `@"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeZigString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\x00-\x1F\x7F-\x9F]/g, char => {
      const code = char.charCodeAt(0);
      return `\\x${code.toString(16).padStart(2, "0")}`;
    });
}

function findSmallestIntType(maxValue: number): string {
  if (maxValue <= 0xff) return "u8";
  if (maxValue <= 0xffff) return "u16";
  if (maxValue <= 0xffffffff) return "u32";
  return "u64";
}

interface LengthGroup {
  length: number;
  strings: { name: string; value: string }[];
  startOffset: number;
}

function optimizeStringPacking(strings: { name: string; value: string }[]): {
  entries: StringEntry[];
  packedData: string;
  lengthGroups: LengthGroup[];
} {
  // First, identify unique string values and do substring deduplication
  const uniqueValues = new Map<string, string[]>(); // value -> [names]

  for (const { name, value } of strings) {
    if (!uniqueValues.has(value)) {
      uniqueValues.set(value, []);
    }
    uniqueValues.get(value)!.push(name);
  }

  // Sort unique values by length descending for substring detection
  const sortedValues = Array.from(uniqueValues.keys()).sort((a, b) => b.length - a.length);

  // Find which strings can be substrings of others
  const substringMap = new Map<string, { parent: string; offset: number }>();
  const rootStrings: string[] = [];

  for (const value of sortedValues) {
    let foundAsSubstring = false;

    // Check if this string is a substring of any root string
    for (const root of rootStrings) {
      const index = root.indexOf(value);
      if (index !== -1) {
        substringMap.set(value, { parent: root, offset: index });
        foundAsSubstring = true;
        break;
      }
    }

    if (!foundAsSubstring) {
      // This is a new root string, check if it contains any existing roots
      const newRoot = value;
      const toRemove: number[] = [];

      for (let i = 0; i < rootStrings.length; i++) {
        const existingRoot = rootStrings[i];
        const index = newRoot.indexOf(existingRoot);
        if (index !== -1) {
          // Update all strings that were substrings of the old root
          for (const [substr, info] of substringMap.entries()) {
            if (info.parent === existingRoot) {
              substringMap.set(substr, {
                parent: newRoot,
                offset: index + info.offset,
              });
            }
          }
          // The existing root is now a substring of the new root
          substringMap.set(existingRoot, { parent: newRoot, offset: index });
          toRemove.push(i);
        }
      }

      // Remove absorbed roots
      for (let i = toRemove.length - 1; i >= 0; i--) {
        rootStrings.splice(toRemove[i], 1);
      }

      rootStrings.push(newRoot);
    }
  }

  // Now reorganize by length groups for uniform spacing
  const lengthMap = new Map<number, { value: string; names: string[] }[]>();

  for (const [value, names] of uniqueValues.entries()) {
    const length = value.length;
    if (!lengthMap.has(length)) {
      lengthMap.set(length, []);
    }
    lengthMap.get(length)!.push({ value, names });
  }

  // Sort length groups by frequency
  const lengthGroups: LengthGroup[] = Array.from(lengthMap.entries())
    .sort((a, b) => {
      // Group with more total strings comes first (smaller index = fewer bits)
      const aCount = a[1].reduce((sum, v) => sum + v.names.length, 0);
      const bCount = b[1].reduce((sum, v) => sum + v.names.length, 0);
      if (aCount !== bCount) return bCount - aCount;
      return a[0] - b[0];
    })
    .map(([length, values]) => ({
      length,
      strings: values.flatMap(v => v.names.map(name => ({ name, value: v.value }))),
      startOffset: 0,
    }));

  // Build packed data with uniform spacing within length groups
  let packedData = "";
  const entries: StringEntry[] = [];

  for (const group of lengthGroups) {
    group.startOffset = packedData.length;

    // Get unique values in this length group
    const uniqueInGroup = new Map<string, string[]>();
    for (const { name, value } of group.strings) {
      if (!uniqueInGroup.has(value)) {
        uniqueInGroup.set(value, []);
      }
      uniqueInGroup.get(value)!.push(name);
    }

    // Sort values for consistent ordering
    const sortedValues = Array.from(uniqueInGroup.keys()).sort();

    // Pack values uniformly
    for (let i = 0; i < sortedValues.length; i++) {
      const value = sortedValues[i];
      const offset = group.startOffset + i * group.length;

      // Get the actual string data to pack
      let sourceData: string;
      if (substringMap.has(value)) {
        // This is a substring of another string
        const { parent, offset: parentOffset } = substringMap.get(value)!;
        // We need to ensure the parent data is available
        sourceData = value; // We'll still pack it directly for uniform spacing
      } else {
        sourceData = value;
      }

      packedData += sourceData;

      // Create entries for all names with this value
      for (const name of uniqueInGroup.get(value)!) {
        entries.push({
          name,
          value,
          offset,
          length: group.length,
        });
      }
    }
  }

  return { entries, packedData, lengthGroups };
}

export function generateCompactStringTable(
  enumName: string,
  strings: { name: string; value: string }[],
  namespace?: string,
): string {
  if (strings.length === 0) {
    throw new Error("No strings provided");
  }

  const { entries, packedData, lengthGroups } = optimizeStringPacking(strings);

  // Create lookup tables for length groups
  const lengthGroupMap = new Map<number, { index: number; startOffset: number; count: number }>();
  const uniqueLengths: number[] = [];
  const groupStartOffsets: number[] = [];
  const groupCounts: number[] = [];

  lengthGroups.forEach((group, index) => {
    const uniqueInGroup = new Set(group.strings.map(s => s.value)).size;
    lengthGroupMap.set(group.length, {
      index,
      startOffset: group.startOffset,
      count: uniqueInGroup,
    });
    uniqueLengths.push(group.length);
    groupStartOffsets.push(group.startOffset);
    groupCounts.push(uniqueInGroup);
  });

  // For each entry, calculate its position within its length group
  const entryPositions = new Map<string, { groupIndex: number; positionInGroup: number }>();

  for (const group of lengthGroups) {
    // Get unique values in this length group (must match packing logic exactly)
    const uniqueInGroup = new Map<string, string[]>();
    for (const { name, value } of group.strings) {
      if (!uniqueInGroup.has(value)) {
        uniqueInGroup.set(value, []);
      }
      uniqueInGroup.get(value)!.push(name);
    }

    // Sort values for consistent ordering (must match packing logic exactly)
    const sortedValues = Array.from(uniqueInGroup.keys()).sort();

    // Assign positions
    sortedValues.forEach((value, position) => {
      for (const name of uniqueInGroup.get(value)!) {
        entryPositions.set(name, {
          groupIndex: lengthGroupMap.get(group.length)!.index,
          positionInGroup: position,
        });
      }
    });
  }

  // Calculate bits needed
  const lengthGroupBits = Math.ceil(Math.log2(lengthGroups.length || 1));
  const maxPositionInGroup = Math.max(...groupCounts);
  const positionBits = Math.ceil(Math.log2(maxPositionInGroup || 1));
  const actualPackedBits = lengthGroupBits + positionBits;

  // Use exact bit size for the enum
  const packedIntType = `u${actualPackedBits}`;

  // Sort entries by name for stable output
  entries.sort((a, b) => a.name.localeCompare(b.name));

  let output = `//! Generated by generate-compact-string-table.ts
//! Do not edit manually
//! To regenerate, run:
//! \`\`\`
//!   bun run src/codegen/generate-compact-string-table.ts ${inputPath} ${outputPath} ${enumName}
//! \`\`\`
`;

  if (namespace) {
    output += `\npub const ${namespace} = struct {\n`;
  }

  output += `pub const ${enumName} = enum(${packedIntType}) {
    const LengthGroupBits = ${lengthGroupBits};
    const PositionBits = ${positionBits};
    const PackedInt = ${packedIntType};
    
    pub const Packed = packed struct (PackedInt) {
        length_group: u${lengthGroupBits},
        position: u${positionBits},
    };
    
    const _bytes = "${escapeZigString(packedData)}";
    const _lengths = [_]${findSmallestIntType(Math.max(...uniqueLengths))}{${uniqueLengths.join(", ")}};
    const _group_start_offsets = [_]${findSmallestIntType(Math.max(...groupStartOffsets))}{${groupStartOffsets.join(", ")}};
    
`;

  // Generate enum fields
  // Sort entries by name for stable output
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const pos = entryPositions.get(entry.name)!;
    const packedValue = pos.groupIndex | (pos.positionInGroup << lengthGroupBits);
    output += `    ${escapeZigIdentifier(entry.name)} = ${packedValue},\n`;
  }

  output += `
    pub fn slice(this: ${enumName}) []const u8 {
        const p: Packed = @bitCast(@as(PackedInt, @intFromEnum(this)));
        const length: usize = _lengths[p.length_group];
        const offset = @as(usize, _group_start_offsets[p.length_group]) + @as(usize, p.position) * @as(usize, length);
        return _bytes[offset..][0..length];
    }
    
    pub fn len(this: ${enumName}) usize {
        const p: Packed = @bitCast(@as(PackedInt, @intFromEnum(this)));
        return _lengths[p.length_group];
    }
    
    pub fn ptr(this: ${enumName}) [*]const u8 {
        const p: Packed = @bitCast(@as(PackedInt, @intFromEnum(this)));
        const length: usize = _lengths[p.length_group];
        const offset = @as(usize, _group_start_offsets[p.length_group]) + @as(usize, p.position) * @as(usize, length);
        return _bytes[offset..].ptr;
    }
    
    pub const count = ${entries.length};
    pub const all = &[_]${enumName}{
${entries.map(entry => `        .${escapeZigIdentifier(entry.name)},`).join("\n")}
    };
};
`;

  if (namespace) {
    output += `};\n`;
  }

  output += `\nconst std = @import("std");\n`;

  return output;
}

// CLI interface

// Read strings from stdin
const input = await Bun.file(inputPath).text();
const strings: { name: string; value: string }[] = [];

for (const line of input.trim().split("\n")) {
  if (!line) continue;
  // Each line is just a string value, use it as both name and value
  strings.push({ name: line.trim(), value: line.trim() });
}

if (strings.length === 0) {
  console.error("No valid strings provided");
  process.exit(1);
}

try {
  const output = generateCompactStringTable(enumName, strings, namespace);
  writeFileSync(outputPath, output);

  // Print statistics
  const totalOriginalSize = strings.reduce((sum, s) => sum + s.value.length, 0);
  const packedSize = output.match(/const _bytes = "(.*?)"/s)?.[1]?.length ?? 0;
  const lengthsMatch = output.match(/const _lengths = \[_\][^{]+\{([^}]+)\}/);
  const lengthGroupsCount = lengthsMatch ? lengthsMatch[1].split(",").filter(s => s.trim()).length : 0;

  // Calculate actual memory usage
  const naiveMemory = strings.length * 16; // Each []const u8 is 16 bytes
  const actualBits =
    parseInt(output.match(/const LengthGroupBits = (\d+)/)?.[1] ?? "0") +
    parseInt(output.match(/const PositionBits = (\d+)/)?.[1] ?? "0");
  const ourEnumSize = Math.ceil(actualBits / 8);
  const ourTotalMemory = strings.length * ourEnumSize; // Each enum value

  console.log(`Generated ${outputPath}`);
  console.log(`  Strings: ${strings.length}`);
  console.log(`  Length groups: ${lengthGroupsCount}`);
  console.log(`  Packed bits: ${actualBits} (u${actualBits})`);
  console.log(`  Packed data: ${packedSize} bytes`);
  console.log(`  String deduplication: ${((1 - packedSize / totalOriginalSize) * 100).toFixed(1)}% saved`);
  console.log(
    `  Memory per value: ${ourEnumSize} bytes vs 16 bytes (${((1 - ourEnumSize / 16) * 100).toFixed(1)}% saved)`,
  );
  console.log(`  Total memory: ${ourTotalMemory} bytes vs ${naiveMemory} bytes`);
} catch (error) {
  console.error("Error:", error);
  process.exit(1);
}
