#!/usr/bin/env bun
/**
 * Find `pub` items that no other workspace crate references.
 *
 * `dead_code` treats every externally-reachable `pub` item as an API root and
 * never analyzes it; `unreachable_pub` only fires when the *module path* blocks
 * external access. Neither asks "does another crate actually import this?" —
 * in a workspace where every crate is an internal implementation detail of one
 * binary, that is the question that matters. This script answers it by diffing
 * each crate's exported names against the union of names every other crate
 * references through that crate's paths.
 *
 * The output is a *candidate* list, not a verdict: name matching is textual
 * (an identifier appearing anywhere in a `bun_x::…` path or `use bun_x::…`
 * statement counts as a use), so macro-expanded references that never appear
 * in the consuming crate's source are missed. Verify by demoting a candidate
 * to `pub(crate)` and compiling the workspace — a miss shows up as E0603.
 *
 *   bun scripts/find-dead-exports.ts            # full report
 *   bun scripts/find-dead-exports.ts bun_ast    # one crate
 *   bun scripts/find-dead-exports.ts --json     # machine-readable
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const onlyCrate = args.find(a => !a.startsWith("--"));

// ── workspace layout ────────────────────────────────────────────────────────

interface Crate {
  name: string;
  dir: string; // relative to ROOT
  files: string[]; // .rs files, relative to ROOT
}

function rustFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (e === "target" || e === "node_modules") continue;
      out.push(...rustFiles(p));
    } else if (e.endsWith(".rs")) {
      out.push(p);
    }
  }
  return out;
}

function loadWorkspace(): Crate[] {
  const rootToml = readFileSync(join(ROOT, "Cargo.toml"), "utf8");
  const membersBlock = rootToml.match(/members\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const dirs = [...membersBlock.matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const crates: Crate[] = [];
  for (const dir of dirs) {
    const tomlPath = join(ROOT, dir, "Cargo.toml");
    let name: string;
    try {
      name = readFileSync(tomlPath, "utf8").match(/^name\s*=\s*"([^"]+)"/m)![1];
    } catch {
      continue;
    }
    // Crate names with `-` are referenced in Rust paths with `_`.
    crates.push({ name: name.replace(/-/g, "_"), dir, files: rustFiles(join(ROOT, dir)).map(f => relative(ROOT, f)) });
  }
  return crates;
}

// ── export side: every `pub `-declared item ─────────────────────────────────
// After `unreachable_pub = deny`, a surviving bare-`pub` item is necessarily in
// a fully-public module chain, i.e. externally reachable. So "all pub items"
// IS the export set — no module-tree walk needed.

interface Export {
  name: string;
  kind: string;
  file: string;
  line: number;
}

const ITEM_RE =
  /^\s*pub\s+(?:(?:unsafe|async|extern\s+"[^"]*"|const|safe)\s+)*(fn|struct|enum|trait|union|type|static|const|mod)\s+([A-Za-z_][A-Za-z0-9_]*)/;
// `pub use path::{A, B as C, D}` / `pub use path::Name` / `pub use path as Alias`
const USE_RE = /^\s*pub\s+use\s+(.+);\s*$/;

function collectExports(crate: Crate): Export[] {
  const out: Export[] = [];
  for (const file of crate.files) {
    const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
    let inTestMod = false;
    let testModDepth = 0;
    let depth = 0;
    // Methods and associated items are referenced through their *type*
    // (`val.method()`, `Type::CONST`), never through a crate-qualified path,
    // so grep cannot see their uses. Exclude everything inside impl/trait
    // blocks — only path-addressable free items are auditable here.
    const implStack: number[] = [];
    // Set when an impl/trait header has no `{` on its own line (rustfmt wraps
    // the brace onto a later line for long headers and where-clauses); the
    // push happens on the first subsequent line that opens the block.
    let pendingImpl = false;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      // crude #[cfg(test)] mod skip — items only compiled for tests are not API
      if (/^\s*#\[cfg\(test\)\]/.test(l) && /^\s*(pub\s+)?mod\s/.test(lines[i + 1] ?? "")) {
        inTestMod = true;
        testModDepth = depth;
        continue;
      }
      const isImplOrTrait = /^\s*(unsafe\s+)?impl[\s<]/.test(l) || /^\s*(pub\s+)?(unsafe\s+)?trait\s/.test(l);
      if (isImplOrTrait && l.includes("{")) implStack.push(depth);
      else if (isImplOrTrait && !l.includes(";")) pendingImpl = true;
      else if (pendingImpl && l.includes("{")) {
        implStack.push(depth);
        pendingImpl = false;
      }
      const opens = (l.match(/\{/g) ?? []).length;
      const closes = (l.match(/\}/g) ?? []).length;
      const inImpl = implStack.length > 0;
      depth += opens - closes;
      while (implStack.length && depth <= implStack[implStack.length - 1]) implStack.pop();
      if (inTestMod && depth <= testModDepth) inTestMod = false;
      if (inTestMod) continue;
      if (inImpl && !isImplOrTrait) continue;

      const m = ITEM_RE.exec(l);
      if (m) {
        out.push({ name: m[2], kind: m[1], file, line: i + 1 });
        continue;
      }
      const u = USE_RE.exec(l) ?? (l.trimStart().startsWith("pub use") ? collectMultilineUse(lines, i) : null);
      if (u) {
        for (const name of namesFromUseTail(u[1])) {
          out.push({ name, kind: "use", file, line: i + 1 });
        }
      }
    }
  }
  return out;
}

/** `pub use a::b::{C, D as E, f::G};` → the names this re-export *introduces*. */
function namesFromUseTail(tail: string): string[] {
  tail = tail.replace(/\s+/g, " ").trim();
  const names: string[] = [];
  const brace = tail.match(/\{([\s\S]*)\}/);
  if (brace) {
    for (const part of brace[1].split(",")) {
      const p = part.trim();
      if (!p || p === "self") continue;
      const as = p.match(/\bas\s+([A-Za-z_][A-Za-z0-9_]*)$/);
      if (as) names.push(as[1]);
      else {
        const last = p.split("::").pop()!.trim();
        if (last !== "*" && /^[A-Za-z_]/.test(last)) names.push(last);
      }
    }
  } else {
    const as = tail.match(/\bas\s+([A-Za-z_][A-Za-z0-9_]*)$/);
    if (as) names.push(as[1]);
    else {
      const last = tail.split("::").pop()!.trim();
      if (last !== "*" && /^[A-Za-z_]/.test(last)) names.push(last);
    }
  }
  return names;
}

function collectMultilineUse(lines: string[], i: number): RegExpExecArray | null {
  // `pub use foo::{\n A,\n B,\n};` spans lines — join until the `;`
  let buf = "";
  for (let j = i; j < Math.min(i + 40, lines.length); j++) {
    buf += lines[j] + " ";
    if (lines[j].includes(";")) break;
  }
  return USE_RE.exec(buf.trim());
}

// ── import side: identifiers referenced through `crate_name::…` paths ───────

function collectReferences(crates: Crate[]): Map<string, Set<string>> {
  // crate name → set of identifiers seen in any path rooted at that crate,
  // from any *other* crate's source (plus generated code).
  const refs = new Map<string, Set<string>>(crates.map(c => [c.name, new Set<string>()]));
  const crateNames = new Set(crates.map(c => c.name));

  // `extern crate X as Y;` → references to `Y::…` are references to `X`.
  const aliases = new Map<string, string>();
  for (const c of crates) {
    for (const f of c.files) {
      for (const m of readFileSync(join(ROOT, f), "utf8").matchAll(
        /extern crate ([A-Za-z_][A-Za-z0-9_]*) as ([A-Za-z_][A-Za-z0-9_]*)/g,
      )) {
        if (crateNames.has(m[1]) && m[2] !== m[1]) aliases.set(m[2], m[1]);
      }
    }
  }

  const sources: { file: string; ownerCrate: string | null }[] = [];
  for (const c of crates) for (const f of c.files) sources.push({ file: f, ownerCrate: c.name });
  // Generated code references workspace items but belongs to whichever crate
  // include!()s it — attribute it to no crate so all its references count.
  for (const genDir of ["build/debug/codegen", "build/release/codegen"]) {
    try {
      for (const f of rustFiles(join(ROOT, genDir))) sources.push({ file: relative(ROOT, f), ownerCrate: null });
    } catch {}
  }

  // Two reference forms:
  //  (a) qualified paths in code:  `bun_core::strings::index_of(...)`
  //  (b) use statements, possibly brace-grouped over multiple lines:
  //      `use bun_core::{String, output::{self, Output}};`
  // (b) is the dominant style (rustfmt groups imports) and its leaf names are
  // bare identifiers inside braces, not `::`-joined paths — handle separately.
  const PATH_RE = /\b([A-Za-z_][A-Za-z0-9_]*)((?:::[A-Za-z_*][A-Za-z0-9_]*)+)/g;
  const USE_STMT_RE = /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+(?:::)?([A-Za-z_][A-Za-z0-9_]*)([^;]*);/gms;
  for (const { file, ownerCrate } of sources) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const m of text.matchAll(PATH_RE)) {
      const root = aliases.get(m[1]) ?? m[1];
      if (!crateNames.has(root)) continue;
      if (root === ownerCrate) continue; // self-references don't count
      const set = refs.get(root)!;
      for (const seg of m[2].split("::")) {
        if (seg && seg !== "*") set.add(seg);
      }
    }
    for (const m of text.matchAll(USE_STMT_RE)) {
      const root = aliases.get(m[1]) ?? m[1];
      if (!crateNames.has(root)) continue;
      if (root === ownerCrate) continue;
      const set = refs.get(root)!;
      for (const ident of m[2].matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
        if (ident[0] !== "self" && ident[0] !== "as") set.add(ident[0]);
      }
    }
  }
  return refs;
}

// ── diff ────────────────────────────────────────────────────────────────────

const crates = loadWorkspace();
const refs = collectReferences(crates);

// Crates consumed via `use crate::module::*` cross-crate glob imports: every
// name in them must be considered used. (Currently: bun_bundler::mal_prelude,
// bun_sql::…::FieldType.) Detect them so the report can flag the blind spot.
const globImportTargets = new Set<string>();
for (const c of crates) {
  for (const f of c.files) {
    for (const m of readFileSync(join(ROOT, f), "utf8").matchAll(/^\s*use ((?:::)?[A-Za-z_][A-Za-z0-9_:]*)::\*;/gm)) {
      const root = m[1].replace(/^::/, "").split("::")[0];
      if (crates.some(x => x.name === root) && root !== c.name) globImportTargets.add(m[1]);
    }
  }
}

interface Finding extends Export {
  crate: string;
}
const findings: Finding[] = [];
let totalExports = 0;
for (const crate of crates) {
  if (onlyCrate && crate.name !== onlyCrate) continue;
  if (crate.name === "bun_bin") continue; // the staticlib root exports the C ABI, not Rust items
  const exports = collectExports(crate);
  totalExports += exports.length;
  const used = refs.get(crate.name)!;
  for (const e of exports) {
    if (e.kind === "mod") continue; // a dead pub mod falls out once its contents are dead
    if (!used.has(e.name)) findings.push({ ...e, crate: crate.name });
  }
}

if (asJson) {
  console.log(JSON.stringify(findings, null, 1));
} else {
  const byCrate = new Map<string, Finding[]>();
  for (const f of findings) (byCrate.get(f.crate) ?? byCrate.set(f.crate, []).get(f.crate)!).push(f);
  for (const [crate, list] of [...byCrate].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${crate}  —  ${list.length} exported item(s) no other crate references`);
    for (const f of list.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`  ${f.file}:${f.line}  ${f.kind} ${f.name}`);
    }
  }
  console.log(`\n────────────────────────────────────────`);
  console.log(`${findings.length} candidate dead exports out of ${totalExports} exported items`);
  if (globImportTargets.size) {
    console.log(`note: cross-crate glob imports blind this analysis for: ${[...globImportTargets].join(", ")}`);
  }
  console.log(`verify a candidate by demoting it to pub(crate) and running cargo check --workspace`);
}
