const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).constructor.extra = 41;
function read() {
  return WebAssembly.Module.extra;
}
console.log(read());
