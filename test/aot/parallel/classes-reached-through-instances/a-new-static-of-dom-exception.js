const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new DOMException("x")).constructor.extra = 41;
function read() {
  return DOMException.extra;
}
console.log(read());
