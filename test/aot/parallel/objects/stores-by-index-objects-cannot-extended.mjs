// What a store by index, and an array method that stores by index, says when the object cannot be extended.
const show = (name, action) => { try { console.log(name, action()); } catch (error) { console.log(name, error.constructor.name, error.message); } };
const plainObject = Object.preventExtensions({});
const withLength = Object.preventExtensions({ length: 0 });
class Box { constructor() { this.length = 0; } }
const instance = Object.preventExtensions(new Box());
const frozen = Object.freeze({ length: 0 });
const sealed = Object.seal({ length: 0 });
const list = Object.preventExtensions([]);
for (const [name, target] of Object.entries({ plainObject, withLength, instance, frozen, sealed, list })) {
  show(name + " push", () => Array.prototype.push.call(target, 7));
  show(name + " unshift", () => Array.prototype.unshift.call(target, 7));
  show(name + " splice", () => Array.prototype.splice.call(target, 0, 0, 7));
  show(name + " fill", () => Array.prototype.fill.call(target, 7));
  show(name + " copyWithin", () => Array.prototype.copyWithin.call(target, 0, 1));
  show(name + " strict store by index", () => { "use strict"; target[0] = 7; return "stored"; });
  show(name + " strict store by name", () => { "use strict"; target.other = 7; return "stored"; });
  show(name + " assign", () => Object.assign(target, { other: 1 }));
  show(name + " Reflect.set", () => Reflect.set(target, 0, 7));
  show(name + " defineProperty", () => Object.defineProperty(target, "other", { value: 1 }));
}
