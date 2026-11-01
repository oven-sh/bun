const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Uint16Array(1)).constructor.extra = 41;
function read() {
  return Uint16Array.extra;
}
console.log(read());
