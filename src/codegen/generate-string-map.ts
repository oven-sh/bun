// Generate length-bucketed string→value lookup functions for Rust.
//
// Replaces `phf::phf_map!` / `comptime_string_map!` for hot identifier-set
// lookups. Output is a `match key.len() { … }` jump table whose buckets are
// either a discriminating-byte switch (one byte fully distinguishes the bucket
// → single load + jump table + one fixed-width compare to confirm), a short
// linear chain (≤ LINEAR_MAX entries — LLVM lowers `[u8; N] == [u8; N]` to one
// wide compare), or a binary search over a sorted `[([u8; N], V); K]` slice.
// No hashing.
//
// Output lands **in-tree** as `<dir>/<stem>.generated.rs` (checked in) so
// plain `cargo check` / rust-analyzer work without `BUN_CODEGEN_DIR` or a
// per-crate `build.rs`. The `.string-map.ts` is the source of truth; CI
// verifies the `.generated.rs` is current.
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
  /**
   * Rust type of the value (e.g. `u8`, `crate::Method`, `&'static [&'static [u8]]`).
   * Must be `Copy` — the bsearch arm reads it out of a `static [(_, V); K]` by
   * value. For non-`Copy` payloads, store an index/tag and look the payload up
   * separately.
   */
  valueTy: string;
  /**
   * Map a JS value to its Rust literal. Default: `JSON.stringify` for strings,
   * `String(v)` otherwise. Override for enum variants etc.
   */
  emitValue?: (v: V) => string;
  /** Entries. Keys must be unique. */
  entries: ReadonlyArray<readonly [key: string, value: V]>;
  /** Also emit `pub static <NAME>_KEYS: &[&[u8]]` (in entry order). */
  emitKeys?: boolean;
  /**
   * Also emit `pub fn <name>_ignore_ascii_case(key: &[u8]) -> Option<V>`.
   * Bucketing is identical; the discriminating-byte switch matches
   * `key[i] | 0x20` against the lowercased byte, and the confirm compare is
   * `eq_ignore_ascii_case`. Keys must be ASCII (asserted).
   */
  emitCaseInsensitive?: boolean;
  /**
   * Also emit `pub fn <name>_index(key: &[u8]) -> Option<u16>` returning the
   * entry's index in `<NAME>_KEYS` (declaration order). Implies `emitKeys`.
   */
  emitIndexOf?: boolean;
  /** Header comment to copy into the generated `mod`. */
  doc?: string;
}

/** Bucket size at-or-below which we emit a discriminating-byte switch / linear chain instead of bsearch. */
const LINEAR_MAX = 8;

/**
 * Find a byte position where all keys in the bucket differ. If one exists,
 * a single `match key[i] { … }` distinguishes every entry — one load + one
 * jump table, vs N memcmps. Returns the position with max distinct bytes
 * (ties → earliest), or `null` if no fully-discriminating position exists.
 */
function discriminatingByte(bucket: ReadonlyArray<readonly [Buffer, unknown]>, len: number): number | null {
  let best = -1;
  let bestDistinct = 0;
  for (let i = 0; i < len; i++) {
    const seen = new Set<number>();
    for (const [kb] of bucket) seen.add(kb[i]);
    if (seen.size > bestDistinct) {
      bestDistinct = seen.size;
      best = i;
      if (seen.size === bucket.length) return i; // fully discriminating — done
    }
  }
  return bestDistinct === bucket.length ? best : null;
}

function rsByte(b: number): string {
  if (b >= 0x20 && b <= 0x7e && b !== 0x27 && b !== 0x5c) return `b'${String.fromCharCode(b)}'`;
  return `0x${b.toString(16).padStart(2, "0")}`;
}

function rsBytes(s: string): string {
  const bytes = Buffer.from(s, "utf8");
  let printable = true;
  for (const b of bytes) {
    if (b < 0x20 || b > 0x7e || b === 0x22 || b === 0x5c) printable = false;
  }
  if (printable) return `b"${s}"`;
  return `&[${[...bytes].map(b => `0x${b.toString(16).padStart(2, "0")}`).join(", ")}]`;
}

interface EmitOpts {
  /** `eq_ignore_ascii_case` instead of `==`; discriminator matches `b | 0x20`. */
  ci: boolean;
}

/**
 * Emit one lookup fn body. `entries` is `[keyBytes, valueLiteral]` so the same
 * bucketer can serve `emitIndexOf` (where the "value" is the declaration index)
 * without re-threading `emitValue`.
 */
function emitLookup(
  out: string[],
  fnName: string,
  retTy: string,
  entries: ReadonlyArray<readonly [Buffer, string]>,
  { ci }: EmitOpts,
): void {
  // Bucket by byte length, then sort each bucket bytewise (for bsearch). For
  // case-insensitive, sort by the *lowercased* key so bsearch can compare
  // against a lowercased probe.
  const sortKey = (kb: Buffer) => (ci ? Buffer.from(kb.toString("binary").toLowerCase(), "binary") : kb);
  const buckets = new Map<number, Array<readonly [Buffer, string]>>();
  for (const [kb, v] of entries) {
    const len = kb.length;
    if (!buckets.has(len)) buckets.set(len, []);
    buckets.get(len)!.push([kb, v]);
  }
  for (const arr of buckets.values()) arr.sort((a, b) => Buffer.compare(sortKey(a[0]), sortKey(b[0])));
  const lens = [...buckets.keys()].sort((a, b) => a - b);

  // Parenthesised so `${eq(...)}.then(...)` doesn't mis-associate as
  // `key == (lit.then(...))`.
  const eq = (key: string, lit: string) => (ci ? `${key}.eq_ignore_ascii_case(${lit})` : `(${key} == ${lit})`);
  // Fold to lowercase before discriminating so `key[i] | 0x20` matches either
  // case of an ASCII letter. Non-letters with bit 5 differing (e.g. `_`/`?`)
  // can collide here — that's fine, the full `eq_ignore_ascii_case` confirms.
  const discProbe = (i: number) => (ci ? `key[${i}] | 0x20` : `key[${i}]`);
  const discByte = (b: number) => rsByte(ci ? b | 0x20 : b);

  out.push(`#[inline]`);
  out.push(`#[allow(clippy::all)]`);
  out.push(`pub fn ${fnName}(key: &[u8]) -> Option<${retTy}> {`);
  out.push(`    match key.len() {`);
  for (const len of lens) {
    const bucket = buckets.get(len)!;
    if (bucket.length === 1) {
      const [kb, v] = bucket[0];
      out.push(`        ${len} => ${eq("key", rsBytes(kb.toString("binary")))}.then(|| ${v}),`);
    } else if (bucket.length <= LINEAR_MAX) {
      // For case-insensitive, the discriminator must still be unique after
      // `| 0x20` folding — recompute on the folded keys.
      const disc = discriminatingByte(ci ? bucket.map(([kb, v]) => [sortKey(kb), v] as const) : bucket, len);
      out.push(`        ${len} => {`);
      // The `len` match arm guarantees `key.len() == ${len}`, so `try_into`
      // is infallible (LLVM elides the check). Widening to `&[u8; N]` lets
      // rustc lower the eq to a single wide compare.
      out.push(`            let key: &[u8; ${len}] = key.try_into().unwrap();`);
      if (disc !== null) {
        // One byte fully discriminates → `match key[i]` is a jump table; the
        // per-arm compare confirms the rest of the bytes (still needed — the
        // discriminator only proves "if it's any of these, it's this one").
        out.push(`            match ${discProbe(disc)} {`);
        for (const [kb, v] of bucket) {
          out.push(
            `                ${discByte(kb[disc])} => ${eq("key", rsBytes(kb.toString("binary")))}.then(|| ${v}),`,
          );
        }
        out.push(`                _ => None,`);
        out.push(`            }`);
      } else {
        // No single discriminating byte — fall back to a short compare chain.
        // LLVM lowers `[u8; N] == [u8; N]` to one wide compare; for ≤8 entries
        // that's competitive with bsearch and branchier code is easier on the
        // predictor when the hit distribution is skewed.
        for (const [kb, v] of bucket) {
          out.push(`            if ${eq("key", rsBytes(kb.toString("binary")))} { return Some(${v}); }`);
        }
        out.push(`            None`);
      }
      out.push(`        }`);
    } else if (!ci) {
      // Binary search. The slice is `[u8; N]` (not `&[u8]`) so the compare is
      // a fixed-size memcmp; rustc/LLVM can vectorize it for small N.
      const tableName = `__${fnName.toUpperCase()}_L${len}`;
      out.push(`        ${len} => {`);
      out.push(`            #[allow(non_upper_case_globals)]`);
      out.push(`            static ${tableName}: [([u8; ${len}], ${retTy}); ${bucket.length}] = [`);
      for (const [kb, v] of bucket) {
        out.push(`                (*${rsBytes(kb.toString("binary"))}, ${v}),`);
      }
      out.push(`            ];`);
      out.push(`            let key: &[u8; ${len}] = key.try_into().unwrap();`);
      out.push(`            ${tableName}.binary_search_by(|(k, _)| k.cmp(key)).ok().map(|i| ${tableName}[i].1)`);
      out.push(`        }`);
    } else {
      // Case-insensitive bsearch: store keys lowercased, lower the probe into
      // a stack `[u8; N]` (no alloc — N is the bucket's compile-time length),
      // then bsearch as usual. ASCII-only by construction (asserted up-front).
      const tableName = `__${fnName.toUpperCase()}_L${len}`;
      out.push(`        ${len} => {`);
      out.push(`            #[allow(non_upper_case_globals)]`);
      out.push(`            static ${tableName}: [([u8; ${len}], ${retTy}); ${bucket.length}] = [`);
      for (const [kb, v] of bucket) {
        out.push(`                (*${rsBytes(sortKey(kb).toString("binary"))}, ${v}),`);
      }
      out.push(`            ];`);
      out.push(`            let mut probe = [0u8; ${len}];`);
      out.push(`            for (d, s) in probe.iter_mut().zip(key) { *d = s.to_ascii_lowercase(); }`);
      out.push(`            ${tableName}.binary_search_by(|(k, _)| k.cmp(&probe)).ok().map(|i| ${tableName}[i].1)`);
      out.push(`        }`);
    }
  }
  out.push(`        _ => None,`);
  out.push(`    }`);
  out.push(`}`);
}

function buildOne<V>(spec: StringMapSpec<V>): string {
  const { name, valueTy, entries, emitKeys, emitIndexOf, emitCaseInsensitive, doc } = spec;
  const emitValue = spec.emitValue ?? ((v: V) => (typeof v === "string" ? JSON.stringify(v) : String(v)));

  const seen = new Set<string>();
  const seenCi = new Set<string>();
  for (const [k] of entries) {
    if (seen.has(k)) throw new Error(`generate-string-map: duplicate key ${JSON.stringify(k)} in ${name}`);
    seen.add(k);
    if (emitCaseInsensitive) {
      // eslint-disable-next-line no-control-regex
      if (!/^[\x00-\x7f]*$/.test(k)) {
        throw new Error(
          `generate-string-map: ${name}: emitCaseInsensitive requires ASCII keys; ${JSON.stringify(k)} is not`,
        );
      }
      const lk = k.toLowerCase();
      if (seenCi.has(lk)) {
        throw new Error(`generate-string-map: ${name}: keys ${JSON.stringify(k)} collide under case folding`);
      }
      seenCi.add(lk);
    }
  }

  const kvs: Array<readonly [Buffer, string]> = entries.map(([k, v]) => [Buffer.from(k, "utf8"), emitValue(v)]);
  const out: string[] = [];
  if (doc) for (const line of doc.split("\n")) out.push(`/// ${line}`.trimEnd());
  emitLookup(out, name, valueTy, kvs, { ci: false });

  if (emitCaseInsensitive) {
    out.push(``);
    emitLookup(out, `${name}_ignore_ascii_case`, valueTy, kvs, { ci: true });
  }

  if (emitIndexOf) {
    // Index in *declaration order* — same as `<NAME>_KEYS` so
    // `KEYS[index_of(k).unwrap()]` round-trips. u16 is plenty (asserted).
    if (entries.length > 0xffff) throw new Error(`${name}: ${entries.length} entries exceed u16 indexOf range`);
    const idxKvs: Array<readonly [Buffer, string]> = entries.map(([k], i) => [Buffer.from(k, "utf8"), `${i}u16`]);
    out.push(``);
    emitLookup(out, `${name}_index`, `u16`, idxKvs, { ci: false });
  }

  if (emitKeys || emitIndexOf) {
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
  // No `#![allow]` — this is `include!`d, and inner attributes aren't legal
  // mid-module. Per-item allows are emitted where needed instead.
  return [
    `// Generated by src/codegen/generate-string-map.ts from ${rel} — do not edit.`,
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
