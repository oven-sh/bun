const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(1n).constructor.extra = 41;
function read() {
  return BigInt.extra;
}
console.log(read());
