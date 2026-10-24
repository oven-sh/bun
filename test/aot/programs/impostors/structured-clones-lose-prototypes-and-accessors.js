const log = [];

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) return "[" + Array.from(value, (each, index) => (index in value ? show(each) : "hole")).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

class Tank {
  constructor(liters, fuel) {
    this.liters = liters;
    this.fuel = fuel;
  }
  get gallons() {
    return this.liters / 4;
  }
  drain() {
    this.liters = 0;
    return this;
  }
}

function OldTank(liters, fuel) {
  this.liters = liters;
  this.fuel = fuel;
}
OldTank.prototype.drain = function () {
  this.liters = 0;
  return this;
};
Object.defineProperty(OldTank.prototype, "gallons", { get() { return this.liters / 4; } });

function litersOf(tank) {
  return tank.liters;
}

function gallonsOf(tank) {
  return tank.gallons;
}

function drain(tank) {
  return tank.drain();
}

const originals = [
  ["a class instance", () => new Tank(40, "diesel")],
  ["an instance of a constructor function", () => new OldTank(40, "diesel")],
  ["an instance with one more member", () => Object.assign(new Tank(40, "diesel"), { cap: true })],
  ["an instance whose liters is a getter", () => Object.defineProperty(new Tank(40, "diesel"), "liters", { get() { log.push("get liters"); return 44; }, enumerable: true })],
  ["an instance whose liters is not enumerable", () => Object.defineProperty(new Tank(40, "diesel"), "liters", { enumerable: false })],
  ["a frozen instance", () => Object.freeze(new Tank(40, "diesel"))],
  ["an instance with a symbol member", () => Object.assign(new Tank(40, "diesel"), { [Symbol.for("mark")]: 1 })],
  ["an instance that holds itself", () => { const tank = new Tank(40, "diesel"); tank.fuel = tank; return tank; }],
  ["an instance that holds -0, NaN, undefined and a bigint", () => new Tank(-0, [NaN, undefined, 5n])],
  ["an instance that holds an array with a hole", () => new Tank(40, [1, , 3])],
  ["an instance that holds another instance", () => new Tank(40, new OldTank(1, "inner"))],
  ["an instance with an own method", () => Object.assign(new Tank(40, "diesel"), { drain() { return "own"; } })],
  ["a proxy around an instance", () => new Proxy(new Tank(40, "diesel"), {})],
  ["an object without a prototype", () => Object.assign(Object.create(null), { liters: 40, fuel: "diesel" })],
  ["an object that inherits its members", () => Object.create(new Tank(40, "diesel"))],
];

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const tank = i % 2 ? new Tank(i % 50, "diesel") : new OldTank(i % 50, "petrol");
  sum += litersOf(tank) + gallonsOf(tank) + litersOf(drain(tank));
}
console.log("2000 honest tanks", sum);

for (const [label, make] of originals) {
  let clone;
  attempt(label + ": clone", () => { clone = undefined; clone = structuredClone(make()); return clone.fuel === clone ? "holds itself" : clone; });
  if (clone === undefined) continue;
  attempt(label + ": its prototype is Object.prototype", () => Object.getPrototypeOf(clone) === Object.prototype);
  attempt(label + ": instanceof Tank, OldTank", () => [clone instanceof Tank, clone instanceof OldTank]);
  attempt(label + ": liters", () => litersOf(clone));
  attempt(label + ": liters is a plain value that can be written", () => { const found = Object.getOwnPropertyDescriptor(clone, "liters"); return found && [found.writable, found.enumerable, found.configurable, "value" in found]; });
  attempt(label + ": gallons", () => gallonsOf(clone));
  attempt(label + ": drain()", () => drain(clone));
  attempt(label + ": the honest drain with it as this", () => litersOf(Tank.prototype.drain.call(clone)));
  attempt(label + ": frozen", () => Object.isFrozen(clone));
  attempt("honest again", () => [gallonsOf(new Tank(8, "x")), litersOf(drain(new OldTank(8, "x")))]);
}
