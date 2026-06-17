// This file implements the global state for $native and $cpp preprocessor macros
// as well as all the code it generates.
//
// For the actual parsing, see replacements.ts

import path, { basename, sep } from "path";
import { readdirRecursiveWithExclusionsAndExtensionsSync } from "./helpers";

//
interface NativeCall {
  id: number;
  type: NativeCallType;
  filename: string;
  symbol: string;
  is_wrapped: boolean;
}

interface WrapperCall {
  type: NativeCallType;
  wrap_kind: "new-function";
  symbol_target: string;
  symbol_generated: string;
  display_name: string;
  call_length: number;
  filename: string;
}

type NativeCallType = "native" | "cpp" | "bind";

const nativeCalls: NativeCall[] = [];
const wrapperCalls: WrapperCall[] = [];

const sourceFiles = readdirRecursiveWithExclusionsAndExtensionsSync(
  path.join(import.meta.dir, "../"),
  ["deps", "node_modules", "WebKit"],
  [".cpp", ".rs", ".bind.ts"],
);

function callBaseName(x: string) {
  return x.split(/[^A-Za-z0-9]/g).pop()!;
}

const nativeCallExtensions: Record<NativeCallType, string> = {
  native: ".rs",
  cpp: ".cpp",
  bind: ".bind.ts",
};

function resolveNativeFileId(call_type: NativeCallType, filename: string) {
  const ext = nativeCallExtensions[call_type];
  if (!filename.endsWith(ext)) {
    throw new Error(`Expected filename for $${call_type} to have ${ext} extension, got ${JSON.stringify(filename)}`);
  }

  filename = filename.replaceAll("/", sep);
  const matches = sourceFiles.filter(file => file.endsWith(sep + filename));
  if (matches.length === 0) {
    const fnName = call_type === "bind" ? "bindgenFn" : call_type;
    throw new Error(`Could not find file ${filename} in $${fnName} call`);
  }

  if (call_type === "native") {
    // The resolved path feeds both the exported symbol name and the Rust
    // thunk target, so a multi-match cannot be silently first-match resolved.
    if (matches.length > 1) {
      const srcDir = path.join(import.meta.dir, "..");
      throw new Error(
        `Ambiguous filename ${JSON.stringify(filename)} in $native call. Qualify it with a directory, one of: ` +
          matches.map(m => JSON.stringify(path.relative(srcDir, m).replaceAll(sep, "/"))).join(", "),
      );
    }
    return matches[0];
  }

  return filename;
}

export function registerNativeCall(
  call_type: NativeCallType,
  filename: string,
  symbol: string,
  create_fn_len: null | number,
) {
  const resolved_filename = resolveNativeFileId(call_type, filename);

  const maybe_wrapped_symbol = create_fn_len != null ? "js2native_wrap_" + symbol.replace(/[^A-Za-z]/g, "_") : symbol;

  const existing = nativeCalls.find(
    call =>
      call.is_wrapped == (create_fn_len != null) &&
      call.filename === resolved_filename &&
      call.symbol === maybe_wrapped_symbol,
  );
  if (existing) {
    return existing.id;
  }

  const id = nativeCalls.length;
  nativeCalls.push({
    id,
    type: create_fn_len != null ? "cpp" : call_type,
    filename: resolved_filename,
    symbol: maybe_wrapped_symbol,
    is_wrapped: create_fn_len != null,
  });
  if (create_fn_len != null) {
    wrapperCalls.push({
      type: call_type,
      wrap_kind: "new-function",
      symbol_target: symbol,
      symbol_generated: "js2native_wrap_" + symbol.replace(/[^A-Za-z]/g, "_"),
      display_name: callBaseName(symbol),
      call_length: create_fn_len,
      filename: resolved_filename,
    });
  }
  return id;
}

function symbol(call: Pick<NativeCall, "type" | "symbol" | "filename">) {
  return call.type === "native"
    ? `JS2Native__${call.filename ? normalizeSymbolPathPrefix(call.filename) + "_" : ""}${call.symbol.replace(/[^A-Za-z]/g, "_")}`
    : call.symbol;
}

function normalizeSymbolPathPrefix(input: string) {
  input = path.resolve(input);

  const bunDir = path.resolve(path.join(import.meta.dir, "..", ".."));
  if (input.startsWith(bunDir)) {
    input = input.slice(bunDir.length);
  }

  return input.replace(/\.rs$/, "").replace(/[^A-Za-z]/g, "_");
}

function cppPointer(call: NativeCall) {
  return `&${symbol(call)}`;
}

export function getJS2NativeCPP() {
  const files = [
    ...new Set(nativeCalls.filter(x => x.filename.endsWith(".cpp")).map(x => x.filename.replace(/.cpp$/, ".h"))),
  ];

  const externs: string[] = [];

  const nativeCallStrings = nativeCalls
    .filter(x => x.type === "native")
    .flatMap(
      call => (
        externs.push(`extern "C" SYSV_ABI JSC::EncodedJSValue ${symbol(call)}_workaround(Zig::GlobalObject*);` + "\n"),
        [
          `static ALWAYS_INLINE JSC::JSValue ${symbol(call)}(Zig::GlobalObject* global) {`,
          `    return JSValue::decode(${symbol(call)}_workaround(global));`,
          `}` + "\n\n",
        ]
      ),
    );

  const wrapperCallStrings = wrapperCalls.map(x => {
    if (x.wrap_kind === "new-function") {
      return [
        (x.type === "native" &&
          externs.push(
            `BUN_DECLARE_HOST_FUNCTION(${symbol({
              type: "native",
              symbol: x.symbol_target,
              filename: x.filename,
            })});`,
          ),
        "") || "",
        `static ALWAYS_INLINE JSC::JSValue ${x.symbol_generated}(Zig::GlobalObject* globalObject) {`,
        `  return JSC::JSFunction::create(globalObject->vm(), globalObject, ${x.call_length}, ${JSON.stringify(
          x.display_name,
        )}_s, ${symbol({
          type: x.type,
          symbol: x.symbol_target,

          filename: x.filename,
        })}, JSC::ImplementationVisibility::Public);`,
        `}`,
      ].join("\n");
    }
    throw new Error(`Unknown wrap kind ${x.wrap_kind}`);
  });

  return [
    `#pragma once`,
    `#include "root.h"`,
    ...files.map(filename => `#include ${JSON.stringify(filename)}`),
    ...externs,
    "\n" + "namespace JS2NativeGenerated {",
    "using namespace Bun;",
    "using namespace JSC;",
    "using namespace WebCore;" + "\n",
    ...nativeCallStrings,
    ...wrapperCallStrings,
    ...nativeCalls
      .filter(x => x.type === "bind")
      .map(
        x =>
          `extern "C" SYSV_ABI JSC::EncodedJSValue js2native_bindgen_${basename(x.filename.replace(/\.bind\.ts$/, ""))}_${x.symbol}(Zig::GlobalObject*);`,
      ),
    `typedef JSC::JSValue (*JS2NativeFunction)(Zig::GlobalObject*);`,
    `static ALWAYS_INLINE JSC::JSValue callJS2Native(int32_t index, Zig::GlobalObject* global) {`,
    ` switch(index) {`,
    ...nativeCalls.map(
      x =>
        `    case ${x.id}: return ${
          x.type === "bind"
            ? `JSC::JSValue::decode(js2native_bindgen_${basename(x.filename.replace(/\.bind\.ts$/, ""))}_${x.symbol}(global))`
            : `${symbol(x)}(global)`
        };`,
    ),
    `    default:`,
    `      __builtin_unreachable();`,
    `  }`,
    `}`,
    `#define JS2NATIVE_COUNT ${nativeCalls.length}`,
    "}",
  ].join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Rust emitter.
//
// Emits, for every $native() call site, a `#[unsafe(no_mangle)] extern "C"`
// thunk whose unmangled name and signature is byte-identical to the extern
// the C++ side declares in GeneratedJS2Native.h. The C++ output is invariant;
// only the implementer of the symbol changes.
//
// Two ABI shapes:
//   • nativeCalls (type "native")  → `${sym}_workaround(global) -> JSValue`
//   • wrapperCalls (type "native") → `${sym}(global, callframe) -> JSValue`
//
// Each thunk calls the hand-ported Rust function directly at
// `crate::<derived-from-rs-path>::<snake_case(symbol)>` — no trait, no
// runtime panic fallback. A missing function is a compile error.
// ──────────────────────────────────────────────────────────────────────────
export function getJS2NativeRust() {
  // Symbols already hand-exported in src/ (via `export_host_fn!` or
  // `#[unsafe(export_name = "JS2Native__…")]`) — skip emitting a thunk for
  // these so the linker doesn't see two definitions.
  const handExported = new Set<string>([
    "JS2Native___src_runtime_dns_jsc_dns_Resolver_getRuntimeDefaultResultOrderOption",
    "JS2Native___src_runtime_dns_jsc_dns_Resolver_newResolver",
  ]);

  const srcRoot = path.resolve(import.meta.dir, "..");
  const snake = (s: string) =>
    s
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .replace(/[.\-]/g, "_")
      .toLowerCase();

  // `src/runtime/node/node_util_binding.rs` + `parseEnv`
  //   → `crate::node::node_util_binding::parse_env`
  // `src/install_jsc/ini_jsc.rs` + `IniTestingAPIs.parse` (outside bun_runtime)
  //   → `crate::dispatch::js2native::install_jsc_ini_jsc_ini_testing_ap_is_parse`
  //   (flat landing pad of `pub use` re-exports; a missing target is still a
  //   compile error).
  const rustTarget = (filename: string, sym: string) => {
    const rel = path.relative(srcRoot, filename).replace(/\.rs$/, "");
    const segs = rel.split(path.sep);
    const fn = sym
      .split(".")
      .map(s => snake(s))
      .join("::");
    if (segs[0] === "runtime") {
      const mod = segs
        .slice(1)
        .map(s => snake(s))
        .join("::");
      return `crate::${mod}::${fn}`;
    }
    // Out-of-crate call site: route through a flat dispatch module that
    // re-exports the real impl from its owning crate.
    return `crate::dispatch::js2native::${snake(segs.join("_"))}_${fn.replace(/::/g, "_")}`;
  };

  const thunks: string[] = [];
  const seen = new Set<string>();

  for (const call of nativeCalls.filter(x => x.type === "native")) {
    const sym = `${symbol(call)}_workaround`;
    if (seen.has(sym)) continue;
    seen.add(sym);
    const target = rustTarget(call.filename, call.symbol);
    thunks.push(
      `// $native(${path.basename(call.filename)}, ${call.symbol})`,
      `bun_jsc::jsc_host_abi! {`,
      `    #[unsafe(no_mangle)]`,
      `    pub unsafe fn ${sym}(global: &JSGlobalObject) -> JSValue {`,
      `        host_fn::host_fn_lazy(global, |g| ${target}(g))`,
      `    }`,
      `}`,
      ``,
    );
  }

  for (const x of wrapperCalls.filter(x => x.type === "native")) {
    const sym = symbol({ type: "native", symbol: x.symbol_target, filename: x.filename });
    if (seen.has(sym)) continue;
    seen.add(sym);
    if (handExported.has(sym)) {
      thunks.push(`// ${sym}: hand-exported in src/ — thunk omitted to avoid duplicate symbol`, ``);
      continue;
    }
    const target = rustTarget(x.filename, x.symbol_target);
    thunks.push(
      `// $native(${path.basename(x.filename)}, ${x.symbol_target})`,
      `bun_jsc::jsc_host_abi! {`,
      `    #[unsafe(no_mangle)]`,
      `    pub unsafe fn ${sym}(global: &JSGlobalObject, callframe: &CallFrame) -> JSValue {`,
      `        host_fn::host_fn_static(global, callframe, |g, cf| ${target}(g, cf))`,
      `    }`,
      `}`,
      ``,
    );
  }

  return [
    `// Auto-generated by src/codegen/generate-js2native.ts — DO NOT EDIT.`,
    `//`,
    `// \`#[unsafe(no_mangle)] extern "C"\` thunks satisfying the JS2Native__* externs`,
    `// declared by GeneratedJS2Native.h (the JS-module → native dispatch table).`,
    `// Each thunk calls the hand-ported Rust function directly; a missing`,
    `// function is a compile error in \`cargo check -p bun_runtime\`.`,
    `//`,
    `// Calling convention: \`jsc.conv\` is plain \`extern "C"\` on every target except`,
    `// Windows-x64 (\`extern "sysv64"\`); see generated_classes.rs for the same note.`,
    ``,
    `#[allow(unused_imports)] // emitted for thunk shapes that vary per build`,
    `use bun_jsc::{self, host_fn, CallFrame, JSGlobalObject, JSValue, JsError, JsResult};`,
    ``,
    ...thunks,
    `// exported symbols: ${seen.size}`,
    ``,
  ].join("\n");
}

export function getJS2NativeDTS() {
  // Accept both the bare basename and the full src-relative path: call sites
  // use the latter to disambiguate when two files share a basename. A
  // basename that appears in more than one directory is rejected by
  // resolveNativeFileId, so don't offer it as a valid key.
  const srcDir = path.join(import.meta.dir, "..");
  const rustFiles = sourceFiles.filter(f => f.endsWith(".rs"));
  const basenameCounts = new Map<string, number>();
  for (const file of rustFiles) {
    const name = basename(file);
    basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1);
  }
  const rustNames = new Set<string>();
  for (const file of rustFiles) {
    const name = basename(file);
    if (basenameCounts.get(name) === 1) rustNames.add(name);
    rustNames.add(path.relative(srcDir, file).replaceAll(sep, "/"));
  }

  return [
    "declare type NativeFilenameCPP = " +
      sourceFiles
        .filter(x => x.endsWith("cpp"))
        .map(x => JSON.stringify(basename(x)))
        .join("|"),
    "declare type NativeFilenameRust = " + [...rustNames].map(x => JSON.stringify(x)).join("|"),
    "",
  ].join("\n");
}
