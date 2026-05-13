/**
 * Refresh the post-LTO `.llvm.<hash>` internalization suffixes baked into
 * `src/startup.order` against a fresh linker map.
 *
 *   bun scripts/build/sync-startup-order-suffixes.ts [linker-map] [--write] [--check]
 *
 * Why this exists
 * ───────────────
 * Most of the hot cold-start functions (and the default-command clap tables)
 * are monomorphized / internalized by fat LTO; lld rewrites their symbol names
 * with a `.llvm.<N>` suffix whose `<N>` changes on every build. `src/startup.order`
 * is profile-/hand-authored, so those suffixes go stale: lld then silently drops
 * the stale entries (`-Wl,--no-warn-symbol-ordering`), the function is *not*
 * clustered, and its first call during cold start page-faults a ~64 KB readahead
 * window of cold neighbours into RSS. Run this after a `--profile=btg` build (it
 * writes `build/btg/bun-profile.linker-map`) to re-derive the suffixes from the
 * names lld actually emitted; commit the diff.
 *
 * Modes:
 *   (default)  print what would change, don't touch the file
 *   --write    rewrite `src/startup.order` in place
 *   --check    exit non-zero if anything is stale (for CI / pre-commit)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..");
const ORDER_FILE = join(ROOT, "src", "startup.order");
const DEFAULT_MAP = join(ROOT, "build", "btg", "bun-profile.linker-map");

main();

function main(): void {
  const argv = process.argv.slice(2);
  const write = argv.includes("--write");
  const check = argv.includes("--check");
  const mapPath = argv.find(a => !a.startsWith("-")) ?? DEFAULT_MAP;

  let mapText: string;
  try {
    mapText = readFileSync(mapPath, "utf8");
  } catch {
    fail(
      `linker map not found: ${mapPath}\n` +
        `  build it first:  bun scripts/build.ts --profile=btg\n` +
        `  or pass an explicit path:  bun scripts/build/sync-startup-order-suffixes.ts path/to/bun.linker-map`,
    );
  }

  // base (mangled name with the trailing `.llvm.<N>` stripped) → set of `<N>`.
  const llvmSuffixes = new Map<string, Set<string>>();
  // mangled names that still appear *without* any `.llvm.` suffix (de-internalized).
  const plainSymbols = new Set<string>();
  const llvmRe = /\b(_[RZ][A-Za-z0-9_$.]+?)\.llvm\.(\d+)\b/g;
  const plainRe = /:\(\.[a-z_.]+\.(_[RZ][A-Za-z0-9_$.]+?)\)/g;
  for (const line of mapText.split("\n")) {
    if (line.includes(".llvm.")) {
      for (const m of line.matchAll(llvmRe)) {
        let set = llvmSuffixes.get(m[1]!);
        if (!set) llvmSuffixes.set(m[1]!, (set = new Set()));
        set.add(m[2]!);
      }
    }
    for (const m of line.matchAll(plainRe)) plainSymbols.add(m[1]!);
  }

  const lines = readFileSync(ORDER_FILE, "utf8").split("\n");
  const lineRe = /^(.*)\.llvm\.(\d+)$/;
  let rewrites = 0;
  let drops = 0;
  let unresolved = 0;
  const out: string[] = [];
  for (const line of lines) {
    const m = lineRe.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const base = m[1]!;
    const cur = m[2]!;
    if (base.endsWith(".merged")) {
      // C++ ICF-merged tail; not a Rust LTO suffix.
      out.push(line);
      continue;
    }
    const set = llvmSuffixes.get(base);
    if (set && set.has(cur)) {
      out.push(line);
      continue;
    }
    if (set && set.size > 0) {
      const next = [...set].sort()[0]!;
      if (set.size > 1) {
        process.stderr.write(`note: ${shorten(base)} has ${set.size} LTO copies; picking .llvm.${next}\n`);
      }
      process.stderr.write(`rewrite: ${shorten(base)}  .llvm.${cur} -> .llvm.${next}\n`);
      out.push(`${base}.llvm.${next}`);
      rewrites++;
      continue;
    }
    if (plainSymbols.has(base) || mapText.includes(`.text.${base})`) || mapText.includes(`.rodata.${base})`)) {
      process.stderr.write(`drop-suffix: ${shorten(base)}  (no longer internalized)\n`);
      out.push(base);
      drops++;
      continue;
    }
    process.stderr.write(`unresolved: ${shorten(base)}.llvm.${cur}  (symbol absent from linker map — left as-is)\n`);
    out.push(line);
    unresolved++;
  }

  const changed = rewrites + drops;
  process.stderr.write(`\n${rewrites} rewritten, ${drops} suffix-dropped, ${unresolved} unresolved.\n`);

  if (write) {
    if (changed > 0) {
      writeFileSync(ORDER_FILE, out.join("\n"));
      process.stderr.write(`wrote ${ORDER_FILE}\n`);
    } else {
      process.stderr.write(`${ORDER_FILE} already up to date.\n`);
    }
    return;
  }
  if (check && changed > 0) {
    fail(`src/startup.order has ${changed} stale .llvm.<hash> entr${changed === 1 ? "y" : "ies"}; run with --write.`);
  }
  if (!check && changed > 0) {
    process.stderr.write(`(dry run — pass --write to apply)\n`);
  }
}

function shorten(sym: string): string {
  return sym.length > 64 ? `…${sym.slice(-64)}` : sym;
}

function fail(msg: string): never {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}
