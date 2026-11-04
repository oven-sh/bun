const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Intl.NumberFormat()).constructor.extra = 41;
function read() {
  return Intl.NumberFormat.extra;
}
console.log(read());
