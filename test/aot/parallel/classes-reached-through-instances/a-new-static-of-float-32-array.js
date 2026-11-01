const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Float32Array(1)).constructor.extra = 41;
function read() {
  return Float32Array.extra;
}
console.log(read());
