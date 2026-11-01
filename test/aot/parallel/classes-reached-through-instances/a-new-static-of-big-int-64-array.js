const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new BigInt64Array(1)).constructor.extra = 41;
function read() {
  return BigInt64Array.extra;
}
console.log(read());
