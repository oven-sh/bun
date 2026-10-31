const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Int16Array(1)).constructor.extra = 41;
function read() {
  return Int16Array.extra;
}
console.log(read());
