// Whoever lists the own keys of the prototype object of a library class has the name of every member, so every member is compiled. Where the compiler sees
// `Reflect.ownKeys(<a value nobody knows>)`, that value may be a prototype object that a statement of the program has put out of sight. Each road here does that.
// A prototype object that only escaped with an instance or with its constructor is no such value: an `Object.keys(options)` somewhere brings in no method of any library class.
const dc = require("node:diagnostics_channel");
const { EventEmitter } = require("node:events");
const channel = dc.channel("x");
channel.subscribe(function listener() {});
function namesCalled(x, receiver) {
  const out = [];
  for (const key of Reflect.ownKeys(x)) {
    if (key === "constructor" || typeof key === "symbol") continue;
    let value;
    try {
      value = x[key];
    } catch (error) {
      out.push(key + ": reading throws " + error.constructor.name);
      continue;
    }
    if (typeof value !== "function") continue;
    try {
      out.push(key + ": " + typeof value.call(receiver, "name", function () {}));
    } catch (error) {
      out.push(key + ": throws " + error.constructor.name);
    }
  }
  return out.sort().join(" | ");
}
const unknown = () => JSON.parse(process.env.BOX ?? "{}");

// In an object that the program made, which then goes out of sight.
const made = { held: Object.getPrototypeOf(channel) };
const first = unknown();
first.box = made;
console.log("in an object of the program:", namesCalled(first.box.held, channel));

// As an argument of a function nobody knows.
const second = unknown();
second.keep = function (value) { this.kept = value; };
const keep = second[process.env.KEEP ?? "keep"];
keep.call(second, Object.getPrototypeOf(channel));
console.log("as an argument:", namesCalled(second.kept, channel));

// Off the constructor, by the name `prototype`.
const third = unknown();
third.held = EventEmitter.prototype;
console.log("off the constructor:", namesCalled(third.held, new EventEmitter()));

// Off the constructor of an instance, which came back out of sight itself.
const fourth = unknown();
fourth.instance = new EventEmitter();
fourth.held = fourth.instance.constructor.prototype;
console.log("off the constructor of an instance:", namesCalled(fourth.held, new EventEmitter()));

// Above an instance that came back out of sight: nobody handed the prototype object out, the program asks for it.
const fifth = unknown();
fifth.instance = dc.channel("y");
console.log("by Object.getPrototypeOf:", namesCalled(Object.getPrototypeOf(fifth.instance), channel));
console.log("by __proto__:", namesCalled(fifth.instance.__proto__, channel));
console.log("by Reflect.getPrototypeOf:", namesCalled(Reflect.getPrototypeOf(fifth.instance), channel));

// Up the whole chain, as a library that wraps every method of an object does.
const sixth = unknown();
sixth.instance = new EventEmitter();
for (let object = sixth.instance; object && object !== Object.prototype; object = Object.getPrototypeOf(object))
  console.log("up the chain:", namesCalled(object, sixth.instance));
