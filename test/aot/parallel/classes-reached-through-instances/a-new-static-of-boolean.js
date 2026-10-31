const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(true).constructor.extra = 41;
function read() {
  return Boolean.extra;
}
console.log(read());
