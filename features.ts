#!/usr/bin/env bun
/**
 * Feature tracking tool for Bun
 *
 * Manages feature completeness tracking across different areas (OTEL, etc.)
 * Inspired by MDN browser-compat-data
 *
 * Usage:
 *   bun features.ts list otel              # List all OTEL features
 *   bun features.ts stats otel             # Show completion statistics
 *   bun features.ts export otel markdown   # Generate markdown table
 *   bun features.ts update otel.http.server.span_creation working  # Update status
 *   bun features.ts add otel.http.server.new_feature --status=missing --nodejs=true --bun=false
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ============================================================================
// Types
// ============================================================================

type FeatureStatus = "✅" | "⚠️" | "❌" | "➖";

interface Feature {
  nodejs: FeatureStatus;
  bun: FeatureStatus;
  notes?: string;
  tests?: string[];
  commits?: string[];
  priority?: "high" | "medium" | "low";
}

interface FeatureCategory {
  [key: string]: Feature | FeatureCategory;
}

interface FeatureDatabase {
  [category: string]: FeatureCategory;
}

// ============================================================================
// Constants
// ============================================================================

const FEATURE_FILE = resolve(import.meta.dir, "packages/bun-otel/features.json");
const STATUS_LABELS: Record<FeatureStatus, string> = {
  "✅": "working",
  "⚠️": "partial",
  "❌": "missing",
  "➖": "n/a",
};

// ============================================================================
// Database Operations
// ============================================================================

function loadFeatures(): FeatureDatabase {
  if (!existsSync(FEATURE_FILE)) {
    return {};
  }
  return JSON.parse(readFileSync(FEATURE_FILE, "utf-8"));
}

function saveFeatures(db: FeatureDatabase): void {
  writeFileSync(FEATURE_FILE, JSON.stringify(db, null, 2) + "\n");
}

function getFeature(db: FeatureDatabase, path: string): Feature | FeatureCategory | undefined {
  const parts = path.split(".");
  let current: any = db;
  for (const part of parts) {
    if (!current[part]) return undefined;
    current = current[part];
  }
  return current;
}

function setFeature(db: FeatureDatabase, path: string, feature: Feature): void {
  const parts = path.split(".");
  let current: any = db;

  // Navigate to parent
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }

  // Set feature
  current[parts[parts.length - 1]] = feature;
}

function isFeature(obj: any): obj is Feature {
  return obj && typeof obj === "object" && "nodejs" in obj && "bun" in obj;
}

// ============================================================================
// Traversal & Statistics
// ============================================================================

interface FeatureStats {
  total: number;
  working: number;
  partial: number;
  missing: number;
  na: number;
  completion: number; // Percentage
}

function calculateStats(category: FeatureCategory): FeatureStats {
  const stats: FeatureStats = {
    total: 0,
    working: 0,
    partial: 0,
    missing: 0,
    na: 0,
    completion: 0,
  };

  function traverse(obj: FeatureCategory | Feature) {
    if (isFeature(obj)) {
      stats.total++;
      if (obj.bun === "✅") stats.working++;
      else if (obj.bun === "⚠️") stats.partial++;
      else if (obj.bun === "❌") stats.missing++;
      else if (obj.bun === "➖") stats.na++;
    } else {
      for (const key in obj) {
        traverse(obj[key]);
      }
    }
  }

  traverse(category);

  // Calculate completion: working = 100%, partial = 50%, missing = 0%
  const implementedCount = stats.working + stats.partial * 0.5;
  stats.completion = stats.total > 0 ? Math.round((implementedCount / stats.total) * 100) : 0;

  return stats;
}

function listFeatures(category: FeatureCategory, prefix = ""): void {
  for (const [key, value] of Object.entries(category)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (isFeature(value)) {
      const emoji = value.bun;
      const impl =
        value.nodejs === "✅" && value.bun === "✅"
          ? "Both"
          : value.bun === "✅" || value.bun === "⚠️"
            ? `Bun ${STATUS_LABELS[value.bun]}`
            : "Node only";
      console.log(`${emoji} ${path} (${impl})`);
      if (value.notes) {
        console.log(`  ${value.notes}`);
      }
    } else {
      console.log(`\n📁 ${path}`);
      listFeatures(value, path);
    }
  }
}

// ============================================================================
// Markdown Export
// ============================================================================

interface MarkdownRow {
  feature: string;
  nodejs: string;
  bun: string;
  status: string;
  notes: string;
}

function exportMarkdown(category: FeatureCategory, categoryName: string): string {
  const rows: MarkdownRow[] = [];

  function traverse(obj: FeatureCategory | Feature, path: string[] = []) {
    if (isFeature(obj)) {
      rows.push({
        feature: path.join(" > "),
        nodejs: obj.nodejs,
        bun: obj.bun,
        status: `**${STATUS_LABELS[obj.bun].charAt(0).toUpperCase() + STATUS_LABELS[obj.bun].slice(1)}**`,
        notes: obj.notes || "",
      });
    } else {
      for (const [key, value] of Object.entries(obj)) {
        traverse(value, [...path, key]);
      }
    }
  }

  traverse(category);

  const stats = calculateStats(category);

  // Generate markdown
  let md = `# ${categoryName} Features\n\n`;
  md += `**Completion:** ${stats.completion}% (${stats.working} working, ${stats.partial} partial, ${stats.missing} missing)\n\n`;
  md += `| Feature | Node.js | Bun | Status | Notes |\n`;
  md += `|---------|---------|-----|--------|-------|\n`;

  for (const row of rows) {
    md += `| ${row.feature} | ${row.nodejs} | ${row.bun} | ${row.status} | ${row.notes} |\n`;
  }

  return md;
}

// ============================================================================
// Import from Markdown
// ============================================================================

function parseStatusFromMarkdown(statusCell: string): FeatureStatus {
  const lower = statusCell.toLowerCase();
  if (lower.includes("working")) return "✅";
  if (lower.includes("partial")) return "⚠️";
  if (lower.includes("missing") || lower.includes("not implemented")) return "❌";
  if (lower.includes("n/a")) return "➖";
  return "❌";
}

function parseStatusFromEmoji(cell: string): FeatureStatus {
  if (cell.includes("✅")) return "✅";
  if (cell.includes("⚠️")) return "⚠️";
  if (cell.includes("➖")) return "➖";
  return "❌";
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/`/g, "") // Remove backticks
    .replace(/\([^)]*\)/g, "") // Remove parentheses and content
    .replace(/\s+/g, "_") // Spaces to underscores
    .replace(/[^a-z0-9_]/g, "") // Remove special chars
    .replace(/_+/g, "_") // Collapse multiple underscores
    .replace(/^_|_$/g, ""); // Trim underscores
}

interface ParsedTable {
  category: string;
  features: Array<{
    name: string;
    nodejs: FeatureStatus;
    bun: FeatureStatus;
    notes: string;
  }>;
}

function parseMarkdownTable(lines: string[], startIdx: number): ParsedTable | null {
  // Find the category from the header above the table
  let category = "";
  for (let i = startIdx - 1; i >= 0; i--) {
    if (lines[i].startsWith("###")) {
      category = lines[i].replace(/^###\s*\d+\.\s*/, "").trim();
      break;
    }
  }

  if (!category) return null;

  // Parse table header to find column indices
  const headerLine = lines[startIdx];
  const separatorLine = lines[startIdx + 1];

  if (!headerLine.includes("|") || !separatorLine.includes("|")) {
    return null;
  }

  const headers = headerLine.split("|").map(h => h.trim().toLowerCase());

  // Find column indices
  const featureIdx = headers.findIndex(h => h.includes("feature"));
  const nodejsIdx = headers.findIndex(h => h.includes("node"));
  const bunIdx = headers.findIndex(h => h.includes("bun"));
  const statusIdx = headers.findIndex(h => h.includes("status"));
  const notesIdx = headers.findIndex(h => h.includes("notes"));

  if (featureIdx === -1 || statusIdx === -1) {
    return null;
  }

  const features: ParsedTable["features"] = [];

  // Parse data rows
  for (let i = startIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim();

    // Stop at empty line or next section
    if (!line || line.startsWith("#") || !line.includes("|")) {
      break;
    }

    // Skip footnote references
    if (line.startsWith("[^")) {
      continue;
    }

    const cells = line.split("|").map(c => c.trim());

    // Skip if not enough cells
    if (cells.length < Math.max(featureIdx, nodejsIdx, bunIdx, statusIdx, notesIdx)) {
      continue;
    }

    const featureName = cells[featureIdx];
    if (!featureName || featureName === "---") continue;

    features.push({
      name: featureName,
      nodejs: nodejsIdx !== -1 ? parseStatusFromEmoji(cells[nodejsIdx]) : "✅",
      bun: bunIdx !== -1 ? parseStatusFromEmoji(cells[bunIdx]) : "❌",
      notes: notesIdx !== -1 ? cells[notesIdx] : "",
    });
  }

  return { category, features };
}

function mapCategoryToPath(category: string): string {
  const lower = category.toLowerCase();

  if (lower.includes("http") && lower.includes("server")) return "otel.http.server";
  if (lower.includes("http") && lower.includes("client")) return "otel.http.client";
  if (lower.includes("context") || lower.includes("propagation")) return "otel.context";
  if (lower.includes("semantic")) return "otel.semconv";
  if (lower.includes("resource")) return "otel.resource";
  if (lower.includes("exporter")) return "otel.exporters";
  if (lower.includes("sampling")) return "otel.sampling";
  if (lower.includes("span") && lower.includes("process")) return "otel.span_processing";
  if (lower.includes("metrics")) return "otel.metrics";
  if (lower.includes("logs")) return "otel.logs";
  if (lower.includes("advanced")) return "otel.advanced";
  if (lower.includes("configuration") || lower.includes("environment")) return "otel.config";

  return "otel.other";
}

function inferPriority(feature: {
  name: string;
  notes: string;
  bun: FeatureStatus;
}): "high" | "medium" | "low" | undefined {
  const lower = feature.name.toLowerCase() + " " + feature.notes.toLowerCase();

  if (feature.bun === "❌" && lower.includes("metric")) return "high";
  if (feature.bun === "❌" && (lower.includes("hook") || lower.includes("ignore"))) return "medium";
  if (lower.includes("experimental") || lower.includes("optional") || lower.includes("synthetic")) return "low";

  return undefined;
}

function buildDatabase(tables: ParsedTable[]): FeatureDatabase {
  const db: FeatureDatabase = {};

  for (const table of tables) {
    const basePath = mapCategoryToPath(table.category);

    for (const f of table.features) {
      const slug = slugify(f.name);
      const fullPath = `${basePath}.${slug}`;

      const feature: Feature = {
        nodejs: f.nodejs,
        bun: f.bun,
      };

      if (f.notes && f.notes !== "") {
        feature.notes = f.notes;
      }

      const priority = inferPriority(f);
      if (priority) {
        feature.priority = priority;
      }

      // Set in database
      const parts = fullPath.split(".");
      let current: any = db;

      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }

      current[parts[parts.length - 1]] = feature;
    }
  }

  return db;
}

// ============================================================================
// Validation
// ============================================================================

interface ValidationIssue {
  path: string;
  line?: number;
  level: "error" | "warning";
  message: string;
}

function findLineNumber(content: string, searchPath: string): number | undefined {
  const lines = content.split("\n");
  const pathParts = searchPath.split(".");

  // Build a regex to find the feature key in the JSON
  // We need to find it in context (after parent keys)
  let currentDepth = 0;
  let searchingFor: string[] = [...pathParts];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (searchingFor.length === 0) break;

    const currentKey = searchingFor[0];
    const pattern = `"${currentKey}"`;

    if (line.startsWith(pattern)) {
      searchingFor.shift();
      if (searchingFor.length === 0) {
        return i + 1; // Return 1-indexed line number
      }
    }
  }

  return undefined;
}

function validateFeature(feature: Feature, path: string, content: string, issues: ValidationIssue[]): void {
  const line = findLineNumber(content, path);

  // Rule 1: If it's working or partial in Bun, it should have tests
  if (feature.bun === "✅" || feature.bun === "⚠️") {
    if (!feature.tests || feature.tests.length === 0) {
      issues.push({
        path,
        line,
        level: "warning",
        message: "If it's not tested, it's not implemented - missing tests array",
      });
    }
  }

  // Rule 2: If it's missing in Bun but exists in Node.js, it should have priority
  // We only warn about missing priority if the feature seems important (has notes mentioning certain keywords)
  if (feature.bun === "❌" && feature.nodejs === "✅") {
    if (!feature.priority) {
      // Only warn if this seems like it should be prioritized
      const notes = (feature.notes || "").toLowerCase();
      const seemsImportant = notes.includes("metric") || notes.includes("hook") || notes.includes("critical");

      if (seemsImportant) {
        issues.push({
          path,
          line,
          level: "warning",
          message: "If it's not implemented, it needs a priority (high/medium/low) - or defaults to low",
        });
      }
    }
  }

  // Validate priority values
  if (feature.priority && !["high", "medium", "low"].includes(feature.priority)) {
    issues.push({
      path,
      line,
      level: "error",
      message: `Invalid priority "${feature.priority}" - must be high/medium/low`,
    });
  }

  // Validate status values for both nodejs and bun
  const validStatuses: FeatureStatus[] = ["✅", "⚠️", "❌", "➖"];
  if (!validStatuses.includes(feature.nodejs)) {
    issues.push({
      path,
      line,
      level: "error",
      message: `Invalid nodejs status "${feature.nodejs}" - must be ✅/⚠️/❌/➖`,
    });
  }

  if (!validStatuses.includes(feature.bun)) {
    issues.push({
      path,
      line,
      level: "error",
      message: `Invalid bun status "${feature.bun}" - must be ✅/⚠️/❌/➖`,
    });
  }

  // Validate required fields exist
  if (feature.nodejs === undefined) {
    issues.push({
      path,
      line,
      level: "error",
      message: "Missing required 'nodejs' field",
    });
  }

  if (feature.bun === undefined) {
    issues.push({
      path,
      line,
      level: "error",
      message: "Missing required 'bun' field",
    });
  }
}

function validateDatabase(db: FeatureDatabase, content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  function traverse(obj: FeatureCategory | Feature, path: string[] = []) {
    if (isFeature(obj)) {
      validateFeature(obj, path.join("."), content, issues);
    } else {
      for (const [key, value] of Object.entries(obj)) {
        traverse(value, [...path, key]);
      }
    }
  }

  for (const [category, value] of Object.entries(db)) {
    traverse(value, [category]);
  }

  return issues;
}

// ============================================================================
// CLI Commands
// ============================================================================

async function cmdList(category: string) {
  const db = loadFeatures();
  const cat = getFeature(db, category);

  if (!cat) {
    console.error(`❌ Category not found: ${category}`);
    process.exit(1);
  }

  if (isFeature(cat)) {
    console.error(`❌ ${category} is a feature, not a category`);
    process.exit(1);
  }

  listFeatures(cat);
}

async function cmdStats(category: string) {
  const db = loadFeatures();
  const cat = getFeature(db, category);

  if (!cat || isFeature(cat)) {
    console.error(`❌ Category not found: ${category}`);
    process.exit(1);
  }

  const stats = calculateStats(cat);

  console.log(`\n📊 ${category} Feature Statistics\n`);
  console.log(`Total features: ${stats.total}`);
  console.log(`✅ Working: ${stats.working} (${Math.round((stats.working / stats.total) * 100)}%)`);
  console.log(`⚠️  Partial: ${stats.partial} (${Math.round((stats.partial / stats.total) * 100)}%)`);
  console.log(`❌ Missing: ${stats.missing} (${Math.round((stats.missing / stats.total) * 100)}%)`);
  console.log(`➖ N/A: ${stats.na} (${Math.round((stats.na / stats.total) * 100)}%)`);
  console.log(`\n🎯 Completion: ${stats.completion}%\n`);
}

async function cmdExport(category: string, format: string) {
  const db = loadFeatures();
  const cat = getFeature(db, category);

  if (!cat || isFeature(cat)) {
    console.error(`❌ Category not found: ${category}`);
    process.exit(1);
  }

  if (format === "markdown" || format === "md") {
    const md = exportMarkdown(cat, category.toUpperCase());
    console.log(md);
  } else if (format === "json") {
    console.log(JSON.stringify(cat, null, 2));
  } else {
    console.error(`❌ Unknown format: ${format}`);
    process.exit(1);
  }
}

async function cmdUpdate(path: string, bunStatus: string, opts: any = {}) {
  const db = loadFeatures();
  const feature = getFeature(db, path);

  if (!feature) {
    console.error(`❌ Feature not found: ${path}`);
    console.error(`💡 Use 'add' command to create a new feature`);
    process.exit(1);
  }

  if (!isFeature(feature)) {
    console.error(`❌ ${path} is a category, not a feature`);
    process.exit(1);
  }

  // Parse status - accept both emoji and text
  let parsedBunStatus: FeatureStatus;
  if (bunStatus === "✅" || bunStatus === "working") parsedBunStatus = "✅";
  else if (bunStatus === "⚠️" || bunStatus === "partial") parsedBunStatus = "⚠️";
  else if (bunStatus === "❌" || bunStatus === "missing") parsedBunStatus = "❌";
  else if (bunStatus === "➖" || bunStatus === "n/a") parsedBunStatus = "➖";
  else {
    console.error(`❌ Invalid status: ${bunStatus}`);
    console.error(`💡 Use: working/✅, partial/⚠️, missing/❌, n/a/➖`);
    process.exit(1);
  }

  // Update feature
  const updated: Feature = { ...feature, bun: parsedBunStatus };
  if (opts.notes) updated.notes = opts.notes;
  if (opts.tests) updated.tests = opts.tests.split(",");
  if (opts.commits) updated.commits = opts.commits.split(",");
  if (opts.nodejs) {
    if (opts.nodejs === "working" || opts.nodejs === "✅") updated.nodejs = "✅";
    else if (opts.nodejs === "partial" || opts.nodejs === "⚠️") updated.nodejs = "⚠️";
    else if (opts.nodejs === "missing" || opts.nodejs === "❌") updated.nodejs = "❌";
    else if (opts.nodejs === "n/a" || opts.nodejs === "➖") updated.nodejs = "➖";
  }

  setFeature(db, path, updated);
  saveFeatures(db);

  console.log(`✅ Updated ${path} to ${parsedBunStatus} ${STATUS_LABELS[parsedBunStatus]}`);
}

async function cmdAdd(path: string, opts: any) {
  const db = loadFeatures();
  const existing = getFeature(db, path);

  if (existing) {
    console.error(`❌ Feature already exists: ${path}`);
    console.error(`💡 Use 'update' command to modify it`);
    process.exit(1);
  }

  // Parse bun status
  let bunStatus: FeatureStatus = "❌"; // default missing
  if (opts.bun) {
    if (opts.bun === "working" || opts.bun === "✅") bunStatus = "✅";
    else if (opts.bun === "partial" || opts.bun === "⚠️") bunStatus = "⚠️";
    else if (opts.bun === "missing" || opts.bun === "❌") bunStatus = "❌";
    else if (opts.bun === "n/a" || opts.bun === "➖") bunStatus = "➖";
  }

  // Parse nodejs status
  let nodejsStatus: FeatureStatus = "✅"; // default working
  if (opts.nodejs) {
    if (opts.nodejs === "working" || opts.nodejs === "✅") nodejsStatus = "✅";
    else if (opts.nodejs === "partial" || opts.nodejs === "⚠️") nodejsStatus = "⚠️";
    else if (opts.nodejs === "missing" || opts.nodejs === "❌") nodejsStatus = "❌";
    else if (opts.nodejs === "n/a" || opts.nodejs === "➖") nodejsStatus = "➖";
  }

  const feature: Feature = {
    nodejs: nodejsStatus,
    bun: bunStatus,
  };

  if (opts.notes) feature.notes = opts.notes;
  if (opts.tests) feature.tests = opts.tests.split(",");
  if (opts.commits) feature.commits = opts.commits.split(",");
  if (opts.priority) feature.priority = opts.priority;

  setFeature(db, path, feature);
  saveFeatures(db);

  console.log(`✅ Added feature: ${path}`);
}

async function cmdImport(mdFile?: string) {
  const sourceMd = mdFile || resolve(import.meta.dir, "OTEL_FEATURES.md");

  if (!existsSync(sourceMd)) {
    console.error(`❌ Markdown file not found: ${sourceMd}`);
    process.exit(1);
  }

  console.log(`📖 Reading ${sourceMd}...`);
  const content = readFileSync(sourceMd, "utf-8");
  const lines = content.split("\n");

  console.log("🔍 Parsing markdown tables...");
  const tables: ParsedTable[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Look for table headers (lines with |Feature|)
    if (line.includes("|") && line.toLowerCase().includes("feature")) {
      const table = parseMarkdownTable(lines, i);
      if (table && table.features.length > 0) {
        console.log(`  ✓ Found ${table.features.length} features in: ${table.category}`);
        tables.push(table);
      }
    }
  }

  console.log(
    `\n📊 Parsed ${tables.length} tables with ${tables.reduce((sum, t) => sum + t.features.length, 0)} total features`,
  );

  console.log("\n🏗️  Building feature database...");
  const db = buildDatabase(tables);

  console.log("💾 Writing features.json...");
  saveFeatures(db);

  console.log("\n✅ Import complete!");
  console.log("\nRun 'bun features.ts stats otel' to see statistics");
}

async function cmdValidate(opts: { fix?: boolean } = {}) {
  if (!existsSync(FEATURE_FILE)) {
    console.error(`❌ Feature file not found: ${FEATURE_FILE}`);
    process.exit(1);
  }

  console.log(`🔍 Validating ${FEATURE_FILE}...\n`);

  // First, check if it's valid JSON
  const content = readFileSync(FEATURE_FILE, "utf-8");
  let db: FeatureDatabase;

  try {
    db = JSON.parse(content);
  } catch (error: any) {
    console.error(`❌ JSON Parse Error:`);
    console.error(`   ${error.message}\n`);
    process.exit(1);
  }

  console.log("✅ Valid JSON\n");

  // Now validate the feature structure
  const issues = validateDatabase(db, content);

  if (issues.length === 0) {
    console.log("✅ No validation issues found!\n");
    return;
  }

  // Auto-fix if requested
  if (opts.fix) {
    console.log("🔧 Auto-fixing issues...\n");

    let fixedCount = 0;

    // We can only auto-fix "missing tests" warnings by adding empty arrays
    // This is a placeholder - user should fill in actual tests
    for (const issue of issues) {
      if (issue.message.includes("missing tests array")) {
        const feature = getFeature(db, issue.path);
        if (feature && isFeature(feature)) {
          feature.tests = []; // Empty placeholder
          fixedCount++;
        }
      }
    }

    if (fixedCount > 0) {
      saveFeatures(db);
      console.log(`✅ Auto-fixed ${fixedCount} issue(s)`);
      console.log(`⚠️  Note: Empty test arrays were added - you should fill them in!\n`);
      return;
    } else {
      console.log("⚠️  No auto-fixable issues found\n");
    }
  }

  // Group by level
  const errors = issues.filter(i => i.level === "error");
  const warnings = issues.filter(i => i.level === "warning");

  if (errors.length > 0) {
    console.log(`❌ ${errors.length} Error${errors.length === 1 ? "" : "s"}:\n`);
    for (const issue of errors) {
      const location = issue.line ? `:${issue.line}` : "";
      console.log(`  ${FEATURE_FILE}${location}`);
      console.log(`  ${issue.path}`);
      console.log(`  ${issue.message}\n`);
    }
  }

  if (warnings.length > 0) {
    console.log(`⚠️  ${warnings.length} Warning${warnings.length === 1 ? "" : "s"}:\n`);
    for (const issue of warnings) {
      const location = issue.line ? `:${issue.line}` : "";
      console.log(`  ${FEATURE_FILE}${location}`);
      console.log(`  ${issue.path}`);
      console.log(`  ${issue.message}\n`);
    }
  }

  console.log(`\nSummary: ${errors.length} error(s), ${warnings.length} warning(s)`);

  if (errors.length > 0) {
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log(`
Feature Tracking Tool

Commands:
  list <category>                    List all features in category
  stats <category>                   Show completion statistics
  export <category> <format>         Export to markdown/json
  update <path> <status> [opts]      Update feature status
  add <path> [opts]                  Add new feature
  import [markdown-file]             Import features from OTEL_FEATURES.md
  validate [--fix]                   Validate features.json structure and rules

Examples:
  bun features.ts list otel
  bun features.ts stats otel
  bun features.ts export otel markdown > OTEL_FEATURES.md
  bun features.ts update otel.http.server.span_creation working
  bun features.ts add otel.http.server.new_feature --bun=missing --nodejs=working --notes="Description"
  bun features.ts import OTEL_FEATURES.md
  bun features.ts validate
`);
    process.exit(0);
  }

  const [command, ...rest] = args;

  try {
    switch (command) {
      case "list":
        await cmdList(rest[0]);
        break;
      case "stats":
        await cmdStats(rest[0]);
        break;
      case "export":
        await cmdExport(rest[0], rest[1] || "markdown");
        break;
      case "update": {
        const [path, status, ...opts] = rest;
        const options: any = {};
        for (const opt of opts) {
          const [key, value] = opt.replace(/^--/, "").split("=");
          options[key] = value;
        }
        await cmdUpdate(path, status as FeatureStatus, options);
        break;
      }
      case "add": {
        const [path, ...opts] = rest;
        const options: any = {};
        for (const opt of opts) {
          const [key, value] = opt.replace(/^--/, "").split("=");
          options[key] = value;
        }
        await cmdAdd(path, options);
        break;
      }
      case "import":
        await cmdImport(rest[0]);
        break;
      case "validate": {
        const hasFix = rest.includes("--fix");
        await cmdValidate({ fix: hasFix });
        break;
      }
      default:
        console.error(`❌ Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error:`, error);
    process.exit(1);
  }
}

main();
