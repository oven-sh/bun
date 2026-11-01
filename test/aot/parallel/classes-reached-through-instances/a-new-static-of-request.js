const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Request("http://a/")).constructor.extra = 41;
function read() {
  return Request.extra;
}
console.log(read());
