#!/usr/bin/env bun
import { extname } from "path";
import { spawnSync } from "child_process";

const input = await Bun.stdin.json();

const toolName = input.tool_name;
const toolInput = input.tool_input || {};
const filePath = toolInput.file_path;

// Only process Write, Edit, and MultiEdit tools
if (!["Write", "Edit", "MultiEdit"].includes(toolName)) {
  process.exit(0);
}

const ext = extname(filePath);

// Only format known files
if (!filePath) {
  process.exit(0);
}

function formatZigFile() {
  try {
    // Format the Zig file
    const result = spawnSync("vendor/zig/zig.exe", ["fmt", filePath], {
      cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      encoding: "utf-8",
    });

    if (result.error) {
      console.error(`Failed to format ${filePath}: ${result.error.message}`);
      process.exit(0);
    }

    if (result.status !== 0) {
      console.error(`zig fmt failed for ${filePath}:`);
      if (result.stderr) {
        console.error(result.stderr);
      }
      process.exit(0);
    }
  } catch (error) {}
}

function formatTypeScriptFile() {
  try {
    // Format only — NO organize-imports plugin. That plugin strips imports
    // it thinks are unused, which breaks split edits (add import → use it
    // in next edit). CI's `bun run prettier` runs the plugin, so imports
    // still get cleaned up before merge.
    const result = spawnSync("./node_modules/.bin/prettier", ["--config", ".prettierrc", "--write", filePath], {
      cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      encoding: "utf-8",
    });
  } catch (error) {}
}

if (ext === ".zig") {
  formatZigFile();
} else if (
  [
    ".cjs",
    ".css",
    ".html",
    ".js",
    ".json",
    ".jsonc",
    ".jsx",
    ".less",
    ".mjs",
    ".pcss",
    ".postcss",
    ".sass",
    ".scss",
    ".styl",
    ".stylus",
    ".toml",
    ".ts",
    ".tsx",
    ".yaml",
  ].includes(ext)
) {
  formatTypeScriptFile();
}

process.exit(0);
