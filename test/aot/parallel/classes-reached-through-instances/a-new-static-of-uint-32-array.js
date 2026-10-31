const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Uint32Array(1)).constructor.extra = 41;
function read() {
  return Uint32Array.extra;
}
console.log(read());
