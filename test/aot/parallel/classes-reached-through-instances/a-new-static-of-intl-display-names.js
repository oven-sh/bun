const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Intl.DisplayNames("en", { type: "region" })).constructor.extra = 41;
function read() {
  return Intl.DisplayNames.extra;
}
console.log(read());
