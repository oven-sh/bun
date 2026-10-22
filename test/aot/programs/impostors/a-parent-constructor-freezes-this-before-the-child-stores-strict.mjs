function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

console.log("strict code:", (function () { return this === undefined; })());

let close = Object.freeze;

class Value {
  constructor(amount) {
    this.amount = amount;
    close(this);
  }
  plus(more) {
    return new this.constructor(this.amount + more);
  }
  grow() {
    this.amount++;
    return this.amount;
  }
}

class StoresAfter extends Value {
  constructor(amount) {
    super(amount);
    this.unit = "m";
  }
}

class FieldAfter extends Value {
  unit = "m";
}

class OverwritesAfter extends Value {
  constructor(amount) {
    super(amount);
    this.amount = -amount;
  }
}

function OldValue(amount) {
  this.amount = amount;
  close(this);
}
OldValue.prototype.grow = function () {
  this.amount++;
  return this.amount;
};

function OldChild(amount) {
  OldValue.call(this, amount);
  this.unit = "m";
  this.amount = -amount;
}
OldChild.prototype = Object.create(OldValue.prototype);

function make(Maker, amount) {
  return new Maker(amount);
}

function grow(value) {
  return value.grow();
}

function amountOf(value) {
  return value.amount;
}

const makers = [Value, StoresAfter, FieldAfter, OverwritesAfter, OldValue, OldChild];

for (const [label, closer] of [
  ["nothing", value => value],
  ["Object.freeze", Object.freeze],
  ["Object.seal", Object.seal],
  ["Object.preventExtensions", Object.preventExtensions],
  ["nothing again", value => value],
]) {
  close = closer;
  for (const Maker of makers) {
    attempt(label + " | new " + Maker.name, () => make(Maker, 3));
    attempt(label + " | " + Maker.name + ": grow()", () => grow(make(Maker, 3)));
    attempt(label + " | " + Maker.name + ": amount", () => amountOf(make(Maker, 3)));
  }
  attempt(label + " | plus", () => make(Value, 3).plus(4));
  if (label === "nothing") {
    let sum = 0;
    for (let i = 0; i < 2000; i++) for (const Maker of makers) sum += grow(make(Maker, i % 5)) + amountOf(make(Maker, 1));
    console.log("2000 rounds while nothing is closed", sum);
  }
}

export {};
