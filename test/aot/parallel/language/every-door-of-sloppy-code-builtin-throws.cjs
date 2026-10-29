// Sloppy code: every door by which it may try to change a locked built-in object. The refusal is a TypeError here as in strict code.
const f = function () {};
const key = ["pu", "sh"].join(""), index = [3].length + 2;
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
function door(name, change, stays) {
  let said;
  try { change(); said = "silent"; } catch (error) { said = error.constructor.name + ": " + String(error.message).slice(0, 58); }
  console.log(name + " | " + said + " | " + (stays() ? "as it was" : "CHANGED"));
}
let push = Array.prototype.push;
const map = Array.prototype.map, max = Math.max, then = Promise.prototype.then, exec = RegExp.prototype.exec, call = Function.prototype.call, iterator = Array.prototype[Symbol.iterator];
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
/* Output:
a store by name | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
a store by a literal key | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
a store by a computed key | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
a store by a symbol | TypeError: Cannot assign to Array.prototype[Symbol(Symbol.iterator)]  | as it was
a store through a value nobody knows | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
a deletion by name | TypeError: Cannot delete Array.prototype.map because built-in objects | as it was
a deletion by a computed key | TypeError: Cannot delete Array.prototype.push because built-in object | as it was
a deletion through a value nobody knows | TypeError: Cannot delete Array.prototype.map because built-in objects | as it was
a new name on Object.prototype | TypeError: Cannot assign to Object.prototype.extra because built-in o | as it was
a new name on Object.prototype by a computed key | TypeError: Cannot assign to Object.prototype.pushed because built-in  | as it was
a member of Object.prototype | TypeError: Cannot assign to Object.prototype.toString because built-i | as it was
a deletion on Object.prototype | TypeError: Cannot delete Object.prototype.toString because built-in o | as it was
a new name on Function.prototype | TypeError: Cannot assign to Function.prototype.mine because built-in  | as it was
a member of Function.prototype | TypeError: Cannot assign to Function.prototype.call because built-in  | as it was
a member of Promise.prototype | TypeError: Cannot assign to Promise.prototype.then because built-in o | as it was
a member of RegExp.prototype | TypeError: Cannot assign to RegExp.prototype.exec because built-in ob | as it was
a compound assignment | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
a logical assignment | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
an increment | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
an array pattern | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
an object pattern | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
the target of for-of | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
the target of for-in | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
with | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
Object.assign | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
a numeric key | TypeError: Cannot assign to Array.prototype[3] because built-in objec | as it was
the length of Array.prototype | TypeError: Cannot assign to Array.prototype.length because built-in o | as it was
__proto__ | TypeError: Cannot assign to Array.prototype.__proto__ because built-i | as it was
a member of a namespace | TypeError: Cannot assign to Math.max because built-in objects are rea | as it was
a member of a constructor | TypeError: Cannot assign to Array.from because built-in objects are r | as it was
a global by its name | TypeError: Cannot assign to Array because built-in objects are read-o | as it was
a global as a member | TypeError: Cannot assign to Array because built-in objects are read-o | as it was
a deletion of a global | TypeError: Cannot delete Array because built-in objects are read-only | as it was
call on a built-in function | TypeError: Cannot assign to 'call' of a built-in function because bui | as it was
a host prototype | TypeError: Cannot assign to Request.prototype.json because built-in o | as it was
super, with the built-in as this | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
super, a new name | TypeError: Cannot assign to Object.prototype.extra because built-in o | as it was
text that is evaluated | TypeError: Cannot assign to Array.prototype.push because built-in obj | as it was
Math.PI, read-only by the language | silent | as it was
undefined, read-only by the language | silent | as it was
the same value again | silent | as it was
Reflect false false false false false
*/
