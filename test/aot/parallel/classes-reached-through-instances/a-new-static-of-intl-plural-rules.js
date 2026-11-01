const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Intl.PluralRules()).constructor.extra = 41;
function read() {
  return Intl.PluralRules.extra;
}
console.log(read());
