const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new DataView(new ArrayBuffer(1))).constructor.extra = 41;
function read() {
  return DataView.extra;
}
console.log(read());
