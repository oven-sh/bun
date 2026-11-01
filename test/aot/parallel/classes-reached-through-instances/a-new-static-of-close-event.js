const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new CloseEvent("x")).constructor.extra = 41;
function read() {
  return CloseEvent.extra;
}
console.log(read());
