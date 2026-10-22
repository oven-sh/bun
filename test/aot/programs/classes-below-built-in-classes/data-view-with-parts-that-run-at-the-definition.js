// The computed names, static initializers and static blocks of a class below DataView run where the class is defined, in their order, whenever it is first touched.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
const order = [];
const named = text => (order.push("name " + text), text);
class Late extends (order.push("heritage"), DataView) {
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
  const one = new Late(new ArrayBuffer(8));
  return [one.byteLength, one instanceof Late, one instanceof DataView, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === DataView].join(" ");
});
console.log(order.join(" | "));
