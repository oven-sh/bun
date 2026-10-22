// The computed names, static initializers and static blocks of a class below DisposableStack run where the class is defined, in their order, whenever it is first touched.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const order = [];
const named = text => (order.push("name " + text), text);
class Late extends (order.push("heritage"), DisposableStack) {
  [named("first")]() {}
  static [named("second")] = order.push("initializer");
  static {
    order.push("block " + (this === Late));
  }
  method() {
    return "method of " + this.constructor.name;
  }
}
order.push("behind the definition");
tell("an instance", () => {
  const one = new Late();
  return [one.disposed, one instanceof Late, one instanceof DisposableStack, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DisposableStack].join(" ");
});
console.log(order.join(" | "));
