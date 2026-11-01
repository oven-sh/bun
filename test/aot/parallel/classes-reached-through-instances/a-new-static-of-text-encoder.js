const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new TextEncoder()).constructor.extra = 41;
function read() {
  return TextEncoder.extra;
}
console.log(read());
