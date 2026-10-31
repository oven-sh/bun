const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new BigUint64Array(1)).constructor.extra = 41;
function read() {
  return BigUint64Array.extra;
}
console.log(read());
