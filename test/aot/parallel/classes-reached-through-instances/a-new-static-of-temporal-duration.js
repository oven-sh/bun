const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Temporal.Duration()).constructor.extra = 41;
function read() {
  return Temporal.Duration.extra;
}
console.log(read());
