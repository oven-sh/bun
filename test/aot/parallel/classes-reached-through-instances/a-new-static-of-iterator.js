const hide = value => new CustomEvent("x", { detail: value }).detail;
hide([].values()).constructor.extra = 41;
function read() {
  return Iterator.extra;
}
console.log(read());
