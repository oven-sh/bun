// Sloppy code: every door by which it may try to change a locked built-in object. The refusal is a TypeError here as in strict code.
const f = function () {};
const key = ["pu", "sh"].join(""), index = [3].length + 2;
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
function door(name, change, stays) {
  let said;
  try { change(); said = "silent"; } catch (error) { said = error.constructor.name + ": " + String(error.message).slice(0, 58); }
  console.log(name + " | " + said + " | " + (stays() ? "as it was" : "CHANGED"));
}
const push = Array.prototype.push, map = Array.prototype.map, max = Math.max, then = Promise.prototype.then, exec = RegExp.prototype.exec, call = Function.prototype.call, iterator = Array.prototype[Symbol.iterator];
door("a store by name", () => { Array.prototype.push = f; }, () => Array.prototype.push === push);
door("a store by a literal key", () => { Array.prototype["push"] = f; }, () => Array.prototype.push === push);
door("a store by a computed key", () => { Array.prototype[key] = f; }, () => Array.prototype.push === push);
door("a store by a symbol", () => { Array.prototype[Symbol.iterator] = f; }, () => Array.prototype[Symbol.iterator] === iterator);
door("a store through a value nobody knows", () => { unknown(Array.prototype).push = f; }, () => Array.prototype.push === push);
door("a deletion by name", () => { delete Array.prototype.map; }, () => Array.prototype.map === map);
door("a deletion by a computed key", () => { delete Array.prototype[key]; }, () => Array.prototype.push === push);
door("a deletion through a value nobody knows", () => { delete unknown(Array.prototype).map; }, () => Array.prototype.map === map);
door("a new name on Object.prototype", () => { Object.prototype.extra = 1; }, () => !("extra" in {}));
door("a new name on Object.prototype by a computed key", () => { Object.prototype[key + "ed"] = 1; }, () => !("pushed" in {}));
door("a member of Object.prototype", () => { Object.prototype.toString = f; }, () => Object.prototype.toString !== f);
door("a deletion on Object.prototype", () => { delete Object.prototype.toString; }, () => "toString" in {});
door("a new name on Function.prototype", () => { Function.prototype.mine = 1; }, () => !("mine" in f));
door("a member of Function.prototype", () => { Function.prototype.call = f; }, () => Function.prototype.call === call);
door("a member of Promise.prototype", () => { Promise.prototype.then = f; }, () => Promise.prototype.then === then);
door("a member of RegExp.prototype", () => { RegExp.prototype.exec = f; }, () => RegExp.prototype.exec === exec);
door("a compound assignment", () => { Array.prototype.push += 1; }, () => Array.prototype.push === push);
door("a logical assignment", () => { Array.prototype.push &&= f; }, () => Array.prototype.push === push);
door("an increment", () => { Array.prototype.push++; }, () => Array.prototype.push === push);
door("an array pattern", () => { [Array.prototype.push] = [f]; }, () => Array.prototype.push === push);
door("an object pattern", () => { ({ a: Array.prototype.push } = { a: f }); }, () => Array.prototype.push === push);
door("the target of for-of", () => { for (Array.prototype.push of [f]); }, () => Array.prototype.push === push);
door("the target of for-in", () => { for (Array.prototype.push in { a: 1 }); }, () => Array.prototype.push === push);
door("with", () => { with (Array.prototype) { push = f; } }, () => Array.prototype.push === push);
door("Object.assign", () => { Object.assign(Array.prototype, { push: f }); }, () => Array.prototype.push === push);
door("a numeric key", () => { Array.prototype[index] = 1; }, () => !(index in []));
door("the length of Array.prototype", () => { Array.prototype.length = 3; }, () => Array.prototype.length === 0);
door("__proto__", () => { Array.prototype.__proto__ = {}; }, () => Object.getPrototypeOf(Array.prototype) === Object.prototype);
door("a member of a namespace", () => { Math.max = f; }, () => Math.max === max);
door("a member of a constructor", () => { Array.from = f; }, () => Array.from !== f);
door("a global by its name", () => { Array = f; }, () => Array !== f);
door("a global as a member", () => { globalThis.Array = f; }, () => Array !== f);
door("a deletion of a global", () => { delete globalThis.Array; }, () => typeof Array === "function");
door("call on a built-in function", () => { Math.max.call = f; }, () => Math.max.call === call);
door("a host prototype", () => { Request.prototype.json = f; }, () => Request.prototype.json !== f);
const throughSuper = { member() { super.push = f; }, newName() { super.extra = 1; } };
door("super, with the built-in as this", () => { throughSuper.member.call(Array.prototype); }, () => Array.prototype.push === push);
door("super, a new name", () => { throughSuper.newName.call(Object.prototype); }, () => !("extra" in {}));
door("text that is evaluated", () => { new Function("f", "Array.prototype.push = f;")(f); }, () => Array.prototype.push === push);
// What the language itself refuses in silence stays silent, and what answers false goes on answering false.
door("Math.PI, read-only by the language", () => { Math.PI = 3; }, () => Math.PI > 3.1);
door("undefined, read-only by the language", () => { undefined = 1; }, () => undefined === void 0);
door("the same value again", () => { Array.prototype.push = push; }, () => Array.prototype.push === push);
console.log("Reflect", Reflect.set(Array.prototype, "push", f), Reflect.deleteProperty(Array.prototype, "map"), Reflect.defineProperty(Array.prototype, "push", { value: f }), Reflect.setPrototypeOf(Array.prototype, {}), Reflect.set(Object.prototype, "extra", 1));
