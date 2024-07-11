// This file implements the global state for $zig and $cpp preprocessor macros
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
  symbol_taget: string;
  symbol_generated: string;
  display_name: string;
  call_length: number;
  filename: string;
}

type NativeCallType = "zig" | "cpp";

const nativeCalls: NativeCall[] = [];
const wrapperCalls: WrapperCall[] = [];

const sourceFiles = readdirRecursiveWithExclusionsAndExtensionsSync(
  path.join(import.meta.dir, "../"),
  ["deps", "node_modules", "WebKit"],
  [".cpp", ".zig"],
);

function callBaseName(x: string) {
  return x.split(/[^A-Za-z0-9]/g).pop()!;
}

function resolveNativeFileId(call_type: NativeCallType, filename: string) {
  if (!filename.endsWith("." + call_type)) {
    throw new Error(
      `Expected filename for $${call_type} to have .${call_type} extension, got ${JSON.stringify(filename)}`,
    );
  }

  const resolved = sourceFiles.find(file => file.endsWith(sep + filename));
  if (!resolved) {
    throw new Error(`Could not find file ${filename} in $${call_type} call`);
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
      symbol_taget: symbol,
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
          `JSC::JSValue ${symbol(call)}(Zig::GlobalObject* global) {`,
          `  return JSValue::decode(${symbol(call)}_workaround(global));`,
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
              symbol: x.symbol_taget,
            })});`,
          ),
        "") || "",
        `JSC::JSValue ${x.symbol_generated}(Zig::GlobalObject* globalObject) {`,
        `  return JSC::JSFunction::create(globalObject->vm(), globalObject, ${x.call_length}, ${JSON.stringify(
          x.display_name,
        )}_s, ${symbol({ type: x.type, symbol: x.symbol_taget })}, JSC::ImplementationVisibility::Public);`,
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
    `typedef JSC::JSValue (*JS2NativeFunction)(Zig::GlobalObject*);`,
    `static JS2NativeFunction js2nativePointers[] = {`,
    ...nativeCalls.map(x => `  ${cppPointer(x)},`),
    `};`,
    `};`,
    `#define JS2NATIVE_COUNT ${nativeCalls.length}`,
  ].join("\n");
}

export function getJS2NativeZig(gs2NativeZigPath: string) {
  return [
    "//! This file is generated by src/codegen/generate-js2native.ts based on seen calls to the $zig() JS macro",
    `const JSC = @import("root").bun.JSC;`,
    ...nativeCalls
      .filter(x => x.type === "zig")
      .flatMap(call => [
        `export fn ${symbol(call)}_workaround(global: *JSC.JSGlobalObject) callconv(JSC.conv) JSC.JSValue {`,
        `  return @import(${JSON.stringify(path.relative(path.dirname(gs2NativeZigPath), call.filename))}).${
          call.symbol
        }(global);`,
        "}",
      ]),
    ...wrapperCalls
      .filter(x => x.type === "zig")
      .flatMap(x => [
        `export fn ${symbol({
          type: "zig",
          symbol: x.symbol_taget,
        })}(global: *JSC.JSGlobalObject, call_frame: *JSC.CallFrame) callconv(JSC.conv) JSC.JSValue {`,
        `
          const function = @import(${JSON.stringify(path.relative(path.dirname(gs2NativeZigPath), x.filename))});
          return @call(.always_inline, function.${x.symbol_taget}, .{global, call_frame});`,
        "}",
      ]),
    "comptime {",
    ...nativeCalls.filter(x => x.type === "zig").flatMap(call => `  _ = &${symbol(call)}_workaround;`),
    ...wrapperCalls
      .filter(x => x.type === "zig")
      .flatMap(x => `  _ = &${symbol({ type: "zig", symbol: x.symbol_taget })};`),
    "}",
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
