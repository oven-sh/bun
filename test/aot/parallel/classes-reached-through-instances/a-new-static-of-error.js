const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Error("x")).constructor.extra = 41;
function read() {
  return Error.extra;
}
console.log(read());
