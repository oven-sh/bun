// This file implements the global state for the $cpp and $bindgen preprocessor macros
// as well as all the code they generate.
//
// For the actual parsing, see replacements.ts

import path, { basename, sep } from "path";
import { textOfNativeBinding, type Guard, type Guards } from "./builtins/guards";
import type { NativeCallKind } from "./builtins/vocabulary";
import { readdirRecursiveWithExclusionsAndExtensionsSync } from "./helpers";
import { guardedBindingCreation, recordedPointer, removableFeatures } from "./removable-entry-points";

//
interface NativeCall {
  id: number;
  type: NativeCallType;
  filename: string;
  symbol: string;
  is_wrapped: boolean;
  written_kind: NativeCallKind;
  written_file: string;
  written_symbol: string;
}

interface WrapperCall {
  wrap_kind: "new-function";
  symbol_target: string;
  symbol_generated: string;
  display_name: string;
  is_hidden_in_stack_traces: boolean;
  call_length: number;
  filename: string;
  written_kind: NativeCallKind;
  written_file: string;
  written_symbol: string;
}

type NativeCallType = "cpp" | "bind";

const nativeCalls: NativeCall[] = [];
const wrapperCalls: WrapperCall[] = [];

const srcDir = path.join(import.meta.dir, "../");

const sourceFiles = readdirRecursiveWithExclusionsAndExtensionsSync(
  srcDir,
  ["deps", "node_modules", "WebKit"],
  [".cpp", ".bind.ts"],
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
    const fnName = call_type === "bind" ? "bindgen" : call_type;
    throw new Error(`Could not find file ${filename} in $${fnName} call`);
  }

  return filename;
}

function nativeCallKind(call_type: NativeCallType, is_wrapped: boolean): NativeCallKind {
  switch (call_type) {
    case "bind":
      return "Bindgen";
    case "cpp":
      return is_wrapped ? "NewCppFunction" : "Cpp";
  }
}

export function registerNativeCall(
  call_type: NativeCallType,
  filename: string,
  symbol: string,
  create_fn_len: null | number,
  is_hidden_in_stack_traces = false,
) {
  const resolved_filename = resolveNativeFileId(call_type, filename);
  const written_kind = nativeCallKind(call_type, create_fn_len != null);

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
    written_kind,
    written_file: filename,
    written_symbol: symbol,
  });
  if (create_fn_len != null) {
    wrapperCalls.push({
      wrap_kind: "new-function",
      symbol_target: symbol,
      symbol_generated: "js2native_wrap_" + symbol.replace(/[^A-Za-z]/g, "_"),
      display_name: callBaseName(symbol),
      is_hidden_in_stack_traces,
      call_length: create_fn_len,
      filename: resolved_filename,
      written_kind,
      written_file: filename,
      written_symbol: symbol,
    });
  }
  return id;
}

export interface NativeCallRecord {
  id: number;
  type: "cpp" | "bind";
  file: string;
  symbol: string;
  isWrapped: boolean;
}

export function nativeCallList(): NativeCallRecord[] {
  return nativeCalls.map(call => ({
    id: call.id,
    type: call.type,
    file: (path.isAbsolute(call.filename) ? path.relative(srcDir, call.filename) : call.filename).replaceAll(sep, "/"),
    symbol: call.symbol,
    isWrapped: call.is_wrapped,
  }));
}

export interface CreatedFunctionRecord {
  kind: NativeCallKind;
  file: string;
  symbol: string;
  /** The native code of the function, as GeneratedJS2Native.h names it. */
  hostFunction: string;
  /** Declares it. */
  header: string;
  length: number;
}

export function createdFunctionList(): CreatedFunctionRecord[] {
  return wrapperCalls.map(call => ({
    kind: call.written_kind,
    file: call.written_file,
    symbol: call.written_symbol,
    hostFunction: call.symbol_target,
    header: call.filename.replace(/.cpp$/, ".h").replaceAll(sep, "/"),
    length: call.call_length,
  }));
}

export function nativeCallListStamp(): string {
  const lines = nativeCallList()
    .map(call => `${call.id} ${call.type} ${call.file} ${call.symbol} ${call.isWrapped}\n`)
    .join("");
  let hash = 2166136261;
  for (const byte of Buffer.from(lines)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function bindgenSymbol(call: Pick<NativeCall, "filename" | "symbol">) {
  return `js2native_bindgen_${basename(call.filename.replace(/\.bind\.ts$/, ""))}_${call.symbol}`;
}

function nativePointer(guard: Guard | null, native_symbol: string) {
  return guard
    ? recordedPointer(removableFeatures(), guard.feature, "Throw", native_symbol, guard.builtin)
    : native_symbol;
}

function callNative(guard: Guard | null, native_symbol: string) {
  if (!guard) return `${native_symbol}(global)`;
  return guardedBindingCreation(removableFeatures(), guard.feature, native_symbol, guard.builtin, ["global"]);
}

function nativeCallExpression(call: NativeCall, guard: Guard | null) {
  if (call.type === "bind") return `JSC::JSValue::decode(${callNative(guard, bindgenSymbol(call))})`;
  if (!guard || call.is_wrapped) return `${call.symbol}(global)`;
  return callNative(guard, call.symbol);
}

export function getJS2NativeCPP(guards: Guards) {
  const guardOf = (call: Pick<NativeCall, "written_kind" | "written_file" | "written_symbol">) =>
    guards.ofPath(textOfNativeBinding(call.written_kind, call.written_file, call.written_symbol));

  const files = [
    ...new Set(nativeCalls.filter(x => x.filename.endsWith(".cpp")).map(x => x.filename.replace(/.cpp$/, ".h"))),
  ];

  const wrapperCallStrings = wrapperCalls.map(x => {
    if (x.wrap_kind === "new-function") {
      return [
        `static JSC::JSValue ${x.symbol_generated}(Zig::GlobalObject* globalObject) {`,
        `  return js2nativeNewFunction(globalObject, ${x.call_length}, ${JSON.stringify(x.display_name)}_s, ${nativePointer(guardOf(x), x.symbol_target)}, JSC::ImplementationVisibility::${x.is_hidden_in_stack_traces ? "Private" : "Public"});`,
        `}`,
      ].join("\n");
    }
    throw new Error(`Unknown wrap kind ${x.wrap_kind}`);
  });

  return [
    `#pragma once`,
    `#include "root.h"`,
    ...files.map(filename => `#include ${JSON.stringify(filename)}`),
    "\n" + "namespace JS2NativeGenerated {",
    "using namespace Bun;",
    "using namespace JSC;",
    "using namespace WebCore;" + "\n",
    // One out-of-line JSFunction::create for all the `new-function` wrappers below.
    `static NEVER_INLINE JSC::JSValue js2nativeNewFunction(Zig::GlobalObject* globalObject, unsigned length, ASCIILiteral name, JSC::NativeFunction function, JSC::ImplementationVisibility visibility) {`,
    `  return JSC::JSFunction::create(globalObject->vm(), globalObject, length, name, function, visibility);`,
    `}` + "\n",
    ...wrapperCallStrings,
    ...nativeCalls
      .filter(x => x.type === "bind")
      .map(x => `extern "C" SYSV_ABI JSC::EncodedJSValue ${bindgenSymbol(x)}(Zig::GlobalObject*);`),
    `typedef JSC::JSValue (*JS2NativeFunction)(Zig::GlobalObject*);`,
    `static ALWAYS_INLINE JSC::JSValue callJS2Native(int32_t index, Zig::GlobalObject* global) {`,
    ` switch(index) {`,
    ...nativeCalls.map(x => `    case ${x.id}: return ${nativeCallExpression(x, guardOf(x))};`),
    `    default:`,
    `      __builtin_unreachable();`,
    `  }`,
    `}`,
    `#define JS2NATIVE_COUNT ${nativeCalls.length}`,
    "}",
    `extern "C" const uint8_t Bun__js2nativeList_${nativeCallListStamp()} = 0;`,
  ].join("\n");
}

export function getJS2NativeDTS() {
  return [
    "declare type NativeBasenameCPP = " +
      sourceFiles
        .filter(x => x.endsWith("cpp"))
        .map(x => JSON.stringify(basename(x)))
        .join("|"),
    // resolveNativeFileId matches any path suffix of a source file, e.g. "streams/BunStreamConsumers.cpp".
    "declare type NativeFilenameCPP = NativeBasenameCPP | `${string}/${NativeBasenameCPP}`",
    "",
  ].join("\n");
}
