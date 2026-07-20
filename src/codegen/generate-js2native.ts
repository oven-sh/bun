// This file implements the global state for $rust and $cpp preprocessor macros
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

type NativeCallType = "rust" | "cpp" | "bind";

const nativeCalls: NativeCall[] = [];
const wrapperCalls: WrapperCall[] = [];

const srcDir = path.join(import.meta.dir, "../");

const sourceFiles = readdirRecursiveWithExclusionsAndExtensionsSync(
  srcDir,
  ["deps", "node_modules", "WebKit"],
  [".cpp", ".bind.ts"],
);

// The $rust() macro's first argument is an identifier naming the module a
// native symbol belongs to. The file itself is never opened, but its path
// under src/ drives both the exported C symbol name (normalizeSymbolPathPrefix)
// and the Rust crate path (rustTarget). Adding a new $rust() call site
// requires adding its entry below.
const rustIdentifierPaths: Record<string, string> = {
  "bun.rs": "bun.rs",
  "Counters.rs": "jsc/Counters.rs",
  "FrameworkRouter.rs": "runtime/bake/FrameworkRouter.rs",
  "Listener.rs": "runtime/socket/Listener.rs",
  "MarkdownObject.rs": "runtime/api/MarkdownObject.rs",
  "SecureContext.rs": "runtime/api/bun/SecureContext.rs",
  "Stat.rs": "runtime/node/Stat.rs",
  "UnsafeObject.rs": "runtime/api/UnsafeObject.rs",
  "bindgen_test.rs": "jsc/bindgen_test.rs",
  "collections/linear_fifo.rs": "collections/linear_fifo.rs",
  "crash_handler.rs": "crash_handler/crash_handler.rs",
  "css_internals.rs": "css_jsc/css_internals.rs",
  "dependency.rs": "install/dependency.rs",
  "escapeRegExp.rs": "string/escapeRegExp.rs",
  "event_loop.rs": "jsc/event_loop.rs",
  "ffi.rs": "runtime/ffi/ffi.rs",
  "h2_frame_parser.rs": "runtime/api/bun/h2_frame_parser.rs",
  "hosted_git_info.rs": "install/hosted_git_info.rs",
  "http/H2Client.rs": "http/H2Client.rs",
  "http/H3Client.rs": "http/H3Client.rs",
  "ini.rs": "ini/ini.rs",
  "install_binding.rs": "install_jsc/install_binding.rs",
  "ipc.rs": "jsc/ipc.rs",
  "jest.rs": "runtime/test_runner/jest.rs",
  "mysql.rs": "sql_jsc/mysql.rs",
  "napi_body.rs": "runtime/napi/napi_body.rs",
  "node_assert_binding.rs": "runtime/node/node_assert_binding.rs",
  "node_cluster_binding.rs": "runtime/node/node_cluster_binding.rs",
  "node_crypto_binding.rs": "runtime/node/node_crypto_binding.rs",
  "node_fs_binding.rs": "runtime/node/node_fs_binding.rs",
  "node_http_binding.rs": "runtime/node/node_http_binding.rs",
  "node_net_binding.rs": "runtime/node/node_net_binding.rs",
  "node_os.rs": "runtime/node/node_os.rs",
  "node_util_binding.rs": "runtime/node/node_util_binding.rs",
  "node_zlib_binding.rs": "runtime/node/node_zlib_binding.rs",
  "npm.rs": "install/npm.rs",
  "pack_command.rs": "runtime/cli/pack_command.rs",
  "parse_args.rs": "runtime/node/util/parse_args.rs",
  "patch.rs": "patch/patch.rs",
  "postgres.rs": "sql_jsc/postgres.rs",
  "runtime/dns_jsc/dns.rs": "runtime/dns_jsc/dns.rs",
  "runtime/node/types.rs": "runtime/node/types.rs",
  "runtime/socket/socket.rs": "runtime/socket/socket.rs",
  "runtime/timer/Timer.rs": "runtime/timer/Timer.rs",
  "runtime/webcore/FileSink.rs": "runtime/webcore/FileSink.rs",
  "shell.rs": "runtime/shell/shell.rs",
  "sourcemap/InternalSourceMap.rs": "sourcemap/InternalSourceMap.rs",
  "string/immutable/unicode.rs": "bun_core/string/immutable/unicode.rs",
  "subprocess.rs": "runtime/api/bun/subprocess.rs",
  "sys.rs": "sys/sys.rs",
  "sys/Error.rs": "sys/Error.rs",
  "udp_socket.rs": "runtime/socket/udp_socket.rs",
  "upgrade_command.rs": "runtime/cli/upgrade_command.rs",
  "virtual_machine_exports.rs": "jsc/virtual_machine_exports.rs",
};

function callBaseName(x: string) {
  return x.split(/[^A-Za-z0-9]/g).pop()!;
}

function resolveNativeFileId(call_type: NativeCallType, filename: string) {
  const ext = call_type === "bind" ? ".bind.ts" : call_type === "rust" ? ".rs" : `.${call_type}`;
  if (!filename.endsWith(ext)) {
    throw new Error(`Expected filename for $${call_type} to have ${ext} extension, got ${JSON.stringify(filename)}`);
  }

  if (call_type === "rust") {
    const relative = rustIdentifierPaths[filename];
    if (!relative) {
      throw new Error(
        `Unknown $rust() file identifier ${JSON.stringify(filename)}. Add it to rustIdentifierPaths in src/codegen/generate-js2native.ts.`,
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
  return call.type === "rust"
    ? `JS2Rust__${call.filename ? normalizeSymbolPathPrefix(call.filename) + "_" : ""}${call.symbol.replace(/[^A-Za-z]/g, "_")}`
    : call.symbol;
}

function normalizeSymbolPathPrefix(input: string) {
  input = path.resolve(input);

  const bunDir = path.resolve(path.join(import.meta.dir, "..", ".."));
  if (input.startsWith(bunDir)) {
    input = input.slice(bunDir.length);
  }

  return input.replaceAll(".rs", "_rs_").replace(/[^A-Za-z]/g, "_");
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
    .filter(x => x.type === "rust")
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
        (x.type === "rust" &&
          externs.push(
            `BUN_DECLARE_HOST_FUNCTION(${symbol({
              type: "rust",
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

// Rust emitter.
//
// Emits, for every $rust() call site, a `#[unsafe(no_mangle)] extern "C"`
// thunk whose unmangled name and signature is byte-identical to the extern
// the C++ side declares in GeneratedJS2Native.h. The C++ output is invariant;
// only the implementer of the symbol changes.
//
// Two ABI shapes:
//   • nativeCalls (type "rust")  → `${sym}_workaround(global) -> JSValue`
//   • wrapperCalls (type "rust") → `${sym}(global, callframe) -> JSValue`
//
// Each thunk calls the Rust function directly at
// `crate::<derived-from-path>::<snake_case(symbol)>` — no trait, no runtime
// panic fallback. A missing function is a compile error.
export function getJS2NativeRust() {
  // Symbols already hand-exported in src/ (via `export_host_fn!` or
  // `#[unsafe(export_name = "JS2Rust__…")]`) — skip emitting a thunk for these
  // so the linker doesn't see two definitions.
  const handExported = new Set<string>([
    "JS2Rust___src_runtime_dns_jsc_dns_rs__Resolver_getRuntimeDefaultResultOrderOption",
    "JS2Rust___src_runtime_dns_jsc_dns_rs__Resolver_newResolver",
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
  // `src/ini/ini.rs` + `IniTestingAPIs.parse` (outside bun_runtime)
  //   → `crate::dispatch::js2native::ini_ini_testing_apis_parse` (single
  //   landing pad; still a compile error if missing).
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

  for (const call of nativeCalls.filter(x => x.type === "rust")) {
    const sym = `${symbol(call)}_workaround`;
    if (seen.has(sym)) continue;
    seen.add(sym);
    const target = rustTarget(call.filename, call.symbol);
    thunks.push(
      `// $rust(${path.basename(call.filename)}, ${call.symbol})`,
      `bun_jsc::jsc_host_abi! {`,
      `    #[unsafe(no_mangle)]`,
      `    pub unsafe fn ${sym}(global: &JSGlobalObject) -> JSValue {`,
      `        host_fn::host_fn_lazy(global, |g| ${target}(g))`,
      `    }`,
      `}`,
      ``,
    );
  }

  for (const x of wrapperCalls.filter(x => x.type === "rust")) {
    const sym = symbol({ type: "rust", symbol: x.symbol_target, filename: x.filename });
    if (seen.has(sym)) continue;
    seen.add(sym);
    if (handExported.has(sym)) {
      thunks.push(`// ${sym}: hand-exported in src/ — thunk omitted to avoid duplicate symbol`, ``);
      continue;
    }
    const target = rustTarget(x.filename, x.symbol_target);
    thunks.push(
      `// $rust(${path.basename(x.filename)}, ${x.symbol_target})`,
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
    `// \`#[unsafe(no_mangle)] extern "C"\` thunks satisfying the JS2Rust__* externs`,
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
    "declare type NativeFilenameRust = " +
      Object.keys(rustIdentifierPaths)
        .map(x => JSON.stringify(x))
        .join("|"),
    "",
  ].join("\n");
}
