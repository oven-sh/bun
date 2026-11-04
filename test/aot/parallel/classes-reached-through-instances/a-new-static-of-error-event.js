const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new ErrorEvent("x")).constructor.extra = 41;
function read() {
  return ErrorEvent.extra;
}
console.log(read());
