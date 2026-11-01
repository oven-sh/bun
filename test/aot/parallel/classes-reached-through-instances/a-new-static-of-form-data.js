const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new FormData()).constructor.extra = 41;
function read() {
  return FormData.extra;
}
console.log(read());
