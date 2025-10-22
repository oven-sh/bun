#!/usr/bin/env bun
/**
 * Generate Zig semantic convention constants from OpenTelemetry C++ headers
 *
 * This script fetches OpenTelemetry C++ semantic convention header files from GitHub
 * and generates a Zig file with equivalent string constants for use in
 * Bun's telemetry implementation.
 *
 * Usage: bun run packages/bun-otel/scripts/genkeys.ts
 *
 * Output: src/bun.js/telemetry/semconv.zig
 *
 * Example usage in Zig code:
 * ```zig
 * const semconv = @import("telemetry/semconv.zig");
 *
 * // Use attribute names
 * map.set(semconv.http.http_request_method, method_value);
 * map.set(semconv.url.url_scheme, scheme_value);
 * map.set(semconv.server.server_address, host_value);
 *
 * // Use value constants
 * map.set(semconv.http.http_request_method, semconv.http.http_request_method_values.get);
 * map.set(semconv.network.network_transport, semconv.network.network_transport_values.tcp);
 * ```
 *
 * The script uses GitHub API to fetch files and caches them locally in build/.semconv-cache/
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// GitHub API configuration
const GITHUB_REPO = "open-telemetry/opentelemetry-cpp";
const GITHUB_BRANCH = "main"; // or specific tag like "v1.16.1"
const SEMCONV_PATH = "api/include/opentelemetry/semconv";

// Local paths
const CACHE_DIR = join(import.meta.dir, "..", "..", "..", "build", ".semconv-cache");
const OUTPUT_PATH = join(import.meta.dir, "..", "..", "..", "src", "bun.js", "telemetry", "semconv.zig");

interface Attribute {
  name: string; // C++ constant name (e.g., "kHttpRequestMethod")
  value: string; // Attribute string value (e.g., "http.request.method")
  comment: string; // Documentation comment
  namespace: string; // C++ namespace (e.g., "http")
}

interface ValueConstant {
  name: string; // C++ constant name (e.g., "kGet")
  value: string; // Value string (e.g., "GET")
  comment: string; // Documentation comment
  namespace: string; // Parent namespace (e.g., "http")
  valuesNamespace: string; // Values namespace (e.g., "HttpRequestMethodValues")
}

interface GitHubContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string;
  type: string;
}

/**
 * Fetch directory contents from GitHub API
 */
async function fetchGitHubDirectory(path: string): Promise<GitHubContent[]> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${GITHUB_BRANCH}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "bun-otel-genkeys",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as GitHubContent[];
}

/**
 * Fetch file content from GitHub
 */
async function fetchGitHubFile(downloadUrl: string): Promise<string> {
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
  } catch (err) {
    // Directory might already exist, ignore error
  }
}

/**
 * Get cached file or fetch from GitHub
 */
async function getCachedOrFetch(fileName: string, downloadUrl: string): Promise<string> {
  const cachePath = join(CACHE_DIR, fileName);

  // Try to read from cache
  try {
    const cached = await readFile(cachePath, "utf-8");
    console.log(`  ✓ ${fileName} (cached)`);
    return cached;
  } catch {
    // Cache miss, fetch from GitHub
    console.log(`  ⬇ ${fileName} (downloading...)`);
    const content = await fetchGitHubFile(downloadUrl);

    // Write to cache
    try {
      await writeFile(cachePath, content, "utf-8");
    } catch (err) {
      // Ignore cache write errors
      console.warn(`  ⚠ Could not cache ${fileName}:`, err);
    }

    return content;
  }
}

/**
 * Parse a C++ header file content to extract semantic convention attributes
 */
function parseHeaderFileContent(content: string): { attributes: Attribute[]; values: ValueConstant[] } {
  const attributes: Attribute[] = [];
  const values: ValueConstant[] = [];

  // Extract inner namespace from the file (skip "semconv" parent namespace)
  // Pattern: namespace semconv { namespace ACTUAL_NAME { ... } }
  const namespaceMatches = content.matchAll(/namespace\s+(\w+)\s*\{/g);
  const namespaces = Array.from(namespaceMatches).map(m => m[1]);

  // Get the second namespace (first is "semconv")
  const namespace = namespaces.find(ns => ns !== "semconv");
  if (!namespace) {
    return { attributes, values };
  }

  // Match value constants within Values namespaces (do this first to track what we've seen)
  const valuesNamespaceRegex = /namespace\s+(\w+Values)\s*\{([\s\S]*?)\}/g;
  const valueConstantRanges: Array<{ start: number; end: number }> = [];

  let valuesMatch;
  while ((valuesMatch = valuesNamespaceRegex.exec(content)) !== null) {
    const [fullMatch, valuesNamespace, valuesContent] = valuesMatch;
    const start = valuesMatch.index;
    const end = start + fullMatch.length;
    valueConstantRanges.push({ start, end });

    const valueRegex = /\/\*\*\s*([\s\S]*?)\s*\*\/\s*static\s+constexpr\s+const\s+char\s*\*\s*k(\w+)\s*=\s*"([^"]+)"/g;

    let valueMatch;
    while ((valueMatch = valueRegex.exec(valuesContent)) !== null) {
      const [, rawComment, name, value] = valueMatch;
      const comment = rawComment
        .split("\n")
        .map(line => line.trim().replace(/^\*\s*/, ""))
        .filter(line => line.length > 0)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      values.push({
        name: `k${name}`,
        value,
        comment,
        namespace,
        valuesNamespace,
      });
    }
  }

  // Match attribute definitions (but skip any that are inside Values namespaces)
  // Pattern: static constexpr const char *kAttributeName = "attribute.name";
  const attributeRegex =
    /\/\*\*\s*([\s\S]*?)\s*\*\/\s*static\s+constexpr\s+const\s+char\s*\*\s*k(\w+)\s*=\s*"([^"]+)"/g;

  let match;
  while ((match = attributeRegex.exec(content)) !== null) {
    const matchIndex = match.index;

    // Skip if this match is inside a Values namespace
    const isInValuesNamespace = valueConstantRanges.some(range => matchIndex >= range.start && matchIndex < range.end);

    if (isInValuesNamespace) {
      continue;
    }

    const [, rawComment, name, value] = match;
    // Clean up comment - remove leading asterisks and extra whitespace
    const comment = rawComment
      .split("\n")
      .map(line => line.trim().replace(/^\*\s*/, ""))
      .filter(line => line.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    attributes.push({
      name: `k${name}`,
      value,
      comment,
      namespace,
    });
  }

  return { attributes, values };
}

/**
 * Zig reserved keywords that need to be escaped with @"..."
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
 * Convert a C++ constant name to a Zig-friendly identifier
 * kHttpRequestMethod -> http_request_method
 */
function toZigName(cppName: string): string {
  // Remove leading 'k' and convert PascalCase to snake_case
  const withoutK = cppName.replace(/^k/, "");
  const snakeCase = withoutK.replace(/([A-Z])/g, (_, char) => `_${char.toLowerCase()}`).replace(/^_/, "");

  // Append underscore to Zig reserved keywords
  if (ZIG_RESERVED_KEYWORDS.has(snakeCase)) {
    return snakeCase + "_";
  }

  return snakeCase;
}

/**
 * Escape Zig string if needed
 */
function escapeZigString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Generate Zig file content
 */
function generateZigFile(allAttributes: Map<string, Attribute[]>, allValues: Map<string, ValueConstant[]>): string {
  const lines: string[] = [];

  // Header
  lines.push("//! OpenTelemetry Semantic Conventions");
  lines.push("//!");
  lines.push("//! This file is auto-generated from OpenTelemetry C++ semantic convention headers.");
  lines.push("//! DO NOT EDIT - run `bun run packages/bun-otel/scripts/genkeys.ts` to regenerate.");
  lines.push("//!");
  lines.push("//! Source: https://github.com/open-telemetry/opentelemetry-cpp");
  lines.push("");

  // Generate namespaces
  const sortedNamespaces = Array.from(allAttributes.keys()).sort();

  for (const namespace of sortedNamespaces) {
    const attributes = allAttributes.get(namespace) || [];
    const values = allValues.get(namespace) || [];

    if (attributes.length === 0 && values.length === 0) continue;

    const zigNamespace = ZIG_RESERVED_KEYWORDS.has(namespace) ? namespace + "_" : namespace;

    lines.push(`/// Semantic conventions for ${namespace}`);
    lines.push(`pub const ${zigNamespace} = struct {`);

    // Generate attributes
    if (attributes.length > 0) {
      lines.push("    // Attributes");
      for (const attr of attributes) {
        // Add comment (wrap long lines)
        const commentLines = wrapComment(attr.comment, 100);
        for (const commentLine of commentLines) {
          lines.push(`    /// ${commentLine}`);
        }
        const zigName = toZigName(attr.name);
        lines.push(`    pub const ${zigName} = "${escapeZigString(attr.value)}";`);
        lines.push("");
      }
    }

    // Generate value constants grouped by their Values namespace
    if (values.length > 0) {
      const valuesByNamespace = new Map<string, ValueConstant[]>();
      for (const val of values) {
        const existing = valuesByNamespace.get(val.valuesNamespace) || [];
        existing.push(val);
        valuesByNamespace.set(val.valuesNamespace, existing);
      }

      for (const [valuesNs, vals] of valuesByNamespace) {
        // Convert HttpRequestMethodValues -> request_method_values
        const zigValuesNs = valuesNs
          .replace(/^(\w+)Values$/, "$1_values")
          .replace(/([A-Z])/g, (_, char) => `_${char.toLowerCase()}`)
          .replace(/^_/, "");

        lines.push(`    // ${valuesNs}`);
        lines.push(`    pub const ${zigValuesNs} = struct {`);

        for (const val of vals) {
          const commentLines = wrapComment(val.comment, 96);
          for (const commentLine of commentLines) {
            lines.push(`        /// ${commentLine}`);
          }
          const zigName = toZigName(val.name);
          lines.push(`        pub const ${zigName} = "${escapeZigString(val.value)}";`);
          lines.push("");
        }

        lines.push("    };");
        lines.push("");
      }
    }

    lines.push("};");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Wrap a long comment into multiple lines
 */
function wrapComment(comment: string, maxLength: number): string[] {
  if (comment.length <= maxLength) {
    return [comment];
  }

  const words = comment.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 > maxLength) {
      if (currentLine) {
        lines.push(currentLine.trim());
      }
      currentLine = word;
    } else {
      currentLine += (currentLine ? " " : "") + word;
    }
  }

  if (currentLine) {
    lines.push(currentLine.trim());
  }

  return lines;
}

async function main() {
  console.log("Generating OpenTelemetry semantic convention constants for Zig...");
  console.log(`Source: ${GITHUB_REPO}@${GITHUB_BRANCH}`);
  console.log("");

  // Ensure cache directory exists
  await ensureCacheDir();

  // Fetch directory listing from GitHub
  console.log(`Fetching file list from GitHub API...`);
  const contents = await fetchGitHubDirectory(SEMCONV_PATH);

  // Filter for attribute header files
  const headerFiles = contents.filter(f => f.type === "file" && f.name.endsWith("_attributes.h"));

  console.log(`Found ${headerFiles.length} attribute header files\n`);

  const allAttributes = new Map<string, Attribute[]>();
  const allValues = new Map<string, ValueConstant[]>();

  // Parse each header file
  for (const file of headerFiles) {
    const content = await getCachedOrFetch(file.name, file.download_url);
    const { attributes, values } = await parseHeaderFileContent(content);

    if (attributes.length > 0 || values.length > 0) {
      const namespace = attributes[0]?.namespace || values[0]?.namespace;
      if (namespace) {
        // Merge attributes for the same namespace
        const existingAttrs = allAttributes.get(namespace) || [];
        allAttributes.set(namespace, [...existingAttrs, ...attributes]);

        if (values.length > 0) {
          const existingVals = allValues.get(namespace) || [];
          allValues.set(namespace, [...existingVals, ...values]);
        }
        console.log(`    ${attributes.length} attributes, ${values.length} values`);
      }
    }
  }

  // Generate Zig file
  const zigContent = generateZigFile(allAttributes, allValues);

  // Check if file exists and compare content
  let shouldWrite = true;
  try {
    const existingContent = await readFile(OUTPUT_PATH, "utf-8");
    if (existingContent === zigContent) {
      shouldWrite = false;
      console.log(`\n✓ ${OUTPUT_PATH} is up to date (no changes)`);
    }
  } catch {
    // File doesn't exist, we'll write it
  }

  // Write output only if content changed
  if (shouldWrite) {
    await writeFile(OUTPUT_PATH, zigContent, "utf-8");
    console.log(`\n✓ Generated ${OUTPUT_PATH}`);

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

  console.log(`  Total namespaces: ${allAttributes.size}`);
  console.log(`  Total attributes: ${Array.from(allAttributes.values()).reduce((sum, arr) => sum + arr.length, 0)}`);
  console.log(`  Total values: ${Array.from(allValues.values()).reduce((sum, arr) => sum + arr.length, 0)}`);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
