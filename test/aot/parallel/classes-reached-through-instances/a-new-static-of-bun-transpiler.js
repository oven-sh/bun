const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Bun.Transpiler()).constructor.extra = 41;
function read() {
  return Bun.Transpiler.extra;
}
console.log(read());
