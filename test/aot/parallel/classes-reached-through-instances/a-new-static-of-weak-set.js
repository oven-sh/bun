const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new WeakSet()).constructor.extra = 41;
function read() {
  return WeakSet.extra;
}
console.log(read());
