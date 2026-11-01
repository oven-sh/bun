const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(Symbol.iterator).constructor.extra = 41;
function read() {
  return Symbol.extra;
}
console.log(read());
