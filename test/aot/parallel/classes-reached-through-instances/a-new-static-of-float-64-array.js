const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Float64Array(1)).constructor.extra = 41;
function read() {
  return Float64Array.extra;
}
console.log(read());
