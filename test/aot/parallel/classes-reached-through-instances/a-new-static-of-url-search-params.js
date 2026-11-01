const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new URLSearchParams()).constructor.extra = 41;
function read() {
  return URLSearchParams.extra;
}
console.log(read());
