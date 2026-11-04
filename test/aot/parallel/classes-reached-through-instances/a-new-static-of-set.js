const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Set()).constructor.extra = 41;
function read() {
  return Set.extra;
}
console.log(read());
