const log = [];

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function print(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

class Thermometer {
  constructor(celsius) {
    this.celsius = celsius;
  }
  get fahrenheit() {
    return this.celsius * 2 + 30;
  }
  set fahrenheit(value) {
    this.celsius = (value - 30) / 2;
  }
  get frozen() {
    return this.celsius < 0;
  }
}

function read(thermometer) {
  return thermometer.fahrenheit;
}

function write(thermometer, value) {
  thermometer.fahrenheit = value;
  return thermometer.celsius;
}

function bump(thermometer) {
  thermometer.fahrenheit += 2;
  return thermometer.celsius;
}

function readOnlyOne(thermometer) {
  return thermometer.frozen;
}

function writeReadOnlyOne(thermometer) {
  thermometer.frozen = "stored";
  return thermometer.frozen;
}

function look(label, make) {
  print(label + ": read", () => read(make()));
  print(label + ": write 50", () => write(make(), 50));
  print(label + ": += 2", () => bump(make()));
  print(label + ": a getter without a setter", () => readOnlyOne(make()));
  print(label + ": a store to it", () => writeReadOnlyOne(make()));
  print(label + ": keys", () => Object.keys(make()));
}

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const honest = new Thermometer(i % 30);
  sum += read(honest) + write(honest, 40) + bump(honest) + (readOnlyOne(honest) ? 1 : 0);
}
console.log("2000 honest rounds", sum);
look("honest", () => new Thermometer(10));

class OnlyGetter extends Thermometer {
  get fahrenheit() {
    log.push("the child's getter");
    return "child";
  }
}
look("a child that overrides only the getter", () => new OnlyGetter(10));

class OnlySetter extends Thermometer {
  set fahrenheit(value) {
    log.push("the child's setter " + value);
  }
}
look("a child that overrides only the setter", () => new OnlySetter(10));

class CallsSuper extends Thermometer {
  get fahrenheit() {
    return "super says " + super.fahrenheit;
  }
  set fahrenheit(value) {
    super.fahrenheit = value + 10;
  }
}
look("a child that goes through super", () => new CallsSuper(10));

class FieldOver extends Thermometer {
  fahrenheit = "a field";
  frozen = "a field too";
}
look("a child with fields of the same names", () => new FieldOver(10));

look("an own value shadows the accessor", () => Object.defineProperty(new Thermometer(10), "fahrenheit", { value: "own", writable: true, enumerable: true, configurable: true }));
look("an own value that cannot be written shadows it", () => Object.defineProperty(new Thermometer(10), "fahrenheit", { value: "own" }));
look("a literal with plain members", () => ({ celsius: 10, fahrenheit: "plain", frozen: "plain" }));
look("a literal under the prototype", () => ({ __proto__: Thermometer.prototype, celsius: 10 }));
look("a literal under the prototype without celsius", () => ({ __proto__: Thermometer.prototype }));
look("a frozen thermometer", () => Object.freeze(new Thermometer(10)));
look("a thermometer with a string", () => new Thermometer("10"));
look("a proxy around a thermometer", () => new Proxy(new Thermometer(10), { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push("set " + String(key)); return Reflect.set(target, key, value, receiver); } }));
look("an object that inherits from a thermometer", () => Object.create(new Thermometer(10)));

const original = Object.getOwnPropertyDescriptor(Thermometer.prototype, "fahrenheit");
Object.defineProperty(Thermometer.prototype, "fahrenheit", { get() { log.push("a new getter"); return "replaced"; }, set: original.set, configurable: true });
look("the getter was replaced on the prototype", () => new Thermometer(10));
Object.defineProperty(Thermometer.prototype, "fahrenheit", { get: original.get, set: undefined, configurable: true });
look("the setter was removed", () => new Thermometer(10));
Object.defineProperty(Thermometer.prototype, "fahrenheit", { value: "a plain value now", writable: true, configurable: true });
look("the accessor became a plain value", () => new Thermometer(10));
delete Thermometer.prototype.fahrenheit;
look("the accessor was deleted", () => new Thermometer(10));
Object.defineProperty(Thermometer.prototype, "fahrenheit", original);
look("the accessor is back", () => new Thermometer(10));
look("and the child that goes through super", () => new CallsSuper(10));
