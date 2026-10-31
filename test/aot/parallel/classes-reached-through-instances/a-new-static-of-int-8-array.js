const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Int8Array(1)).constructor.extra = 41;
function read() {
  return Int8Array.extra;
}
console.log(read());
