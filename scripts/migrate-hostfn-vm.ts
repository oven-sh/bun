#!/usr/bin/env bun
// One-shot migration: insert `_vm: &VirtualMachine` into every host-fn impl
// signature so it matches the new `generateRust()` calling convention.
//
// Reads the freshly-regenerated `build/debug/codegen/generated_classes.rs` to
// learn (a) the rust path for each codegen type and (b) the exact set of
// `Type::method` calls + which "shape" (proto-fn, getter, static, …) each one
// uses, then rewrites the matching `fn` signatures in the source files.
//
// Idempotent: a method that already has a `&VirtualMachine` (or `_vm:` /
// `vm:`) parameter is skipped.

import { Glob } from "bun";
import { readFileSync, writeFileSync } from "node:fs";

const GEN = "build/debug/codegen/generated_classes.rs";
const src = readFileSync(GEN, "utf8");

// ── 1. Type → crate-path map ────────────────────────────────────────────────
const typePath = new Map<string, string>();
for (const m of src.matchAll(/^pub use (crate::[A-Za-z0-9_:]+) as ([A-Za-z0-9_]+);$/gm)) {
  typePath.set(m[2], m[1]);
}

// ── 2. Per-method "shape" — where to insert `_vm` ───────────────────────────
// shape values:
//   "proto"  — insert after the receiver (`&mut self,` / `this: &mut Self,`)
//   "tv"     — insert after `this_value: JSValue,` (proto getter/setter w/ this:true)
//   "static" — insert before the first parameter (no `self`)
type Shape = "proto" | "tv" | "static";
const calls = new Map<string, Shape>(); // "Type::method" → shape

const add = (t: string, m: string, s: Shape) => {
  const k = `${t}::${m}`;
  // Prefer the most specific shape if seen twice (shouldn't happen).
  if (!calls.has(k)) calls.set(k, s);
};

// host_fn_this / host_fn_getter / host_fn_setter → proto
for (const m of src.matchAll(
  /host_fn::host_fn_(?:this|getter|setter)\([^,]+,[^,]+(?:,[^,]+)?, ([A-Za-z0-9_]+)::([a-z_][A-Za-z0-9_]*)\)/g,
)) {
  add(m[1], m[2], "proto");
}
// host_fn_static / host_fn_construct → static
for (const m of src.matchAll(
  /host_fn::host_fn_(?:static|construct)\([^,]+,[^,]+, ([A-Za-z0-9_]+)::([a-z_][A-Za-z0-9_]*)\)/g,
)) {
  add(m[1], m[2], "static");
}
// |vm, g, c| T::m(vm, g, c, this_value)  — constructNeedsThis (static)
for (const m of src.matchAll(/\|vm, g, c\| ([A-Za-z0-9_]+)::([a-z_][A-Za-z0-9_]*)\(vm, g, c/g)) {
  add(m[1], m[2], "static");
}
// inline proto: T::m(this, vm, global, …)
for (const m of src.matchAll(/([A-Za-z0-9_]+)::([a-z_][A-Za-z0-9_]*)\(this, vm, global/g)) {
  add(m[1], m[2], "proto");
}
// inline proto-with-thisValue: T::m(this, this_value, vm, global, …)
for (const m of src.matchAll(/([A-Za-z0-9_]+)::([a-z_][A-Za-z0-9_]*)\(this, this_value, vm, global/g)) {
  add(m[1], m[2], "tv");
}
// inline static: T::m(vm, global, …)
for (const m of src.matchAll(/\b([A-Za-z0-9_]+)::([a-z_][A-Za-z0-9_]*)\(vm, global/g)) {
  add(m[1], m[2], "static");
}

console.error(`types: ${typePath.size}, methods: ${calls.size}`);

// ── 3. Locate every candidate source file ──────────────────────────────────
// The struct may live anywhere under src/runtime/ (codegen resolves it via
// rustModuleResolver). Trait-provided methods (BodyMixin, BlobExt) live in
// fixed files. Easiest: scan all of src/runtime/ + the two trait files.
const files: string[] = [];
for (const f of new Glob("src/runtime/**/*.rs").scanSync(".")) files.push(f);
// src/sql_jsc & src/jsc may also host codegen targets re-exported into runtime
for (const f of new Glob("src/sql_jsc/**/*.rs").scanSync(".")) files.push(f);
for (const f of new Glob("src/valkey_jsc/**/*.rs").scanSync(".")) files.push(f);

// ── 4. Per-file rewrite ────────────────────────────────────────────────────
// A `fn` signature may span several lines. Match from `fn name(` up to the
// closing `)` of the parameter list (balanced — but Rust signatures don't
// nest parens outside of `fn`-ptr types, which none of these use).
function rewriteSig(body: string, paramList: string, shape: Shape): string | null {
  // already migrated?
  if (/\b_?vm\s*:\s*&\s*(?:'static\s+)?VirtualMachine\b/.test(paramList)) return null;
  if (/&VirtualMachine\b/.test(paramList)) return null;

  if (shape === "static") {
    // insert at very start of param list
    const trimmed = paramList.trimStart();
    const lead = paramList.slice(0, paramList.length - trimmed.length);
    return body.replace(paramList, `${lead}_vm: &VirtualMachine, ${trimmed}`);
  }
  if (shape === "tv") {
    // insert after `this_value: JSValue,` (with optional underscore / spacing)
    const re = /([,(]\s*_?this_value\s*:\s*JSValue\s*,)/;
    if (!re.test(paramList)) return null;
    const newParams = paramList.replace(re, `$1 _vm: &VirtualMachine,`);
    return body.replace(paramList, newParams);
  }
  // proto: insert after the receiver
  // Receiver forms: `&mut self,`  `self: &mut Self,`  `this: &mut Self,`
  // `_this: &mut Self,`  (also `&self,` for the rare immutable getter)
  const recv = /((?:&mut self|&self|[A-Za-z_][A-Za-z0-9_]*\s*:\s*&mut Self|[A-Za-z_][A-Za-z0-9_]*\s*:\s*&Self)\s*,)/;
  if (!recv.test(paramList)) return null;
  const newParams = paramList.replace(recv, `$1 _vm: &VirtualMachine,`);
  return body.replace(paramList, newParams);
}

// Map method name → set of shapes (a method name may be shared across types
// with the same shape; if shapes conflict we apply per-occurrence heuristics).
const byName = new Map<string, Set<Shape>>();
for (const [k, s] of calls) {
  const name = k.split("::")[1];
  if (!byName.has(name)) byName.set(name, new Set());
  byName.get(name)!.add(s);
}

let totalEdits = 0;
const touched = new Set<string>();

for (const file of files) {
  let txt: string;
  try {
    txt = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  let changed = false;

  // Find every `fn <name>(<params>)` whose <name> is in our set.
  // Use a manual scan so we can balance parens across newlines.
  let i = 0;
  while (i < txt.length) {
    const m = /\bfn\s+(r#)?([a-z_][A-Za-z0-9_]*)\s*(?:<[^>]*>)?\s*\(/.exec(txt.slice(i));
    if (!m) break;
    const name = m[2];
    const fnStart = i + m.index;
    const openParen = i + m.index + m[0].length - 1;
    // balance parens
    let depth = 0;
    let j = openParen;
    for (; j < txt.length; j++) {
      if (txt[j] === "(") depth++;
      else if (txt[j] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    const closeParen = j;
    i = closeParen + 1;

    const shapes = byName.get(name);
    if (!shapes) continue;
    const sigSpan = txt.slice(fnStart, closeParen + 1);
    const paramList = txt.slice(openParen + 1, closeParen);

    // Decide shape: if the param list has a self/Self receiver → proto/tv;
    // otherwise → static. Then check the method's recorded shapes allow it.
    const hasRecv = /(?:&mut self|&self|:\s*&mut Self|:\s*&Self)\b/.test(paramList) && !/^\s*\)/.test(paramList);
    let shape: Shape;
    if (hasRecv) {
      // tv only if both the recorded shape says tv AND this_value precedes global
      shape = shapes.has("tv") && /this_value\s*:\s*JSValue\s*,/.test(paramList) ? "tv" : "proto";
      if (!shapes.has(shape) && !shapes.has("tv") && !shapes.has("proto")) continue;
    } else {
      shape = "static";
      if (!shapes.has("static")) continue;
      // Heuristic guard: only rewrite static fns whose first param is a
      // `&JSGlobalObject` (avoid colliding with unrelated same-named helpers).
      if (!/^\s*_?[A-Za-z_]+\s*:\s*&JSGlobalObject\b/.test(paramList)) continue;
    }

    // Only rewrite signatures that actually look like host-fn shapes
    // (must mention JSGlobalObject somewhere).
    if (!/JSGlobalObject/.test(paramList)) continue;

    const rewritten = rewriteSig(sigSpan, paramList, shape);
    if (rewritten == null) continue;

    txt = txt.slice(0, fnStart) + rewritten + txt.slice(closeParen + 1);
    // adjust scan position by length delta
    i += rewritten.length - sigSpan.length;
    changed = true;
    totalEdits++;
  }

  if (changed) {
    // ensure VirtualMachine is importable in this file
    if (!/\bVirtualMachine\b/.test(txt) || !/use .*VirtualMachine/.test(txt)) {
      // prepend after the first `use` block / file header
      if (!/use bun_jsc::virtual_machine::VirtualMachine;/.test(txt)) {
        txt = txt.replace(/(\n)/, `\nuse bun_jsc::virtual_machine::VirtualMachine;\n`);
      }
    }
    writeFileSync(file, txt);
    touched.add(file);
  }
}

console.error(`rewrote ${totalEdits} signatures across ${touched.size} files`);
