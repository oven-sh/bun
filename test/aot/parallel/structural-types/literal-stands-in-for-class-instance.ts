// An object literal stands in for a class instance.
class Temperature {
  degrees = 20;
  scale = "C";
  warmer(by: number): Temperature {
    const next = new Temperature();
    next.degrees = this.degrees + by;
    return next;
  }
  label(): string {
    return this.degrees + this.scale;
  }
  get freezing(): boolean {
    return this.degrees <= 0;
  }
}

const calls: string[] = [];

const literal: Temperature = {
  scale: "F",
  degrees: 68,
  warmer(by) {
    calls.push("warmer " + by);
    return this;
  },
  label() {
    calls.push("label");
    return "literal " + this.degrees;
  },
  freezing: true,
};

const arrows: Temperature = {
  degrees: -5,
  scale: "K",
  warmer: () => literal,
  label: () => "arrow",
  get freezing() {
    calls.push("get freezing");
    return false;
  },
};

function inspect(t: Temperature): string {
  return [
    t.label(),
    t.degrees,
    t.scale,
    t.freezing,
    t.warmer(1).label(),
    t instanceof Temperature,
    t.constructor === Object,
    Object.getPrototypeOf(t) === Object.prototype,
    Object.keys(t).join("+"),
    Object.hasOwn(t, "label"),
    "label" in t,
  ].join(" ");
}

function chain(t: Temperature): string {
  return t.warmer(1).warmer(2).warmer(3).label();
}

class Room {
  constructor(public temperature: Temperature) {}
  status(): string {
    return this.temperature.label() + (this.temperature.freezing ? " cold" : " fine");
  }
}

console.log("an instance: " + inspect(new Temperature()));
console.log("a literal: " + inspect(literal));
console.log("a literal of arrows: " + inspect(arrows));
console.log("calls: " + calls.join());
calls.length = 0;

console.log("chain, instance: " + chain(new Temperature()));
console.log("chain, literal: " + chain(literal));
console.log("chain, arrows: " + chain(arrows));
console.log("calls: " + calls.join());
calls.length = 0;

console.log("field, instance: " + new Room(new Temperature()).status());
console.log("field, literal: " + new Room(literal).status());
console.log("field, arrows: " + new Room(arrows).status());

const list: Temperature[] = [new Temperature(), literal, arrows];
console.log("elements: " + list.map(t => t.label()).join());
console.log("json: " + JSON.stringify(list));
console.log("instances among them: " + list.filter(t => t instanceof Temperature).length);

let text = "";
for (let i = 0; i < 2000; i++) text = new Temperature().label();
console.log("2000 honest labels, the last: " + text);
const sameSite = (t: Temperature) => t.label();
for (let i = 0; i < 2000; i++) sameSite(list[0]);
console.log("then the literal at that site: " + sameSite(literal));
console.log("then the arrows: " + sameSite(arrows));

const taken = literal.label;
console.log("a literal's method on an instance: " + taken.call(new Temperature()));
console.log("the class's method on a literal: " + Temperature.prototype.label.call(literal));

export {};
