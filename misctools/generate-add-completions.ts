import * as fs from "fs";
import path from "path";
import { execSync } from "child_process";

interface LetterGroup {
  offset: number;
  length: number;
  packages: string[];
}

// Read and parse input file
const content = fs.readFileSync(path.join(__dirname, "..", "src", "cli", "add_completions.txt"), "utf8");
const packages = content
  .split("\n")
  .map(line => line.trim())
  .filter(line => line.length > 0)
  .sort();

// Group packages by first letter
const letterGroups = new Map<string, LetterGroup>();
let currentOffset = 0;
let maxListSize = 0;

for (const pkg of packages) {
  if (pkg.length === 0) continue;
  const firstLetter = pkg[0].toLowerCase();
  if (!letterGroups.has(firstLetter)) {
    letterGroups.set(firstLetter, {
      offset: currentOffset,
      length: 0,
      packages: [],
    });
  }
  const group = letterGroups.get(firstLetter)!;
  group.packages.push(pkg);
  group.length++;
  maxListSize = Math.max(maxListSize, group.length);
}

// Helper to ensure temp dir exists
const tmpDir = path.join(__dirname, "tmp");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir);
}

// Create a single buffer with all package data
const dataChunks: Buffer[] = [];
let totalUncompressed = 0;

// Store total package count first
const totalCountBuf = Buffer.alloc(4);
totalCountBuf.writeUInt32LE(packages.length, 0);
dataChunks.push(totalCountBuf);
totalUncompressed += 4;

// Then all packages with length prefixes
for (const pkg of packages) {
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(pkg.length, 0);
  dataChunks.push(lenBuf);
  dataChunks.push(Buffer.from(pkg, "utf8"));
  totalUncompressed += 2 + pkg.length;
}

const uncompressedData = Buffer.concat(dataChunks);

// Write to temp file and compress with zstd
const uncompressedPath = path.join(tmpDir, "packages.bin");
const compressedPath = path.join(tmpDir, "packages.bin.zst");

fs.writeFileSync(uncompressedPath, uncompressedData);
execSync(`zstd -1 --rm -f "${uncompressedPath}" -o "${compressedPath}"`);

// Read back compressed data
const compressedData = fs.readFileSync(compressedPath);
fs.unlinkSync(compressedPath);

// Calculate compression ratio
const totalCompressed = compressedData.length;
const ratio = ((totalCompressed / totalUncompressed) * 100).toFixed(1);

console.log("\nCompression statistics:");
console.log(`Uncompressed size: ${totalUncompressed} bytes`);
console.log(`Compressed size: ${totalCompressed} bytes`);
console.log(`Compression ratio: ${ratio}%`);

// Generate Zig code
const chunks: string[] = [];

// Header with comments and imports
chunks.push(`// Auto-generated file. Do not edit.
// To regenerate this file, run:
// 
//   bun misctools/generate-add-completions.ts
//
// If you update add_completions.txt, then you should run this script again.
//
// This used to be a comptime block, but it made the build too slow.
// Compressing the completions list saves about 100 KB of binary size.
const std = @import("std");
const bun = @import("bun");
const zstd = bun.zstd;
const Environment = bun.Environment;

pub const FirstLetter = enum(u8) {
    a = 'a',
    b = 'b',
    c = 'c',
    d = 'd',
    e = 'e',
    f = 'f',
    g = 'g',
    h = 'h',
    i = 'i',
    j = 'j',
    k = 'k',
    l = 'l',
    m = 'm',
    n = 'n',
    o = 'o',
    p = 'p',
    q = 'q',
    r = 'r',
    s = 's',
    t = 't',
    u = 'u',
    v = 'v',
    w = 'w',
    x = 'x',
    y = 'y',
    z = 'z',
};`);

// Add the compressed data
chunks.push(`const compressed_data = [_]u8{${[...compressedData].join(",")}};`);

// Add uncompressed size constant
chunks.push(`const uncompressed_size: usize = ${totalUncompressed};`);

// Generate index entries
const indexEntries: string[] = [];
let offset = 0;
for (const letter of "abcdefghijklmnopqrstuvwxyz") {
  const group = letterGroups.get(letter);
  if (group) {
    indexEntries.push(`        .${letter} = .{ .offset = ${offset}, .length = ${group.length} }`);
    offset += group.length;
  } else {
    indexEntries.push(`        .${letter} = .{ .offset = ${offset}, .length = 0 }`);
  }
}

// Generate index type and instance
chunks.push(`pub const IndexEntry = struct {
    offset: usize,
    length: usize,
};

pub const Index = std.EnumArray(FirstLetter, IndexEntry);

pub const index = Index.init(.{
${indexEntries.join(",\n")}
    });`);

// Generate the decompression and access function
chunks.push(`var decompressed_data: ?[]u8 = null;
var packages_list: ?[][]const u8 = null;

pub fn init(allocator: std.mem.Allocator) !void {
    // Decompress data
    var data = try allocator.alloc(u8, uncompressed_size);
    errdefer allocator.free(data);

    const result = zstd.decompress(data, &compressed_data);
    decompressed_data = data[0..result.success];

    // Parse package list
    const total_count = std.mem.readInt(u32, data[0..4], .little);
    var packages = try allocator.alloc([]const u8, total_count);
    errdefer allocator.free(packages);

    var pos: usize = 4;
    var i: usize = 0;
    while (i < total_count) : (i += 1) {
        const len = std.mem.readInt(u16, data[pos..][0..2], .little);
        pos += 2;
        packages[i] = data[pos..pos + len];
        pos += len;
    }

    packages_list = packages;
}

pub fn deinit(allocator: std.mem.Allocator) void {
    if (packages_list) |pkgs| {
        allocator.free(pkgs);
        packages_list = null;
    }

    if (decompressed_data) |data| {
        allocator.free(data);
        decompressed_data = null;
    }
}

pub fn getPackages(letter: FirstLetter) []const []const u8 {
    const entry = index.get(letter);
    if (entry.length == 0) return &[_][]const u8{};
    
    return packages_list.?[entry.offset..entry.offset + entry.length];
}`);

// Add biggest_list constant
chunks.push(`pub const biggest_list: usize = ${maxListSize};`);

// Write the output
let zigCode = chunks.join("\n\n");

zigCode = execSync("zig fmt --stdin", {
  input: zigCode,
  encoding: "utf8",
}).toString();

fs.writeFileSync(path.join(__dirname, "..", "src", "cli", "add_completions.zig"), zigCode);

// Clean up temp dir
try {
  fs.rmdirSync(tmpDir);
} catch {}

console.log(`\nGenerated Zig completions for ${packages.length} packages`);
