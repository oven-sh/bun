// What a helper defined under a written name is redefined, deleted, shadowed and defined again, and odd names are handed too.
function defineGetter(target, source, name) {
  target.__defineGetter__(name, function () {
    return this[source][name];
  });
}
function defineMethod(target, name, tag) {
  target[name] = function () {
    return tag + ":" + name + ":" + typeof this;
  };
}
function defineProperty(target, name, value) {
  Object.defineProperty(target, name, {
    get() {
      return name + "=" + value;
    },
    configurable: true,
    enumerable: true,
  });
}
const show = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
};

const base = { inner: { size: 1, color: "red", 0: "zero" }, other: { size: 2 } };
defineGetter(base, "inner", "size");
defineGetter(base, "inner", "color");
defineGetter(base, "inner", "0");
defineGetter(base, "inner", "__proto__");
console.log(base.size, base.color, base[0], base.__proto__ === Object.prototype);

defineGetter(base, "other", "size");
console.log(base.size);
const child = Object.create(base);
child.inner = { size: 10, color: "blue" };
child.other = { size: 20 };
console.log(child.size, child.color);
Object.defineProperty(child, "color", { value: "own", configurable: true });
console.log(child.color, base.color);
delete child.color;
delete base.color;
console.log(child.color, base.color, "color" in base);
base.__defineGetter__("size", () => "replaced");
console.log(child.size, base.size);

const methods = {};
defineMethod(methods, "first", "a");
defineMethod(methods, "second", "b");
defineMethod(methods, "first", "c");
console.log(methods.first(), methods.second(), methods.first.call(1), Object.keys(methods).join());
console.log(methods.first === methods.second, methods.first.name, methods.second.length);
const key = Symbol("key");
defineMethod(methods, key, "d");
defineMethod(methods, 7, "e");
defineMethod(methods, ["x", "y"].join(""), "f");
console.log(show(() => methods[key]()), methods[7](), methods.xy(), Object.keys(methods).join());

const frozen = Object.freeze({});
try {
  defineMethod(frozen, "late", "g");
} catch (error) {
  console.log(error.constructor.name);
}
console.log("late" in frozen, show(() => defineProperty(frozen, "late", 1)));
console.log(show(() => defineMethod(undefined, "none", "h")), show(() => defineGetter(null, "inner", "none")));

const seen = [];
const watched = new Proxy({}, {
  set(target, name, value) {
    seen.push("set " + String(name));
    target[name] = value;
    return true;
  },
  defineProperty(target, name, descriptor) {
    seen.push("define " + String(name));
    return Reflect.defineProperty(target, name, descriptor);
  },
});
defineMethod(watched, "one", "i");
defineProperty(watched, "two", 2);
console.log(seen.join(), watched.one(), watched.two);

const properties = {};
defineProperty(properties, "left", 1);
defineProperty(properties, "right", 2);
defineProperty(properties, "left", 3);
console.log(properties.left, properties.right, JSON.stringify(properties));
const own = {
  inner: { patched: 1 },
  __defineGetter__(name) {
    seen.push("own " + name);
  },
};
defineGetter(own, "inner", "patched");
console.log(seen.at(-1), own.patched);
