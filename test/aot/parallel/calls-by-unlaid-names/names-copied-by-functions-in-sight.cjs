// A function of the program or of the library that copies names is handed the prototype of a primitive, however the program has come by it: the names are there, and no copy throws.
const util = require("util");
const EventEmitter = require("events");
class V {
  constructor(x) {
    this.x = x;
  }
  combine(other) {
    return this.x + other.x;
  }
  scale(other) {
    return this.x * other.x;
  }
  area(other) {
    return this.x - other.x;
  }
  fold(other) {
    return this.x / other.x;
  }
  _maxListeners(other) {
    return this.x % other.x;
  }
}
const method = function (other) {
  other.x = "copied";
  return 7;
};
const held = [new V(1), 3, new V(2), "text", true, new V(4)];
const calls = [
  (value, argument) => value.combine(argument),
  (value, argument) => value.scale(argument),
  (value, argument) => value.area(argument),
  (value, argument) => value.fold(argument),
  (value, argument) => value._maxListeners(argument),
];
function run() {
  const said = [];
  for (const value of held) {
    for (const call of calls) {
      const argument = new V(5);
      let result;
      try {
        result = call(value, argument);
      } catch (error) {
        result = error.constructor.name;
      }
      said.push(result, argument.x, argument.x * 2);
    }
  }
  return said.join();
}
function copy(target, source) {
  for (const key of Object.keys(source)) target[key] = source[key];
  return target;
}
console.log(run());
copy((3).__proto__, { combine: method });
console.log(run());
util._extend(JSON.parse('"text"').__proto__, { scale: method });
console.log(run());
copy(JSON.parse("true").constructor.prototype, { area: method });
console.log(run());
util._extend(Object.getPrototypeOf(JSON.parse("3")), { fold: method });
console.log(run());
EventEmitter.prototype.setMaxListeners.call(held[1].__proto__, 5);
console.log(run());
