const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Intl.Collator()).constructor.extra = 41;
function read() {
  return Intl.Collator.extra;
}
console.log(read());
