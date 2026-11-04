const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Intl.Locale("en")).constructor.extra = 41;
function read() {
  return Intl.Locale.extra;
}
console.log(read());
