const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(performance).constructor.extra = 41;
function read() {
  return Performance.extra;
}
console.log(read());
