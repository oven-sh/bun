const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new ArrayBuffer(1)).constructor.extra = 41;
function read() {
  return ArrayBuffer.extra;
}
console.log(read());
