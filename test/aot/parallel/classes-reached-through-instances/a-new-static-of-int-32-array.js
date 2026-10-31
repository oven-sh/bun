const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Int32Array(1)).constructor.extra = 41;
function read() {
  return Int32Array.extra;
}
console.log(read());
