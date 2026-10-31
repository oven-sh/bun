// Each way puts a new name on Set.prototype, which the program holds as a value that the compiler cannot follow. Compiled code finds the name from then on.
// Flags: --aot-validate
import util from "node:util";
import { EventEmitter } from "node:events";
const hide = value => new CustomEvent("x", { detail: value }).detail;
function one() {
  return "one";
}
const show = (label, read) => {
  let answer;
  try {
    answer = read();
  } catch (error) {
    answer = error.constructor.name;
  }
  console.log(label, answer);
};
const all = () => {
  const set = new Set();
  return [typeof set.a1, typeof set.a2, typeof set.a3, set.a4, set.a5, typeof set.a6, typeof set.a7, typeof set.a8, typeof set._events, typeof set.a10].join(" ");
};
console.log("before:", all());
const proto = Object.getPrototypeOf(hide(new Set()));
Object.assign(proto, { a1: one });
show("Object.assign:", () => new Set().a1());
Object.defineProperties(proto, { a2: { value: one, configurable: true } });
show("Object.defineProperties:", () => new Set().a2());
Reflect.set(proto, "a3", one);
show("Reflect.set:", () => new Set().a3());
Reflect.defineProperty(proto, "a4", { get() { return "got 4"; }, configurable: true });
show("Reflect.defineProperty:", () => new Set().a4);
proto.__defineGetter__("a5", function () { return "got 5"; });
show("__defineGetter__:", () => new Set().a5);
[["a6", one]].forEach(([key, value]) => { proto[key] = value; });
show("in a callback:", () => new Set().a6());
Reflect.apply(Object.defineProperty, null, [proto, "a7", { value: one, configurable: true }]);
show("Reflect.apply:", () => new Set().a7());
util._extend(proto, { a8: one });
show("util._extend:", () => new Set().a8());
EventEmitter.call(proto);
show("EventEmitter.call:", () => typeof new Set()._events);
console.log("after:", all());
console.log(new Set([1]));
