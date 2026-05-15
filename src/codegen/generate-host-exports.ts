// Scrapes `// HOST_EXPORT(SymbolName[, abi])` markers from `src/runtime/**/*.rs`
// and `src/jsc/**/*.rs`, classifies the safe-signature impl that follows, and
// emits one centralised `${codegenDir}/generated_host_exports.rs` containing
// every `#[unsafe(no_mangle)] extern "C"` thunk. The thunk converts raw C
// pointers back to safe `&`/`&mut` borrows and routes through
// `bun_jsc::host_fn::*` so panic-catching, exception-scope assertions, and
// `JsResult` → `JSValue` mapping are uniform across all ~425 hand-written
// exports (previously open-coded a raw-pointer deref at every site).
//
// Marker grammar (one line, immediately preceding `pub fn`):
//
//     // HOST_EXPORT(Bun__drainMicrotasksFromJS)
//     pub fn drain_microtasks_from_js(global: &JSGlobalObject, _cf: &CallFrame)
//         -> JsResult<JSValue> { … }
//
// Optional second arg selects the calling convention:
//   - `jsc`  (default for `(global, callframe) -> JSValue` shape) → JSC sysv64
//     on win-x64, `extern "C"` elsewhere; dispatched via `host_fn::host_fn_static`.
//   - `c`    → plain `extern "C"`; raw pointer thunk, no panic barrier.
//   - `rust` → `extern "Rust"`; for link-time `extern "Rust" {}` consumers
//     (cycle-breaking hooks). No pointer rewriting — signature is forwarded
//     verbatim.
//
// Signature shapes recognised for `jsc`/`c`:
//
//   shape        impl signature                                          → thunk
//   ──────────── ─────────────────────────────────────────────────────────────────
//   host         (&JSGlobalObject, &CallFrame) -> JsResult<JSValue>|JSValue
//                  → host_fn::host_fn_static(g, cf, path::name)
//   lazy         (&JSGlobalObject) -> JsResult<JSValue>|JSValue
//                  → host_fn::host_fn_lazy(g, path::name)
//   generic      (T0, T1, …) -> R   where Tn ∈ {&X, &mut X, *T, scalar}
//                  → unsafe extern "C" fn(<ptr-ified Tn>) -> R { path::name(<deref>) }
//
// Anything that doesn't fit `generic` (lifetimes, generics, `impl Trait`)
// errors at codegen time with the offending file:line.
//
// The generator also walks every `unsafe extern "C" {` block under `src/jsc/`
// and `src/runtime/` and emits a per-crate consolidated import list as a
// comment block at the foot of the output (audit aid; the actual move into
// `ffi_imports.rs` is incremental).
//
// Usage: `bun run src/codegen/generate-host-exports.ts <codegenDir>`

import { existsSync, readFileSync } from "fs";
import path from "path";
import { readdirRecursive, writeIfNotChanged } from "./helpers";

if (process.env.BUN_SILENT === "1") console.log = () => {};

const argv = process.argv.slice(2);
const outBase = argv.pop();
if (!outBase) {
  console.error("usage: generate-host-exports.ts <codegenDir>");
  process.exit(1);
}

const repoRoot = path.resolve(import.meta.dir, "..", "..");
const scanRoots = [
  { dir: path.join(repoRoot, "src", "runtime"), crate: "bun_runtime" },
  { dir: path.join(repoRoot, "src", "jsc"), crate: "bun_jsc" },
];

// ───────────────────────── module-path resolver ─────────────────────────────
// Same walk as generate-classes.ts::rustModuleResolver — map an absolute .rs
// file to its `crate::a::b` path by following `mod foo;` declarations from
// each crate's `lib.rs`. We need this so the emitted thunk can name the impl
// fn by its fully-qualified path from inside `bun_runtime::generated_host_exports`.

type FileMod = { crate: string; modPath: string };
const fileToMod = new Map<string, FileMod>();
const modRe = /(?:#\[path\s*=\s*"([^"]+)"\]\s*)?(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/g;

function walk(file: string, crate: string, modPath: string) {
  const abs = path.resolve(file);
  if (fileToMod.has(abs) || !existsSync(abs)) return;
  let src: string;
  try {
    src = readFileSync(abs, "utf8");
  } catch {
    return;
  }
  fileToMod.set(abs, { crate, modPath });
  const dir = path.dirname(abs);
  for (const m of src.matchAll(modRe)) {
    const [, pathAttr, modName] = m;
    let child: string | null = null;
    if (pathAttr) child = path.resolve(dir, pathAttr);
    else {
      const f1 = path.resolve(dir, `${modName}.rs`);
      const f2 = path.resolve(dir, modName, "mod.rs");
      child = existsSync(f1) ? f1 : existsSync(f2) ? f2 : null;
    }
    if (child) walk(child, crate, `${modPath}::${modName}`);
  }
}
for (const { dir, crate } of scanRoots) {
  walk(path.join(dir, "lib.rs"), crate, "crate");
}

// ───────────────────────────── scrape markers ───────────────────────────────

interface Param {
  /** original safe-side spelling, e.g. `global: &JSGlobalObject` */
  raw: string;
  name: string;
  /** safe-side type as written */
  ty: string;
  /** thunk-side (C ABI) type */
  cTy: string;
  /** expression to pass into the impl from the thunk param `name` */
  callExpr: string;
}

interface Export {
  symbol: string;
  abi: "jsc" | "c" | "rust";
  file: string;
  line: number;
  fnName: string;
  modPath: string; // `crate::…` (relative to bun_runtime) or `bun_jsc::…`
  params: Param[];
  ret: string;
  shape: "host" | "lazy" | "generic" | "rust";
}

const markerRe = /^\s*\/\/\s*HOST_EXPORT\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*(jsc|c|rust))?\s*\)\s*$/;
// `pub fn name(` — capture name; the param list and return type are pulled by
// a small balanced-paren scanner because params routinely span lines.
const fnHeadRe = /^\s*pub\s+(?:unsafe\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/;

function ptrify(ty: string): { cTy: string; deref: (n: string) => string } {
  ty = ty.trim();
  // `&[T]` / `&str` are NOT FFI-safe; reject (caller should use ptr+len).
  if (/^&\s*(?:\[|str\b)/.test(ty)) {
    throw new Error(`slice/str param \`${ty}\` is not FFI-safe; pass (ptr, len)`);
  }
  // `&mut T` / `&T` — keep as a reference in the thunk signature. `&T` and
  // `*const T` (resp. `&mut T`/`*mut T`) are ABI-identical for `extern "C"`
  // when the C++ caller guarantees non-null (it does), so the thunk param can
  // be the safe reference type directly and the body needs no `unsafe` deref.
  if (/^&/.test(ty)) return { cTy: ty, deref: n => n };
  // Already a raw pointer / scalar / `Option<…>` / `JSValue` — pass through.
  return { cTy: ty, deref: n => n };
}

function parseParams(list: string, where: string): Param[] {
  // Split on top-level commas (ignore `<…>` and `(…)` nesting).
  const parts: string[] = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  if (start < list.length) parts.push(list.slice(start));
  return parts
    .map(p => p.trim())
    .filter(Boolean)
    .map((raw, i) => {
      // `name: Type` — strip leading `mut ` / `_` patterns.
      const colon = raw.indexOf(":");
      if (colon < 0) throw new Error(`${where}: cannot parse param \`${raw}\``);
      let name = raw
        .slice(0, colon)
        .trim()
        .replace(/^mut\s+/, "");
      // Only the bare `_` pattern is not a usable identifier; `_foo` is valid
      // and intentionally documentary — keep it.
      if (name === "_") name = `_a${i}`;
      const ty = raw.slice(colon + 1).trim();
      const { cTy, deref } = ptrify(ty);
      return { raw, name, ty, cTy, callExpr: deref(name) };
    });
}

const exportsFound: Export[] = [];
const errors: string[] = [];
const seenSymbols = new Map<string, string>();

for (const { dir, crate } of scanRoots) {
  const files = readdirRecursive(dir).filter(
    f =>
      f.endsWith(".rs") &&
      !f.includes(`${path.sep}bindings${path.sep}`) && // C++-side .rs vendor stubs
      !f.endsWith("generated_host_exports.rs"),
  );
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("HOST_EXPORT(")) continue;
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const mk = markerRe.exec(lines[i]);
      if (!mk) continue;
      const symbol = mk[1];
      let abi = (mk[2] as Export["abi"]) ?? undefined;
      // Find the `pub fn` head on the next non-blank, non-attr line.
      let j = i + 1;
      while (j < lines.length && (/^\s*(#\[|\/\/|$)/.test(lines[j]) || lines[j].trim() === "")) j++;
      const head = fnHeadRe.exec(lines[j] ?? "");
      if (!head) {
        errors.push(`${file}:${i + 1}: HOST_EXPORT(${symbol}) not followed by \`pub fn\``);
        continue;
      }
      const fnName = head[1];
      // Balanced-paren scan for the param list + return type.
      let buf = lines[j].slice(lines[j].indexOf("(") + 1);
      let depth = 1,
        k = j;
      while (depth > 0) {
        for (const c of buf) {
          if (c === "(") depth++;
          else if (c === ")" && --depth === 0) break;
        }
        if (depth > 0) {
          k++;
          if (k >= lines.length) break;
          buf += " " + lines[k];
        }
      }
      const closeIdx = (() => {
        let d = 1;
        for (let p = 0; p < buf.length; p++) {
          if (buf[p] === "(") d++;
          else if (buf[p] === ")" && --d === 0) return p;
        }
        return -1;
      })();
      const paramList = buf.slice(0, closeIdx);
      let after = buf.slice(closeIdx + 1);
      // Pull more lines until we hit `{` or `;` for the return type.
      while (!/[{;]/.test(after) && k + 1 < lines.length) {
        k++;
        after += " " + lines[k];
      }
      const retMatch = after.match(/->\s*([^{;]+)/);
      const ret = (retMatch ? retMatch[1] : "()").trim();

      const where = `${path.relative(repoRoot, file)}:${j + 1}`;
      let params: Param[];
      try {
        params = parseParams(paramList, where);
      } catch (e) {
        errors.push(`${where}: ${(e as Error).message}`);
        continue;
      }

      // Classify shape.
      const isJsRet = ret === "JSValue" || /^(?:bun_jsc::)?JsResult\s*<\s*JSValue\s*>$/.test(ret);
      let shape: Export["shape"];
      if (abi === "rust") shape = "rust";
      else if (
        params.length === 2 &&
        /JSGlobalObject$/.test(params[0].ty) &&
        /CallFrame$/.test(params[1].ty) &&
        isJsRet
      ) {
        shape = "host";
        abi ??= "jsc";
      } else if (params.length === 1 && /JSGlobalObject$/.test(params[0].ty) && isJsRet) {
        shape = "lazy";
        // Lazy property creators are direct C++ calls (e.g. ZigGlobalObject.cpp
        // declares `extern "C" JSC::EncodedJSValue BunObject__createBunStd*`),
        // NOT JSC trampoline dispatch — default to `c`. A SYSV_ABI lazy getter
        // (e.g. `BunObject_lazyPropCb_*`) must opt in with `, jsc` explicitly.
        abi ??= "c";
      } else {
        shape = "generic";
        abi ??= "c";
      }

      const fm = fileToMod.get(path.resolve(file));
      // Module path as seen from `bun_runtime::generated_host_exports`.
      // Files that the resolver didn't reach (gated mods, #[path] indirection
      // we missed) fall back to a path-derived guess; failure surfaces as a
      // compile error pointing at the thunk, which is the desired behaviour.
      let modPath: string;
      if (fm) {
        modPath = fm.crate === "bun_jsc" ? fm.modPath.replace(/^crate/, "bun_jsc") : fm.modPath;
      } else {
        const rel = path.relative(path.join(repoRoot, "src", "runtime"), file);
        modPath =
          "crate::" +
          rel
            .replace(/\.rs$/, "")
            .split(path.sep)
            .map(s => (s === "mod" ? "" : s))
            .filter(Boolean)
            .join("::");
      }

      if (seenSymbols.has(symbol)) {
        errors.push(`${where}: duplicate HOST_EXPORT(${symbol}) — first at ${seenSymbols.get(symbol)}`);
        continue;
      }
      seenSymbols.set(symbol, where);

      // Type tokens are copied verbatim into the thunk; `crate::` in a
      // bun_jsc-sourced impl would resolve as `bun_runtime::` in the
      // generated module. Rewrite to the source crate's name so
      // `*mut crate::cpp_task::CppTask` etc. round-trip.
      const cratePrefix = fm?.crate === "bun_jsc" ? "bun_jsc::" : "crate::";
      const rewriteTy = (t: string) => t.replace(/\bcrate::/g, cratePrefix);
      for (const p of params) {
        p.cTy = rewriteTy(p.cTy);
        p.ty = rewriteTy(p.ty);
      }
      const retRw = rewriteTy(ret);

      exportsFound.push({ symbol, abi, file, line: j + 1, fnName, modPath, params, ret: retRw, shape });
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error("error: " + e);
  process.exit(1);
}

// ──────────────────────── consolidate extern "C" {} ─────────────────────────
// Audit-only: collect every `unsafe extern "C" {` declaration and bucket by
// crate so the per-crate `ffi_imports.rs` migration has a checklist. We emit
// the count and the per-file tally as a trailing comment; moving the actual
// `fn` items is incremental (one PR per subsystem) because each block carries
// type imports that don't trivially relocate.

const externBlocks: Record<string, number> = {};
const externRe = /unsafe\s+extern\s+"C"\s*\{/g;
for (const { dir } of scanRoots) {
  for (const file of readdirRecursive(dir).filter(f => f.endsWith(".rs"))) {
    const src = readFileSync(file, "utf8");
    const n = [...src.matchAll(externRe)].length;
    if (n) externBlocks[path.relative(repoRoot, file)] = n;
  }
}
const externTotal = Object.values(externBlocks).reduce((a, b) => a + b, 0);

// ─────────────────────────────── emit ───────────────────────────────────────

/// Emit a `#[unsafe(no_mangle)]` thunk with the requested ABI. For `jsc` we
/// duplicate the item under a `cfg` split (`"sysv64"` on win-x64, `"C"`
/// elsewhere) — same expansion as `#[bun_jsc::host_call]` /
/// `bun_jsc::jsc_host_abi!`. Rust forbids macros in ABI position, so we emit
/// both arms verbatim; the inactive one is compiled out.
function emitNoMangle(
  abi: Export["abi"],
  symbol: string,
  sig: string,
  ret: string,
  body: string,
  unsafeFn = false,
): string {
  const qual = unsafeFn ? "unsafe " : "";
  const item = (abiStr: string, cfg: string) =>
    `${cfg}#[unsafe(no_mangle)]
pub ${qual}extern "${abiStr}" fn ${symbol}(${sig}) -> ${ret} {
${body}
}`;
  if (abi === "jsc") {
    return (
      item("sysv64", `#[cfg(all(windows, target_arch = "x86_64"))]\n`) +
      "\n" +
      item("C", `#[cfg(not(all(windows, target_arch = "x86_64")))]\n`)
    );
  }
  // `c` (and anything else that reaches here) → plain `extern "C"`.
  return item("C", "");
}

function emitThunk(e: Export): string {
  const impl = `${e.modPath}::${e.fnName}`;
  const loc = `${path.relative(repoRoot, e.file)}:${e.line}`;
  // `JsResult<JSValue>` impls need `to_js_host_call` (exception-scope assert +
  // panic barrier + Err→empty mapping). Plain-`JSValue` impls are bare
  // `callconv(jsc.conv)` bodies in the .zig spec — wrap them and you trip
  // `assert_exception_presence_matches(false)` whenever the body legitimately
  // leaves an exception pending while returning non-empty (e.g.
  // `Bun__drainMicrotasksFromJS`). Match `#[bun_jsc::host_call]`: deref + call,
  // no scope.
  const retIsJsResult = /^(?:bun_jsc::)?JsResult\s*<\s*JSValue\s*>$/.test(e.ret);
  switch (e.shape) {
    case "host": {
      // JSC host fn: `(g, cf) -> JSValue`. Always JSC ABI — these are
      // dispatched through `JSC::JSFunction` (`BUN_DECLARE_HOST_FUNCTION`).
      // Keep raw `*mut` params so the symbol coerces to `host_fn::JSHostFn`
      // when Rust code passes it as a callback (e.g. `JSValue::then2`). The
      // thunk is `pub unsafe extern fn` (matches `JSHostFn`'s `unsafe`
      // qualifier) and routes through the `_raw` helper that derefs under a
      // documented safety contract — so no safe `pub fn` derefs a raw ptr.
      const body = retIsJsResult
        ? `    // SAFETY: JSC trampoline guarantees g/cf are non-null and valid.\n    unsafe { host_fn::host_fn_static_raw(g, cf, ${impl}) }`
        : `    // SAFETY: JSC trampoline guarantees g/cf are non-null and valid.\n    unsafe { host_fn::host_fn_static_passthrough_raw(g, cf, ${impl}) }`;
      return `
// ${loc}
${emitNoMangle(e.abi, e.symbol, "g: *mut JSGlobalObject, cf: *mut CallFrame", "JSValue", body, /*unsafeFn*/ true)}`;
    }
    case "lazy": {
      // Lazy property creator: `(g) -> JSValue`. ABI is whatever the C++ decl
      // uses — `e.abi` (default `c` for direct `extern "C"` calls; `jsc` for
      // `SYSV_ABI` lazyPropCb-style getters). `&JSGlobalObject` is
      // ABI-identical to non-null `*const JSGlobalObject`; C++ never passes
      // null here.
      const body = retIsJsResult
        ? `    host_fn::host_fn_lazy(g, ${impl})`
        : `    host_fn::host_fn_lazy_passthrough(g, ${impl})`;
      return `
// ${loc}
${emitNoMangle(e.abi, e.symbol, "g: &JSGlobalObject", "JSValue", body)}`;
    }
    case "rust": {
      // `extern "Rust"` link-time hook: forward the safe signature verbatim
      // (no pointer rewriting; `extern "Rust"` ABI == native Rust ABI).
      // Reference params/returns are rejected — `extern "Rust" fn` items need
      // explicit lifetimes for borrowed types and the generator does not
      // synthesise them. Use raw pointers in the impl signature instead.
      for (const p of e.params)
        if (p.ty.startsWith("&"))
          throw new Error(
            `${loc}: HOST_EXPORT(${e.symbol}, rust) param \`${p.raw}\` is a reference; use a raw pointer`,
          );
      if (e.ret.startsWith("&"))
        throw new Error(
          `${loc}: HOST_EXPORT(${e.symbol}, rust) return type \`${e.ret}\` is a reference; use a raw pointer`,
        );
      const sig = e.params.map(p => `${p.name}: ${p.ty}`).join(", ");
      const call = e.params.map(p => p.name).join(", ");
      return `
// ${loc}
#[unsafe(no_mangle)]
pub extern "Rust" fn ${e.symbol}(${sig}) -> ${e.ret} {
    ${impl}(${call})
}`;
    }
    case "generic": {
      const sig = e.params.map(p => `${p.name}: ${p.cTy}`).join(", ");
      // Bind each ref-deref once so the call site is clean (and so a
      // `JsResult` body doesn't deref `global` twice).
      const binds = e.params
        .filter(p => p.callExpr !== p.name)
        .map(p => `    let ${p.name} = ${p.callExpr};\n`)
        .join("");
      const call = e.params.map(p => p.name).join(", ");
      // If the impl returns `JsResult<JSValue>` and takes a `&JSGlobalObject`
      // somewhere, route through `host_fn_result` so the error is mapped; else
      // forward raw.
      const globalParam = e.params.find(p => /JSGlobalObject$/.test(p.ty));
      const cRet = retIsJsResult ? "JSValue" : e.ret;
      const body =
        retIsJsResult && globalParam
          ? `host_fn::host_fn_result(${globalParam.name}, || ${impl}(${call}))`
          : `${impl}(${call})`;
      return `
// ${loc}
${emitNoMangle(e.abi, e.symbol, sig, cRet, `${binds}    ${body}`)}`;
    }
  }
}

const header = `// Auto-generated by src/codegen/generate-host-exports.ts — DO NOT EDIT.
//
// Centralised \`#[unsafe(no_mangle)] extern "C"\` thunks for hand-written host
// exports. Each thunk derefs the raw C pointers and calls the safe-signature
// \`pub fn …_impl(&JSGlobalObject, &CallFrame) -> JsResult<JSValue>\` (or
// shape-appropriate variant) via \`bun_jsc::host_fn::*\`, so the source files
// contain zero \`#[no_mangle]\` and zero raw-pointer-deref boilerplate.
//
// Adding an export: put \`// HOST_EXPORT(SymbolName)\` on the line above the
// \`pub fn\` in any \`src/runtime/\` or \`src/jsc/\` file, re-run codegen.
//
// exports: ${exportsFound.length}   extern-"C" import blocks remaining: ${externTotal}

use core::ffi::{c_char, c_int, c_void};
use bun_jsc::{self, host_fn, CallFrame, JSGlobalObject, JSValue, JsResult};
// Common pointee types that appear in \`generic\`-shape signatures. Anything
// not listed here must be spelled with a path that resolves from this module
// (\`bun_jsc::…\` / \`crate::…\`) in the impl signature — the generator copies
// the type token verbatim.
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSInternalPromise, JSObject, JSPromise, ZigStackFrame};
use bun_jsc::debugger::{
    InspectorBunFrontendDevServerAgentHandle, LifecycleHandle, TestReporterHandle,
};
use bun_core::String as BunString;
`;

exportsFound.sort((a, b) => a.symbol.localeCompare(b.symbol));
const body = exportsFound.map(emitThunk).join("\n");

const externAudit =
  `\n// ───── extern "C" {} consolidation audit (${externTotal} blocks across ${Object.keys(externBlocks).length} files) ─────\n` +
  Object.entries(externBlocks)
    .sort(([, a], [, b]) => b - a)
    .map(([f, n]) => `//   ${String(n).padStart(3)}  ${f}`)
    .join("\n") +
  "\n";

writeIfNotChanged(path.join(outBase, "generated_host_exports.rs"), header + body + "\n" + externAudit);

console.log(
  `generated_host_exports.rs: ${exportsFound.length} exports ` +
    `(host=${exportsFound.filter(e => e.shape === "host").length}, ` +
    `lazy=${exportsFound.filter(e => e.shape === "lazy").length}, ` +
    `generic=${exportsFound.filter(e => e.shape === "generic").length}, ` +
    `rust=${exportsFound.filter(e => e.shape === "rust").length}); ` +
    `${externTotal} extern-C blocks audited`,
);
