// Generate length-bucketed string→value lookup functions for Rust.
//
// Replaces `phf::phf_map!` / `comptime_string_map!` for hot identifier-set
// lookups. Output is a `match key.len() { … }` jump table whose buckets are
// either a short compare chain (≤ LINEAR_MAX entries — LLVM turns fixed-size
// `&[u8; N] == &[u8; N]` into a single wide compare or its own jump table) or
// a binary search over a sorted const slice. No hashing.
//
// Input is a `*.string-map.ts` module that `export default`s a `StringMapSpec`
// (or an array of them). The data lives in TS so it can be commented, share
// constants, and be re-used by other codegen.
//
//   bun src/codegen/generate-string-map.ts <input.ts> <out.rs>

import path from "node:path";
import { writeIfNotChanged } from "./helpers.ts";

export interface StringMapSpec<V = unknown> {
  /** Rust ident for the lookup fn: emits `pub fn <name>(key: &[u8]) -> Option<$valueTy>`. */
  name: string;
  /** Rust type of the value (e.g. `u8`, `crate::Method`, `&'static [&'static [u8]]`). */
  valueTy: string;
  /**
   * Map a JS value to its Rust literal. Default: `JSON.stringify` for strings,
   * `String(v)` otherwise. Override for enum variants etc.
   */
  emitValue?: (v: V) => string;
  /** Entries. Keys must be unique. */
  entries: ReadonlyArray<readonly [key: string, value: V]>;
  /** Also emit `pub static <name>_KEYS: &[&[u8]]` (in entry order). */
  emitKeys?: boolean;
  /** Header comment to copy into the generated `mod`. */
  doc?: string;
}

/** Bucket size at-or-below which we emit a linear compare chain instead of bsearch. */
const LINEAR_MAX = 4;

function rsBytes(s: string): string {
  // Emit as `b"…"` when printable-ASCII-only; else as `&[0x…, …]`.
  const bytes = Buffer.from(s, "utf8");
  let printable = true;
  for (const b of bytes) {
    if (b < 0x20 || b > 0x7e || b === 0x22 || b === 0x5c) printable = false;
  }
  if (printable) return `b"${s}"`;
  return `&[${[...bytes].map(b => `0x${b.toString(16).padStart(2, "0")}`).join(", ")}]`;
}

function buildOne<V>(spec: StringMapSpec<V>): string {
  const { name, valueTy, entries, emitKeys, doc } = spec;
  const emitValue = spec.emitValue ?? ((v: V) => (typeof v === "string" ? JSON.stringify(v) : String(v)));

  // Dedup-check.
  const seen = new Set<string>();
  for (const [k] of entries) {
    if (seen.has(k)) throw new Error(`generate-string-map: duplicate key ${JSON.stringify(k)} in ${name}`);
    seen.add(k);
  }

  // Bucket by UTF-8 byte length, then sort each bucket bytewise (for bsearch).
  const buckets = new Map<number, Array<readonly [Buffer, V]>>();
  for (const [k, v] of entries) {
    const kb = Buffer.from(k, "utf8");
    const len = kb.length;
    if (!buckets.has(len)) buckets.set(len, []);
    buckets.get(len)!.push([kb, v]);
  }
  for (const arr of buckets.values()) arr.sort((a, b) => Buffer.compare(a[0], b[0]));
  const lens = [...buckets.keys()].sort((a, b) => a - b);

  const out: string[] = [];
  if (doc) for (const line of doc.split("\n")) out.push(`/// ${line}`.trimEnd());
  out.push(`#[inline]`);
  out.push(`pub fn ${name}(key: &[u8]) -> Option<${valueTy}> {`);
  out.push(`    match key.len() {`);
  for (const len of lens) {
    const bucket = buckets.get(len)!;
    if (bucket.length === 1) {
      const [kb, v] = bucket[0];
      out.push(`        ${len} => (key == ${rsBytes(kb.toString("binary"))}).then(|| ${emitValue(v)}),`);
    } else if (bucket.length <= LINEAR_MAX) {
      // Short chain — LLVM lowers `[u8; N] == [u8; N]` to one wide compare (or
      // its own jump table on a discriminating byte if it spots one). Probe
      // order is bytewise-sorted so the branch predictor sees a monotone
      // sequence; it's not worth being cleverer than the optimizer here.
      out.push(`        ${len} => {`);
      // SAFETY: `len` arm guarantees `key.len() == ${len}`.
      out.push(`            let key: &[u8; ${len}] = unsafe { &*key.as_ptr().cast() };`);
      for (const [kb, v] of bucket) {
        out.push(`            if key == ${rsBytes(kb.toString("binary"))} { return Some(${emitValue(v)}); }`);
      }
      out.push(`            None`);
      out.push(`        }`);
    } else {
      // Binary search. The slice is `[u8; N]` (not `&[u8]`) so the compare is
      // a fixed-size memcmp; rustc/LLVM can vectorize it for small N.
      const tableName = `__${name.toUpperCase()}_L${len}`;
      out.push(`        ${len} => {`);
      out.push(`            #[allow(non_upper_case_globals)]`);
      out.push(`            static ${tableName}: [([u8; ${len}], ${valueTy}); ${bucket.length}] = [`);
      for (const [kb, v] of bucket) {
        out.push(`                (*${rsBytes(kb.toString("binary"))}, ${emitValue(v)}),`);
      }
      out.push(`            ];`);
      out.push(`            let key: &[u8; ${len}] = unsafe { &*key.as_ptr().cast() };`);
      out.push(
        `            ${tableName}.binary_search_by(|(k, _)| k.cmp(key)).ok().map(|i| ${tableName}[i].1.clone())`,
      );
      out.push(`        }`);
    }
  }
  out.push(`        _ => None,`);
  out.push(`    }`);
  out.push(`}`);

  if (emitKeys) {
    out.push(``);
    out.push(`pub static ${name.toUpperCase()}_KEYS: &[&[u8]] = &[`);
    for (const [k] of entries) out.push(`    ${rsBytes(k)},`);
    out.push(`];`);
  }

  return out.join("\n");
}

export function generateStringMaps(
  specs: StringMapSpec<unknown> | StringMapSpec<unknown>[],
  inputPath: string,
): string {
  const arr = Array.isArray(specs) ? specs : [specs];
  const rel = path.relative(process.cwd(), inputPath).replaceAll("\\", "/");
  return [
    `// Generated by src/codegen/generate-string-map.ts from ${rel} — do not edit.`,
    `#![allow(clippy::all, dead_code, unused_unsafe)]`,
    ``,
    ...arr.map(s => buildOne(s)),
    ``,
  ].join("\n\n");
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const [, , input, output] = process.argv;
  if (!input || !output) {
    throw new Error("usage: bun src/codegen/generate-string-map.ts <input.string-map.ts> <out.rs>");
  }
  const mod = await import(path.resolve(input));
  const specs = mod.default as StringMapSpec<unknown> | StringMapSpec<unknown>[];
  if (!specs) throw new Error(`${input}: missing default export`);
  writeIfNotChanged(output, generateStringMaps(specs, input));
}
