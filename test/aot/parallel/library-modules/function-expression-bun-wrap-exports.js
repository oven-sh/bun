// Prints, for every function that bun:wrap exports, its own keys, its property `prototype` and whether it constructs, and what `new` makes of the one that is written as a function expression.
const wrap = require("bun:wrap");
function constructs(f) {
  try {
    Reflect.construct(Object, [], f);
    return true;
  } catch {
    return false;
  }
}
for (const key of Object.keys(wrap).sort()) {
  const f = wrap[key];
  if (typeof f !== "function") continue;
  const own = Object.getOwnPropertyDescriptor(f, "prototype");
  console.log(key, Reflect.ownKeys(f).join(), "prototype" in f, constructs(f));
  if (!own) continue;
  const flags = [own.writable, own.enumerable, own.configurable].join();
  console.log(typeof own.value, flags, Reflect.ownKeys(own.value).join(), own.value.constructor === f);
}

const decorate = wrap.__legacyDecorateClassTS;
const first = decorate.prototype;
const made = new decorate([], 5);
console.log(first === decorate.prototype, Object.getPrototypeOf(first) === Object.prototype);
console.log(Object.getPrototypeOf(made) === first, made instanceof decorate, made.constructor === decorate);
console.log(Object.getPrototypeOf(Reflect.construct(Object, [], decorate)) === first);
class Heir extends decorate {}
console.log(new Heir([], 5) instanceof decorate, Object.getPrototypeOf(Heir.prototype) === first);

decorate.prototype = { marked: true };
console.log(new decorate([], 5).marked, made instanceof decorate, Object.keys(decorate).join());
console.log(delete decorate.prototype, Reflect.ownKeys(decorate).join());
