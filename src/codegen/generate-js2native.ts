// This file implements the global state for $zig and $cpp preprocessor macros
// as well as all the code it generates.
//
// For the actual parsing, see replacements.ts

import path, { basename, sep } from "path";
import { cap, readdirRecursiveWithExclusionsAndExtensionsSync } from "./helpers";

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
  [".cpp", ".zig", ".rs", ".bind.ts"],
);

function callBaseName(x: string) {
  return x.split(/[^A-Za-z0-9]/g).pop()!;
}

function resolveNativeFileId(call_type: NativeCallType, filename: string) {
  if (call_type === "bind") {
    if (!filename.endsWith(".bind.ts")) {
      throw new Error(`Expected filename for $bindgenFn to have .bind.ts extension, got ${JSON.stringify(filename)}`);
    }
    filename = filename.replaceAll("/", sep);
    const resolved = sourceFiles.find(file => file.endsWith(sep + filename));
    if (!resolved) {
      throw new Error(`Could not find file ${filename} in $bindgenFn call`);
    }
    return filename;
  }

  if (call_type === "cpp") {
    if (!filename.endsWith(".cpp")) {
      throw new Error(`Expected filename for $cpp to have .cpp extension, got ${JSON.stringify(filename)}`);
    }
    filename = filename.replaceAll("/", sep);
    const resolved = sourceFiles.find(file => file.endsWith(sep + filename));
    if (!resolved) {
      throw new Error(`Could not find file ${filename} in $cpp call`);
    }
    return filename;
  }

  // call_type === "native"
  filename = filename.replaceAll("/", sep);
  const resolved = sourceFiles.find(file => file.endsWith(sep + filename));
  if (resolved) {
    return resolved;
  }
  // Decoupled from disk: if not found, construct virtual path under src/ to generate symbol prefix
  const srcRoot = path.resolve(path.join(import.meta.dir, ".."));
  const virtualPath = path.resolve(path.join(srcRoot, filename));
  if (!virtualPath.startsWith(srcRoot + sep) && virtualPath !== srcRoot) {
    throw new Error(`Path traversal detected: resolved path ${virtualPath} escapes the src directory ${srcRoot}`);
  }
  return virtualPath;
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
    ? `JS2Zig__${call.filename ? normalizeSymbolPathPrefix(call.filename) + "_" : ""}${call.symbol.replace(/[^A-Za-z]/g, "_")}`
    : call.symbol;
}

function normalizeSymbolPathPrefix(input: string) {
  input = path.resolve(input);

  const bunDir = path.resolve(path.join(import.meta.dir, "..", ".."));
  if (input.startsWith(bunDir)) {
    input = input.slice(bunDir.length);
  }

  return input
    .replaceAll(".zig", "_zig_")
    .replaceAll(".rs", "_rs_")
    .replace(/[^A-Za-z]/g, "_");
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

export function getJS2NativeZig(gs2NativeZigPath: string) {
  return [
    "//! This file is generated by src/codegen/generate-js2native.ts based on seen calls to the $native() JS macro",
    `const bun = @import("bun");`,
    `const jsc = bun.jsc;`,
    ...nativeCalls
      .filter(x => x.type === "native" && x.filename.endsWith(".zig") && sourceFiles.includes(x.filename))
      .flatMap(call => [
        `export fn ${symbol(call)}_workaround(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {`,
        `  return jsc.toJSHostCall(global, @src(), @import(${JSON.stringify(path.relative(path.dirname(gs2NativeZigPath), call.filename))}).${call.symbol}, .{global});`,
        "}",
      ]),
    ...wrapperCalls
      .filter(x => x.type === "native" && x.filename.endsWith(".zig") && sourceFiles.includes(x.filename))
      .flatMap(x => [
        `export fn ${symbol({
          type: "native",
          symbol: x.symbol_target,
          filename: x.filename,
        })}(global: *jsc.JSGlobalObject, call_frame: *jsc.CallFrame) callconv(jsc.conv) jsc.JSValue {`,
        `    const function = @import(${JSON.stringify(path.relative(path.dirname(gs2NativeZigPath), x.filename))});`,
        `    return @call(bun.callmod_inline, jsc.toJSHostFn(function.${x.symbol_target}), .{global, call_frame});`,
        "}",
      ]),
    "comptime {",
    ...nativeCalls
      .filter(x => x.type === "bind")
      .flatMap(x => {
        const base = basename(x.filename.replace(/\.bind\.ts$/, ""));
        return [
          `    @export(&bun.gen.${base}.create${cap(x.symbol)}Callback, .{ .name = ${JSON.stringify(
            `js2native_bindgen_${base}_${x.symbol}`,
          )} });`,
        ];
      }),
    "}",
  ].join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Rust emitter — sibling of getJS2NativeZig().
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
// `crate::<derived-from-native-path>::<snake_case(symbol)>` — no trait, no
// runtime panic fallback. A missing function is a compile error.
// ──────────────────────────────────────────────────────────────────────────
export function getJS2NativeRust() {
  // Symbols already hand-exported in src/ (via `export_host_fn!` or
  // `#[unsafe(export_name = "JS2Zig__…")]`) — skip emitting a thunk for these
  // so the linker doesn't see two definitions.
  const handExported = new Set<string>([
    "JS2Zig___src_runtime_dns_jsc_dns_zig__Resolver_getRuntimeDefaultResultOrderOption",
    "JS2Zig___src_runtime_dns_jsc_dns_zig__Resolver_newResolver",
  ]);

  const srcRoot = path.resolve(import.meta.dir, "..");
  const snake = (s: string) =>
    s
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
      .replace(/[.\-]/g, "_")
      .toLowerCase();

  // `src/runtime/node/node_util_binding.zig` + `parseEnv`
  //   → `crate::node::node_util_binding::parse_env`
  // `src/ini/ini.zig` + `IniTestingAPIs.parse` (outside bun_runtime)
  //   → `crate::dispatch::js2native::ini_ini_testing_apis_parse` (single
  //   landing pad the port-agents fill in; still a compile error if missing).
  const rustTarget = (filename: string, sym: string) => {
    const rel = path.relative(srcRoot, filename).replace(/\.(zig|rs)$/, "");
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
    `// \`#[unsafe(no_mangle)] extern "C"\` thunks satisfying the JS2Zig__* externs`,
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
  return [
    "declare type NativeFilenameCPP = " +
      sourceFiles
        .filter(x => x.endsWith("cpp"))
        .map(x => JSON.stringify(basename(x)))
        .join("|"),
    "declare type NativeFilenameZig = " +
      sourceFiles
        .filter(x => x.endsWith("zig"))
        .map(x => JSON.stringify(basename(x)))
        .join("|"),
    "",
  ].join("\n");
}
