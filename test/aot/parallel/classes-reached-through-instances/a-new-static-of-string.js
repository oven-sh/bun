const hide = value => new CustomEvent("x", { detail: value }).detail;
hide("text").constructor.extra = 41;
function read() {
  return String.extra;
}
console.log(read());
