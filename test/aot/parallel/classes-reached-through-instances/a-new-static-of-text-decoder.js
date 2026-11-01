const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new TextDecoder()).constructor.extra = 41;
function read() {
  return TextDecoder.extra;
}
console.log(read());
