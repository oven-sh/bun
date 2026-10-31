const hide = value => new CustomEvent("x", { detail: value }).detail;
hide([]).constructor.extra = 41;
function read() {
  return Array.extra;
}
console.log(read());
