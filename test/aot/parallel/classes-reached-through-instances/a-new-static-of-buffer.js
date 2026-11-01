const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(Buffer.alloc(1)).constructor.extra = 41;
function read() {
  return Buffer.extra;
}
console.log(read());
