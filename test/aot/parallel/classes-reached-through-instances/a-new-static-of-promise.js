const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(Promise.resolve()).constructor.extra = 41;
function read() {
  return Promise.extra;
}
console.log(read());
