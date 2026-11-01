// `Object.defineProperty(target, name, Object.getOwnPropertyDescriptor(source, name))` for each name, as `_defaults` of Babel and every mixin do: the descriptor is an object,
// and no layout of the target has the names. The second target gets them as the first did; a target in another state, or another descriptor, gets them in its own way.
function describe(object) {
  return Reflect.ownKeys(object)
    .map(key => {
      const found = Object.getOwnPropertyDescriptor(object, key);
      const flags = (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-");
      return String(key) + "=" + ("value" in found ? String(found.value) : "accessor") + flags;
    })
    .join(" ");
}
const names = JSON.parse('["alpha", "beta", "gamma"]');
function sourceWith(value) {
  const source = {};
  source[names[0]] = value;
  Object.defineProperty(source, names[1], { value: value + 1, configurable: true });
  Object.defineProperty(source, names[2], { value: value + 2, writable: true });
  return source;
}
class Target {
  constructor(own) {
    this.own = own;
  }
}
function copy(target, source) {
  for (const name of Object.getOwnPropertyNames(source)) {
    const found = Object.getOwnPropertyDescriptor(source, name);
    if (found && target[name] === undefined) Object.defineProperty(target, name, found);
  }
  return target;
}
let sum = 0;
for (let turn = 0; turn < 1000; turn++) {
  const made = copy(new Target(turn), sourceWith(turn & 7));
  sum += made.alpha + made.beta + made.gamma + made.own;
}
console.log(sum, describe(copy(new Target(1), sourceWith(5))));
const lines = [];
function say(name, make) {
  try {
    lines.push(name + ": " + make());
  } catch (error) {
    lines.push(name + ": " + error.constructor.name);
  }
}
const data = { value: 1, writable: true, enumerable: true, configurable: true };
for (let twice = 0; twice < 2; twice++) {
  say("all true", () => describe(Object.defineProperty(new Target(0), names[0], data)));
  say("nothing said", () => describe(Object.defineProperty(new Target(0), names[0], {})));
  say("only a value", () => describe(Object.defineProperty(new Target(0), names[0], { value: 2 })));
  say("only writable", () => describe(Object.defineProperty(new Target(0), names[0], { writable: true })));
  say("a getter", () => describe(Object.defineProperty(new Target(0), names[0], { get: () => 3, enumerable: true })));
  say("inherited words", () => describe(Object.defineProperty(new Target(0), names[0], Object.create(data))));
  say("words that are truthy", () => describe(Object.defineProperty(new Target(0), names[0], { value: 4, writable: 1, enumerable: "yes", configurable: {} })));
  say("a getter in the descriptor", () => describe(Object.defineProperty(new Target(0), names[0], { get value() { return 5; }, enumerable: true })));
  say("both kinds", () => describe(Object.defineProperty(new Target(0), names[0], { value: 1, get() {} })));
  say("closed", () => describe(Object.defineProperty(Object.preventExtensions(new Target(0)), names[0], data)));
  say("frozen", () => describe(Object.defineProperty(Object.freeze(new Target(0)), names[0], data)));
  say("there already", () => describe(Object.defineProperty(Object.defineProperty(new Target(0), names[0], data), names[0], { value: 6 })));
  say("there already, fixed", () => describe(Object.defineProperty(Object.defineProperty(new Target(0), names[0], { value: 1 }), names[0], { value: 7 })));
  say("another name first", () => describe(Object.defineProperty(Object.defineProperty(new Target(0), names[1], data), names[0], data)));
  say("the field itself", () => describe(Object.defineProperty(new Target(0), "own", { value: 8, enumerable: false })));
  say("by Reflect", () => Reflect.defineProperty(new Target(0), names[0], data) + " " + Reflect.defineProperty(Object.freeze(new Target(0)), names[0], data));
  say("several at once", () => describe(Object.defineProperties(new Target(0), { [names[0]]: data, [names[1]]: { value: 9 } })));
  if (typeof Bun !== "undefined") Bun.gc(true);
}
console.log(lines.join("\n"));
