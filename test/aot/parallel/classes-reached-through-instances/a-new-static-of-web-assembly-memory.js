const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new WebAssembly.Memory({ initial: 1 })).constructor.extra = 41;
function read() {
  return WebAssembly.Memory.extra;
}
console.log(read());
