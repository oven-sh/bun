const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Date(0)).constructor.extra = 41;
function read() {
  return Date.extra;
}
console.log(read());
