#!/usr/bin/env bun
/**
 * Generate complete OpenTelemetry semantic conventions for Zig
 *
 * This script generates:
 * 1. Fast attribute system with HTTPHeaderName alignment and bitpacking
 * 2. String constants from @opentelemetry/semantic-conventions npm package
 * 3. HeaderNameList for pre-processed configuration
 * 4. All helper functions for attribute lookups
 *
 * Output: src/telemetry/semconv.zig
 */

import * as semconv from "@opentelemetry/semantic-conventions";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

// Context namespace prefixes (bits 8-11) - these ARE hardcoded
const CONTEXT_BASE = 0x0000;
const CONTEXT_SERVER_REQUEST = 0x0200;
const CONTEXT_SERVER_RESPONSE = 0x0300;
const CONTEXT_FETCH_REQUEST = 0x0500;
const CONTEXT_FETCH_RESPONSE = 0x0700;
const FLAG_OTEL_HEADER = 0x80; // Bit 7
const FLAG_ERROR = 0x8000; // Bit 15

interface HTTPHeaderName {
  name: string; // C++ enum name (e.g., "UserAgent")
  value: number; // Enum value (0-92)
  httpName: string; // HTTP header name (e.g., "user-agent")
}

interface OTelAttribute {
  constName: string; // Original constant name from semconv (e.g., "ATTR_HTTP_REQUEST_METHOD")
  enumName: string; // Zig enum name (e.g., "http_request_method")
  semconvValue: string; // Actual value from semconv (e.g., "http.request.method")
  id: number; // Attribute ID
  isError?: boolean; // Whether this is an error attribute
}

interface OTelHTTPHeader {
  enumName: string; // Zig enum name (e.g., "traceparent")
  httpName: string; // HTTP header name
  id: number; // ID in 93-127 range
}

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
  const lowerName = name.toLowerCase();
  if (ZIG_RESERVED_KEYWORDS.has(lowerName)) {
    return name + "_";
  }
  return name;
}

/**
 * Convert ATTR_HTTP_REQUEST_METHOD to http_request_method
 */
function attrNameToEnumName(attrName: string): string {
  if (!attrName.startsWith("ATTR_")) {
    return attrName.toLowerCase();
  }
  return attrName
    .substring(5) // Remove ATTR_
    .toLowerCase();
}

async function parseHTTPHeaderNames(headerHFile: string, gperfFile: string): Promise<HTTPHeaderName[]> {
  // Read the enum from .h file for ordering
  const hContent = await readFile(headerHFile, "utf-8");
  const enumMatch = hContent.match(/enum class HTTPHeaderName : uint8_t \{([^}]+)\}/s);
  if (!enumMatch) {
    throw new Error("Could not find HTTPHeaderName enum");
  }

  const enumBody = enumMatch[1];
  const enumNames: string[] = [];

  const lines = enumBody
    .split("\n")
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("//"));

  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9]+)/);
    if (match) {
      enumNames.push(match[1]);
    }
  }

  // Read the actual HTTP header names from .gperf file
  const gperfContent = await readFile(gperfFile, "utf-8");
  const headerMap = new Map<string, string>();

  // Parse lines like: "X-XSS-Protection, HTTPHeaderName::XXSSProtection"
  const gperfLines = gperfContent.split("\n");
  for (const line of gperfLines) {
    const match = line.match(/^([A-Za-z0-9-]+),\s*HTTPHeaderName::([A-Za-z0-9]+)$/);
    if (match) {
      const httpName = match[1].toLowerCase(); // HTTP headers are case-insensitive
      const enumName = match[2];
      headerMap.set(enumName, httpName);
    }
  }

  // Build the result array in enum order
  const headers: HTTPHeaderName[] = [];
  for (let i = 0; i < enumNames.length; i++) {
    const enumName = enumNames[i];
    const httpName = headerMap.get(enumName);
    if (!httpName) {
      throw new Error(`Could not find HTTP name for enum ${enumName}`);
    }
    headers.push({
      name: enumName,
      value: i,
      httpName,
    });
  }

  return headers;
}

function collectOTelAttributes(): OTelAttribute[] {
  const attributes: OTelAttribute[] = [];
  let nextId = 0x0000;

  // Priority list of attributes we want to include (in order)
  const priorityAttrs = [
    // HTTP attributes
    "ATTR_HTTP_REQUEST_METHOD",
    "ATTR_HTTP_RESPONSE_STATUS_CODE",
    "ATTR_HTTP_REQUEST_BODY_SIZE",
    "ATTR_HTTP_RESPONSE_BODY_SIZE",
    "ATTR_HTTP_ROUTE",

    // URL attributes
    "ATTR_URL_PATH",
    "ATTR_URL_QUERY",
    "ATTR_URL_SCHEME",
    "ATTR_URL_FULL",
    "ATTR_URL_FRAGMENT",

    // Server attributes
    "ATTR_SERVER_ADDRESS",
    "ATTR_SERVER_PORT",

    // Client attributes
    "ATTR_CLIENT_ADDRESS",
    "ATTR_CLIENT_PORT",

    // Network attributes
    "ATTR_NETWORK_PEER_ADDRESS",
    "ATTR_NETWORK_PEER_PORT",
    "ATTR_NETWORK_LOCAL_ADDRESS",
    "ATTR_NETWORK_LOCAL_PORT",
    "ATTR_NETWORK_PROTOCOL_NAME",
    "ATTR_NETWORK_PROTOCOL_VERSION",
    "ATTR_NETWORK_TRANSPORT",
    "ATTR_NETWORK_TYPE",

    // User agent
    "ATTR_USER_AGENT_ORIGINAL",

    // Service attributes
    "ATTR_SERVICE_NAME",
    "ATTR_SERVICE_VERSION",

    // Telemetry SDK
    "ATTR_TELEMETRY_SDK_NAME",
    "ATTR_TELEMETRY_SDK_VERSION",
    "ATTR_TELEMETRY_SDK_LANGUAGE",

    // OpenTelemetry status
    "ATTR_OTEL_STATUS_CODE",
    "ATTR_OTEL_STATUS_DESCRIPTION",
    "ATTR_OTEL_SCOPE_NAME",
    "ATTR_OTEL_SCOPE_VERSION",
  ];

  // Add priority attributes first (with actual values from semconv)
  for (const attrName of priorityAttrs) {
    const value = (semconv as any)[attrName];
    if (typeof value === "string") {
      attributes.push({
        constName: attrName,
        enumName: attrNameToEnumName(attrName),
        semconvValue: value,
        id: nextId++,
        isError: false,
      });
    }
  }

  // Error attributes get special flag
  const errorAttrs = [
    "ATTR_ERROR_TYPE",
    "ATTR_ERROR_MESSAGE",
    "ATTR_EXCEPTION_TYPE",
    "ATTR_EXCEPTION_MESSAGE",
    "ATTR_EXCEPTION_STACKTRACE",
    "ATTR_EXCEPTION_ESCAPED",
  ];

  let errorId = 0;
  for (const attrName of errorAttrs) {
    const value = (semconv as any)[attrName];
    if (typeof value === "string") {
      attributes.push({
        constName: attrName,
        enumName: attrNameToEnumName(attrName),
        semconvValue: value,
        id: FLAG_ERROR | errorId++,
        isError: true,
      });
    }
  }

  return attributes;
}

function defineOTelHTTPHeaders(httpHeaderCount: number): OTelHTTPHeader[] {
  let nextId = httpHeaderCount;
  // OTel-specific HTTP headers that aren't in HTTPHeaderName
  return [
    { enumName: "traceparent", httpName: "traceparent", id: nextId++ },
    { enumName: "tracestate", httpName: "tracestate", id: nextId++ },
    { enumName: "baggage", httpName: "baggage", id: nextId++ },
  ];
}

function generateHeader(): string {
  return `//! OpenTelemetry Semantic Conventions - Complete
//!
//! This file is auto-generated and contains:
//! 1. Fast attribute system with HTTPHeaderName alignment
//! 2. String constants from @opentelemetry/semantic-conventions
//! 3. HeaderNameList for configuration preprocessing
//! 4. Helper functions for attribute lookups
//!
//! DO NOT EDIT - run \`bun run packages/bun-otel/scripts/generate-semconv-complete.ts\`

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;

`;
}

function generateAttributeKeyEnum(
  baseAttrs: OTelAttribute[],
  httpHeaders: HTTPHeaderName[],
  otelHeaders: OTelHTTPHeader[],
): string {
  const lines = [
    "// ============================================================================",
    "// Fast Attribute System with HTTPHeaderName Alignment",
    "// ============================================================================",
    "",
    "/// Fast attribute key with HTTPHeaderName alignment and context namespacing",
    "///",
    "/// Bit layout (u16):",
    "/// - Bits 0-6 (7 bits): Base ID (0-127)",
    "///   - 0-92: HTTPHeaderName values from WebCore",
    "///   - 93-127: OTel-specific HTTP headers (traceparent, etc.)",
    "/// - Bit 7: OTel-specific header flag (when in HTTP context)",
    "/// - Bits 8-11 (4 bits): Context namespace",
    "///   - 0x000: Base OTel attributes",
    "///   - 0x200: Server request headers",
    "///   - 0x300: Server response headers",
    "///   - 0x500: Fetch request headers",
    "///   - 0x700: Fetch response headers",
    "/// - Bit 15: Error flag (0x8000)",
    "pub const AttributeKey = enum(u16) {",
    "    // Base OTel attributes (context = 0x000)",
  ];

  for (const attr of baseAttrs) {
    lines.push(`    ${attr.enumName} = 0x${attr.id.toString(16).toUpperCase().padStart(4, "0")},`);
  }

  lines.push("");
  lines.push(`    pub const COUNT = ${baseAttrs.filter(a => !a.isError).length};`);
  lines.push("");
  lines.push("    // Context namespace constants");
  lines.push("    pub const CONTEXT_BASE: u16 = 0x0000;");
  lines.push("    pub const CONTEXT_SERVER_REQUEST: u16 = 0x0200;");
  lines.push("    pub const CONTEXT_SERVER_RESPONSE: u16 = 0x0300;");
  lines.push("    pub const CONTEXT_FETCH_REQUEST: u16 = 0x0500;");
  lines.push("    pub const CONTEXT_FETCH_RESPONSE: u16 = 0x0700;");
  lines.push("    pub const FLAG_OTEL_HEADER: u16 = 0x0080;");
  lines.push("    pub const FLAG_ERROR: u16 = 0x8000;");
  lines.push("");
  lines.push("    /// Create header attribute key from context and HTTPHeaderName ID");
  lines.push("    pub inline fn fromHeader(context_: u16, header_id: u8) u16 {");
  lines.push("        return context_ | @as(u16, header_id);");
  lines.push("    }");
  lines.push("");
  lines.push("    /// Create OTel header attribute key from context and header ID");
  lines.push("    pub inline fn fromOTelHeader(context_: u16, header_id: u8) u16 {");
  lines.push("        return context_ | FLAG_OTEL_HEADER | @as(u16, header_id);");
  lines.push("    }");
  lines.push("");
  lines.push("    /// Extract base ID (bits 0-6)");
  lines.push("    pub inline fn baseId(self: AttributeKey) u8 {");
  lines.push("        return @intCast(@intFromEnum(self) & 0x7F);");
  lines.push("    }");
  lines.push("");
  lines.push("    /// Extract context (bits 8-11)");
  lines.push("    pub inline fn context(self: AttributeKey) u16 {");
  lines.push("        return @intFromEnum(self) & 0x0F00;");
  lines.push("    }");
  lines.push("");
  lines.push("    /// Check if this is an OTel-specific header (bit 7)");
  lines.push("    pub inline fn isOTelHeader(self: AttributeKey) bool {");
  lines.push("        return (@intFromEnum(self) & FLAG_OTEL_HEADER) != 0;");
  lines.push("    }");
  lines.push("");
  lines.push("    /// Check if this is an error attribute (bit 15)");
  lines.push("    pub inline fn isError(self: AttributeKey) bool {");
  lines.push("        return (@intFromEnum(self) & FLAG_ERROR) != 0;");
  lines.push("    }");
  lines.push("};");
  lines.push("");

  return lines.join("\n");
}

function generateHelperFunctions(
  baseAttrs: OTelAttribute[],
  httpHeaders: HTTPHeaderName[],
  otelHeaders: OTelHTTPHeader[],
): string {
  const lines = [];

  // fastAttributeNameToString
  lines.push("/// Convert attribute key to semantic convention string");
  lines.push("/// For HTTP headers, builds the full attribute name");
  lines.push("pub fn fastAttributeNameToString(key: AttributeKey) []const u8 {");
  lines.push("    // Check if this has a context (HTTP header)");
  lines.push("    const ctx = key.context();");
  lines.push("    if (ctx != 0) {");
  lines.push("        const base_id = key.baseId();");
  lines.push("        const is_otel_header = key.isOTelHeader();");
  lines.push("");
  lines.push("        if (is_otel_header) {");
  lines.push("            // OTel-specific HTTP headers (93-127)");
  lines.push("            return switch (base_id) {");

  for (const header of otelHeaders) {
    // Build the full attribute name based on context
    lines.push(`                ${header.id} => switch (ctx) {`);
    lines.push(
      `                    AttributeKey.CONTEXT_SERVER_REQUEST, AttributeKey.CONTEXT_FETCH_REQUEST => "http.request.header.${header.httpName}",`,
    );
    lines.push(
      `                    AttributeKey.CONTEXT_SERVER_RESPONSE, AttributeKey.CONTEXT_FETCH_RESPONSE => "http.response.header.${header.httpName}",`,
    );
    lines.push(`                    else => "${header.httpName}",`);
    lines.push(`                },`);
  }

  lines.push('                else => "unknown-otel-header",');
  lines.push("            };");
  lines.push("        } else {");
  lines.push("            // HTTPHeaderName (0-92)");
  lines.push("            const header_name = switch (base_id) {");

  for (const header of httpHeaders) {
    lines.push(`                ${header.value} => "${header.httpName}",`);
  }

  lines.push('                else => "unknown",');
  lines.push("            };");
  lines.push("");
  lines.push("            // Build full attribute name based on context");
  lines.push("            return switch (ctx) {");
  lines.push(
    '                AttributeKey.CONTEXT_SERVER_REQUEST, AttributeKey.CONTEXT_FETCH_REQUEST => "http.request.header." ++ header_name,',
  );
  lines.push(
    '                AttributeKey.CONTEXT_SERVER_RESPONSE, AttributeKey.CONTEXT_FETCH_RESPONSE => "http.response.header." ++ header_name,',
  );
  lines.push("                else => header_name,");
  lines.push("            };");
  lines.push("        }");
  lines.push("    }");
  lines.push("");
  lines.push("    // Base OTel attributes - use the actual semconv values");
  lines.push("    return switch (key) {");

  for (const attr of baseAttrs) {
    lines.push(`        .${attr.enumName} => ${attr.constName},`);
  }

  lines.push("    };");
  lines.push("}");
  lines.push("");

  // stringToFastAttributeKey
  lines.push("/// Convert semantic convention string to attribute key");
  lines.push("/// Returns null if not a recognized base attribute");
  lines.push("/// Note: HTTP headers are looked up separately via context-specific functions");
  lines.push("pub fn stringToFastAttributeKey(name: []const u8) ?AttributeKey {");

  // Group base attributes by prefix for optimization
  const prefixGroups = new Map<string, OTelAttribute[]>();
  for (const attr of baseAttrs) {
    const dotIdx = attr.semconvValue.indexOf(".");
    const prefix = dotIdx > 0 ? attr.semconvValue.substring(0, dotIdx + 1) : "";
    if (!prefixGroups.has(prefix)) {
      prefixGroups.set(prefix, []);
    }
    prefixGroups.get(prefix)!.push(attr);
  }

  for (const [prefix, attrs] of Array.from(prefixGroups.entries()).sort((a, b) => b[1].length - a[1].length)) {
    if (prefix) {
      lines.push(`    if (std.mem.startsWith(u8, name, "${prefix}")) {`);
      for (const attr of attrs) {
        lines.push(`        if (std.mem.eql(u8, name, ${attr.constName})) return .${attr.enumName};`);
      }
      lines.push("        return null;");
      lines.push("    }");
    } else {
      for (const attr of attrs) {
        lines.push(`    if (std.mem.eql(u8, name, ${attr.constName})) return .${attr.enumName};`);
      }
    }
  }

  lines.push("    return null;");
  lines.push("}");
  lines.push("");

  // HTTP header lookup functions
  lines.push("/// Look up HTTPHeaderName ID from string");
  lines.push("pub fn httpHeaderNameFromString(name: []const u8) ?u8 {");
  for (const h of httpHeaders) {
    lines.push(`    if (std.mem.eql(u8, name, "${h.httpName}")) return ${h.value};`);
  }
  lines.push("    return null;");
  lines.push("}");
  lines.push("");

  lines.push("/// Look up OTel-specific header ID from string");
  lines.push("pub fn otelHeaderFromString(name: []const u8) ?u8 {");
  for (const h of otelHeaders) {
    lines.push(`    if (std.mem.eql(u8, name, "${h.httpName}")) return ${h.id};`);
  }
  lines.push("    return null;");
  lines.push("}");
  lines.push("");

  lines.push("/// Convert HTTPHeaderName ID to string");
  lines.push("pub fn httpHeaderNameToString(id: u8) []const u8 {");
  lines.push("    return switch (id) {");
  for (const h of httpHeaders) {
    lines.push(`        ${h.value} => "${h.httpName}",`);
  }
  lines.push('        else => "unknown",');
  lines.push("    };");
  lines.push("}");
  lines.push("");

  return lines.join("\n");
}

function generateHeaderNameList(httpHeaders: HTTPHeaderName[], otelHeaders: OTelHTTPHeader[]): string {
  return `// ============================================================================
// HeaderNameList - Pre-processed configuration for efficient header capture
// ============================================================================

/// Pre-processed header name list for efficient header capture
/// Separates HTTPHeaderName (fast path) from OTel-specific headers (slow path)
pub const HeaderNameList = struct {
    /// HTTPHeaderName IDs (0-92) - can use fast FetchHeaders lookup
    fast_headers: std.ArrayList(u8),

    /// OTel-specific header names (traceparent, etc.) - need string lookup
    slow_header_names: std.ArrayList(bun.String),
    slow_header_ids: std.ArrayList(u8),

    /// Context for building full attribute names
    context: u16,

    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, context: u16) HeaderNameList {
        return .{
            .fast_headers = std.ArrayList(u8).init(allocator),
            .slow_header_names = std.ArrayList(bun.String).init(allocator),
            .slow_header_ids = std.ArrayList(u8).init(allocator),
            .context = context,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *HeaderNameList) void {
        self.fast_headers.deinit();
        for (self.slow_header_names.items) |str| {
            str.deref();
        }
        self.slow_header_names.deinit();
        self.slow_header_ids.deinit();
    }

    /// Parse a JS array of header name strings into fast/slow buckets
    pub fn fromJS(allocator: std.mem.Allocator, global: *JSGlobalObject, js_array: JSValue, context: u16) !HeaderNameList {
        var list = HeaderNameList.init(allocator, context);
        errdefer list.deinit();

        const len = try js_array.getLength(global);
        var i: u32 = 0;
        while (i < len) : (i += 1) {
            const name_js = try js_array.getIndex(global, i);
            if (!name_js.isString()) continue;

            var name_zig: ZigString = ZigString.Empty;
            try name_js.toZigString(&name_zig, global);
            const name_slice = name_zig.toSlice(allocator);
            defer name_slice.deinit();

            // Try to match HTTPHeaderName first
            if (httpHeaderNameFromString(name_slice.slice())) |header_id| {
                try list.fast_headers.append(header_id);
            } else if (otelHeaderFromString(name_slice.slice())) |otel_header_id| {
                // OTel-specific header
                const name_str = bun.String.fromBytes(name_slice.slice());
                try list.slow_header_names.append(name_str);
                try list.slow_header_ids.append(otel_header_id);
            }
            // Unknown headers are silently ignored
        }

        return list;
    }

    /// Convert back to JS array for debugging/serialization
    pub fn toJS(self: *const HeaderNameList, global: *JSGlobalObject) JSValue {
        const total_len = self.fast_headers.items.len + self.slow_header_names.items.len;
        const array = JSValue.createEmptyArray(global, total_len);

        var idx: u32 = 0;

        // Add fast headers
        for (self.fast_headers.items) |header_id| {
            const name = httpHeaderNameToString(header_id);
            const name_js = ZigString.init(name).toJS(global);
            array.putIndex(global, idx, name_js);
            idx += 1;
        }

        // Add slow headers
        for (self.slow_header_names.items) |name_str| {
            const name_js = name_str.toJS(global);
            array.putIndex(global, idx, name_js);
            idx += 1;
        }

        return array;
    }
};

`;
}

function generateStringConstants(): string {
  const lines: string[] = [];

  lines.push("// ============================================================================");
  lines.push("// OpenTelemetry Semantic Convention String Constants");
  lines.push("// ============================================================================");
  lines.push("");
  lines.push("// Generated from @opentelemetry/semantic-conventions npm package");
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
  const repoRoot = join(import.meta.dir, "../../..");
  const headerHFile = join(repoRoot, "src/bun.js/bindings/webcore/HTTPHeaderNames.h");
  const gperfFile = join(repoRoot, "src/bun.js/bindings/webcore/HTTPHeaderNames.gperf");
  const outputFile = join(repoRoot, "src/telemetry/semconv.zig");

  console.log("🔍 Parsing HTTPHeaderNames...");
  const httpHeaders = await parseHTTPHeaderNames(headerHFile, gperfFile);
  console.log(`   Found ${httpHeaders.length} HTTP headers`);

  console.log("📦 Collecting attributes from @opentelemetry/semantic-conventions...");
  const baseAttrs = collectOTelAttributes();
  const normalAttrs = baseAttrs.filter(a => !a.isError);
  const errorAttrs = baseAttrs.filter(a => a.isError);
  console.log(`   Found ${normalAttrs.length} normal attributes`);
  console.log(`   Found ${errorAttrs.length} error attributes`);

  console.log("🔧 Defining OTel-specific HTTP headers...");
  const otelHeaders = defineOTelHTTPHeaders(httpHeaders.length);
  console.log(`   Defined ${otelHeaders.length} OTel headers`);

  const constantCount = Object.entries(semconv).filter(([_, v]) => typeof v === "string").length;
  console.log(`   Total string constants: ${constantCount}`);

  console.log("📝 Generating complete semconv.zig...");
  const code = [
    generateHeader(),
    generateAttributeKeyEnum(baseAttrs, httpHeaders, otelHeaders),
    generateHelperFunctions(baseAttrs, httpHeaders, otelHeaders),
    generateHeaderNameList(httpHeaders, otelHeaders),
    generateStringConstants(),
  ].join("\n");

  await writeFile(outputFile, code);

  console.log(`✅ Generated ${outputFile}`);
  console.log("");
  console.log("📊 Summary:");
  console.log(`   ${normalAttrs.length} base OTel attributes`);
  console.log(`   ${errorAttrs.length} error attributes`);
  console.log(`   ${httpHeaders.length} HTTPHeaderName mappings`);
  console.log(`   ${otelHeaders.length} OTel-specific HTTP headers`);
  console.log(`   ${constantCount} total string constants from npm package`);
  console.log("");
  console.log("📊 Attribute ID allocation:");
  console.log(
    `   0x0000-0x${(normalAttrs.length - 1).toString(16).padStart(4, "0").toUpperCase()}: Base OTel attributes`,
  );
  console.log(`   0x0200-0x025C: Server request headers (HTTPHeaderName)`);
  console.log(`   0x0280-0x025F: Server request headers (OTel-specific)`);
  console.log(`   0x0300-0x035C: Server response headers`);
  console.log(`   0x0500-0x055C: Fetch request headers`);
  console.log(`   0x0700-0x075C: Fetch response headers`);
  console.log(`   0x8000-0x${(0x8000 + errorAttrs.length - 1).toString(16).toUpperCase()}: Error attributes`);

  // Format the generated Zig file
  console.log("");
  console.log("🔧 Formatting with zig fmt...");
  try {
    const proc = Bun.spawn(["vendor/zig/zig", "fmt", outputFile], {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
    console.log("   ✓ Formatted successfully");
  } catch (err) {
    console.warn("   ⚠ Could not format:", err);
  }
}

main().catch(console.error);
