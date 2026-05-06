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

type NativeCallType = "zig" | "cpp" | "bind";

const nativeCalls: NativeCall[] = [];
const wrapperCalls: WrapperCall[] = [];

const sourceFiles = readdirRecursiveWithExclusionsAndExtensionsSync(
  path.join(import.meta.dir, "../"),
  ["deps", "node_modules", "WebKit"],
  [".cpp", ".zig", ".bind.ts"],
);

function callBaseName(x: string) {
  return x.split(/[^A-Za-z0-9]/g).pop()!;
}

function resolveNativeFileId(call_type: NativeCallType, filename: string) {
  const ext = call_type === "bind" ? ".bind.ts" : `.${call_type}`;
  if (!filename.endsWith(ext)) {
    throw new Error(`Expected filename for $${call_type} to have ${ext} extension, got ${JSON.stringify(filename)}`);
  }

  filename = filename.replaceAll("/", sep);
  const resolved = sourceFiles.find(file => file.endsWith(sep + filename));
  if (!resolved) {
    const fnName = call_type === "bind" ? "bindgenFn" : call_type;
    throw new Error(`Could not find file ${filename} in $${fnName} call`);
  }

  if (call_type === "zig") {
    return resolved;
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
  return call.type === "zig"
    ? `JS2Zig__${call.filename ? normalizeSymbolPathPrefix(call.filename) + "_" : ""}${call.symbol.replace(/[^A-Za-z]/g, "_")}`
    : call.symbol;
}

function normalizeSymbolPathPrefix(input: string) {
  input = path.resolve(input);

  const bunDir = path.resolve(path.join(import.meta.dir, "..", ".."));
  if (input.startsWith(bunDir)) {
    input = input.slice(bunDir.length);
  }

  return input.replaceAll(".zig", "_zig_").replace(/[^A-Za-z]/g, "_");
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
    .filter(x => x.type === "zig")
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
        (x.type === "zig" &&
          externs.push(
            `BUN_DECLARE_HOST_FUNCTION(${symbol({
              type: "zig",
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
    "//! This file is generated by src/codegen/generate-js2native.ts based on seen calls to the $zig() JS macro",
    `const bun = @import("bun");`,
    `const jsc = bun.jsc;`,
    ...nativeCalls
      .filter(x => x.type === "zig")
      .flatMap(call => [
        `export fn ${symbol(call)}_workaround(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {`,
        `  return jsc.toJSHostCall(global, @src(), @import(${JSON.stringify(path.relative(path.dirname(gs2NativeZigPath), call.filename))}).${call.symbol}, .{global});`,
        "}",
      ]),
    ...wrapperCalls
      .filter(x => x.type === "zig")
      .flatMap(x => [
        `export fn ${symbol({
          type: "zig",
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
// Emits, for every $zig() call site, a `#[unsafe(no_mangle)] extern "C"`
// thunk whose unmangled name and signature is byte-identical to the extern
// the C++ side declares in GeneratedJS2Native.h. The C++ output is invariant;
// only the implementer of the symbol changes.
//
// Two ABI shapes (mirroring the Zig output exactly):
//   • nativeCalls (type "zig")  → `${sym}_workaround(global) -> JSValue`
//   • wrapperCalls (type "zig") → `${sym}(global, callframe) -> JSValue`
//
// Each thunk dispatches through a single `Js2NativeImpl` trait whose default
// bodies are `unimplemented!()`, matching the generated_classes.rs pattern:
// porting a function = overriding the corresponding trait method on
// `struct Js2Native` (or, more idiomatically, having the override forward to
// the real `crate::…::snake_case` impl).
// ──────────────────────────────────────────────────────────────────────────
export function getJS2NativeRust() {
  // Method names on the trait must be unique across files; the exported C
  // symbol already encodes the file path, so derive the trait method id from
  // the full symbol (minus the `JS2Zig__` prefix / `_workaround` suffix).
  const methodId = (sym: string) =>
    sym
      .replace(/^JS2Zig__/, "")
      .replace(/_workaround$/, "")
      .replace(/^_+/, "")
      .replace(/[^A-Za-z0-9_]/g, "_");

  const traitDecls: string[] = [];
  const thunks: string[] = [];
  const seen = new Set<string>();

  for (const call of nativeCalls.filter(x => x.type === "zig")) {
    const sym = `${symbol(call)}_workaround`;
    if (seen.has(sym)) continue;
    seen.add(sym);
    const id = methodId(sym);
    traitDecls.push(
      `    fn ${id}(global: &JSGlobalObject) -> JsResult<JSValue> { ` +
        `let _ = global; unimplemented!(${JSON.stringify(`$zig(${path.basename(call.filename)}, ${call.symbol}) not yet ported to Rust`)}) }`,
    );
    thunks.push(
      `#[unsafe(no_mangle)]`,
      `pub unsafe extern "C" fn ${sym}(global: *mut JSGlobalObject) -> JSValue {`,
      `    let global = unsafe { &*global };`,
      `    bun_jsc::host_fn::host_fn_result(global, || <Js2Native as Js2NativeImpl>::${id}(global))`,
      `}`,
      ``,
    );
  }

  for (const x of wrapperCalls.filter(x => x.type === "zig")) {
    const sym = symbol({ type: "zig", symbol: x.symbol_target, filename: x.filename });
    if (seen.has(sym)) continue;
    seen.add(sym);
    const id = methodId(sym);
    traitDecls.push(
      `    fn ${id}(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> { ` +
        `let _ = (global, callframe); unimplemented!(${JSON.stringify(`$zig(${path.basename(x.filename)}, ${x.symbol_target}) not yet ported to Rust`)}) }`,
    );
    thunks.push(
      `#[unsafe(no_mangle)]`,
      `pub unsafe extern "C" fn ${sym}(global: *mut JSGlobalObject, callframe: *mut CallFrame) -> JSValue {`,
      `    let global = unsafe { &*global };`,
      `    let callframe = unsafe { &*callframe };`,
      `    bun_jsc::host_fn::host_fn_result(global, || <Js2Native as Js2NativeImpl>::${id}(global, callframe))`,
      `}`,
      ``,
    );
  }

  return [
    `// Auto-generated by src/codegen/generate-js2native.ts — DO NOT EDIT.`,
    `//`,
    `// \`#[unsafe(no_mangle)] extern "C"\` thunks satisfying the JS2Zig__* externs`,
    `// declared by GeneratedJS2Native.h (the JS-module → native dispatch table).`,
    `// Each thunk dispatches through \`Js2NativeImpl\`; porting a $zig() call site`,
    `// means overriding the matching trait method on \`Js2Native\`.`,
    `//`,
    `// Calling convention: \`jsc.conv\` is plain \`extern "C"\` on every target except`,
    `// Windows-x64 (\`extern "sysv64"\`); see generated_classes.rs for the same note.`,
    ``,
    `use bun_jsc::{self, host_fn, CallFrame, JSGlobalObject, JSValue, JsError, JsResult};`,
    ``,
    `/// Zero-sized dispatch target for the JS2Native trait. Override methods via`,
    `/// \`impl Js2NativeImpl for Js2Native { fn …() { real_impl() } }\` in the`,
    `/// owning module (or leave the default to panic until ported).`,
    `pub struct Js2Native;`,
    ``,
    `#[allow(non_snake_case, unused_variables)]`,
    `pub trait Js2NativeImpl {`,
    ...traitDecls,
    `}`,
    `impl Js2NativeImpl for Js2Native {}`,
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
