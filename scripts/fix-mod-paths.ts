#!/usr/bin/env bun
// Fix `pub mod foo;` where foo.rs doesn't exist but a case-variant file does.
// Adds `#[path = "ActualName.rs"]` above the mod decl.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

let fixed = 0;
function walk(d: string) {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith(".rs")) fixFile(p);
  }
}
function fixFile(file: string) {
  const dir = dirname(file);
  const siblings = readdirSync(dir);
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(pub\s+)?mod\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;$/);
    if (!m) continue;
    if (i > 0 && lines[i - 1].includes("#[path")) continue;
    const [, indent, , name] = m;
    if (existsSync(join(dir, name + ".rs")) || existsSync(join(dir, name, "mod.rs"))) continue;
    // find case-insensitive / snake↔Pascal match
    const want = name.toLowerCase().replace(/_/g, "");
    const hit = siblings.find(
      s =>
        (s.endsWith(".rs") && s.slice(0, -3).toLowerCase().replace(/_/g, "") === want) ||
        (statSync(join(dir, s)).isDirectory() &&
          s.toLowerCase().replace(/_/g, "") === want &&
          existsSync(join(dir, s, "mod.rs"))),
    );
    if (hit) {
      const path = hit.endsWith(".rs") ? hit : `${hit}/mod.rs`;
      lines.splice(i, 0, `${indent}#[path = "${path}"]`);
      i++;
      changed = true;
      fixed++;
    }
  }
  if (changed) writeFileSync(file, lines.join("\n"));
}

const target = process.argv[2] || "src";
walk(target);
console.error(`fixed ${fixed} mod paths`);
