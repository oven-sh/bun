// This file implements the global state for $zig and $cpp preprocessor macros
// as well as all the code it generates.
//
// For the actual parsing, see replacements.ts

import path from "path";
import { readdirRecursiveWithExclusionsAndExtensionsSync } from "./helpers";

//
interface NativeCall {
  id: number;
  type: NativeCallType;
  filename: string;
  symbol: string;
}

type NativeCallType = "zig" | "cpp";

const nativeCalls: NativeCall[] = [];

const sourceFiles = readdirRecursiveWithExclusionsAndExtensionsSync(
  path.join(import.meta.dir, '../'),
  [
    'deps',
    'node_modules',
    'WebKit',
  ],
  [
    '.cpp',
    '.zig',
  ],
);

function resolveNativeFileId(call_type: NativeCallType, filename: string) {
  if (!filename.endsWith("." + call_type)) {
    throw new Error(`Expected filename for $${call_type} to have .${call_type} extension`);
  }

  const resolved = sourceFiles.find(file => file.endsWith('/' + filename));
  if (!resolved) {
    throw new Error(`Could not find file ${filename} in $${call_type} call`);
  }

  if (call_type === "zig") {
    // TODO: for zig: turn this into a repo-relative filepath and error if it does not exist.
    return resolved;
  }

  return filename;
}

export function registerNativeCall(call_type: NativeCallType, filename: string, symbol: string) {
  const resolved_filename = resolveNativeFileId(call_type, filename);

  const existing = nativeCalls.find(
    call => call.type === call_type && call.filename === resolved_filename && call.symbol === symbol,
  );
  if (existing) {
    return existing.id;
  }

  const id = -nativeCalls.length - 1;
  nativeCalls.push({
    id,
    type: call_type,
    filename: resolved_filename,
    symbol,
  });
  return id;
}

function symbol(call: NativeCall) {
  return call.type === "zig" ? `JS2Zig__${call.symbol.replace(/[^A-Za-z]/g, "_")}` : call.symbol;
}

function cppPointer(call: NativeCall) {
  return call.type === "zig" ? `reinterpret_cast<JS2NativeFunction>(&${symbol(call)})` : `&${symbol(call)}`;
}

export function getJS2NativeCPP() {
  const files = [...new Set(nativeCalls.filter(x => x.type === 'cpp').map(x => x.filename))];

  return [
    `#pragma once`,
    ...files
      .map(filename => `#include ${JSON.stringify(filename.replace(/.cpp$/, '.h'))}`),
    ...nativeCalls
      .filter(x => x.type === 'zig')
      .map(call => `extern "C" JSC::EncodedJSValue ${symbol(call)}(Zig::GlobalObject*);`),
    "typedef JSC::JSValue (*JS2NativeFunction)(Zig::GlobalObject*);",
    "static JS2NativeFunction js2nativePointers[] = {",
    ...nativeCalls.map(x => `  ${cppPointer(x)},`),
    "};",
    "#define JS2NATIVE_COUNT " + nativeCalls.length,
  ].join("\n");
}

export function getJS2NativeZig(gs2NativeZigPath: string) {
  return [
    `const JSC = @import("root").bun.JSC;`,
    // `const JSC = bun.JSC;`,
    ...nativeCalls
      .filter(x => x.type === 'zig')
      .flatMap(call => [
        `export fn ${symbol(call)}(global: *JSC.JSGlobalObject) JSC.JSValue {`,
        `  return @import(${JSON.stringify(path.relative(path.dirname(gs2NativeZigPath), call.filename))}).${call.symbol}(global);`,
        '}',
      ]),
    'comptime {',
    ...nativeCalls
      .filter(x => x.type === 'zig')
      .flatMap(call => `  _ = &${symbol(call)};`),
    '}',
  ].join("\n");
}
