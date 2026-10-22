// A class below DisposableStack is first touched by Bun.inspect.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends DisposableStack {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
tell("shown", () => Bun.inspect(Late));
tell("an instance", () => {
  const one = new Late();
  return [one.disposed, one instanceof Late, one instanceof DisposableStack, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DisposableStack].join(" ");
});
