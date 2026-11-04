const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Map()).constructor.extra = 41;
function read() {
  return Map.extra;
}
console.log(read());
