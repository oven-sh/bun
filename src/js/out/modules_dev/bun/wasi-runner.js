var filePath = process.argv.at(1);
if (!filePath)
  throw err = new Error("To run a wasm file with Bun, the first argument must be a path to a .wasm file"), err.name = "WasmFileNotFound", err;
var err, { WASM_CWD = process.cwd(), WASM_ROOT_DIR = "/", WASM_ENV_STR = void 0, WASM_USE_ASYNC_INIT = "" } = process.env, env = process.env;
if (WASM_ENV_STR?.length)
  env = JSON.parse(WASM_ENV_STR);
var wasi = new WASI({
  args: process.argv.slice(1),
  env,
  preopens: {
    ".": WASM_CWD || process.cwd(),
    "/": WASM_ROOT_DIR || "/"
  }
}), source = globalThis.wasmSourceBytes;
if (!source) {
  const fs = Bun.fs(), file = import.meta.path;
  source = fs.readFileSync(file);
}
var wasm = new WebAssembly.Module(source), instance = !WASM_USE_ASYNC_INIT ? new WebAssembly.Instance(wasm, wasi.getImports(wasm)) : await WebAssembly.instantiate(wasm, wasi.getImports(wasm));
wasi.start(instance);
process.exit(0);

//# debugId=1CDBF0C35B4CD94A64756e2164756e21
