const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Intl.RelativeTimeFormat()).constructor.extra = 41;
function read() {
  return Intl.RelativeTimeFormat.extra;
}
console.log(read());
