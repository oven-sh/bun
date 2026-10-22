// Between the definition of a class below DisposableStack and its first touch the collector runs.
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
Bun.gc(true);
tell("an instance", () => {
  const one = new Late();
  return [one.disposed, one instanceof Late, one instanceof DisposableStack, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DisposableStack].join(" ");
});
