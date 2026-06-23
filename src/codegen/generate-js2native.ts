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

const srcDir = path.join(import.meta.dir, "../");

const sourceFiles = readdirRecursiveWithExclusionsAndExtensionsSync(
  srcDir,
  ["deps", "node_modules", "WebKit"],
  [".cpp", ".bind.ts"],
);

// The $zig() macro's first argument is a legacy identifier naming the module
// a native symbol belongs to. The file itself is never opened, but its path
// under src/ drives both the exported C symbol name (normalizeSymbolPathPrefix)
// and the Rust crate path (rustTarget). The .zig reference sources no longer
// exist on disk, so the path each identifier resolved to is recorded here.
// Adding a new $zig() call site requires adding its entry below.
const zigIdentifierPaths: Record<string, string> = {
  "bun.zig": "bun.zig",
  "Counters.zig": "jsc/Counters.zig",
  "FrameworkRouter.zig": "runtime/bake/FrameworkRouter.zig",
  "Listener.zig": "runtime/socket/Listener.zig",
  "SecureContext.zig": "runtime/api/bun/SecureContext.zig",
  "Stat.zig": "runtime/node/Stat.zig",
  "bindgen_test.zig": "jsc/bindgen_test.zig",
  "collections/linear_fifo.zig": "collections/linear_fifo.zig",
  "crash_handler.zig": "crash_handler/crash_handler.zig",
  "css_internals.zig": "css_jsc/css_internals.zig",
  "dependency.zig": "install/dependency.zig",
  "escapeRegExp.zig": "string/escapeRegExp.zig",
  "event_loop.zig": "jsc/event_loop.zig",
  "ffi.zig": "runtime/ffi/ffi.zig",
  "h2_frame_parser.zig": "runtime/api/bun/h2_frame_parser.zig",
  "hosted_git_info.zig": "install/hosted_git_info.zig",
  "http/H2Client.zig": "http/H2Client.zig",
  "http/H3Client.zig": "http/H3Client.zig",
  "ini.zig": "ini/ini.zig",
  "install_binding.zig": "install_jsc/install_binding.zig",
  "ipc.zig": "jsc/ipc.zig",
  "mysql.zig": "sql_jsc/mysql.zig",
  "node_assert_binding.zig": "runtime/node/node_assert_binding.zig",
  "node_cluster_binding.zig": "runtime/node/node_cluster_binding.zig",
  "node_crypto_binding.zig": "runtime/node/node_crypto_binding.zig",
  "node_fs_binding.zig": "runtime/node/node_fs_binding.zig",
  "node_http_binding.zig": "runtime/node/node_http_binding.zig",
  "node_net_binding.zig": "runtime/node/node_net_binding.zig",
  "node_os.zig": "runtime/node/node_os.zig",
  "node_util_binding.zig": "runtime/node/node_util_binding.zig",
  "node_zlib_binding.zig": "runtime/node/node_zlib_binding.zig",
  "npm.zig": "install/npm.zig",
  "pack_command.zig": "runtime/cli/pack_command.zig",
  "parse_args.zig": "runtime/node/util/parse_args.zig",
  "patch.zig": "patch/patch.zig",
  "postgres.zig": "sql_jsc/postgres.zig",
  "runtime/dns_jsc/dns.zig": "runtime/dns_jsc/dns.zig",
  "runtime/node/types.zig": "runtime/node/types.zig",
  "runtime/socket/socket.zig": "runtime/socket/socket.zig",
  "runtime/timer/Timer.zig": "runtime/timer/Timer.zig",
  "runtime/webcore/FileSink.zig": "runtime/webcore/FileSink.zig",
  "shell.zig": "runtime/shell/shell.zig",
  "sourcemap/InternalSourceMap.zig": "sourcemap/InternalSourceMap.zig",
  "string/immutable/unicode.zig": "bun_core/string/immutable/unicode.zig",
  "subprocess.zig": "runtime/api/bun/subprocess.zig",
  "sys.zig": "sys/sys.zig",
  "sys/Error.zig": "sys/Error.zig",
  "udp_socket.zig": "runtime/socket/udp_socket.zig",
  "upgrade_command.zig": "runtime/cli/upgrade_command.zig",
  "virtual_machine_exports.zig": "jsc/virtual_machine_exports.zig",
};

function callBaseName(x: string) {
  return x.split(/[^A-Za-z0-9]/g).pop()!;
}

function resolveNativeFileId(call_type: NativeCallType, filename: string) {
  const ext = call_type === "bind" ? ".bind.ts" : `.${call_type}`;
  if (!filename.endsWith(ext)) {
    throw new Error(`Expected filename for $${call_type} to have ${ext} extension, got ${JSON.stringify(filename)}`);
  }

  if (call_type === "zig") {
    const relative = zigIdentifierPaths[filename];
    if (!relative) {
      throw new Error(
        `Unknown $zig() file identifier ${JSON.stringify(filename)}. Add it to zigIdentifierPaths in src/codegen/generate-js2native.ts.`,
      );
    }
    return path.join(srcDir, relative.replaceAll("/", sep));
  }

  filename = filename.replaceAll("/", sep);

  const resolved = sourceFiles.find(file => file.endsWith(sep + filename));
  if (!resolved) {
    const fnName = call_type === "bind" ? "bindgenFn" : call_type;
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
// Two ABI shapes:
//   • nativeCalls (type "zig")  → `${sym}_workaround(global) -> JSValue`
//   • wrapperCalls (type "zig") → `${sym}(global, callframe) -> JSValue`
//
// Each thunk calls the hand-ported Rust function directly at
// `crate::<derived-from-zig-path>::<snake_case(symbol)>` — no trait, no
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
    const rel = path.relative(srcRoot, filename).replace(/\.zig$/, "");
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

  for (const call of nativeCalls.filter(x => x.type === "zig")) {
    const sym = `${symbol(call)}_workaround`;
    if (seen.has(sym)) continue;
    seen.add(sym);
    const target = rustTarget(call.filename, call.symbol);
    thunks.push(
      `// $zig(${path.basename(call.filename)}, ${call.symbol})`,
      `bun_jsc::jsc_host_abi! {`,
      `    #[unsafe(no_mangle)]`,
      `    pub unsafe fn ${sym}(global: &JSGlobalObject) -> JSValue {`,
      `        host_fn::host_fn_lazy(global, |g| ${target}(g))`,
      `    }`,
      `}`,
      ``,
    );
  }

  for (const x of wrapperCalls.filter(x => x.type === "zig")) {
    const sym = symbol({ type: "zig", symbol: x.symbol_target, filename: x.filename });
    if (seen.has(sym)) continue;
    seen.add(sym);
    if (handExported.has(sym)) {
      thunks.push(`// ${sym}: hand-exported in src/ — thunk omitted to avoid duplicate symbol`, ``);
      continue;
    }
    const target = rustTarget(x.filename, x.symbol_target);
    thunks.push(
      `// $zig(${path.basename(x.filename)}, ${x.symbol_target})`,
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
      Object.keys(zigIdentifierPaths)
        .map(x => JSON.stringify(x))
        .join("|"),
    "",
  ].join("\n");
}
