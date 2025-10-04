#!/usr/bin/env bun
import { extname } from "path";
import { spawnSync } from "child_process";

const input = await Bun.stdin.json();

const toolName = input.tool_name;
const toolInput = input.tool_input || {};
const filePath = toolInput.file_path;

// Only process Write and Edit tools
if (!["Write", "Edit"].includes(toolName)) {
  process.exit(0);
}

// Only format .zig files
if (!filePath || extname(filePath) !== ".zig") {
  process.exit(0);
}

// Format the Zig file
const result = spawnSync("vendor/zig/zig.exe", ["fmt", filePath], {
  cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  encoding: "utf-8"
});

if (result.error) {
  console.error(`Failed to format ${filePath}: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0) {
  console.error(`zig fmt failed for ${filePath}:`);
  if (result.stderr) {
    console.error(result.stderr);
  }
  process.exit(1);
}

// Success - file was formatted
process.exit(0);
