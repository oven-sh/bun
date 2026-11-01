// Built as if all code were cold. A method of a built-in class is called on values that come out of a list of all sorts: instances of the class, of a class below it, objects that have the name
// themselves, an instance that hides the method with a property of its own, a proxy, primitives, and nothing at all. Each call must find what a read of the name finds.
// Flags: --aot-heat=EverythingIsCold
class Chunks extends Array {
  push(...items) {
    return "Chunks " + super.push(...items.map(item => "<" + item + ">"));
  }
}
const hidden = ["hidden"];
hidden.push = function (item) {
  return "own " + item + " " + this.length;
};
const impostor = {
  items: [],
  push(item) {
    this.items.push(item);
    return "impostor " + this.items.length;
  },
  charCodeAt(index) {
    return "impostor " + index;
  },
  get(key) {
    return "impostor " + key;
  },
};
const watched = [];
const proxy = new Proxy(["proxy"], {
  get(target, key, receiver) {
    watched.push(String(key));
    return Reflect.get(target, key, receiver);
  },
});
const belowNothing = Object.create(null);
const receivers = [[], ["a"], new Chunks(), hidden, impostor, proxy, "text", new String("object"), 7, true, Symbol.iterator, belowNothing, new Map([["k", "map"]]), new WeakMap(), null, undefined];
function describe(value) {
  return Array.isArray(value) ? "[" + value.join() + "]" : typeof value === "symbol" ? "symbol" : value === belowNothing ? "below nothing" : value instanceof Map ? "map" : value instanceof WeakMap ? "weak map" : value === impostor ? "impostor" : String(value);
}
function attempt(label, receiver, action) {
  try {
    return label + " " + describe(receiver) + ": " + String(action(receiver));
  } catch (error) {
    return label + " " + describe(receiver) + ": " + error.constructor.name;
  }
}
function pushTwice(target) {
  target.push("x");
  return target.push("y", "z");
}
function codeAt(text) {
  return text.charCodeAt(1);
}
function lookUp(holder) {
  return holder.get("k");
}
const lines = [];
for (let round = 0; round < 3; round++) {
  for (const receiver of receivers) {
    lines.push(attempt("push", receiver, pushTwice));
    lines.push(attempt("charCodeAt", receiver, codeAt));
    lines.push(attempt("get", receiver, lookUp));
  }
}
console.log(lines.join("\n"));
console.log(watched.join());
