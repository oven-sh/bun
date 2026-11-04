const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Temporal.PlainDate(2020, 1, 1)).constructor.extra = 41;
function read() {
  return Temporal.PlainDate.extra;
}
console.log(read());
