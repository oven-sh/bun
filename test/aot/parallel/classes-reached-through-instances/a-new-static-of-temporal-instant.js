const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(Temporal.Now.instant()).constructor.extra = 41;
function read() {
  return Temporal.Instant.extra;
}
console.log(read());
