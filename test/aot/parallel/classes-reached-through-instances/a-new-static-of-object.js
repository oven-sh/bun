const hide = value => new CustomEvent("x", { detail: value }).detail;
hide({}).constructor.extra = 41;
function read() {
  return Object.extra;
}
console.log(read());
