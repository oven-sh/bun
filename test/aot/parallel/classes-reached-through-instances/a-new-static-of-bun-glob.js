const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new Bun.Glob("*")).constructor.extra = 41;
function read() {
  return Bun.Glob.extra;
}
console.log(read());
