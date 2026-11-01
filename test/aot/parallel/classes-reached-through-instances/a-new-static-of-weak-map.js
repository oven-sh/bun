const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new WeakMap()).constructor.extra = 41;
function read() {
  return WeakMap.extra;
}
console.log(read());
