const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new TransformStream()).constructor.extra = 41;
function read() {
  return TransformStream.extra;
}
console.log(read());
