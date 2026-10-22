// Held from creation: Object.assign, Object.defineProperty and Reflect.set store functions onto the prototype object of a class, so a method call that the types resolve to one function finds another, with other results.
class Gauge {
  level = 4;
  read(): number {
    return this.level;
  }
  twice(): number {
    return this.level * 2;
  }
  half(): number {
    return this.level / 2;
  }
  get label(): string {
    return "gauge";
  }
}

const gauge = new Gauge();
const before = [gauge.read(), gauge.twice(), gauge.half(), gauge.label].join();
Object.assign(Gauge.prototype, { read: () => "assigned" });
Object.defineProperty(Gauge.prototype, "twice", { value: function (this: Gauge) { return "defined " + this.level; } });
Reflect.set(Gauge.prototype, "half", () => "set");
Object.defineProperty(Gauge.prototype, "label", { get: () => 5 });
const after = [gauge.read(), gauge.twice(), gauge.half(), gauge.label, new Gauge().read()].join();
console.log(before, after);
