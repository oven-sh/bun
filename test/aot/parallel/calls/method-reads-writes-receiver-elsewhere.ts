// Two classes have a method of one name. One call site calls it on instances of both and on receivers that the program did not make with `new`.
class Counter {
  count = 1;
  label = "counter";
  step(by?: number) {
    this.count = (this.count ?? 0) + (by ?? 1);
    (this as any).stepped = true;
    return `${this.label}:${this.count}`;
  }
}

class Meter {
  count = 10;
  label = "meter";
  unit = "m";
  step(by?: number) {
    this.count = (this.count ?? 0) + (by ?? 10);
    this.unit += "!";
    return `${this.label}:${this.count}${this.unit}`;
  }
}

function run(receiver: any, by?: number) {
  return receiver.step(by);
}

function show(name: string, make: () => any) {
  try {
    const receiver = make();
    const first = run(receiver);
    const second = run(receiver, 5);
    const keys = receiver !== null && typeof receiver === "object" ? Object.keys(receiver).join() : typeof receiver;
    console.log(name, first, second, keys, receiver instanceof Counter, receiver instanceof Meter);
  } catch (error: any) {
    console.log(name, "threw", error?.constructor?.name);
  }
}

show("new Counter", () => new Counter());
show("new Meter", () => new Meter());
show("parsed, method stored", () => Object.assign(JSON.parse('{"count": 5, "label": "parsed"}'), { step: Counter.prototype.step }));
show("parsed, prototype set", () => Object.setPrototypeOf(JSON.parse('{"count": 6, "label": "below"}'), Meter.prototype));
show("parsed, nothing found", () => JSON.parse('{"count": 7}'));
show("revived", () => JSON.parse('{"inner": {"count": 8}}', (key, value) => (key === "inner" ? Object.setPrototypeOf(value, Counter.prototype) : value)).inner);
show("made by evaluated text", () => Object.setPrototypeOf((0, eval)('({ count: 20, label: "text" })'), Counter.prototype));
show("proxy over an instance", () => new Proxy(new Counter(), {}));
show("proxy that answers the method", () => new Proxy({ count: 30, label: "trap" } as any, { get: (target, key, receiver) => (key === "step" ? Meter.prototype.step : Reflect.get(target, key, receiver)) }));
show("proxy that counts writes", () => {
  let writes = 0;
  return new Proxy(new Meter(), { set: (target, key, value) => ((target as any)[key] = key === "count" ? value + ++writes : value, true) });
});
show("plain, prototype set", () => Object.setPrototypeOf({ count: 40, label: "plain" }, Counter.prototype));
show("created below the prototype", () => Object.create(Meter.prototype, { unit: { value: "c", writable: true, enumerable: true } }));
show("literal below the prototype", () => ({ __proto__: Counter.prototype, label: "literal" }));
show("an instance moved below the other class", () => Object.setPrototypeOf(new Counter(), Meter.prototype));
show("constructed for another new.target", () => Reflect.construct(Meter, [], Counter));
show("constructed the other way", () => Reflect.construct(Counter, [], Meter));
show("Object constructed for the class", () => Reflect.construct(Object, [], Counter));
show("subclass made in text", () => new (new Function("Base", 'return class extends Base { constructor() { super(); this.label = "heir"; } }')(Counter))());
show("subclass in text that overrides", () => new (new Function("Base", "return class extends Base { step(by) { return 'over ' + super.step(by); } }")(Meter))());
show("cloned", () => structuredClone(new Counter()));
show("frozen", () => Object.freeze(new Counter()));
show("borrowed on a function", () => Object.assign(function holder() {}, { step: Counter.prototype.step, label: "function" }));
show("borrowed on an array", () => Object.assign([1, 2], { step: Meter.prototype.step, label: "array", unit: "a" }));
show("bound to another receiver", () => ({ step: Counter.prototype.step.bind({ count: 50, label: "bound" }) }));
(Number.prototype as any).step = Counter.prototype.step;
show("a number", () => 5);
delete (Number.prototype as any).step;
show("a number, method gone", () => 5);
(String.prototype as any).step = function (this: any) {
  return typeof this + this.length;
};
show("a string", () => "abc");
delete (String.prototype as any).step;
show("null", () => null);
show("undefined", () => undefined);
console.log([new Counter(), new Meter(), Object.create(Counter.prototype)].map(receiver => run(receiver)).join());
