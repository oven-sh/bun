const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new URL("http://a/")).constructor.extra = 41;
function read() {
  return URL.extra;
}
console.log(read());
