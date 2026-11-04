const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new WeakRef({})).constructor.extra = 41;
function read() {
  return WeakRef.extra;
}
console.log(read());
