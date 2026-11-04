const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new AbortController()).constructor.extra = 41;
function read() {
  return AbortController.extra;
}
console.log(read());
