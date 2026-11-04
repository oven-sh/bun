const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(function () {}).constructor.extra = 41;
function read() {
  return Function.extra;
}
console.log(read());
