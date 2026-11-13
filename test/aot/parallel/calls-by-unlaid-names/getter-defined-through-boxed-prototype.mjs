// A getter defined on the prototype that a boxed number gives answers a call by that name off the number.
class V {
  constructor(x) {
    this.x = x;
  }
  combine(other) {
    return this.x + other.x;
  }
}
const method = function (other) {
  other.x = { y: 1 };
  return 8;
};
const held = new Set([new V(1), 2.5]);
const prototype = Object(2.5).__proto__;
prototype.__defineGetter__("combine", () => method);
for (const value of held) {
  const argument = new V(5);
  console.log(value.combine(argument), typeof argument.x);
}
