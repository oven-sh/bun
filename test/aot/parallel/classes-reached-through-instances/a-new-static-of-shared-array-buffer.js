const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new SharedArrayBuffer(1)).constructor.extra = 41;
function read() {
  return SharedArrayBuffer.extra;
}
console.log(read());
