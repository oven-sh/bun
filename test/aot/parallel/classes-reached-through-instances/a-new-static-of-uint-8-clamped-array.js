const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Uint8ClampedArray(1)).constructor.extra = 41;
function read() {
  return Uint8ClampedArray.extra;
}
console.log(read());
