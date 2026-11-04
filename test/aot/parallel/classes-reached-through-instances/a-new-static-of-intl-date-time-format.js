const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Intl.DateTimeFormat()).constructor.extra = 41;
function read() {
  return Intl.DateTimeFormat.extra;
}
console.log(read());
