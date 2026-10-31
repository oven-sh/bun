const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new WritableStream()).constructor.extra = 41;
function read() {
  return WritableStream.extra;
}
console.log(read());
