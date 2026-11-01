const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Intl.ListFormat()).constructor.extra = 41;
function read() {
  return Intl.ListFormat.extra;
}
console.log(read());
