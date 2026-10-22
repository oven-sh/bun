function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

class Plain {
  constructor(amount) {
    this.amount = amount;
    this.origin = "Plain";
  }
  describe() {
    return "plain " + this.amount;
  }
}

class ByReflect {
  constructor(amount) {
    this.origin = "ByReflect";
    this.amount = amount;
  }
  describe() {
    return "by Reflect.construct " + this.amount;
  }
}

class ByTable {
  constructor(amount) {
    this.extra = true;
    this.amount = amount;
    this.origin = "ByTable";
  }
  describe() {
    return "by a table " + this.amount;
  }
}

class ByBind {
  constructor(amount) {
    this.amount = String(amount);
    this.origin = "ByBind";
  }
  describe() {
    return "by a bound class " + this.amount;
  }
}

class ByConstructorMember {
  constructor(amount) {
    this.amount = amount + 0.5;
    this.origin = "ByConstructorMember";
  }
  describe() {
    return "by the constructor member " + this.amount;
  }
}

class ByThis {
  constructor(amount) {
    this.amount = amount;
    this.origin = "ByThis";
  }
  describe() {
    return "by new this " + this.amount;
  }
  static create(amount) {
    return new this(amount);
  }
}

class ByNewTarget extends Plain {
  describe() {
    return "by new.target " + this.amount;
  }
}

class ByProxy {
  constructor(amount) {
    this.amount = amount;
    this.origin = "ByProxy";
  }
  describe() {
    return "by a proxy " + this.amount;
  }
}

class BySpecies extends Array {
  describe() {
    return "by species " + this.length;
  }
  get amount() {
    return this.length;
  }
  get origin() {
    return "BySpecies";
  }
}

function ByCreateAndCall(amount) {
  this.amount = amount;
  this.origin = "ByCreateAndCall";
}
ByCreateAndCall.prototype.describe = function () {
  return "by Object.create and call " + this.amount;
};

function ByApplyTrick(amount) {
  this.origin = "ByApplyTrick";
  this.amount = amount;
}
ByApplyTrick.prototype.describe = function () {
  return "by bind.apply " + this.amount;
};

function ByIndex(amount) {
  this.amount = [amount];
  this.origin = "ByIndex";
}
ByIndex.prototype.describe = function () {
  return "by an index " + this.amount;
};

const table = { ByTable };
const list = [Plain, ByIndex];

const routes = [
  ["new, in plain sight", amount => new Plain(amount), Plain],
  ["Reflect.construct", amount => Reflect.construct(ByReflect, [amount]), ByReflect],
  ["a table and a joined name", amount => new table[["By", "Table"].join("")](amount), ByTable],
  ["a bound class", amount => new (ByBind.bind(null))(amount), ByBind],
  ["the constructor member of the prototype", amount => new ByConstructorMember.prototype.constructor(amount), ByConstructorMember],
  ["new this in a static method", amount => ByThis.create(amount), ByThis],
  ["Reflect.construct of the parent for the child", amount => Reflect.construct(Plain, [amount], ByNewTarget), ByNewTarget],
  ["a proxy", amount => new (new Proxy(ByProxy, {}))(amount), ByProxy],
  ["from, then map", amount => BySpecies.from({ length: amount }).map(() => 0), BySpecies],
  ["Object.create and call", amount => { const made = Object.create(ByCreateAndCall.prototype); ByCreateAndCall.call(made, amount); return made; }, ByCreateAndCall],
  ["bind.apply", amount => new (Function.prototype.bind.apply(ByApplyTrick, [null, amount]))(), ByApplyTrick],
  ["an element picked by arithmetic", amount => new list[amount - amount + 1](amount), ByIndex],
];

function amountOf(thing) {
  return thing.amount;
}

function originOf(thing) {
  return thing.origin;
}

function describe(thing) {
  return thing.describe();
}

function plusOne(thing) {
  return thing.amount + 1;
}

function rename(thing) {
  thing.origin = "renamed";
  return thing.origin;
}

for (let round = 0; round < 3; round++) {
  for (const [label, make, Maker] of routes) {
    const parts = [
      ["made", () => make(2)],
      ["amount", () => amountOf(make(2))],
      ["origin", () => originOf(make(2))],
      ["describe", () => describe(make(2))],
      ["amount + 1", () => plusOne(make(2))],
      ["a store to origin", () => rename(make(2))],
      ["instanceof its class, Plain", () => [make(2) instanceof Maker, make(2) instanceof Plain]],
      ["constructor", () => make(2).constructor === Maker],
    ].map(([name, run]) => {
      try {
        return name + " " + show(run());
      } catch (error) {
        return name + " threw " + error.constructor.name;
      }
    });
    console.log("round " + round + " | " + label + " | " + parts.join(" | "));
  }
  if (round === 0) for (let i = 0; i < 2000; i++) amountOf(new Plain(i)), originOf(new Plain(i)), describe(new Plain(i)), plusOne(new Plain(i)), rename(new Plain(i));
  if (round === 1) for (let i = 0; i < 300; i++) for (const [, make] of routes) amountOf(make(2)), describe(make(2));
}
