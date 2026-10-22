const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function Engine(power) {
  this.power = power;
  this.madeFor = new.target === undefined ? "nobody" : new.target === Engine ? "Engine" : "someone else";
}
Engine.prototype.run = function () {
  return "engine runs at " + this.power;
};

function Motor() {
  this.power = "motor power";
}
Motor.prototype.run = function () {
  return "motor runs at " + this.power;
};

class Turbine {
  constructor() {
    this.power = "turbine power";
  }
  run() {
    return "turbine runs at " + this.power;
  }
}

class ModernEngine {
  constructor(power) {
    this.power = power;
    this.madeFor = new.target === ModernEngine ? "ModernEngine" : "someone else";
  }
  run() {
    return "modern engine runs at " + this.power;
  }
}

function runOf(engine) {
  return engine.run();
}

function powerOf(engine) {
  return engine.power;
}

function withPrototype(value) {
  function Odd() {}
  Odd.prototype = value;
  return Odd;
}

const targets = [
  ["itself", Maker => Maker],
  ["another constructor function", () => Motor],
  ["a class", () => Turbine],
  ["a function whose prototype is null", () => withPrototype(null)],
  ["a function whose prototype is a number", () => withPrototype(5)],
  ["a function whose prototype is an array", () => withPrototype([])],
  ["a function whose prototype has no prototype", () => withPrototype(Object.create(null))],
  ["a function whose prototype has a setter for power", () => withPrototype({ set power(value) { log.push("set power " + value); } })],
  ["a function whose prototype has only a getter for power", () => withPrototype({ get power() { return "from the getter"; } })],
  ["a function whose prototype has a power that cannot be written", () => withPrototype(Object.freeze({ power: "fixed" }))],
  ["a bound function", Maker => Maker.bind(null)],
  ["a bound other function", () => Motor.bind(null)],
  ["a proxy that logs", Maker => new Proxy(Maker, { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); } })],
  ["a proxy that answers Motor's prototype", Maker => new Proxy(Maker, { get(target, key) { return key === "prototype" ? Motor.prototype : target[key]; } })],
  ["Object", () => Object],
  ["Array", () => Array],
  ["Date", () => Date],
  ["an arrow function", () => () => {}],
  ["a method", () => ({ method() {} }).method],
  ["a plain object", () => ({})],
  ["undefined", () => undefined],
];

for (const Maker of [Engine, ModernEngine]) {
  let length = 0;
  for (let i = 0; i < 2000; i++) length += runOf(new Maker(i % 10)).length;
  console.log(Maker.name, "2000 honest constructions", length);

  for (const [label, pick] of targets) {
    let line = Maker.name + " for " + label + " -> ";
    try {
      const made = Reflect.construct(Maker, [7], pick(Maker));
      line += show(made) + " | log " + log.splice(0).join(", ");
      const parent = Object.getPrototypeOf(made);
      const names = [["Engine", Engine], ["ModernEngine", ModernEngine], ["Motor", Motor], ["Turbine", Turbine], ["Object", Object], ["Array", Array], ["Date", Date]];
      const named = names.find(([, each]) => each.prototype === parent);
      line += " | prototype of " + (named ? named[0] : parent === null ? "null" : Array.isArray(parent) ? "an array" : "something else");
      line += " | isArray " + Array.isArray(made) + " | power " + show(powerOf(made));
      try {
        line += " | run() " + show(runOf(made));
      } catch (error) {
        line += " | run() threw " + error.constructor.name;
      }
    } catch (error) {
      line += "threw " + error.constructor.name + " | log " + log.splice(0).join(", ");
    }
    console.log(line);
    console.log("  honest again", runOf(new Maker(1)));
  }
}
