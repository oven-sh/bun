const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Headers()).constructor.extra = 41;
function read() {
  return Headers.extra;
}
console.log(read());
