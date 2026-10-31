const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(5).constructor.extra = 41;
function read() {
  return Number.extra;
}
console.log(read());
