const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Uint8Array(1)).constructor.extra = 41;
function read() {
  return Uint8Array.extra;
}
console.log(read());
