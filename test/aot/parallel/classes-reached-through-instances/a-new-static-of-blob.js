const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Blob([])).constructor.extra = 41;
function read() {
  return Blob.extra;
}
console.log(read());
