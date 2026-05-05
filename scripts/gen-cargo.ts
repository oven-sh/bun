#!/usr/bin/env bun
// Generate workspace Cargo.toml + per-crate Cargo.toml + missing lib.rs (mod decls).
// Deps come from PORTING.md (ecosystem crates) + DAG (bun_* crates).
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dirs = readdirSync("src").filter(d => {
  try {
    return statSync(join("src", d)).isDirectory();
  } catch {
    return false;
  }
});

// Ecosystem deps every crate may use (PORTING.md)
const ECOSYSTEM = `
parking_lot = "0.12"
strum = { version = "0.26", features = ["derive"] }
phf = { version = "0.11", features = ["macros"] }
bstr = { version = "1", default-features = false, features = ["alloc"] }
scopeguard = "1"
const_format = "0.2"
enum-map = "2"
enumset = "1"
libc = "0.2"
bitflags = "2"
`.trim();
const AST_EXTRA = `bumpalo = { version = "3", features = ["collections", "boxed"] }
typed-arena = "2"`;

function crateName(dir: string): string {
  return dir.startsWith("bun_") ? dir : `bun_${dir}`;
}

// bun_* deps per crate (from .rs scan, comment-filtered, same-or-lower tier only later)
function bunDeps(dir: string): string[] {
  const set = new Set<string>();
  const n2d: Record<string, string> = { str: "string", output: "bun_core", core: "bun_core", alloc: "bun_alloc" };
  for (const d of dirs) n2d[d.replace(/^bun_/, "")] = d;
  function walk(d: string) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".rs")) {
        for (const line of readFileSync(p, "utf8").split("\n")) {
          if (line.trimStart().startsWith("//")) continue;
          for (const m of line.matchAll(/\bbun_([a-z_][a-z0-9_]*)::/g)) {
            const t = n2d[m[1]];
            if (t && t !== dir) set.add(t);
          }
        }
      }
    }
  }
  walk(join("src", dir));
  return [...set].sort();
}

const AST_CRATES = new Set(["js_parser", "js_printer", "css", "bundler", "sourcemap", "interchange", "shell_parser"]);

// Workspace
const members = dirs.map(d => `  "src/${d}",`).join("\n");
writeFileSync(
  "Cargo.toml",
  `[workspace]
resolver = "2"
members = [
${members}
]

[workspace.package]
version = "0.0.0"
edition = "2024"

[workspace.dependencies]
${ECOSYSTEM}
${AST_EXTRA}
${dirs.map(d => `${crateName(d)} = { path = "src/${d}" }`).join("\n")}
`,
);

// Per-crate
let written = 0,
  libsCreated = 0;
for (const dir of dirs) {
  const name = crateName(dir);
  const deps = bunDeps(dir);
  const eco = [
    "parking_lot",
    "strum",
    "phf",
    "bstr",
    "scopeguard",
    "const_format",
    "enum-map",
    "enumset",
    "libc",
    "bitflags",
  ];
  if (AST_CRATES.has(dir)) eco.push("bumpalo", "typed-arena");
  writeFileSync(
    join("src", dir, "Cargo.toml"),
    `[package]
name = "${name}"
version.workspace = true
edition.workspace = true

[lib]
path = "lib.rs"

[dependencies]
${eco.map(e => `${e}.workspace = true`).join("\n")}
${deps.map(d => `${crateName(d)}.workspace = true`).join("\n")}
`,
  );
  written++;

  // lib.rs if missing
  const lib = join("src", dir, "lib.rs");
  if (!existsSync(lib)) {
    const mods: string[] = [];
    function scan(d: string, prefix: string) {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) {
          if (existsSync(join(p, "mod.rs"))) mods.push(prefix + e);
        } else if (e.endsWith(".rs") && e !== "lib.rs" && e !== "mod.rs") {
          mods.push(prefix + e.slice(0, -3));
        }
      }
    }
    scan(join("src", dir), "");
    writeFileSync(
      lib,
      `#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
${mods.map(m => `pub mod ${m.replace(/[.-]/g, "_")};`).join("\n")}
`,
    );
    libsCreated++;
  }
}

console.error(`workspace + ${written} crate Cargo.toml; ${libsCreated} lib.rs scaffolded`);
