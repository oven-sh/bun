class Base { [Symbol.for("nodejs.util.inspect.custom")]() { return "inherited by " + this.constructor.name; } }
class Derived extends Base {}
const list = [new Derived()];
console.log(list[Number(process.env.INDEX ?? 0)]);
console.error(Object.create(new Derived()));
