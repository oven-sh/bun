/** This file is used when a .wasm file is ran.
 *  The transpiled contents of `./node/wasi.js` is pasted into the top of this file.
 */
import { WASI } from "node:wasi";

const filePath = process.argv.at(1);
if (!filePath) {
  var err = new Error("To run a wasm file with Bun, the first argument must be a path to a .wasm file");
  err.name = "WasmFileNotFound";
  throw err;
}

// The module specifier is the resolved path to the wasm file

var {
  WASM_CWD = process.cwd(),
  WASM_ROOT_DIR = "/",
  WASM_ENV_STR = undefined,
  WASM_USE_ASYNC_INIT = "1",
} = process.env;

var env = process.env;
if (WASM_ENV_STR?.length) {
  env = JSON.parse(WASM_ENV_STR);
}

// On OHOS the app sandbox denies open("/") (EACCES), which makes the WASI
// constructor throw before the guest starts. Skip the default "/" preopen
// when the host root is not openable (an explicit WASM_ROOT_DIR is still
// honored verbatim — if the caller chose it, they see the error).
const preopens = { ".": WASM_CWD || process.cwd() };
if (process.env.WASM_ROOT_DIR !== undefined) {
  preopens["/"] = WASM_ROOT_DIR;
} else {
  const fs = import.meta.require("fs");
  try {
    fs.closeSync(fs.openSync("/", "r"));
    preopens["/"] = "/";
  } catch (e) {
    // EISDIR still means the root is openable; only genuine denial
    // (OHOS sandbox EACCES) drops the preopen.
    if (e?.code === "EISDIR") preopens["/"] = "/";
  }
}

const wasi = new WASI({
  args: process.argv.slice(1),
  env,
  preopens,
});

let source = globalThis.wasmSourceBytes;
if (!source) {
  const fs = import.meta.require("fs");
  const file = import.meta.path;
  source = fs.readFileSync(file);
}

const wasm = await WebAssembly.compile(source);

const instance = !Number(WASM_USE_ASYNC_INIT)
  ? new WebAssembly.Instance(wasm, wasi.getImports(wasm))
  : await WebAssembly.instantiate(wasm, wasi.getImports(wasm));

wasi.start(instance);

process.reallyExit(0);
