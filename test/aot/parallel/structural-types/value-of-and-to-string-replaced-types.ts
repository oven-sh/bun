// Value of and to string are replaced within their types.
const log: string[] = [];

class Temperature {
  degrees: number;
  constructor(degrees: number) {
    this.degrees = degrees;
  }
  valueOf(): number {
    log.push("valueOf");
    return this.degrees;
  }
  toString(): string {
    log.push("toString");
    return this.degrees + " degrees";
  }
  toJSON(): unknown {
    log.push("toJSON");
    return { degrees: this.degrees };
  }
}

class Holder {
  constructor(public t: Temperature) {}
  text(): string {
    return `holds ${this.t}`;
  }
}

function text(t: Temperature): string {
  return `${t}`;
}

function joined(t: Temperature): string {
  return "is " + t;
}

function number(t: Temperature): number {
  return +t;
}

function warmer(a: Temperature, b: Temperature): boolean {
  return a > b;
}

function json(t: Temperature): string {
  return JSON.stringify(t) + " " + JSON.stringify([t]) + " " + JSON.stringify({ t });
}

const t = new Temperature(20);
const cold = new Temperature(-5);
const holder = new Holder(t);
const list = [t, cold];

function round(label: string): void {
  log.length = 0;
  const parts = [text(t), joined(t), number(t), warmer(t, cold), holder.text(), list.join(" and "), String(t), t.toString(), t.valueOf(), json(t)];
  console.log(label + ": " + parts.join(" | "));
  console.log(label + ", ran: " + log.join(" "));
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += text(t).length + joined(t).length + number(t) + (warmer(t, cold) ? 1 : 0) + holder.text().length;
console.log("2000 honest: " + warm);
round("before");

t.toString = () => "own text";
round("an own toString");

t.valueOf = () => -100;
round("an own valueOf");

t.toJSON = () => "own json";
round("an own toJSON");

t.toJSON = () => undefined;
round("a toJSON that gives undefined");

for (const name of ["toString", "valueOf", "toJSON"]) Reflect.deleteProperty(t, name);
round("uncovered");

const toString = Temperature.prototype.toString;
const valueOf = Temperature.prototype.valueOf;
Temperature.prototype.toString = function () {
  log.push("patched toString");
  return "T" + this.degrees;
};
Temperature.prototype.valueOf = function () {
  log.push("patched valueOf");
  return this.degrees + 273;
};
round("both replaced on the prototype");

const view: { toString?: () => string; valueOf?: () => number } = Temperature.prototype;
delete view.toString;
round("toString deleted: the one of every object shows");

delete view.valueOf;
round("valueOf deleted too");

Temperature.prototype.toString = toString;
Temperature.prototype.valueOf = valueOf;
round("restored");

export {};
