const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Float16Array(1)).constructor.extra = 41;
function read() {
  return Float16Array.extra;
}
console.log(read());
