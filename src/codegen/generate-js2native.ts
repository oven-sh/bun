// This file implements the global state for the $cpp and $bindgen preprocessor macros
// as well as all the code they generate.
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
  wrap_kind: "new-function";
  symbol_target: string;
  symbol_generated: string;
  display_name: string;
  call_length: number;
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
      wrap_kind: "new-function",
      symbol_target: symbol,
      symbol_generated: "js2native_wrap_" + symbol.replace(/[^A-Za-z]/g, "_"),
      display_name: callBaseName(symbol),
      call_length: create_fn_len,
    });
  }
  return id;
}

export function getJS2NativeCPP() {
  const files = [
    ...new Set(nativeCalls.filter(x => x.filename.endsWith(".cpp")).map(x => x.filename.replace(/.cpp$/, ".h"))),
  ];

  const wrapperCallStrings = wrapperCalls.map(x => {
    if (x.wrap_kind === "new-function") {
      return [
        `static JSC::JSValue ${x.symbol_generated}(Zig::GlobalObject* globalObject) {`,
        `  return js2nativeNewFunction(globalObject, ${x.call_length}, ${JSON.stringify(x.display_name)}_s, ${x.symbol_target});`,
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
    `static NEVER_INLINE JSC::JSValue js2nativeNewFunction(Zig::GlobalObject* globalObject, unsigned length, ASCIILiteral name, JSC::NativeFunction function) {`,
    `  return JSC::JSFunction::create(globalObject->vm(), globalObject, length, name, function, JSC::ImplementationVisibility::Public);`,
    `}` + "\n",
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
            : `${x.symbol}(global)`
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
