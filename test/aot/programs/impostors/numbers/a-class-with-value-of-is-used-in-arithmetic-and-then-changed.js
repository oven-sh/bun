function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const log = [];

class Money {
  constructor(cents) {
    this.cents = cents;
  }
  valueOf() {
    log.push("valueOf");
    return this.cents;
  }
  toString() {
    log.push("toString");
    return "$" + this.cents / 100;
  }
}

class Tip extends Money {
  valueOf() {
    log.push("Tip.valueOf");
    return super.valueOf() * 2;
  }
}

class Label extends Money {
  [Symbol.toPrimitive](hint) {
    log.push("toPrimitive " + hint);
    return hint === "number" ? 1 : "label";
  }
}

function uses(a, b) {
  return [a + b, a - b, a * 2, a < b, a == 100, a | 0, -a, `${a}`, a + "", Math.max(a, b), [10, 20, 30][a / 100]];
}

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function report(label, run) {
  log.length = 0;
  const result = outcome(run);
  console.log(label + " -> " + result + " | " + log.join(" "));
}

for (let i = 0; i < 1000; i++) {
  uses(new Money(100), new Money(250));
  total([new Money(1), new Money(2)]);
}

report("two amounts", () => uses(new Money(100), new Money(250)));
report("an amount and a number", () => uses(new Money(100), 250));
report("a number and an amount", () => uses(100, new Money(250)));
report("numbers", () => uses(100, 250));
report("a subclass that overrides valueOf", () => uses(new Tip(100), new Money(250)));
report("a subclass with Symbol.toPrimitive", () => uses(new Label(100), new Money(250)));
report("an amount of text", () => uses(new Money("100"), new Money(250)));
report("an amount of a bigint", () => uses(new Money(100n), new Money(250n)));
report("an amount of nothing", () => uses(new Money(), new Money(250)));
report("an amount of an amount", () => uses(new Money(new Money(100)), new Money(250)));
report("an own valueOf", () => uses(Object.assign(new Money(100), { valueOf: () => 7 }), new Money(250)));
report("an own valueOf that is no function", () => uses(Object.assign(new Money(100), { valueOf: 7 }), new Money(250)));
report("another prototype", () => uses(Object.setPrototypeOf(new Money(100), { valueOf: () => 8 }), new Money(250)));
report("no prototype", () => uses(Object.setPrototypeOf(new Money(100), null), new Money(250)));
report("total", () => total([new Money(1), new Money(2), new Tip(3), 4, "5", new Money(6)]));

const original = Money.prototype.valueOf;
Money.prototype.valueOf = function () {
  log.push("replaced");
  return this.cents + 1;
};
report("valueOf replaced on the prototype", () => uses(new Money(100), new Money(250)));
report("the subclass reaches the replacement", () => uses(new Tip(100), new Money(250)));
Money.prototype.valueOf = function () {
  log.push("gives a text");
  return String(this.cents);
};
report("valueOf gives a text", () => uses(new Money(100), new Money(250)));
Money.prototype.valueOf = function () {
  log.push("gives an object");
  return {};
};
report("valueOf gives an object", () => uses(new Money(100), new Money(250)));
delete Money.prototype.valueOf;
report("valueOf deleted", () => uses(new Money(100), new Money(250)));
Money.prototype[Symbol.toPrimitive] = function (hint) {
  log.push("added " + hint);
  return 5;
};
report("Symbol.toPrimitive added", () => uses(new Money(100), new Money(250)));
delete Money.prototype[Symbol.toPrimitive];
Money.prototype.valueOf = original;
report("everything restored", () => uses(new Money(100), new Money(250)));
