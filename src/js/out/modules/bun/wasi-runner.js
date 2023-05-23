// src/js/bun/wasi-runner.js
var filePath = process.argv.at(1);
if (!filePath) {
  err = new Error("To run a wasm file with Bun, the first argument must be a path to a .wasm file");
  err.name = "WasmFileNotFound";
  throw err;
}
var err;
var { WASM_CWD = process.cwd(), WASM_ROOT_DIR = "/", WASM_ENV_STR = undefined, WASM_USE_ASYNC_INIT = "" } = process.env;
var env = process.env;
if (WASM_ENV_STR?.length) {
  env = JSON.parse(WASM_ENV_STR);
}
var wasi = new WASI({
  args: process.argv.slice(1),
  env,
  preopens: {
    ".": WASM_CWD || process.cwd(),
    "/": WASM_ROOT_DIR || "/"
  }
});
var source = globalThis.wasmSourceBytes;
if (!source) {
  const fs = Bun.fs();
  const file = import.meta.path;
  source = fs.readFileSync(file);
}
var wasm = new WebAssembly.Module(source);
var instance = !WASM_USE_ASYNC_INIT ? new WebAssembly.Instance(wasm, wasi.getImports(wasm)) : await WebAssembly.instantiate(wasm, wasi.getImports(wasm));
wasi.start(instance);
process.exit(0);

//# debugId=98F3D487204C265164756e2164756e21
