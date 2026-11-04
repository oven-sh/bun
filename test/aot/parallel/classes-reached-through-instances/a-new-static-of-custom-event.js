const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new CustomEvent("x")).constructor.extra = 41;
function read() {
  return CustomEvent.extra;
}
console.log(read());
