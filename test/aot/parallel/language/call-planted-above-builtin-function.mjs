// A built-in function refuses `call` as a property of its own. Planted one step up, by giving the function another prototype, it would be found all the same: the function keeps its prototype.
// The function goes through native code, so the compiler does not see what the change is made to.
function handedThroughNativeCode(value) {
  let out;
  const target = new EventTarget();
  target.addEventListener("x", event => {
    out = event.detail;
  });
  target.dispatchEvent(new CustomEvent("x", { detail: value }));
  return out;
}
function planted() {
  return "planted ran";
}
const above = Object.create(Function.prototype);
above.call = planted;
above.apply = planted;
for (const [name, f, run] of [
  ["Array.prototype.map", Array.prototype.map, () => Array.prototype.map.call([1, 2], x => x * 2)],
  ["Array.prototype.filter", Array.prototype.filter, () => Array.prototype.filter.apply([1, 2], [x => x > 1])],
  ["Reflect.get", Reflect.get, () => Reflect.get.call(null, { a: 1 }, "a")],
  ["Function.prototype.call", Function.prototype.call, () => Function.prototype.call.call(Math.max, null, 1, 2)],
  ["Math.max", Math.max, () => Math.max.call(null, 1, 2)],
  ["Object.prototype.hasOwnProperty", Object.prototype.hasOwnProperty, () => Object.prototype.hasOwnProperty.call({ a: 1 }, "a")],
]) {
  const ways = [];
  const unseen = handedThroughNativeCode(f);
  ways.push(Reflect.setPrototypeOf(unseen, above) ? "changed" : "refused");
  try {
    Object.setPrototypeOf(unseen, above);
    ways.push("changed");
  } catch (error) {
    ways.push(error.constructor.name);
  }
  try {
    unseen.__proto__ = above;
    ways.push("changed");
  } catch (error) {
    ways.push(error.constructor.name);
  }
  const answer = String(run());
  ways.push(Reflect.setPrototypeOf(unseen, Function.prototype) ? "Function.prototype is taken" : "Function.prototype is refused");
  console.log(name, "|", ways.join(", "), "|", answer, "|", Object.getPrototypeOf(f) === Function.prototype);
}
/* Output:
Array.prototype.map | refused, TypeError, TypeError, Function.prototype is taken | 2,4 | true
Array.prototype.filter | refused, TypeError, TypeError, Function.prototype is taken | 2 | true
Reflect.get | refused, TypeError, TypeError, Function.prototype is taken | 1 | true
Function.prototype.call | refused, TypeError, TypeError, Function.prototype is taken | 2 | true
Math.max | refused, TypeError, TypeError, Function.prototype is taken | 2 | true
Object.prototype.hasOwnProperty | refused, TypeError, TypeError, Function.prototype is taken | true | true
*/
