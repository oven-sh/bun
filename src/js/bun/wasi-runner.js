/** This file is used when a .wasm file is ran.
 *  The contents of `../node/wasi.js` is pasted into the top of this file.
 */

const filePath = process.argv.at(1);
if (!filePath) {
  var err = new Error("To run a wasm file with Bun, the first argument must be a path to a .wasm file");
  err.name = "WasmFileNotFound";
  throw err;
}

// The module specifier is the resolved path to the wasm file

var { WASM_CWD = process.cwd(), WASM_ROOT_DIR = "/", WASM_ENV_STR = undefined, WASM_USE_ASYNC_INIT = "" } = process.env;

var env = process.env;
if (WASM_ENV_STR?.length) {
  env = JSON.parse(WASM_ENV_STR);
}

const wasi = new WASI({
  args: process.argv.slice(1),
  env,
  preopens: {
    ".": WASM_CWD || process.cwd(),
    "/": WASM_ROOT_DIR || "/",
  },
});

let source = globalThis.wasmSourceBytes;
if (!source) {
  const fs = Bun.fs();
  const file = import.meta.path;
  source = fs.readFileSync(file);
}

const wasm = new WebAssembly.Module(source);
const instance = !WASM_USE_ASYNC_INIT
  ? new WebAssembly.Instance(wasm, wasi.getImports(wasm))
  : await WebAssembly.instantiate(wasm, wasi.getImports(wasm));
wasi.start(instance);

process.exit(0);
