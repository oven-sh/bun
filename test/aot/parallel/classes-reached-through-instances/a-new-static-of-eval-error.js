const hide = value => new CustomEvent("x", { detail: value }).detail;
hide(new EvalError("x")).constructor.extra = 41;
function read() {
  return EvalError.extra;
}
console.log(read());
