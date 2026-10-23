// BUN_JSC_useWasm=0 takes what the global WebAssembly holds away. The types of the program still name its classes, and code tests values against them.
const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
function load(): WebAssembly.Module | undefined {
  return typeof WebAssembly !== "undefined" ? new WebAssembly.Module(bytes) : undefined;
}
function isModule(value: unknown): value is WebAssembly.Module {
  return typeof WebAssembly === "object" && value instanceof WebAssembly.Module;
}
function exportsOf(module: WebAssembly.Module | undefined): number {
  return module === undefined ? -1 : WebAssembly.Module.exports(module).length;
}
let line = "";
for (let round = 0; round < 50; round++) line = exportsOf(load()) + " " + isModule(load()) + " " + isModule({});
console.log(line);
